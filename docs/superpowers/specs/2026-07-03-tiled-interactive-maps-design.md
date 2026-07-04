# Tiled Interactive Maps — Design

## Context

This is sub-project 5 of the campaign hub expansion, and a direct follow-on to sub-project 4 (see [2026-07-02-interactive-map-design.md](2026-07-02-interactive-map-design.md)), which shipped a static-image pan/zoom map viewer. That design was explicitly inspired by a fan-made Wildemount map (redgiantmaps.com) but chose static images for simplicity. Having used the feature, the DM wants a second viewer mode that actually achieves that Wildemount-style "explorable navigation app" feel for large-scale maps (e.g. a full continent), while keeping the existing static viewer for smaller-scale maps (city layouts, dungeons) where it already works well.

Note on scope: this does not involve reusing any assets from redgiantmaps.com itself — that site's map tiles are a third party's hosted, almost certainly copyrighted derivative work. This design builds the same *capability* (smooth deep-zoom tile-based panning, progressive marker reveal) to be pointed at whatever source image the DM has the rights to use.

## Goals

- Support a second map render mode, "tiled," for large source images that can't be handled as a single `<img>` element without severe memory/performance problems.
- Achieve a Google-Maps-like pan/zoom feel: only the visible tiles at the current zoom level are loaded, and markers can progressively reveal themselves as the DM zooms in.
- Reuse the existing marker data model and UI (types, dialog, reverse-relationship lookups) unchanged — this is a new rendering layer, not a new data model.
- Let both render modes coexist side by side in the same `/maps` list and sub-map nesting tree.

## Non-Goals

Carried over from the original map design, still true here:
- **Live token tracking.** Prep/reference tool, not a virtual tabletop.
- **Freehand drawing/annotation.** Markers are points, not drawn shapes, regions, roads, or borders — even though Leaflet supports these.
- **Marker clustering.** Not needed at current marker counts; a possible future addition.
- **Items as markers.** Same reasoning as the original design — items travel with characters.
- **In-app image replacement after upload.** No "swap the source image" affordance; delete and re-upload instead.
- **Automatic background-job tiling.** Tiling runs synchronously within the upload request (see below). If a future very large image causes the request to exceed a reverse-proxy timeout, that will be solved when it's actually hit — not designed around preemptively.
- **Cloud/S3 tile storage.** Tiles live on the same local Docker volume as everything else, consistent with the original design's storage decision.

## Architecture & Coexistence

Tiled maps are a second `renderMode` on the existing `maps` table, not a separate feature. The `/maps` list page shows static and tiled maps together. `/maps/[id]` renders whichever viewer component matches that map's `renderMode`. Sub-map nesting (`parentMapId`), the marker table, and the reverse "View on Map" links on Character/Location/Faction detail pages are all render-mode-agnostic — a submap marker can point from a tiled map to a static map or vice versa with no special-casing, since navigation between maps is just by ID.

## Data Model

Extends the existing `maps` and `map_markers` tables (see original design for the tables' pre-existing columns):

```
maps (additions)
  renderMode    text not null default 'static'   -- 'static' | 'tiled'
  width         integer         -- pixel width of the original source image (tiled only)
  height        integer         -- pixel height of the original source image (tiled only)
  maxZoom       integer         -- deepest zoom level present in the generated tile pyramid (tiled only)

map_markers (additions)
  minZoom       integer, nullable   -- zoom level a marker starts appearing at; null/0 = always visible
```

Existing rows default to `renderMode = 'static'`; `width`/`height`/`maxZoom` and `minZoom` are meaningless for static maps and simply left unset/ignored by that viewer — no backfill logic needed.

## Tile Storage

Follows the existing convention in `lib/maps/storage.ts` — the same `/data/maps/` directory the SQLite DB and static images already live on.

```
/data/maps/<mapId>/original.<ext>       -- the untouched uploaded source image
/data/maps/<mapId>/tiles/<z>/<x>/<y>.jpg -- the generated XYZ tile pyramid
```

The original is kept (not discarded after tiling) in case the pyramid ever needs regenerating at a different tile size later. Tiles are served through a new dynamic route, `GET /api/maps/[id]/tiles/[z]/[x]/[y]`, mirroring the existing single-image serving route — they can't be plain Next.js static files since they live on the per-instance data volume, not baked into the built image.

## Upload & Tiling Pipeline

New dependency: **`sharp`**, which has a built-in tile-pyramid generator (Deep Zoom / Zoomify / Google-style XYZ layouts), no external binaries required. It ships prebuilt musl-compatible binaries that install cleanly in the project's existing Alpine-based Docker image, which already has the toolchain (`python3 make g++`) to compile from source as a fallback if a prebuilt binary isn't available for the target platform.

1. The DM picks a render mode explicitly in the upload dialog — "Standard" (today's flow, unchanged) or "Large-scale interactive" (new). This is an upfront choice, not auto-detected from file size or dimensions.
2. For a tiled upload, `POST /api/maps` saves the original file, reads its pixel dimensions via `sharp(buffer).metadata()`, and generates the full tile pyramid via `sharp(buffer).tile({ layout: 'google', size: 256 }).toFile(...)`, writing to `/data/maps/<mapId>/tiles/`.
3. This happens synchronously within the request — the upload dialog shows a spinner and blocks until tiling completes, then redirects to the new map. No background job, no status polling, no processing-state field on the `maps` row.
4. Accepted formats for tiled uploads: JPEG, PNG, WebP (no GIF — a multi-frame GIF doesn't mean anything as a base map layer).
5. Generated tiles are always written as JPEG (quality ~85) regardless of source format, since a base map layer doesn't need transparency and this keeps the pyramid's on-disk footprint reasonable. The preserved original stays in its native uploaded format.

## Viewer & Marker Behavior

New dependency: **`leaflet`**, plus a React integration layer (`react-leaflet` if it proves compatible with React 19 / Next 16, otherwise a thin hand-rolled wrapper — a decision for the implementation plan, not this design).

**Coordinate system:** `L.CRS.Simple` treats the map as a flat XY plane instead of a geographic projection — Leaflet's purpose-built mode for non-geographic "game map" content. Markers keep the existing fractional 0–1 `x`/`y` convention already in the schema; at render time, `x`/`y` are multiplied by the map's stored `width`/`height` to produce Leaflet's native pixel coordinates. Placement and drag math carry over from the existing static viewer largely unchanged — same coordinate convention, different rendering underneath.

**Marker types, dialog, and reverse relationships:** fully reused, unchanged. The same five types (Location / Faction / Character / Sub-map / Note), the same `MarkerFormDialog`, the same "View on Map" reverse lookups on entity detail pages. No new marker types.

**Progressive reveal (new capability):** `MarkerFormDialog` gains a "Visible from zoom level" control when placing a marker on a tiled map, pre-filled with whatever zoom level the viewer was at when the DM clicked to place it (since that naturally captures "how far in you had to zoom to find this"), plus an "Always visible" toggle that clears `minZoom` back to null. This is the detail that makes the tiled viewer feel like a real navigation app rather than just a bigger version of the static one. It has no equivalent on the static viewer, which has no concept of discrete zoom levels.

## Open Questions for the Implementation Plan

- `react-leaflet` vs. a hand-rolled Leaflet wrapper — depends on how well the current `react-leaflet` major version supports React 19 / Next 16 at implementation time.
- Exact zoom-level UI affordance for setting a marker's `minZoom` in the dialog (numeric stepper vs. a labeled slider) — a visual-polish detail, not a design decision.
- Whether `sharp` needs any explicit Dockerfile changes to install cleanly, or whether the existing Alpine build stage handles it with no changes — to be confirmed during implementation, not assumed here.
