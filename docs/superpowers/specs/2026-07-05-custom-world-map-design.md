# Custom Vector World Map — Design

## Context

This is sub-project 7 of the campaign hub expansion, and the mature successor to sub-projects 4–6, which built (in order) a static-image map viewer, a tiled Leaflet viewer for large images, and a MapLibre "World Map" mode that overlaid hand-drawn regions/roads/labels on a raster tile pyramid. Having used sub-project 6, the DM wants the genuine "redgiants" experience — a real, deep-zoom, navigation-app-quality vector map of Exandria — rather than an illustrated image with a crude hand-drawn overlay.

Investigation of the open-source project behind [redgiantmaps.com](https://redgiantmaps.com/) — [RossThorn/open-source-exandria](https://github.com/RossThorn/open-source-exandria) — confirmed it is **true vector cartography**: GeoJSON landmasses, bathymetry, inland water, roads, landcover, and cities, authored in QGIS, rendered with Mapbox GL JS. The painted map images in that project are used only as tracing references and are never rendered. This design adopts that same vector approach, but with **MapLibre GL JS** (the open-source fork of Mapbox GL JS) so everything stays self-hosted with no Mapbox account, telemetry, or per-load billing — consistent with the app's home-server deployment and no-recurring-cost constraints.

The campaign primarily takes place in **Wildemount**, with **Tal'Dorei** included for possible sea-crossings. Everything else in Exandria is out of scope.

## Goals

- A dedicated, pre-built vector world map of Exandria (Wildemount + Tal'Dorei), deep-zoomable and crisp at all scales like a real navigation app.
- Reuse the open-source-exandria GeoJSON as the base cartography — no from-scratch tracing.
- Keep the existing entity/marker system fully intact on the world map: place Character/Location/Faction/Sub-map/Note pins, click to open, link to detail pages, "View on Map" reverse links, and drag to reposition.
- Fully self-hosted: MapLibre + a single static PMTiles file + self-hosted glyphs and sprite. No Mapbox SaaS, no external CDN.
- Retire the superseded sub-project-6 World-Map mode (promote-a-tiled-map + Terra Draw drawing).

## Non-Goals

- **Continents beyond Wildemount + Tal'Dorei.** The rest of Exandria's open data is sparse (city points + bathymetry only), so it's excluded.
- **Detailed city-interior maps.** Wildemount ward/block data exists in the open project but is deferred.
- **In-app editing of the base cartography.** The base map is fixed, imported from the open data — no Terra Draw or drawing tools on the world map.
- **Linking canonical open-data city labels to Location entities.** A clean follow-up; v1 keeps base-map labels and the user's own entity pins as two separate layers.
- **A live/dynamic vector tile server; real-time multi-user; Mapbox-the-service.**

## Renderer & Data-Source Decisions

- **Renderer: MapLibre GL JS** (already a project dependency), the open-source fork of Mapbox GL JS. Same vector capabilities as redgiants' Mapbox, but self-hostable with no account/token/billing/telemetry. Explicitly **not** Mapbox SaaS.
- **Base data: RossThorn/open-source-exandria GeoJSON**, Wildemount + Tal'Dorei layers only (land, bathymetry, inland water, roads, landcover, cities). Reused under the repo's explicit "copy it and make your own maps" invitation. The underlying Exandria geography is Critical Role / WotC intellectual property, used here for a **private, self-hosted, non-commercial home-game tool**, consistent with both parties' fan-content policies. The app will include a "map data thanks to redgiants / open-source-exandria" credit. (This is not legal advice and is scoped to private personal use — a different analysis would apply to any public, distributed, or commercial use.)

## Architecture

Three parts: a build-time data-prep pipeline that produces static artifacts; those artifacts (PMTiles + glyphs + sprite + style) served statically by the app; and a new `/world` viewer that renders them with the existing marker overlay on top.

### 1. Build-time data-prep pipeline (run rarely; not a runtime dependency)

- Vendor the Wildemount + Tal'Dorei GeoJSON layers from open-source-exandria (land, bathymetry, inland water, roads, landcover, cities).
- Normalize coordinates to WGS84 lng/lat (the space MapLibre and `tippecanoe` expect) via `ogr2ogr`/QGIS if the source CRS differs — to be confirmed against the actual files during implementation.
- Run **`tippecanoe`** to bake all layers into a single **`exandria.pmtiles`** archive, with per-layer zoom ranges and zoom-based simplification / feature-dropping so low zooms stay light and high zooms stay crisp.
- Wrapped in a documented script (e.g. `scripts/build-world-tiles.sh`). `tippecanoe` is a build/prep tool only — it is **not** added to the production Docker image or the app's runtime dependencies. The generated artifact is what ships.

### 2. Static artifacts served by the app (all self-hosted)

- **`exandria.pmtiles`** — served as a static asset with HTTP range-request support. MapLibre's PMTiles protocol reader issues byte-range requests directly against the file; there is no tile-server process. The implementation picks the exact serving mechanism (a bundled `public/` asset vs a range-capable route reading from the `/data` volume) based on file size and Docker image-size tradeoffs.
- **Glyphs** — an open font (e.g. a Noto / serif pairing) converted to MapLibre's PBF glyph format, served from a static glyphs endpoint. Required for label text rendering.
- **Sprite** — a small sprite sheet (icons for city types / POIs as needed), served statically.
- **`style.json`** — the custom MapLibre GL style (below), referencing the pmtiles source, the glyphs, and the sprite.

### 3. The MapLibre style (the "look")

- A hand-authored MapLibre GL style defining, bottom to top: background (sea + parchment), water fill with bathymetry-based depth shading, land fill, coastline stroke, landcover fills (forest / mountain / etc.), rivers and inland water, roads by class, and label layers (cities, regions) with zoom-dependent text sizing, halos, and collision-based decluttering (`text-allow-overlap: false`).
- The redgiants aesthetic lives here and is **iterative**: implementation starts from a redgiants-like palette and refines the style live in the browser preview. Treated as a first-class, tunable deliverable, not an afterthought.

### 4. The `/world` viewer + marker overlay

- New top-level **"World"** nav item → `/world` route.
- A `WorldMapCanvas` React component: a MapLibre map initialized with the pmtiles vector source + the custom style. Both continents render on one map in their correct relative positions (the open data's coordinates place them across the sea as in canonical Exandria); an optional quick-jump control flies to Wildemount / Tal'Dorei.
- **Marker overlay (reused):** the existing entity/marker system — `MapMarkerPin`, `MarkerFormDialog`, entity linking, "View on Map" reverse links, and drag-to-reposition — layered on top. World-map markers store real lng/lat coordinates, and MapLibre's built-in `project`/`unproject` handle screen↔coordinate conversion (notably simpler than the raster viewer's hand-rolled Mercator adapter).

### Data model

- The world map is represented as a dedicated `maps` record with a new render mode `'world'` (distinct from `'static'` / `'tiled'`). It has no uploaded image; it points at the shared static world artifacts.
- The `'world'` map record is **per-campaign** (created lazily the first time a campaign opens `/world`), so each campaign's markers stay scoped to that campaign — while the cartography artifacts themselves (`exandria.pmtiles`, glyphs, sprite, `style.json`) are **shared across all campaigns**, since the geography is the same Exandria for everyone.
- Its markers reuse the existing `map_markers` table and the entity-linking model unchanged. For a `'world'` map, the marker's `x`/`y` real columns are interpreted as lng/lat rather than 0–1 image fractions; the viewer and marker dialog branch on the world context for coordinate conversion. No heavy schema change; one marker system.
- Loading/error handling reuses the overlay pattern already built for the vector canvas (spinner while loading; a friendly error only for fatal pre-load failures; transient tile misses logged only).

### Retiring the superseded sub-project-6 mode

- **Remove:** the promote-a-tiled-map → World Map flow (`isWorldMap` promotion UI + API guard), the Terra Draw in-app drawing tool, the `map_features` table and its CRUD (drawn regions/roads/labels), and the raster-Mercator `vtiles` tile route + `mercator-adapter`. All are superseded by the real cartography.
- **Keep:** the static and tiled *uploaded* map viewers (`StaticMapCanvas`, `TiledMapCanvas`) for dungeons, city battlemaps, and one-off location maps.
- Removal is scoped carefully to avoid touching the uploaded-map path or the shared marker system.

## Error Handling & Verification

- pmtiles / style / glyph load failures surface via the existing loading/error overlay pattern (fatal pre-load errors show a friendly message; transient tile misses are logged only).
- No automated test framework exists in this codebase (established convention). Verification is `npm run build` (type-check) plus a manual browser smoke test: tiles render; deep zoom stays crisp; both continents show in correct relative position; markers place, link, drag, and open entity detail pages correctly; and the retired mode's routes/UI are gone without breaking uploaded maps.

## Open Questions for the Implementation Plan

- The exact CRS of the source GeoJSON and the precise reprojection needed (inspect the actual files).
- The precise static-serving mechanism for the range-requested `.pmtiles` (bundled `public/` asset vs a range-capable route over the `/data` volume) — pick based on file size and Docker image-size tradeoffs.
- Font/glyph choice and sprite contents (a visual-design detail, tuned during style iteration).
- Whether both continents warrant a continent-switcher control or a single free-pan map suffices — a UX-polish call during implementation.
