import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mapFeatures } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const VALID_TYPES = ["region", "road", "label"];

export async function PATCH(req: Request, { params }: { params: Promise<{ featureId: string }> }) {
  const { featureId } = await params;
  const body = await req.json();
  const existing = await db.query.mapFeatures.findFirst({ where: eq(mapFeatures.id, featureId) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (body.type !== undefined && !VALID_TYPES.includes(body.type)) {
    return NextResponse.json({ error: `"type" must be one of ${VALID_TYPES.join(", ")}` }, { status: 400 });
  }

  await db
    .update(mapFeatures)
    .set({
      type: body.type ?? existing.type,
      name: body.name !== undefined ? body.name : existing.name,
      geometry: body.geometry !== undefined ? JSON.stringify(body.geometry) : existing.geometry,
      style: body.style !== undefined ? JSON.stringify(body.style) : existing.style,
      updatedAt: new Date(),
    })
    .where(eq(mapFeatures.id, featureId));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ featureId: string }> }) {
  const { featureId } = await params;
  await db.delete(mapFeatures).where(eq(mapFeatures.id, featureId));
  return NextResponse.json({ ok: true });
}
