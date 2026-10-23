import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { createTestDb, type TestDb } from "@/lib/db/test-helpers";
import {
  characters, factions, items, locations, sessionNotes,
  characterFactions, characterLocations, characterItems, sessionNoteLocations,
} from "@/lib/db/schema";
import { embedViewFor, resolveEmbed, type EmbedView } from "./embeds";

const now = new Date();
const id = () => crypto.randomUUID();

function addCharacter(db: TestDb, campaignId: string, name: string, type: "pc" | "npc", archived = false) {
  const row = { id: id(), campaignId, name, type, archived, createdAt: now, updatedAt: now };
  db.insert(characters).values(row).run();
  return row.id;
}
function addLocation(db: TestDb, campaignId: string, name: string, over: { parent?: string; archived?: boolean } = {}) {
  const row = {
    id: id(), campaignId, name, archived: over.archived ?? false,
    parentLocationId: over.parent ?? null, createdAt: now, updatedAt: now,
  };
  db.insert(locations).values(row).run();
  return row.id;
}
function addFaction(db: TestDb, campaignId: string, name: string) {
  const row = { id: id(), campaignId, name, createdAt: now, updatedAt: now };
  db.insert(factions).values(row).run();
  return row.id;
}
function addItem(db: TestDb, campaignId: string, name: string, archived = false) {
  const row = { id: id(), campaignId, name, archived, createdAt: now, updatedAt: now };
  db.insert(items).values(row).run();
  return row.id;
}
function addNote(
  db: TestDb, campaignId: string, name: string, noteType: string | null,
  over: { date?: string | null; archived?: boolean } = {},
) {
  const row = {
    id: id(), campaignId, name, noteType, date: over.date ?? null,
    archived: over.archived ?? false, createdAt: now, updatedAt: now,
  };
  db.insert(sessionNotes).values(row).run();
  return row.id;
}
const names = (r: { items: Array<{ name: string }> }) => r.items.map((i) => i.name);

describe("embedViewFor", () => {
  it.each([
    ["NPCs here", "npcs-here"], ["Members", "members"], ["Items held", "items-held"],
    ["Sessions here", "sessions-here"], ["Content here", "content-here"],
    ["Places within", "places-within"],
  ])("maps %s", (heading, view) => { expect(embedViewFor(heading)).toBe(view); });

  it.each(["Threads", "Threads advanced", "Scenes featuring", "Player notes", "Items found"])(
    "returns null for %s", (h) => { expect(embedViewFor(h)).toBeNull(); }
  );

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    expect(embedViewFor("npcs here")).toBe("npcs-here");
    expect(embedViewFor("  CONTENT HERE\t")).toBe("content-here");
    expect(embedViewFor("\n Places Within ")).toBe("places-within");
    // Whitespace is trimmed only at the ends; the view name itself is exact.
    expect(embedViewFor("NPCs  here")).toBeNull();
    // The four unanswerable views stay null however they are typed.
    expect(embedViewFor("  threads ")).toBeNull();
    expect(embedViewFor("ITEMS FOUND")).toBeNull();
  });

  it("returns null for an unknown heading", () => {
    expect(embedViewFor("Nonsense")).toBeNull();
    expect(embedViewFor("")).toBeNull();
    expect(embedViewFor("   ")).toBeNull();
  });
});

describe("resolveEmbed", () => {
  it("lists NPCs linked to a location, not PCs, and only that location's", () => {
    const { db, campaignId } = createTestDb();
    const here = addLocation(db, campaignId, "Rexxentrum");
    const elsewhere = addLocation(db, campaignId, "Zadash");
    const vex = addCharacter(db, campaignId, "Vex", "npc");
    const abel = addCharacter(db, campaignId, "Abel", "npc");
    const shale = addCharacter(db, campaignId, "Shale", "pc");
    const far = addCharacter(db, campaignId, "Faraway", "npc");
    db.insert(characterLocations).values([
      { characterId: vex, locationId: here }, { characterId: abel, locationId: here },
      { characterId: shale, locationId: here }, { characterId: far, locationId: elsewhere },
    ]).run();

    const r = resolveEmbed(db, campaignId, "npcs-here", "location", here);
    expect(r.items).toEqual([
      { kind: "character", id: abel, name: "Abel" },
      { kind: "character", id: vex, name: "Vex" },
    ]);
  });

  it("excludes archived rows from every view", () => {
    const { db, campaignId } = createTestDb();
    const loc = addLocation(db, campaignId, "Rexxentrum");
    const faction = addFaction(db, campaignId, "Crownsguard");
    const holder = addCharacter(db, campaignId, "Holder", "pc");

    const liveNpc = addCharacter(db, campaignId, "Live NPC", "npc");
    const deadNpc = addCharacter(db, campaignId, "Archived NPC", "npc", true);
    db.insert(characterLocations).values([
      { characterId: liveNpc, locationId: loc }, { characterId: deadNpc, locationId: loc },
    ]).run();
    db.insert(characterFactions).values([
      { characterId: liveNpc, factionId: faction }, { characterId: deadNpc, factionId: faction },
    ]).run();

    const liveItem = addItem(db, campaignId, "Live Item");
    const deadItem = addItem(db, campaignId, "Archived Item", true);
    db.insert(characterItems).values([
      { characterId: holder, itemId: liveItem }, { characterId: holder, itemId: deadItem },
    ]).run();

    const liveSession = addNote(db, campaignId, "Live Session", "Session Notes", { date: "2026-01-01" });
    const deadSession = addNote(db, campaignId, "Archived Session", "Session Notes", { archived: true });
    const liveFight = addNote(db, campaignId, "Live Fight", "Combat Encounter");
    const deadFight = addNote(db, campaignId, "Archived Fight", "Combat Encounter", { archived: true });
    db.insert(sessionNoteLocations).values([liveSession, deadSession, liveFight, deadFight]
      .map((n) => ({ sessionNoteId: n, locationId: loc }))).run();

    addLocation(db, campaignId, "Live Child", { parent: loc });
    addLocation(db, campaignId, "Archived Child", { parent: loc, archived: true });

    const run = (view: EmbedView, kind: string, host: string) => names(resolveEmbed(db, campaignId, view, kind, host));
    expect(run("npcs-here", "location", loc)).toEqual(["Live NPC"]);
    expect(run("members", "faction", faction)).toEqual(["Live NPC"]);
    expect(run("items-held", "character", holder)).toEqual(["Live Item"]);
    expect(run("sessions-here", "location", loc)).toEqual(["Live Session"]);
    expect(run("content-here", "location", loc)).toEqual(["Live Fight"]);
    expect(run("places-within", "location", loc)).toEqual(["Live Child"]);
  });

  it("lists faction members: PCs and NPCs together, alphabetically", () => {
    const { db, campaignId } = createTestDb();
    const faction = addFaction(db, campaignId, "Crownsguard");
    const other = addFaction(db, campaignId, "Kryn Dynasty");
    const zed = addCharacter(db, campaignId, "Zed", "npc");
    const shale = addCharacter(db, campaignId, "shale", "pc");
    const outsider = addCharacter(db, campaignId, "Outsider", "npc");
    db.insert(characterFactions).values([
      { characterId: zed, factionId: faction }, { characterId: shale, factionId: faction },
      { characterId: outsider, factionId: other },
    ]).run();

    const r = resolveEmbed(db, campaignId, "members", "faction", faction);
    // Case-insensitive alphabetical: "shale" sorts before "Zed".
    expect(r.items).toEqual([
      { kind: "character", id: shale, name: "shale" },
      { kind: "character", id: zed, name: "Zed" },
    ]);
  });

  it("lists items held by a character, and only that character's", () => {
    const { db, campaignId } = createTestDb();
    const vex = addCharacter(db, campaignId, "Vex", "pc");
    const other = addCharacter(db, campaignId, "Other", "pc");
    const bow = addItem(db, campaignId, "Longbow");
    const amulet = addItem(db, campaignId, "Amulet");
    const spoon = addItem(db, campaignId, "Spoon");
    db.insert(characterItems).values([
      { characterId: vex, itemId: bow }, { characterId: vex, itemId: amulet },
      { characterId: other, itemId: spoon },
    ]).run();

    const r = resolveEmbed(db, campaignId, "items-held", "character", vex);
    expect(r.items).toEqual([
      { kind: "item", id: amulet, name: "Amulet" },
      { kind: "item", id: bow, name: "Longbow" },
    ]);
  });

  it("lists only Session Notes for sessions-here, newest first, undated last", () => {
    const { db, campaignId } = createTestDb();
    const loc = addLocation(db, campaignId, "Rexxentrum");
    const old = addNote(db, campaignId, "Session 1", "Session Notes", { date: "2026-01-05" });
    const recent = addNote(db, campaignId, "Session 12", "Session Notes", { date: "2026-03-20" });
    const undated = addNote(db, campaignId, "Session 99", "Session Notes", { date: null });
    const arc = addNote(db, campaignId, "Arc One", "Story Outline", { date: "2026-04-01" });
    const fight = addNote(db, campaignId, "Ambush", "Combat Encounter", { date: "2026-04-02" });
    const unlinked = addNote(db, campaignId, "Elsewhere", "Session Notes", { date: "2026-05-01" });
    const otherLoc = addLocation(db, campaignId, "Zadash");
    db.insert(sessionNoteLocations).values([
      ...[old, recent, undated, arc, fight].map((n) => ({ sessionNoteId: n, locationId: loc })),
      { sessionNoteId: unlinked, locationId: otherLoc },
    ]).run();

    const r = resolveEmbed(db, campaignId, "sessions-here", "location", loc);
    expect(r.items).toEqual([
      { kind: "session", id: recent, name: "Session 12" },
      { kind: "session", id: old, name: "Session 1" },
      { kind: "session", id: undated, name: "Session 99" },
    ]);
  });

  it("lists only encounter and scene note types for content-here", () => {
    // A session note, an arc, and encounters/scenes all linked to the location;
    // only the encounter and scene types appear.
    const { db, campaignId } = createTestDb();
    const loc = addLocation(db, campaignId, "Rexxentrum");
    const session = addNote(db, campaignId, "A Session", "Session Notes");
    const arc = addNote(db, campaignId, "An Arc", "Story Outline");
    const untyped = addNote(db, campaignId, "Untyped", null);
    const combat = addNote(db, campaignId, "Combat", "Combat Encounter");
    const rp = addNote(db, campaignId, "Parley", "RP Encounter");
    const explore = addNote(db, campaignId, "Trek", "Exploration Encounter");
    const scene = addNote(db, campaignId, "Event", "Character Event");
    db.insert(sessionNoteLocations).values(
      [session, arc, untyped, combat, rp, explore, scene].map((n) => ({ sessionNoteId: n, locationId: loc })),
    ).run();

    const r = resolveEmbed(db, campaignId, "content-here", "location", loc);
    expect(r.items).toEqual([
      { kind: "session", id: combat, name: "Combat" },
      { kind: "session", id: scene, name: "Event" },
      { kind: "session", id: rp, name: "Parley" },
      { kind: "session", id: explore, name: "Trek" },
    ]);
  });

  it("lists child locations for places-within, direct children only", () => {
    const { db, campaignId } = createTestDb();
    const city = addLocation(db, campaignId, "Rexxentrum");
    const market = addLocation(db, campaignId, "Market", { parent: city });
    const docks = addLocation(db, campaignId, "Docks", { parent: city });
    addLocation(db, campaignId, "Stall", { parent: market }); // grandchild
    addLocation(db, campaignId, "Elsewhere"); // no parent

    const r = resolveEmbed(db, campaignId, "places-within", "location", city);
    expect(r.items).toEqual([
      { kind: "location", id: docks, name: "Docks" },
      { kind: "location", id: market, name: "Market" },
    ]);
  });

  it("is scoped to the campaign", () => {
    const { db, campaignId } = createTestDb();
    const loc = addLocation(db, campaignId, "Rexxentrum");
    const npc = addCharacter(db, campaignId, "Vex", "npc");
    db.insert(characterLocations).values({ characterId: npc, locationId: loc }).run();
    expect(resolveEmbed(db, "some-other-campaign", "npcs-here", "location", loc).items).toEqual([]);
  });

  it("returns an empty items array rather than throwing when nothing matches", () => {
    const { db, campaignId } = createTestDb();
    const loc = addLocation(db, campaignId, "Empty Place");
    const views: EmbedView[] = ["npcs-here", "members", "items-held", "sessions-here", "content-here", "places-within"];
    for (const v of views) {
      expect(resolveEmbed(db, campaignId, v, "location", loc).items).toEqual([]);
    }
    // A host id that does not exist at all is also just empty.
    expect(resolveEmbed(db, campaignId, "npcs-here", "location", "no-such-id").items).toEqual([]);
  });

  it("returns empty, never throws, when a view is asked on the wrong kind of host", () => {
    const { db, campaignId } = createTestDb();
    const loc = addLocation(db, campaignId, "Rexxentrum");
    const faction = addFaction(db, campaignId, "Crownsguard");
    const npc = addCharacter(db, campaignId, "Vex", "npc");
    db.insert(characterLocations).values({ characterId: npc, locationId: loc }).run();
    db.insert(characterFactions).values({ characterId: npc, factionId: faction }).run();
    expect(resolveEmbed(db, campaignId, "members", "location", loc).items).toEqual([]);
    expect(resolveEmbed(db, campaignId, "items-held", "faction", faction).items).toEqual([]);
    // Right id, wrong declared kind: the view is not answered for that host.
    expect(resolveEmbed(db, campaignId, "npcs-here", "faction", loc).items).toEqual([]);
    expect(resolveEmbed(db, campaignId, "npcs-here", "bogus-kind", loc).items).toEqual([]);
  });

  it("titles each result with the canonical view heading", () => {
    const { db, campaignId } = createTestDb();
    const loc = addLocation(db, campaignId, "Rexxentrum");
    expect(resolveEmbed(db, campaignId, "npcs-here", "location", loc).title).toBe("NPCs here");
    expect(resolveEmbed(db, campaignId, "members", "faction", "x").title).toBe("Members");
    expect(resolveEmbed(db, campaignId, "places-within", "location", loc).title).toBe("Places within");
  });
});
