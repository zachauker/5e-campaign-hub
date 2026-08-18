import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { timelineEvents } from "@/lib/db/schema";
import { listThreads } from "@/lib/state/threads";
import { listClocks } from "@/lib/state/clocks";
import { getCampaignDay, getCampaignEpochLabel } from "@/lib/state/advance";
import { formatInWorldDay } from "@/lib/calendar/exandria";
import type { StateDb } from "@/lib/state/types";

const sdb: StateDb = db;

/** Everything /chronicle needs in one round trip. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const includeResolved = searchParams.get("includeResolved") === "1";

  const currentDay = await getCampaignDay(sdb, id);
  const epochLabel = await getCampaignEpochLabel(sdb, id);

  const events = await db.query.timelineEvents.findMany({
    where: eq(timelineEvents.campaignId, id),
    orderBy: [desc(timelineEvents.day), desc(timelineEvents.createdAt)],
    limit: 200,
  });

  return NextResponse.json({
    currentDay,
    epochLabel,
    currentDateLabel: currentDay === null ? null : formatInWorldDay(currentDay, epochLabel),
    threads: await listThreads(sdb, id, { currentDay, includeResolved }),
    clocks: await listClocks(sdb, id),
    events: events.map((e) => ({
      ...e,
      dateLabel: formatInWorldDay(e.day, epochLabel),
    })),
  });
}
