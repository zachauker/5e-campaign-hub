import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mapMarkers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const validTypes = ["location", "faction", "character", "submap", "note"];

export async function PATCH(req: Request, { params }: { params: Promise<{ markerId: string }> }) {
  const { markerId } = await params;
  const body = await req.json();
  const existing = await db.query.mapMarkers.findFirst({ where: eq(mapMarkers.id, markerId) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (body.type !== undefined && !validTypes.includes(body.type)) {
    return NextResponse.json({ error: `"type" must be one of ${validTypes.join(", ")}` }, { status: 400 });
  }

  await db
    .update(mapMarkers)
    .set({
      x: typeof body.x === "number" ? body.x : existing.x,
      y: typeof body.y === "number" ? body.y : existing.y,
      type: body.type ?? existing.type,
      entityId: body.entityId !== undefined ? body.entityId : existing.entityId,
      targetMapId: body.targetMapId !== undefined ? body.targetMapId : existing.targetMapId,
      title: body.title !== undefined ? body.title : existing.title,
      note: body.note !== undefined ? body.note : existing.note,
      minZoom: body.minZoom !== undefined ? body.minZoom : existing.minZoom,
      updatedAt: new Date(),
    })
    .where(eq(mapMarkers.id, markerId));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ markerId: string }> }) {
  const { markerId } = await params;
  await db.delete(mapMarkers).where(eq(mapMarkers.id, markerId));
  return NextResponse.json({ ok: true });
}
