import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "./test-helpers";
import { makeEntityRepo, linkCharacterFactionsByName, linkCharacterItemsByPageId, linkCharacterLocationsByPageId, linkSessionNoteLocationsByName } from "./repos";
import { reconcileEntity } from "./reconcile";
import { characters, factions, items, characterFactions, characterItems, locations, characterLocations, sessionNotes, sessionNoteLocations } from "@/lib/db/schema";
import type { MappedEntity } from "./map";

const m = (over: Partial<MappedEntity> & { name: string; notionPageId: string }): MappedEntity => ({
  notionUrl: `u/${over.notionPageId}`, archived: false, notionProps: [], extra: {}, ...over,
});

describe("makeEntityRepo", () => {
  it("inserts, finds by page id, and updates factions", () => {
    const { db, campaignId } = createTestDb();
    const repo = makeEntityRepo(db, factions, campaignId);

    const r1 = reconcileEntity(repo, m({ name: "Children of Malice", notionPageId: "f1", notionProps: [{ label: "Type", value: "Criminal" }] }));
    expect(r1.action).toBe("created");

    const row = db.select().from(factions).where(eq(factions.id, r1.id)).get()!;
    expect(row.name).toBe("Children of Malice");
    expect(JSON.parse(row.notionProps!)).toEqual([{ label: "Type", value: "Criminal" }]);
    expect(Boolean(row.archived)).toBe(false);

    expect(reconcileEntity(repo, m({ name: "Children of Malice", notionPageId: "f1", notionProps: [{ label: "Type", value: "Criminal" }] })).action).toBe("unchanged");
  });

  it("writes character type + ddb id from extra, leaves description untouched", () => {
    const { db, campaignId } = createTestDb();
    const repo = makeEntityRepo(db, characters, campaignId);
    const r = reconcileEntity(repo, m({ name: "Shale", notionPageId: "c1", extra: { type: "pc", ddbCharacterId: "145821922" } }));
    const row = db.select().from(characters).where(eq(characters.id, r.id)).get()!;
    expect(row.type).toBe("pc");
    expect(row.ddbCharacterId).toBe("145821922");
    expect(row.description).toBeNull();
  });

  it("writes item description from extra (synced)", () => {
    const { db, campaignId } = createTestDb();
    const repo = makeEntityRepo(db, items, campaignId);
    const r = reconcileEntity(repo, m({ name: "Fragment", notionPageId: "i1", extra: { description: "A shard." } }));
    const row = db.select().from(items).where(eq(items.id, r.id)).get()!;
    expect(row.description).toBe("A shard.");
  });
});

describe("link helpers (additive)", () => {
  it("links a character to factions by name and never duplicates", () => {
    const { db, campaignId } = createTestDb();
    const fRepo = makeEntityRepo(db, factions, campaignId);
    const cRepo = makeEntityRepo(db, characters, campaignId);
    const fac = reconcileEntity(fRepo, m({ name: "Children of Malice", notionPageId: "f1" }));
    const chr = reconcileEntity(cRepo, m({ name: "Shale", notionPageId: "c1", extra: { type: "pc" } }));

    linkCharacterFactionsByName(db, campaignId, chr.id, ["children of malice", "Nonexistent"]);
    linkCharacterFactionsByName(db, campaignId, chr.id, ["Children of Malice"]); // re-run

    const links = db.select().from(characterFactions).where(eq(characterFactions.characterId, chr.id)).all();
    expect(links).toHaveLength(1);
    expect(links[0].factionId).toBe(fac.id);
  });

  it("links an item to characters by notion page id", () => {
    const { db, campaignId } = createTestDb();
    const cRepo = makeEntityRepo(db, characters, campaignId);
    const iRepo = makeEntityRepo(db, items, campaignId);
    const chr = reconcileEntity(cRepo, m({ name: "Bartlebee", notionPageId: "cPAGE", extra: { type: "pc" } }));
    const itm = reconcileEntity(iRepo, m({ name: "Fragment", notionPageId: "i1" }));

    linkCharacterItemsByPageId(db, itm.id, ["cPAGE", "unknownPage"]);
    const links = db.select().from(characterItems).where(and(eq(characterItems.itemId, itm.id), eq(characterItems.characterId, chr.id))).all();
    expect(links).toHaveLength(1);
  });
});

describe("linkCharacterLocationsByPageId", () => {
  it("links a location to characters by notion page id, additively", () => {
    const { db, campaignId } = createTestDb();
    const cRepo = makeEntityRepo(db, characters, campaignId);
    const lRepo = makeEntityRepo(db, locations, campaignId);
    const chr = reconcileEntity(cRepo, m({ name: "Beilar", notionPageId: "cPAGE", extra: { type: "npc" } }));
    const loc = reconcileEntity(lRepo, m({ name: "Oreland", notionPageId: "l1" }));

    linkCharacterLocationsByPageId(db, loc.id, ["cPAGE", "unknownPage"]);
    linkCharacterLocationsByPageId(db, loc.id, ["cPAGE"]); // re-run: no duplicate

    const links = db.select().from(characterLocations)
      .where(and(eq(characterLocations.locationId, loc.id), eq(characterLocations.characterId, chr.id))).all();
    expect(links).toHaveLength(1);
  });

  it("creates a new location with default type 'other'", () => {
    const { db, campaignId } = createTestDb();
    const lRepo = makeEntityRepo(db, locations, campaignId);
    const loc = reconcileEntity(lRepo, m({ name: "New Place", notionPageId: "l9" }));
    const row = db.select().from(locations).where(eq(locations.id, loc.id)).get()!;
    expect(row.type).toBe("other");
  });
});

describe("linkSessionNoteLocationsByName", () => {
  it("links a session note to locations by case-insensitive name, additively", () => {
    const { db, campaignId } = createTestDb();
    const lRepo = makeEntityRepo(db, locations, campaignId);
    const nRepo = makeEntityRepo(db, sessionNotes, campaignId);
    const loc = reconcileEntity(lRepo, m({ name: "Rexxentrum", notionPageId: "l1" }));
    const note = reconcileEntity(nRepo, m({ name: "Cobalt Soul Reunion", notionPageId: "n1", extra: { noteType: "Character Event" } }));

    linkSessionNoteLocationsByName(db, campaignId, note.id, ["rexxentrum", "Travel"]);
    linkSessionNoteLocationsByName(db, campaignId, note.id, ["Rexxentrum"]); // re-run: no duplicate

    const links = db.select().from(sessionNoteLocations)
      .where(and(eq(sessionNoteLocations.sessionNoteId, note.id), eq(sessionNoteLocations.locationId, loc.id))).all();
    expect(links).toHaveLength(1);
  });

  it("returns unmatched setting names as warnings", () => {
    const { db, campaignId } = createTestDb();
    const nRepo = makeEntityRepo(db, sessionNotes, campaignId);
    const note = reconcileEntity(nRepo, m({ name: "On the Road", notionPageId: "n2", extra: { noteType: "RP Encounter" } }));
    const unmatched = linkSessionNoteLocationsByName(db, campaignId, note.id, ["Travel", "On the Road"]);
    expect(unmatched).toEqual(["Travel", "On the Road"]);
  });
});
