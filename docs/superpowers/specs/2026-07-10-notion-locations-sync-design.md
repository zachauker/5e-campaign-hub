# Notion Locations Sync — Design

**Date:** 2026-07-10
**Status:** Approved, ready for planning
**Sub-project:** Campaign hub expansion — Notion integration, phase 2 (Locations sync)
**Extends:** `docs/superpowers/specs/2026-07-10-notion-database-sync-design.md` (Characters/Items/Factions sync, shipped & deployed)

## Problem

Phase 1 synced Characters, Items, and Factions from Notion but **deliberately deferred
Locations**, because the hub already holds **198 locations seeded from world GeoJSON**
(each carrying a world-map marker with lng/lat + min-zoom tier, and a `type` that drives
map layering). Syncing the Notion **Locations** database naively risked duplicating those
198 rows or clobbering the map-driving `type`.

That risk turns out to be already handled by the phase-1 engine: **adopt-by-name** matches
a Notion "Druvenlode" to the seeded "Druvenlode" and enriches it in place (markers live in
a separate table keyed by `entityId`, untouched), and `archiveUnseen` ignores rows with no
`notionPageId` (the ~197 seeded locations never touched by Notion). So this phase is a thin,
additive extension: register `locations` as a 4th sync source.

## Notion Locations schema (data source `collection://496972df-7c5b-4e84-b561-f263a5f1ecdc`)

`Name` (title) · `Description` (text) · `Type` (select: City/District/Building/Dungeon/
Wilderness/Landmark/Underground) · `Status` (select: Explored/Partially Explored/Known But
Unvisited/Undiscovered) · `Region` (select: Western Wynandir/Menagerie Coast/…) ·
`Notable NPCs` (relation → Characters).

## Decisions locked during brainstorming

| Decision | Choice |
|---|---|
| `type` authority | **Keep hub type** (world-derived, drives map layering). Sync never writes it. Notion `Type`/`Status`/`Region` → `notionProps` meta-table. New Notion-only locations insert with the DB default `'other'`. |
| `description` authority | **Notion wins only if non-empty** — a blank Notion Description never wipes the world-composed text. |
| `Notable NPCs` relation | **Included** — additively populate `character_locations` (location → its NPCs). |
| Archival | **Add an `archived` column to `locations`** for parity, so removed Notion locations hide (engine needs no special-case). No `Active` property in Notion, so archival is removal-driven only. |
| Item→`Found In`, Faction→`Headquarters` | **Out of scope** (no item↔location / faction↔location join tables exist). |
| Character-side `Location` relation | **Not used** — char↔location comes solely from the location side (`Notable NPCs`), keeping one code path and leaving shipped character code untouched. |

## Property mapping — `mapLocationRow`

| Notion property | → Hub destination |
|---|---|
| Name (title) | `locations.name` |
| Description (text) | `locations.description` — placed in `extra` **only when non-empty** (so an empty Notion field is not synced and existing text is preserved) |
| Type, Status, Region | `locations.notionProps` (labels "Type", "Status", "Region") |
| Notable NPCs (relation→Characters) | `character_locations` links (resolve related char page ids → hub characters by `notionPageId`) |
| _(identity)_ | `notionPageId`, `notionUrl` |

`locations.type` is **never** in `extra` → never written by sync (world-authoritative).
`archived` is `false` from the mapper (no `Active` property); removal drives archival.

Returned `MappedEntity` uses the existing shape, with the location's NPC ids carried on a
new optional field `notableNpcPageIds?: string[]` (mirrors items' `heldByPageIds`).

## Reconcile behavior (reused from phase-1 engine, no changes to reconcile core)

- **Adopt-by-name enriches** a seeded location: stamps `notionPageId`, writes `notionProps`,
  updates `description` (if Notion non-empty). **`type`, map markers, lng/lat, min-zoom are
  untouched** (not in the update set).
- **New Notion location** (no name match) → created with `type='other'` (DB default), no
  marker (glossary-only until a marker is placed).
- **Idempotent:** a second identical sync writes nothing (existing `differs` logic; `type`
  is not compared because it's never in `extra`).
- **Archive-on-removal:** a previously-synced Notion location deleted in Notion →
  `archived=true` (never hard-deleted); its marker is preserved.

## Sync order + linking

New order: **factions → characters → locations → items**. Locations run *after* characters
so `Notable NPCs` targets already exist. New additive helper in `lib/notion/repos.ts`:

```
linkCharacterLocationsByPageId(db, locationId, characterPageIds[])
```

mirrors `linkCharacterItemsByPageId`: resolves each character by `notionPageId`, inserts
into `character_locations` with `onConflictDoNothing` (never removes). In `syncCampaign`,
the `locations` branch calls it with the mapped `notableNpcPageIds`.

## Surfaces to touch

- **Schema/migration:** add `archived` (boolean, default false) to `locations` via
  `addColumnIfMissing`; add `'locations'` to the `notion_sources.entityType` enum.
- **Engine:** `lib/notion/map.ts` (`mapLocationRow`), `lib/notion/repos.ts`
  (`linkCharacterLocationsByPageId`; add `locations` to the `SyncTable` union),
  `lib/notion/sync.ts` (`EntityType` += `locations`, `ORDER`, `TABLES`, `MAPPERS`,
  `SyncSummary`, the locations linking branch).
- **APIs:** `app/api/notion/sources/route.ts` `TYPES` += `locations`. The sync run route
  (`app/api/notion/sync/route.ts`) is generic and needs no change beyond the enum flowing
  through.
- **Locations detail API** (`app/api/locations/[id]/route.ts`): add parsed `notionProps`
  (it already returns `linkedCharacters`). `SimpleEntityDetail` then renders the meta-table
  for free (already wired in phase 1).
- **Locations list:** flip `SUPPORTS_ARCHIVED.locations` to `true` in
  `components/entities/SimpleEntityManager.tsx:28`, and add archived-filtering +
  `archivedCount` to `app/api/locations/route.ts` (mirroring the other three list APIs).
- **Settings panel:** add a 4th `{ type: "locations", label: "Locations" }` entry to
  `SOURCES` in `components/settings/NotionSyncPanel.tsx`.

## Testing

- **`mapLocationRow` unit tests:** Description-if-non-empty (present → in `extra`; blank →
  absent); Type/Status/Region → ordered `notionProps`; `Notable NPCs` → `notableNpcPageIds`
  dashless; `type` never in `extra`; archived always false.
- **`linkCharacterLocationsByPageId` repo test:** additive, resolves by `notionPageId`,
  no duplicates on re-run, skips unknown ids.
- **`syncCampaign` integration case:** pre-insert a world-style location (name "Druvenlode",
  `type='city'`, a description, and a marker row) with no `notionPageId`; sync a same-named
  Notion location with a Description + Type + one Notable NPC (character synced same run) →
  assert: no duplicate row, `notionPageId` stamped, `type` still `'city'`, marker row intact,
  description enriched, one `character_locations` link. Plus a new-location case (creates
  `type='other'`, no marker) and idempotency (second run = unchanged).

## Out of scope

Item→`Found In` and Faction→`Headquarters` links (need new join tables) · mapping Notion
`Type`/`Status` into hub columns · the character-side `Location` relation · any change to
the world-map seed script / importer (locations sync and the GeoJSON seed coexist;
adopt-by-name reconciles them regardless of run order).
