import { describe, it, expect } from "vitest";
import type { CombatantWithParsed } from "@/lib/types";
import {
  TOKEN_PALETTE,
  baseName,
  duplicateGroups,
  isRenamedByHand,
  planAdd,
  sourceKeyOf,
  tokenIndexOf,
} from "./duplicates";

let seq = 0;
function make(over: Partial<CombatantWithParsed> = {}): CombatantWithParsed {
  seq += 1;
  return {
    id: `c${seq}`,
    encounterId: "e1",
    name: "Goblin",
    type: "monster",
    initiative: null,
    initiativeBonus: 0,
    hpCurrent: 7,
    hpMax: 7,
    hpTemp: 0,
    ac: 13,
    speed: 30,
    conditions: [],
    notes: null,
    isConcentrating: false,
    isVisible: true,
    sortOrder: seq,
    ddbCharacterId: null,
    monsterSlug: "goblin",
    statBlock: null,
    avatarUrl: null,
    playerName: null,
    color: null,
    label: null,
    libraryId: null,
    characterId: null,
    ...over,
  };
}

describe("TOKEN_PALETTE", () => {
  it("has 8 distinct hex colours", () => {
    expect(TOKEN_PALETTE).toHaveLength(8);
    expect(new Set(TOKEN_PALETTE).size).toBe(8);
    for (const c of TOKEN_PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("sourceKeyOf", () => {
  it("prefers monsterSlug, then characterId, then the base name", () => {
    expect(
      sourceKeyOf({ monsterSlug: "goblin", characterId: "ch1", name: "Goblin 2" }),
    ).toBe("goblin");
    expect(
      sourceKeyOf({ monsterSlug: null, characterId: "ch1", name: "Grik" }),
    ).toBe("ch1");
    expect(
      sourceKeyOf({ monsterSlug: null, characterId: null, name: "Bandit 3" }),
    ).toBe("Bandit");
  });
});

describe("baseName", () => {
  it("strips a trailing ordinal", () => expect(baseName("Goblin 2")).toBe("Goblin"));
  it("leaves a name that merely ends in a word alone", () =>
    expect(baseName("Ogre")).toBe("Ogre"));
  it("keeps a numeral that is part of the name", () =>
    expect(baseName("Zone 9 Sentinel")).toBe("Zone 9 Sentinel"));
});

describe("isRenamedByHand", () => {
  it("is false for the plain or numbered source name", () => {
    expect(isRenamedByHand("Goblin", "Goblin")).toBe(false);
    expect(isRenamedByHand("Goblin 4", "Goblin")).toBe(false);
  });
  it("is true for a different name", () => {
    expect(isRenamedByHand("Grik", "Goblin")).toBe(true);
  });
});

describe("duplicateGroups", () => {
  it("excludes a lone combatant", () => {
    const groups = duplicateGroups([
      make(),
      make({ name: "Ogre", monsterSlug: "ogre" }),
    ]);
    expect(groups.size).toBe(0);
  });

  it("groups two combatants sharing a monsterSlug", () => {
    const a = make({ name: "Goblin 1" });
    const b = make({ name: "Goblin 2" });
    const groups = duplicateGroups([a, make({ name: "Ogre", monsterSlug: "ogre" }), b]);
    expect(groups.size).toBe(1);
    expect(groups.get("goblin")?.map((c) => c.id)).toEqual([a.id, b.id]);
  });

  it("keeps two NPCs with different characterIds apart even from one sheet", () => {
    const a = make({ name: "Guard", type: "npc", monsterSlug: null, characterId: "ch1" });
    const b = make({ name: "Guard", type: "npc", monsterSlug: null, characterId: "ch2" });
    expect(duplicateGroups([a, b]).size).toBe(0);
  });
});

describe("tokenIndexOf", () => {
  it("returns null for a lone combatant", () => {
    const a = make();
    expect(tokenIndexOf([a, make({ monsterSlug: "ogre", name: "Ogre" })], a.id)).toBeNull();
  });

  it("numbers group members from 1 in sortOrder when names carry no ordinal", () => {
    const second = make({ sortOrder: 20 });
    const first = make({ sortOrder: 10 });
    const list = [second, first];
    expect(tokenIndexOf(list, first.id)).toBe(1);
    expect(tokenIndexOf(list, second.id)).toBe(2);
  });

  it("does not renumber survivors when a middle member is removed", () => {
    const g1 = make({ name: "Goblin 1" });
    const g2 = make({ name: "Goblin 2" });
    const g3 = make({ name: "Goblin 3" });
    expect(tokenIndexOf([g1, g2, g3], g3.id)).toBe(3);
    const survivors = [g1, g3];
    expect(tokenIndexOf(survivors, g1.id)).toBe(1);
    expect(tokenIndexOf(survivors, g3.id)).toBe(3);
  });

  it("returns null for an unknown id", () => {
    expect(tokenIndexOf([make(), make()], "nope")).toBeNull();
  });
});

describe("planAdd", () => {
  const incoming = { name: "Goblin", sourceKey: "goblin", sourceName: "Goblin" };

  it("leaves the first copy unnumbered", () => {
    const plan = planAdd([], incoming);
    expect(plan.name).toBe("Goblin");
    expect(plan.renameFirst).toBeNull();
    expect(plan.color).toBe(TOKEN_PALETTE[0]);
  });

  it("numbers the second copy and renames the first", () => {
    const first = make({ name: "Goblin" });
    const plan = planAdd([first], incoming);
    expect(plan.name).toBe("Goblin 2");
    expect(plan.renameFirst).toEqual({
      id: first.id,
      name: "Goblin 1",
      color: TOKEN_PALETTE[0],
    });
    expect(plan.color).toBe(TOKEN_PALETTE[1]);
  });

  it("leaves a hand-renamed first copy alone but still numbers the newcomer", () => {
    const grik = make({ name: "Grik" });
    const plan = planAdd([grik], incoming);
    expect(plan.renameFirst).toBeNull();
    expect(plan.name).toBe("Goblin 2");
  });

  it("continues past the highest ordinal rather than reusing a freed number", () => {
    const g1 = make({ name: "Goblin 1" });
    const g3 = make({ name: "Goblin 3" });
    const plan = planAdd([g1, g3], incoming);
    expect(plan.name).toBe("Goblin 4");
    expect(plan.renameFirst).toBeNull();
  });

  it("ignores combatants from other sources", () => {
    const ogre = make({ name: "Ogre", monsterSlug: "ogre" });
    const plan = planAdd([ogre], incoming);
    expect(plan.name).toBe("Goblin");
    expect(plan.renameFirst).toBeNull();
  });

  it("assigns distinct palette colours to each copy", () => {
    const first = make({ name: "Goblin" });
    const p2 = planAdd([first], incoming);
    const second = make({ name: p2.name, color: p2.color });
    const p3 = planAdd([{ ...first, name: "Goblin 1", color: p2.renameFirst!.color }, second], incoming);
    expect(new Set([p2.renameFirst!.color, p2.color, p3.color]).size).toBe(3);
  });

  it("wraps the palette for a group larger than it", () => {
    const existing: CombatantWithParsed[] = [];
    for (let i = 0; i < 12; i++) {
      const plan = planAdd(existing, incoming);
      if (plan.renameFirst) {
        const f = existing.find((c) => c.id === plan.renameFirst!.id)!;
        f.name = plan.renameFirst.name;
        f.color = plan.renameFirst.color;
      }
      existing.push(make({ name: plan.name, color: plan.color }));
    }
    expect(existing).toHaveLength(12);
    for (const c of existing) {
      expect(c.color).toBeDefined();
      expect(TOKEN_PALETTE).toContain(c.color);
    }
    expect(existing[8].color).toBe(TOKEN_PALETTE[0]);
    expect(existing[11].name).toBe("Goblin 12");
  });
});
