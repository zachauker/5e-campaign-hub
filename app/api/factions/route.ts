import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factions } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { eq, asc, and } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  const includeArchived = searchParams.get("includeArchived") === "1";

  const scope = campaignId ? eq(factions.campaignId, campaignId) : undefined;
  const where = includeArchived
    ? scope
    : scope
      ? and(scope, eq(factions.archived, false))
      : eq(factions.archived, false);

  const rows = await db.query.factions.findMany({
    where,
    orderBy: [asc(factions.name)],
  });

  const archivedWhere = scope ? and(scope, eq(factions.archived, true)) : eq(factions.archived, true);
  const archivedCount = (await db.select().from(factions).where(archivedWhere)).length;

  return NextResponse.json({ items: rows, archivedCount });
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
