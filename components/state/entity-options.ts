/**
 * Shared entity pickers for the state surfaces. Both the clock owner selector
 * and the thread link editor need "every faction / location / … in this
 * campaign, as {id, name}", and both need it to fail visibly rather than look
 * like an empty campaign.
 */

/**
 * The entity kinds a DM can point at from the state UI.
 *
 * Deliberately narrower than `ThreadTargetKind`, which also has "session":
 * `listThreadsForTarget` supports session targets, but no session surface
 * renders threads, so offering it here would only mint dead links.
 */
export type StateEntityKind = "character" | "location" | "item" | "faction";

export const STATE_ENTITY_KINDS: StateEntityKind[] = ["character", "location", "item", "faction"];

export const ENTITY_KIND_LABELS: Record<StateEntityKind, string> = {
  character: "Character",
  location: "Location",
  item: "Item",
  faction: "Faction",
};

export interface EntityOption {
  id: string;
  name: string;
}

export type EntityOptions = Partial<Record<StateEntityKind, EntityOption[]>>;

export type EntityOptionsResult = { ok: true; options: EntityOptions } | { ok: false; error: string };

/**
 * Fetches the named entity lists for one campaign, all in parallel.
 *
 * Campaign-scoped on purpose: an unscoped `/api/factions` returns every
 * campaign's rows, so a missing campaignId returns an error rather than a
 * cross-campaign list.
 */
export async function fetchEntityOptions(
  campaignId: string,
  kinds: StateEntityKind[],
): Promise<EntityOptionsResult> {
  if (!campaignId) return { ok: false, error: "No active campaign." };

  try {
    const settled = await Promise.all(
      kinds.map(async (kind) => {
        const res = await fetch(`/api/${kind}s?campaignId=${encodeURIComponent(campaignId)}`);
        if (!res.ok) throw new Error(kind);
        const data = (await res.json()) as { items?: EntityOption[] };
        return [kind, (data.items ?? []).map((r) => ({ id: r.id, name: r.name }))] as const;
      }),
    );

    const options: EntityOptions = {};
    for (const [kind, list] of settled) options[kind] = list;
    return { ok: true, options };
  } catch {
    return { ok: false, error: "Could not load the campaign's entities." };
  }
}
