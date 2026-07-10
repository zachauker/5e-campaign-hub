import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notionSources, settings } from "@/lib/db/schema";
import { resolveDataSourceId, queryDataSource, extractNotionDatabaseId } from "@/lib/notion/client";
import { syncCampaign, type SourceConfig } from "@/lib/notion/sync";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { campaignId?: string };
  const campaignId = body.campaignId;
  if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });

  const tokenRow = await db.query.settings.findFirst({ where: eq(settings.key, "notion_token") });
  if (!tokenRow?.value) {
    return NextResponse.json({ error: "Add a Notion integration token in Settings first" }, { status: 400 });
  }
  const token = tokenRow.value;

  const rows = await db.select().from(notionSources).where(eq(notionSources.campaignId, campaignId));
  if (rows.length === 0) {
    return NextResponse.json({ error: "No Notion databases configured for this campaign" }, { status: 400 });
  }

  const config: SourceConfig[] = [];
  const resolveErrors: Record<string, string> = {};
  for (const row of rows) {
    try {
      const dbId = extractNotionDatabaseId(row.databaseUrl);
      if (!dbId) throw new Error("Invalid database URL");
      const dataSourceId = row.dataSourceId ?? (await resolveDataSourceId(dbId, token));
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
    queryRows: (dataSourceId) => queryDataSource(dataSourceId, token),
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

  return NextResponse.json({ summary });
}

function friendlyNotionError(err: unknown): string {
  const msg = err instanceof Error ? err.message : "Sync failed";
  return /could not find|restricted|unauthorized|not shared/i.test(msg)
    ? "This database isn't shared with the integration (or doesn't exist)"
    : msg;
}
