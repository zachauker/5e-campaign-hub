import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessionNotes } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  const includeArchived = searchParams.get("includeArchived") === "1";

  const conditions = [];
  if (campaignId) conditions.push(eq(sessionNotes.campaignId, campaignId));
  if (!includeArchived) conditions.push(eq(sessionNotes.archived, false));

  const rows = await db.query.sessionNotes.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(sessionNotes.date)],
  });

  const archivedConditions = [eq(sessionNotes.archived, true)];
  if (campaignId) archivedConditions.push(eq(sessionNotes.campaignId, campaignId));
  const archived = await db.query.sessionNotes.findMany({ where: and(...archivedConditions) });

  return NextResponse.json({ items: rows, archivedCount: archived.length });
}
