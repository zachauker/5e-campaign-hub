import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-helpers";
import {
  runCampaignSync,
  listCampaignsWithSources,
  NotionTokenMissingError,
  NoNotionSourcesError,
} from "./run-sync";
import { notionSources, settings, characters } from "@/lib/db/schema";
import type { NotionRow } from "./client";

function seedToken(db: ReturnType<typeof createTestDb>["db"]) {
  db.insert(settings).values({ key: "notion_token", value: "tok_test" }).run();
}

function seedSource(
  db: ReturnType<typeof createTestDb>["db"],
  campaignId: string,
  entityType: "characters",
  dataSourceId: string | null,
) {
  db.insert(notionSources)
    .values({ campaignId, entityType, databaseUrl: "https://www.notion.so/deadbeefdeadbeefdeadbeefdeadbeef", dataSourceId })
    .run();
}

const chrRow = (id: string, name: string): NotionRow => ({
  id,
  url: `https://www.notion.so/${id}`,
  properties: { Name: { type: "title", title: [{ plain_text: name }] }, Type: { type: "select", select: { name: "Player" } } },
});

describe("runCampaignSync", () => {
  it("throws NotionTokenMissingError when no token is configured", async () => {
    const { db, campaignId } = createTestDb();
    seedSource(db, campaignId, "characters", "ds1");
    await expect(runCampaignSync(campaignId, { db })).rejects.toBeInstanceOf(NotionTokenMissingError);
  });

  it("throws NoNotionSourcesError when the campaign has no sources", async () => {
    const { db, campaignId } = createTestDb();
    seedToken(db);
    await expect(runCampaignSync(campaignId, { db })).rejects.toBeInstanceOf(NoNotionSourcesError);
  });

  it("syncs rows, resolves+caches dataSourceId, and writes back lastSyncedAt/lastStatus", async () => {
    const { db, campaignId } = createTestDb();
    seedToken(db);
    seedSource(db, campaignId, "characters", null); // force a resolve

    const summary = await runCampaignSync(campaignId, {
      db,
      notion: {
        resolveDataSourceId: async () => "resolved-ds",
        queryDataSource: async () => [chrRow("chr1", "Shale")],
      },
    });

    expect(summary.characters.created).toBe(1);

    const src = db.select().from(notionSources).where(eq(notionSources.campaignId, campaignId)).get()!;
    expect(src.dataSourceId).toBe("resolved-ds"); // cached
    expect(src.lastSyncedAt).toBeTruthy();
    expect(JSON.parse(src.lastStatus!).created).toBe(1);

    expect(db.select().from(characters).where(eq(characters.campaignId, campaignId)).get()!.name).toBe("Shale");
  });

  it("records a friendly resolve error without throwing", async () => {
    const { db, campaignId } = createTestDb();
    seedToken(db);
    seedSource(db, campaignId, "characters", null);

    const summary = await runCampaignSync(campaignId, {
      db,
      notion: {
        resolveDataSourceId: async () => { throw new Error("Could not find data source"); },
        queryDataSource: async () => [],
      },
    });

    expect(summary.characters.error).toMatch(/isn't shared/i);
  });
});

describe("listCampaignsWithSources", () => {
  it("returns distinct campaign ids that have sources", async () => {
    const { db, campaignId } = createTestDb();
    seedSource(db, campaignId, "characters", "ds1");
    const ids = await listCampaignsWithSources(db);
    expect(ids).toEqual([campaignId]);
  });

  it("returns an empty array when no sources exist", async () => {
    const { db } = createTestDb();
    expect(await listCampaignsWithSources(db)).toEqual([]);
  });
});
