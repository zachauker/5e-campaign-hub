import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characterLibrary, characters, combatants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { CharacterUploadSchema } from "@/lib/character-schema";
import { deleteLibraryImage } from "@/lib/library/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.query.characterLibrary.findFirst({
    where: eq(characterLibrary.id, id),
  });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...row, data: JSON.parse(row.data), tags: JSON.parse(row.tags) });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json() as Partial<CharacterUploadSchema & { tags: string[] }>;

  const existing = await db.query.characterLibrary.findFirst({
    where: eq(characterLibrary.id, id),
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The submitted sheet replaces `data`: the editor always holds a complete sheet, so a
  // field it omitted was cleared on purpose. `name` and `type` are columns too; a body
  // that lacks them keeps the row's values (and the stored sheet stays consistent).
  const { tags, ...characterData } = body;
  const nextData = {
    ...characterData,
    name: characterData.name ?? existing.name,
    type: characterData.type ?? existing.type,
  } as CharacterUploadSchema;

  await db
    .update(characterLibrary)
    .set({
      name: nextData.name,
      type: nextData.type,
      data: JSON.stringify(nextData),
      tags: tags ? JSON.stringify(tags) : existing.tags,
    })
    .where(eq(characterLibrary.id, id));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await db.query.characterLibrary.findFirst({
    where: eq(characterLibrary.id, id),
  });
  // combatants.library_id and characters.stat_sheet_id are plain foreign keys with no
  // ON DELETE clause, so an entry in use cannot be deleted until they let go of it.
  // Combatants keep their snapshot; they just stop pointing at the entry.
  db.transaction((tx) => {
    tx.update(combatants).set({ libraryId: null }).where(eq(combatants.libraryId, id)).run();
    tx.update(characters).set({ statSheetId: null }).where(eq(characters.statSheetId, id)).run();
    tx.delete(characterLibrary).where(eq(characterLibrary.id, id)).run();
  });
  if (existing?.imagePath) await deleteLibraryImage(existing.imagePath);
  return NextResponse.json({ ok: true });
}
