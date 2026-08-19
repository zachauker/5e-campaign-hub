import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { relatedEntities } from "@/lib/run/relations";
import { toClientErrorMessage } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";

const sdb: StateDb = db;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  const targetKind = searchParams.get("targetKind");
  const targetId = searchParams.get("targetId");
  if (!campaignId) return NextResponse.json({ error: '"campaignId" is required' }, { status: 400 });
  if (!targetKind) return NextResponse.json({ error: '"targetKind" is required' }, { status: 400 });
  if (!targetId) return NextResponse.json({ error: '"targetId" is required' }, { status: 400 });

  try {
    return NextResponse.json({ items: await relatedEntities(sdb, campaignId, targetKind, targetId) });
  } catch (err) {
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status: 400 });
  }
}
