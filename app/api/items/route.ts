import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { eq, asc, and } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  const includeArchived = searchParams.get("includeArchived") === "1";

  const scope = campaignId ? eq(items.campaignId, campaignId) : undefined;
  const where = includeArchived
    ? scope
    : scope
      ? and(scope, eq(items.archived, false))
      : eq(items.archived, false);

  const rows = await db.query.items.findMany({
    where,
    orderBy: [asc(items.name)],
  });

  const archivedWhere = scope ? and(scope, eq(items.archived, true)) : eq(items.archived, true);
  const archivedCount = (await db.select().from(items).where(archivedWhere)).length;

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
  const [item] = await db
    .insert(items)
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
  return NextResponse.json(item, { status: 201 });
}
