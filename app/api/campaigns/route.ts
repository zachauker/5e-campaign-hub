import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { desc } from "drizzle-orm";

export async function GET() {
  const rows = await db.query.campaigns.findMany({ orderBy: [desc(campaigns.createdAt)] });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const body = await req.json();

  if (body.name !== undefined && typeof body.name !== "string") {
    return NextResponse.json({ error: '"name" must be a string' }, { status: 400 });
  }

  const now = new Date();
  const [campaign] = await db
    .insert(campaigns)
    .values({ id: generateId(), name: body.name?.trim() || "New Campaign", createdAt: now })
    .returning();
  return NextResponse.json(campaign, { status: 201 });
}
