import { describe, it, expect } from "vitest";
import { computeDueTicks, declinedLastTickedDay, type ClockLike } from "./cadence";

const clock = (over: Partial<ClockLike> = {}): ClockLike => ({
  id: "c1",
  name: "Assembly investigation",
  segments: 8,
  filled: 0,
  cadenceDays: 7,
  lastTickedDay: 100,
  status: "running",
  ...over,
});

describe("computeDueTicks", () => {
  it("returns nothing before a full cadence period has elapsed", () => {
    expect(computeDueTicks([clock()], 106)).toEqual([]);
  });

  it("ticks once at exactly one cadence period", () => {
    const [due] = computeDueTicks([clock()], 107);
    expect(due).toMatchObject({ clockId: "c1", ticks: 1, elapsedDays: 7, fromFilled: 0, toFilled: 1 });
  });

  it("ticks multiple times over a long jump", () => {
    const [due] = computeDueTicks([clock()], 100 + 7 * 3);
    expect(due.ticks).toBe(3);
    expect(due.toFilled).toBe(3);
  });

  it("preserves remainder credit in nextLastTickedDay", () => {
    // 20 days elapsed on a 7-day clock = 2 ticks, 6 days of credit toward the third.
    const [due] = computeDueTicks([clock()], 120);
    expect(due.ticks).toBe(2);
    expect(due.nextLastTickedDay).toBe(114); // 100 + 2*7 — NOT 120
  });

  it("caps ticks at the remaining segments and flags completion", () => {
    const [due] = computeDueTicks([clock({ filled: 6, segments: 8 })], 100 + 7 * 10);
    expect(due.rawTicks).toBe(10);
    expect(due.ticks).toBe(2);
    expect(due.toFilled).toBe(8);
    expect(due.completes).toBe(true);
  });

  it("does not flag completion when the clock stays short of full", () => {
    const [due] = computeDueTicks([clock({ filled: 1 })], 114);
    expect(due.completes).toBe(false);
  });

  it("skips paused and complete clocks", () => {
    expect(computeDueTicks([clock({ status: "paused" })], 200)).toEqual([]);
    expect(computeDueTicks([clock({ status: "complete" })], 200)).toEqual([]);
  });

  it("skips clocks with no cadence", () => {
    expect(computeDueTicks([clock({ cadenceDays: null })], 200)).toEqual([]);
  });

  it("skips a non-positive cadence rather than dividing by zero", () => {
    expect(computeDueTicks([clock({ cadenceDays: 0 })], 200)).toEqual([]);
    expect(computeDueTicks([clock({ cadenceDays: -7 })], 200)).toEqual([]);
  });

  it("skips an already-full clock even if it is still marked running", () => {
    expect(computeDueTicks([clock({ filled: 8, segments: 8 })], 200)).toEqual([]);
  });

  it("treats a null lastTickedDay as never ticked and does not tick it", () => {
    expect(computeDueTicks([clock({ lastTickedDay: null })], 200)).toEqual([]);
  });

  it("handles several clocks independently", () => {
    const due = computeDueTicks(
      [clock({ id: "a", cadenceDays: 7 }), clock({ id: "b", cadenceDays: 30 }), clock({ id: "c", status: "paused" })],
      130,
    );
    expect(due.map((d) => d.clockId)).toEqual(["a", "b"]);
    expect(due[0].ticks).toBe(4);
    expect(due[1].ticks).toBe(1);
  });
});

describe("declinedLastTickedDay", () => {
  it("skips a declined tick forward so it is not re-proposed", () => {
    expect(declinedLastTickedDay(120)).toBe(120);
  });
});
