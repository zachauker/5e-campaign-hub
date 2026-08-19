import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { characters, items, factions, locations, sessionNotes } from "@/lib/db/schema";
import type { NotionRow } from "./client";
import { mapFactionRow, mapCharacterRow, mapItemRow, mapLocationRow, mapSessionNoteRow, type MappedEntity } from "./map";
import { reconcileEntity } from "./reconcile";
import {
  makeEntityRepo, linkCharacterFactionsByName, linkCharacterItemsByPageId,
  linkCharacterLocationsByPageId, linkSessionNoteLocationsByName,
} from "./repos";
import { syncEntityToIndex } from "@/lib/run/index-sync";
import type { SearchKind } from "@/lib/run/search-index";
import type { StateDb } from "@/lib/state/types";

type Db = BetterSQLite3Database<Record<string, unknown>>;
export type EntityType = "characters" | "items" | "factions" | "locations" | "sessionNotes";

// sessionNotes has no entry: it isn't a search-index kind (see SearchKind in
// lib/run/search-index.ts), so its rows are never sent to syncEntityToIndex.
const SEARCH_KIND_FOR_TYPE: Partial<Record<EntityType, SearchKind>> = {
  characters: "character",
  items: "item",
  factions: "faction",
  locations: "location",
};

export interface SourceConfig {
  entityType: EntityType;
  dataSourceId: string;
}

export interface SourceSummary {
  created: number; adopted: number; updated: number; unchanged: number; archived: number;
  warnings: string[]; error?: string;
}
export type SyncSummary = Record<EntityType, SourceSummary>;

const TABLES = { characters, items, factions, locations, sessionNotes } as const;
const MAPPERS: Record<EntityType, (row: NotionRow) => MappedEntity> = {
  factions: mapFactionRow, characters: mapCharacterRow, items: mapItemRow,
  locations: mapLocationRow, sessionNotes: mapSessionNoteRow,
};
// Dependency order: link targets before linkers. sessionNotes AFTER locations
// so Setting(s)->location name matching resolves.
const ORDER: EntityType[] = ["factions", "characters", "locations", "items", "sessionNotes"];

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
    characters: emptySummary(), items: emptySummary(), factions: emptySummary(),
    locations: emptySummary(), sessionNotes: emptySummary(),
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

      const searchKind = SEARCH_KIND_FOR_TYPE[type];
      if (searchKind) {
        try {
          // `db` here is typed loosely (Record<string, unknown> schema) to stay
          // agnostic of the concrete schema shape; index-sync needs the fully
          // typed StateDb. Same cast pattern as lib/notion/run-sync.ts.
          await syncEntityToIndex(db as unknown as StateDb, campaignId, searchKind, result.id);
        } catch (err) {
          // A failed index write must never fail the sync that caused it — the
          // index is a derived convenience and Settings can rebuild it.
          console.warn("[search-index] sync failed:", (err as Error).message);
        }
      }

      if (type === "characters" && mapped.affiliations?.length) {
        linkCharacterFactionsByName(db, campaignId, result.id, mapped.affiliations);
      }
      if (type === "items" && mapped.heldByPageIds?.length) {
        linkCharacterItemsByPageId(db, result.id, mapped.heldByPageIds);
      }
      if (type === "locations" && mapped.notableNpcPageIds?.length) {
        linkCharacterLocationsByPageId(db, result.id, mapped.notableNpcPageIds);
      }
      if (type === "sessionNotes" && mapped.settingNames?.length) {
        const unmatched = linkSessionNoteLocationsByName(db, campaignId, result.id, mapped.settingNames);
        for (const name of unmatched) {
          if (!s.warnings.includes(`No hub location matches setting "${name}"`)) {
            s.warnings.push(`No hub location matches setting "${name}"`);
          }
        }
      }
    }

    // Guard against a transiently-empty query (Notion outage, a stale/wrong
    // dataSourceId, or every row lacking a title) mass-archiving the whole
    // source. With nothing verifiably seen we can't trust the result as
    // "everything is gone", so we leave existing rows visible and warn instead.
    if (seenPageIds.length === 0) {
      if (rows.length === 0) {
        s.warnings.push("Notion returned no rows; skipped archiving to avoid a mass wipe.");
      } else {
        s.warnings.push("No usable rows (all missing a name); skipped archiving to avoid a mass wipe.");
      }
    } else {
      s.archived += archiveUnseen(db, table, campaignId, seenPageIds);
    }
  }

  return summary;
}

/** Archive (never delete) rows that have a notionPageId but weren't in this sync. */
function archiveUnseen(db: Db, table: typeof characters | typeof items | typeof factions | typeof locations | typeof sessionNotes, campaignId: string, seenPageIds: string[]): number {
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
