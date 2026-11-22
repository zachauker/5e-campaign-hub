import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { encounters, combatants } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import type { CombatantWithParsed, EncounterWithCombatants, Condition } from "@/lib/types";
import { saveEncounter, type EncounterSavePayload } from "@/lib/encounters/save";

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

  const result = saveEncounter(db, id, body as EncounterSavePayload);
  if (!result.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.delete(encounters).where(eq(encounters.id, id));
  return NextResponse.json({ ok: true });
}
