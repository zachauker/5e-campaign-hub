import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { locations } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { eq, asc } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  const rows = campaignId
    ? await db.query.locations.findMany({
        where: eq(locations.campaignId, campaignId),
        orderBy: [asc(locations.name)],
      })
    : await db.query.locations.findMany({ orderBy: [asc(locations.name)] });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const body = await req.json();

  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: '"name" is required and must be a string' }, { status: 400 });
  }
  if (typeof body.campaignId !== "string" || !body.campaignId) {
    return NextResponse.json({ error: '"campaignId" is required and must be a string' }, { status: 400 });
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
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return NextResponse.json(location, { status: 201 });
}
