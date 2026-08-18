export type ClockStatus = "running" | "paused" | "complete";

export interface ClockLike {
  id: string;
  name: string;
  segments: number;
  filled: number;
  cadenceDays: number | null;
  lastTickedDay: number | null;
  status: ClockStatus;
}

export interface DueTick {
  clockId: string;
  name: string;
  /** Ticks that will actually be applied, capped by the remaining segments. */
  ticks: number;
  /** Cadence periods elapsed, uncapped — shown so the DM can see a clock overshot. */
  rawTicks: number;
  elapsedDays: number;
  fromFilled: number;
  toFilled: number;
  /**
   * lastTickedDay advances by whole cadence periods, never to toDay: advancing
   * 20 days on a 7-day clock yields 2 ticks and leaves 6 days of credit toward
   * the third. Setting it to toDay would silently discard that remainder.
   */
  nextLastTickedDay: number;
  completes: boolean;
}

/**
 * Which running, cadence-bearing clocks are due at `toDay`. Pure: callers read
 * the clocks and persist the result.
 */
export function computeDueTicks(clocks: ClockLike[], toDay: number): DueTick[] {
  const due: DueTick[] = [];

  for (const c of clocks) {
    if (c.status !== "running") continue;
    if (c.cadenceDays === null || c.cadenceDays <= 0) continue;
    if (c.lastTickedDay === null) continue;

    const remaining = c.segments - c.filled;
    if (remaining <= 0) continue;

    const elapsedDays = toDay - c.lastTickedDay;
    if (elapsedDays < c.cadenceDays) continue;

    const rawTicks = Math.floor(elapsedDays / c.cadenceDays);
    const ticks = Math.min(rawTicks, remaining);

    due.push({
      clockId: c.id,
      name: c.name,
      ticks,
      rawTicks,
      elapsedDays,
      fromFilled: c.filled,
      toFilled: c.filled + ticks,
      nextLastTickedDay: c.lastTickedDay + ticks * c.cadenceDays,
      completes: c.filled + ticks >= c.segments,
    });
  }

  return due;
}

/**
 * Where a *declined* tick leaves lastTickedDay. A declined tick is skipped, not
 * deferred: it jumps to the new current day so the same tick is not re-proposed
 * on every subsequent advance.
 */
export function declinedLastTickedDay(toDay: number): number {
  return toDay;
}
