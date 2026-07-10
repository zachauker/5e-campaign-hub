import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notionSources } from "@/lib/db/schema";
import { extractNotionDatabaseId } from "@/lib/notion/client";

const TYPES = ["characters", "items", "factions", "locations"] as const;
type EntityType = (typeof TYPES)[number];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  if (!campaignId) {
    return NextResponse.json({ error: "campaignId required" }, { status: 400 });
  }

  const rows = await db.select().from(notionSources).where(eq(notionSources.campaignId, campaignId));
  const byType: Record<string, unknown> = {};
  for (const r of rows) {
    byType[r.entityType] = { databaseUrl: r.databaseUrl, lastSyncedAt: r.lastSyncedAt, lastStatus: r.lastStatus };
  }
  return NextResponse.json({ sources: byType });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as { campaignId?: string; entityType?: string; databaseUrl?: string };
  const { campaignId, entityType, databaseUrl } = body;
  if (!campaignId || !entityType || !TYPES.includes(entityType as EntityType)) {
    return NextResponse.json({ error: "campaignId and a valid entityType are required" }, { status: 400 });
  }
  const url = (databaseUrl ?? "").trim();

  // Empty url clears the source.
  if (!url) {
    await db
      .delete(notionSources)
      .where(and(eq(notionSources.campaignId, campaignId), eq(notionSources.entityType, entityType as EntityType)));
    return NextResponse.json({ ok: true });
  }

  if (!extractNotionDatabaseId(url)) {
    return NextResponse.json({ error: "That doesn't look like a Notion database URL" }, { status: 400 });
  }

  await db
    .insert(notionSources)
    .values({ campaignId, entityType: entityType as EntityType, databaseUrl: url })
    .onConflictDoUpdate({
      target: [notionSources.campaignId, notionSources.entityType],
      set: { databaseUrl: url },
    });
  return NextResponse.json({ ok: true });
}
