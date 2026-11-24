import { describe, expect, it } from "vitest";
import { mergeSheetOverStored } from "./save-back";
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
});
