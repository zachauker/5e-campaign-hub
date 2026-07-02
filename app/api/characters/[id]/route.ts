import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characters, characterFactions, characterLocations, characterItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.query.characters.findFirst({ where: eq(characters.id, id) });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [factionLinks, locationLinks, itemLinks] = await Promise.all([
    db.query.characterFactions.findMany({ where: eq(characterFactions.characterId, id) }),
    db.query.characterLocations.findMany({ where: eq(characterLocations.characterId, id) }),
    db.query.characterItems.findMany({ where: eq(characterItems.characterId, id) }),
  ]);

  return NextResponse.json({
    ...row,
    factionIds: factionLinks.map((l) => l.factionId),
    locationIds: locationLinks.map((l) => l.locationId),
    itemIds: itemLinks.map((l) => l.itemId),
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const existing = await db.query.characters.findFirst({ where: eq(characters.id, id) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db
    .update(characters)
    .set({
      name: body.name ?? existing.name,
      type: body.type ?? existing.type,
      ddbCharacterId: body.ddbCharacterId ?? existing.ddbCharacterId,
      notionUrl: body.notionUrl ?? existing.notionUrl,
      description: body.description ?? existing.description,
      updatedAt: new Date(),
    })
    .where(eq(characters.id, id));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.delete(characters).where(eq(characters.id, id));
  return NextResponse.json({ ok: true });
}
