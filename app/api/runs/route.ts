import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { startRun, getActiveRun, listRuns } from "@/lib/run/runs";
import { toClientErrorMessage } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";

const sdb: StateDb = db;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  if (!campaignId) return NextResponse.json({ error: '"campaignId" is required' }, { status: 400 });

  try {
    if (searchParams.get("active") === "1") {
      return NextResponse.json({ run: await getActiveRun(sdb, campaignId) });
    }
    return NextResponse.json({ items: await listRuns(sdb, campaignId) });
  } catch (err) {
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status: 400 });
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  if (typeof body.campaignId !== "string" || !body.campaignId) {
    return NextResponse.json({ error: '"campaignId" is required and must be a string' }, { status: 400 });
  }
  try {
    const run = await startRun(sdb, { campaignId: body.campaignId, label: body.label ?? null });
    return NextResponse.json(run, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status: 400 });
  }
}
