import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/db/test-helpers";
import {
  makeEntityRepo, linkCharacterFactions, linkCharacterLocations, linkCharacterItems,
  linkSessionNoteLocations, setLocationParent, type ResolveTargetToKey,
} from "./repos";
import { reconcileEntity } from "./reconcile";
import {
  characters, factions, items, locations, sessionNotes,
  characterFactions, characterLocations, characterItems, sessionNoteLocations,
} from "@/lib/db/schema";
import type { MappedEntity } from "./map";

const m = (over: Partial<MappedEntity> & { name: string; sourceKey: string }): MappedEntity => ({
  sourcePath: `Campaign/${over.name}.md`, archived: false, sourceProps: [],
  sourceHash: `hash-${over.name}`, sourceText: `text of ${over.name}`, extra: {}, ...over,
});

const reconcile = (repo: ReturnType<typeof makeEntityRepo>, e: MappedEntity, candidates?: string[]) =>
  reconcileEntity(repo, e, candidates ?? [e.sourceKey]);

/** A resolver over an explicit basename -> key table, standing in for Task 8's link-index resolver. */
const resolver = (table: Record<string, string>): ResolveTargetToKey => (t) => table[t];

describe("makeEntityRepo", () => {
  it("writes every source column on insert", () => {
    const { db, campaignId } = createTestDb();
    const repo = makeEntityRepo(db, factions, campaignId);
    const r = reconcile(repo, m({
      name: "Children of Malice", sourceKey: "f1", sourcePath: "Factions/Children of Malice.md",
      sourceProps: [{ label: "Type", value: "Criminal" }],
      sourceHash: "deadbeef", sourceText: "Visible text.",
    }));
    expect(r.action).toBe("created");

    const row = db.select().from(factions).where(eq(factions.id, r.id)).get()!;
    expect(row.campaignId).toBe(campaignId);
    expect(row.name).toBe("Children of Malice");
    expect(row.sourceKey).toBe("f1");
    expect(row.sourcePath).toBe("Factions/Children of Malice.md");
    expect(JSON.parse(row.sourceProps!)).toEqual([{ label: "Type", value: "Criminal" }]);
    expect(row.sourceHash).toBe("deadbeef");
    expect(row.sourceText).toBe("Visible text.");
    expect(row.sourceSyncedAt).toBeInstanceOf(Date);
    expect(row.archived).toBe(false);
    // The notion_* columns are not this module's to write.
    expect(row.notionPageId).toBeNull();
    expect(row.notionProps).toBeNull();
  });

  it("writes character type + ddb id and item description from extra", () => {
    const { db, campaignId } = createTestDb();
    const c = reconcile(makeEntityRepo(db, characters, campaignId),
      m({ name: "Shale", sourceKey: "c1", extra: { type: "pc", ddbCharacterId: "145821922" } }));
    const crow = db.select().from(characters).where(eq(characters.id, c.id)).get()!;
    expect(crow.type).toBe("pc");
    expect(crow.ddbCharacterId).toBe("145821922");
    expect(crow.description).toBeNull();

    const i = reconcile(makeEntityRepo(db, items, campaignId),
      m({ name: "Fragment", sourceKey: "i1", extra: { description: "A shard." } }));
    expect(db.select().from(items).where(eq(items.id, i.id)).get()!.description).toBe("A shard.");
  });

  it("writes session-note extra columns and a new location defaults to type 'other'", () => {
    const { db, campaignId } = createTestDb();
    const n = reconcile(makeEntityRepo(db, sessionNotes, campaignId), m({
      name: "Session 12", sourceKey: "s12",
      extra: { noteType: "Session Notes", status: "Done", date: "2026-08-02", arc: "Act II" },
    }));
    expect(db.select().from(sessionNotes).where(eq(sessionNotes.id, n.id)).get())
      .toMatchObject({ noteType: "Session Notes", status: "Done", date: "2026-08-02", arc: "Act II" });

    const l = reconcile(makeEntityRepo(db, locations, campaignId), m({ name: "New Place", sourceKey: "l9" }));
    expect(db.select().from(locations).where(eq(locations.id, l.id)).get()!.type).toBe("other");
  });

  it("finds rows by source key within the campaign only", () => {
    const { db, campaignId } = createTestDb();
    const repo = makeEntityRepo(db, locations, campaignId);
    const r = reconcile(repo, m({ name: "Oreland", sourceKey: "l1" }));
    expect(repo.findByKey("l1")).toMatchObject({ id: r.id, name: "Oreland", sourceKey: "l1", archived: false });
    expect(repo.findByKey("nope")).toBeUndefined();
    expect(makeEntityRepo(db, locations, "another-campaign").findByKey("l1")).toBeUndefined();
  });

  it("adopts an unlinked hand-made row by name and stamps its key without duplicating", () => {
    const { db, campaignId } = createTestDb();
    const now = new Date();
    db.insert(locations).values({
      id: "hand", campaignId, name: "Rexxentrum", type: "city", createdAt: now, updatedAt: now,
    }).run();
    const repo = makeEntityRepo(db, locations, campaignId);
    const r = reconcile(repo, m({ name: "rexxentrum", sourceKey: "l1" }));
    expect(r).toEqual({ action: "adopted", id: "hand" });
    const all = db.select().from(locations).all();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: "hand", sourceKey: "l1", type: "city" }); // world-authoritative type kept
  });

  it("adopts a Notion-era row by its backfilled key and keeps its id", () => {
    const { db, campaignId } = createTestDb();
    const now = new Date();
    db.insert(characters).values({
      id: "old-id", campaignId, name: "Veldros", type: "npc",
      notionPageId: "2f5a8c1e9b3d4a6f8e7c0d1b2a3f4e5d", sourceKey: "2f5a8c1e9b3d4a6f8e7c0d1b2a3f4e5d",
      createdAt: now, updatedAt: now,
    }).run();
    const repo = makeEntityRepo(db, characters, campaignId);
    const r = reconcile(repo, m({ name: "Veldros", sourceKey: "2f5a8c1e9b3d4a6f8e7c0d1b2a3f4e5d", extra: { type: "npc" } }));
    expect(r.id).toBe("old-id");
    expect(r.action).toBe("updated"); // first sync fills source_path / hash / text
    expect(db.select().from(characters).all()).toHaveLength(1);
  });

  it("promotes a basename-keyed row to its hub_id in place", () => {
    const { db, campaignId } = createTestDb();
    const repo = makeEntityRepo(db, locations, campaignId);
    const first = reconcile(repo, m({ name: "Blackvein Quarry", sourceKey: "Blackvein Quarry" }));
    const r = reconcileEntity(repo, m({ name: "Blackvein Quarry", sourceKey: "abc" }), ["abc", "Blackvein Quarry"]);
    expect(r).toEqual({ action: "adopted", id: first.id });
    const all = db.select().from(locations).all();
    expect(all).toHaveLength(1);
    expect(all[0].sourceKey).toBe("abc");
  });

  describe("update detection (R22: full synced column set, never the hash alone)", () => {
    const base = () => m({
      name: "Shale", sourceKey: "c1", sourceHash: "same-hash",
      sourceProps: [{ label: "Role", value: "Cleric" }], extra: { type: "pc", ddbCharacterId: null },
    });
    const setup = () => {
      const { db, campaignId } = createTestDb();
      const repo = makeEntityRepo(db, characters, campaignId);
      const first = reconcile(repo, base());
      return { db, repo, id: first.id };
    };

    it("reports unchanged for an identical re-sync", () => {
      const { repo, id } = setup();
      expect(reconcile(repo, base())).toEqual({ action: "unchanged", id });
    });

    it("a frontmatter-only change (same body hash) yields updated, not unchanged", () => {
      const { db, repo, id } = setup();
      const edited = { ...base(), sourceProps: [{ label: "Role", value: "Bishop" }] };
      expect(edited.sourceHash).toBe(base().sourceHash);
      expect(reconcile(repo, edited)).toEqual({ action: "updated", id });
      const row = db.select().from(characters).where(eq(characters.id, id)).get()!;
      expect(JSON.parse(row.sourceProps!)).toEqual([{ label: "Role", value: "Bishop" }]);
    });

    it("an archived flip alone (active: true -> false) yields updated", () => {
      const { db, repo, id } = setup();
      expect(reconcile(repo, { ...base(), archived: true }).action).toBe("updated");
      expect(db.select().from(characters).where(eq(characters.id, id)).get()!.archived).toBe(true);
      expect(reconcile(repo, { ...base(), archived: true }).action).toBe("unchanged");
    });

    it("a changed extra value alone yields updated", () => {
      const { db, repo, id } = setup();
      expect(reconcile(repo, { ...base(), extra: { type: "npc", ddbCharacterId: null } }).action).toBe("updated");
      expect(db.select().from(characters).where(eq(characters.id, id)).get()!.type).toBe("npc");
    });

    it("a changed session-note date alone yields updated", () => {
      const { db, campaignId } = createTestDb();
      const repo = makeEntityRepo(db, sessionNotes, campaignId);
      const note = (date: string) => m({ name: "S1", sourceKey: "s1", extra: { noteType: "Session Notes", status: null, date, arc: null } });
      const first = reconcile(repo, note("2026-08-02"));
      expect(reconcile(repo, note("2026-08-09"))).toEqual({ action: "updated", id: first.id });
      expect(db.select().from(sessionNotes).get()!.date).toBe("2026-08-09");
    });

    it("a moved note (new source_path) yields updated", () => {
      const { db, id } = setup();
      // A later sync run builds a fresh repo; same-key arbitration is scoped to one run.
      const nextRun = makeEntityRepo(db, characters, db.select().from(characters).get()!.campaignId);
      expect(reconcile(nextRun, { ...base(), sourcePath: "Elsewhere/Shale.md" }).action).toBe("updated");
      expect(db.select().from(characters).where(eq(characters.id, id)).get()!.sourcePath).toBe("Elsewhere/Shale.md");
    });

    it("a body change yields updated and stores the new hash and text", () => {
      const { db, repo, id } = setup();
      expect(reconcile(repo, { ...base(), sourceHash: "new-hash", sourceText: "new text" }).action).toBe("updated");
      expect(db.select().from(characters).where(eq(characters.id, id)).get())
        .toMatchObject({ sourceHash: "new-hash", sourceText: "new text" });
    });

    it("a rename yields updated", () => {
      const { repo, id } = setup();
      expect(reconcile(repo, { ...base(), name: "Shale Vane" })).toEqual({ action: "updated", id });
    });
  });

  it("leaves updatedAt alone when nothing changed, but refreshes source_synced_at", async () => {
    const { db, campaignId } = createTestDb();
    const repo = makeEntityRepo(db, items, campaignId);
    const r = reconcile(repo, m({ name: "Fragment", sourceKey: "i1" }));
    // Pin both timestamps to a known old instant so a rewrite is unmistakable.
    const old = new Date(1_000_000_000_000);
    db.update(items).set({ updatedAt: old, sourceSyncedAt: old }).where(eq(items.id, r.id)).run();

    expect(reconcile(repo, m({ name: "Fragment", sourceKey: "i1" })).action).toBe("unchanged");
    const row = db.select().from(items).where(eq(items.id, r.id)).get()!;
    expect(row.updatedAt.getTime()).toBe(old.getTime());
    expect(row.sourceSyncedAt!.getTime()).toBeGreaterThan(old.getTime());

    expect(reconcile(repo, m({ name: "Fragment", sourceKey: "i1", sourceHash: "changed" })).action).toBe("updated");
    expect(db.select().from(items).where(eq(items.id, r.id)).get()!.updatedAt.getTime()).toBeGreaterThan(old.getTime());
  });

  it("is order-independent for two notes sharing a key, against the real database", () => {
    const a = m({ name: "Alpha", sourceKey: "K", sourcePath: "a/Dup.md", sourceHash: "ha" });
    const b = m({ name: "Beta", sourceKey: "K", sourcePath: "b/Dup.md", sourceHash: "hb" });
    const outcome = (order: MappedEntity[]) => {
      const { db, campaignId } = createTestDb();
      const repo = makeEntityRepo(db, locations, campaignId);
      for (const e of order) reconcile(repo, e);
      return db.select().from(locations).all().map((r) => ({ name: r.name, key: r.sourceKey, path: r.sourcePath, hash: r.sourceHash }));
    };
    expect(outcome([a, b])).toEqual(outcome([b, a]));
    expect(outcome([a, b])).toEqual([{ name: "Alpha", key: "K", path: "a/Dup.md", hash: "ha" }]);
  });
});

describe("link helpers (additive, resolved through the injected resolver)", () => {
  function world() {
    const { db, campaignId } = createTestDb();
    const fRepo = makeEntityRepo(db, factions, campaignId);
    const cRepo = makeEntityRepo(db, characters, campaignId);
    const lRepo = makeEntityRepo(db, locations, campaignId);
    const iRepo = makeEntityRepo(db, items, campaignId);
    const nRepo = makeEntityRepo(db, sessionNotes, campaignId);
    return { db, campaignId, fRepo, cRepo, lRepo, iRepo, nRepo };
  }

  it("adds a character-faction link without removing existing links", () => {
    const { db, campaignId, fRepo, cRepo } = world();
    const malice = reconcile(fRepo, m({ name: "Children of Malice", sourceKey: "notion-f1" }));
    const cobalt = reconcile(fRepo, m({ name: "Cobalt Soul", sourceKey: "notion-f2" }));
    const chr = reconcile(cRepo, m({ name: "Shale", sourceKey: "c1", extra: { type: "pc" } }));
    // Wikilink targets are basenames; the keys are different strings entirely.
    const resolve = resolver({ "Children of Malice": "notion-f1", "Cobalt Soul": "notion-f2" });

    linkCharacterFactions(db, campaignId, chr.id, ["Children of Malice"], resolve);
    linkCharacterFactions(db, campaignId, chr.id, ["Cobalt Soul", "Children of Malice", "Nonexistent"], resolve);

    const links = db.select().from(characterFactions).where(eq(characterFactions.characterId, chr.id)).all();
    expect(links.map((l) => l.factionId).sort()).toEqual([malice.id, cobalt.id].sort());

    // A later run listing fewer targets removes nothing.
    linkCharacterFactions(db, campaignId, chr.id, [], resolve);
    expect(db.select().from(characterFactions).where(eq(characterFactions.characterId, chr.id)).all()).toHaveLength(2);
  });

  it("skips a target the resolver cannot resolve, and a resolved key with no row", () => {
    const { db, campaignId, fRepo, cRepo } = world();
    reconcile(fRepo, m({ name: "Children of Malice", sourceKey: "notion-f1" }));
    const chr = reconcile(cRepo, m({ name: "Shale", sourceKey: "c1", extra: { type: "pc" } }));
    const resolve = resolver({ "Ghost Faction": "no-such-key" });
    linkCharacterFactions(db, campaignId, chr.id, ["Unknown", "Ghost Faction", "Children of Malice"], resolve);
    expect(db.select().from(characterFactions).all()).toHaveLength(0);
  });

  it("does not look a target up against source_key directly", () => {
    const { db, campaignId, fRepo, cRepo } = world();
    reconcile(fRepo, m({ name: "Children of Malice", sourceKey: "Children of Malice" }));
    const chr = reconcile(cRepo, m({ name: "Shale", sourceKey: "c1", extra: { type: "pc" } }));
    // A row happens to be keyed on the basename, but the resolver says this target has no key.
    linkCharacterFactions(db, campaignId, chr.id, ["Children of Malice"], () => undefined);
    expect(db.select().from(characterFactions).all()).toHaveLength(0);
  });

  it("links a character to locations by resolved key, additively", () => {
    const { db, campaignId, cRepo, lRepo } = world();
    const loc = reconcile(lRepo, m({ name: "Oreland", sourceKey: "l1" }));
    const chr = reconcile(cRepo, m({ name: "Beilar", sourceKey: "c1", extra: { type: "npc" } }));
    const resolve = resolver({ Oreland: "l1" });
    linkCharacterLocations(db, campaignId, chr.id, ["Oreland", "Nowhere"], resolve);
    linkCharacterLocations(db, campaignId, chr.id, ["Oreland"], resolve); // re-run: no duplicate
    const links = db.select().from(characterLocations).where(eq(characterLocations.characterId, chr.id)).all();
    expect(links).toEqual([{ characterId: chr.id, locationId: loc.id }]);
  });

  it("links an item to its holders by resolved key, additively", () => {
    const { db, campaignId, cRepo, iRepo } = world();
    const bart = reconcile(cRepo, m({ name: "Bartlebee", sourceKey: "notion-c1", extra: { type: "pc" } }));
    const itm = reconcile(iRepo, m({ name: "Fragment", sourceKey: "i1" }));
    const resolve = resolver({ Bartlebee: "notion-c1" });
    linkCharacterItems(db, campaignId, itm.id, ["Bartlebee", "Stranger"], resolve);
    linkCharacterItems(db, campaignId, itm.id, ["Bartlebee"], resolve);
    const links = db.select().from(characterItems).where(eq(characterItems.itemId, itm.id)).all();
    expect(links).toEqual([{ characterId: bart.id, itemId: itm.id }]);
  });

  it("resolves a session note's locations by source key", () => {
    const { db, campaignId, lRepo, nRepo } = world();
    const rex = reconcile(lRepo, m({ name: "Rexxentrum", sourceKey: "notion-l1" }));
    const note = reconcile(nRepo, m({ name: "Cobalt Soul Reunion", sourceKey: "n1", extra: { noteType: "Character Event" } }));
    const resolve = resolver({ Rexxentrum: "notion-l1" });
    const unmatched = linkSessionNoteLocations(db, campaignId, note.id, ["Rexxentrum", "Elsewhere"], [], resolve);
    linkSessionNoteLocations(db, campaignId, note.id, ["Rexxentrum"], [], resolve); // re-run
    expect(unmatched).toEqual([]);
    expect(db.select().from(sessionNoteLocations).where(eq(sessionNoteLocations.sessionNoteId, note.id)).all())
      .toEqual([{ sessionNoteId: note.id, locationId: rex.id }]);
  });

  it("links setting names case-insensitively by location name", () => {
    const { db, campaignId, lRepo, nRepo } = world();
    const rex = reconcile(lRepo, m({ name: "Rexxentrum", sourceKey: "notion-l1" }));
    const note = reconcile(nRepo, m({ name: "On the Road", sourceKey: "n2", extra: { noteType: "RP Encounter" } }));
    linkSessionNoteLocations(db, campaignId, note.id, [], ["rexxentrum"], resolver({}));
    expect(db.select().from(sessionNoteLocations).all())
      .toEqual([{ sessionNoteId: note.id, locationId: rex.id }]);
  });

  it("returns setting names that matched no location", () => {
    const { db, campaignId, lRepo, nRepo } = world();
    reconcile(lRepo, m({ name: "Rexxentrum", sourceKey: "l1" }));
    const note = reconcile(nRepo, m({ name: "On the Road", sourceKey: "n2", extra: { noteType: "RP Encounter" } }));
    const unmatched = linkSessionNoteLocations(db, campaignId, note.id, [], ["Travel", "Rexxentrum", "On the Road"], resolver({}));
    expect(unmatched).toEqual(["Travel", "On the Road"]);
    expect(db.select().from(sessionNoteLocations).all()).toHaveLength(1);
  });

  it("sets parent_location_id from a resolved parent target", () => {
    const { db, campaignId, lRepo } = world();
    const region = reconcile(lRepo, m({ name: "Dwendalian Empire", sourceKey: "notion-l1" }));
    const city = reconcile(lRepo, m({ name: "Rexxentrum", sourceKey: "l2" }));
    const resolve = resolver({ "Dwendalian Empire": "notion-l1" });

    expect(setLocationParent(db, campaignId, city.id, "Dwendalian Empire", resolve)).toBe(true);
    expect(db.select().from(locations).where(eq(locations.id, city.id)).get()!.parentLocationId).toBe(region.id);
  });

  it("leaves parent_location_id alone for an unresolved, missing, or self parent", () => {
    const { db, campaignId, lRepo } = world();
    const region = reconcile(lRepo, m({ name: "Dwendalian Empire", sourceKey: "notion-l1" }));
    const city = reconcile(lRepo, m({ name: "Rexxentrum", sourceKey: "l2" }));
    const resolve = resolver({ "Dwendalian Empire": "notion-l1", Rexxentrum: "l2", Ghost: "no-such-key" });
    setLocationParent(db, campaignId, city.id, "Dwendalian Empire", resolve);

    expect(setLocationParent(db, campaignId, city.id, "Unknown", resolve)).toBe(false);
    expect(setLocationParent(db, campaignId, city.id, "Ghost", resolve)).toBe(false);
    expect(setLocationParent(db, campaignId, city.id, undefined, resolve)).toBe(false);
    expect(setLocationParent(db, campaignId, city.id, "Rexxentrum", resolve)).toBe(false);
    expect(db.select().from(locations).where(eq(locations.id, city.id)).get()!.parentLocationId).toBe(region.id);
  });

  it("does not touch updatedAt when it sets a parent, and re-pointing the parent overwrites", () => {
    const { db, campaignId, lRepo } = world();
    reconcile(lRepo, m({ name: "A", sourceKey: "la" }));
    const b = reconcile(lRepo, m({ name: "B", sourceKey: "lb" }));
    const c = reconcile(lRepo, m({ name: "C", sourceKey: "lc" }));
    const old = new Date(1_000_000_000_000);
    db.update(locations).set({ updatedAt: old }).where(eq(locations.id, c.id)).run();
    const resolve = resolver({ A: "la", B: "lb" });
    setLocationParent(db, campaignId, c.id, "A", resolve);
    setLocationParent(db, campaignId, c.id, "B", resolve);
    const row = db.select().from(locations).where(eq(locations.id, c.id)).get()!;
    expect(row.parentLocationId).toBe(b.id);
    expect(row.updatedAt.getTime()).toBe(old.getTime());
  });

  it("only links within the campaign", () => {
    const { db, fRepo, cRepo } = world();
    reconcile(fRepo, m({ name: "Children of Malice", sourceKey: "f1" }));
    const chr = reconcile(cRepo, m({ name: "Shale", sourceKey: "c1", extra: { type: "pc" } }));
    linkCharacterFactions(db, "other-campaign", chr.id, ["Children of Malice"], resolver({ "Children of Malice": "f1" }));
    expect(db.select().from(characterFactions).all()).toHaveLength(0);
  });
});
