export type EntityResourcePath = "characters" | "locations" | "items" | "factions";

/** Max number of note properties exposed in the quick-view model before truncation. */
export const PROP_LIMIT = 4;

export interface RelatedItem {
  id: string;
  name: string;
  href: string;
  type?: string;
}

export interface RelatedGroup {
  label: string;
  items: RelatedItem[];
}

export interface EntityQuickViewModel {
  id: string;
  name: string;
  typeLabel: string | null;
  description: string | null;
  props: { label: string; value: string }[];
  related: RelatedGroup[];
  fullHref: string;
}

/** The union of fields the four `/api/{resourcePath}/{id}` GET endpoints return. */
export interface EntityDetailResponse {
  id: string;
  name: string;
  description?: string | null;
  type?: string | null;
  notionUrl?: string | null;
  sourceProps?: { label: string; value: string }[];
  // Simple entities (locations/items/factions):
  linkedCharacters?: { id: string; name: string; type: string }[];
  // Characters:
  relatedFactions?: { id: string; name: string }[];
  relatedLocations?: { id: string; name: string }[];
  relatedItems?: { id: string; name: string }[];
}

const LOCATION_TYPE_LABELS: Record<string, string> = {
  city: "City",
  town: "Town",
  poi: "Point of Interest",
  region: "Region",
  other: "Other",
};

function characterTypeLabel(type?: string | null): "PC" | "NPC" | null {
  if (type === "pc") return "PC";
  if (type === "npc") return "NPC";
  return null;
}

function resolveTypeLabel(resourcePath: EntityResourcePath, type?: string | null): string | null {
  if (!type) return null;
  if (resourcePath === "locations") return LOCATION_TYPE_LABELS[type] ?? type;
  if (resourcePath === "characters") {
    return characterTypeLabel(type);
  }
  // items and factions have no type subtype
  return null;
}

function toRelatedGroup(label: string, rows: { id: string; name: string }[], hrefBase: string): RelatedGroup[] {
  if (!rows || rows.length === 0) return [];
  return [{ label, items: rows.map((r) => ({ id: r.id, name: r.name, href: `${hrefBase}/${r.id}` })) }];
}

function buildRelated(resourcePath: EntityResourcePath, raw: EntityDetailResponse): RelatedGroup[] {
  if (resourcePath === "characters") {
    return [
      ...toRelatedGroup("Factions", raw.relatedFactions ?? [], "/factions"),
      ...toRelatedGroup("Locations", raw.relatedLocations ?? [], "/locations"),
      ...toRelatedGroup("Items", raw.relatedItems ?? [], "/items"),
    ];
  }
  const chars = raw.linkedCharacters ?? [];
  if (chars.length === 0) return [];
  return [
    {
      label: "Characters",
      items: chars.map((c) => ({
        id: c.id,
        name: c.name,
        href: `/characters/${c.id}`,
        type: characterTypeLabel(c.type) ?? undefined,
      })),
    },
  ];
}

export function buildEntityQuickView(
  resourcePath: EntityResourcePath,
  raw: EntityDetailResponse,
): EntityQuickViewModel {
  return {
    id: raw.id,
    name: raw.name,
    typeLabel: resolveTypeLabel(resourcePath, raw.type),
    description: raw.description ?? null,
    props: (raw.sourceProps ?? []).slice(0, PROP_LIMIT),
    related: buildRelated(resourcePath, raw),
    fullHref: `/${resourcePath}/${raw.id}`,
  };
}
