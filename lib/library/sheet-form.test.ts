import { describe, it, expect } from "vitest";
import {
  EXAMPLE_CHARACTER_JSON,
  characterUploadToCombatant,
  statBlockToUpload,
  validateCharacterUpload,
  type CharacterUploadSchema,
} from "@/lib/character-schema";
import { applySheetEdits, applySpeedText } from "@/lib/library/sheet-form";
import type { CombatantWithParsed } from "@/lib/types";

function ogre(over: Partial<CombatantWithParsed> = {}): CombatantWithParsed {
  const base = characterUploadToCombatant(
    {
      name: "Ogre",
      type: "monster",
      ac: 11,
      hpMax: 59,
      speed: 40,
      statBlock: { size: "Large", str: 19, actions: [{ name: "Greatclub", desc: "2d8+4" }] },
    },
    "enc-1"
  );
  return { ...base, ...over };
}

function sheetFrom(c: CombatantWithParsed, patch: Partial<CharacterUploadSchema>): CharacterUploadSchema {
  return { ...statBlockToUpload(c), ...patch };
}

describe("statBlockToUpload", () => {
  it("round-trips through characterUploadToCombatant unchanged", () => {
    const back = statBlockToUpload(characterUploadToCombatant(EXAMPLE_CHARACTER_JSON, "enc-1"));
    expect(validateCharacterUpload(back).valid).toBe(true);
    expect(back).toEqual({ ...EXAMPLE_CHARACTER_JSON, version: undefined });
  });

  it("handles a combatant with no statBlock", () => {
    const bare = characterUploadToCombatant({ name: "Grik", type: "npc", ac: 12, hpMax: 9 }, "enc-1");
    expect(bare.statBlock).toBeNull();
    const back = statBlockToUpload(bare);
    expect(validateCharacterUpload(back).valid).toBe(true);
    expect(back.statBlock).toBeUndefined();
    expect(back).toMatchObject({ name: "Grik", type: "npc", ac: 12, hpMax: 9 });
  });

  it("takes AC and max HP from the live columns, not the stat block", () => {
    const c = ogre({ ac: 15, hpMax: 80 });
    const back = statBlockToUpload(c);
    expect(back.ac).toBe(15);
    expect(back.hpMax).toBe(80);
  });
});

describe("validateCharacterUpload notes", () => {
  it("accepts a string notes field", () => {
    const r = validateCharacterUpload({ ...EXAMPLE_CHARACTER_JSON, notes: "Fights dirty." });
    expect(r.valid).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it("warns, without failing, on a non-string notes field", () => {
    const r = validateCharacterUpload({ ...EXAMPLE_CHARACTER_JSON, notes: 5 });
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => w.includes("notes"))).toBe(true);
  });
});

describe("applySheetEdits", () => {
  it("writes AC to both the flat column and the stat block", () => {
    const c = ogre();
    const out = applySheetEdits(c, sheetFrom(c, { ac: 18 }));
    expect(out.ac).toBe(18);
    expect(out.statBlock).toEqual(expect.objectContaining({ ac: 18 }));
  });

  it("clamps current HP when max HP drops below it", () => {
    const c = ogre({ hpCurrent: 50 });
    const out = applySheetEdits(c, sheetFrom(c, { hpMax: 40 }));
    expect(out).toMatchObject({ hpMax: 40, hpCurrent: 40 });
  });

  it("leaves current HP alone when max HP still exceeds it", () => {
    const c = ogre({ hpCurrent: 31 });
    const out = applySheetEdits(c, sheetFrom(c, { hpMax: 40 }));
    expect(out).toMatchObject({ hpMax: 40, hpCurrent: 31 });
  });

  it("never writes current HP into the stat block", () => {
    const c = ogre({ hpCurrent: 31 });
    const out = applySheetEdits(c, sheetFrom(c, { hpMax: 40 }));
    expect(out.statBlock?.hp).toBe(40);
    const same = applySheetEdits(c, sheetFrom(c, {}));
    expect(same.statBlock?.hp).toBe(59);
  });

  it("floors a zero or negative max HP at zero without NaN", () => {
    const c = ogre({ hpCurrent: 31 });
    for (const hpMax of [0, -5]) {
      const out = applySheetEdits(c, sheetFrom(c, { hpMax }));
      expect(out.hpMax).toBe(0);
      expect(out.hpCurrent).toBe(0);
      expect(out.statBlock?.hp).toBe(0);
    }
  });

  it("writes speed to both the flat column and the stat block text", () => {
    const c = ogre();
    expect(c.statBlock?.speed).toBe("40 ft.");
    const out = applySheetEdits(c, sheetFrom(c, { speed: 50 }));
    expect(out.speed).toBe(50);
    expect(out.statBlock?.speed).toBe("50 ft.");
  });

  it("keeps a speed text the DM edited themselves", () => {
    const c = ogre();
    const base = statBlockToUpload(c);
    const out = applySheetEdits(c, {
      ...base,
      speed: 50,
      statBlock: { ...base.statBlock, speed: "50 ft., fly 30 ft." },
    });
    expect(out.speed).toBe(50);
    expect(out.statBlock?.speed).toBe("50 ft., fly 30 ft.");
  });

  it("round-trips spellcasting through both converters and an edit", () => {
    const c = ogre({ statBlock: { ...ogre().statBlock!, spellcasting: "Innate: fog cloud" } });
    const sheet = statBlockToUpload(c);
    expect(sheet.statBlock?.spellcasting).toBe("Innate: fog cloud");
    expect(characterUploadToCombatant(sheet, "enc-1").statBlock?.spellcasting).toBe("Innate: fog cloud");
    expect(applySheetEdits(c, { ...sheet, ac: 12 }).statBlock?.spellcasting).toBe("Innate: fog cloud");
  });

  it("writes a null stat block when the sheet has none, and still updates the flat columns", () => {
    const c = ogre();
    const out = applySheetEdits(c, { ...statBlockToUpload(c), statBlock: undefined, ac: 14 });
    expect(out.statBlock).toBeNull();
    expect(out.ac).toBe(14);
  });

  it("does not touch per-fight notes or conditions", () => {
    const c = ogre({ notes: "bloodied" });
    const out = applySheetEdits(c, sheetFrom(c, { notes: "Sheet prep text" }));
    expect(out).not.toHaveProperty("notes");
    expect(out).not.toHaveProperty("conditions");
  });
});

describe("characterUploadToCombatant overrides", () => {
  const sheet: CharacterUploadSchema = {
    name: "Ogre",
    type: "monster",
    ac: 11,
    hpMax: 59,
    avatarUrl: "https://example.com/sheet.png",
    statBlock: { size: "Large" },
  };

  it("lets the entity's name and ids win over the sheet's", () => {
    const c = characterUploadToCombatant(sheet, "enc-1", {
      name: "Grik the Bandit",
      characterId: "ch-1",
      libraryId: "lib-1",
    });
    expect(c).toMatchObject({ name: "Grik the Bandit", characterId: "ch-1", libraryId: "lib-1", ac: 11, hpMax: 59 });
    expect(c.statBlock).toMatchObject({ size: "Large", ac: 11, hp: 59 });
  });

  it("lets an uploaded portrait's URL win over the sheet's imageUrl", () => {
    const c = characterUploadToCombatant(sheet, "enc-1", { avatarUrl: "/api/library/lib-1/image" });
    expect(c.avatarUrl).toBe("/api/library/lib-1/image");
  });

  it("changes nothing without overrides", () => {
    const c = characterUploadToCombatant(sheet, "enc-1");
    expect(c).toMatchObject({ name: "Ogre", characterId: null, libraryId: null, avatarUrl: sheet.avatarUrl });
  });
});

describe("applySpeedText", () => {
  const bare: CharacterUploadSchema = { name: "Guard", type: "npc", ac: 12, hpMax: 11, speed: 30 };

  it("writes the leading integer and the text when a stat block exists", () => {
    const out = applySpeedText({ ...bare, statBlock: { str: 10, speed: "30 ft." } }, "40 ft., fly 60 ft.");
    expect(out.speed).toBe(40);
    expect(out.statBlock).toEqual({ str: 10, speed: "40 ft., fly 60 ft." });
  });

  it("leaves speed alone when the text has no leading integer", () => {
    const out = applySpeedText({ ...bare, statBlock: { speed: "30 ft." } }, "fly 60 ft.");
    expect(out.speed).toBe(30);
    expect(out.statBlock?.speed).toBe("fly 60 ft.");
  });

  it("never creates a stat block on a bare NPC", () => {
    const out = applySpeedText(bare, "50 ft.");
    expect(out.speed).toBe(50);
    expect("statBlock" in out).toBe(false);
  });

  it("clearing the text removes statBlock.speed but keeps the stat block and speed", () => {
    const out = applySpeedText({ ...bare, statBlock: { str: 8, speed: "30 ft." } }, "");
    expect(out.speed).toBe(30);
    expect(out.statBlock).toEqual({ str: 8 });
  });
});
