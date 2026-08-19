import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { relatedEntities } from "@/lib/run/relations";
import { BRIEFING_TARGET_KINDS } from "@/lib/run/briefings";
import { toClientErrorMessage } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";

const sdb: StateDb = db;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  const targetKind = searchParams.get("targetKind");
  const targetId = searchParams.get("targetId");
  if (!campaignId) return NextResponse.json({ error: '"campaignId" is required' }, { status: 400 });
  // Validated here, not just for presence. relatedEntities returns [] for an
  // unknown kind — safe, but it would make a client bug look like an entity
  // with no relations, which is a perfectly ordinary answer. A DM never types
  // this value, so a bad one means something upstream is wrong and should say so.
  if (!targetKind || !(BRIEFING_TARGET_KINDS as string[]).includes(targetKind)) {
    return NextResponse.json(
      { error: '"targetKind" must be one of: ' + BRIEFING_TARGET_KINDS.join(", ") },
      { status: 400 },
    );
  }
  if (!targetId) return NextResponse.json({ error: '"targetId" is required' }, { status: 400 });

  try {
    return NextResponse.json({ items: await relatedEntities(sdb, campaignId, targetKind, targetId) });
  } catch (err) {
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status: 400 });
  }
}
