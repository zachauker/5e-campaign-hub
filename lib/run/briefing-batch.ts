import { sql } from "drizzle-orm";
import type { StateDb } from "@/lib/state/types";
import { getBriefing, type BriefingTargetKind } from "./briefings";
import { isStale } from "./briefing-build";

export type BuildScope = "session" | "all";

export interface BuildTarget {
  targetKind: BriefingTargetKind;
  targetId: string;
}

const ENTITY_TABLES: { table: string; kind: BriefingTargetKind }[] = [
  { table: "characters", kind: "character" },
  { table: "locations", kind: "location" },
  { table: "items", kind: "item" },
  { table: "factions", kind: "faction" },
];

/**
 * Decide what a batch build should cover.
 *
 * "session" walks entities linked to open threads — the ones likely to come up
 * at the next table. "all" walks the campaign. Both skip anything whose
 * briefing is already current (a `partial` one counts as not current, see
 * `isStale`), so a repeated build costs nothing and a run that
 * dies partway can simply be started again.
 */
export async function selectBuildTargets(
  db: StateDb,
  campaignId: string,
  scope: BuildScope,
): Promise<BuildTarget[]> {
  const candidates: BuildTarget[] = [];

  if (scope === "session") {
    const rows = db.all<{ targetKind: string; targetId: string }>(sql`
      SELECT DISTINCT tl.target_kind AS targetKind, tl.target_id AS targetId
      FROM thread_links tl
      JOIN threads t ON t.id = tl.thread_id
      WHERE t.campaign_id = ${campaignId} AND t.archived = 0 AND t.status = 'open'
        AND tl.target_kind IN ('character', 'location', 'item', 'faction')
      ORDER BY tl.target_kind, tl.target_id
    `);
    candidates.push(...rows.map((r) => ({ targetKind: r.targetKind as BriefingTargetKind, targetId: r.targetId })));
  } else {
    for (const { table, kind } of ENTITY_TABLES) {
      const rows = db.all<{ id: string }>(sql`
        SELECT id FROM ${sql.raw(table)}
        WHERE campaign_id = ${campaignId} AND archived = 0
        ORDER BY name
      `);
      candidates.push(...rows.map((r) => ({ targetKind: kind, targetId: r.id })));
    }
  }

  const targets: BuildTarget[] = [];
  for (const candidate of candidates) {
    const existing = await getBriefing(db, campaignId, candidate.targetKind, candidate.targetId);
    if (!existing || (await isStale(db, existing))) targets.push(candidate);
  }
  return targets;
}
