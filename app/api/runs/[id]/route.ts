import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { endRun, linkSessionNote, getRun } from "@/lib/run/runs";
import { listMarks } from "@/lib/run/marks";
import { toClientErrorMessage, NotFoundError } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";

const sdb: StateDb = db;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const campaignId = new URL(req.url).searchParams.get("campaignId");
  // Required for the same reason /api/search and /api/briefings require it.
  // Without it this endpoint would hand over any run's marks to anyone holding
  // the id, which is a different posture from the rest of the sub-project —
  // and this shell has shipped a cross-campaign leak once already.
  if (!campaignId) {
    return NextResponse.json({ error: '"campaignId" is required' }, { status: 400 });
  }
  try {
    const run = await getRun(sdb, id);
    if (run.campaignId !== campaignId) throw new NotFoundError("No run found with that id");
    return NextResponse.json({ marks: await listMarks(sdb, id) });
  } catch (err) {
    const status = err instanceof NotFoundError ? 404 : 400;
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status });
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
