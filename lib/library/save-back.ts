import type { CharacterUploadSchema } from "@/lib/character-schema";

/**
 * The sheet fields a combatant owns. A save-back overwrites these and leaves everything
 * else the entry stores (tags, notes, version, $schema, ...) exactly as it was.
 * `avatarUrl` is deliberately not here: a combatant's avatar may be the entry's own
 * /image URL, and writing that back would replace the entry's remote image setting.
 */
const OWNED_KEYS = ["name", "type", "ac", "hpMax", "speed", "initiativeBonus", "playerName", "color", "statBlock"] as const;

/**
 * Layers a combatant's sheet over a library entry's stored sheet.
 *
 * PATCH /api/library/[id] replaces `data`, and a combatant cannot carry the entry's prep
 * notes or tags, so sending the combatant's sheet raw would wipe them. An owned field the
 * combatant has empty (a cleared player name) is removed rather than inherited.
 */
export function mergeSheetOverStored(stored: CharacterUploadSchema, sheet: CharacterUploadSchema): CharacterUploadSchema {
  const merged: Record<string, unknown> = { ...stored };
  for (const key of OWNED_KEYS) {
    if (sheet[key] === undefined) delete merged[key];
    else merged[key] = sheet[key];
  }
  return merged as unknown as CharacterUploadSchema;
}
