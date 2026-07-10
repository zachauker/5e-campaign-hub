import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { characters, items, factions, locations } from "@/lib/db/schema";
import type { NotionRow } from "./client";
import { mapFactionRow, mapCharacterRow, mapItemRow, mapLocationRow, type MappedEntity } from "./map";
import { reconcileEntity } from "./reconcile";
import {
  makeEntityRepo, linkCharacterFactionsByName, linkCharacterItemsByPageId, linkCharacterLocationsByPageId,
} from "./repos";

type Db = BetterSQLite3Database<Record<string, unknown>>;
export type EntityType = "characters" | "items" | "factions" | "locations";

export interface SourceConfig {
  entityType: EntityType;
  dataSourceId: string;
}

export interface SourceSummary {
  created: number; adopted: number; updated: number; unchanged: number; archived: number;
  warnings: string[]; error?: string;
}
export type SyncSummary = Record<EntityType, SourceSummary>;

const TABLES = { characters, items, factions, locations } as const;
const MAPPERS: Record<EntityType, (row: NotionRow) => MappedEntity> = {
  factions: mapFactionRow, characters: mapCharacterRow, items: mapItemRow, locations: mapLocationRow,
};
// Dependency order: link targets (factions, characters) before linkers.
const ORDER: EntityType[] = ["factions", "characters", "locations", "items"];

function emptySummary(): SourceSummary {
  return { created: 0, adopted: 0, updated: 0, unchanged: 0, archived: 0, warnings: [] };
}

export async function syncCampaign(opts: {
  db: Db;
  campaignId: string;
  sources: SourceConfig[];
  queryRows: (dataSourceId: string) => Promise<NotionRow[]>;
}): Promise<SyncSummary> {
  const { db, campaignId, sources, queryRows } = opts;
  const summary: SyncSummary = {
    characters: emptySummary(), items: emptySummary(), factions: emptySummary(), locations: emptySummary(),
  };

  for (const type of ORDER) {
    const source = sources.find((s) => s.entityType === type);
    if (!source) continue;
    const s = summary[type];
    const table = TABLES[type];
    const repo = makeEntityRepo(db, table, campaignId);

    let rows: NotionRow[];
    try {
      rows = await queryRows(source.dataSourceId);
    } catch (err) {
      s.error = err instanceof Error ? err.message : "Failed to query Notion";
      continue;
    }

    const seenPageIds: string[] = [];
    for (const row of rows) {
      const mapped = MAPPERS[type](row);
      if (!mapped.name) { s.warnings.push(`Skipped a row with no name (${row.id})`); continue; }
      seenPageIds.push(mapped.notionPageId);

      const result = reconcileEntity(repo, mapped);
      s[result.action] += 1;

      if (type === "characters" && mapped.affiliations?.length) {
        linkCharacterFactionsByName(db, campaignId, result.id, mapped.affiliations);
      }
      if (type === "items" && mapped.heldByPageIds?.length) {
        linkCharacterItemsByPageId(db, result.id, mapped.heldByPageIds);
      }
      if (type === "locations" && mapped.notableNpcPageIds?.length) {
        linkCharacterLocationsByPageId(db, result.id, mapped.notableNpcPageIds);
      }
    }

    s.archived += archiveUnseen(db, table, campaignId, seenPageIds);
  }

  return summary;
}

/** Archive (never delete) rows that have a notionPageId but weren't in this sync. */
function archiveUnseen(db: Db, table: typeof characters | typeof items | typeof factions | typeof locations, campaignId: string, seenPageIds: string[]): number {
  const t = table as unknown as typeof characters;
  const now = new Date();
  const conditions = [
    eq(t.campaignId, campaignId),
    sql`${t.notionPageId} IS NOT NULL`,
    eq(t.archived, false),
  ];
  if (seenPageIds.length) conditions.push(notInArray(t.notionPageId, seenPageIds));
  const stale = db.select().from(t).where(and(...conditions)).all();
  if (stale.length === 0) return 0;
  db.update(t).set({ archived: true, updatedAt: now }).where(inArray(t.id, stale.map((r) => r.id))).run();
  return stale.length;
}
