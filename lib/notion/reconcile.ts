import type { MappedEntity } from "./map";

export interface EntityRow {
  id: string;
  name: string;
  notionPageId: string | null;
  archived: boolean;
}

export interface EntityRepo {
  findByPageId(pageId: string): EntityRow | undefined;
  findByNameUnlinked(name: string): EntityRow | undefined;
  insert(m: MappedEntity): string;             // returns new id
  update(id: string, m: MappedEntity): boolean; // returns whether a synced field changed
}

export type ReconcileAction = "created" | "adopted" | "updated" | "unchanged";

export interface ReconcileResult {
  action: ReconcileAction;
  id: string;
  warning?: string;
}

export function reconcileEntity(repo: EntityRepo, m: MappedEntity): ReconcileResult {
  const linked = repo.findByPageId(m.notionPageId);
  if (linked) {
    const changed = repo.update(linked.id, m);
    return { action: changed ? "updated" : "unchanged", id: linked.id };
  }

  const adoptable = repo.findByNameUnlinked(m.name);
  if (adoptable) {
    repo.update(adoptable.id, m); // stamps the page id + syncs fields
    return { action: "adopted", id: adoptable.id };
  }

  return { action: "created", id: repo.insert(m) };
}
