import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-helpers";
import { syncCampaign, type SourceConfig } from "./sync";
import { characters, factions, items, characterFactions, locations, characterLocations } from "@/lib/db/schema";
import type { NotionRow } from "./client";

const page = (id: string, properties: Record<string, unknown>): NotionRow => ({
  id, url: `https://www.notion.so/${id}`, properties,
});
const title = (t: string) => ({ type: "title", title: [{ plain_text: t }] });
const sel = (n: string) => ({ type: "select", select: { name: n } });
const chk = (b: boolean) => ({ type: "checkbox", checkbox: b });

function fixtures(): Record<string, NotionRow[]> {
  return {
    fac: [page("fac1", { Name: title("Children of Malice"), Active: chk(true), Type: sel("Criminal") })],
    chr: [page("chr1", {
      Name: title("Shale"), Type: sel("Player"), Active: chk(true),
      Affiliations: { type: "multi_select", multi_select: [{ name: "Children of Malice" }] },
    })],
    itm: [page("itm1", { Name: title("Fragment"), Description: { type: "rich_text", rich_text: [{ plain_text: "A shard." }] } })],
  };
}

function sources(f: Record<string, NotionRow[]>): { config: SourceConfig[]; queryRows: (id: string) => Promise<NotionRow[]> } {
  const map: Record<string, NotionRow[]> = { dsF: f.fac, dsC: f.chr, dsI: f.itm };
  return {
    config: [
      { entityType: "factions", dataSourceId: "dsF" },
      { entityType: "characters", dataSourceId: "dsC" },
      { entityType: "items", dataSourceId: "dsI" },
    ],
    queryRows: async (id) => map[id] ?? [],
  };
}

describe("syncCampaign", () => {
  it("creates entities and links across sources in dependency order", async () => {
    const { db, campaignId } = createTestDb();
    const { config, queryRows } = sources(fixtures());
    const summary = await syncCampaign({ db, campaignId, sources: config, queryRows });

    expect(summary.factions.created).toBe(1);
    expect(summary.characters.created).toBe(1);
    expect(summary.items.created).toBe(1);

    const chr = db.select().from(characters).where(eq(characters.campaignId, campaignId)).get()!;
    const links = db.select().from(characterFactions).where(eq(characterFactions.characterId, chr.id)).all();
    expect(links).toHaveLength(1);
    expect(db.select().from(items).where(eq(items.campaignId, campaignId)).get()!.description).toBe("A shard.");
  });

  it("is idempotent — a second run changes nothing", async () => {
    const { db, campaignId } = createTestDb();
    const { config, queryRows } = sources(fixtures());
    await syncCampaign({ db, campaignId, sources: config, queryRows });
    const second = await syncCampaign({ db, campaignId, sources: config, queryRows });
    expect(second.characters).toMatchObject({ created: 0, updated: 0, adopted: 0, unchanged: 1 });
  });

  it("archives an entity whose row disappears, never deletes it", async () => {
    const { db, campaignId } = createTestDb();
    const f = fixtures();
    const first = sources(f);
    await syncCampaign({ db, campaignId, sources: first.config, queryRows: first.queryRows });

    const empty = sources({ fac: [], chr: [], itm: [] });
    const summary = await syncCampaign({ db, campaignId, sources: empty.config, queryRows: empty.queryRows });

    expect(summary.factions.archived).toBe(1);
    const fac = db.select().from(factions).where(eq(factions.campaignId, campaignId)).get()!;
    expect(Boolean(fac.archived)).toBe(true);
  });

  it("records a per-source error without aborting the others", async () => {
    const { db, campaignId } = createTestDb();
    const { config } = sources(fixtures());
    const summary = await syncCampaign({
      db, campaignId, sources: config,
      queryRows: async (id) => { if (id === "dsC") throw new Error("not shared"); return id === "dsF" ? fixtures().fac : []; },
    });
    expect(summary.characters.error).toContain("not shared");
    expect(summary.factions.created).toBe(1);
  });
});

describe("syncCampaign — locations", () => {
  it("adopts a world-seeded location by name without clobbering type, and links Notable NPCs", async () => {
    const { db, campaignId } = createTestDb();
    const now = new Date();
    const seededId = "seed-druvenlode";
    db.insert(locations).values({
      id: seededId, campaignId, name: "Druvenlode",
      description: "City · Wildemount", type: "city", createdAt: now, updatedAt: now,
    } as never).run();

    const rows: Record<string, NotionRow[]> = {
      dsC: [page("chrBeilar", { Name: title("Beilar"), Type: sel("NPC"), Active: chk(true) })],
      dsL: [page("locDruv", {
        Name: title("Druvenlode"),
        Description: { type: "rich_text", rich_text: [{ plain_text: "A hard-bitten mining town." }] },
        Type: sel("City"),
        "Notable NPCs": { type: "relation", relation: [{ id: "chrBeilar" }] },
      })],
    };
    const summary = await syncCampaign({
      db, campaignId,
      sources: [
        { entityType: "characters", dataSourceId: "dsC" },
        { entityType: "locations", dataSourceId: "dsL" },
      ],
      queryRows: async (id) => rows[id] ?? [],
    });

    expect(summary.locations.adopted).toBe(1);
    const locs = db.select().from(locations).where(eq(locations.campaignId, campaignId)).all();
    expect(locs).toHaveLength(1);
    const loc = locs[0];
    expect(loc.id).toBe(seededId);
    expect(loc.type).toBe("city");
    expect(loc.description).toBe("A hard-bitten mining town.");
    expect(loc.notionPageId).toBeTruthy();

    const chr = db.select().from(characters).where(eq(characters.campaignId, campaignId)).get()!;
    const links = db.select().from(characterLocations)
      .where(eq(characterLocations.locationId, loc.id)).all();
    expect(links).toHaveLength(1);
    expect(links[0].characterId).toBe(chr.id);
  });
});
