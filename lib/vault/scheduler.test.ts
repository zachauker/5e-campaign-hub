import { describe, it, expect, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/db/test-helpers";
import {
  readAutoSyncConfig,
  runAutoSyncTick,
  runTickAndComputeDelay,
  startVaultSync,
  VAULT_AUTO_SYNC_ENABLED_KEY,
  VAULT_AUTO_SYNC_INTERVAL_KEY,
  DEFAULT_INTERVAL_MINUTES,
  FIRST_TICK_DELAY_MS,
} from "./scheduler";
import { settings } from "@/lib/db/schema";
import { tryAcquireSync, releaseSync } from "./sync-lock";

const MIN = 60_000;

function put(db: ReturnType<typeof createTestDb>["db"], key: string, value: string) {
  db.insert(settings).values({ key, value }).run();
}

describe("settings keys", () => {
  it("exposes the vault key names and defaults", () => {
    expect(VAULT_AUTO_SYNC_ENABLED_KEY).toBe("vault_auto_sync_enabled");
    expect(VAULT_AUTO_SYNC_INTERVAL_KEY).toBe("vault_auto_sync_interval_minutes");
    expect(DEFAULT_INTERVAL_MINUTES).toBe(15);
    expect(FIRST_TICK_DELAY_MS).toBe(30_000);
  });
});

describe("readAutoSyncConfig", () => {
  it("defaults to enabled at 15 minutes", async () => {
    const { db } = createTestDb();
    expect(await readAutoSyncConfig(db)).toEqual({ enabled: true, intervalMinutes: 15 });
  });

  it("reads the vault_auto_sync keys", async () => {
    const { db } = createTestDb();
    put(db, "vault_auto_sync_enabled", "false");
    put(db, "vault_auto_sync_interval_minutes", "30");
    expect(await readAutoSyncConfig(db)).toEqual({ enabled: false, intervalMinutes: 30 });
  });

  it("falls back to the legacy notion_auto_sync keys when the vault keys are unset", async () => {
    const { db } = createTestDb();
    put(db, "notion_auto_sync_interval_minutes", "5");
    put(db, "notion_auto_sync_enabled", "false");
    expect(await readAutoSyncConfig(db)).toEqual({ enabled: false, intervalMinutes: 5 });
  });

  it("falls back per key: a new interval with a legacy enabled flag", async () => {
    const { db } = createTestDb();
    put(db, "vault_auto_sync_interval_minutes", "45");
    put(db, "notion_auto_sync_enabled", "false");
    expect(await readAutoSyncConfig(db)).toEqual({ enabled: false, intervalMinutes: 45 });
  });

  it("prefers the vault keys when both are set", async () => {
    const { db } = createTestDb();
    put(db, "notion_auto_sync_interval_minutes", "5");
    put(db, "notion_auto_sync_enabled", "false");
    put(db, "vault_auto_sync_interval_minutes", "60");
    put(db, "vault_auto_sync_enabled", "true");
    expect(await readAutoSyncConfig(db)).toEqual({ enabled: true, intervalMinutes: 60 });
  });

  it("does not fall back to a legacy key when the vault key is set but garbage", async () => {
    const { db } = createTestDb();
    put(db, "vault_auto_sync_interval_minutes", "soon");
    put(db, "notion_auto_sync_interval_minutes", "5");
    expect((await readAutoSyncConfig(db)).intervalMinutes).toBe(15);
  });

  it("ignores a garbage or too-small interval", async () => {
    const { db } = createTestDb();
    put(db, "vault_auto_sync_interval_minutes", "30");
    expect((await readAutoSyncConfig(db)).intervalMinutes).toBe(30);

    db.update(settings).set({ value: "not-a-number" })
      .where(eq(settings.key, "vault_auto_sync_interval_minutes")).run();
    expect((await readAutoSyncConfig(db)).intervalMinutes).toBe(15);

    db.update(settings).set({ value: "0" })
      .where(eq(settings.key, "vault_auto_sync_interval_minutes")).run();
    expect((await readAutoSyncConfig(db)).intervalMinutes).toBe(15);
  });

  it("treats only the string 'false' as disabled", async () => {
    const { db } = createTestDb();
    put(db, "vault_auto_sync_enabled", "nope");
    expect((await readAutoSyncConfig(db)).enabled).toBe(true);
  });
});

describe("runAutoSyncTick", () => {
  it("syncs every campaign with a source", async () => {
    const ran: string[] = [];
    const result = await runAutoSyncTick({
      listCampaigns: async () => ["a", "b"],
      runOne: async (id) => { ran.push(id); },
    });
    expect(ran).toEqual(["a", "b"]);
    expect(result).toEqual({ synced: ["a", "b"], skipped: [], failed: [] });
  });

  it("skips a campaign whose lock is held and never runs it", async () => {
    const ran: string[] = [];
    expect(tryAcquireSync("busy")).toBe(true);
    try {
      const result = await runAutoSyncTick({
        listCampaigns: async () => ["busy", "free"],
        runOne: async (id) => { ran.push(id); },
      });
      expect(ran).toEqual(["free"]);
      expect(result.skipped).toEqual(["busy"]);
      expect(result.synced).toEqual(["free"]);
    } finally {
      releaseSync("busy");
    }
  });

  it("isolates a failing campaign — the loop continues and the lock is released", async () => {
    const log = vi.fn();
    const ran: string[] = [];
    const result = await runAutoSyncTick({
      listCampaigns: async () => ["boom", "ok"],
      runOne: async (id) => {
        ran.push(id);
        if (id === "boom") throw new Error("kaboom");
      },
      log,
    });
    expect(ran).toEqual(["boom", "ok"]);
    expect(result).toEqual({ synced: ["ok"], skipped: [], failed: ["boom"] });
    expect(log).toHaveBeenCalledTimes(1);
    expect(tryAcquireSync("boom")).toBe(true);
    releaseSync("boom");
  });

  it("returns an empty result when listing campaigns throws", async () => {
    const log = vi.fn();
    const result = await runAutoSyncTick({
      listCampaigns: async () => { throw new Error("db down"); },
      log,
    });
    expect(result).toEqual({ synced: [], skipped: [], failed: [] });
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe("runTickAndComputeDelay", () => {
  it("runs the tick when enabled and returns the configured interval in ms", async () => {
    const runTick = vi.fn(async () => {});
    const delay = await runTickAndComputeDelay({
      readConfig: async () => ({ enabled: true, intervalMinutes: 30 }),
      runTick,
    });
    expect(runTick).toHaveBeenCalledTimes(1);
    expect(delay).toBe(30 * MIN);
  });

  it("does not run the tick when disabled, but still returns the interval", async () => {
    const runTick = vi.fn(async () => {});
    const delay = await runTickAndComputeDelay({
      readConfig: async () => ({ enabled: false, intervalMinutes: 60 }),
      runTick,
    });
    expect(runTick).not.toHaveBeenCalled();
    expect(delay).toBe(60 * MIN);
  });

  describe("when something throws", () => {
    afterEach(() => vi.restoreAllMocks());

    it("returns the default interval when reading config throws", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const runTick = vi.fn(async () => {});
      const delay = await runTickAndComputeDelay({
        readConfig: async () => { throw new Error("db down"); },
        runTick,
      });
      expect(runTick).not.toHaveBeenCalled();
      expect(delay).toBe(DEFAULT_INTERVAL_MINUTES * MIN);
    });

    it("returns the default interval when the tick throws", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const delay = await runTickAndComputeDelay({
        readConfig: async () => ({ enabled: true, intervalMinutes: 5 }),
        runTick: async () => { throw new Error("kaboom"); },
      });
      // The config was read before the tick threw, so its interval is kept.
      expect(delay).toBe(5 * MIN);
    });
  });
});

describe("startVaultSync", () => {
  it("is idempotent and schedules one unref'd timer at the first-tick delay", () => {
    vi.useFakeTimers();
    const realSetTimeout = globalThis.setTimeout;
    const scheduled: number[] = [];
    const unref = vi.fn();
    // Wrap the (fake) setTimeout so we can see the delay and that unref() is called.
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      scheduled.push(ms ?? 0);
      const t = realSetTimeout(fn, ms) as unknown as { unref: () => unknown };
      const innerUnref = t.unref.bind(t);
      t.unref = () => { unref(); return innerUnref(); };
      return t;
    }) as typeof setTimeout;
    try {
      startVaultSync();
      startVaultSync();
      startVaultSync();
      expect(scheduled).toEqual([FIRST_TICK_DELAY_MS]);
      expect(unref).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.setTimeout = realSetTimeout;
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
