import { describe, it, expect, beforeEach } from "vitest";
import { tryAcquireSync, releaseSync, isSyncing } from "./sync-lock";

describe("sync-lock", () => {
  beforeEach(() => {
    // Ensure a clean lock state between tests.
    releaseSync("c1");
    releaseSync("c2");
  });

  it("acquires a free campaign and reports it as syncing", () => {
    expect(tryAcquireSync("c1")).toBe(true);
    expect(isSyncing("c1")).toBe(true);
  });

  it("refuses a second acquire until released", () => {
    expect(tryAcquireSync("c1")).toBe(true);
    expect(tryAcquireSync("c1")).toBe(false);
    releaseSync("c1");
    expect(tryAcquireSync("c1")).toBe(true);
  });

  it("tracks campaigns independently", () => {
    expect(tryAcquireSync("c1")).toBe(true);
    expect(tryAcquireSync("c2")).toBe(true);
    expect(isSyncing("c1")).toBe(true);
    expect(isSyncing("c2")).toBe(true);
  });

  it("releasing a non-held campaign is a no-op", () => {
    expect(() => releaseSync("never-held")).not.toThrow();
    expect(isSyncing("never-held")).toBe(false);
  });
});
