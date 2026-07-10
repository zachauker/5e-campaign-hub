import { describe, it, expect, beforeEach } from "vitest";
import { reconcileEntity, type EntityRepo, type EntityRow } from "./reconcile";
import type { MappedEntity } from "./map";

// Minimal in-memory repo mirroring the real drizzle repo contract.
function fakeRepo(): EntityRepo & { rows: EntityRow[] } {
  const rows: EntityRow[] = [];
  let n = 0;
  return {
    rows,
    findByPageId: (pid) => rows.find((r) => r.notionPageId === pid),
    findByNameUnlinked: (name) =>
      rows.find((r) => r.name.toLowerCase() === name.toLowerCase() && !r.notionPageId),
    insert: (m) => {
      const id = `id${++n}`;
      rows.push({ id, name: m.name, notionPageId: m.notionPageId, archived: m.archived });
      return id;
    },
    update: (id, m) => {
      const row = rows.find((r) => r.id === id)!;
      const changed = row.name !== m.name || row.archived !== m.archived || !row.notionPageId;
      row.name = m.name;
      row.notionPageId = m.notionPageId;
      row.archived = m.archived;
      return changed;
    },
  };
}

const mapped = (name: string, pid: string, archived = false): MappedEntity => ({
  notionPageId: pid, notionUrl: `u/${pid}`, name, archived, notionProps: [], extra: {},
});

describe("reconcileEntity", () => {
  let repo: ReturnType<typeof fakeRepo>;
  beforeEach(() => { repo = fakeRepo(); });

  it("creates a new entity", () => {
    expect(reconcileEntity(repo, mapped("Veldros", "p1")).action).toBe("created");
    expect(repo.rows).toHaveLength(1);
  });

  it("adopts an existing unlinked entity by name", () => {
    repo.rows.push({ id: "old", name: "Veldros", notionPageId: null, archived: false });
    const r = reconcileEntity(repo, mapped("Veldros", "p1"));
    expect(r.action).toBe("adopted");
    expect(repo.rows.find((x) => x.id === "old")!.notionPageId).toBe("p1");
    expect(repo.rows).toHaveLength(1); // no duplicate
  });

  it("updates a linked entity when a field changed", () => {
    reconcileEntity(repo, mapped("Veldros", "p1"));
    expect(reconcileEntity(repo, mapped("Veldros the Honest", "p1")).action).toBe("updated");
  });

  it("reports unchanged on an identical re-sync", () => {
    reconcileEntity(repo, mapped("Veldros", "p1"));
    expect(reconcileEntity(repo, mapped("Veldros", "p1")).action).toBe("unchanged");
  });
});
