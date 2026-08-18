import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/notion/test-helpers";
import { clocks, timelineEvents } from "@/lib/db/schema";
import { createClock } from "./clocks";
import { previewAdvance, applyAdvance, setDate, getCampaignDay } from "./advance";

async function withDate(campaignId: string, db: ReturnType<typeof createTestDb>["db"], day = 100) {
  await setDate(db, campaignId, day, "P.D.");
}

describe("setDate", () => {
  it("sets the in-world day and epoch label without ticking anything", async () => {
    const { db, campaignId } = createTestDb();
    const c = await createClock(db, { campaignId, name: "C", cadenceDays: 7, currentDay: 100 });

    await setDate(db, campaignId, 100, "P.D.");
    await setDate(db, campaignId, 300, "P.D."); // a correction, far in the future

    expect(await getCampaignDay(db, campaignId)).toBe(300);
    const row = db.select().from(clocks).where(eq(clocks.id, c.id)).all()[0];
    expect(row.filled).toBe(0);
    expect(db.select().from(timelineEvents).all()).toHaveLength(0);
  });

  it("rejects a negative or non-integer day", async () => {
    const { db, campaignId } = createTestDb();
    await expect(setDate(db, campaignId, -1, "P.D.")).rejects.toThrow(/non-negative/);
    await expect(setDate(db, campaignId, 1.5, "P.D.")).rejects.toThrow(/non-negative/);
  });
});

describe("previewAdvance", () => {
  it("returns due ticks without mutating anything", async () => {
    const { db, campaignId } = createTestDb();
    await withDate(campaignId, db);
    const c = await createClock(db, { campaignId, name: "Assembly", segments: 8, cadenceDays: 7, currentDay: 100 });

    const preview = await previewAdvance(db, campaignId, 120);
    expect(preview.fromDay).toBe(100);
    expect(preview.toDay).toBe(120);
    expect(preview.dueTicks).toHaveLength(1);
    expect(preview.dueTicks[0]).toMatchObject({ clockId: c.id, ticks: 2, nextLastTickedDay: 114 });

    expect(await getCampaignDay(db, campaignId)).toBe(100);
    expect(db.select().from(clocks).all()[0].filled).toBe(0);
  });

  it("rejects moving time backwards or standing still", async () => {
    const { db, campaignId } = createTestDb();
    await withDate(campaignId, db);
    await expect(previewAdvance(db, campaignId, 99)).rejects.toThrow(/forward/);
    await expect(previewAdvance(db, campaignId, 100)).rejects.toThrow(/forward/);
  });

  it("refuses to advance before the campaign date is set", async () => {
    const { db, campaignId } = createTestDb();
    await expect(previewAdvance(db, campaignId, 100)).rejects.toThrow(/in-world date/);
  });
});

describe("applyAdvance", () => {
  it("applies accepted ticks with remainder-preserving lastTickedDay", async () => {
    const { db, campaignId } = createTestDb();
    await withDate(campaignId, db);
    const c = await createClock(db, { campaignId, name: "Assembly", segments: 8, cadenceDays: 7, currentDay: 100 });

    const result = await applyAdvance(db, campaignId, 120, [c.id]);
    expect(result).toMatchObject({ applied: 1, declined: 0, toDay: 120 });

    const row = db.select().from(clocks).where(eq(clocks.id, c.id)).all()[0];
    expect(row.filled).toBe(2);
    expect(row.lastTickedDay).toBe(114); // remainder credit preserved
    expect(await getCampaignDay(db, campaignId)).toBe(120);
  });

  it("skips a declined tick and jumps its lastTickedDay so it is not re-proposed", async () => {
    const { db, campaignId } = createTestDb();
    await withDate(campaignId, db);
    const c = await createClock(db, { campaignId, name: "Assembly", segments: 8, cadenceDays: 7, currentDay: 100 });

    const result = await applyAdvance(db, campaignId, 120, []); // accepted nothing
    expect(result).toMatchObject({ applied: 0, declined: 1 });

    const row = db.select().from(clocks).where(eq(clocks.id, c.id)).all()[0];
    expect(row.filled).toBe(0);
    expect(row.lastTickedDay).toBe(120);

    // And a second advance proposes nothing new until another full period passes.
    expect((await previewAdvance(db, campaignId, 126)).dueTicks).toEqual([]);
  });

  it("renders the epoch label into the date_advanced event text", async () => {
    const { db, campaignId } = createTestDb();
    await setDate(db, campaignId, 276_000, "P.D.");
    await applyAdvance(db, campaignId, 276_001, []);

    const evt = db.select().from(timelineEvents).all().find((e) => e.kind === "date_advanced");
    expect(evt?.title).toBe("Time advances to 6th of Brussendar, 841 P.D.");
    expect(evt?.body).toContain("1 day(s) elapsed");
  });

  it("writes a date_advanced event plus one clock_ticked event per applied tick", async () => {
    const { db, campaignId } = createTestDb();
    await withDate(campaignId, db);
    const c = await createClock(db, { campaignId, name: "Assembly", segments: 8, cadenceDays: 7, currentDay: 100 });

    await applyAdvance(db, campaignId, 120, [c.id]);
    const kinds = db.select().from(timelineEvents).all().map((e) => e.kind).sort();
    expect(kinds).toEqual(["clock_ticked", "date_advanced"]);
    expect(db.select().from(timelineEvents).all().every((e) => e.day === 120)).toBe(true);
  });

  it("marks a clock complete and logs completion when it fills mid-jump", async () => {
    const { db, campaignId } = createTestDb();
    await withDate(campaignId, db);
    const c = await createClock(db, { campaignId, name: "Doom", segments: 4, cadenceDays: 7, currentDay: 100 });

    await applyAdvance(db, campaignId, 100 + 7 * 10, [c.id]);
    const row = db.select().from(clocks).where(eq(clocks.id, c.id)).all()[0];
    expect(row.filled).toBe(4);
    expect(row.status).toBe("complete");
    expect(db.select().from(timelineEvents).all().map((e) => e.kind)).toContain("clock_completed");
  });

  it("leaves manual-only and paused clocks entirely alone", async () => {
    const { db, campaignId } = createTestDb();
    await withDate(campaignId, db);
    const manual = await createClock(db, { campaignId, name: "manual", cadenceDays: null, currentDay: 100 });

    await applyAdvance(db, campaignId, 200, []);
    const row = db.select().from(clocks).where(eq(clocks.id, manual.id)).all()[0];
    expect(row.filled).toBe(0);
    expect(row.lastTickedDay).toBe(100); // untouched, not jumped
  });

  it("ignores accepted ids that are not actually due", async () => {
    const { db, campaignId } = createTestDb();
    await withDate(campaignId, db);
    await createClock(db, { campaignId, name: "C", cadenceDays: 7, currentDay: 100 });

    const result = await applyAdvance(db, campaignId, 103, ["not-a-real-clock"]);
    expect(result).toMatchObject({ applied: 0, declined: 0 });
    expect(await getCampaignDay(db, campaignId)).toBe(103);
  });

  it("rejects moving time backwards", async () => {
    const { db, campaignId } = createTestDb();
    await withDate(campaignId, db);
    await expect(applyAdvance(db, campaignId, 50, [])).rejects.toThrow(/forward/);
  });
});
