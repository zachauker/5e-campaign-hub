import type { CombatantWithParsed, StatBlock, Condition } from "@/lib/types";
import { generateId } from "@/lib/utils";

export const CHARACTER_SCHEMA_VERSION = "1.0";

export interface CharacterUploadSchema {
  $schema?: string;
  version?: string;

  name: string;
  type: "pc" | "npc" | "monster";
  ac: number;
  hpMax: number;
  speed?: number;
  initiativeBonus?: number;
  playerName?: string;
  avatarUrl?: string;
  color?: string;
  tags?: string[];

  statBlock?: {
    size?: string;
    type?: string;
    subtype?: string;
    alignment?: string;
    acNote?: string;
    hitDice?: string;
    speed?: string;
    str?: number;
    dex?: number;
    con?: number;
    int?: number;
    wis?: number;
    cha?: number;
    savingThrows?: Record<string, number>;
    skills?: Record<string, number>;
    damageVulnerabilities?: string;
    damageResistances?: string;
    damageImmunities?: string;
    conditionImmunities?: string;
    senses?: string;
    languages?: string;
    cr?: string;
    xp?: number;
    abilities?: Array<{ name: string; desc: string }>;
    actions?: Array<{ name: string; desc: string }>;
    bonusActions?: Array<{ name: string; desc: string }>;
    reactions?: Array<{ name: string; desc: string }>;
    legendaryActions?: Array<{ name: string; desc: string }>;
    imageUrl?: string;
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateCharacterUpload(data: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { valid: false, errors: ["Root must be a JSON object"], warnings: [] };
  }

  const d = data as Record<string, unknown>;

  if (!d.name || typeof d.name !== "string" || d.name.trim() === "") {
    errors.push('"name" is required and must be a non-empty string');
  }

  if (!["pc", "npc", "monster"].includes(d.type as string)) {
    errors.push('"type" must be "pc", "npc", or "monster"');
  }

  if (typeof d.ac !== "number" || d.ac < 0 || d.ac > 30) {
    errors.push('"ac" must be a number between 0 and 30');
  }

  if (typeof d.hpMax !== "number" || d.hpMax < 0) {
    errors.push('"hpMax" must be a non-negative number');
  }

  if (d.speed !== undefined && (typeof d.speed !== "number" || d.speed < 0)) {
    warnings.push('"speed" should be a non-negative number, defaulting to 30');
  }

  if (d.initiativeBonus !== undefined && typeof d.initiativeBonus !== "number") {
    warnings.push('"initiativeBonus" should be a number, defaulting to 0');
  }

  if (d.color !== undefined && typeof d.color === "string") {
    if (!/^#[0-9a-fA-F]{3,8}$/.test(d.color)) {
      warnings.push('"color" should be a hex color like "#c0392b"');
    }
  }

  if (d.statBlock && typeof d.statBlock === "object" && !Array.isArray(d.statBlock)) {
    const sb = d.statBlock as Record<string, unknown>;
    const statNames = ["str", "dex", "con", "int", "wis", "cha"];
    for (const stat of statNames) {
      if (sb[stat] !== undefined && (typeof sb[stat] !== "number" || (sb[stat] as number) < 1 || (sb[stat] as number) > 30)) {
        warnings.push(`"statBlock.${stat}" should be a number between 1 and 30`);
      }
    }

    for (const arrayField of ["abilities", "actions", "bonusActions", "reactions", "legendaryActions"]) {
      if (sb[arrayField] !== undefined) {
        if (!Array.isArray(sb[arrayField])) {
          warnings.push(`"statBlock.${arrayField}" should be an array`);
        } else {
          const arr = sb[arrayField] as unknown[];
          for (let i = 0; i < arr.length; i++) {
            const entry = arr[i] as Record<string, unknown>;
            if (!entry.name || !entry.desc) {
              warnings.push(`"statBlock.${arrayField}[${i}]" should have "name" and "desc" fields`);
            }
          }
        }
      }
    }
  } else if (d.type === "monster" && !d.statBlock) {
    warnings.push('Monsters usually have a "statBlock" — consider adding one');
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function characterUploadToCombatant(
  data: CharacterUploadSchema,
  encounterId: string
): CombatantWithParsed {
  const statBlock: StatBlock | null = data.statBlock
    ? {
        name: data.name,
        size: data.statBlock.size,
        type: data.statBlock.type,
        subtype: data.statBlock.subtype,
        alignment: data.statBlock.alignment,
        ac: data.ac,
        acNote: data.statBlock.acNote,
        hp: data.hpMax,
        hitDice: data.statBlock.hitDice,
        speed: data.statBlock.speed ?? `${data.speed ?? 30} ft.`,
        str: data.statBlock.str,
        dex: data.statBlock.dex,
        con: data.statBlock.con,
        int: data.statBlock.int,
        wis: data.statBlock.wis,
        cha: data.statBlock.cha,
        savingThrows: data.statBlock.savingThrows,
        skills: data.statBlock.skills,
        damageVulnerabilities: data.statBlock.damageVulnerabilities,
        damageResistances: data.statBlock.damageResistances,
        damageImmunities: data.statBlock.damageImmunities,
        conditionImmunities: data.statBlock.conditionImmunities,
        senses: data.statBlock.senses,
        languages: data.statBlock.languages,
        cr: data.statBlock.cr,
        xp: data.statBlock.xp,
        abilities: data.statBlock.abilities,
        actions: data.statBlock.actions,
        bonusActions: data.statBlock.bonusActions,
        reactions: data.statBlock.reactions,
        legendaryActions: data.statBlock.legendaryActions,
        imageUrl: data.statBlock.imageUrl ?? data.avatarUrl,
      }
    : null;

  return {
    id: generateId(),
    encounterId,
    name: data.name.trim(),
    type: data.type,
    initiative: null,
    initiativeBonus: data.initiativeBonus ?? 0,
    hpCurrent: data.hpMax,
    hpMax: data.hpMax,
    hpTemp: 0,
    ac: data.ac,
    speed: data.speed ?? 30,
    conditions: [] as Condition[],
    notes: null,
    isConcentrating: false,
    isVisible: true,
    sortOrder: 0,
    ddbCharacterId: null,
    monsterSlug: null,
    statBlock,
    avatarUrl: data.avatarUrl ?? data.statBlock?.imageUrl ?? null,
    playerName: data.playerName ?? null,
    color: data.color ?? null,
    characterId: null,
  };
}

export const EXAMPLE_CHARACTER_JSON: CharacterUploadSchema = {
  version: CHARACTER_SCHEMA_VERSION,
  name: "Theron Brightblade",
  type: "pc",
  ac: 18,
  hpMax: 52,
  speed: 30,
  initiativeBonus: 2,
  playerName: "Alice",
  color: "#4a90d9",
  statBlock: {
    size: "Medium",
    type: "humanoid",
    subtype: "human",
    alignment: "lawful good",
    acNote: "plate armor",
    hitDice: "6d10+12",
    str: 18,
    dex: 14,
    con: 14,
    int: 10,
    wis: 12,
    cha: 16,
    speed: "30 ft.",
    savingThrows: { STR: 7, CON: 5 },
    skills: { Athletics: 7, Persuasion: 6, Perception: 3 },
    senses: "passive Perception 13",
    languages: "Common, Elvish",
    abilities: [
      {
        name: "Second Wind",
        desc: "Once per short rest, regain 1d10+6 HP as a bonus action.",
      },
      {
        name: "Action Surge",
        desc: "Once per short rest, take an additional action on your turn.",
      },
    ],
    actions: [
      {
        name: "Longsword",
        desc: "Melee Weapon Attack: +7 to hit, reach 5 ft., one target. Hit: 1d8+4 slashing damage, or 1d10+4 if wielded with two hands.",
      },
      {
        name: "Multiattack",
        desc: "Theron makes two melee attacks.",
      },
    ],
    bonusActions: [],
    reactions: [
      {
        name: "Parry",
        desc: "Add 3 to AC against one melee attack using a reaction while holding a melee weapon.",
      },
    ],
  },
};
