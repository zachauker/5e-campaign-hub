import { eq } from "drizzle-orm";
import { campaigns, clocks } from "@/lib/db/schema";
import { computeDueTicks, declinedLastTickedDay, type ClockLike, type DueTick } from "./cadence";
import { applyTick, listClocks } from "./clocks";
import { recordEvent } from "./timeline";
import { formatInWorldDay } from "@/lib/calendar/exandria";
import type { StateDb } from "./types";

export interface AdvancePreview {
  fromDay: number;
  toDay: number;
  dueTicks: DueTick[];
}

export interface AdvanceResult {
  fromDay: number;
  toDay: number;
  applied: number;
  declined: number;
}

export async function getCampaignDay(db: StateDb, campaignId: string): Promise<number | null> {
  const row = await db.query.campaigns.findFirst({ where: eq(campaigns.id, campaignId) });
  return row?.inWorldDay ?? null;
}

export async function getCampaignEpochLabel(db: StateDb, campaignId: string): Promise<string> {
  const row = await db.query.campaigns.findFirst({ where: eq(campaigns.id, campaignId) });
  return row?.calendarEpochLabel ?? "";
}

/**
 * Set the in-world date WITHOUT cadence processing. This is the correction path:
 * fixing a mistyped date must never re-tick clocks, or a typo'd jump followed by
 * a correction would leave clocks permanently over-ticked.
 */
export async function setDate(
  db: StateDb,
  campaignId: string,
  day: number,
  epochLabel: string,
): Promise<void> {
  if (!Number.isInteger(day) || day < 0) {
    throw new Error(`in-world day must be a non-negative integer, got ${day}`);
  }
  await db
    .update(campaigns)
    .set({ inWorldDay: day, calendarEpochLabel: epochLabel })
    .where(eq(campaigns.id, campaignId));
}

async function requireCurrentDay(db: StateDb, campaignId: string, toDay: number): Promise<number> {
  const fromDay = await getCampaignDay(db, campaignId);
  if (fromDay === null) {
    throw new Error("set the campaign's in-world date before advancing time");
  }
  if (!Number.isInteger(toDay) || toDay <= fromDay) {
    throw new Error(`time only moves forward: toDay (${toDay}) must be an integer after ${fromDay}`);
  }
  return fromDay;
}

function toClockLike(row: Awaited<ReturnType<typeof listClocks>>[number]): ClockLike {
  return {
    id: row.id,
    name: row.name,
    segments: row.segments,
    filled: row.filled,
    cadenceDays: row.cadenceDays,
    lastTickedDay: row.lastTickedDay,
    status: row.status as ClockLike["status"],
  };
}

/** What would happen at `toDay`. Read-only. */
export async function previewAdvance(
  db: StateDb,
  campaignId: string,
  toDay: number,
): Promise<AdvancePreview> {
  const fromDay = await requireCurrentDay(db, campaignId, toDay);
  const rows = await listClocks(db, campaignId);
  return { fromDay, toDay, dueTicks: computeDueTicks(rows.map(toClockLike), toDay) };
}

/**
 * Advance the date, applying only the ticks whose clock id appears in
 * `acceptedClockIds`. Declined ticks are skipped, not deferred.
 */
export async function applyAdvance(
  db: StateDb,
  campaignId: string,
  toDay: number,
  acceptedClockIds: string[],
): Promise<AdvanceResult> {
  const fromDay = await requireCurrentDay(db, campaignId, toDay);
  const rows = await listClocks(db, campaignId);
  const due = computeDueTicks(rows.map(toClockLike), toDay);
  const accepted = new Set(acceptedClockIds);

  let applied = 0;
  let declined = 0;

  for (const tick of due) {
    if (accepted.has(tick.clockId)) {
      await applyTick(db, tick.clockId, {
        delta: tick.ticks,
        currentDay: toDay,
        nextLastTickedDay: tick.nextLastTickedDay,
        sourceKind: "cadence",
        reason: `${tick.elapsedDays} in-world days elapsed`,
      });
      applied++;
    } else {
      await db
        .update(clocks)
        .set({ lastTickedDay: declinedLastTickedDay(toDay), updatedAt: new Date() })
        .where(eq(clocks.id, tick.clockId));
      declined++;
    }
  }

  const epochLabel = await getCampaignEpochLabel(db, campaignId);
  await db.update(campaigns).set({ inWorldDay: toDay }).where(eq(campaigns.id, campaignId));

  await recordEvent(db, {
    campaignId,
    day: toDay,
    kind: "date_advanced",
    title: `Time advances to ${formatInWorldDay(toDay, epochLabel)}`,
    body: `${toDay - fromDay} day(s) elapsed. ${applied} clock(s) ticked, ${declined} declined.`,
    sourceKind: "cadence",
  });

  return { fromDay, toDay, applied, declined };
}
