import { describe, it, expect } from "vitest";
import type { SyncSummary, SourceSummary } from "./sync";
import { dedupeWarnings, describeSyncFailure, parseSyncStatus } from "./sync-status";

function table(over: Partial<SourceSummary> = {}): SourceSummary {
  return { created: 0, adopted: 0, updated: 0, unchanged: 0, archived: 0, skipped: 0, warnings: [], ...over };
}

function summary(over: { tables?: Partial<SyncSummary["tables"]>; campaign?: SyncSummary["campaign"] } = {}): SyncSummary {
  return {
    tables: {
      characters: table(), locations: table(), items: table(), factions: table(), sessionNotes: table(),
      ...over.tables,
    },
    campaign: over.campaign ?? { skipped: 0, warnings: [] },
  };
}

describe("dedupeWarnings", () => {
  it("collapses identical strings, keeping first-seen order", () => {
    expect(dedupeWarnings([["a", "b"], ["b", "c"], ["a"]])).toEqual(["a", "b", "c"]);
  });

  it("returns an empty list when there is nothing to show", () => {
    expect(dedupeWarnings([[], []])).toEqual([]);
  });

  it("keeps distinct warnings that name different tables", () => {
    expect(dedupeWarnings([["Locations: could not be read"], ["Items: could not be read"]])).toEqual([
      "Locations: could not be read",
      "Items: could not be read",
    ]);
  });

  it("collapses a table-specific warning carried by two tables", () => {
    const w = "Locations: could not be read";
    expect(dedupeWarnings([[w], ["Items: could not be read"], [w]])).toEqual([w, "Items: could not be read"]);
  });

  it("does not merge strings that merely look alike", () => {
    expect(dedupeWarnings([["x was skipped"], ["x was skipped "]])).toHaveLength(2);
  });
});

describe("parseSyncStatus", () => {
  it("is 'never' for a source that has not synced", () => {
    expect(parseSyncStatus(null)).toEqual({ kind: "never" });
    expect(parseSyncStatus(undefined)).toEqual({ kind: "never" });
    expect(parseSyncStatus("")).toEqual({ kind: "never" });
  });

  it("renders the mount-failure shape { error } as an error, not a blank", () => {
    const status = parseSyncStatus(JSON.stringify({ error: "Vault folder is not readable: /vault/D&D" }));
    expect(status).toEqual({ kind: "error", message: "Vault folder is not readable: /vault/D&D" });
  });

  it("discriminates on error first, even if tables are somehow present too", () => {
    const status = parseSyncStatus({ error: "boom", ...summary() });
    expect(status).toEqual({ kind: "error", message: "boom" });
  });

  it("falls back to a generic message for an empty error", () => {
    const status = parseSyncStatus({ error: "" });
    expect(status.kind).toBe("error");
    if (status.kind === "error") expect(status.message.length).toBeGreaterThan(0);
  });

  it("parses the nested success summary into labelled rows in a stable order", () => {
    const status = parseSyncStatus(JSON.stringify(summary({
      tables: { characters: table({ created: 3, updated: 1, adopted: 2, archived: 4, unchanged: 7, skipped: 5 }) },
    })));
    expect(status.kind).toBe("ok");
    if (status.kind !== "ok") return;
    expect(status.tables.map((t) => t.table)).toEqual(["characters", "locations", "items", "factions", "sessionNotes"]);
    expect(status.tables.map((t) => t.label)).toEqual([
      "Characters", "Locations", "Items & Loot", "Factions & Organizations", "Session Timeline",
    ]);
    expect(status.tables[0]).toMatchObject({ created: 3, adopted: 2, updated: 1, unchanged: 7, archived: 4, skipped: 5 });
  });

  it("accepts an already-parsed object (the POST response) as well as a string", () => {
    const status = parseSyncStatus(summary({ campaign: { skipped: 6, warnings: [] } }));
    expect(status.kind).toBe("ok");
    if (status.kind === "ok") expect(status.campaignSkipped).toBe(6);
  });

  it("shows the incomplete-scan warning once when all five tables carry it", () => {
    const w = "2 notes could not be read, so nothing was archived";
    const status = parseSyncStatus(summary({
      tables: {
        characters: table({ warnings: [w] }), locations: table({ warnings: [w] }), items: table({ warnings: [w] }),
        factions: table({ warnings: [w] }), sessionNotes: table({ warnings: [w] }),
      },
      campaign: { skipped: 0, warnings: ["Bad.md could not be parsed"] },
    }));
    expect(status.kind).toBe("ok");
    if (status.kind !== "ok") return;
    expect(status.warnings.filter((x) => x === w)).toHaveLength(1);
    expect(status.warnings).toContain("Bad.md could not be parsed");
    expect(status.warnings).toHaveLength(2);
  });

  it("keeps a per-table error on that table's row", () => {
    const status = parseSyncStatus(summary({ tables: { items: table({ error: "disk full" }) } }));
    expect(status.kind).toBe("ok");
    if (status.kind === "ok") expect(status.tables.find((t) => t.table === "items")?.error).toBe("disk full");
  });

  it("treats unparseable JSON as unrecognised rather than throwing", () => {
    expect(parseSyncStatus("{not json")).toEqual({ kind: "unrecognised" });
  });

  it("treats a shape with neither error nor tables as unrecognised", () => {
    expect(parseSyncStatus({ something: "else" })).toEqual({ kind: "unrecognised" });
    expect(parseSyncStatus(42)).toEqual({ kind: "unrecognised" });
  });

  it("tolerates a table row missing from the summary", () => {
    const partial = { tables: { characters: table({ created: 1 }) }, campaign: { skipped: 0, warnings: [] } };
    const status = parseSyncStatus(partial);
    expect(status.kind).toBe("ok");
    if (status.kind === "ok") {
      expect(status.tables).toHaveLength(5);
      expect(status.tables[1]).toMatchObject({ table: "locations", created: 0 });
    }
  });
});

describe("describeSyncFailure", () => {
  it("turns a 503 into the dropped-mount message", () => {
    expect(describeSyncFailure(503, "Vault folder is not readable")).toBe(
      "The vault folder isn't reachable from the server. Check that the vault is still mounted into the container.",
    );
  });

  it("gives 409 its own plain message", () => {
    expect(describeSyncFailure(409, "A sync is already running for this campaign")).toMatch(/already running/i);
  });

  it("gives 400 a message that points at the folder setting", () => {
    expect(describeSyncFailure(400, "No vault folder configured for this campaign")).toBe(
      "No vault folder configured for this campaign",
    );
  });

  it("falls back to the server's message, then a generic one", () => {
    expect(describeSyncFailure(500, "kaboom")).toBe("kaboom");
    expect(describeSyncFailure(500, undefined)).toBe("Sync failed");
  });
});
