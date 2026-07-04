import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mapFeatures } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { eq } from "drizzle-orm";

const VALID_TYPES = ["region", "road", "label"];

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await db.query.mapFeatures.findMany({ where: eq(mapFeatures.mapId, id) });
  return NextResponse.json(
    rows.map((f) => ({ ...f, geometry: JSON.parse(f.geometry), style: JSON.parse(f.style) }))
  );
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  if (!VALID_TYPES.includes(body.type)) {
    return NextResponse.json({ error: `"type" must be one of ${VALID_TYPES.join(", ")}` }, { status: 400 });
  }
  if (typeof body.geometry !== "object" || body.geometry === null) {
    return NextResponse.json({ error: '"geometry" must be a GeoJSON geometry object' }, { status: 400 });
  }
  if (body.type === "label" && (typeof body.name !== "string" || body.name.trim().length === 0)) {
    return NextResponse.json({ error: '"name" is required for label features' }, { status: 400 });
  }

  const now = new Date();
  const [feature] = await db
    .insert(mapFeatures)
    .values({
      id: generateId(),
      mapId: id,
      type: body.type,
      name: body.name ?? null,
      geometry: JSON.stringify(body.geometry),
      style: JSON.stringify(body.style ?? {}),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return NextResponse.json(
    { ...feature, geometry: JSON.parse(feature.geometry), style: JSON.parse(feature.style) },
    { status: 201 }
  );
}
