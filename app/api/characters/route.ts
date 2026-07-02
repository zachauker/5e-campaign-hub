import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characters } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { eq, asc } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  const rows = campaignId
    ? await db.query.characters.findMany({
        where: eq(characters.campaignId, campaignId),
        orderBy: [asc(characters.name)],
      })
    : await db.query.characters.findMany({ orderBy: [asc(characters.name)] });
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
  const [character] = await db
    .insert(characters)
    .values({
      id: generateId(),
      campaignId: body.campaignId,
      name: body.name.trim(),
      type: body.type ?? "npc",
      ddbCharacterId: body.ddbCharacterId ?? null,
      notionUrl: body.notionUrl ?? null,
      description: body.description ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return NextResponse.json(character, { status: 201 });
}
