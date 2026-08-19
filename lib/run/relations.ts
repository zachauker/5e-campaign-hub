import { sql } from "drizzle-orm";
import type { StateDb } from "@/lib/state/types";
import { BRIEFING_TARGET_KINDS, type BriefingTargetKind } from "./briefings";

const TABLE_FOR_KIND: Record<BriefingTargetKind, string> = {
  character: "characters",
  location: "locations",
  item: "items",
  faction: "factions",
};

export interface RelatedEntity {
  kind: BriefingTargetKind;
  targetId: string;
  name: string;
}

/**
 * Entities that share an open thread with this one. Shared stakes is the
 * relationship a DM actually reaches for mid-scene — "who else is tangled up in
 * this" — rather than any structural link between the entity rows.
 *
 * thread_links carries no FK, so a target id may dangle; a link whose row has
 * gone is dropped rather than surfaced as a nameless entry.
 */
export async function relatedEntities(
  db: StateDb,
  campaignId: string,
  kind: string,
  targetId: string,
): Promise<RelatedEntity[]> {
  // Validated against the union before it reaches sql.raw below: the table
  // name is interpolated, so an unchecked value here would be an injection
  // point. Mirrors briefing-inputs.ts's assertKind.
  if (!(BRIEFING_TARGET_KINDS as string[]).includes(kind)) return [];

  const links = db.all<{ targetKind: string; targetId: string }>(sql`
    SELECT DISTINCT other.target_kind AS targetKind, other.target_id AS targetId
    FROM thread_links mine
    JOIN threads t ON t.id = mine.thread_id
    JOIN thread_links other ON other.thread_id = mine.thread_id
    WHERE mine.target_kind = ${kind} AND mine.target_id = ${targetId}
      AND t.campaign_id = ${campaignId} AND t.archived = 0 AND t.status = 'open'
      AND NOT (other.target_kind = ${kind} AND other.target_id = ${targetId})
      AND other.target_kind IN ('character', 'location', 'item', 'faction')
  `);

  const out: RelatedEntity[] = [];
  for (const link of links) {
    const table = TABLE_FOR_KIND[link.targetKind as BriefingTargetKind];
    const row = db.all<{ name: string }>(sql`
      SELECT name FROM ${sql.raw(table)}
      WHERE id = ${link.targetId} AND campaign_id = ${campaignId} AND archived = 0
    `)[0];
    if (row) {
      out.push({ kind: link.targetKind as BriefingTargetKind, targetId: link.targetId, name: row.name });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
