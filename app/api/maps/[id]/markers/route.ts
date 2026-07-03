import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mapMarkers, maps, characters, locations, factions } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { eq } from "drizzle-orm";

async function resolveMarkerLabel(
  marker: typeof mapMarkers.$inferSelect
): Promise<{ resolvedTitle: string; resolvedSubtitle: string | null }> {
  if (marker.type === "note") {
    return { resolvedTitle: marker.title || "Note", resolvedSubtitle: null };
  }
  if (marker.type === "submap") {
    const target = marker.targetMapId
      ? await db.query.maps.findFirst({ where: eq(maps.id, marker.targetMapId) })
      : null;
    return {
      resolvedTitle: marker.title || target?.name || "Sub-map",
      resolvedSubtitle: target ? null : "Map not found",
    };
  }
  if (!marker.entityId) {
    return { resolvedTitle: marker.title || "Untitled", resolvedSubtitle: "Entity not found" };
  }
  let entityName: string | undefined;
  if (marker.type === "character") {
    entityName = (await db.query.characters.findFirst({ where: eq(characters.id, marker.entityId) }))?.name;
  } else if (marker.type === "location") {
    entityName = (await db.query.locations.findFirst({ where: eq(locations.id, marker.entityId) }))?.name;
  } else if (marker.type === "faction") {
    entityName = (await db.query.factions.findFirst({ where: eq(factions.id, marker.entityId) }))?.name;
  }
  return {
    resolvedTitle: marker.title || entityName || "Untitled",
    resolvedSubtitle: entityName ? null : "Entity not found",
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await db.query.mapMarkers.findMany({ where: eq(mapMarkers.mapId, id) });
  const resolved = await Promise.all(rows.map(async (m) => ({ ...m, ...(await resolveMarkerLabel(m)) })));
  return NextResponse.json(resolved);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  if (typeof body.x !== "number" || typeof body.y !== "number") {
    return NextResponse.json({ error: '"x" and "y" must be numbers' }, { status: 400 });
  }
  const validTypes = ["location", "faction", "character", "submap", "note"];
  if (!validTypes.includes(body.type)) {
    return NextResponse.json({ error: `"type" must be one of ${validTypes.join(", ")}` }, { status: 400 });
  }

  const now = new Date();
  const [marker] = await db
    .insert(mapMarkers)
    .values({
      id: generateId(),
      mapId: id,
      x: body.x,
      y: body.y,
      type: body.type,
      entityId: body.entityId ?? null,
      targetMapId: body.targetMapId ?? null,
      title: body.title ?? null,
      note: body.note ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return NextResponse.json(marker, { status: 201 });
}
