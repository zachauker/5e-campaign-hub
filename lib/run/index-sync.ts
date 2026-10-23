import { sql } from "drizzle-orm";
import type { StateDb } from "@/lib/state/types";
import { entityIndexBody, indexEntity, removeFromIndex, type SearchKind } from "./search-index";
import { BRIEFING_TARGET_KINDS, type BriefingTargetKind } from "./briefings";

const TABLE_FOR_KIND: Record<BriefingTargetKind, string> = {
  character: "characters",
  location: "locations",
  item: "items",
  faction: "factions",
};

/**
 * Re-index one entity after a write. Deliberately re-reads the row rather than
 * taking the written values as arguments: sync and manual-edit paths write
 * different subsets of columns, and a caller that forgot to pass the new name
 * would silently leave a stale index entry.
 *
 * Archived and deleted rows are removed rather than skipped, so a hidden entity
 * cannot keep answering searches.
 */
export async function syncEntityToIndex(
  db: StateDb,
  campaignId: string,
  kind: string,
  targetId: string,
): Promise<void> {
  if (!(BRIEFING_TARGET_KINDS as string[]).includes(kind)) return;
  const table = TABLE_FOR_KIND[kind as BriefingTargetKind];

  const row = db.all<{ name: string; description: string | null; sourceText: string | null; archived: number }>(sql`
    SELECT name, description, source_text AS sourceText, archived FROM ${sql.raw(table)}
    WHERE id = ${targetId} AND campaign_id = ${campaignId}
  `)[0];

  if (!row || row.archived) {
    await removeFromIndex(db, { campaignId, kind: kind as SearchKind, targetId });
    return;
  }
  await indexEntity(db, {
    campaignId,
    kind: kind as SearchKind,
    targetId,
    name: row.name,
    body: entityIndexBody(row),
  });
}

export async function syncThreadToIndex(db: StateDb, campaignId: string, threadId: string): Promise<void> {
  const row = db.all<{ title: string; stakes: string | null; archived: number }>(sql`
    SELECT title, stakes, archived FROM threads WHERE id = ${threadId} AND campaign_id = ${campaignId}
  `)[0];
  if (!row || row.archived) {
    await removeFromIndex(db, { campaignId, kind: "thread", targetId: threadId });
    return;
  }
  await indexEntity(db, {
    campaignId, kind: "thread", targetId: threadId, name: row.title, body: row.stakes,
  });
}

export async function syncClockToIndex(db: StateDb, campaignId: string, clockId: string): Promise<void> {
  const row = db.all<{ name: string; archived: number }>(sql`
    SELECT name, archived FROM clocks WHERE id = ${clockId} AND campaign_id = ${campaignId}
  `)[0];
  if (!row || row.archived) {
    await removeFromIndex(db, { campaignId, kind: "clock", targetId: clockId });
    return;
  }
  await indexEntity(db, { campaignId, kind: "clock", targetId: clockId, name: row.name, body: null });
}
