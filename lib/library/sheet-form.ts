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
  const converted = characterUploadToCombatant({ ...sheet, hpMax }, c.encounterId);

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
    // Keep stat block fields the sheet has no home for (e.g. spellcasting).
    statBlock: converted.statBlock && { ...c.statBlock, ...converted.statBlock },
  };
}
