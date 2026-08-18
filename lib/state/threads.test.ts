import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/notion/test-helpers";
import { threads, threadLinks, timelineEvents } from "@/lib/db/schema";
import { createThread, updateThread, listThreads, listThreadsForTarget } from "./threads";

describe("createThread", () => {
  it("creates an open thread stamped with the current in-world day and logs an event", async () => {
    const { db, campaignId } = createTestDb();
    const t = await createThread(db, {
      campaignId, title: "Who hired the assassins?", stakes: "The party stays hunted.", currentDay: 100,
    });

    expect(t.status).toBe("open");
    expect(t.openedOnDay).toBe(100);
    expect(t.lastTouchedDay).toBe(100);

    const events = db.select().from(timelineEvents).all();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "thread_opened", sourceKind: "manual", threadId: t.id });
  });

  it("records the requested source kind on the event", async () => {
    const { db, campaignId } = createTestDb();
    await createThread(db, { campaignId, title: "T", currentDay: 5, sourceKind: "proposal" });
    expect(db.select().from(timelineEvents).all()[0].sourceKind).toBe("proposal");
  });

  it("persists links", async () => {
    const { db, campaignId } = createTestDb();
    const t = await createThread(db, {
      campaignId, title: "T", currentDay: 5,
      links: [{ targetKind: "faction", targetId: "f1", role: "stakeholder" }],
    });
    const links = db.select().from(threadLinks).where(eq(threadLinks.threadId, t.id)).all();
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ targetKind: "faction", targetId: "f1", role: "stakeholder" });
  });

  it("rejects a blank title", async () => {
    const { db, campaignId } = createTestDb();
    await expect(createThread(db, { campaignId, title: "   ", currentDay: 5 })).rejects.toThrow(/title/);
  });

  it("tolerates a null current day before the campaign date is set", async () => {
    const { db, campaignId } = createTestDb();
    const t = await createThread(db, { campaignId, title: "T", currentDay: null });
    expect(t.openedOnDay).toBeNull();
    // No in-world day means no timeline position, so no event is written.
    expect(db.select().from(timelineEvents).all()).toHaveLength(0);
  });
});

describe("updateThread", () => {
  it("resolving writes a thread_resolved event and stamps the day", async () => {
    const { db, campaignId } = createTestDb();
    const t = await createThread(db, { campaignId, title: "T", currentDay: 100 });

    const updated = await updateThread(db, t.id, { status: "resolved", currentDay: 120, resolvedSessionId: "s9" });
    expect(updated.status).toBe("resolved");
    expect(updated.lastTouchedDay).toBe(120);
    expect(updated.resolvedSessionId).toBe("s9");

    const kinds = db.select().from(timelineEvents).all().map((e) => e.kind);
    expect(kinds).toEqual(["thread_opened", "thread_resolved"]);
  });

  it("a non-status edit touches the day without writing a resolve event", async () => {
    const { db, campaignId } = createTestDb();
    const t = await createThread(db, { campaignId, title: "T", currentDay: 100 });
    await updateThread(db, t.id, { title: "T2", currentDay: 110 });

    expect(db.select().from(timelineEvents).all()).toHaveLength(1);
    const row = db.select().from(threads).where(eq(threads.id, t.id)).all()[0];
    expect(row.title).toBe("T2");
    expect(row.lastTouchedDay).toBe(110);
  });

  it("rejects an unknown status", async () => {
    const { db, campaignId } = createTestDb();
    const t = await createThread(db, { campaignId, title: "T", currentDay: 1 });
    await expect(updateThread(db, t.id, { status: "banana" as never, currentDay: 2 })).rejects.toThrow(/status/);
  });

  it("throws on a missing thread", async () => {
    const { db } = createTestDb();
    await expect(updateThread(db, "nope", { title: "x", currentDay: 1 })).rejects.toThrow(/not found/i);
  });
});

describe("listThreads", () => {
  it("orders open threads by staleness, most stale first", async () => {
    const { db, campaignId } = createTestDb();
    await createThread(db, { campaignId, title: "fresh", currentDay: 190 });
    await createThread(db, { campaignId, title: "stale", currentDay: 100 });
    await createThread(db, { campaignId, title: "middling", currentDay: 150 });

    const rows = await listThreads(db, campaignId, { currentDay: 200 });
    expect(rows.map((r) => r.title)).toEqual(["stale", "middling", "fresh"]);
    expect(rows[0].daysUntouched).toBe(100);
  });

  it("excludes resolved and archived threads unless asked", async () => {
    const { db, campaignId } = createTestDb();
    const a = await createThread(db, { campaignId, title: "open", currentDay: 10 });
    const b = await createThread(db, { campaignId, title: "done", currentDay: 10 });
    await updateThread(db, b.id, { status: "resolved", currentDay: 11 });

    expect((await listThreads(db, campaignId, { currentDay: 20 })).map((r) => r.id)).toEqual([a.id]);
    expect((await listThreads(db, campaignId, { currentDay: 20, includeResolved: true })).map((r) => r.title).sort())
      .toEqual(["done", "open"]);
  });

  it("attaches links", async () => {
    const { db, campaignId } = createTestDb();
    await createThread(db, {
      campaignId, title: "T", currentDay: 10,
      links: [{ targetKind: "faction", targetId: "f1", role: "obstacle" }],
    });
    const [row] = await listThreads(db, campaignId, { currentDay: 10 });
    expect(row.links).toEqual([{ targetKind: "faction", targetId: "f1", role: "obstacle" }]);
  });

  it("reports null staleness when there is no current day", async () => {
    const { db, campaignId } = createTestDb();
    await createThread(db, { campaignId, title: "T", currentDay: null });
    const [row] = await listThreads(db, campaignId, { currentDay: null });
    expect(row.daysUntouched).toBeNull();
  });
});

describe("listThreadsForTarget", () => {
  it("finds open threads linked to an entity", async () => {
    const { db, campaignId } = createTestDb();
    await createThread(db, {
      campaignId, title: "Assembly hunts them", currentDay: 10,
      links: [{ targetKind: "faction", targetId: "f1", role: "stakeholder" }],
    });
    await createThread(db, { campaignId, title: "unrelated", currentDay: 10 });

    const rows = await listThreadsForTarget(db, campaignId, "faction", "f1", 20);
    expect(rows.map((r) => r.title)).toEqual(["Assembly hunts them"]);
  });
});
