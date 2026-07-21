import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";
import { db as defaultDb } from "@/lib/db";
import { notionSources, settings } from "@/lib/db/schema";
import {
  resolveDataSourceId as defaultResolveDataSourceId,
  queryDataSource as defaultQueryDataSource,
  extractNotionDatabaseId,
  type NotionRow,
} from "./client";
import { syncCampaign, type SourceConfig, type SyncSummary } from "./sync";

type SyncDb = BetterSQLite3Database<typeof schema>;

/** No Notion integration token configured in settings. */
export class NotionTokenMissingError extends Error {
  constructor() {
    super("Add a Notion integration token in Settings first");
    this.name = "NotionTokenMissingError";
  }
}

/** The campaign has no Notion databases configured. */
export class NoNotionSourcesError extends Error {
  constructor() {
    super("No Notion databases configured for this campaign");
    this.name = "NoNotionSourcesError";
  }
}

/** Injectable Notion network calls (real implementations used by default). */
export interface NotionApi {
  resolveDataSourceId: (dbId: string, token: string) => Promise<string>;
  queryDataSource: (dataSourceId: string, token: string) => Promise<NotionRow[]>;
}

export interface RunCampaignSyncOpts {
  db?: SyncDb;
  notion?: NotionApi;
}

function friendlyNotionError(err: unknown): string {
  const msg = err instanceof Error ? err.message : "Sync failed";
  return /could not find|restricted|unauthorized|not shared/i.test(msg)
    ? "This database isn't shared with the integration (or doesn't exist)"
    : msg;
}

/**
 * Runs a full sync for one campaign: loads the token + configured sources,
 * resolves (and caches) each data-source id, runs syncCampaign, and writes back
 * lastSyncedAt / lastStatus per source. Shared by the manual API route and the
 * background scheduler so both behave identically.
 *
 * Throws NotionTokenMissingError / NoNotionSourcesError for the two
 * configuration failures; per-source resolve/query failures are captured in the
 * returned summary instead of throwing.
 */
export async function runCampaignSync(campaignId: string, opts: RunCampaignSyncOpts = {}): Promise<SyncSummary> {
  const db = opts.db ?? (defaultDb as unknown as SyncDb);
  const notion: NotionApi = opts.notion ?? {
    resolveDataSourceId: defaultResolveDataSourceId,
    queryDataSource: defaultQueryDataSource,
  };

  const tokenRow = await db.query.settings.findFirst({ where: eq(settings.key, "notion_token") });
  if (!tokenRow?.value) throw new NotionTokenMissingError();
  const token = tokenRow.value;

  const rows = await db.select().from(notionSources).where(eq(notionSources.campaignId, campaignId));
  if (rows.length === 0) throw new NoNotionSourcesError();

  const config: SourceConfig[] = [];
  const resolveErrors: Record<string, string> = {};
  for (const row of rows) {
    try {
      const dbId = extractNotionDatabaseId(row.databaseUrl);
      if (!dbId) throw new Error("Invalid database URL");
      const dataSourceId = row.dataSourceId ?? (await notion.resolveDataSourceId(dbId, token));
      if (dataSourceId !== row.dataSourceId) {
        await db.update(notionSources).set({ dataSourceId })
          .where(and(eq(notionSources.campaignId, campaignId), eq(notionSources.entityType, row.entityType)));
      }
      config.push({ entityType: row.entityType, dataSourceId });
    } catch (err) {
      resolveErrors[row.entityType] = friendlyNotionError(err);
    }
  }

  const summary = await syncCampaign({
    db: db as never,
    campaignId,
    sources: config,
    queryRows: (dataSourceId) => notion.queryDataSource(dataSourceId, token),
  });

  for (const [type, error] of Object.entries(resolveErrors)) {
    (summary as Record<string, { error?: string }>)[type].error = error;
  }

  const now = new Date();
  for (const row of rows) {
    await db.update(notionSources)
      .set({ lastSyncedAt: now, lastStatus: JSON.stringify(summary[row.entityType]) })
      .where(and(eq(notionSources.campaignId, campaignId), eq(notionSources.entityType, row.entityType)));
  }

  return summary;
}

/** Distinct campaign ids that have at least one Notion source configured. */
export async function listCampaignsWithSources(db: SyncDb = defaultDb as unknown as SyncDb): Promise<string[]> {
  const rows = await db.selectDistinct({ campaignId: notionSources.campaignId }).from(notionSources);
  return rows.map((r) => r.campaignId);
}
