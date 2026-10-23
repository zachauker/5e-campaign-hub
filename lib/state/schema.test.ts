import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/db/test-helpers";
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

  it("applies column defaults when omitted from the insert", () => {
    const { db, campaignId } = createTestDb();
    const now = new Date();

    db.insert(threads).values({
      id: "t2", campaignId, title: "Untitled thread", createdAt: now, updatedAt: now,
    }).run();
    const thread = db.select().from(threads).where(eq(threads.id, "t2")).all()[0];
    expect(thread.status).toBe("open");
    expect(thread.archived).toBe(false);

    db.insert(threadLinks).values({
      id: "tl2", threadId: "t2", targetKind: "location", targetId: "loc1",
    }).run();
    const link = db.select().from(threadLinks).where(eq(threadLinks.id, "tl2")).all()[0];
    expect(link.role).toBe("subject");

    db.insert(clocks).values({
      id: "c2", campaignId, name: "Untitled clock", createdAt: now, updatedAt: now,
    }).run();
    const clock = db.select().from(clocks).where(eq(clocks.id, "c2")).all()[0];
    expect(clock.segments).toBe(8);
    expect(clock.filled).toBe(0);
    expect(clock.status).toBe("running");

    db.insert(timelineEvents).values({
      id: "e2", campaignId, day: 1, kind: "note", title: "Untitled event", createdAt: now,
    }).run();
    const event = db.select().from(timelineEvents).where(eq(timelineEvents.id, "e2")).all()[0];
    expect(event.sourceKind).toBe("manual");

    db.insert(sessionReviews).values({
      id: "r2", sessionNoteId: "s2", reviewedAt: now, contentHash: "def",
    }).run();
    const review = db.select().from(sessionReviews).where(eq(sessionReviews.id, "r2")).all()[0];
    expect(review.proposalCount).toBe(0);
  });

  it("cascades campaign delete to threads, clocks, and timeline events, but leaves session_reviews alone", () => {
    const { db, campaignId } = createTestDb();
    const now = new Date();

    db.insert(threads).values({
      id: "t3", campaignId, title: "Doomed thread", createdAt: now, updatedAt: now,
    }).run();
    db.insert(clocks).values({
      id: "c3", campaignId, name: "Doomed clock", createdAt: now, updatedAt: now,
    }).run();
    db.insert(timelineEvents).values({
      id: "e3", campaignId, day: 1, kind: "note", title: "Doomed event", createdAt: now,
    }).run();
    db.insert(sessionReviews).values({
      id: "r3", sessionNoteId: "s3", reviewedAt: now, contentHash: "ghi",
    }).run();

    db.delete(campaigns).where(eq(campaigns.id, campaignId)).run();

    expect(db.select().from(threads).where(eq(threads.id, "t3")).all()).toHaveLength(0);
    expect(db.select().from(clocks).where(eq(clocks.id, "c3")).all()).toHaveLength(0);
    expect(db.select().from(timelineEvents).where(eq(timelineEvents.id, "e3")).all()).toHaveLength(0);
    // session_reviews carries no campaign FK by design (see lib/db/schema.ts) — it survives.
    expect(db.select().from(sessionReviews).where(eq(sessionReviews.id, "r3")).all()).toHaveLength(1);
  });
});
