import { describe, it, expect, beforeEach } from "vitest";
import { reconcileEntity, type EntityRepo, type EntityRow } from "./reconcile";
import type { MappedEntity } from "./map";

// In-memory repo mirroring the real drizzle repo contract, including the
// "update rewrites source_key" behaviour that key promotion depends on.
interface FakeRow extends EntityRow {
  sourcePath: string | null;
  sourceHash: string | null;
}

function fakeRepo(): EntityRepo & { rows: FakeRow[] } {
  const rows: FakeRow[] = [];
  let n = 0;
  return {
    rows,
    findByKey: (key) => rows.find((r) => r.sourceKey === key),
    findByNameUnlinked: (name) =>
      rows.find((r) => r.name.toLowerCase() === name.toLowerCase() && !r.sourceKey),
    insert: (m) => {
      const id = `id${++n}`;
      rows.push({
        id, name: m.name, sourceKey: m.sourceKey, archived: m.archived,
        sourcePath: m.sourcePath, sourceHash: m.sourceHash,
      });
      return id;
    },
    update: (id, m) => {
      const row = rows.find((r) => r.id === id)!;
      const changed =
        row.name !== m.name || row.archived !== m.archived || row.sourceKey !== m.sourceKey ||
        row.sourcePath !== m.sourcePath || row.sourceHash !== m.sourceHash;
      row.name = m.name;
      row.sourceKey = m.sourceKey;
      row.archived = m.archived;
      row.sourcePath = m.sourcePath;
      row.sourceHash = m.sourceHash;
      return changed;
    },
  };
}

const mapped = (
  name: string,
  key: string,
  over: Partial<MappedEntity> = {},
): MappedEntity => ({
  sourceKey: key, sourcePath: `Campaign/${name}.md`, name, archived: false,
  sourceProps: [], sourceHash: `hash-${name}`, sourceText: "", extra: {}, ...over,
});

describe("reconcileEntity", () => {
  let repo: ReturnType<typeof fakeRepo>;
  beforeEach(() => { repo = fakeRepo(); });

  it("creates a row for an unseen key", () => {
    const r = reconcileEntity(repo, mapped("Veldros", "k1"), ["k1"]);
    expect(r.action).toBe("created");
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({ id: r.id, name: "Veldros", sourceKey: "k1" });
  });

  it("updates a row whose key matches and whose fields changed", () => {
    // The same note (same path) renamed in place, so this is an edit, not a collision.
    const first = reconcileEntity(repo, mapped("Veldros", "k1", { sourcePath: "Campaign/Veldros.md" }), ["k1"]);
    const r = reconcileEntity(repo, mapped("Veldros the Honest", "k1", { sourcePath: "Campaign/Veldros.md" }), ["k1"]);
    expect(r).toEqual({ action: "updated", id: first.id });
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0].name).toBe("Veldros the Honest");
  });

  it("reports unchanged when nothing differs", () => {
    const first = reconcileEntity(repo, mapped("Veldros", "k1"), ["k1"]);
    expect(reconcileEntity(repo, mapped("Veldros", "k1"), ["k1"])).toEqual({ action: "unchanged", id: first.id });
  });

  it("adopts an unlinked row with the same name", () => {
    repo.rows.push({ id: "old", name: "Veldros", sourceKey: null, archived: false, sourcePath: null, sourceHash: null });
    const r = reconcileEntity(repo, mapped("veldros", "k1"), ["k1"]);
    expect(r).toEqual({ action: "adopted", id: "old" });
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0].sourceKey).toBe("k1");
  });

  it("does not adopt a same-named row that is already linked to another key", () => {
    repo.rows.push({ id: "other", name: "Veldros", sourceKey: "someone-else", archived: false, sourcePath: null, sourceHash: null });
    const r = reconcileEntity(repo, mapped("Veldros", "k1"), ["k1"]);
    expect(r.action).toBe("created");
    expect(repo.rows).toHaveLength(2);
  });

  it("promotes a key: adopts the row keyed on the old basename and rewrites it", () => {
    repo.rows.push({ id: "q", name: "Blackvein Quarry", sourceKey: "Blackvein Quarry", archived: false, sourcePath: null, sourceHash: null });
    const r = reconcileEntity(repo, mapped("Blackvein Quarry", "abc"), ["abc", "Blackvein Quarry"]);
    expect(r).toEqual({ action: "adopted", id: "q" });
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0].sourceKey).toBe("abc");
    // Next sync finds it directly by the promoted key.
    expect(reconcileEntity(repo, mapped("Blackvein Quarry", "abc"), ["abc", "Blackvein Quarry"]))
      .toEqual({ action: "unchanged", id: "q" });
  });

  it("promotes through a middle candidate (notion_id) when the hub_id and basename rows are absent", () => {
    repo.rows.push({ id: "n", name: "Shale", sourceKey: "notionid", archived: false, sourcePath: null, sourceHash: null });
    const r = reconcileEntity(repo, mapped("Shale", "hub1"), ["hub1", "notionid", "Shale"]);
    expect(r).toEqual({ action: "adopted", id: "n" });
    expect(repo.rows[0].sourceKey).toBe("hub1");
  });

  it("prefers an exact key match over a lower-tier candidate", () => {
    repo.rows.push({ id: "exact", name: "Quarry", sourceKey: "abc", archived: false, sourcePath: null, sourceHash: null });
    repo.rows.push({ id: "legacy", name: "Quarry", sourceKey: "Quarry", archived: false, sourcePath: null, sourceHash: null });
    const r = reconcileEntity(repo, mapped("Quarry", "abc"), ["abc", "Quarry"]);
    expect(r.id).toBe("exact");
    expect(r.action).not.toBe("adopted");
    expect(repo.rows.find((x) => x.id === "legacy")!.sourceKey).toBe("Quarry"); // untouched
  });

  it("tries candidates highest tier first", () => {
    repo.rows.push({ id: "low", name: "Quarry", sourceKey: "Quarry", archived: false, sourcePath: null, sourceHash: null });
    repo.rows.push({ id: "mid", name: "Quarry", sourceKey: "notionid", archived: false, sourcePath: null, sourceHash: null });
    const r = reconcileEntity(repo, mapped("Quarry", "hub1"), ["hub1", "notionid", "Quarry"]);
    expect(r).toEqual({ action: "adopted", id: "mid" });
    expect(repo.rows.find((x) => x.id === "low")!.sourceKey).toBe("Quarry");
  });

  it("falls back to name adoption of an unlinked row when no candidate key matches", () => {
    repo.rows.push({ id: "legacy", name: "Quarry", sourceKey: null, archived: false, sourcePath: null, sourceHash: null });
    const r = reconcileEntity(repo, mapped("Quarry", "abc"), ["abc", "Quarry"]);
    expect(r).toEqual({ action: "adopted", id: "legacy" });
  });

  describe("two notes resolving to the same key", () => {
    const a = mapped("Alpha", "K", { sourcePath: "a/Dup.md", sourceHash: "ha" });
    const b = mapped("Beta", "K", { sourcePath: "b/Dup.md", sourceHash: "hb" });

    const run = (order: MappedEntity[], seed?: FakeRow) => {
      const r = fakeRepo();
      if (seed) r.rows.push({ ...seed });
      for (const m of order) reconcileEntity(r, m, [m.sourceKey]);
      return r.rows;
    };

    it("leaves the same single surviving row whichever is processed first", () => {
      const ab = run([a, b]);
      const ba = run([b, a]);
      expect(ab).toHaveLength(1);
      expect(ba).toHaveLength(1);
      expect(ab).toEqual(ba);
      expect(ab[0]).toMatchObject({ name: "Alpha", sourcePath: "a/Dup.md" }); // lowest path wins
    });

    it("keeps the same surviving row id when a row already exists for that key", () => {
      const seed: FakeRow = { id: "existing", name: "Old", sourceKey: "K", archived: false, sourcePath: "z/Old.md", sourceHash: "h0" };
      const ab = run([a, b], seed);
      const ba = run([b, a], seed);
      expect(ab).toEqual(ba);
      expect(ab).toHaveLength(1);
      expect(ab[0]).toMatchObject({ id: "existing", name: "Alpha" });
    });

    it("flags the collision exactly once, whichever order the notes arrive in", () => {
      const results = (order: MappedEntity[]) => {
        const r = fakeRepo();
        return order.map((m) => reconcileEntity(r, m, [m.sourceKey]));
      };
      // Winner first: the loser is skipped and flagged.
      const [w1, l1] = results([a, b]);
      expect(w1.collision).toBeUndefined();
      expect(l1).toMatchObject({ action: "unchanged", collision: true });
      expect(l1.id).toBe(w1.id);
      // Loser first: the winner displaces it and is the one flagged.
      const [l2, w2] = results([b, a]);
      expect(l2.collision).toBeUndefined();
      expect(w2).toMatchObject({ action: "updated", collision: true });
      expect(w2.id).toBe(l2.id);
    });

    it("does not flag an ordinary re-sync of one note", () => {
      const r = fakeRepo();
      reconcileEntity(r, a, ["K"]);
      const again = reconcileEntity(r, a, ["K"]);
      expect(again).toEqual({ action: "unchanged", id: again.id });
      expect(again.collision).toBeUndefined();
    });

    it("lets a note that was renamed to a higher path update its own row on a later run", () => {
      // The claim scope is one repo instance (one sync run); a fresh repo is a fresh run.
      const next = fakeRepo();
      next.rows.push({ id: "r", name: "Alpha", sourceKey: "K", archived: false, sourcePath: "a/Dup.md", sourceHash: "ha" });
      const moved = mapped("Alpha", "K", { sourcePath: "z/Dup.md", sourceHash: "ha" });
      expect(reconcileEntity(next, moved, ["K"])).toEqual({ action: "updated", id: "r" });
      expect(next.rows[0].sourcePath).toBe("z/Dup.md");
    });

    it("does not let a promoter steal a row an exact-key note already claimed this run", () => {
      const r = fakeRepo();
      const basenameNote = mapped("Quarry", "Quarry", { sourcePath: "b/Quarry.md" });
      const hubNote = mapped("Quarry", "hub1", { sourcePath: "a/Quarry.md" });
      const first = reconcileEntity(r, basenameNote, ["Quarry"]);
      const second = reconcileEntity(r, hubNote, ["hub1", "Quarry"]);
      expect(second.action).toBe("created");
      expect(second.id).not.toBe(first.id);
      expect(r.rows.map((x) => x.sourceKey).sort()).toEqual(["Quarry", "hub1"]);
    });

    it("promoter first: a hub_id note adopts the legacy row, then the basename note gets its own row", () => {
      const r = fakeRepo();
      r.rows.push({ id: "legacy", name: "Quarry", sourceKey: "Quarry", archived: false, sourcePath: null, sourceHash: null });
      const hubNote = mapped("Quarry", "hub1", { sourcePath: "a/Quarry.md" });
      const basenameNote = mapped("Quarry", "Quarry", { sourcePath: "b/Quarry.md" });

      expect(reconcileEntity(r, hubNote, ["hub1", "Quarry"])).toEqual({ action: "adopted", id: "legacy" });
      const second = reconcileEntity(r, basenameNote, ["Quarry"]);
      expect(second.action).toBe("created");
      expect(second.id).not.toBe("legacy");
      expect(r.rows.find((x) => x.id === "legacy")!.sourceKey).toBe("hub1");
      expect(r.rows.map((x) => x.sourceKey).sort()).toEqual(["Quarry", "hub1"]);
    });

    it("two promoters competing for one legacy row: the second skips it and creates", () => {
      const r = fakeRepo();
      r.rows.push({ id: "legacy", name: "Quarry", sourceKey: "Quarry", archived: false, sourcePath: null, sourceHash: null });
      const p1 = mapped("Quarry", "hub1", { sourcePath: "a/Quarry.md" });
      const p2 = mapped("Quarry", "hub2", { sourcePath: "b/Quarry.md" });

      expect(reconcileEntity(r, p1, ["hub1", "Quarry"])).toEqual({ action: "adopted", id: "legacy" });
      const second = reconcileEntity(r, p2, ["hub2", "Quarry"]);
      expect(second.action).toBe("created");
      expect(second.id).not.toBe("legacy");
      expect(r.rows.find((x) => x.id === "legacy")!.sourceKey).toBe("hub1"); // not re-pointed to hub2
      expect(r.rows.map((x) => x.sourceKey).sort()).toEqual(["hub1", "hub2"]);
    });
  });
});
