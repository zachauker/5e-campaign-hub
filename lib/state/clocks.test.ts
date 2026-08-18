import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/notion/test-helpers";
import { clocks, timelineEvents } from "@/lib/db/schema";
import { createClock, updateClock, applyTick, listClocks, type CreateClockInput } from "./clocks";

async function seed(
  db: ReturnType<typeof createTestDb>["db"],
  campaignId: string,
  over: Partial<CreateClockInput> = {},
) {
  return createClock(db, {
    campaignId, name: "Assembly investigation", segments: 8, cadenceDays: 7, currentDay: 100,
    ownerKind: "faction", ownerId: "f1", payoff: "They identify the party.", ...over,
  });
}

describe("createClock", () => {
  it("creates a running clock at zero, stamped with the current day", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId);
    expect(c).toMatchObject({ filled: 0, status: "running", segments: 8, lastTickedDay: 100 });
  });

  it("rejects an unsupported segment count", async () => {
    const { db, campaignId } = createTestDb();
    await expect(seed(db, campaignId, { segments: 7 })).rejects.toThrow(/segments/);
  });

  it("rejects a blank name", async () => {
    const { db, campaignId } = createTestDb();
    await expect(seed(db, campaignId, { name: "  " })).rejects.toThrow(/name/);
  });

  it("rejects a non-positive cadence", async () => {
    const { db, campaignId } = createTestDb();
    await expect(seed(db, campaignId, { cadenceDays: 0 })).rejects.toThrow(/cadenceDays/);
  });

  it("allows a null cadence for a manual-only clock", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId, { cadenceDays: null });
    expect(c.cadenceDays).toBeNull();
  });
});

describe("applyTick", () => {
  it("applies a positive delta and logs a clock_ticked event", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId);

    const out = await applyTick(db, c.id, { delta: 2, currentDay: 114, reason: "Investigators canvassed the docks." });
    expect(out.filled).toBe(2);
    expect(out.status).toBe("running");

    const events = db.select().from(timelineEvents).all();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "clock_ticked", clockId: c.id, sourceKind: "manual" });
    expect(events[0].body).toContain("canvassed");
  });

  it("applies a negative delta", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId);
    await applyTick(db, c.id, { delta: 3, currentDay: 110 });
    const out = await applyTick(db, c.id, { delta: -1, currentDay: 111 });
    expect(out.filled).toBe(2);
  });

  it("marks the clock complete when it fills and logs a second event", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId, { segments: 4 });
    const out = await applyTick(db, c.id, { delta: 4, currentDay: 120 });

    expect(out.filled).toBe(4);
    expect(out.status).toBe("complete");
    expect(db.select().from(timelineEvents).all().map((e) => e.kind))
      .toEqual(["clock_ticked", "clock_completed"]);
  });

  it("rejects a delta that would exceed the segment count", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId, { segments: 4 });
    await expect(applyTick(db, c.id, { delta: 5, currentDay: 120 })).rejects.toThrow(/out of range/);
  });

  it("rejects a delta that would drop below zero", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId);
    await expect(applyTick(db, c.id, { delta: -1, currentDay: 120 })).rejects.toThrow(/out of range/);
  });

  it("rejects a zero or non-integer delta", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId);
    await expect(applyTick(db, c.id, { delta: 0, currentDay: 120 })).rejects.toThrow(/delta/);
    await expect(applyTick(db, c.id, { delta: 1.5, currentDay: 120 })).rejects.toThrow(/delta/);
  });

  it("throws on a missing clock", async () => {
    const { db } = createTestDb();
    await expect(applyTick(db, "nope", { delta: 1, currentDay: 1 })).rejects.toThrow(/not found/i);
  });

  it("advances lastTickedDay to the given nextLastTickedDay when supplied", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId);
    await applyTick(db, c.id, { delta: 2, currentDay: 120, nextLastTickedDay: 114, sourceKind: "cadence" });
    const row = db.select().from(clocks).where(eq(clocks.id, c.id)).all()[0];
    expect(row.lastTickedDay).toBe(114);
    expect(db.select().from(timelineEvents).all()[0].sourceKind).toBe("cadence");
  });

  it("resets status to running when a negative delta drops a complete clock below full", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId, { segments: 4 });
    await applyTick(db, c.id, { delta: 4, currentDay: 120 });

    const out = await applyTick(db, c.id, { delta: -1, currentDay: 121 });
    expect(out).toMatchObject({ filled: 3, status: "running" });
  });
});

describe("updateClock", () => {
  it("pauses a clock", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId);
    const out = await updateClock(db, c.id, { status: "paused" });
    expect(out.status).toBe("paused");
  });

  it("rejects an invalid status", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId);
    await expect(updateClock(db, c.id, { status: "banana" as never })).rejects.toThrow(/status/);
  });

  it("rejects shrinking segments below the filled count", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId);
    await applyTick(db, c.id, { delta: 6, currentDay: 150 });
    await expect(updateClock(db, c.id, { segments: 4 })).rejects.toThrow(/segments/);
  });
});

describe("listClocks", () => {
  it("returns running clocks before paused clocks", async () => {
    const { db, campaignId } = createTestDb();
    const a = await seed(db, campaignId, { name: "alpha" });
    const b = await seed(db, campaignId, { name: "beta" });
    await updateClock(db, a.id, { status: "paused" });

    const rows = await listClocks(db, campaignId);
    expect(rows.map((r) => r.name)).toEqual(["beta", "alpha"]);
    expect(rows.every((r) => r.id === a.id || r.id === b.id)).toBe(true);
  });

  it("excludes archived clocks", async () => {
    const { db, campaignId } = createTestDb();
    const kept = await seed(db, campaignId, { name: "kept" });
    const archived = await seed(db, campaignId, { name: "archived" });
    db.update(clocks).set({ archived: true }).where(eq(clocks.id, archived.id)).run();

    const rows = await listClocks(db, campaignId);
    expect(rows.map((r) => r.id)).toEqual([kept.id]);
  });

  it("sorts running, then paused, then complete", async () => {
    const { db, campaignId } = createTestDb();
    const running = await seed(db, campaignId, { name: "running-clock", segments: 4 });
    const paused = await seed(db, campaignId, { name: "paused-clock" });
    const complete = await seed(db, campaignId, { name: "complete-clock", segments: 4 });

    await updateClock(db, paused.id, { status: "paused" });
    await applyTick(db, complete.id, { delta: 4, currentDay: 120 });

    const rows = await listClocks(db, campaignId);
    expect(rows.map((r) => r.id)).toEqual([running.id, paused.id, complete.id]);
    expect(rows.map((r) => r.status)).toEqual(["running", "paused", "complete"]);
  });
});
