import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/notion/test-helpers";
import { threads, threadLinks, clocks, timelineEvents, sessionReviews, campaigns } from "@/lib/db/schema";

describe("campaign state schema", () => {
  it("stores a thread with links and cascades the link on thread delete", () => {
    const { db, campaignId } = createTestDb();
    const now = new Date();

    db.insert(threads).values({
      id: "t1", campaignId, title: "Who hired the assassins?", stakes: "The party stays hunted.",
      status: "open", openedOnDay: 100, lastTouchedDay: 100, createdAt: now, updatedAt: now,
    }).run();

    db.insert(threadLinks).values({
      id: "tl1", threadId: "t1", targetKind: "faction", targetId: "f1", role: "stakeholder",
    }).run();

    expect(db.select().from(threadLinks).where(eq(threadLinks.threadId, "t1")).all()).toHaveLength(1);

    db.delete(threads).where(eq(threads.id, "t1")).run();
    expect(db.select().from(threadLinks).where(eq(threadLinks.threadId, "t1")).all()).toHaveLength(0);
  });

  it("stores a clock, a timeline event, and a session review", () => {
    const { db, campaignId } = createTestDb();
    const now = new Date();

    db.insert(clocks).values({
      id: "c1", campaignId, name: "Assembly investigation", segments: 8, filled: 3,
      ownerKind: "faction", ownerId: "f1", cadenceDays: 7, lastTickedDay: 100,
      status: "running", payoff: "They identify the party.", createdAt: now, updatedAt: now,
    }).run();
    expect(db.select().from(clocks).all()[0].filled).toBe(3);

    db.insert(timelineEvents).values({
      id: "e1", campaignId, day: 107, kind: "clock_ticked", title: "Assembly investigation +1",
      sourceKind: "cadence", clockId: "c1", createdAt: now,
    }).run();
    expect(db.select().from(timelineEvents).all()[0].sourceKind).toBe("cadence");

    db.insert(sessionReviews).values({
      id: "r1", sessionNoteId: "s1", reviewedAt: now, contentHash: "abc", proposalCount: 4,
    }).run();
    expect(db.select().from(sessionReviews).all()[0].proposalCount).toBe(4);
  });

  it("defaults campaigns.inWorldDay to null and accepts an epoch label", () => {
    const { db, campaignId } = createTestDb();
    const row = db.select().from(campaigns).where(eq(campaigns.id, campaignId)).all()[0];
    expect(row.inWorldDay).toBeNull();

    db.update(campaigns).set({ inWorldDay: 276_000, calendarEpochLabel: "P.D." }).where(eq(campaigns.id, campaignId)).run();
    const updated = db.select().from(campaigns).where(eq(campaigns.id, campaignId)).all()[0];
    expect(updated.inWorldDay).toBe(276_000);
    expect(updated.calendarEpochLabel).toBe("P.D.");
  });
});
