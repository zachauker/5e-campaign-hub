import { describe, it, expect } from "vitest";
import { createTestDb } from "@/lib/notion/test-helpers";
import { characters, factions, locations, items, characterFactions, characterLocations, characterItems } from "@/lib/db/schema";
import { searchEntities, listEntities, getEntity, getRelationships } from "./read-tools";

function seedChar(db: ReturnType<typeof createTestDb>["db"], campaignId: string, over: Partial<typeof characters.$inferInsert> & { id: string; name: string }) {
  const now = new Date();
  db.insert(characters).values({
    campaignId, type: "npc", createdAt: now, updatedAt: now, ...over,
  }).run();
}

describe("searchEntities", () => {
  it("matches by name across kinds, scoped to campaign, excludes archived", () => {
    const { db, campaignId } = createTestDb();
    seedChar(db, campaignId, { id: "c1", name: "Lord Verin" });
    seedChar(db, campaignId, { id: "c2", name: "Sela", archived: true });
    db.insert(factions).values({ id: "f1", campaignId, name: "Clovis Concord", createdAt: new Date(), updatedAt: new Date() }).run();

    const hits = searchEntities(db, campaignId, { query: "verin" });
    expect(hits.map((h) => h.id)).toEqual(["c1"]);
    expect(hits[0]).toMatchObject({ kind: "character", name: "Lord Verin" });

    expect(searchEntities(db, campaignId, { query: "concord" })[0]).toMatchObject({ kind: "faction", id: "f1" });
    expect(searchEntities(db, campaignId, { query: "sela" })).toEqual([]); // archived excluded
    expect(searchEntities(db, "other-campaign", { query: "verin" })).toEqual([]); // scoped
  });
});

describe("listEntities", () => {
  it("lists a kind filtered by type, excluding archived", () => {
    const { db, campaignId } = createTestDb();
    seedChar(db, campaignId, { id: "c1", name: "Fjord", type: "pc" });
    seedChar(db, campaignId, { id: "c2", name: "Guard", type: "npc" });
    seedChar(db, campaignId, { id: "c3", name: "Ghost", type: "pc", archived: true });

    const pcs = listEntities(db, campaignId, { kind: "character", type: "pc" });
    expect(pcs.map((e) => e.id)).toEqual(["c1"]); // c3 archived excluded
  });
});

describe("getEntity + getRelationships", () => {
  it("returns full record and reverse faction membership", () => {
    const { db, campaignId } = createTestDb();
    seedChar(db, campaignId, { id: "c1", name: "Fjord", description: "A half-orc warlock" });
    db.insert(factions).values({ id: "f1", campaignId, name: "Concord", createdAt: new Date(), updatedAt: new Date() }).run();
    db.insert(characterFactions).values({ characterId: "c1", factionId: "f1" }).run();

    const ent = getEntity(db, campaignId, { kind: "character", id: "c1" });
    expect(ent).toMatchObject({ name: "Fjord", description: "A half-orc warlock" });

    const rels = getRelationships(db, campaignId, { kind: "faction", id: "f1" });
    expect(rels.characters.map((c) => c.id)).toEqual(["c1"]);
  });

  it("resolves reverse membership for location and item branches", () => {
    const { db, campaignId } = createTestDb();
    seedChar(db, campaignId, { id: "c1", name: "Fjord" });
    db.insert(locations).values({ id: "l1", campaignId, name: "Nicodranas", createdAt: new Date(), updatedAt: new Date() }).run();
    db.insert(items).values({ id: "i1", campaignId, name: "Star Razor", createdAt: new Date(), updatedAt: new Date() }).run();
    db.insert(characterLocations).values({ characterId: "c1", locationId: "l1" }).run();
    db.insert(characterItems).values({ characterId: "c1", itemId: "i1" }).run();

    expect(getRelationships(db, campaignId, { kind: "location", id: "l1" }).characters.map((c) => c.id)).toEqual(["c1"]);
    expect(getRelationships(db, campaignId, { kind: "item", id: "i1" }).characters.map((c) => c.id)).toEqual(["c1"]);
  });

  it("excludes archived linked characters", () => {
    const { db, campaignId } = createTestDb();
    seedChar(db, campaignId, { id: "c1", name: "Fjord" });
    seedChar(db, campaignId, { id: "c2", name: "Wraith", archived: true });
    db.insert(factions).values({ id: "f1", campaignId, name: "Concord", createdAt: new Date(), updatedAt: new Date() }).run();
    db.insert(characterFactions).values({ characterId: "c1", factionId: "f1" }).run();
    db.insert(characterFactions).values({ characterId: "c2", factionId: "f1" }).run();

    const rels = getRelationships(db, campaignId, { kind: "faction", id: "f1" });
    expect(rels.characters.map((c) => c.id)).toEqual(["c1"]); // c2 archived excluded
  });

  it("returns no characters for an entity from another campaign", () => {
    const { db, campaignId } = createTestDb();
    seedChar(db, campaignId, { id: "c1", name: "Fjord" });
    db.insert(factions).values({ id: "f1", campaignId, name: "Concord", createdAt: new Date(), updatedAt: new Date() }).run();
    db.insert(characterFactions).values({ characterId: "c1", factionId: "f1" }).run();

    expect(getRelationships(db, "other-campaign", { kind: "faction", id: "f1" })).toEqual({ characters: [] });
  });
});
