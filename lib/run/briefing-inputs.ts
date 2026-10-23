import { sql } from "drizzle-orm";
import { NotFoundError } from "@/lib/state/errors";
import { hashContent } from "@/lib/state/content-hash";
import type { StateDb } from "@/lib/state/types";
import { BRIEFING_TARGET_KINDS, type BriefingTargetKind } from "./briefings";

/** How many recent timeline events feed a briefing. Enough for context, small enough to stay cheap. */
const TIMELINE_LIMIT = 12;

export interface BriefingInputs {
  targetKind: BriefingTargetKind;
  targetId: string;
  name: string;
  description: string | null;
  /** Frontmatter-derived properties, as stored on the row. */
  sourceProps: string | null;
  /** Vault-relative path of the entity's note. Null for an entity with no note. */
  sourcePath: string | null;
  /** Hash of the note's raw body, as stored by the vault sync. Drives staleness. */
  sourceHash: string | null;
  threads: { title: string; stakes: string | null; status: string; role: string }[];
  timeline: { day: number; kind: string; title: string; body: string | null }[];
  /**
   * The note's RAW body, `[!dm]` callouts included. Read from the file at build
   * time, not stored on the entity, and null when there is no note or it could
   * not be read. It is deliberately not `source_text`, which has `[!dm]`
   * stripped: the model that writes `entity_briefings.secret` has to see the
   * behind-the-screen material that field exists to hold. Never part of the
   * staleness hash (that is `sourceHash`).
   */
  sourceBody: string | null;
}

const TABLE_FOR_KIND: Record<BriefingTargetKind, string> = {
  character: "characters",
  location: "locations",
  item: "items",
  faction: "factions",
};

function assertKind(kind: string): asserts kind is BriefingTargetKind {
  if (!(BRIEFING_TARGET_KINDS as string[]).includes(kind)) {
    throw new Error(`Unknown targetKind "${kind}"`);
  }
}

/**
 * Read everything a briefing is built from. The note body is read from the
 * vault separately by the caller and attached to the returned object — this
 * function touches only local SQLite, which is what lets `isStale` answer
 * without reading any files.
 */
export async function gatherInputs(
  db: StateDb,
  campaignId: string,
  targetKind: string,
  targetId: string,
): Promise<BriefingInputs> {
  // Validated against the union before it reaches sql.raw: the table name is
  // interpolated, so an unchecked value here would be an injection point.
  assertKind(targetKind);
  const table = TABLE_FOR_KIND[targetKind];

  const entity = db.all<{
    name: string;
    description: string | null;
    sourceProps: string | null;
    sourcePath: string | null;
    sourceHash: string | null;
  }>(sql`
    SELECT name, description, source_props AS sourceProps, source_path AS sourcePath, source_hash AS sourceHash
    FROM ${sql.raw(table)}
    WHERE id = ${targetId} AND campaign_id = ${campaignId}
  `)[0];
  if (!entity) throw new NotFoundError(`No ${targetKind} found with that id`);

  const threads = db.all<{ title: string; stakes: string | null; status: string; role: string }>(sql`
    SELECT t.title AS title, t.stakes AS stakes, t.status AS status, tl.role AS role
    FROM thread_links tl
    JOIN threads t ON t.id = tl.thread_id
    WHERE tl.target_kind = ${targetKind} AND tl.target_id = ${targetId}
      AND t.campaign_id = ${campaignId} AND t.archived = 0
    ORDER BY t.title
  `);

  // Relevant two ways, and both are needed: an event may name the entity
  // outright, or it may sit on a thread the entity is linked to and never
  // mention them by name. Matching only on the name would drop the second kind,
  // which is most of what makes a briefing worth reading — "what has been
  // happening around this person" rather than "where does this string appear".
  //
  // The LIKE is deliberately unescaped. Here it only widens a relevance net, so
  // a stray % or _ in a name costs a few extra events in the prompt. That is
  // unlike the ranking tiers in search-index.ts, where an unescaped wildcard
  // silently corrupted the ordering and had to be escaped.
  const timeline = db.all<{ day: number; kind: string; title: string; body: string | null }>(sql`
    SELECT day, kind, title, body FROM timeline_events
    WHERE campaign_id = ${campaignId}
      AND (
        title LIKE ${"%" + entity.name + "%"}
        OR body LIKE ${"%" + entity.name + "%"}
        OR thread_id IN (
          SELECT thread_id FROM thread_links
          WHERE target_kind = ${targetKind} AND target_id = ${targetId}
        )
      )
    -- Thread-linked events sort ahead of mere name matches, because the two
    -- signals are not equally strong. An entity called "The Watch" is named in
    -- passing all over the campaign; sorting purely by recency lets that chatter
    -- fill all twelve slots and crowd out the events on threads the entity is
    -- actually tangled in — which is the material a briefing is for.
    --
    -- id is a tiebreak, not a preference: SQLite leaves the order of rows that
    -- tie on every ORDER BY column undefined. Same-day, same-timestamp events
    -- are ordinary here, and without a total order the sequence could shift
    -- when the query plan changes — churning hashInputs and reporting every
    -- briefing in the campaign stale at once, for no visible reason.
    ORDER BY
      CASE WHEN thread_id IN (
        SELECT thread_id FROM thread_links
        WHERE target_kind = ${targetKind} AND target_id = ${targetId}
      ) THEN 0 ELSE 1 END,
      day DESC, created_at DESC, id DESC
    LIMIT ${TIMELINE_LIMIT}
  `);

  return {
    targetKind,
    targetId,
    name: entity.name,
    description: entity.description,
    sourceProps: entity.sourceProps,
    sourcePath: entity.sourcePath,
    sourceHash: entity.sourceHash,
    threads,
    timeline,
    sourceBody: null,
  };
}

/**
 * Stable watermark over everything a build read. Fields are serialised in a
 * fixed order rather than via JSON.stringify of the whole object, so key
 * ordering can never churn the hash and mark every briefing stale.
 *
 * The note enters through `sourceHash`, a column the vault sync already
 * maintains over the raw body, so an edited note marks its briefing stale
 * without any file being read. `sourceBody` is deliberately not hashed: it is
 * the same content by another route, and hashing it would make staleness
 * depend on the vault being mounted.
 */
export function hashInputs(inputs: BriefingInputs): string {
  const parts = [
    inputs.targetKind,
    inputs.targetId,
    inputs.name,
    inputs.description ?? "",
    inputs.sourceProps ?? "",
    inputs.sourceHash ?? "",
    ...inputs.threads.map((t) => `${t.role}|${t.status}|${t.title}|${t.stakes ?? ""}`),
    ...inputs.timeline.map((e) => `${e.day}|${e.kind}|${e.title}|${e.body ?? ""}`),
  ];
  return hashContent(parts.join("\n"));
}
