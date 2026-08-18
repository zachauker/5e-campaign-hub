import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/lib/notion/test-helpers";
import { indexEntity, indexBriefing, removeFromIndex, searchIndex } from "./search-index";

function seedCharacter(db: ReturnType<typeof createTestDb>["db"], campaignId: string, id: string, name: string, description: string | null) {
  db.run(sql`
    INSERT INTO characters (id, campaign_id, name, type, description, archived, created_at, updated_at)
    VALUES (${id}, ${campaignId}, ${name}, 'npc', ${description}, 0, 1, 1)
  `);
}

describe("indexEntity", () => {
  it("makes an entity findable with no briefing present", async () => {
    const { db, campaignId } = createTestDb();
    seedCharacter(db, campaignId, "c1", "Garrick Veldros", "A broker of favours.");
    await indexEntity(db, { campaignId, kind: "character", targetId: "c1", name: "Garrick Veldros", body: "A broker of favours." });

    const hits = await searchIndex(db, { campaignId, q: "garr" });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: "character", targetId: "c1", name: "Garrick Veldros" });
  });

  it("replaces the row rather than duplicating it on re-index", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId, kind: "character", targetId: "c1", name: "Garrick", body: null });
    await indexEntity(db, { campaignId, kind: "character", targetId: "c1", name: "Garrick Veldros", body: null });
    const hits = await searchIndex(db, { campaignId, q: "garrick" });
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe("Garrick Veldros");
  });
});

describe("indexBriefing", () => {
  it("enriches an existing row with aliases and briefing body", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId, kind: "character", targetId: "c1", name: "Garrick Veldros", body: "A broker." });
    await indexBriefing(db, {
      campaignId, kind: "character", targetId: "c1",
      aliases: ["the mask guy"],
      identity: "A broker of favours in Druvenlode.",
      wants: "Leverage over the Assembly.",
      partyKnows: "That he sold them a forged writ.",
    });

    const byAlias = await searchIndex(db, { campaignId, q: "mask guy" });
    expect(byAlias.map((h) => h.targetId)).toEqual(["c1"]);
    const byWant = await searchIndex(db, { campaignId, q: "assembly" });
    expect(byWant.map((h) => h.targetId)).toEqual(["c1"]);
  });

  it("never indexes the secret field", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId, kind: "character", targetId: "c1", name: "Garrick", body: null });
    await indexBriefing(db, {
      campaignId, kind: "character", targetId: "c1",
      aliases: [], identity: null, wants: null, partyKnows: null,
      secret: "He is the Assembly's informant.",
    });
    expect(await searchIndex(db, { campaignId, q: "informant" })).toEqual([]);
  });
});

describe("searchIndex", () => {
  it("ranks exact name above alias above body", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId, kind: "character", targetId: "body", name: "Pelara Voss", body: null });
    await indexBriefing(db, { campaignId, kind: "character", targetId: "body", aliases: [], identity: "Sworn enemy of Mereth.", wants: null, partyKnows: null });
    await indexEntity(db, { campaignId, kind: "character", targetId: "alias", name: "Elfryn Voss", body: null });
    await indexBriefing(db, { campaignId, kind: "character", targetId: "alias", aliases: ["Mereth"], identity: null, wants: null, partyKnows: null });
    await indexEntity(db, { campaignId, kind: "character", targetId: "exact", name: "Mereth", body: null });

    const hits = await searchIndex(db, { campaignId, q: "mereth" });
    expect(hits.map((h) => h.targetId)).toEqual(["exact", "alias", "body"]);
  });

  it("scopes results to the campaign", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId, kind: "character", targetId: "mine", name: "Mereth Kain", body: null });
    await indexEntity(db, { campaignId: "other-campaign", kind: "character", targetId: "theirs", name: "Mereth Kain", body: null });
    const hits = await searchIndex(db, { campaignId, q: "mereth" });
    expect(hits.map((h) => h.targetId)).toEqual(["mine"]);
  });

  it("filters by kind when asked", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId, kind: "character", targetId: "c1", name: "Druvenlode Watch", body: null });
    await indexEntity(db, { campaignId, kind: "location", targetId: "l1", name: "Druvenlode", body: null });
    const hits = await searchIndex(db, { campaignId, q: "druvenlode", kinds: ["location"] });
    expect(hits.map((h) => h.targetId)).toEqual(["l1"]);
  });

  it("returns no results for an unusable query instead of throwing", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId, kind: "character", targetId: "c1", name: "Mereth", body: null });
    expect(await searchIndex(db, { campaignId, q: '"""' })).toEqual([]);
  });

  // A DM reading "Al'Jinn" off their own screen will often type it without the
  // punctuation. FTS tokenises the stored name as "al" + "jinn", so the single
  // token "aljinn" prefix-matches neither and the DM gets silence.
  it("finds a name typed without its punctuation", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId, kind: "character", targetId: "c1", name: "Al'Jinn", body: null });
    expect((await searchIndex(db, { campaignId, q: "aljinn" })).map((h) => h.targetId)).toEqual(["c1"]);
  });

  it("finds a two-word name typed as one word", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId, kind: "character", targetId: "c1", name: "Mereth Kain", body: null });
    expect((await searchIndex(db, { campaignId, q: "merethkain" })).map((h) => h.targetId)).toEqual(["c1"]);
  });

  it("prefers the FTS result and does not fall back when FTS already matched", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId, kind: "character", targetId: "exact", name: "Mereth", body: null });
    await indexEntity(db, { campaignId, kind: "character", targetId: "other", name: "Merethkain Hall", body: null });
    expect((await searchIndex(db, { campaignId, q: "mereth" })).map((h) => h.targetId)).toEqual(["exact", "other"]);
  });

  it("keeps the flattened fallback inside the campaign", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId: "other-campaign", kind: "character", targetId: "theirs", name: "Al'Jinn", body: null });
    expect(await searchIndex(db, { campaignId, q: "aljinn" })).toEqual([]);
  });
});

describe("removeFromIndex", () => {
  it("drops the row", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId, kind: "character", targetId: "c1", name: "Mereth", body: null });
    await removeFromIndex(db, { campaignId, kind: "character", targetId: "c1" });
    expect(await searchIndex(db, { campaignId, q: "mereth" })).toEqual([]);
  });
});
