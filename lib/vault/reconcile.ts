import type { MappedEntity } from "./map";

export interface EntityRow {
  id: string;
  name: string;
  sourceKey: string | null;
  archived: boolean;
}

/**
 * LIFETIME: a repo belongs to exactly one sync run. Build a fresh one per run
 * (inside the run function, never at module scope). It carries `claims`, the
 * record of which note wrote each row this run; `reconcileEntity` uses it to
 * settle two notes resolving to the same key by path. A repo reused across
 * runs would read a note whose path now sorts higher as colliding with its own
 * earlier write, and silently drop every edit to that note from then on.
 */
export interface EntityRepo {
  findByKey(key: string): EntityRow | undefined;
  findByNameUnlinked(name: string): EntityRow | undefined;
  insert(m: MappedEntity): string;             // returns new id
  update(id: string, m: MappedEntity): boolean; // returns whether a synced field changed; rewrites source_key to m.sourceKey
  /** Row id -> source path of the note that wrote it this run. Created on first use if absent. */
  claims?: Map<string, string>;
}

export type ReconcileAction = "created" | "adopted" | "updated" | "unchanged";

export interface ReconcileResult {
  action: ReconcileAction;
  id: string;
  /**
   * Set when this note and another resolved to the same `source_key` this run.
   * The lowest path owns the row (whichever order they arrive in), so the caller
   * should warn once that the loser's content is not being synced.
   */
  collision?: true;
}

/**
 * Decide whether a note creates, adopts, updates, or leaves alone a hub row.
 *
 * `candidates` is every key the note could have been stored under, highest tier
 * first (`candidateKeys`). Lookup order:
 *   1. the note's own key (`m.sourceKey`) — an exact match always wins;
 *   2. each other candidate — key promotion: a note keyed on its basename that
 *      later gains a `hub_id` adopts the old row and `update` rewrites its key,
 *      rather than reading as delete-plus-create (which would orphan every map
 *      pin, thread link and briefing that holds the row id);
 *   3. an unlinked row with the same name;
 *   4. otherwise a new row.
 *
 * Two notes resolving to the same key are settled by source path — the lowest
 * path wins and the other leaves the row alone — so the surviving row does not
 * depend on which note was processed first. The result is flagged `collision`. A promotion never takes a row that
 * another note has already written this run.
 */
export function reconcileEntity(repo: EntityRepo, m: MappedEntity, candidates: string[]): ReconcileResult {
  const claims = (repo.claims ??= new Map<string, string>());
  const claimedByOther = (id: string) => {
    const holder = claims.get(id);
    return holder !== undefined && holder !== m.sourcePath;
  };

  const linked = repo.findByKey(m.sourceKey);
  if (linked) {
    // Same-key collision: another note already wrote this row this run. The
    // lowest path owns it, whichever arrives first; either way it is reported.
    const collided = claimedByOther(linked.id);
    if (collided && claims.get(linked.id)! < m.sourcePath) {
      return { action: "unchanged", id: linked.id, collision: true };
    }
    claims.set(linked.id, m.sourcePath);
    const changed = repo.update(linked.id, m);
    return collided
      ? { action: changed ? "updated" : "unchanged", id: linked.id, collision: true }
      : { action: changed ? "updated" : "unchanged", id: linked.id };
  }

  for (const key of candidates) {
    if (key === m.sourceKey) continue;
    const promotable = repo.findByKey(key);
    if (!promotable || claimedByOther(promotable.id)) continue;
    claims.set(promotable.id, m.sourcePath);
    repo.update(promotable.id, m); // rewrites source_key to the note's resolved key
    return { action: "adopted", id: promotable.id };
  }

  const adoptable = repo.findByNameUnlinked(m.name);
  if (adoptable) {
    claims.set(adoptable.id, m.sourcePath);
    repo.update(adoptable.id, m); // stamps the key + syncs fields
    return { action: "adopted", id: adoptable.id };
  }

  const id = repo.insert(m);
  claims.set(id, m.sourcePath);
  return { action: "created", id };
}
