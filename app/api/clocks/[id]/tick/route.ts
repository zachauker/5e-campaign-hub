import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clocks } from "@/lib/db/schema";
import { applyTick } from "@/lib/state/clocks";
import { getCampaignDay } from "@/lib/state/advance";
import { toClientErrorMessage } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";

const sdb: StateDb = db;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const existing = await db.query.clocks.findFirst({ where: eq(clocks.id, id) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const currentDay = await getCampaignDay(sdb, existing.campaignId);
    const row = await applyTick(sdb, id, {
      delta: body.delta,
      reason: body.reason,
      sourceKind: body.sourceKind === "proposal" ? "proposal" : "manual",
      currentDay,
    });
    return NextResponse.json(row);
  } catch (err) {
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status: 400 });
  }
}
