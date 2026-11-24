import { characterUploadToCombatant } from "@/lib/character-schema";
import type { CombatantWithParsed } from "@/lib/types";
import type { LibraryEntry } from "@/lib/library/entry";
import { portraitUrl } from "@/lib/library/portrait";

/**
 * A campaign character entity brought into a fight from its linked stat sheet.
 * The entity owns the identity (name, id, and so duplicate grouping); the sheet
 * supplies only the stats and the library link.
 */
export function npcToCombatant(
  character: { id: string; name: string; type: string },
  entry: LibraryEntry,
  encounterId: string,
): CombatantWithParsed {
  const combatant = characterUploadToCombatant(entry.data, encounterId, {
    name: character.name,
    characterId: character.id,
    libraryId: entry.id,
    avatarUrl: portraitUrl(entry),
  });
  // The entity says whether this is a PC or an NPC, whatever kind the sheet is filed as.
  combatant.type = character.type === "pc" ? "pc" : "npc";
  return combatant;
}
