import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, characterItems, characters } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.query.items.findFirst({ where: eq(items.id, id) });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const links = await db.query.characterItems.findMany({
    where: eq(characterItems.itemId, id),
  });
  const linkedCharacters =
    links.length > 0
      ? await db.query.characters.findMany({
          where: inArray(characters.id, links.map((l) => l.characterId)),
        })
      : [];

  return NextResponse.json({
    ...row,
    linkedCharacters: linkedCharacters.map((c) => ({ id: c.id, name: c.name, type: c.type })),
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const existing = await db.query.items.findFirst({ where: eq(items.id, id) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db
    .update(items)
    .set({
      name: body.name ?? existing.name,
      notionUrl: body.notionUrl ?? existing.notionUrl,
      description: body.description ?? existing.description,
      updatedAt: new Date(),
    })
    .where(eq(items.id, id));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.delete(items).where(eq(items.id, id));
  return NextResponse.json({ ok: true });
}
