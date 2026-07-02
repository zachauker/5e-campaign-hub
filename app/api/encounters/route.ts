import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { encounters, combatants } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { desc, eq } from "drizzle-orm";
import type { CombatantWithParsed, Condition } from "@/lib/types";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  const rows = campaignId
    ? await db.query.encounters.findMany({
        where: eq(encounters.campaignId, campaignId),
        orderBy: [desc(encounters.updatedAt)],
      })
    : await db.query.encounters.findMany({ orderBy: [desc(encounters.updatedAt)] });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const body = await req.json();
  const now = new Date();
  const id = generateId();

  const [encounter] = await db
    .insert(encounters)
    .values({
      id,
      campaignId: body.campaignId ?? null,
      name: body.name ?? "New Encounter",
      status: "idle",
      round: 1,
      notes: body.notes ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return NextResponse.json(encounter, { status: 201 });
}
