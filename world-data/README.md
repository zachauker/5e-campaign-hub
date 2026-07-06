# Exandria World-Map Data Pipeline

Produces the static artifacts the in-app world map (Plan 2) serves:
`build/exandria.pmtiles`, `build/glyphs/`, and the generated per-theme styles
`build/styles/*.json` (from the committed base `style.json` + `themes.json`).

Everything under `src/` and `build/` is git-ignored and fully regenerable.
To rebuild from scratch:

    scripts/world/fetch-geojson.sh    # -> world-data/src/*.geojson
    scripts/world/build-tiles.sh      # -> world-data/build/exandria.pmtiles
    node scripts/world/build-glyphs.js  # -> world-data/build/glyphs/<fontstack>/<range>.pbf
    node scripts/world/build-themes.js  # -> world-data/build/styles/<theme>.json (+ themes.json)
    scripts/world/serve-preview.sh    # open the standalone preview to eyeball/tune

Requires: tippecanoe (felt fork, >= v2.0.0) and Node. The preview server
(`serve-preview.sh` -> `serve-preview.js`) is a small Node static server; it
must support HTTP Range requests, which the PMTiles reader requires — python's
`http.server` does NOT (it returns the whole file with a 200), so do not
substitute it.

Source data: RossThorn/open-source-exandria (GeoJSON already in EPSG:4326).
Scope: Wildemount + Tal'Dorei overworld only. City-interior layers
(wildemount_city_*) and other continents are intentionally excluded.

Map data thanks to redgiants / RossThorn's open-source-exandria.

## Property names

Recorded from actual `node` inspection of the fetched `world-data/src/*.geojson`
files (both Wildemount and Tal'Dorei checked where noted). These are the real
contracts the styling task must use — do not assume standard field names.

- **landcover** (`wildemount_landcover.geojson`, `taldorei_landcover.geojson`):
  properties are `id` (always `null` in the sample) and `type`. `type` is the
  usable category field.
  - Wildemount distinct `type` values: `forest`, `mountain`, `dead_forest`,
    `ashlands`, `penumbra`, `moorland`, `dirt`, `pallid`, `swamp`, `vermaloc`,
    `snow`
  - Tal'Dorei distinct `type` values: `mountain`, `grass`, `forest`, `snow`,
    `swamp`, `frosted_forest`, `grey valley`, `grey valley white area`
  - Note: category values are not identical between the two continents — the
    styling task must union both sets (and note the `grey valley` values
    contain spaces, not underscores).

- **roads** (`wildemount_roads.geojson`, `taldorei_roads.geojson`): the ONLY
  property present is `id`, and it is `null` on every feature checked in both
  files (43 features in Wildemount, all `MultiLineString` geometry). **There
  is no class/type field** — roads cannot be styled by category (e.g.
  highway vs. path) from properties alone. All roads must be styled
  identically, or the road-type distinction must come from a different
  source (e.g. splitting by file, since only one roads file exists per
  continent).

- **cities** (`wildemount_cities.geojson`): properties are `id` (null),
  `Name` (capital N — confirmed present, e.g. `"Tussoa"`, `"Port Damali"`,
  `"Vol'antim"`), `Type` (e.g. `"City"`, `"Settlement"`), `Population`
  (string, e.g. `"15,110"`), `Info` (freetext description), and
  `Organizations` (freetext, not present on every feature). Label property
  for map rendering is confirmed to be `Name`.

- **Coordinates**: sample from `wildemount_land.geojson` —
  `[[[[8.393082070171202,-4.276174672842822],[8.39720300807872,...` — small
  signed decimals, confirming lng/lat (EPSG:4326), no reprojection needed.

## Artifact sizes

- `build/exandria.pmtiles`: **14M** (13,963,980 bytes), built by
  `scripts/world/build-tiles.sh` (tippecanoe v2.79.0, `-Z0 -z12`). Contains
  all 8 source-layers (`land`, `bathymetry`, `inland_water`, `landcover`,
  `roads`, `cities`, `pois`, `labels`), each merging Wildemount + Tal'Dorei.
  Plan 2 should size its serving mechanism (static file vs. range-request
  server) around this figure.
- `build/styles/*.json`: four generated styles (~5 KB each) + a `themes.json`
  manifest. Generated, not committed.

## Themes

The map ships with four switchable art themes. Rather than maintain four full
duplicated styles, the base structure + Classic palette lives in the committed
`world-data/style.json`, and each theme's per-layer paint overrides live in the
committed `world-data/themes.json`. `scripts/world/build-themes.js` stamps out a
complete standalone style per theme into `build/styles/<id>.json` plus a lean
`build/styles/themes.json` manifest (`{id, label, default}`).

- **classic** (default) — Classic Atlas: warm parchment, muted blue sea.
- **vibrant** — Vibrant Painted: saturated sea, pronounced terrain/roads.
- **antique** — Antique Sepia: uniform aged parchment, whisper-faint terrain.
- **dark** — Dark / Night: dark navy sea, dark land, light labels.

The standalone preview reads the manifest, offers a `<select>` toggle, and
switches themes live via MapLibre `setStyle()` (camera preserved). Plan 2's
in-app theme switcher uses the same mechanism, defaulting to `classic`.

Verified in-browser (Plan 1): all four themes render correctly and the live
toggle works with no console errors, at both overview and deep (z12) zoom with
crisp vector labels.

## Seeding location entities (optional)

`scripts/world/seed-locations.js` turns the named point features (cities, POIs,
region labels) into `locations` rows for a campaign, each with an entity-linked
pin on that campaign's `/world` map. Run per campaign:

    node scripts/world/seed-locations.js <campaignId>

It is idempotent (keyed on campaign + lower(name)), so re-running never
duplicates. Requires the source GeoJSON (`scripts/world/fetch-geojson.sh`) and
honors `DB_PATH` (default `./encounter-tracker.db`). Category and population are
folded into each location's `description` (the `locations` table has no `type`
column). Add `--dry-run` to preview counts without writing.

## Reproducibility

Verified: deleting `world-data/src` and `world-data/build` entirely and re-running
`fetch-geojson.sh` → `build-tiles.sh` → `build-glyphs.js` → `build-themes.js` from
a clean tree reproduces all artifacts (14M `exandria.pmtiles`, 3 glyph stacks, 4
theme styles) and the map still renders correctly. Nothing depends on
hand-massaged intermediate state.

## Handoff to Plan 2 (app integration)

Contract the in-app viewer consumes:
- **Tiles:** `build/exandria.pmtiles` (14M), source-layers `land`, `bathymetry`,
  `inland_water`, `landcover`, `roads`, `cities`, `pois`, `labels`. Serve with
  HTTP Range support (single static file, ~14M — bundling in `public/` is viable).
- **Glyphs:** `build/glyphs/<fontstack>/<range>.pbf`, fontstacks
  `Noto Sans Regular`, `Noto Sans Bold`, `Noto Serif Italic`.
- **Styles + themes:** `build/styles/<id>.json` (complete MapLibre styles) and
  `build/styles/themes.json` (`{id,label,default}`). Default theme `classic`.
  In-app theme switch = `map.setStyle(styles/<id>.json)` with the pmtiles source
  `url` and `glyphs` rewritten to the app's serving routes (the preview shows the
  exact fixup). Map init: `center [11.806, 5.193]`, `minZoom 3`, `maxZoom 12`.

## Serving in the app (Plan 2)

The app serves the artifacts from `WORLD_DIR`:
- **Dev:** defaults to `world-data/build` (no copy needed after running the build scripts).
- **Prod:** set `WORLD_DATA_DIR=/data/world` and run `scripts/world/deploy-to-data.sh`
  on the host to copy `exandria.pmtiles` + `glyphs/` + `styles/` onto the mounted
  `/data` volume. `tippecanoe`/`fontnik` are NOT needed in the production image —
  only the generated files are.
