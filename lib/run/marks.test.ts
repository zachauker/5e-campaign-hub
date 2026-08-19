import { describe, it, expect } from "vitest";
import { createTestDb } from "@/lib/notion/test-helpers";
import { NotFoundError } from "@/lib/state/errors";
import { startRun } from "./runs";
import { createMark, listMarks, setMarkResolved, MARK_TAGS } from "./marks";

describe("createMark", () => {
  it("stores the offset, wall clock, and context", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    const mark = await createMark(db, {
      campaignId, runSessionId: run.id, atMs: 84_000,
      tag: "npc", contextKind: "character", contextId: "c1",
    });

    expect(mark.atMs).toBe(84_000);
    expect(mark.tag).toBe("npc");
    expect(mark.contextKind).toBe("character");
    expect(mark.contextId).toBe("c1");
    expect(mark.wallClock).toBeInstanceOf(Date);
    expect(mark.resolved).toBe(false);
  });

  it("accepts a bare mark with no tag, note, or context", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    const mark = await createMark(db, { campaignId, runSessionId: run.id, atMs: 0 });
    expect(mark.tag).toBeNull();
    expect(mark.note).toBeNull();
    expect(mark.contextKind).toBeNull();
  });

  it("rejects an unknown tag", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    await expect(
      createMark(db, { campaignId, runSessionId: run.id, atMs: 0, tag: "vibes" as never }),
    ).rejects.toThrow(/tag/);
  });

  it("rejects a negative offset", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    await expect(
      createMark(db, { campaignId, runSessionId: run.id, atMs: -1 }),
    ).rejects.toThrow(/atMs/);
  });

  it("throws for an unknown run", async () => {
    const { db, campaignId } = createTestDb();
    await expect(
      createMark(db, { campaignId, runSessionId: "nope", atMs: 0 }),
    ).rejects.toThrow(NotFoundError);
  });
});

  it("rejects an atMs that rounds to negative zero", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    // Math.round() maps anything in (-1, 0) to -0, and both Number.isInteger(-0)
    // and !(-0 < 0) are true — so without an explicit check a mark timestamped a
    // fraction of a second before the run started is stored as 0.
    await expect(
      createMark(db, { campaignId, runSessionId: run.id, atMs: -0 }),
    ).rejects.toThrow(/atMs/);
  });


describe("listMarks", () => {
  it("returns marks in table order", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    await createMark(db, { campaignId, runSessionId: run.id, atMs: 5_000 });
    await createMark(db, { campaignId, runSessionId: run.id, atMs: 1_000 });
    const marks = await listMarks(db, run.id);
    expect(marks.map((m) => m.atMs)).toEqual([1_000, 5_000]);
  });

  it("does not leak another run's marks", async () => {
    const { db, campaignId } = createTestDb();
    const first = await startRun(db, { campaignId });
    await createMark(db, { campaignId, runSessionId: first.id, atMs: 1 });
    const second = await startRun(db, { campaignId });
    await createMark(db, { campaignId, runSessionId: second.id, atMs: 2 });
    expect((await listMarks(db, second.id)).map((m) => m.atMs)).toEqual([2]);
  });
});

describe("setMarkResolved", () => {
  it("flips and unflips resolved", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    const mark = await createMark(db, { campaignId, runSessionId: run.id, atMs: 0 });
    expect((await setMarkResolved(db, mark.id, true)).resolved).toBe(true);
    expect((await setMarkResolved(db, mark.id, false)).resolved).toBe(false);
  });
});

describe("MARK_TAGS", () => {
  it("is the five tags the number keys map to", () => {
    expect(MARK_TAGS).toEqual(["npc", "promise", "loot", "lore", "todo"]);
  });
});

describe("createMark idempotency", () => {
  it("returns the existing mark for a repeated localId instead of inserting a second row", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    const first = await createMark(db, {
      campaignId, runSessionId: run.id, atMs: 1_000, localId: "local-1",
    });
    // Simulates a retry after the first response was lost: same localId, same
    // logical mark, arrives a second time.
    const second = await createMark(db, {
      campaignId, runSessionId: run.id, atMs: 1_000, localId: "local-1",
    });
    expect(second.id).toBe(first.id);
    expect(await listMarks(db, run.id)).toHaveLength(1);
  });

  it("does not dedupe marks with no localId", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    await createMark(db, { campaignId, runSessionId: run.id, atMs: 1_000 });
    await createMark(db, { campaignId, runSessionId: run.id, atMs: 1_000 });
    expect(await listMarks(db, run.id)).toHaveLength(2);
  });
});
