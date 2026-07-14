import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessionNotes, sessionNoteLocations, locations, mapMarkers, maps } from "@/lib/db/schema";
import { eq, inArray, and } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.query.sessionNotes.findFirst({ where: eq(sessionNotes.id, id) });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const locLinks = await db.query.sessionNoteLocations.findMany({
    where: eq(sessionNoteLocations.sessionNoteId, id),
  });
  const linkedLocations =
    locLinks.length > 0
      ? await db.query.locations.findMany({ where: inArray(locations.id, locLinks.map((l) => l.locationId)) })
      : [];

  const markerLinks = await db.query.mapMarkers.findMany({
    where: and(eq(mapMarkers.entityId, id), eq(mapMarkers.type, "event")),
  });
  const mapMarkersResolved = await Promise.all(
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
    linkedLocations: linkedLocations.map((l) => ({ id: l.id, name: l.name, type: l.type })),
    mapMarkers: mapMarkersResolved,
    notionProps: row.notionProps
      ? (JSON.parse(row.notionProps) as Array<{ label: string; value: string }>)
      : [],
  });
}
