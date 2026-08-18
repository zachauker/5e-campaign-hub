import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createClock, listClocks } from "@/lib/state/clocks";
import { getCampaignDay } from "@/lib/state/advance";
import type { StateDb } from "@/lib/state/types";

const sdb = db as unknown as StateDb;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  if (!campaignId) return NextResponse.json({ error: '"campaignId" is required' }, { status: 400 });
  return NextResponse.json({ items: await listClocks(sdb, campaignId) });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (typeof body.campaignId !== "string" || !body.campaignId) {
    return NextResponse.json({ error: '"campaignId" is required and must be a string' }, { status: 400 });
  }
  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: '"name" is required and must be a string' }, { status: 400 });
  }
  try {
    const currentDay = await getCampaignDay(sdb, body.campaignId);
    const clock = await createClock(sdb, {
      campaignId: body.campaignId,
      name: body.name,
      segments: body.segments,
      cadenceDays: body.cadenceDays ?? null,
      ownerKind: body.ownerKind ?? null,
      ownerId: body.ownerId ?? null,
      payoff: body.payoff ?? null,
      currentDay,
    });
    return NextResponse.json(clock, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
