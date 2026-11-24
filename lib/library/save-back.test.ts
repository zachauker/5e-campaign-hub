import { describe, expect, it } from "vitest";
import { mergeSheetOverStored, saveBackPayload } from "./save-back";
import type { LibraryEntry } from "./entry";
import type { CombatantWithParsed } from "@/lib/types";
import type { CharacterUploadSchema } from "@/lib/character-schema";

const stored = {
  version: 1,
  name: "Ogre",
  type: "monster",
  ac: 11,
  hpMax: 59,
  speed: 40,
  notes: "Weak to fire in the Ashen Keep",
  playerName: "Old",
  avatarUrl: "/api/library/x/image",
} as unknown as CharacterUploadSchema;

describe("mergeSheetOverStored", () => {
  it("takes the combatant's values and keeps notes, version and avatar", () => {
    const out = mergeSheetOverStored(stored, { name: "Ogre", type: "monster", ac: 14, hpMax: 40, speed: 40 });
    expect(out).toMatchObject({ ac: 14, hpMax: 40, notes: "Weak to fire in the Ashen Keep", version: 1, avatarUrl: "/api/library/x/image" });
  });

  it("removes an owned field the combatant has cleared", () => {
    const out = mergeSheetOverStored(stored, { name: "Ogre", type: "monster", ac: 11, hpMax: 59 });
    expect(out).not.toHaveProperty("playerName");
    expect(out).not.toHaveProperty("speed");
  });

  it("does not mutate the stored sheet", () => {
    mergeSheetOverStored(stored, { name: "Ogre", type: "monster", ac: 1, hpMax: 1 });
    expect(stored.ac).toBe(11);
  });

  it("layers statBlock so stored keys the combatant cannot hold survive", () => {
    const hb = { ...stored, color: "#111111", statBlock: { size: "Large", homebrewKey: "keep me", hitDice: "old" } } as unknown as CharacterUploadSchema;
    const out = mergeSheetOverStored(hb, { name: "Ogre", type: "monster", ac: 11, hpMax: 59, color: "#a78bfa", statBlock: { size: "Large", hitDice: "new" } });
    expect(out.statBlock).toMatchObject({ homebrewKey: "keep me", hitDice: "new" });
    expect(out.color).toBe("#111111");
  });
});

describe("saveBackPayload", () => {
  const entry = { id: "lib-1", name: "Goblin", type: "monster", data: { ...stored, name: "Goblin" }, imagePath: null, tags: ["undead", "boss"] } as unknown as LibraryEntry;
  const combatant = (over: Partial<CombatantWithParsed>) =>
    ({ id: "c1", name: "Goblin", type: "monster", ac: 15, hpMax: 12, speed: 30, initiativeBonus: 2, conditions: [], statBlock: null, ...over }) as unknown as CombatantWithParsed;

  it("does not rename the entry when the combatant was renamed", () => {
    const out = saveBackPayload(entry, combatant({ name: "Grik" }));
    expect(out.name).toBe("Goblin");
    expect(out).toMatchObject({ ac: 15, hpMax: 12 });
  });

  it("does not rename the entry when the combatant carries a trailing number", () => {
    expect(saveBackPayload(entry, combatant({ name: "Legion 7" })).name).toBe("Goblin");
  });

  it("keeps the entry's tags and notes", () => {
    const out = saveBackPayload(entry, combatant({}));
    expect(out.tags).toEqual(["undead", "boss"]);
    expect(out).toMatchObject({ notes: "Weak to fire in the Ashen Keep" });
  });
});
