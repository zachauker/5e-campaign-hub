import { describe, it, expect } from "vitest";
import {
  resolveSourceKey, candidateKeys, tableForType, mapNote, normalizeDate, extractDdbId,
} from "./map";
import type { VaultNote } from "./scan";

function note(
  basename: string,
  data: Record<string, unknown> = {},
  body = "",
  path = `Campaign/${basename}.md`,
): VaultNote {
  return { path, basename, data, body };
}

const labels = (m: { sourceProps: { label: string }[] }) => m.sourceProps.map((p) => p.label);
const prop = (m: { sourceProps: { label: string; value: string }[] }, label: string) =>
  m.sourceProps.find((p) => p.label === label)?.value;

describe("resolveSourceKey", () => {
  it("prefers hub_id", () => {
    const n = note("Blackvein Quarry", { hub_id: "abc123", notion_id: "def456" });
    expect(resolveSourceKey(n)).toEqual({ key: "abc123", tier: 1 });
  });

  it("falls back to notion_id", () => {
    const n = note("Blackvein Quarry", { notion_id: "2f5a8c1e9b3d4a6f8e7c0d1b2a3f4e5d" });
    expect(resolveSourceKey(n)).toEqual({ key: "2f5a8c1e9b3d4a6f8e7c0d1b2a3f4e5d", tier: 2 });
  });

  it("falls back to the basename", () => {
    expect(resolveSourceKey(note("Blackvein Quarry"))).toEqual({ key: "Blackvein Quarry", tier: 3 });
  });

  it("ignores blank ids", () => {
    const n = note("Blackvein Quarry", { hub_id: "  ", notion_id: null });
    expect(resolveSourceKey(n)).toEqual({ key: "Blackvein Quarry", tier: 3 });
  });

  it("strips dashes from a dashed notion_id so it matches the backfilled page id", () => {
    const n = note("X", { notion_id: "2f5a8c1e-9b3d-4a6f-8e7c-0d1b2a3f4e5d" });
    expect(resolveSourceKey(n)).toEqual({ key: "2f5a8c1e9b3d4a6f8e7c0d1b2a3f4e5d", tier: 2 });
  });
});

describe("candidateKeys", () => {
  it("lists every key highest tier first", () => {
    const n = note("Blackvein Quarry", { hub_id: "abc", notion_id: "def" });
    expect(candidateKeys(n)).toEqual(["abc", "def", "Blackvein Quarry"]);
  });

  it("omits tiers the note does not have", () => {
    expect(candidateKeys(note("Q", { notion_id: "def" }))).toEqual(["def", "Q"]);
    expect(candidateKeys(note("Q"))).toEqual(["Q"]);
  });

  it("does not repeat a key", () => {
    expect(candidateKeys(note("Q", { hub_id: "Q" }))).toEqual(["Q"]);
  });

  it("starts with the resolved key", () => {
    const n = note("Q", { notion_id: "def" });
    expect(candidateKeys(n)[0]).toBe(resolveSourceKey(n).key);
  });
});

describe("tableForType", () => {
  it.each([
    ["npc", "characters"], ["pc", "characters"], ["location", "locations"],
    ["item", "items"], ["faction", "factions"], ["session", "sessionNotes"],
    ["arc", "sessionNotes"], ["encounter", "sessionNotes"], ["scene", "sessionNotes"],
  ])("routes %s to %s", (type, table) => { expect(tableForType(type)).toBe(table); });

  it.each(["thread", "player-note", "reference", "campaign"])("skips %s", (type) => {
    expect(tableForType(type)).toBe("skip");
  });

  it("reports an unrecognised type as unknown", () => { expect(tableForType("widget")).toBe("unknown"); });
  it("reports a missing type as unknown", () => { expect(tableForType(undefined)).toBe("unknown"); });
  it("does not treat Object.prototype keys as types", () => {
    expect(tableForType("constructor")).toBe("unknown");
  });
});

describe("normalizeDate", () => {
  it("reads a Date as its UTC calendar day", () => {
    expect(normalizeDate(new Date("2026-08-02T00:00:00.000Z"))).toBe("2026-08-02");
  });

  it("does not shift the day under a western timezone", () => {
    const original = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(normalizeDate(new Date(Date.UTC(2026, 7, 2)))).toBe("2026-08-02");
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("passes an ISO string through", () => {
    expect(normalizeDate("2026-07-19")).toBe("2026-07-19");
  });

  it("drops a trailing time", () => {
    expect(normalizeDate("2026-07-19T18:30:00Z")).toBe("2026-07-19");
  });

  it.each(["last Tuesday", "2026-13-45", "2026-02-30", "", 20260719, null, undefined, {}])(
    "returns null for malformed %j",
    (value) => { expect(normalizeDate(value)).toBeNull(); },
  );

  it("returns null for an invalid Date", () => {
    expect(normalizeDate(new Date("nonsense"))).toBeNull();
  });
});

describe("extractDdbId", () => {
  it("reads the id from a character URL", () => {
    expect(extractDdbId("https://www.dndbeyond.com/characters/12345678")).toBe("12345678");
    expect(extractDdbId("https://www.dndbeyond.com/profile/zach/characters/87654321")).toBe("87654321");
  });
  it("returns null otherwise", () => {
    expect(extractDdbId("https://example.com/sheet")).toBeNull();
    expect(extractDdbId(null)).toBeNull();
  });
});

describe("mapNote", () => {
  it("takes the entity name from the basename", () => {
    const m = mapNote(note("Blackvein Quarry", { type: "location" }), "locations");
    expect(m.name).toBe("Blackvein Quarry");
    expect(m.sourceKey).toBe("Blackvein Quarry");
    expect(m.sourcePath).toBe("Campaign/Blackvein Quarry.md");
  });

  it("hashes the body and indexes it without DM-only content", () => {
    const m = mapNote(note("Q", { type: "location" }, "Visible text.\n\n> [!dm] secret\n> hidden\n"), "locations");
    expect(m.sourceHash).toMatch(/^[0-9a-f]+$/);
    expect(m.sourceText).toContain("Visible text.");
    expect(m.sourceText).not.toContain("hidden");
  });

  describe("characters", () => {
    const npc = {
      type: "npc", active: true, race: "Half-Elf", class: ["Rogue", "Wizard"], role: "Fence",
      disposition: "Friendly", location: ["[[Blackvein Quarry]]"], factions: ["[[Crown's Hand]]", "[[The Lucid Bloom]]"],
      notion_id: "abc",
    };

    it("sets type pc or npc from the vault type", () => {
      expect(mapNote(note("Vex", npc), "characters").extra.type).toBe("npc");
      expect(mapNote(note("Percy", { ...npc, type: "pc" }), "characters").extra.type).toBe("pc");
    });

    it("extracts the D&D Beyond id from sheet", () => {
      const m = mapNote(note("Percy", { ...npc, type: "pc", sheet: "https://www.dndbeyond.com/characters/12345678", level: 7 }), "characters");
      expect(m.extra.ddbCharacterId).toBe("12345678");
      expect(prop(m, "Level")).toBe("7");
    });

    it("has no ddb id for an npc without a sheet", () => {
      expect(mapNote(note("Vex", npc), "characters").extra.ddbCharacterId).toBeNull();
    });

    it("shows the sheet url as a property only when no ddb id was extracted", () => {
      const withId = mapNote(note("P", { ...npc, sheet: "https://www.dndbeyond.com/characters/12345678" }), "characters");
      expect(labels(withId)).not.toContain("Sheet");
      const without = mapNote(note("P", { ...npc, sheet: "https://example.com/sheet.pdf" }), "characters");
      expect(prop(without, "Sheet")).toBe("https://example.com/sheet.pdf");
      expect(without.extra.ddbCharacterId).toBeNull();
    });

    it("shows race, joined class, disposition and role", () => {
      const m = mapNote(note("Vex", npc), "characters");
      expect(m.sourceProps).toEqual([
        { label: "Race", value: "Half-Elf" },
        { label: "Class", value: "Rogue, Wizard" },
        { label: "Disposition", value: "Friendly" },
        { label: "Role", value: "Fence" },
      ]);
    });

    it("archives a character with active: false", () => {
      expect(mapNote(note("Vex", { ...npc, active: false }), "characters").archived).toBe(true);
    });

    it("does not archive a character with no active field", () => {
      const { active: _active, ...rest } = npc;
      void _active;
      expect(mapNote(note("Vex", rest), "characters").archived).toBe(false);
      expect(mapNote(note("Vex", npc), "characters").archived).toBe(false);
    });

    it("collects faction and location wikilink targets", () => {
      const m = mapNote(note("Vex", npc), "characters");
      expect(m.factionTargets).toEqual(["Crown's Hand", "The Lucid Bloom"]);
      expect(m.locationTargets).toEqual(["Blackvein Quarry"]);
    });
  });

  describe("locations", () => {
    const loc = {
      type: "location", location_type: "Underground", region: "Dwendalian Empire", status: "Visited",
      parent: "[[Rexxentrum]]", description: "A flooded mine.", notion_id: "abc",
    };

    it("maps location_type to the Type property", () => {
      const m = mapNote(note("Blackvein Quarry", loc), "locations");
      expect(prop(m, "Type")).toBe("Underground");
      expect(m.sourceProps).toEqual([
        { label: "Type", value: "Underground" },
        { label: "Status", value: "Visited" },
        { label: "Region", value: "Dwendalian Empire" },
        { label: "Parent", value: "Rexxentrum" },
      ]);
    });

    it("never writes the hub type column", () => {
      const m = mapNote(note("Blackvein Quarry", loc), "locations");
      expect(m.extra).not.toHaveProperty("type");
      expect(m.extra).toEqual({ description: "A flooded mine." });
    });

    it("omits description from extra when the frontmatter field is blank", () => {
      for (const description of ["", "   ", null, undefined]) {
        const m = mapNote(note("Q", { ...loc, description }), "locations");
        expect(m.extra).not.toHaveProperty("description");
      }
    });

    it("collects the parent wikilink target", () => {
      expect(mapNote(note("Q", loc), "locations").parentTarget).toBe("Rexxentrum");
      expect(mapNote(note("Q", { ...loc, parent: undefined }), "locations").parentTarget).toBeUndefined();
    });

    it("never archives from the vault", () => {
      expect(mapNote(note("Q", { ...loc, active: false }), "locations").archived).toBe(false);
    });
  });

  describe("items", () => {
    it("maps item_type and rarity and collects held_by targets", () => {
      const m = mapNote(note("Cloak", { type: "item", item_type: "Wondrous", rarity: "Rare", held_by: ["[[Vex]]"], found_in: ["[[Quarry]]"] }), "items");
      expect(m.sourceProps).toEqual([
        { label: "Type", value: "Wondrous" },
        { label: "Rarity", value: "Rare" },
      ]);
      expect(m.heldByTargets).toEqual(["Vex"]);
      expect(m.archived).toBe(false);
      expect(m.extra).toEqual({});
    });
  });

  describe("factions", () => {
    it("maps faction_type and stance, and archives on active: false", () => {
      const data = { type: "faction", faction_type: "Guild", stance: "Friendly", headquarters: ["[[Rexxentrum]]"], active: false };
      const m = mapNote(note("Crown's Hand", data), "factions");
      expect(m.sourceProps).toEqual([
        { label: "Type", value: "Guild" },
        { label: "Alignment", value: "Friendly" },
        { label: "Headquarters", value: "Rexxentrum" },
      ]);
      expect(m.archived).toBe(true);
      expect(mapNote(note("Crown's Hand", { ...data, active: true }), "factions").archived).toBe(false);
      expect(mapNote(note("Crown's Hand", { ...data, active: undefined }), "factions").archived).toBe(false);
    });
  });

  describe("session notes", () => {
    it.each([
      ["session", undefined, "Session Notes"],
      ["arc", undefined, "Story Outline"],
      ["encounter", "combat", "Combat Encounter"],
      ["encounter", "social", "RP Encounter"],
      ["encounter", "exploration", "Exploration Encounter"],
      ["scene", "social", "Character Event"],
      ["scene", "combat", "Character Event"],
      ["scene", undefined, "Character Event"],
    ])("maps type %s / encounter_type %s to note_type %s", (type, cat, expected) => {
      const m = mapNote(note("N", { type, encounter_type: cat }), "sessionNotes");
      expect(m.extra.noteType).toBe(expected);
    });

    it("leaves note_type null for an encounter with no recognised category", () => {
      expect(mapNote(note("N", { type: "encounter" }), "sessionNotes").extra.noteType).toBeNull();
      expect(mapNote(note("N", { type: "encounter", encounter_type: "heist" }), "sessionNotes").extra.noteType).toBeNull();
    });

    it("stores the arc wikilink's display name, not its brackets", () => {
      const m = mapNote(note("N", { type: "session", arc: "[[Caught in the Web — Children of Malice]]" }), "sessionNotes");
      expect(m.extra.arc).toBe("Caught in the Web — Children of Malice");
      expect(prop(m, "Arc")).toBe("Caught in the Web — Children of Malice");
    });

    it("stores no arc when absent", () => {
      expect(mapNote(note("N", { type: "session" }), "sessionNotes").extra.arc).toBeNull();
    });

    it("shows encounter_type as the Category property on encounters and scenes", () => {
      expect(prop(mapNote(note("N", { type: "encounter", encounter_type: "combat" }), "sessionNotes"), "Category")).toBe("combat");
      expect(prop(mapNote(note("N", { type: "scene", encounter_type: "social" }), "sessionNotes"), "Category")).toBe("social");
      expect(labels(mapNote(note("N", { type: "session" }), "sessionNotes"))).not.toContain("Category");
    });

    it("normalises an unquoted frontmatter Date to an ISO day string", () => {
      const m = mapNote(note("N", { type: "session", date: new Date("2026-08-02T00:00:00.000Z") }), "sessionNotes");
      expect(m.extra.date).toBe("2026-08-02");
      expect(prop(m, "Date")).toBe("2026-08-02");
    });

    it("accepts a string date and rejects a malformed one", () => {
      expect(mapNote(note("N", { type: "session", date: "2026-07-19" }), "sessionNotes").extra.date).toBe("2026-07-19");
      const bad = mapNote(note("N", { type: "session", date: "sometime in July" }), "sessionNotes");
      expect(bad.extra.date).toBeNull();
      expect(labels(bad)).not.toContain("Date");
    });

    it("shows session number, status and featuring", () => {
      const m = mapNote(note("Session 31", { type: "session", session: 31, status: "Complete" }), "sessionNotes");
      expect(m.sourceProps).toEqual([
        { label: "Session", value: "31" },
        { label: "Status", value: "Complete" },
      ]);
      expect(m.extra.status).toBe("Complete");
      const scene = mapNote(note("S", { type: "scene", featuring: ["[[Vex]]", "[[Percy]]"] }), "sessionNotes");
      expect(prop(scene, "Featuring")).toBe("Vex, Percy");
    });

    it("collects location wikilink targets and falls back to settings strings", () => {
      const m = mapNote(note("N", { type: "session", locations: ["[[Blackvein Quarry]]", "[[Rexxentrum]]"], settings: ["Underdark", "Dungeon"] }), "sessionNotes");
      expect(m.locationTargets).toEqual(["Blackvein Quarry", "Rexxentrum"]);
      expect(m.settingNames).toEqual(["Underdark", "Dungeon"]);
      const bare = mapNote(note("N", { type: "session" }), "sessionNotes");
      expect(bare.locationTargets).toEqual([]);
      expect(bare.settingNames).toEqual([]);
    });
  });

  describe("suppression", () => {
    it("never shows type, tags, cssclasses, hub_id, notion_id or aliases as properties", () => {
      const suppressed = ["type", "tags", "cssclasses", "hub_id", "notion_id", "aliases"].map((s) => s.toLowerCase());
      const data = {
        type: "npc", tags: ["x"], cssclasses: ["wide"], hub_id: "h", notion_id: "n", aliases: ["Al"],
        race: "Elf", role: "Fence",
      };
      for (const table of ["characters", "locations", "items", "factions", "sessionNotes"] as const) {
        const m = mapNote(note("N", data), table);
        for (const p of m.sourceProps) expect(suppressed).not.toContain(p.label.toLowerCase());
        expect(JSON.stringify(m.sourceProps)).not.toMatch(/"Al"|"wide"|"h"|"n"/);
      }
    });
  });

  it("does not mutate note.data", () => {
    const data = Object.freeze({
      type: "session", date: new Date("2026-08-02T00:00:00.000Z"), arc: "[[A]]", settings: Object.freeze(["x"]),
    });
    const before = structuredClone(data);
    expect(() => mapNote(note("N", data as Record<string, unknown>), "sessionNotes")).not.toThrow();
    expect(data).toEqual(before);
  });
});
