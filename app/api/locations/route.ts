import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { locations } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { eq, asc, and } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  const includeArchived = searchParams.get("includeArchived") === "1";

  const conditions = [];
  if (campaignId) conditions.push(eq(locations.campaignId, campaignId));
  if (!includeArchived) conditions.push(eq(locations.archived, false));

  const rows = await db.query.locations.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [asc(locations.name)],
  });

  const archivedConditions = [eq(locations.archived, true)];
  if (campaignId) archivedConditions.push(eq(locations.campaignId, campaignId));
  const archived = await db.query.locations.findMany({ where: and(...archivedConditions) });

  return NextResponse.json({ items: rows, archivedCount: archived.length });
}

export async function POST(req: Request) {
  const body = await req.json();

  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: '"name" is required and must be a string' }, { status: 400 });
  }
  if (typeof body.campaignId !== "string" || !body.campaignId) {
    return NextResponse.json({ error: '"campaignId" is required and must be a string' }, { status: 400 });
  }

  const LOCATION_TYPES = ["city", "town", "poi", "region", "other"];
  if (body.type !== undefined && !LOCATION_TYPES.includes(body.type)) {
    return NextResponse.json({ error: `"type" must be one of ${LOCATION_TYPES.join(", ")}` }, { status: 400 });
  }

  const now = new Date();
  const [location] = await db
    .insert(locations)
    .values({
      id: generateId(),
      campaignId: body.campaignId,
      name: body.name.trim(),
      notionUrl: body.notionUrl ?? null,
      description: body.description ?? null,
      type: body.type ?? "other",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return NextResponse.json(location, { status: 201 });
}
