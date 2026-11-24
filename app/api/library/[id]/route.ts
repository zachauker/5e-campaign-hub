import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characterLibrary } from "@/lib/db/schema";
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

  const currentData = JSON.parse(existing.data) as CharacterUploadSchema;
  const { tags, ...characterData } = body;
  const mergedData = { ...currentData, ...characterData };

  await db
    .update(characterLibrary)
    .set({
      name: mergedData.name ?? existing.name,
      type: mergedData.type ?? existing.type,
      data: JSON.stringify(mergedData),
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
  await db.delete(characterLibrary).where(eq(characterLibrary.id, id));
  if (existing?.imagePath) await deleteLibraryImage(existing.imagePath);
  return NextResponse.json({ ok: true });
}
