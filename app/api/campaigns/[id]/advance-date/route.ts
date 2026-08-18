import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { previewAdvance, applyAdvance } from "@/lib/state/advance";
import type { StateDb } from "@/lib/state/types";

const sdb = db as unknown as StateDb;

/**
 * Without `apply`, this previews and mutates nothing. With
 * `apply: { clockIds }`, it advances the date and applies only those ticks.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  if (typeof body.toDay !== "number") {
    return NextResponse.json({ error: '"toDay" is required and must be a number' }, { status: 400 });
  }

  try {
    if (!body.apply) return NextResponse.json(await previewAdvance(sdb, id, body.toDay));
    const clockIds: string[] = Array.isArray(body.apply.clockIds) ? body.apply.clockIds : [];
    return NextResponse.json(await applyAdvance(sdb, id, body.toDay, clockIds));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
