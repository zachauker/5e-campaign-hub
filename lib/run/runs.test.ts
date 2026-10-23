import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/lib/db/test-helpers";
import { NotFoundError } from "@/lib/state/errors";
import { startRun, endRun, getActiveRun, listRuns, linkSessionNote } from "./runs";

describe("startRun", () => {
  it("creates an open run", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    expect(run.endedAt).toBeNull();
    expect(run.campaignId).toBe(campaignId);
  });

  it("auto-closes a run the DM forgot to end", async () => {
    const { db, campaignId } = createTestDb();
    const first = await startRun(db, { campaignId });
    const second = await startRun(db, { campaignId });

    const runs = await listRuns(db, campaignId);
    expect(runs.find((r) => r.id === first.id)!.endedAt).not.toBeNull();
    expect(runs.find((r) => r.id === second.id)!.endedAt).toBeNull();
  });

  it("does not close another campaign's open run", async () => {
    const { db, campaignId } = createTestDb();
    // A real row, not a made-up id: run_sessions.campaign_id is a genuine
    // foreign key and the test database runs with foreign_keys = ON, so an
    // invented campaign id fails on insert rather than exercising the filter.
    db.run(sql`INSERT INTO campaigns (id, name, created_at) VALUES ('other-campaign', 'Other', 1)`);
    const other = await startRun(db, { campaignId });
    await startRun(db, { campaignId: "other-campaign" });
    const runs = await listRuns(db, campaignId);
    expect(runs.find((r) => r.id === other.id)!.endedAt).toBeNull();
  });

  it("leaves exactly one open run when starts race", async () => {
    const { db, campaignId } = createTestDb();
    // POST /api/runs is reachable twice in quick succession — a double-click
    // entering run mode, a retry, or React re-invoking the start effect.
    // Without the close and the insert being one operation, each request closes
    // nothing and inserts one, leaving several open runs at once.
    await Promise.all([
      startRun(db, { campaignId }),
      startRun(db, { campaignId }),
      startRun(db, { campaignId }),
    ]);
    const open = db.all<{ n: number }>(sql`
      SELECT COUNT(*) AS n FROM run_sessions
      WHERE campaign_id = ${campaignId} AND ended_at IS NULL
    `);
    expect(open[0].n).toBe(1);
  });
});

describe("getActiveRun", () => {
  it("returns the open run", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    expect((await getActiveRun(db, campaignId))?.id).toBe(run.id);
  });

  it("returns null once the run has ended", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    await endRun(db, run.id);
    expect(await getActiveRun(db, campaignId)).toBeNull();
  });
});

describe("endRun", () => {
  it("stamps endedAt", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    const ended = await endRun(db, run.id);
    expect(ended.endedAt).toBeInstanceOf(Date);
  });

  it("leaves an already-ended run's timestamp alone", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    const first = await endRun(db, run.id);
    const second = await endRun(db, run.id);
    expect(second.endedAt!.getTime()).toBe(first.endedAt!.getTime());
  });

  it("throws for an unknown run", async () => {
    const { db } = createTestDb();
    await expect(endRun(db, "nope")).rejects.toThrow(NotFoundError);
  });
});

describe("linkSessionNote", () => {
  it("attaches the note id so the review pass can find the marks", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    const linked = await linkSessionNote(db, run.id, "note-1");
    expect(linked.sessionNoteId).toBe("note-1");
  });
});
