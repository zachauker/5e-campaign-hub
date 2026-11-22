import { describe, it, expect } from "vitest";
import { combatSnapshot, fullSave } from "./payload";
import type { EncounterWithCombatants, StatBlock, DDBCharacter } from "@/lib/types";

const statBlock = { name: "Hobgoblin Captain", actions: [{ name: "Greatsword", desc: "x".repeat(4000) }] } as StatBlock;
const ddbCharacter = { id: 1, name: "Garrick", level: 7, ac: 16, maxHp: 40, spells: Array.from({ length: 40 }, () => ({ name: "Fireball", desc: "y".repeat(500) })) } as unknown as DDBCharacter;

function encounter(): EncounterWithCombatants {
  return {
    id: "enc1",
    campaignId: "camp",
    name: "Ambush on the Ashkeeper Road",
    status: "active",
    round: 3,
    currentCombatantId: "c2",
    notes: "They fled toward the ford.",
    createdAt: new Date(1),
    updatedAt: new Date(1),
    combatants: [
      {
        id: "c1", encounterId: "enc1", name: "Garrick Veldros", type: "pc",
        initiative: 18, initiativeBonus: 3, hpCurrent: 12, hpMax: 40, hpTemp: 5,
        ac: 16, speed: 30, conditions: ["poisoned"], notes: null,
        isConcentrating: true, isVisible: true, sortOrder: 0,
        characterId: null, ddbCharacterId: "1", monsterSlug: null,
        statBlock: null, ddbCharacter, avatarUrl: "http://x/a.png", playerName: "Zach", color: null,
      },
      {
        id: "c2", encounterId: "enc1", name: "Hobgoblin Captain", type: "monster",
        initiative: 14, initiativeBonus: 2, hpCurrent: 11, hpMax: 39, hpTemp: 0,
        ac: 17, speed: 30, conditions: ["frightened"], notes: null,
        isConcentrating: false, isVisible: true, sortOrder: 1,
        characterId: null, ddbCharacterId: null, monsterSlug: "hobgoblin-captain",
        statBlock, ddbCharacter: null, avatarUrl: null, playerName: null, color: null,
      },
    ],
  };
}

describe("combatSnapshot", () => {
  it("keeps every field the tracker can change during a fight", () => {
    const snap = combatSnapshot(encounter());
    expect(snap).toMatchObject({
      status: "active", round: 3, currentCombatantId: "c2",
      notes: "They fled toward the ford.",
    });
    expect(snap.combatants![0]).toMatchObject({
      id: "c1", name: "Garrick Veldros", type: "pc", initiative: 18,
      hpCurrent: 12, hpMax: 40, hpTemp: 5, ac: 16,
      conditions: ["poisoned"], isConcentrating: true, isVisible: true, sortOrder: 0,
    });
  });

  it("omits the heavy fields rather than sending them as null", () => {
    const snap = combatSnapshot(encounter());
    for (const c of snap.combatants!) {
      expect("statBlock" in c).toBe(false);
      expect("ddbCharacter" in c).toBe(false);
      expect("avatarUrl" in c).toBe(false);
    }
  });

  it("stays far inside the 64KB keepalive body limit that the full save blows past", () => {
    const enc = encounter();
    const snapBytes = new TextEncoder().encode(JSON.stringify(combatSnapshot(enc))).length;
    const fullBytes = new TextEncoder().encode(JSON.stringify(fullSave(enc))).length;

    expect(snapBytes).toBeLessThan(2 * 1024);
    expect(fullBytes).toBeGreaterThan(20 * 1024); // two combatants already
  });
});
