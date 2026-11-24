import type { EncounterWithCombatants } from "@/lib/types";
import type { CombatantSave, EncounterSavePayload } from "./save";

/**
 * Everything the tracker can change during a fight, and nothing else.
 *
 * Used for the save that goes out as the page is being torn down. That request
 * has to be sent with `keepalive`, whose body limit is 64KB, and a real
 * encounter's stat blocks and cached D&D Beyond sheets run to tens of
 * kilobytes on their own — so they stay out of it. `saveEncounter` leaves any
 * field a payload omits exactly as it is, which is what makes this safe.
 */
export function combatSnapshot(encounter: EncounterWithCombatants): EncounterSavePayload {
  return {
    status: encounter.status,
    round: encounter.round,
    currentCombatantId: encounter.currentCombatantId,
    notes: encounter.notes,
    combatants: encounter.combatants.map(
      (c): CombatantSave => ({
        id: c.id,
        // Name and type ride along so a combatant whose POST never landed can
        // still be created from this payload rather than dropped.
        name: c.name,
        type: c.type,
        initiative: c.initiative,
        initiativeBonus: c.initiativeBonus,
        hpCurrent: c.hpCurrent,
        hpMax: c.hpMax,
        hpTemp: c.hpTemp,
        ac: c.ac,
        speed: c.speed,
        conditions: c.conditions,
        notes: c.notes,
        isConcentrating: c.isConcentrating,
        isVisible: c.isVisible,
        sortOrder: c.sortOrder,
        // Edited mid-fight, so they ride along. libraryId does not: it is fixed
        // at the add, and this payload is budget-limited.
        label: c.label,
        color: c.color,
      })
    ),
  };
}

/** The ordinary save: the full combatant records, stat blocks and all. */
export function fullSave(encounter: EncounterWithCombatants): EncounterSavePayload {
  return {
    status: encounter.status,
    round: encounter.round,
    currentCombatantId: encounter.currentCombatantId,
    notes: encounter.notes,
    combatants: encounter.combatants,
  };
}
