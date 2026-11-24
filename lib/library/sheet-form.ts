import { characterUploadToCombatant, type CharacterUploadSchema } from "@/lib/character-schema";
import type { CombatantWithParsed } from "@/lib/types";

/**
 * What an editor save writes to a combatant.
 *
 * AC, max HP and speed live twice (flat columns and inside `statBlock`); an edit
 * writes both so the row and the sheet never disagree. Current HP is fight state:
 * it is only clamped to the new maximum, and is never written into the stat block,
 * whose `hp` is the creature's maximum. Per-fight `notes` and `conditions` are not touched.
 */
export function applySheetEdits(
  c: CombatantWithParsed,
  sheet: CharacterUploadSchema
): Partial<CombatantWithParsed> {
  const hpMax = Math.max(0, sheet.hpMax);
  // statBlock.speed is text and wins over the flat speed when present. If only the
  // flat speed was edited, drop the stale text so it is re-derived from the new speed.
  const speedEdited = sheet.speed !== c.speed && sheet.statBlock?.speed === c.statBlock?.speed;
  const statBlock = speedEdited && sheet.statBlock ? { ...sheet.statBlock, speed: undefined } : sheet.statBlock;
  const converted = characterUploadToCombatant({ ...sheet, hpMax, statBlock }, c.encounterId);

  return {
    name: converted.name,
    type: converted.type,
    ac: converted.ac,
    hpMax,
    hpCurrent: Math.min(c.hpCurrent, hpMax),
    speed: converted.speed,
    initiativeBonus: converted.initiativeBonus,
    playerName: converted.playerName,
    avatarUrl: converted.avatarUrl,
    color: converted.color,
    // Keep stat block fields the sheet has no home for .
    statBlock: converted.statBlock && { ...c.statBlock, ...converted.statBlock },
  };
}

/**
 * Applies a typed speed ("30 ft.", "40 ft., fly 60 ft.") to a sheet.
 * A leading integer becomes the flat `speed`; with none, `speed` is left alone
 * rather than becoming 0 or NaN. The text goes to `statBlock.speed` only when
 * the sheet already has a stat block, so a bare NPC never grows one from its speed.
 */
export function applySpeedText(sheet: CharacterUploadSchema, text: string): CharacterUploadSchema {
  const next: CharacterUploadSchema = { ...sheet };
  const lead = /^\s*(\d+)/.exec(text);
  if (lead) next.speed = Number(lead[1]);
  if (sheet.statBlock) {
    const sb = { ...sheet.statBlock };
    if (text.trim() === "") delete sb.speed;
    else sb.speed = text;
    next.statBlock = sb;
  }
  return next;
}
