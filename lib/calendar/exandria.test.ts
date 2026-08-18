import { describe, it, expect } from "vitest";
import { EXANDRIA, formatInWorldDay } from "./exandria";

describe("EXANDRIA calendar shape", () => {
  it("has 11 months totalling 328 days", () => {
    expect(EXANDRIA.months).toHaveLength(11);
    expect(EXANDRIA.months.reduce((n, m) => n + m.days, 0)).toBe(328);
    expect(EXANDRIA.daysInYear).toBe(328);
  });
});

describe("toParts", () => {
  it("day 0 is the 1st of Horisal, year 0", () => {
    expect(EXANDRIA.toParts(0)).toEqual({ year: 0, monthIndex: 0, dayOfMonth: 1 });
  });
  it("day 28 is the last day of Horisal (29 days)", () => {
    expect(EXANDRIA.toParts(28)).toEqual({ year: 0, monthIndex: 0, dayOfMonth: 29 });
  });
  it("day 29 rolls into Misuthar", () => {
    expect(EXANDRIA.toParts(29)).toEqual({ year: 0, monthIndex: 1, dayOfMonth: 1 });
  });
  it("day 327 is the last day of the year", () => {
    expect(EXANDRIA.toParts(327)).toEqual({ year: 0, monthIndex: 10, dayOfMonth: 32 });
  });
  it("day 328 rolls the year over", () => {
    expect(EXANDRIA.toParts(328)).toEqual({ year: 1, monthIndex: 0, dayOfMonth: 1 });
  });
  it("rejects negative days", () => {
    expect(() => EXANDRIA.toParts(-1)).toThrow(/non-negative/);
  });
});

describe("fromParts", () => {
  it("round-trips every day of a full year", () => {
    for (let day = 0; day < 328 * 2; day++) {
      expect(EXANDRIA.fromParts(EXANDRIA.toParts(day))).toBe(day);
    }
  });
  it("rejects a day beyond the month length", () => {
    // Horisal has 29 days.
    expect(() => EXANDRIA.fromParts({ year: 843, monthIndex: 0, dayOfMonth: 30 })).toThrow(/dayOfMonth/);
  });
  it("rejects an out-of-range month", () => {
    expect(() => EXANDRIA.fromParts({ year: 843, monthIndex: 11, dayOfMonth: 1 })).toThrow(/monthIndex/);
  });
  it("rejects a negative year", () => {
    expect(() => EXANDRIA.fromParts({ year: -1, monthIndex: 0, dayOfMonth: 1 })).toThrow(/year/);
  });
  it("rejects a dayOfMonth below 1", () => {
    expect(() => EXANDRIA.fromParts({ year: 843, monthIndex: 0, dayOfMonth: 0 })).toThrow(/dayOfMonth/);
  });
  it("rejects a negative monthIndex", () => {
    expect(() => EXANDRIA.fromParts({ year: 843, monthIndex: -1, dayOfMonth: 1 })).toThrow(/monthIndex/);
  });
});

describe("formatInWorldDay", () => {
  it("renders ordinal, month, year and epoch label", () => {
    const day = EXANDRIA.fromParts({ year: 843, monthIndex: 7, dayOfMonth: 13 });
    expect(formatInWorldDay(day, "P.D.")).toBe("13th of Fessuran, 843 P.D.");
  });
  it("uses st/nd/rd suffixes", () => {
    expect(formatInWorldDay(EXANDRIA.fromParts({ year: 1, monthIndex: 0, dayOfMonth: 1 }), "P.D.")).toContain("1st of Horisal");
    expect(formatInWorldDay(EXANDRIA.fromParts({ year: 1, monthIndex: 0, dayOfMonth: 2 }), "P.D.")).toContain("2nd of Horisal");
    expect(formatInWorldDay(EXANDRIA.fromParts({ year: 1, monthIndex: 0, dayOfMonth: 3 }), "P.D.")).toContain("3rd of Horisal");
  });
  it("uses th for the 11th through 13th", () => {
    for (const d of [11, 12, 13]) {
      expect(formatInWorldDay(EXANDRIA.fromParts({ year: 1, monthIndex: 0, dayOfMonth: d }), "P.D.")).toContain(`${d}th`);
    }
  });
  it("tolerates an empty epoch label without a trailing space", () => {
    expect(formatInWorldDay(0, "")).toBe("1st of Horisal, 0");
  });
});
