import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { combatants } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import type { CombatantWithParsed, Condition } from "@/lib/types";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: encounterId } = await params;
  const body = await req.json();
  const combatantId = generateId();

  const [row] = await db
    .insert(combatants)
    .values({
      id: combatantId,
      encounterId,
      name: body.name,
      type: body.type ?? "monster",
      initiative: body.initiative ?? null,
      initiativeBonus: body.initiativeBonus ?? 0,
      hpCurrent: body.hpCurrent ?? body.hpMax ?? 0,
      hpMax: body.hpMax ?? 0,
      hpTemp: body.hpTemp ?? 0,
      ac: body.ac ?? 10,
      speed: body.speed ?? 30,
      conditions: JSON.stringify(body.conditions ?? []),
      notes: body.notes ?? null,
      isConcentrating: body.isConcentrating ?? false,
      isVisible: body.isVisible ?? true,
      sortOrder: body.sortOrder ?? 0,
      ddbCharacterId: body.ddbCharacterId ?? null,
      monsterSlug: body.monsterSlug ?? null,
      statBlock: body.statBlock ? JSON.stringify(body.statBlock) : null,
      ddbCharacterData: body.ddbCharacter ? JSON.stringify(body.ddbCharacter) : null,
      avatarUrl: body.avatarUrl ?? null,
      playerName: body.playerName ?? null,
      color: body.color ?? null,
    })
    .returning();

  const result: CombatantWithParsed = {
    ...row,
    type: row.type as "pc" | "npc" | "monster",
    conditions: JSON.parse(row.conditions) as Condition[],
    statBlock: row.statBlock ? JSON.parse(row.statBlock) : null,
    ddbCharacter: row.ddbCharacterData ? JSON.parse(row.ddbCharacterData) : null,
  };

  return NextResponse.json(result, { status: 201 });
}
