import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  locations,
  characterLocations,
  characters,
  mapMarkers,
  maps,
  sessionNoteLocations,
  sessionNotes,
} from "@/lib/db/schema";
import { eq, inArray, and } from "drizzle-orm";
import { syncEntityToIndex } from "@/lib/run/index-sync";
import { parseSourceProps } from "@/lib/vault/props";
import { omitLegacyColumns } from "@/lib/entities/legacy-columns";

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

  const noteLinks = await db.query.sessionNoteLocations.findMany({
    where: eq(sessionNoteLocations.locationId, id),
  });
  const linkedSessionNotes =
    noteLinks.length > 0
      ? await db.query.sessionNotes.findMany({
          where: inArray(sessionNotes.id, noteLinks.map((l) => l.sessionNoteId)),
        })
      : [];

  return NextResponse.json({
    ...omitLegacyColumns(row),
    linkedCharacters: linkedCharacters.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    mapMarkers: resolvedMapMarkers,
    linkedSessionNotes: linkedSessionNotes
      .filter((n) => !n.archived)
      .map((n) => ({ id: n.id, name: n.name, noteType: n.noteType, date: n.date })),
    // The raw column is a JSON string; the page reads the decoded list.
    sourceProps: parseSourceProps(row.sourceProps),
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
      description: body.description ?? existing.description,
      type: body.type ?? existing.type,
      updatedAt: new Date(),
    })
    .where(eq(locations.id, id));

  try {
    await syncEntityToIndex(db, existing.campaignId, "location", id);
  } catch (err) {
    // A failed index write must never fail the entity write that caused it —
    // the index is a derived convenience and Settings can rebuild it.
    console.warn("[search-index] sync failed:", (err as Error).message);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [deleted] = await db.delete(locations).where(eq(locations.id, id)).returning();

  if (deleted) {
    try {
      await syncEntityToIndex(db, deleted.campaignId, "location", id);
    } catch (err) {
      // A failed index write must never fail the entity write that caused it —
      // the index is a derived convenience and Settings can rebuild it.
      console.warn("[search-index] sync failed:", (err as Error).message);
    }
  }

  return NextResponse.json({ ok: true });
}
