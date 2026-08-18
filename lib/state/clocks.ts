import { eq } from "drizzle-orm";
import { clocks } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { recordEvent, type SourceKind } from "./timeline";
import type { ClockStatus } from "./cadence";
import type { StateDb } from "./types";

export const CLOCK_STATUSES: ClockStatus[] = ["running", "paused", "complete"];
export const CLOCK_SEGMENT_CHOICES = [4, 6, 8, 12] as const;

export type ClockOwnerKind = "faction" | "location" | "thread";

export interface CreateClockInput {
  campaignId: string;
  name: string;
  segments?: number;
  cadenceDays?: number | null;
  ownerKind?: ClockOwnerKind | null;
  ownerId?: string | null;
  payoff?: string | null;
  currentDay: number | null;
}

export interface UpdateClockInput {
  name?: string;
  segments?: number;
  cadenceDays?: number | null;
  ownerKind?: ClockOwnerKind | null;
  ownerId?: string | null;
  payoff?: string | null;
  status?: ClockStatus;
}

export interface ApplyTickInput {
  delta: number;
  currentDay: number | null;
  reason?: string;
  /** Where lastTickedDay should land. Defaults to currentDay. Cadence ticks pass the remainder-preserving value. */
  nextLastTickedDay?: number | null;
  sourceKind?: SourceKind;
}

export async function createClock(db: StateDb, input: CreateClockInput) {
  const name = input.name.trim();
  if (!name) throw new Error("clock name is required");

  const segments = input.segments ?? 8;
  if (!CLOCK_SEGMENT_CHOICES.includes(segments as (typeof CLOCK_SEGMENT_CHOICES)[number])) {
    throw new Error(`segments must be one of ${CLOCK_SEGMENT_CHOICES.join(", ")}, got ${segments}`);
  }

  const cadenceDays = input.cadenceDays ?? null;
  if (cadenceDays !== null && (!Number.isInteger(cadenceDays) || cadenceDays <= 0)) {
    throw new Error(`cadenceDays must be a positive integer or null, got ${cadenceDays}`);
  }

  const now = new Date();
  const [row] = await db
    .insert(clocks)
    .values({
      id: generateId(),
      campaignId: input.campaignId,
      name,
      segments,
      filled: 0,
      ownerKind: input.ownerKind ?? null,
      ownerId: input.ownerId ?? null,
      cadenceDays,
      lastTickedDay: input.currentDay,
      status: "running",
      payoff: input.payoff ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return row;
}

export async function updateClock(db: StateDb, id: string, input: UpdateClockInput) {
  const existing = await db.query.clocks.findFirst({ where: eq(clocks.id, id) });
  if (!existing) throw new Error(`clock not found: ${id}`);

  if (input.status && !CLOCK_STATUSES.includes(input.status)) {
    throw new Error(`invalid clock status: ${input.status}`);
  }

  const segments = input.segments ?? existing.segments;
  if (input.segments !== undefined) {
    if (!CLOCK_SEGMENT_CHOICES.includes(segments as (typeof CLOCK_SEGMENT_CHOICES)[number])) {
      throw new Error(`segments must be one of ${CLOCK_SEGMENT_CHOICES.join(", ")}, got ${segments}`);
    }
    if (segments < existing.filled) {
      throw new Error(`segments (${segments}) cannot be below the filled count (${existing.filled})`);
    }
  }

  const cadenceDays = input.cadenceDays === undefined ? existing.cadenceDays : input.cadenceDays;
  if (cadenceDays !== null && (!Number.isInteger(cadenceDays) || cadenceDays <= 0)) {
    throw new Error(`cadenceDays must be a positive integer or null, got ${cadenceDays}`);
  }

  const [row] = await db
    .update(clocks)
    .set({
      name: input.name?.trim() || existing.name,
      segments,
      cadenceDays,
      ownerKind: input.ownerKind === undefined ? existing.ownerKind : input.ownerKind,
      ownerId: input.ownerId === undefined ? existing.ownerId : input.ownerId,
      payoff: input.payoff === undefined ? existing.payoff : input.payoff,
      status: input.status ?? existing.status,
      updatedAt: new Date(),
    })
    .where(eq(clocks.id, id))
    .returning();

  return row;
}

/**
 * Move a clock by a delta. Deltas only — never an absolute `filled` — so that a
 * caller (including the model, via a proposal) cannot silently reset a clock.
 */
export async function applyTick(db: StateDb, id: string, input: ApplyTickInput) {
  const existing = await db.query.clocks.findFirst({ where: eq(clocks.id, id) });
  if (!existing) throw new Error(`clock not found: ${id}`);

  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new Error(`delta must be a non-zero integer, got ${input.delta}`);
  }

  const next = existing.filled + input.delta;
  if (next < 0 || next > existing.segments) {
    throw new Error(
      `tick out of range: ${existing.filled} + ${input.delta} is outside 0..${existing.segments}`,
    );
  }

  const completes = next >= existing.segments;

  // Two distinct rules, kept unpacked because the second one is a silent-failure
  // trap that needs somewhere to hang its reasoning:
  //   1. Filling a clock marks it complete.
  //   2. A negative tick that pulls a filled clock back below full must restore
  //      it to "running". computeDueTicks skips on `status !== "running"` BEFORE
  //      it checks remaining segments, so a clock left at "complete" with empty
  //      segments would never be eligible for another automatic tick again, with
  //      no path back except a manual updateClock.
  let status: ClockStatus = existing.status as ClockStatus;
  if (completes) {
    status = "complete";
  } else if (existing.status === "complete") {
    status = "running";
  }

  const lastTickedDay =
    input.nextLastTickedDay !== undefined && input.nextLastTickedDay !== null
      ? input.nextLastTickedDay
      : (input.currentDay ?? existing.lastTickedDay);

  const [row] = await db
    .update(clocks)
    .set({
      filled: next,
      status,
      lastTickedDay,
      updatedAt: new Date(),
    })
    .where(eq(clocks.id, id))
    .returning();

  const sign = input.delta > 0 ? `+${input.delta}` : `${input.delta}`;
  await recordEvent(db, {
    campaignId: existing.campaignId,
    day: input.currentDay,
    kind: "clock_ticked",
    title: `${existing.name} ${sign} (${next}/${existing.segments})`,
    body: input.reason ?? null,
    sourceKind: input.sourceKind ?? "manual",
    clockId: id,
  });

  if (completes) {
    await recordEvent(db, {
      campaignId: existing.campaignId,
      day: input.currentDay,
      kind: "clock_completed",
      title: `${existing.name} filled`,
      body: existing.payoff ?? null,
      sourceKind: input.sourceKind ?? "manual",
      clockId: id,
    });
  }

  return row;
}

export async function listClocks(db: StateDb, campaignId: string) {
  const rows = await db.query.clocks.findMany({ where: eq(clocks.campaignId, campaignId) });
  const order: Record<string, number> = { running: 0, paused: 1, complete: 2 };
  return rows
    .filter((r) => !r.archived)
    .sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || a.name.localeCompare(b.name));
}
