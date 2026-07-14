# Notion Session Notes — Sync, Pin to Maps, Browse

**Date:** 2026-07-14
**Status:** Design approved, ready for planning

## Problem

The campaign hub already syncs four Notion databases (characters, items, factions,
locations) and lets those entities be pinned to uploaded maps. The DM keeps a
fifth database — **Session Timeline** — where each row is a session, story
outline, or a single planned scene (Character Event, Combat Encounter, RP
Encounter). These have no presence in the hub.

The concrete need: when prepping an upcoming session, the DM writes several event
notes for interactions happening across a city, and wants to **pin them to an
uploaded city map** to see what is happening where in relation to one another —
and to read the full scene from the map during play.

## Source database

Notion database **Session Timeline** (data source `collection://43bf8b9b-3af4-4668-b2ec-6e767664dafd`),
under the Explorers of Exandria campaign. Schema:

| Property      | Type          | Notes |
|---------------|---------------|-------|
| `Name`        | title         | Note title |
| `Type`        | select        | Story Outline, Session Notes, Character Event, Combat Encounter, RP Encounter |
| `Status`      | select        | Not started, In progress, Completed |
| `Date`        | date          | Date-only in practice (e.g. `2026-07-19`); the session it belongs to |
| `Arc`         | select        | e.g. Dangerous Designs Pt 1/2 |
| `Setting(s)`  | multi-select  | Place names: Rexxentrum, Hupperdook, Druvenlode, Travel, On the Road, … |
| `Recording`   | file          | Zero or more recording files |

There is **no relation** tying an event note to its session page — the only link
is a shared `Date`. That drives the map filter design below.

## Scope decisions (from brainstorming)

- **All five Types** sync, are browsable, and are pinnable.
- **Map pins are filtered by Date**, defaulting to the next upcoming session.
- **Pin click opens a side panel** rendering the full Notion page body inline.
- **Three extras included:** `Setting(s)`→Locations linking, an unpinned-notes
  tray on the map, and a `/sessions` browse section.

Explicitly **out of scope:** editing session notes from the hub (Notion stays
source of truth), auto-placing pins from `Setting(s)` (a setting names a city,
not a spot on a map), and any change to the existing freeform `note` marker type.

---

## Part 1 — Data model & sync

### `session_notes` table

Same base columns every synced entity shares (`id`, `campaignId`, `name`,
`notionUrl`, `notionPageId`, `notionProps`, `archived`, `notionSyncedAt`,
`createdAt`, `updatedAt`), plus queryable columns:

- `noteType` — text, enum of the five Notion Types
- `status` — text (Notion Status)
- `date` — **text ISO string** (`"2026-07-19"`), not an integer timestamp
- `arc` — text, nullable

`Recording` and any other properties ride along in `notionProps` for display,
the way `Rarity` does for items.

**Why `date` is text, not a timestamp column:** Notion supplies a date-only
value. Storing it in an integer timestamp column makes it shift by a day
depending on timezone, which would show the wrong session's pins. Text sorts
lexicographically-correct for ISO dates and cannot drift.

### `session_note_locations` join table

`(sessionNoteId, locationId)` composite PK, `onDelete: cascade` on both sides —
mirrors `character_locations`. Populated during sync by name-matching each
`Setting(s)` value against hub Locations (additive, never removes), the same
pattern as `linkCharacterFactionsByName`. Unmatched settings (e.g. "Travel")
simply don't link and are surfaced as sync warnings.

### `notion_sources` gains a fifth entity type

`entityType` enum extends to include `sessionNotes`. It appears as a fifth field
in the Settings → Notion panel (`NotionSyncPanel` `SOURCES` array) and the
`/api/notion/sources` route `TYPES` array, and syncs on the same button with the
same summary. No new sync UI.

### Sync pipeline reuse

- **`mapSessionNoteRow(row)`** added to `lib/notion/map.ts`, returning a
  `MappedEntity` with `extra: { noteType, status, date, arc }` and a new
  `settingNames?: string[]` field (parallel to `affiliations`).
- **`sync.ts`**: add `sessionNotes` to `TABLES`, `MAPPERS`, and `ORDER`.
  `sessionNotes` must come **after `locations`** in `ORDER` so the location
  name-match can resolve. After reconcile, if `mapped.settingNames?.length`,
  call `linkSessionNoteLocationsByName(db, campaignId, result.id, settingNames)`.
- **`repos.ts`**: `makeEntityRepo` works as-is (shared base columns);
  `differs`/`baseValues` already fold `extra` in. Add the new linker function
  following `linkCharacterFactionsByName`.
- **`reconcile.ts` / `archiveUnseen`**: unchanged — a note removed from Notion
  gets archived, never deleted.

`SyncSummary` and `EntityType` widen to include `sessionNotes`.

---

## Part 2 — Pinning to maps

### New marker type `event`

`map_markers.type` enum extends to `location | faction | character | submap | note | event`.
An `event` marker carries `entityId` → a `session_notes` row, exactly like a
`character` marker. `type` is a plain TEXT column, so no migration is needed —
only the schema enum and the POST-route `validTypes` array.

The existing `note` marker type is untouched (freeform typed text).

### Per-Type pin visuals

Today `MARKER_TYPE_META` gives one icon+color per marker type. Locations already
vary by subtype via `entitySubtype`. Extend that:

- The markers API `resolveMarkerLabel` resolves an `event` marker's
  `entitySubtype` to its session note's `noteType`.
- A `markerVisual(marker)` resolver (new, in `marker-meta.ts`) returns an
  icon+color per Notion Type — e.g. crossed swords for Combat Encounter, speech
  bubble for RP Encounter, person for Character Event, scroll for Story
  Outline/Session Notes — **falling back to `MARKER_TYPE_META` for every
  existing type**, leaving other pins byte-for-byte unchanged.

This makes a city map readable at a glance (docks = fight, Archive = conversation)
without clicking.

### Layer control

Add an "Events" group to `deriveLayerGroups` with per-Type leaves (Combat / RP /
Character Event / Story Outline / Session Notes), mirroring how Locations group
into Cities/Towns/POIs. `layerKeyOf` returns `event:<noteType>` for event
markers. No structural change to the layer machinery.

### Date filter

A date selector above the layer control, listing the distinct dates among *this
map's* event pins:

- **Default:** earliest date that is `>= today` (the next upcoming session).
- "All dates" option and a "Past" toggle for full history.
- **Undated notes always show** — they can't be filtered by a field they lack,
  and hiding them is how one goes missing.

Implemented as a pure filter function over the resolved marker set (unit-tested,
especially the "earliest date ≥ today" fencepost).

### Unpinned-notes tray

A collapsible strip on the map listing session notes **for the selected date**
that are not pinned to *any* map yet. Clicking one drops the map into add-mode
with that note preselected; the DM clicks the spot. The tray empties as notes are
placed, making "everything for Thursday has a home" a visual fact.

Requires an endpoint returning, for a campaign + date, session notes with no
`event` marker on any map. (e.g. `/api/sessions/unpinned?campaignId=&date=`.)

### Pin click → `EventNotePanel`

A new wider side panel (leaving the compact `MarkerInfoPanel` for other marker
types) showing: name, Type, Date, Status, linked locations, and the **full Notion
page body** rendered inline via the existing `/api/notion/page` route and
`NotionBlocks` renderer (as the glossary uses). Body is fetched lazily on click.
Includes a link out to Notion.

---

## Part 3 — Browse section

### `/sessions` and `/sessions/[id]`

- **`/sessions`** — mirrors `/characters` and `/locations`: notes grouped by
  Type, sorted by Date descending, each card showing Status and Setting(s), with
  an archived-count affordance. Nav gains a "Sessions" entry.
- **`/sessions/[id]`** — properties table (`NotionPropsTable`), rendered Notion
  body (`NotionBlocks`), linked locations, and "pinned on: <map>" back-links to
  each map where the note has an `event` marker.
- Supporting API routes under `/api/sessions` following the `/api/locations`
  shape (list returns `{ items, archivedCount }`).

### "Events here" on location detail

Location detail pages gain an "Events here" list, populated from
`session_note_locations` — the payoff of the `Setting(s)` linking.

---

## Error handling

Follows existing conventions, nothing new invented:

- A Notion query failure records a per-source `error` in the sync summary and
  leaves the other four sources to sync normally.
- Unmatched `Setting(s)` values become sync warnings.
- A marker whose session note was deleted resolves to `"Entity not found"` like
  any other orphaned marker.
- The note panel surfaces the "hasn't been shared with the integration" message
  the `/api/notion/page` route already produces.

## Migrations

Additive, idempotent — following the `addColumnIfMissing` pattern in
`lib/db/migrate.ts` and the raw `CREATE TABLE IF NOT EXISTS` blocks:

- `CREATE TABLE IF NOT EXISTS session_notes (…)`
- `CREATE TABLE IF NOT EXISTS session_note_locations (…)`
- No ALTER needed for `map_markers.type` or `notion_sources.entity_type` (both
  plain TEXT; the enum is enforced in app code, not the DB).

## Testing

Extend the existing vitest suites:

- `mapSessionNoteRow` property extraction — including a row with **no Date** and
  one with an **unmatched Setting**.
- Sync for the new type: create / adopt / update / archive.
- `linkSessionNoteLocationsByName` — matches, case-insensitivity, no-match.
- Pure functions behind pin visuals, layer grouping, and the date filter —
  especially the "earliest date ≥ today" fencepost.
- API routes and UI verified by driving the running app (map pin placement,
  date filter, unpinned tray, note panel body render, `/sessions` browse).

## Files touched (anticipated)

**Schema / DB:** `lib/db/schema.ts`, `lib/db/migrate.ts`
**Sync:** `lib/notion/map.ts`, `lib/notion/sync.ts`, `lib/notion/repos.ts` (+ tests)
**Notion sources/settings:** `app/api/notion/sources/route.ts`,
`components/settings/NotionSyncPanel.tsx`
**Markers:** `app/api/maps/[id]/markers/route.ts`,
`app/api/maps/markers/[markerId]/route.ts`, `components/maps/marker-meta.ts`,
`components/maps/marker-layers.ts`, `components/maps/map-types.ts`,
`components/maps/MarkerFormDialog.tsx`, new `components/maps/EventNotePanel.tsx`,
map viewer components (date filter + tray wiring)
**Browse:** `app/sessions/page.tsx`, `app/sessions/[id]/page.tsx`,
`app/api/sessions/*`, location detail page ("Events here"), nav
