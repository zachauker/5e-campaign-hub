import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { setDate } from "@/lib/state/advance";
import type { StateDb } from "@/lib/state/types";

const sdb = db as unknown as StateDb;

/** Correction path: sets the date with NO cadence processing. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  if (typeof body.day !== "number") {
    return NextResponse.json({ error: '"day" is required and must be a number' }, { status: 400 });
  }

  try {
    await setDate(sdb, id, body.day, typeof body.epochLabel === "string" ? body.epochLabel : "");
    return NextResponse.json({ ok: true, day: body.day });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
