import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factions } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { eq, asc } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  const rows = campaignId
    ? await db.query.factions.findMany({
        where: eq(factions.campaignId, campaignId),
        orderBy: [asc(factions.name)],
      })
    : await db.query.factions.findMany({ orderBy: [asc(factions.name)] });
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
  const [faction] = await db
    .insert(factions)
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
  return NextResponse.json(faction, { status: 201 });
}
