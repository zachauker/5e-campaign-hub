# Interactive Map — Design

## Context

This is sub-project 4 of the campaign hub expansion (see sub-projects 1–3: hub shell + entity model, glossary detail pages, Notion/D&D Beyond feed — all shipped). The original brainstorm referenced an existing Wildemount-style interactive map (redgiantmaps.com) as inspiration: a pannable, zoomable fantasy map a DM can click around to explore, cross-referenced with the campaign's existing Characters/Locations/Factions.

## Goals

- Give a campaign one or more map images (e.g. a continent map, and a more detailed city map) that the DM can pan and zoom through, similar in feel to Google Maps.
- Let maps nest: a marker on a continent map can open a more detailed sub-map (a city, a dungeon), forming a parent/child tree.
- Let the DM drop markers on a map that either link to an existing Character/Location/Faction (opening that entity's detail page), link to a sub-map (drilling down), or stand alone as a free-text note.
- Surface the connection in both directions: entity detail pages show where they appear on the map(s), mirroring the reverse-relationship pattern already built for the glossary.

## Non-Goals

- **Live token tracking.** This is a prep/reference tool, not a virtual tabletop — no dragging character tokens in real time during combat. The existing initiative tracker already owns live combat state.
- **Freehand drawing/annotation.** Markers are points with a title and note, not drawn shapes, regions, or fog-of-war.
- **Items as markers.** Items travel with characters rather than occupying a fixed map location, so they aren't a linkable marker type.
- **In-app map generation.** Map images are uploaded, not procedurally generated — DMs bring their own art (e.g. from Wonderdraft, Inkarnate, or purchased maps).
- **Image resizing/optimization.** Uploaded images are served as-is; the DM is trusted to bring a reasonably-sized source file.
- **Cloud/S3 image storage.** Map images are stored on the same local Docker volume as the SQLite database. Evaluated Backblaze B2 and rejected it for this use case: the app and its data volume are co-located on the same home-server box, so local disk reads are faster (no network hop) — B2's benefit (off-box storage/backup) doesn't outweigh the added dependency and latency here.
- **Multi-campaign map reuse.** Maps belong to exactly one campaign, consistent with every other entity in the hub.

## Navigation & Pages

- **`/maps`** — a new top-level section (peer of Characters/Locations/Items/Factions/Encounters in the TopBar). Grid of top-level maps for the active campaign (thumbnail + name), plus an "Upload Map" action. Sub-maps are not listed here — they're only reached by navigating into their parent marker.
- **`/maps/[id]`** — the interactive viewer. Pan/zoom canvas fills the page below the TopBar. Shows a breadcrumb when the map has a parent (e.g. `Faerûn > Wildemount > Emon`), an "Add Marker" mode toggle, and the marker overlay.
- Clicking a `submap`-type marker navigates to `/maps/[targetMapId]`.
- Clicking an entity-type marker opens a popup card (name, type, short preview) with a link to that entity's existing detail page (`/characters/[id]`, `/locations/[id]`, `/factions/[id]`) — it does not navigate away automatically, so the DM stays oriented on the map while cross-referencing.
- Clicking a `note`-type marker opens a popup showing its title and text, no link.

## Placing & Editing Markers

"Add Marker" mode puts the viewer into a placement state: clicking anywhere on the map opens a dialog (reusing the existing `Dialog` primitive) to configure the new marker.

1. Pick a type: Location / Faction / Character / Sub-map / Note.
2. Depending on type:
   - **Location / Faction / Character** — a searchable select over that campaign's existing entities (same data the glossary list pages already fetch). Markers only link to entities that already exist; this dialog doesn't create new ones.
   - **Sub-map** — pick an existing map not already nested under another map, or upload a new image inline (same upload flow as the `/maps` page), which sets that new map's `parentMapId` to the current map.
   - **Note** — a title and free-text field, no entity link.
3. Saving drops a pin at the clicked coordinate.

Existing markers, when clicked, open the same popup described above, plus an edit affordance (small icon opening the placement dialog pre-filled with the marker's current type/target/title/note) and a delete action. Markers can also be dragged to reposition — the one interaction on this page that isn't a simple click, and the pan/zoom transform needs to let a marker drag take precedence over a canvas pan while a drag is in progress.

## Marker Visual Style

Teardrop pins, color-coded by type: Location = amber, Faction = violet, Character = emerald, Sub-map = blue, Note = neutral grey. Selected/hovered markers get a gold glow (consistent with the existing "gold = active" convention from the combat tracker), independent of the type color underneath. No default map-library chrome (zoom buttons, attribution badges) — pan/zoom controls and the breadcrumb are custom-built to match the dark, atmospheric shell already established across the app.

## Reverse Relationships (Entity → Map)

Character/Location/Faction detail pages gain a "View on Map" section, styled like the existing `RelatedCard` list from the glossary work, listing every map marker that links to this entity (an entity can appear on more than one map). Clicking a card jumps to `/maps/[mapId]` with that marker focused/centered. If an entity has no markers anywhere, the section doesn't render — same empty-state pattern already used for the Notion Notes tab.

`GET /api/characters/[id]`, `/api/locations/[id]`, `/api/factions/[id]` each gain a `mapMarkers: { mapId, mapName, markerId }[]` field via a lookup against `map_markers`, mirroring the reverse-relationship query pattern already built for `linkedCharacters` in sub-project 2.

## Data Model

Two new tables:

```
maps
  id            text primary key
  campaignId    text not null, references campaigns.id, cascade delete
  name          text not null
  imagePath     text not null        -- relative path under the maps storage dir
  parentMapId   text, references maps.id, nullable, self-referential
  createdAt     timestamp not null
  updatedAt     timestamp not null

map_markers
  id            text primary key
  mapId         text not null, references maps.id, cascade delete
  x             real not null        -- 0–1, fraction of image width
  y             real not null        -- 0–1, fraction of image height
  type          text not null        -- 'location' | 'faction' | 'character' | 'submap' | 'note'
  entityId      text, nullable       -- set when type is location/faction/character
  targetMapId   text, references maps.id, nullable  -- set when type is submap
  title         text                 -- required for 'note'; optional override for other types
  note          text                 -- free text, used directly for 'note' type
  createdAt     timestamp not null
  updatedAt     timestamp not null
```

`parentMapId` records which map this one is nested under, for breadcrumb rendering — independent of which specific marker(s) point to it, since a map could in principle be reachable from more than one marker but has a single "home" parent.

## Image Storage & Upload

Map images are written to the same Docker volume the SQLite database already lives on (`./data` → `/data`), under `/data/maps/<map-id>.<ext>`. `POST /api/maps` accepts a multipart form (name, image file, optional `parentMapId`), writes the file, and creates the `maps` row in one request. Images are served back via `GET /api/maps/[id]/image`, streamed from disk — no resizing, transcoding, or external storage dependency.

## Open Questions for the Implementation Plan

- Exact pan/zoom control affordances (on-canvas zoom +/- buttons vs. scroll/pinch-only with a "reset view" button) — an implementation detail, not a design decision.
- Icon choice per marker type (person/building/flag/layers/note glyphs) inside each pin — a visual-polish detail to settle during implementation, consistent with the approved color coding.
