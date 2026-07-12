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

  if (Array.isArray(body.combatants)) {
    for (const [index, c] of body.combatants.entries()) {
      await db.insert(combatants).values({
        id: generateId(),
        encounterId: id,
        name: c.name,
        type: c.type ?? "monster",
        initiative: c.initiative ?? null,
        initiativeBonus: c.initiativeBonus ?? 0,
        hpCurrent: c.hpCurrent ?? c.hpMax ?? 0,
        hpMax: c.hpMax ?? 0,
        hpTemp: 0,
        ac: c.ac ?? 10,
        speed: c.speed ?? 30,
        conditions: JSON.stringify([]),
        notes: c.notes ?? null,
        isConcentrating: false,
        isVisible: true,
        sortOrder: index,
        characterId: c.characterId ?? null,
        monsterSlug: c.monsterSlug ?? null,
      });
    }
  }

  return NextResponse.json(encounter, { status: 201 });
}
