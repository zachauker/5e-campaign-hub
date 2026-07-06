import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { locations, characterLocations, characters, mapMarkers, maps } from "@/lib/db/schema";
import { eq, inArray, and } from "drizzle-orm";

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

  const markerLinks = await db.query.mapMarkers.findMany({
    where: and(eq(mapMarkers.entityId, id), eq(mapMarkers.type, "location")),
  });
  const resolvedMapMarkers = await Promise.all(
    markerLinks.map(async (link) => {
      const map = await db.query.maps.findFirst({ where: eq(maps.id, link.mapId) });
      return {
        mapId: link.mapId,
        mapName: map?.name ?? "Unknown map",
        markerId: link.id,
        renderMode: map?.renderMode ?? "static",
      };
    })
  );

  return NextResponse.json({
    ...row,
    linkedCharacters: linkedCharacters.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    mapMarkers: resolvedMapMarkers,
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const existing = await db.query.locations.findFirst({ where: eq(locations.id, id) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const LOCATION_TYPES = ["city", "town", "poi", "region", "other"];
  if (body.type !== undefined && !LOCATION_TYPES.includes(body.type)) {
    return NextResponse.json({ error: `"type" must be one of ${LOCATION_TYPES.join(", ")}` }, { status: 400 });
  }

  await db
    .update(locations)
    .set({
      name: body.name ?? existing.name,
      notionUrl: body.notionUrl ?? existing.notionUrl,
      description: body.description ?? existing.description,
      type: body.type ?? existing.type,
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
