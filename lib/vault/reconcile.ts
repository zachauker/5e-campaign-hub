import type { MappedEntity } from "./map";

export interface EntityRow {
  id: string;
  name: string;
  sourceKey: string | null;
  archived: boolean;
}

export interface EntityRepo {
  findByKey(key: string): EntityRow | undefined;
  findByNameUnlinked(name: string): EntityRow | undefined;
  insert(m: MappedEntity): string;             // returns new id
  update(id: string, m: MappedEntity): boolean; // returns whether a synced field changed; rewrites source_key to m.sourceKey
}

export type ReconcileAction = "created" | "adopted" | "updated" | "unchanged";

export interface ReconcileResult {
  action: ReconcileAction;
  id: string;
}

/**
 * Which note (by path) has written each row through a given repo. A repo is
 * built once per sync run, so this is the "already written this run" record
 * that lets two notes resolving to the same key be settled by path instead of
 * by arrival order. Keyed on the repo so it dies with the run's repo: callers
 * must build a fresh repo per sync run, or a note moved to a higher path would
 * be mistaken for a collision with its own earlier write.
 */
const claimsByRepo = new WeakMap<EntityRepo, Map<string, string>>();

function claimsFor(repo: EntityRepo): Map<string, string> {
  let claims = claimsByRepo.get(repo);
  if (!claims) {
    claims = new Map();
    claimsByRepo.set(repo, claims);
  }
  return claims;
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
 * depend on which note was processed first. A promotion never takes a row that
 * another note has already written this run.
 */
export function reconcileEntity(repo: EntityRepo, m: MappedEntity, candidates: string[]): ReconcileResult {
  const claims = claimsFor(repo);
  const claimedByOther = (id: string) => {
    const holder = claims.get(id);
    return holder !== undefined && holder !== m.sourcePath;
  };

  const linked = repo.findByKey(m.sourceKey);
  if (linked) {
    // Same-key collision: a lower path already wrote this row, so it keeps it.
    if (claimedByOther(linked.id) && claims.get(linked.id)! < m.sourcePath) {
      return { action: "unchanged", id: linked.id };
    }
    claims.set(linked.id, m.sourcePath);
    const changed = repo.update(linked.id, m);
    return { action: changed ? "updated" : "unchanged", id: linked.id };
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
