import type { DDBCharacter, DDBSpell, DDBFeature, DDBAttack, StatBlock } from "@/lib/types";

// DDB's character-list API (character-service.dndbeyond.com) is blocked for
// server-side requests via Cloudflare TLS fingerprinting — all attempts return
// empty 404s regardless of headers. The public /character/{id}/json endpoint
// is unprotected and works reliably. Use share URLs.
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.dndbeyond.com",
  Referer: "https://www.dndbeyond.com/",
};

export async function fetchPublicCharacter(shareUrl: string): Promise<DDBCharacter> {
  const idMatch = shareUrl.match(/\/characters\/(\d+)/) ?? shareUrl.match(/^(\d+)$/);
  if (!idMatch) throw new Error("Paste a full D&D Beyond character URL or just the numeric ID");
  const id = idMatch[1];
  const res = await fetch(`https://www.dndbeyond.com/character/${id}/json`, {
    headers: BROWSER_HEADERS,
  });
  if (!res.ok) throw new Error(`Failed to fetch character ${id} (${res.status})`);
  const json = await res.json();
  return parseDDBCharacter(json);
}

// ---------------------------------------------------------------------------
// Stat helpers
// ---------------------------------------------------------------------------

function getRawStat(stats: Array<{ id: number; value: number | null }>, id: number): number {
  return stats.find((s) => s.id === id)?.value ?? 10;
}

function getProficiencyBonus(level: number): number {
  return Math.ceil(level / 4) + 1;
}

function getModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

// ---------------------------------------------------------------------------
// Modifier system
// DDB stores every bonus/proficiency as entries in a flat modifiers array
// broken into subgroups: class, race, background, feat, item, etc.
// ---------------------------------------------------------------------------

interface DDBModifier {
  type: string;           // "bonus" | "proficiency" | "expertise" | "half-proficiency" | ...
  subType: string;        // "strength-saving-throws" | "stealth" | etc.
  value: number | null;
  entityTypeId?: number;
  entityId?: number;
  isGranted?: boolean;
}

function collectModifiers(raw: Record<string, unknown>): DDBModifier[] {
  const modifiers = raw.modifiers;
  if (!modifiers || typeof modifiers !== "object" || Array.isArray(modifiers)) return [];
  return Object.values(modifiers as Record<string, unknown>)
    .flatMap((v) => (Array.isArray(v) ? v : [])) as DDBModifier[];
}

function getModifierBonus(mods: DDBModifier[], type: string, subType: string): number {
  return mods
    .filter((m) => m.type === type && m.subType === subType)
    .reduce((sum, m) => sum + (m.value ?? 0), 0);
}

function hasProficiency(mods: DDBModifier[], subType: string): boolean {
  return mods.some(
    (m) => (m.type === "proficiency" || m.type === "half-proficiency" || m.type === "expertise") && m.subType === subType
  );
}

function hasExpertise(mods: DDBModifier[], subType: string): boolean {
  return mods.some((m) => m.type === "expertise" && m.subType === subType);
}

// ---------------------------------------------------------------------------
// Saving throws
// ---------------------------------------------------------------------------

const SAVE_STAT_MAP: Record<string, string> = {
  "strength-saving-throws": "str",
  "dexterity-saving-throws": "dex",
  "constitution-saving-throws": "con",
  "intelligence-saving-throws": "int",
  "wisdom-saving-throws": "wis",
  "charisma-saving-throws": "cha",
};

function parseSavingThrows(
  mods: DDBModifier[],
  statScores: Record<string, number>,
  profBonus: number
): Record<string, { total: number; proficient: boolean }> {
  const result: Record<string, { total: number; proficient: boolean }> = {};
  for (const [subType, stat] of Object.entries(SAVE_STAT_MAP)) {
    const base = getModifier(statScores[stat] ?? 10);
    const prof = hasProficiency(mods, subType);
    const bonus = getModifierBonus(mods, "bonus", subType);
    result[stat] = {
      total: base + (prof ? profBonus : 0) + bonus,
      proficient: prof,
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

const SKILL_MAP: Array<{ name: string; subType: string; ability: string }> = [
  { name: "acrobatics", subType: "acrobatics", ability: "dex" },
  { name: "animal-handling", subType: "animal-handling", ability: "wis" },
  { name: "arcana", subType: "arcana", ability: "int" },
  { name: "athletics", subType: "athletics", ability: "str" },
  { name: "deception", subType: "deception", ability: "cha" },
  { name: "history", subType: "history", ability: "int" },
  { name: "insight", subType: "insight", ability: "wis" },
  { name: "intimidation", subType: "intimidation", ability: "cha" },
  { name: "investigation", subType: "investigation", ability: "int" },
  { name: "medicine", subType: "medicine", ability: "wis" },
  { name: "nature", subType: "nature", ability: "int" },
  { name: "perception", subType: "perception", ability: "wis" },
  { name: "performance", subType: "performance", ability: "cha" },
  { name: "persuasion", subType: "persuasion", ability: "cha" },
  { name: "religion", subType: "religion", ability: "int" },
  { name: "sleight-of-hand", subType: "sleight-of-hand", ability: "dex" },
  { name: "stealth", subType: "stealth", ability: "dex" },
  { name: "survival", subType: "survival", ability: "wis" },
];

function parseSkills(
  mods: DDBModifier[],
  statScores: Record<string, number>,
  profBonus: number
): Record<string, { total: number; proficient: boolean; expertise: boolean; ability: string }> {
  const result: Record<string, { total: number; proficient: boolean; expertise: boolean; ability: string }> = {};
  for (const { name, subType, ability } of SKILL_MAP) {
    const base = getModifier(statScores[ability] ?? 10);
    const prof = hasProficiency(mods, subType);
    const exp = hasExpertise(mods, subType);
    const bonus = getModifierBonus(mods, "bonus", subType);
    const profAmount = exp ? profBonus * 2 : prof ? profBonus : 0;
    result[name] = {
      total: base + profAmount + bonus,
      proficient: prof || exp,
      expertise: exp,
      ability,
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// AC calculation
// ---------------------------------------------------------------------------

function calculateAC(raw: Record<string, unknown>): { ac: number; note: string } {
  const inventory = Array.isArray(raw.inventory)
    ? (raw.inventory as Array<{
        equipped: boolean;
        definition: { armorClass?: number; name?: string; type?: string; baseArmorName?: string };
        isAttuned?: boolean;
      }>)
    : [];

  const stats = Array.isArray(raw.stats)
    ? (raw.stats as Array<{ id: number; value: number | null }>)
    : [];
  const dex = stats.find((s) => s.id === 2)?.value ?? 10;
  const dexMod = getModifier(dex);
  const con = stats.find((s) => s.id === 3)?.value ?? 10;

  const classes = Array.isArray(raw.classes)
    ? (raw.classes as Array<{ definition: { name: string } }>)
    : [];
  const classNames = classes.map((c) => c.definition.name.toLowerCase());

  // Equipped armor
  const armorItems = inventory.filter(
    (i) =>
      i.equipped &&
      i.definition?.armorClass != null &&
      i.definition?.type !== "Shield"
  );
  const shields = inventory.filter(
    (i) => i.equipped && i.definition?.type === "Shield"
  );
  const shieldBonus = shields.length > 0 ? 2 : 0;

  if (armorItems.length > 0) {
    const armor = armorItems[0];
    const baseAC = armor.definition.armorClass! + shieldBonus;
    const armorType = armor.definition.baseArmorName ?? armor.definition.name ?? "";
    // Light armor adds full dex mod, medium adds up to +2, heavy adds 0
    const isLight = /leather|padded|studded/i.test(armorType);
    const isMedium = /hide|chain shirt|scale|breastplate|half plate/i.test(armorType);
    const isHeavy = /ring|chain mail|splint|plate/i.test(armorType);
    if (isHeavy) return { ac: baseAC, note: armorType };
    if (isMedium) return { ac: baseAC + Math.min(2, dexMod), note: armorType };
    if (isLight) return { ac: baseAC + dexMod, note: armorType };
    // Fallback: treat as light
    return { ac: baseAC + dexMod, note: armorType };
  }

  // Unarmored defense
  if (classNames.includes("barbarian")) {
    return { ac: 10 + dexMod + getModifier(con), note: "Unarmored Defense" };
  }
  if (classNames.includes("monk")) {
    const wis = stats.find((s) => s.id === 5)?.value ?? 10;
    return { ac: 10 + dexMod + getModifier(wis), note: "Unarmored Defense" };
  }

  // Natural armor override
  const overrideAC = (raw.overrideHitPoints as number) ?? null; // reuse field check
  return { ac: 10 + dexMod + shieldBonus, note: "Unarmored" };
}

// ---------------------------------------------------------------------------
// HP
// ---------------------------------------------------------------------------

function calculateMaxHP(raw: Record<string, unknown>): number {
  const overrideHp = raw.overrideHitPoints as number;
  if (overrideHp) return overrideHp;
  const baseHp = (raw.baseHitPoints as number) ?? 0;
  const bonusHp = (raw.bonusHitPoints as number) ?? 0;
  const classes = (raw.classes as Array<{ definition: { name: string }; level: number }>) ?? [];
  const totalLevel = classes.reduce((sum, c) => sum + c.level, 0);
  const stats = (raw.stats as Array<{ id: number; value: number | null }>) ?? [];
  const conScore = stats.find((s) => s.id === 3)?.value ?? 10;
  const conMod = getModifier(conScore);
  return baseHp + bonusHp + conMod * totalLevel;
}

// ---------------------------------------------------------------------------
// Hit dice
// ---------------------------------------------------------------------------

const CLASS_HIT_DIE: Record<string, number> = {
  barbarian: 12,
  fighter: 10,
  paladin: 10,
  ranger: 10,
  bard: 8,
  cleric: 8,
  druid: 8,
  monk: 8,
  rogue: 8,
  warlock: 8,
  artificer: 8,
  sorcerer: 6,
  wizard: 6,
};

function parseHitDice(
  classes: Array<{ definition: { name: string }; level: number }>
): { hitDice: string; hitDiceRemaining: Record<string, number> } {
  const grouped: Record<string, number> = {};
  for (const cls of classes) {
    const die = CLASS_HIT_DIE[cls.definition.name.toLowerCase()] ?? 8;
    const key = `d${die}`;
    grouped[key] = (grouped[key] ?? 0) + cls.level;
  }
  const hitDice = Object.entries(grouped)
    .map(([die, count]) => `${count}${die}`)
    .join("+");
  // DDB stores used hit dice per class; we'll default to full remaining
  return { hitDice, hitDiceRemaining: { ...grouped } };
}

// ---------------------------------------------------------------------------
// Speed
// ---------------------------------------------------------------------------

function getBaseSpeed(raw: Record<string, unknown>): number {
  const race = (raw.race as Record<string, unknown>) ?? {};
  const normal = (race.weightSpeeds as Record<string, unknown>)?.normal;
  // normal can be a plain number OR an object like { walk, fly, burrow, swim, climb }
  if (typeof normal === "number") return normal;
  if (normal && typeof normal === "object") {
    const walk = (normal as Record<string, unknown>).walk;
    if (typeof walk === "number") return walk;
  }
  return 30;
}

// ---------------------------------------------------------------------------
// Spell slots
// ---------------------------------------------------------------------------

// Standard full-caster spell slot progression (PHB table)
const FULL_CASTER_SLOTS: number[][] = [
  /*1*/ [2],
  /*2*/ [3, 2],
  /*3*/ [4, 3, 2],
  /*4*/ [4, 3, 3],
  /*5*/ [4, 3, 3, 1],
  /*6*/ [4, 3, 3, 2],
  /*7*/ [4, 3, 3, 3, 1],
  /*8*/ [4, 3, 3, 3, 2],
  /*9*/ [4, 3, 3, 3, 3, 1],
  /*10*/ [4, 3, 3, 3, 3, 2],
  /*11*/ [4, 3, 3, 3, 3, 2, 1],
  /*12*/ [4, 3, 3, 3, 3, 2, 1],
  /*13*/ [4, 3, 3, 3, 3, 2, 1, 1],
  /*14*/ [4, 3, 3, 3, 3, 2, 1, 1],
  /*15*/ [4, 3, 3, 3, 3, 2, 1, 1, 1],
  /*16*/ [4, 3, 3, 3, 3, 2, 1, 1, 1],
  /*17*/ [4, 3, 3, 3, 3, 2, 1, 1, 1, 1],
  /*18*/ [4, 3, 3, 3, 3, 3, 1, 1, 1, 1],
  /*19*/ [4, 3, 3, 3, 3, 3, 2, 1, 1, 1],
  /*20*/ [4, 3, 3, 3, 3, 3, 2, 2, 1, 1],
];

const HALF_CASTER_SLOTS: number[][] = [
  /*1*/ [],
  /*2*/ [2],
  /*3*/ [3],
  /*4*/ [3],
  /*5*/ [4, 2],
  /*6*/ [4, 2],
  /*7*/ [4, 3],
  /*8*/ [4, 3],
  /*9*/ [4, 3, 2],
  /*10*/ [4, 3, 2],
  /*11*/ [4, 3, 3],
  /*12*/ [4, 3, 3],
  /*13*/ [4, 3, 3, 1],
  /*14*/ [4, 3, 3, 1],
  /*15*/ [4, 3, 3, 2],
  /*16*/ [4, 3, 3, 2],
  /*17*/ [4, 3, 3, 3, 1],
  /*18*/ [4, 3, 3, 3, 1],
  /*19*/ [4, 3, 3, 3, 2],
  /*20*/ [4, 3, 3, 3, 2],
];

const WARLOCK_SLOTS: Array<{ slots: number; level: number }> = [
  /*1*/ { slots: 1, level: 1 },
  /*2*/ { slots: 2, level: 1 },
  /*3*/ { slots: 2, level: 2 },
  /*4*/ { slots: 2, level: 2 },
  /*5*/ { slots: 2, level: 3 },
  /*6*/ { slots: 2, level: 3 },
  /*7*/ { slots: 2, level: 4 },
  /*8*/ { slots: 2, level: 4 },
  /*9*/ { slots: 2, level: 5 },
  /*10*/ { slots: 2, level: 5 },
  /*11*/ { slots: 3, level: 5 },
  /*12*/ { slots: 3, level: 5 },
  /*13*/ { slots: 3, level: 5 },
  /*14*/ { slots: 3, level: 5 },
  /*15*/ { slots: 3, level: 5 },
  /*16*/ { slots: 3, level: 5 },
  /*17*/ { slots: 4, level: 5 },
  /*18*/ { slots: 4, level: 5 },
  /*19*/ { slots: 4, level: 5 },
  /*20*/ { slots: 4, level: 5 },
];

const FULL_CASTERS = new Set(["bard", "cleric", "druid", "sorcerer", "wizard"]);
const HALF_CASTERS = new Set(["artificer", "paladin", "ranger"]);

function parseSpellSlots(
  classes: Array<{ definition: { name: string }; level: number }>,
  raw: Record<string, unknown>
): Record<number, { used: number; max: number }> | undefined {
  // DDB stores used pact/spell slot info
  const spellSlots = (raw.spellSlots as Array<{ level: number; used: number; available: number }>) ?? [];
  const pactMagic = (raw.pactMagic as Array<{ level: number; used: number; available: number }>) ?? [];

  const classNames = classes.map((c) => c.definition.name.toLowerCase());
  const hasSpells = classNames.some(
    (n) => FULL_CASTERS.has(n) || HALF_CASTERS.has(n) || n === "warlock"
  );
  if (!hasSpells) return undefined;

  const result: Record<number, { used: number; max: number }> = {};

  // Use DDB's own slot data if present
  if (spellSlots.length > 0) {
    for (const s of spellSlots) {
      if (s.available > 0) {
        result[s.level] = { max: s.available, used: s.used ?? 0 };
      }
    }
  }

  // Pact magic (Warlock)
  if (pactMagic.length > 0) {
    for (const s of pactMagic) {
      if (s.available > 0) {
        result[s.level] = { max: s.available, used: s.used ?? 0 };
      }
    }
  }

  // If DDB gave us nothing, compute from class levels
  if (Object.keys(result).length === 0) {
    let casterLevel = 0;
    let hasWarlock = false;
    let warlockLevel = 0;

    for (const cls of classes) {
      const name = cls.definition.name.toLowerCase();
      if (FULL_CASTERS.has(name)) casterLevel += cls.level;
      else if (HALF_CASTERS.has(name)) casterLevel += Math.floor(cls.level / 2);
      else if (name === "warlock") { hasWarlock = true; warlockLevel = cls.level; }
    }

    if (casterLevel > 0) {
      const table = FULL_CASTERS.has(classNames[0]) ? FULL_CASTER_SLOTS : HALF_CASTER_SLOTS;
      const row = table[Math.min(casterLevel, 20) - 1] ?? [];
      row.forEach((max, i) => { if (max > 0) result[i + 1] = { max, used: 0 }; });
    }

    if (hasWarlock && warlockLevel > 0) {
      const entry = WARLOCK_SLOTS[Math.min(warlockLevel, 20) - 1];
      if (entry) result[entry.level] = { max: entry.slots, used: 0 };
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

// ---------------------------------------------------------------------------
// Spellcasting ability
// ---------------------------------------------------------------------------

const CLASS_SPELL_ABILITY: Record<string, string> = {
  bard: "cha",
  cleric: "wis",
  druid: "wis",
  paladin: "cha",
  ranger: "wis",
  sorcerer: "cha",
  warlock: "cha",
  wizard: "int",
  artificer: "int",
};

const ABILITY_SCORES_BY_NAME: Record<string, number> = {
  str: 1, dex: 2, con: 3, int: 4, wis: 5, cha: 6,
};

function parseSpellcastingInfo(
  classes: Array<{ definition: { name: string }; level: number }>,
  statScores: Record<string, number>,
  profBonus: number
): { ability?: string; dc?: number; bonus?: number } {
  for (const cls of classes) {
    const name = cls.definition.name.toLowerCase();
    const ability = CLASS_SPELL_ABILITY[name];
    if (ability) {
      const mod = getModifier(statScores[ability] ?? 10);
      return { ability, dc: 8 + profBonus + mod, bonus: profBonus + mod };
    }
  }
  return {};
}

// ---------------------------------------------------------------------------
// Spells
// ---------------------------------------------------------------------------

type RawSpellEntry = {
  definition: {
    name: string;
    level: number;
    school?: { name?: string };
    activation?: { activationType?: number; activationTime?: number };
    range?: { origin?: string; rangeValue?: number; aoeType?: string };
    duration?: { durationInterval?: number; durationUnit?: string; concentration?: boolean };
    components?: number[];
    description?: string;
  };
  prepared: boolean;
  alwaysPrepared?: boolean;
};

function parseSpells(raw: Record<string, unknown>): DDBSpell[] {
  // DDB stores spells in classSpells (array of per-class groups) as the primary source.
  // raw.spells may be absent, null, or an object — never rely on it being a flat array.
  const classSpellGroups =
    (raw.classSpells as Array<{ spells: RawSpellEntry[] }>) ?? [];

  // Flatten all class spell arrays
  const spellbook: RawSpellEntry[] = classSpellGroups.flatMap(
    (group) => (Array.isArray(group?.spells) ? group.spells : [])
  );

  // Also pick up racial / feat / background spells stored in raw.spells if it is an array
  if (Array.isArray(raw.spells)) {
    spellbook.push(...(raw.spells as RawSpellEntry[]));
  }

  // Deduplicate by name+level (in case the same spell appears in multiple sources)
  const seen = new Set<string>();
  const deduped = spellbook.filter((s) => {
    const key = `${s.definition?.name}:${s.definition?.level}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const activationMap: Record<number, string> = {
    1: "1 Action",
    2: "1 Bonus Action",
    3: "1 Reaction",
    4: "1 Minute",
    5: "10 Minutes",
    6: "1 Hour",
  };

  return deduped.map((s) => {
    const def = s.definition;
    const compNums = def.components ?? [];
    const compStr = [
      compNums.includes(1) ? "V" : "",
      compNums.includes(2) ? "S" : "",
      compNums.includes(3) ? "M" : "",
    ]
      .filter(Boolean)
      .join(", ");
    const durConc = def.duration?.concentration ?? false;
    const durStr = def.duration?.durationInterval
      ? `${def.duration.durationInterval} ${def.duration.durationUnit ?? ""}`
      : "Instantaneous";
    const rangeStr = def.range?.rangeValue
      ? `${def.range.rangeValue} ft.`
      : def.range?.origin ?? "Self";
    const activationType = def.activation?.activationType ?? 1;
    const castingTime = activationMap[activationType] ?? "1 Action";

    return {
      name: def.name,
      level: def.level,
      school: def.school?.name,
      castingTime,
      range: rangeStr,
      duration: durConc ? `Concentration, ${durStr}` : durStr,
      concentration: durConc,
      components: compStr || undefined,
      desc: def.description ? stripHtml(def.description) : undefined,
      prepared: s.prepared,
      alwaysPrepared: s.alwaysPrepared,
    };
  });
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

function parseFeatures(raw: Record<string, unknown>): DDBFeature[] {
  const classFeatures = Array.isArray(raw.classFeatures)
    ? (raw.classFeatures as Array<{
        definition: { name: string; description?: string; level?: number };
        classDefinition?: { name: string };
      }>)
    : [];

  const racialTraits = Array.isArray(raw.racialTraits)
    ? (raw.racialTraits as Array<{ definition: { name: string; description?: string } }>)
    : [];

  const feats = Array.isArray(raw.feats)
    ? (raw.feats as Array<{ definition: { name: string; description?: string } }>)
    : [];

  const features: DDBFeature[] = [];

  for (const f of classFeatures) {
    if (!f.definition?.name) continue;
    features.push({
      name: f.definition.name,
      desc: f.definition.description ? stripHtml(f.definition.description) : "",
      source: f.classDefinition?.name ?? "Class",
      level: f.definition.level,
    });
  }

  for (const t of racialTraits) {
    if (!t.definition?.name) continue;
    features.push({
      name: t.definition.name,
      desc: t.definition.description ? stripHtml(t.definition.description) : "",
      source: "Race",
    });
  }

  for (const feat of feats) {
    if (!feat.definition?.name) continue;
    features.push({
      name: feat.definition.name,
      desc: feat.definition.description ? stripHtml(feat.definition.description) : "",
      source: "Feat",
    });
  }

  return features;
}

// ---------------------------------------------------------------------------
// Attacks
// ---------------------------------------------------------------------------

function parseAttacks(
  raw: Record<string, unknown>,
  statScores: Record<string, number>,
  profBonus: number,
  mods: DDBModifier[]
): DDBAttack[] {
  const inventory = Array.isArray(raw.inventory)
    ? (raw.inventory as Array<{
        equipped: boolean;
        definition: {
          name: string;
          attackType?: number;
          damage?: { diceString?: string; diceMultiplier?: number };
          damageType?: { name?: string };
          range?: number;
          longRange?: number;
          isMonkWeapon?: boolean;
        };
        isAttuned?: boolean;
      }>)
    : [];

  const attacks: DDBAttack[] = [];
  const strMod = getModifier(statScores.str ?? 10);
  const dexMod = getModifier(statScores.dex ?? 10);

  for (const item of inventory) {
    if (!item.equipped) continue;
    const def = item.definition;
    if (!def?.attackType && !def?.damage?.diceString) continue;

    const isRanged = def.attackType === 2;
    // Finesse: use higher of str/dex
    const isFinesseWeapon = /rapier|shortsword|dagger|dart|hand crossbow/i.test(def.name);
    const abilityMod = isRanged || (isFinesseWeapon && dexMod > strMod) ? dexMod : strMod;

    const bonusToHit = getModifierBonus(mods, "bonus", "magic-item-attack-rolls");
    const toHit = abilityMod + profBonus + bonusToHit;

    const rangeStr = def.range
      ? isRanged
        ? `${def.range}/${def.longRange ?? def.range} ft.`
        : `5 ft. (reach) / ${def.range}/${def.longRange ?? def.range} ft.`
      : "5 ft.";

    attacks.push({
      name: def.name,
      toHit,
      damageRoll: def.damage?.diceString
        ? `${def.damage.diceString}+${abilityMod}`
        : undefined,
      damageType: def.damageType?.name,
      range: rangeStr,
    });
  }

  return attacks;
}

// ---------------------------------------------------------------------------
// Class resources
// ---------------------------------------------------------------------------

function parseClassResources(
  raw: Record<string, unknown>
): Array<{ name: string; used: number; max: number }> {
  const limitedUse = Array.isArray(raw.classFeatures)
    ? (raw.classFeatures as Array<{
        limitedUse?: { maxUses?: number; numberUsed?: number } | null;
        definition?: { name?: string };
      }>)
    : [];

  const resources: Array<{ name: string; used: number; max: number }> = [];
  const seen = new Set<string>();

  for (const f of limitedUse) {
    if (!f.limitedUse?.maxUses || !f.definition?.name) continue;
    if (seen.has(f.definition.name)) continue;
    seen.add(f.definition.name);
    resources.push({
      name: f.definition.name,
      max: f.limitedUse.maxUses,
      used: f.limitedUse.numberUsed ?? 0,
    });
  }

  return resources;
}

// ---------------------------------------------------------------------------
// Proficiencies & languages
// ---------------------------------------------------------------------------

function parseProficiencies(mods: DDBModifier[]): {
  languages: string[];
  armor: string[];
  weapons: string[];
  tools: string[];
} {
  const languages: string[] = [];
  const armor: string[] = [];
  const weapons: string[] = [];
  const tools: string[] = [];

  for (const m of mods) {
    if (m.type !== "language" && m.type !== "proficiency") continue;
    const sub = m.subType;
    if (m.type === "language") {
      languages.push(formatProfName(sub));
    } else if (sub?.includes("armor") || sub?.includes("-armor")) {
      armor.push(formatProfName(sub));
    } else if (sub?.includes("weapons") || sub?.includes("-weapons") || sub?.includes("-weapon")) {
      weapons.push(formatProfName(sub));
    } else if (sub && !SKILL_MAP.some((s) => s.subType === sub) && !Object.values(SAVE_STAT_MAP).includes(sub) && !sub.includes("saving-throws")) {
      // Likely a tool proficiency
      if (!sub.includes("ability-checks")) tools.push(formatProfName(sub));
    }
  }

  return {
    languages: [...new Set(languages)],
    armor: [...new Set(armor)],
    weapons: [...new Set(weapons)],
    tools: [...new Set(tools)],
  };
}

function formatProfName(s: string): string {
  return s
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Personality traits & character info
// ---------------------------------------------------------------------------

function parseCharacterInfo(
  raw: Record<string, unknown>
): Pick<DDBCharacter, "personalityTraits" | "ideals" | "bonds" | "flaws" | "appearance" | "backstory"> {
  const notes = (raw.notes as Record<string, unknown>) ?? {};
  const traits = (raw.traits as Record<string, unknown>) ?? {};

  return {
    personalityTraits: (traits.personalityTraits as string) || undefined,
    ideals: (traits.ideals as string) || undefined,
    bonds: (traits.bonds as string) || undefined,
    flaws: (traits.flaws as string) || undefined,
    appearance: (notes.appearance as string) || undefined,
    backstory: (notes.backstory as string) || undefined,
  };
}

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

function parseCurrency(raw: Record<string, unknown>) {
  const c = (raw.currencies as Record<string, number>) ?? {};
  return {
    cp: c.cp ?? 0,
    sp: c.sp ?? 0,
    ep: c.ep ?? 0,
    gp: c.gp ?? 0,
    pp: c.pp ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

function parseDDBCharacter(raw: Record<string, unknown>): DDBCharacter {
  const stats = (raw.stats as Array<{ id: number; value: number | null }>) ?? [];

  const statScores = {
    str: getRawStat(stats, 1),
    dex: getRawStat(stats, 2),
    con: getRawStat(stats, 3),
    int: getRawStat(stats, 4),
    wis: getRawStat(stats, 5),
    cha: getRawStat(stats, 6),
  };

  const classes =
    (raw.classes as Array<{
      definition: { name: string };
      subclassDefinition?: { name: string };
      level: number;
    }>) ?? [];

  const totalLevel = classes.reduce((sum, c) => sum + c.level, 0);
  const profBonus = getProficiencyBonus(totalLevel);
  const dexMod = getModifier(statScores.dex);
  const preferences = (raw.preferences as Record<string, unknown>) ?? {};
  const mods = collectModifiers(raw);

  const { ac, note: acNote } = calculateAC(raw);
  const maxHp = calculateMaxHP(raw);
  const { hitDice, hitDiceRemaining } = parseHitDice(classes);
  const savingThrows = parseSavingThrows(mods, statScores, profBonus);
  const skills = parseSkills(mods, statScores, profBonus);
  const spellSlots = parseSpellSlots(classes, raw);
  const spells = parseSpells(raw);
  const features = parseFeatures(raw);
  const attacks = parseAttacks(raw, statScores, profBonus, mods);
  const classResources = parseClassResources(raw);
  const proficiencies = parseProficiencies(mods);
  const charInfo = parseCharacterInfo(raw);
  const currency = parseCurrency(raw);
  const spellcastingInfo = parseSpellcastingInfo(classes, statScores, profBonus);

  const wisMod = getModifier(statScores.wis);
  const insightSkill = skills["insight"];
  const investigationSkill = skills["investigation"];
  const passivePerception = 10 + (skills["perception"]?.total ?? wisMod);
  const passiveInsight = 10 + (insightSkill?.total ?? wisMod);
  const passiveInvestigation = 10 + (investigationSkill?.total ?? getModifier(statScores.int));

  const background = (raw.background as Record<string, unknown>)?.definition as Record<string, unknown>;
  const backgroundName = (background?.name as string) ?? undefined;

  const alignment = (() => {
    const id = raw.alignmentId as number;
    const map: Record<number, string> = {
      1: "Lawful Good", 2: "Neutral Good", 3: "Chaotic Good",
      4: "Lawful Neutral", 5: "True Neutral", 6: "Chaotic Neutral",
      7: "Lawful Evil", 8: "Neutral Evil", 9: "Chaotic Evil",
    };
    return map[id];
  })();

  return {
    id: raw.id as number,
    name: (raw.name as string) ?? "Unknown",
    race: ((raw.race as Record<string, unknown>)?.fullName as string) ?? undefined,
    subrace: ((raw.race as Record<string, unknown>)?.subRaceShortName as string) ?? undefined,
    classes: classes.map((c) => ({
      name: c.definition.name,
      subclass: c.subclassDefinition?.name,
      level: c.level,
    })),
    level: totalLevel || 1,
    background: backgroundName,
    alignment,
    ac,
    acNote,
    maxHp,
    currentHp:
      raw.removedHitPoints != null
        ? maxHp - (raw.removedHitPoints as number)
        : undefined,
    tempHp: (raw.temporaryHitPoints as number) ?? 0,
    hitDice,
    hitDiceRemaining,
    initiativeBonus: dexMod + ((preferences.initiativeBonus as number) ?? 0),
    speed: getBaseSpeed(raw),
    avatarUrl: (raw.avatarUrl as string) ?? undefined,
    playerName:
      ((raw.campaign as Record<string, unknown>)?.dmUsername as string) ?? undefined,
    inspiration: (raw.inspiration as boolean) ?? false,
    stats: statScores,
    savingThrows,
    skills,
    proficiencyBonus: profBonus,
    passivePerception,
    passiveInsight,
    passiveInvestigation,
    spellcastingAbility: spellcastingInfo.ability,
    spellSaveDC: spellcastingInfo.dc,
    spellAttackBonus: spellcastingInfo.bonus,
    spellSlots,
    spells: spells.length > 0 ? spells : undefined,
    features: features.length > 0 ? features : undefined,
    attacks: attacks.length > 0 ? attacks : undefined,
    classResources: classResources.length > 0 ? classResources : undefined,
    languages: proficiencies.languages.length > 0 ? proficiencies.languages : undefined,
    armorProficiencies: proficiencies.armor.length > 0 ? proficiencies.armor : undefined,
    weaponProficiencies: proficiencies.weapons.length > 0 ? proficiencies.weapons : undefined,
    toolProficiencies: proficiencies.tools.length > 0 ? proficiencies.tools : undefined,
    currency,
    deathSaveSuccesses: (raw.deathSaves as Record<string, unknown>)?.successCount as number ?? 0,
    deathSaveFailures: (raw.deathSaves as Record<string, unknown>)?.failCount as number ?? 0,
    ...charInfo,
  };
}

// Fuller mapping than AddCombatantDialog's inline version (which only needs
// name/AC/HP/stats for a quick combat add) — this one is for a character's
// own reference/detail page, so it also surfaces proficient saves, skills,
// and passive perception.
export function ddbCharacterToStatBlock(char: DDBCharacter): StatBlock {
  const classSummary = char.classes
    ?.map((c) => `${c.name}${c.subclass ? ` (${c.subclass})` : ""} ${c.level}`)
    .join(" / ");

  const savingThrows = Object.fromEntries(
    Object.entries(char.savingThrows)
      .filter(([, v]) => v.proficient)
      .map(([k, v]) => [k, v.total])
  );

  const skills = Object.fromEntries(
    Object.entries(char.skills)
      .filter(([, v]) => v.proficient || v.expertise)
      .map(([k, v]) => [k, v.total])
  );

  return {
    name: char.name,
    type: classSummary ?? "Character",
    subtype: char.race,
    ac: char.ac,
    acNote: char.acNote,
    hp: char.maxHp,
    hitDice: char.hitDice,
    speed: `${char.speed} ft.`,
    str: char.stats.str,
    dex: char.stats.dex,
    con: char.stats.con,
    int: char.stats.int,
    wis: char.stats.wis,
    cha: char.stats.cha,
    savingThrows: Object.keys(savingThrows).length > 0 ? savingThrows : undefined,
    skills: Object.keys(skills).length > 0 ? skills : undefined,
    senses: `passive Perception ${char.passivePerception}`,
    imageUrl: char.avatarUrl,
  };
}
