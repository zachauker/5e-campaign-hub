import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-helpers";
import { readAutoSyncConfig, runAutoSyncTick } from "./scheduler";
import { settings } from "@/lib/db/schema";
import { tryAcquireSync, releaseSync } from "./sync-lock";

describe("readAutoSyncConfig", () => {
  it("defaults to enabled=true, interval=15 when unset", async () => {
    const { db } = createTestDb();
    expect(await readAutoSyncConfig(db)).toEqual({ enabled: true, intervalMinutes: 15 });
  });

  it("treats only the string 'false' as disabled", async () => {
    const { db } = createTestDb();
    db.insert(settings).values({ key: "notion_auto_sync_enabled", value: "false" }).run();
    expect((await readAutoSyncConfig(db)).enabled).toBe(false);
  });

  it("reads a custom interval and falls back to 15 on garbage/too-small values", async () => {
    const { db } = createTestDb();
    db.insert(settings).values({ key: "notion_auto_sync_interval_minutes", value: "30" }).run();
    expect((await readAutoSyncConfig(db)).intervalMinutes).toBe(30);

    db.update(settings).set({ value: "not-a-number" })
      .where(eq(settings.key, "notion_auto_sync_interval_minutes")).run();
    expect((await readAutoSyncConfig(db)).intervalMinutes).toBe(15);

    db.update(settings).set({ value: "0" })
      .where(eq(settings.key, "notion_auto_sync_interval_minutes")).run();
    expect((await readAutoSyncConfig(db)).intervalMinutes).toBe(15);
  });
});

describe("runAutoSyncTick", () => {
  it("runs each campaign returned by listCampaigns", async () => {
    const ran: string[] = [];
    const result = await runAutoSyncTick({
      listCampaigns: async () => ["a", "b"],
      runOne: async (id) => { ran.push(id); },
    });
    expect(ran).toEqual(["a", "b"]);
    expect(result.synced).toEqual(["a", "b"]);
    expect(result.skipped).toEqual([]);
  });

  it("skips a campaign whose lock is already held and never calls runOne for it", async () => {
    const ran: string[] = [];
    expect(tryAcquireSync("busy")).toBe(true);
    try {
      const result = await runAutoSyncTick({
        listCampaigns: async () => ["busy", "free"],
        runOne: async (id) => { ran.push(id); },
      });
      expect(ran).toEqual(["free"]);
      expect(result.synced).toEqual(["free"]);
      expect(result.skipped).toEqual(["busy"]);
    } finally {
      releaseSync("busy");
    }
  });

  it("isolates a failing campaign — the loop continues and the lock is released", async () => {
    const ran: string[] = [];
    const result = await runAutoSyncTick({
      listCampaigns: async () => ["boom", "ok"],
      runOne: async (id) => {
        ran.push(id);
        if (id === "boom") throw new Error("kaboom");
      },
    });
    expect(ran).toEqual(["boom", "ok"]);
    expect(result.synced).toEqual(["ok"]);
    expect(result.failed).toEqual(["boom"]);
    // Lock for the failed campaign must have been released.
    expect(tryAcquireSync("boom")).toBe(true);
    releaseSync("boom");
  });
});
