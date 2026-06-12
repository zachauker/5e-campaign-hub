import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { encounters, combatants } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import type { CombatantWithParsed, EncounterWithCombatants, Condition } from "@/lib/types";

function parseCombatant(row: typeof combatants.$inferSelect): CombatantWithParsed {
  return {
    ...row,
    type: row.type as "pc" | "npc" | "monster",
    conditions: JSON.parse(row.conditions) as Condition[],
    statBlock: row.statBlock ? JSON.parse(row.statBlock) : null,
    ddbCharacter: row.ddbCharacterData ? JSON.parse(row.ddbCharacterData) : null,
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const encounter = await db.query.encounters.findFirst({
    where: eq(encounters.id, id),
  });
  if (!encounter) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const combatantRows = await db
    .select()
    .from(combatants)
    .where(eq(combatants.encounterId, id))
    .orderBy(asc(combatants.sortOrder));

  const result: EncounterWithCombatants = {
    ...encounter,
    status: encounter.status as "idle" | "active" | "completed",
    combatants: combatantRows.map(parseCombatant),
  };

  return NextResponse.json(result);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const { combatants: combatantUpdates, ...encounterUpdates } = body;

  if (Object.keys(encounterUpdates).length > 0) {
    await db
      .update(encounters)
      .set({ ...encounterUpdates, updatedAt: new Date() })
      .where(eq(encounters.id, id));
  }

  if (combatantUpdates && Array.isArray(combatantUpdates)) {
    for (const c of combatantUpdates as CombatantWithParsed[]) {
      await db
        .update(combatants)
        .set({
          initiative: c.initiative,
          hpCurrent: c.hpCurrent,
          hpMax: c.hpMax,
          hpTemp: c.hpTemp,
          ac: c.ac,
          conditions: JSON.stringify(c.conditions),
          notes: c.notes,
          isConcentrating: c.isConcentrating,
          isVisible: c.isVisible,
          sortOrder: c.sortOrder,
          statBlock: c.statBlock ? JSON.stringify(c.statBlock) : null,
          ddbCharacterData: c.ddbCharacter ? JSON.stringify(c.ddbCharacter) : null,
          avatarUrl: c.avatarUrl,
        })
        .where(eq(combatants.id, c.id));
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.delete(encounters).where(eq(encounters.id, id));
  return NextResponse.json({ ok: true });
}
