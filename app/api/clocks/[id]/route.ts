import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clocks } from "@/lib/db/schema";
import { updateClock } from "@/lib/state/clocks";
import { NotFoundError, toClientErrorMessage } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";

const sdb: StateDb = db;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  try {
    return NextResponse.json(
      await updateClock(sdb, id, {
        name: body.name,
        segments: body.segments,
        cadenceDays: body.cadenceDays,
        ownerKind: body.ownerKind,
        ownerId: body.ownerId,
        payoff: body.payoff,
        status: body.status,
      }),
    );
  } catch (err) {
    const status = err instanceof NotFoundError ? 404 : 400;
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.delete(clocks).where(eq(clocks.id, id));
  return NextResponse.json({ ok: true });
}
