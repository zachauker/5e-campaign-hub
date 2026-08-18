import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createThread, listThreads } from "@/lib/state/threads";
import { getCampaignDay } from "@/lib/state/advance";
import type { StateDb } from "@/lib/state/types";

const sdb = db as unknown as StateDb;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  if (!campaignId) return NextResponse.json({ error: '"campaignId" is required' }, { status: 400 });

  const currentDay = await getCampaignDay(sdb, campaignId);
  const items = await listThreads(sdb, campaignId, {
    currentDay,
    includeResolved: searchParams.get("includeResolved") === "1",
    includeArchived: searchParams.get("includeArchived") === "1",
  });
  return NextResponse.json({ items, currentDay });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (typeof body.campaignId !== "string" || !body.campaignId) {
    return NextResponse.json({ error: '"campaignId" is required and must be a string' }, { status: 400 });
  }
  if (typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: '"title" is required and must be a string' }, { status: 400 });
  }

  try {
    const currentDay = await getCampaignDay(sdb, body.campaignId);
    const thread = await createThread(sdb, {
      campaignId: body.campaignId,
      title: body.title,
      stakes: body.stakes ?? null,
      notes: body.notes ?? null,
      openedSessionId: body.openedSessionId ?? null,
      links: body.links ?? [],
      sourceKind: body.sourceKind === "proposal" ? "proposal" : "manual",
      currentDay,
    });
    return NextResponse.json(thread, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
