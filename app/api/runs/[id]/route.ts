import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { endRun, linkSessionNote } from "@/lib/run/runs";
import { listMarks } from "@/lib/run/marks";
import { toClientErrorMessage, NotFoundError } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";

const sdb: StateDb = db;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return NextResponse.json({ marks: await listMarks(sdb, id) });
  } catch (err) {
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status: 400 });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  try {
    if (body.end === true) return NextResponse.json(await endRun(sdb, id));
    if ("sessionNoteId" in body) {
      const noteId = body.sessionNoteId === null ? null : String(body.sessionNoteId);
      return NextResponse.json(await linkSessionNote(sdb, id, noteId));
    }
    return NextResponse.json({ error: 'Provide "end" or "sessionNoteId"' }, { status: 400 });
  } catch (err) {
    const status = err instanceof NotFoundError ? 404 : 400;
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status });
  }
}
