import type { CharacterUploadSchema } from "@/lib/character-schema";

/**
 * Resolves the portrait to draw for a library entry, in order: the uploaded
 * file, the sheet's remote image, the avatar URL. Null means the caller should
 * draw the creature's type icon instead.
 */
export function portraitUrl(entry: {
  id: string;
  imagePath: string | null;
  data: CharacterUploadSchema;
}): string | null {
  if (entry.imagePath) return `/api/library/${entry.id}/image`;
  return entry.data.statBlock?.imageUrl ?? entry.data.avatarUrl ?? null;
}
