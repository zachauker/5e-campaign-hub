# Location Types & Marker Layer Toggles — Design

## Context

Sub-project 8 seeded ~198 canonical Exandria places as `locations` entities, each with an entity-linked pin on the `/world` map. Two gaps remain: (1) a location's category (city / town / point-of-interest / region) lives only inside its freetext `description`, so it can't be queried or filtered; and (2) with ~198 pins on one map — soon mixed with Character and Faction pins — the DM has no way to declutter by showing/hiding groups of markers.

This sub-project adds a real `type` field to `locations` and a marker **layer panel** (checkbox show/hide) on every map viewer, grouped by marker kind and, for locations, by the new type. The two are coupled: the location `type` is what lets the Locations layer sub-divide into City / Town / POI / Region.

## Goals

- A fixed, editable `type` category on `locations`: **`city · town · poi · region · other`** — populated by the seed script, editable in the location form, shown on the detail page, and queryable.
- A reusable marker layer control on **all** map viewers (`/world`, static, tiled) that toggles visibility of marker groups: Locations (expandable by type), Characters, Factions, Sub-maps, Notes — each with a live count, showing only groups present on that map.
- Layer visibility **persists per map** (localStorage), defaulting to everything visible.
- Reuse the existing marker overlay, resolution route, and entity form — no parallel systems.

## Non-Goals

- **No filtering of base-map labels.** The panel toggles only the DM's entity pins; canonical Exandria map labels always render (same layering decision as sub-projects 7–8).
- **No per-marker custom colors or icons.** Pin appearance is unchanged; this is visibility only.
- **No `type` field for factions/items/characters.** Only `locations` gets a category. (Character/Faction *markers* are still a layer group, keyed on the existing `map_markers.type`.)
- **No new "village" type.** Village/Settlement/Fortress/Outpost fold into `town` (kept coarse on purpose; the exact original label still lives in `description`).

## Part A — `locations.type`

### Schema & migration
- Add `type TEXT` to the `locations` table. Drizzle enum: `["city", "town", "poi", "region", "other"]`, `NOT NULL DEFAULT 'other'`.
- Migration: `addColumnIfMissing("locations", "type", "TEXT NOT NULL DEFAULT 'other'")` (the established idempotent pattern in `lib/db/migrate.ts`).

### Seed derivation & backfill
`scripts/world/seed-locations.js` computes a `type` per record from the source layer:
- **cities layer**, by raw `Type`: `Metropolis`/`City` → `city`; `Ruins` → `poi`; everything else (`Town`, `Village`, `Settlement`, `Fortress`, `Outpost`, `Garrison`, …) → `town`.
- **pois layer** → `poi`.
- **label_points (regions) layer** → `region`.

**Backfill:** the 198 rows already exist and the seed skips existing locations, so the script must also update `type` on an existing row when it is still the default/unset — specifically `UPDATE locations SET type = ? WHERE id = ? AND (type IS NULL OR type = 'other')`. This backfills the new field without overwriting a value the DM has deliberately changed. The location row's `name`/`description` are left untouched for existing rows (idempotency preserved). Re-running remains safe and now also reports how many types were backfilled.

### API & form
- `POST /api/locations` and `PATCH /api/locations/[id]` accept an optional `type`; POST defaults to `"other"`, PATCH leaves the existing value when omitted. Both validate it against the enum and reject unknown values.
- `GET /api/locations/[id]` (and the list) already return the full row, so `type` flows out automatically.
- The location edit form (`SimpleEntityFormDialog`, shared with factions/items) gains a **Type `<select>`** rendered **only when editing a location** (City / Town / Point of Interest / Region / Other). Factions/items are unaffected.
- The location detail page shows the type (e.g. a small badge) alongside the name.

## Part B — Marker layer panel

### Resolved-marker subtype
All viewers load pins through one route, `GET /api/maps/[id]/markers`, whose `resolveMarkerLabel` already returns `{ resolvedTitle, resolvedSubtitle }`. Extend it to also return **`entitySubtype: string | null`** — for a `location` marker, the linked location's `type`; `null` for every other marker kind or unlinked marker. Add `entitySubtype?: string | null` to the `ResolvedMarker` type in `components/maps/map-types.ts`. (`/world` loads markers from this same route, so both paths get the subtype from one change.)

### Layer model
A marker belongs to a **layer key**:
- non-location markers → their `map_markers.type`: `character`, `faction`, `submap`, `note`.
- location markers → `location:<entitySubtype>` (e.g. `location:city`, `location:region`; unlinked/legacy → `location:other`).

The panel derives the list of groups **present on the current map** from the loaded markers (so a battlemap with only Character pins shows only that group), each with a count. Group order is fixed: Locations (then its subtypes City / Town / POI / Region / Other), Characters, Factions, Sub-maps, Notes. The Locations parent checkbox toggles all its subtypes; subtype checkboxes toggle individually (tri-state parent when partially on).

### Component & wiring
- New **`components/maps/MarkerLayerControl.tsx`**: a popover/panel of checkboxes driven by props `{ markers, hidden, onToggle }`, presentation-only (no data fetching). Reused by both viewers.
- **State:** each viewer (`MapViewer` for static/tiled, `WorldMapViewer` for `/world`) holds a `hiddenLayers: Set<string>` and computes `visibleMarkers = markers.filter(m => !hiddenLayers.has(layerKeyOf(m)))`, passing `visibleMarkers` to the canvas. Because `StaticMapCanvas` / `TiledMapCanvas` / `WorldMapCanvas` all render exactly the markers they are given, upstream filtering works uniformly — no canvas changes needed beyond receiving fewer markers.
- **Persistence:** `hiddenLayers` is saved to `localStorage` under `markerLayers:<mapId>` (for `/world`, the campaign's world-map id). Default: empty set (all visible).
- A tiny shared helper `layerKeyOf(marker)` (in `map-types.ts` or a small `marker-layers.ts`) maps a resolved marker to its layer key, used by both the control and the filter so they never diverge.

## Error Handling & Verification

- Invalid `type` on the API → `400` with the allowed values; the enum default keeps existing/edge rows valid.
- No test framework (established convention). Verification:
  - **A:** run the migration; re-run the seed and confirm it backfills `type` on the 198 rows (SQL: counts per `type` ≈ city/town/poi/region split; 0 remain `other` among seeded rows); edit a location's type in the form and confirm it round-trips; detail page shows the badge.
  - **B:** on `/world`, toggling Locations → Regions hides only region pins; toggling Characters (after placing a character pin) hides it; counts match; reload preserves the hidden set; the same panel works on a static and a tiled uploaded map and only lists groups present there.

## Phasing

Two independently shippable plans:
- **Plan 9A — Location types:** schema + migration + seed derivation/backfill + API + form + detail badge.
- **Plan 9B — Marker layers:** resolved-marker subtype + `layerKeyOf` + `MarkerLayerControl` + filtering/persistence wired into both viewers. Depends on 9A for the location subtypes.

## Open Questions for the Implementation Plan

- Exact place to render the Type `<select>` within `SimpleEntityFormDialog` given it is shared across entity kinds (a location-only conditional vs. a small prop) — decide against the actual component.
- Whether `layerKeyOf` + the layer-group derivation live in `map-types.ts` or a dedicated `components/maps/marker-layers.ts` (leaning dedicated, since both the control and two viewers import it).
- Popover styling/placement of the control on each viewer's toolbar (a UI-polish detail).
