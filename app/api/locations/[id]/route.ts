import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { locations, characterLocations, characters } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.query.locations.findFirst({ where: eq(locations.id, id) });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const links = await db.query.characterLocations.findMany({
    where: eq(characterLocations.locationId, id),
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
  const existing = await db.query.locations.findFirst({ where: eq(locations.id, id) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db
    .update(locations)
    .set({
      name: body.name ?? existing.name,
      notionUrl: body.notionUrl ?? existing.notionUrl,
      description: body.description ?? existing.description,
      updatedAt: new Date(),
    })
    .where(eq(locations.id, id));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.delete(locations).where(eq(locations.id, id));
  return NextResponse.json({ ok: true });
}
