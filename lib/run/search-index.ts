import { sql } from "drizzle-orm";
import type { StateDb } from "@/lib/state/types";
import { toFtsQuery } from "./fts";

export type SearchKind = "character" | "location" | "item" | "faction" | "thread" | "clock";

export const ENTITY_KINDS: SearchKind[] = ["character", "location", "item", "faction"];

export interface SearchHit {
  kind: SearchKind;
  targetId: string;
  name: string;
}

interface IndexRow {
  campaignId: string;
  kind: SearchKind;
  targetId: string;
  name: string;
  body: string | null;
}

interface BriefingRow {
  campaignId: string;
  kind: SearchKind;
  targetId: string;
  aliases: string[];
  identity: string | null;
  wants: string | null;
  partyKnows: string | null;
  /** Accepted so callers can pass a whole briefing; deliberately never indexed. */
  secret?: string | null;
}

/** Read the current row for a target, if any. */
function readRow(
  db: StateDb,
  campaignId: string,
  kind: string,
  targetId: string,
): { name: string; aliases: string; body: string } | undefined {
  return db.all<{ name: string; aliases: string; body: string }>(sql`
    SELECT name, aliases, body FROM search_index
    WHERE campaign_id = ${campaignId} AND kind = ${kind} AND target_id = ${targetId}
  `)[0];
}

function deleteRow(db: StateDb, campaignId: string, kind: string, targetId: string): void {
  db.run(sql`
    DELETE FROM search_index
    WHERE campaign_id = ${campaignId} AND kind = ${kind} AND target_id = ${targetId}
  `);
}

function writeRow(
  db: StateDb,
  campaignId: string,
  kind: string,
  targetId: string,
  name: string,
  aliases: string,
  body: string,
): void {
  deleteRow(db, campaignId, kind, targetId);
  db.run(sql`
    INSERT INTO search_index (campaign_id, kind, target_id, name, aliases, body)
    VALUES (${campaignId}, ${kind}, ${targetId}, ${name}, ${aliases}, ${body})
  `);
}

/**
 * Index (or re-index) a searchable object from its own table. Called on entity,
 * thread, and clock writes. An entity is findable whether or not it has a
 * briefing — that is what keeps the fallback card reachable.
 */
export async function indexEntity(db: StateDb, row: IndexRow): Promise<void> {
  const existing = readRow(db, row.campaignId, row.kind, row.targetId);
  // Preserve briefing-derived aliases; only a briefing write owns that column.
  const aliases = existing?.aliases ?? "";
  writeRow(db, row.campaignId, row.kind, row.targetId, row.name, aliases, row.body ?? "");
}

/**
 * Enrich an existing row with briefing content. Creates the row if the entity
 * was never indexed, so a briefing write can never leave a target unfindable.
 *
 * `secret` is never written: a DM-only field that can be retrieved by typing its
 * contents into a search box is not DM-only.
 */
export async function indexBriefing(db: StateDb, row: BriefingRow): Promise<void> {
  const existing = readRow(db, row.campaignId, row.kind, row.targetId);
  const body = [row.identity, row.wants, row.partyKnows].filter(Boolean).join(" ");
  writeRow(
    db,
    row.campaignId,
    row.kind,
    row.targetId,
    existing?.name ?? "",
    row.aliases.join(" "),
    body,
  );
}

export async function removeFromIndex(
  db: StateDb,
  target: { campaignId: string; kind: SearchKind; targetId: string },
): Promise<void> {
  deleteRow(db, target.campaignId, target.kind, target.targetId);
}

/**
 * Ranked lookup. Tier ordering is explicit rather than left to bm25: at the
 * table an exact name match must win, and bm25 alone will happily rank a long
 * body paragraph above the name it belongs to.
 */
export async function searchIndex(
  db: StateDb,
  opts: { campaignId: string; q: string; kinds?: SearchKind[]; limit?: number },
): Promise<SearchHit[]> {
  const match = toFtsQuery(opts.q);
  if (!match) return [];
  const limit = opts.limit ?? 20;
  const needle = opts.q.trim().toLowerCase();
  const kinds = opts.kinds?.length ? opts.kinds : null;

  const rows = db.all<{ kind: SearchKind; targetId: string; name: string }>(sql`
    SELECT kind, target_id AS targetId, name
    FROM search_index
    WHERE search_index MATCH ${match}
      AND campaign_id = ${opts.campaignId}
      ${kinds ? sql`AND kind IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})` : sql``}
    ORDER BY
      CASE
        WHEN lower(name) = ${needle} THEN 0
        WHEN lower(name) LIKE ${needle + "%"} THEN 1
        WHEN lower(aliases) LIKE ${"%" + needle + "%"} THEN 2
        ELSE 3
      END,
      bm25(search_index),
      name
    LIMIT ${limit}
  `);
  if (rows.length > 0) return rows;

  return flattenedFallback(db, opts, limit);
}

/**
 * Last resort when FTS matched nothing.
 *
 * FTS5 splits "Al'Jinn" into the tokens "al" and "jinn", so a DM who reads the
 * name off their own screen and types "aljinn" prefix-matches neither and gets
 * silence — no error, no empty-state hint, just a wrong answer at the worst
 * possible moment. This compares against the name with its punctuation and
 * spaces removed, which is what they actually typed.
 *
 * Only runs when FTS found nothing, so the common path never pays for it. It is
 * a full scan with string functions, which is fine over the few hundred rows one
 * campaign holds and would not be at a much larger scale.
 */
function flattenedFallback(
  db: StateDb,
  opts: { campaignId: string; q: string; kinds?: SearchKind[] },
  limit: number,
): SearchHit[] {
  const flat = opts.q.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!flat) return [];
  const kinds = opts.kinds?.length ? opts.kinds : null;

  // SQLite has no regex, so the separators are stripped by nested replace().
  // These four cover the punctuation that actually appears in entity names.
  const flatName = sql`replace(replace(replace(replace(lower(name), '''', ''), ' ', ''), '-', ''), '.', '')`;

  return db.all<{ kind: SearchKind; targetId: string; name: string }>(sql`
    SELECT kind, target_id AS targetId, name
    FROM search_index
    WHERE campaign_id = ${opts.campaignId}
      ${kinds ? sql`AND kind IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})` : sql``}
      AND ${flatName} LIKE ${flat + "%"}
    ORDER BY length(name), name
    LIMIT ${limit}
  `);
}
