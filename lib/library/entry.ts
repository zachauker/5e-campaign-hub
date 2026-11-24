import type { CharacterUploadSchema } from "@/lib/character-schema";

/** A library row as `/api/library` returns it, with `data` and `tags` already decoded. */
export interface LibraryEntry {
  id: string;
  name: string;
  type: CharacterUploadSchema["type"];
  data: CharacterUploadSchema;
  imagePath: string | null;
  tags: string[];
}
