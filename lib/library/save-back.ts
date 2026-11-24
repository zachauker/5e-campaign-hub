import { statBlockToUpload, type CharacterUploadSchema } from "@/lib/character-schema";
import type { LibraryEntry } from "@/lib/library/entry";
import type { CombatantWithParsed } from "@/lib/types";

/**
 * The sheet fields a combatant owns. A save-back overwrites these and leaves everything
 * else the entry stores (tags, notes, version, $schema, ...) exactly as it was.
 * Left out on purpose: `avatarUrl` (may be the entry's own /image URL) and `color` (a token
 * colour assigned per fight). `name` is owned only so that a save-back can drop it: a combatant's name is a per-fight label
 * ("Ogre 2", "Grik"), never the template's, so `saveBackPayload` never sends one.
 * `statBlock` is layered key by key, below.
 */
const OWNED_KEYS = ["name", "type", "ac", "hpMax", "speed", "initiativeBonus", "playerName"] as const;

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
  if (sheet.statBlock) merged.statBlock = { ...stored.statBlock, ...sheet.statBlock };
  return merged as unknown as CharacterUploadSchema;
}

/**
 * The PATCH body for "Save to library": the combatant's sheet layered over the entry's
 * stored one, with the entry's own name, `data.name` and tags kept exactly as they were.
 * Renaming a template belongs to the Bestiary, where the DM can see what they are renaming.
 */
export function saveBackPayload(entry: LibraryEntry, combatant: CombatantWithParsed) {
  const merged = mergeSheetOverStored(entry.data, { ...statBlockToUpload(combatant), name: undefined as unknown as string });
  return { ...merged, name: entry.data.name ?? entry.name, tags: entry.tags };
}
