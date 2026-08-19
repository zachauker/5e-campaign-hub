import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createMark, listMarks, setMarkResolved } from "@/lib/run/marks";
import { toClientErrorMessage, NotFoundError } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";

const sdb: StateDb = db;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const runSessionId = searchParams.get("runSessionId");
  if (!runSessionId) return NextResponse.json({ error: '"runSessionId" is required' }, { status: 400 });
  try {
    return NextResponse.json({ items: await listMarks(sdb, runSessionId) });
  } catch (err) {
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status: 400 });
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  if (typeof body.campaignId !== "string" || !body.campaignId) {
    return NextResponse.json({ error: '"campaignId" is required and must be a string' }, { status: 400 });
  }
  if (typeof body.runSessionId !== "string" || !body.runSessionId) {
    return NextResponse.json({ error: '"runSessionId" is required and must be a string' }, { status: 400 });
  }
  if (typeof body.atMs !== "number" || !Number.isFinite(body.atMs)) {
    return NextResponse.json({ error: '"atMs" is required and must be a number' }, { status: 400 });
  }
  // Checked before rounding: Math.round() maps anything in (-1, 0) to -0, which
  // then passes createMark's non-negative guard and stores as 0.
  if (body.atMs < 0) {
    return NextResponse.json({ error: '"atMs" must not be negative' }, { status: 400 });
  }
  try {
    const mark = await createMark(sdb, {
      campaignId: body.campaignId,
      runSessionId: body.runSessionId,
      atMs: Math.round(body.atMs),
      tag: body.tag ?? null,
      note: body.note ?? null,
      contextKind: body.contextKind ?? null,
      contextId: body.contextId ?? null,
      localId: typeof body.localId === "string" && body.localId ? body.localId : undefined,
    });
    return NextResponse.json(mark, { status: 201 });
  } catch (err) {
    const status = err instanceof NotFoundError ? 404 : 400;
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status });
  }
}

export async function PATCH(req: Request) {
  const body = await req.json();
  if (typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ error: '"id" is required and must be a string' }, { status: 400 });
  }
  if (typeof body.resolved !== "boolean") {
    return NextResponse.json({ error: '"resolved" is required and must be a boolean' }, { status: 400 });
  }
  try {
    return NextResponse.json(await setMarkResolved(sdb, body.id, body.resolved));
  } catch (err) {
    const status = err instanceof NotFoundError ? 404 : 400;
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status });
  }
}
