import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/db/test-helpers";
import {
  readAutoSyncConfig,
  runAutoSyncTick,
  runTickAndComputeDelay,
  startNotionAutoSync,
} from "./scheduler";
import { settings } from "@/lib/db/schema";
import { tryAcquireSync, releaseSync } from "./sync-lock";

const MIN = 60_000;

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

describe("runTickAndComputeDelay", () => {
  it("runs the tick when enabled and returns the configured interval as ms", async () => {
    const runTick = vi.fn(async () => {});
    const delay = await runTickAndComputeDelay({
      readConfig: async () => ({ enabled: true, intervalMinutes: 30 }),
      runTick,
    });
    expect(runTick).toHaveBeenCalledTimes(1);
    expect(delay).toBe(30 * MIN);
  });

  it("skips the tick when disabled but still returns the configured interval", async () => {
    const runTick = vi.fn(async () => {});
    const delay = await runTickAndComputeDelay({
      readConfig: async () => ({ enabled: false, intervalMinutes: 60 }),
      runTick,
    });
    expect(runTick).not.toHaveBeenCalled();
    expect(delay).toBe(60 * MIN);
  });

  it("reschedules at the default interval when reading config throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const runTick = vi.fn(async () => {});
      const delay = await runTickAndComputeDelay({
        readConfig: async () => { throw new Error("db down"); },
        runTick,
      });
      expect(runTick).not.toHaveBeenCalled();
      expect(delay).toBe(15 * MIN); // DEFAULT_INTERVAL_MINUTES
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("does not throw and still returns a delay when the tick itself throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const delay = await runTickAndComputeDelay({
        readConfig: async () => ({ enabled: true, intervalMinutes: 5 }),
        runTick: async () => { throw new Error("kaboom"); },
      });
      expect(delay).toBe(5 * MIN);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("startNotionAutoSync", () => {
  it("is idempotent — repeated calls schedule only one timer", () => {
    vi.useFakeTimers();
    try {
      const before = vi.getTimerCount();
      startNotionAutoSync();
      startNotionAutoSync();
      startNotionAutoSync();
      expect(vi.getTimerCount()).toBe(before + 1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
