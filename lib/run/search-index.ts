import { sql } from "drizzle-orm";
import type { StateDb } from "@/lib/state/types";
import { toFtsQuery } from "./fts";

export type SearchKind = "character" | "location" | "item" | "faction" | "thread" | "clock";

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
 * The text an entity contributes to the index body: the vault note's stripped
 * prose (`source_text`, already free of `[!dm]` callouts) when it has any,
 * otherwise `description` — hub-made and world-seeded rows have no note, and a
 * note with an empty body falls back to the description it was synced with.
 */
export function entityIndexBody(
  row: { sourceText?: string | null; description?: string | null },
): string {
  return row.sourceText && row.sourceText.trim() !== "" ? row.sourceText : (row.description ?? "");
}

/**
 * Index (or re-index) a searchable object from its own table. Called on entity,
 * thread, and clock writes. An entity is findable whether or not it has a
 * briefing — that is what keeps the fallback card reachable.
 *
 * Aliases come from the existing index row when there is one — only a briefing
 * write owns that column in the steady state. But when there is no existing
 * row (the index hasn't been backfilled, or this is the entity's first write),
 * falling back to "" would silently drop any aliases a briefing already holds
 * for this target until some later briefing write happens to restore them. So
 * with no existing row this looks the briefing up directly, mirroring how
 * indexBriefing falls back to the entity's own table for its name when the
 * reverse gap applies.
 */
export async function indexEntity(db: StateDb, row: IndexRow): Promise<void> {
  const existing = readRow(db, row.campaignId, row.kind, row.targetId);
  const aliases =
    existing?.aliases ??
    briefingIndexText(
      { aliases: lookupBriefingAliases(db, row.campaignId, row.kind, row.targetId) },
      `${row.kind} ${row.targetId}`,
    ).aliases;
  writeRow(db, row.campaignId, row.kind, row.targetId, row.name, aliases, row.body ?? "");
}

/**
 * Entity tables a briefing can belong to. Threads and clocks never carry
 * briefings, so they are absent by design.
 */
const ENTITY_TABLE_FOR_KIND: Partial<Record<SearchKind, string>> = {
  character: "characters",
  location: "locations",
  item: "items",
  faction: "factions",
};

/**
 * Read an entity's own name. Used when a briefing arrives for something that was
 * never indexed, so the row can still be written with a real name. Returns ""
 * for a dangling id — thread_links and briefings both tolerate those by design.
 */
function lookupEntityName(
  db: StateDb,
  campaignId: string,
  kind: SearchKind,
  targetId: string,
): string {
  const table = ENTITY_TABLE_FOR_KIND[kind];
  if (!table) return "";
  const row = db.all<{ name: string }>(sql`
    SELECT name FROM ${sql.raw(table)}
    WHERE id = ${targetId} AND campaign_id = ${campaignId}
  `)[0];
  return row?.name ?? "";
}

/**
 * Read an entity's briefing aliases, if any. Used when an entity arrives for
 * something that was never indexed, so a re-sync can't silently lose aliases a
 * briefing already recorded — the mirror image of lookupEntityName above. A
 * malformed aliases blob yields [] rather than throwing, matching the same
 * tolerance rebuildSearchIndex and lib/run/briefings.ts's parseStringArray use.
 */
function lookupBriefingAliases(
  db: StateDb,
  campaignId: string,
  kind: SearchKind,
  targetId: string,
): string[] {
  const row = db.all<{ aliases: string }>(sql`
    SELECT aliases FROM entity_briefings
    WHERE campaign_id = ${campaignId} AND target_kind = ${kind} AND target_id = ${targetId}
  `)[0];
  return row ? parseAliases(row.aliases) : [];
}

/** Tolerant read of a briefing's aliases JSON: malformed yields [] rather than throwing. */
function parseAliases(blob: string): string[] {
  try {
    const parsed: unknown = JSON.parse(blob);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

const DM_MARKER = /\[!dm\]/i;

/**
 * The ONE place briefing text becomes indexed text. `indexBriefing`,
 * `rebuildSearchIndex` and `indexEntity`'s alias fallback all go through it, so
 * the rule below cannot be undone by a path that forgot to apply it (a rebuild
 * from `entity_briefings` would otherwise resurrect a field dropped at write time).
 *
 * Backstop: the briefing model is given the raw note, `[!dm]` callouts included,
 * and told to keep them out of the indexed fields. That is an instruction, and
 * an instruction can be ignored. So any field whose text still contains a
 * `[!dm]` marker is left out of the index, with a warning. This catches only
 * VERBATIM copying, the mechanically detectable failure. It does not catch a
 * paraphrase of behind-the-screen text, which looks like any other sentence;
 * the prompt remains the defence against that.
 *
 * `secret` is not a parameter: it is never indexed at all.
 */
function briefingIndexText(
  fields: { identity?: string | null; wants?: string | null; partyKnows?: string | null; aliases: string[] },
  label: string,
): { body: string; aliases: string } {
  let dropped = 0;
  const keep = (text: string | null | undefined): text is string => {
    if (!text) return false;
    if (!DM_MARKER.test(text)) return true;
    dropped++;
    return false;
  };
  const body = [fields.identity, fields.wants, fields.partyKnows].filter(keep).join(" ");
  const aliases = fields.aliases.filter(keep).join(" ");
  if (dropped > 0) {
    console.warn(
      `[search-index] Left ${dropped} briefing field(s) out of the index for ${label}: they contain a [!dm] marker.`,
    );
  }
  return { body, aliases };
}

/**
 * Enrich the row with briefing content.
 *
 * When the entity was never indexed, its name is read from its own table rather
 * than left blank — the briefing repo calls this without a name in hand, and on
 * a database whose index has not been backfilled that would otherwise write a
 * row matching nothing at all.
 *
 * `secret` is never written: a DM-only field that can be retrieved by typing its
 * contents into a search box is not DM-only.
 *
 * Fields carrying a `[!dm]` marker are left out; see `briefingIndexText`.
 */
export async function indexBriefing(db: StateDb, row: BriefingRow): Promise<void> {
  const existing = readRow(db, row.campaignId, row.kind, row.targetId);
  const { body, aliases } = briefingIndexText(row, `${row.kind} ${row.targetId}`);
  // `||` rather than `??`: an existing row with a blank name (written by an
  // older build) should self-heal on the next briefing write.
  const name = existing?.name || lookupEntityName(db, row.campaignId, row.kind, row.targetId);
  writeRow(db, row.campaignId, row.kind, row.targetId, name, aliases, body);
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
  // SQLite LIKE treats % and _ as wildcards. Escaped so a query containing them
  // ranks on the literal characters — these tiers exist precisely to make the
  // ordering deterministic, and a stray underscore silently undoes that.
  const needle = opts.q.trim().toLowerCase().replace(/[%_\\]/g, "\\$&");
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
        WHEN lower(name) LIKE ${needle + "%"} ESCAPE '\\' THEN 1
        WHEN lower(aliases) LIKE ${"%" + needle + "%"} ESCAPE '\\' THEN 2
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

/**
 * Rebuild the whole index for one campaign from the source tables. Run once per
 * campaign at rollout, and available from Settings afterwards. Returns the row
 * count written.
 */
export async function rebuildSearchIndex(db: StateDb, campaignId: string): Promise<number> {
  db.run(sql`DELETE FROM search_index WHERE campaign_id = ${campaignId}`);

  const briefings = db.all<{ targetKind: string; targetId: string; aliases: string; identity: string | null; wants: string | null; partyKnows: string | null }>(sql`
    SELECT target_kind AS targetKind, target_id AS targetId, aliases,
           identity, wants, party_knows AS partyKnows
    FROM entity_briefings WHERE campaign_id = ${campaignId}
  `);
  const briefingByTarget = new Map(briefings.map((b) => [`${b.targetKind}:${b.targetId}`, b]));

  let written = 0;

  const entityTables: { table: string; kind: SearchKind }[] = [
    { table: "characters", kind: "character" },
    { table: "locations", kind: "location" },
    { table: "items", kind: "item" },
    { table: "factions", kind: "faction" },
  ];

  for (const { table, kind } of entityTables) {
    const rows = db.all<{ id: string; name: string; description: string | null; sourceText: string | null }>(sql`
      SELECT id, name, description, source_text AS sourceText FROM ${sql.raw(table)}
      WHERE campaign_id = ${campaignId} AND archived = 0
    `);
    for (const row of rows) {
      const b = briefingByTarget.get(`${kind}:${row.id}`);
      // Through the shared helper, not a local join: this rebuild reads the
      // stored briefing, which may hold a field the write path already dropped.
      const fromBriefing = b
        ? briefingIndexText({ ...b, aliases: parseAliases(b.aliases) }, `${kind} ${row.id}`)
        : null;
      const body = fromBriefing ? fromBriefing.body : entityIndexBody(row);
      const aliases = fromBriefing ? fromBriefing.aliases : "";
      writeRow(db, campaignId, kind, row.id, row.name, aliases, body);
      written++;
    }
  }

  const threads = db.all<{ id: string; title: string; stakes: string | null }>(sql`
    SELECT id, title, stakes FROM threads WHERE campaign_id = ${campaignId} AND archived = 0
  `);
  for (const t of threads) {
    writeRow(db, campaignId, "thread", t.id, t.title, "", t.stakes ?? "");
    written++;
  }

  const clocks = db.all<{ id: string; name: string }>(sql`
    SELECT id, name FROM clocks WHERE campaign_id = ${campaignId} AND archived = 0
  `);
  for (const c of clocks) {
    writeRow(db, campaignId, "clock", c.id, c.name, "", "");
    written++;
  }

  return written;
}
