import type { ResolvedMarker } from "@/components/maps/map-types";

// Groups a marker for the show/hide control.
// Non-location markers key on their type; location markers on location:<subtype>.
export function layerKeyOf(marker: ResolvedMarker): string {
  if (marker.type === "location") return `location:${marker.entitySubtype ?? "other"}`;
  if (marker.type === "event") return `event:${marker.entitySubtype ?? "other"}`;
  return marker.type;
}

const LOCATION_SUBTYPE_ORDER = ["city", "town", "poi", "region", "other"] as const;
const LOCATION_SUBTYPE_LABELS: Record<string, string> = {
  city: "Cities",
  town: "Towns",
  poi: "POIs",
  region: "Regions",
  other: "Other",
};
const EVENT_TYPE_ORDER = ["Combat Encounter", "RP Encounter", "Exploration Encounter", "Character Event", "Story Outline", "Session Notes", "other"] as const;
const EVENT_TYPE_LABELS: Record<string, string> = {
  "Combat Encounter": "Combat",
  "RP Encounter": "RP",
  "Exploration Encounter": "Exploration",
  "Character Event": "Character",
  "Story Outline": "Story",
  "Session Notes": "Session",
  other: "Other",
};
const SIMPLE_GROUPS: { key: string; label: string }[] = [
  { key: "character", label: "Characters" },
  { key: "faction", label: "Factions" },
  { key: "submap", label: "Sub-maps" },
  { key: "note", label: "Notes" },
];

export interface LayerLeaf {
  key: string;
  label: string;
  count: number;
}
export interface LayerGroup {
  key: string;
  label: string;
  count: number;
  leaves: LayerLeaf[]; // empty for a single-toggle group
}

// Derive the layer groups present in a marker set, in display order, with counts.
// Only groups/leaves with at least one marker are returned.
export function deriveLayerGroups(markers: ResolvedMarker[]): LayerGroup[] {
  const counts = new Map<string, number>();
  for (const m of markers) {
    const k = layerKeyOf(m);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const groups: LayerGroup[] = [];

  const locLeaves: LayerLeaf[] = LOCATION_SUBTYPE_ORDER.map((st) => ({
    key: `location:${st}`,
    label: LOCATION_SUBTYPE_LABELS[st],
    count: counts.get(`location:${st}`) ?? 0,
  })).filter((l) => l.count > 0);
  if (locLeaves.length > 0) {
    groups.push({
      key: "location",
      label: "Locations",
      count: locLeaves.reduce((s, l) => s + l.count, 0),
      leaves: locLeaves,
    });
  }

  const eventLeaves: LayerLeaf[] = EVENT_TYPE_ORDER.map((et) => ({
    key: `event:${et}`,
    label: EVENT_TYPE_LABELS[et],
    count: counts.get(`event:${et}`) ?? 0,
  })).filter((l) => l.count > 0);
  if (eventLeaves.length > 0) {
    groups.push({
      key: "event",
      label: "Events",
      count: eventLeaves.reduce((s, l) => s + l.count, 0),
      leaves: eventLeaves,
    });
  }

  for (const g of SIMPLE_GROUPS) {
    const count = counts.get(g.key) ?? 0;
    if (count > 0) groups.push({ key: g.key, label: g.label, count, leaves: [] });
  }

  return groups;
}

// True when the marker should render given the hidden layer-key set.
export function isMarkerVisible(marker: ResolvedMarker, hidden: Set<string>): boolean {
  return !hidden.has(layerKeyOf(marker));
}

// Read the persisted hidden-layer set for a map from localStorage. Safe on the
// server (returns an empty set) and against malformed storage. Used to seed the
// hidden-layers state without a set-state-in-effect hydration step.
export function readHiddenLayers(mapId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(`markerLayers:${mapId}`);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // ignore malformed storage
  }
  return new Set();
}
