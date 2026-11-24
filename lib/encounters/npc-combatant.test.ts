import { describe, it, expect } from "vitest";
import { npcToCombatant } from "./npc-combatant";
import { sourceKeyOf } from "./duplicates";
import type { LibraryEntry } from "@/lib/library/entry";

const sheet: LibraryEntry = {
  id: "lib1",
  name: "Bandit Captain",
  type: "monster",
  data: { name: "Bandit Captain", type: "monster", ac: 15, hpMax: 65 },
  imagePath: null,
  tags: [],
};

describe("npcToCombatant", () => {
  it("keeps the entity's name and id and takes stats and library id from the sheet", () => {
    const c = npcToCombatant({ id: "ch1", name: "Grik the Bandit", type: "npc" }, sheet, "enc1");
    expect(c.name).toBe("Grik the Bandit");
    expect(c.characterId).toBe("ch1");
    expect(c.libraryId).toBe("lib1");
    expect(c.ac).toBe(15);
    expect(c.hpMax).toBe(65);
    expect(c.type).toBe("npc");
  });

  it("keeps two NPCs built from one sheet as separate sources", () => {
    const a = npcToCombatant({ id: "ch1", name: "Grik", type: "npc" }, sheet, "enc1");
    const b = npcToCombatant({ id: "ch2", name: "Brenna", type: "npc" }, sheet, "enc1");
    expect(sourceKeyOf(a)).toBe("ch1");
    expect(sourceKeyOf(b)).toBe("ch2");
  });
});
