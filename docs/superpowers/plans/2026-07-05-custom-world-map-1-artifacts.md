# Custom World Map — Plan 1 of 3: Map Artifacts + Standalone Render

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the open-source-exandria GeoJSON (Wildemount + Tal'Dorei) into the real deliverable artifacts — a single `exandria.pmtiles` vector-tile file, self-hosted glyphs, and a hand-authored MapLibre style — and prove the whole approach by rendering a crisp, deep-zoom Exandria map in a throwaway standalone preview page you can eyeball and tune. **No application code is touched in this plan.**

**Architecture:** A build-time data pipeline (`ogr2ogr`-free — the data is already WGS84 lng/lat; `tippecanoe` for tiling; `fontnik` for glyphs) produces static artifacts under a git-ignored `world-data/build/` directory. The durable, small, authored inputs (fetch/tiling/glyph scripts, the `style.json`, a preview page, a README) are committed; the large regenerable binaries (raw GeoJSON, `.pmtiles`, glyph `.pbf`s) are git-ignored and reproduced by running the scripts. A standalone `world-data/preview/index.html` loads MapLibre + the PMTiles protocol against these artifacts for visual verification and live style tuning.

**Tech Stack:** `tippecanoe` (felt fork, build-time CLI), `fontnik` (npm, build-time glyph generation), `pmtiles` (npm, runtime protocol reader — also used by Plan 2), `maplibre-gl` (already a dependency). No Mapbox account, no tile server, no reprojection.

**Verification convention for this plan:** there is no test framework in this codebase (confirmed across prior sub-projects: no jest/vitest, no `*.test.*`, no `test` script). Verification here is inherently artifact- and eyeball-based: run each script, confirm the concrete output file exists and has sane size/structure, and for the final tasks open the preview in a browser and confirm the map renders. Each task ends with a concrete check and a commit. This matches every prior plan in this series.

**Data facts already confirmed (do not re-derive):**
- The source GeoJSON is already in **EPSG:4326 (WGS84 lng/lat)** — coordinates fall in the range roughly lng −65…97, lat −30…40 (map center `[11.806, 5.193]`, their `maxBounds` `[[-65,-30],[97,40]]`). **No reprojection is needed.**
- City/POI label text lives in the **`Name`** property (capital N). Region/area labels live in the `*_label_points.geojson` files.
- Their native zoom range is `minZoom 3 … maxZoom 12`.
- The base cartography (land/water/landcover/roads) styling is locked in a Mapbox-hosted style we cannot read, so this plan **authors that styling from scratch** in MapLibre — a deliberate, iterative design deliverable, not a port.

---

### Task 1: Workspace scaffolding + dependencies

**Files:**
- Create: `world-data/.gitignore`
- Create: `world-data/README.md`
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install the runtime + build npm dependencies**

Run:
```bash
npm install pmtiles
npm install -D fontnik
```
Expected: `pmtiles` under `dependencies` (Plan 2's viewer + this plan's preview both use its MapLibre protocol); `fontnik` under `devDependencies` (build-time glyph generation only). No glyph compositing package is needed — each font is emitted as its own single-font stack.

- [ ] **Step 2: Confirm the system build tools exist**

`tippecanoe` (the felt fork) is a system CLI, not an npm package. Confirm it and its version:
```bash
tippecanoe --version
```
Expected: prints a version ≥ `v2.0.0` (PMTiles output support). If missing, install it and record the method in `world-data/README.md`:
- macOS: `brew install tippecanoe`
- Debian/Ubuntu/Alpine build box: build from source per https://github.com/felt/tippecanoe (`git clone`, `make -j`, `make install`).

If `tippecanoe --version` prints below `v2.0.0` (an old mapbox-era build), install the felt fork — older versions cannot write `.pmtiles`.

- [ ] **Step 3: Create the workspace and its .gitignore**

Create `world-data/.gitignore` with exactly:
```gitignore
# Large, regenerable artifacts — reproduce with the scripts in scripts/world/
src/
build/
```

- [ ] **Step 4: Seed the README**

Create `world-data/README.md`:
```markdown
# Exandria World-Map Data Pipeline

Produces the static artifacts the in-app world map (Plan 2) serves:
`build/exandria.pmtiles`, `build/glyphs/`, and the committed `style.json`.

Everything under `src/` and `build/` is git-ignored and fully regenerable.
To rebuild from scratch:

    scripts/world/fetch-geojson.sh    # -> world-data/src/*.geojson
    scripts/world/build-tiles.sh      # -> world-data/build/exandria.pmtiles
    scripts/world/build-glyphs.js     # -> world-data/build/glyphs/<fontstack>/<range>.pbf
    scripts/world/serve-preview.sh    # open the standalone preview to eyeball/tune

Requires: tippecanoe (felt fork, >= v2.0.0), Node (for fontnik glyph build).

Source data: RossThorn/open-source-exandria (GeoJSON already in EPSG:4326).
Scope: Wildemount + Tal'Dorei overworld only. City-interior layers
(wildemount_city_*) and other continents are intentionally excluded.

Map data thanks to redgiants / RossThorn's open-source-exandria.
```

- [ ] **Step 5: Verify the app still builds**

Run: `npm run build`
Expected: succeeds (the new deps are unused so far; this just confirms `npm install` didn't break anything).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json world-data/.gitignore world-data/README.md
git commit -m "chore: scaffold world-data pipeline workspace + deps (pmtiles, fontnik)"
```

---

### Task 2: Fetch the source GeoJSON

**Files:**
- Create: `scripts/world/fetch-geojson.sh`

- [ ] **Step 1: Write the fetch script**

Create `scripts/world/fetch-geojson.sh` (these are the exact overworld layer files for the two in-scope continents; city-interior and other-continent files are deliberately omitted):

```bash
#!/usr/bin/env bash
set -euo pipefail

# Fetches the Wildemount + Tal'Dorei overworld GeoJSON layers from
# RossThorn/open-source-exandria into world-data/src/.
# Data is already EPSG:4326 (WGS84 lng/lat) — no reprojection performed.

RAW="https://raw.githubusercontent.com/RossThorn/open-source-exandria/main/Data/OSE"
OUT="world-data/src"
mkdir -p "$OUT"

FILES=(
  wildemount_land wildemount_bathymetry wildemount_inland_water
  wildemount_landcover wildemount_roads wildemount_cities
  wildemount_pois wildemount_label_points
  taldorei_land taldorei_bathymetry taldorei_inland_water
  taldorei_landcover taldorei_roads taldorei_cities
  taldorei_pois taldorei_label_points
)

for f in "${FILES[@]}"; do
  echo "Fetching $f.geojson"
  curl -fsSL "$RAW/$f.geojson" -o "$OUT/$f.geojson"
done

echo "Done. $(ls "$OUT" | wc -l | tr -d ' ') files in $OUT"
```

- [ ] **Step 2: Run it**

Run:
```bash
chmod +x scripts/world/fetch-geojson.sh
scripts/world/fetch-geojson.sh
```
Expected: `Done. 16 files in world-data/src`. If any single `curl` 404s, the branch may be `master` not `main` — change `main` to `master` in the `RAW` URL and re-run.

- [ ] **Step 3: Inspect + record the real property names**

The base-map styling (Task 5) needs the actual property names inside `landcover` (its category field) and `roads` (its class/type field), which their published JS didn't reveal. Inspect them now and record findings in `world-data/README.md`:

```bash
# First feature's properties for the two files whose styling is data-driven:
node -e "const g=require('./world-data/src/wildemount_landcover.geojson');console.log('landcover props:',Object.keys(g.features[0].properties));console.log('sample:',g.features.slice(0,5).map(f=>f.properties))"
node -e "const g=require('./world-data/src/wildemount_roads.geojson');console.log('roads props:',Object.keys(g.features[0].properties));console.log('sample:',g.features.slice(0,5).map(f=>f.properties))"
# Confirm coordinates really are lng/lat (small numbers), not projected:
node -e "const g=require('./world-data/src/wildemount_land.geojson');console.log('sample coord:',JSON.stringify(g.features[0].geometry.coordinates).slice(0,80))"
```
Expected: the coordinate sample shows small signed decimals (e.g. `[[[12.3,5.1],...]]`), confirming lng/lat. Append a short note to `world-data/README.md` under a `## Property names` heading recording the landcover category field name and the roads class field name (used verbatim in Task 5's style). Example format: `- landcover category field: <name>` / `- roads class field: <name>` — fill in with what the commands actually print.

- [ ] **Step 4: Commit the script (artifacts stay git-ignored)**

```bash
git add scripts/world/fetch-geojson.sh world-data/README.md
git commit -m "feat: add world GeoJSON fetch script for Wildemount + Tal'Dorei"
```

---

### Task 3: Bake the PMTiles

**Files:**
- Create: `scripts/world/build-tiles.sh`

- [ ] **Step 1: Write the tiling script**

Create `scripts/world/build-tiles.sh`. Each continent's file for a given theme is assigned the **same source-layer name**, so both continents merge into one uniform layer the style can address once (source-layer names chosen here are the contract Task 5 and Plan 2 depend on: `land`, `bathymetry`, `inland_water`, `landcover`, `roads`, `cities`, `pois`, `labels`):

```bash
#!/usr/bin/env bash
set -euo pipefail

SRC="world-data/src"
OUT="world-data/build"
mkdir -p "$OUT"

tippecanoe -o "$OUT/exandria.pmtiles" -f \
  --name="Exandria (Wildemount + Tal'Dorei)" \
  --attribution="Map data: redgiants / RossThorn open-source-exandria" \
  -Z0 -z12 \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --coalesce-densest-as-needed \
  --simplification=4 \
  --detect-shared-borders \
  -L"{\"layer\":\"land\",\"file\":\"$SRC/wildemount_land.geojson\"}" \
  -L"{\"layer\":\"land\",\"file\":\"$SRC/taldorei_land.geojson\"}" \
  -L"{\"layer\":\"bathymetry\",\"file\":\"$SRC/wildemount_bathymetry.geojson\"}" \
  -L"{\"layer\":\"bathymetry\",\"file\":\"$SRC/taldorei_bathymetry.geojson\"}" \
  -L"{\"layer\":\"inland_water\",\"file\":\"$SRC/wildemount_inland_water.geojson\"}" \
  -L"{\"layer\":\"inland_water\",\"file\":\"$SRC/taldorei_inland_water.geojson\"}" \
  -L"{\"layer\":\"landcover\",\"file\":\"$SRC/wildemount_landcover.geojson\"}" \
  -L"{\"layer\":\"landcover\",\"file\":\"$SRC/taldorei_landcover.geojson\"}" \
  -L"{\"layer\":\"roads\",\"file\":\"$SRC/wildemount_roads.geojson\"}" \
  -L"{\"layer\":\"roads\",\"file\":\"$SRC/taldorei_roads.geojson\"}" \
  -L"{\"layer\":\"cities\",\"file\":\"$SRC/wildemount_cities.geojson\"}" \
  -L"{\"layer\":\"cities\",\"file\":\"$SRC/taldorei_cities.geojson\"}" \
  -L"{\"layer\":\"pois\",\"file\":\"$SRC/wildemount_pois.geojson\"}" \
  -L"{\"layer\":\"pois\",\"file\":\"$SRC/taldorei_pois.geojson\"}" \
  -L"{\"layer\":\"labels\",\"file\":\"$SRC/wildemount_label_points.geojson\"}" \
  -L"{\"layer\":\"labels\",\"file\":\"$SRC/taldorei_label_points.geojson\"}"

echo "Built $OUT/exandria.pmtiles ($(du -h "$OUT/exandria.pmtiles" | cut -f1))"
```

- [ ] **Step 2: Run it**

Run:
```bash
chmod +x scripts/world/build-tiles.sh
scripts/world/build-tiles.sh
```
Expected: tippecanoe prints per-layer progress and a final `Built world-data/build/exandria.pmtiles (<size>)`. The file should be non-trivial (roughly single-digit to low-tens of MB). If tippecanoe errors that `-o` with `.pmtiles` is unsupported, the installed tippecanoe predates PMTiles output — reinstall the felt fork (Task 1, Step 2).

- [ ] **Step 3: Verify the layers + record the actual size**

`tippecanoe`'s own run output (Step 2) lists every layer it wrote — scroll back through it and confirm all eight source-layer names were used: `land`, `bathymetry`, `inland_water`, `landcover`, `roads`, `cities`, `pois`, `labels` (tippecanoe prints a per-layer summary and tile-stat lines naming each). If you want to re-print them without re-tiling, run `tippecanoe-decode world-data/build/exandria.pmtiles 0 0 0 2>/dev/null | head` (ships with tippecanoe) and confirm the layer names appear.

The definitive functional check that the layer names are correct is the preview render in Task 6 — a wrong `source-layer` shows as a missing/blank layer there. Record the file's actual size (from the `du -h` in the script's final line) in `world-data/README.md` (Plan 2 uses it to decide the production serving mechanism).

- [ ] **Step 4: Commit the script**

```bash
git add scripts/world/build-tiles.sh world-data/README.md
git commit -m "feat: add tippecanoe build script producing exandria.pmtiles"
```

---

### Task 4: Generate self-hosted glyphs

**Files:**
- Create: `scripts/world/build-glyphs.js`

- [ ] **Step 1: Write the glyph-build script**

MapLibre renders label text from SDF glyph PBFs organized as `<fontstack>/<range>.pbf`. Create `scripts/world/build-glyphs.js` (uses `fontnik`, installed in Task 1). It downloads three static OFL TrueType fonts and emits one fontstack folder per font. The fontstack names here — `Noto Sans Regular`, `Noto Sans Bold`, `Noto Serif Italic` — are the contract Task 5's `text-font` arrays reference verbatim:

```js
/* Generates MapLibre SDF glyph PBFs from static TTF fonts into
   world-data/build/glyphs/<fontstack>/<start>-<end>.pbf */
const fs = require("fs");
const path = require("path");
const https = require("https");
const fontnik = require("fontnik");

const OUT = path.join("world-data", "build", "glyphs");

// family name (used as the fontstack folder) -> static TTF download URL
const FONTS = {
  "Noto Sans Regular":
    "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf",
  "Noto Sans Bold":
    "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf",
  "Noto Serif Italic":
    "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSerif/NotoSerif-Italic.ttf",
};

function download(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(download(res.headers.location));
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

function range(buf, start, end) {
  return new Promise((resolve, reject) =>
    fontnik.range({ font: buf, start, end }, (err, data) => (err ? reject(err) : resolve(data)))
  );
}

async function main() {
  for (const [stack, url] of Object.entries(FONTS)) {
    console.log(`Downloading ${stack}`);
    const ttf = await download(url);
    const dir = path.join(OUT, stack);
    fs.mkdirSync(dir, { recursive: true });
    // Latin + common punctuation/diacritics is enough for these maps; cover 0..3FFF.
    for (let start = 0; start < 0x4000; start += 256) {
      const end = start + 255;
      const pbf = await range(ttf, start, end);
      fs.writeFileSync(path.join(dir, `${start}-${end}.pbf`), pbf);
    }
    console.log(`  wrote ${stack} (${fs.readdirSync(dir).length} ranges)`);
  }
  console.log("Glyphs done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `node scripts/world/build-glyphs.js`
Expected: prints `wrote Noto Sans Regular (64 ranges)` etc. and `Glyphs done.`. Produces `world-data/build/glyphs/Noto Sans Regular/0-255.pbf` … through `16128-16383.pbf`, and the same for the other two stacks. If a font URL 404s (upstream repo layout changed), substitute any static OFL `.ttf` and keep the fontstack name — the fontstack name is what must stay stable, not the source URL. Record any substitution in `world-data/README.md`.

- [ ] **Step 3: Verify a glyph file is real**

Run: `ls -la "world-data/build/glyphs/Noto Sans Regular/0-255.pbf"`
Expected: a non-empty file (typically a few KB). The `0-255` range (basic Latin) is the one the maps will use most.

- [ ] **Step 4: Commit the script**

```bash
git add scripts/world/build-glyphs.js
git commit -m "feat: add fontnik glyph-generation script for self-hosted labels"
```

---

### Task 5: Author the baseline MapLibre style

**Files:**
- Create: `world-data/style.json`

- [ ] **Step 1: Write the baseline style**

Create `world-data/style.json`. This is the first-pass cartography — a redgiants-flavored parchment/atlas palette. `sources.exandria.url` and `glyphs` are neutral relative defaults; the preview (Task 6) overrides them with absolute URLs at runtime, and Plan 2 points them at the app's routes. This baseline deliberately uses a **flat landcover fill** and **zoom-based (not class-based) road widths** so it renders correctly regardless of the exact property names in those files; splitting landcover by category and roads by class is a live-tuning refinement in Task 6 Step 4, using the property names recorded in Task 2 Step 3:

```json
{
  "version": 8,
  "name": "Exandria",
  "glyphs": "build/glyphs/{fontstack}/{range}.pbf",
  "sources": {
    "exandria": { "type": "vector", "url": "pmtiles://build/exandria.pmtiles" }
  },
  "layers": [
    { "id": "sea", "type": "background", "paint": { "background-color": "#aac4d3" } },
    {
      "id": "bathymetry", "type": "fill", "source": "exandria", "source-layer": "bathymetry",
      "paint": { "fill-color": "#9bb8ca", "fill-opacity": 0.5 }
    },
    {
      "id": "land", "type": "fill", "source": "exandria", "source-layer": "land",
      "paint": { "fill-color": "#e9e0c9" }
    },
    {
      "id": "landcover", "type": "fill", "source": "exandria", "source-layer": "landcover",
      "paint": {
        "fill-color": "#d9cfa8",
        "fill-opacity": 0.55
      }
    },
    {
      "id": "inland-water", "type": "fill", "source": "exandria", "source-layer": "inland_water",
      "paint": { "fill-color": "#aac4d3" }
    },
    {
      "id": "coastline", "type": "line", "source": "exandria", "source-layer": "land",
      "paint": { "line-color": "#b9a77e", "line-width": 1.1 }
    },
    {
      "id": "roads", "type": "line", "source": "exandria", "source-layer": "roads",
      "paint": {
        "line-color": "#9a7b4f",
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 8, 1.4, 12, 3]
      }
    },
    {
      "id": "region-labels", "type": "symbol", "source": "exandria", "source-layer": "labels",
      "layout": {
        "text-field": ["get", "Name"],
        "text-font": ["Noto Serif Italic"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 4, 11, 9, 20],
        "text-letter-spacing": 0.15,
        "text-transform": "uppercase",
        "text-allow-overlap": false
      },
      "paint": {
        "text-color": "#5a4d33",
        "text-halo-color": "#e9e0c9",
        "text-halo-width": 1.4
      }
    },
    {
      "id": "city-dots", "type": "circle", "source": "exandria", "source-layer": "cities",
      "paint": {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 1.6, 12, 4],
        "circle-color": "#2d2416",
        "circle-stroke-color": "#f2ecda",
        "circle-stroke-width": 1
      }
    },
    {
      "id": "city-labels", "type": "symbol", "source": "exandria", "source-layer": "cities",
      "layout": {
        "text-field": ["get", "Name"],
        "text-font": ["Noto Sans Bold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 12, 16],
        "text-anchor": "top",
        "text-offset": [0, 0.4],
        "text-allow-overlap": false
      },
      "paint": {
        "text-color": "#2d2416",
        "text-halo-color": "#f2ecda",
        "text-halo-width": 1.6
      }
    },
    {
      "id": "poi-labels", "type": "symbol", "source": "exandria", "source-layer": "pois",
      "minzoom": 7,
      "layout": {
        "text-field": ["get", "Name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 7, 10, 12, 13],
        "text-anchor": "top",
        "text-offset": [0, 0.3],
        "text-allow-overlap": false
      },
      "paint": {
        "text-color": "#4a3f28",
        "text-halo-color": "#f2ecda",
        "text-halo-width": 1.4
      }
    }
  ]
}
```

- [ ] **Step 2: Validate the JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('world-data/style.json','utf8'));console.log('style.json valid')"`
Expected: `style.json valid`.

- [ ] **Step 3: Commit**

```bash
git add world-data/style.json
git commit -m "feat: add baseline MapLibre style for the Exandria world map"
```

---

### Task 6: Standalone preview + live style tuning

**Files:**
- Create: `world-data/preview/index.html`
- Create: `scripts/world/serve-preview.sh`

- [ ] **Step 1: Write the preview page**

Create `world-data/preview/index.html`. It loads MapLibre + the PMTiles protocol from a CDN (preview-only; the app bundles them in Plan 2), fetches the committed `style.json`, and rewrites the source + glyphs URLs to absolute URLs against the local server so the PMTiles protocol resolves correctly:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Exandria preview</title>
  <link href="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css" rel="stylesheet" />
  <style>html,body,#map{margin:0;height:100%}</style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js"></script>
  <script src="https://unpkg.com/pmtiles@3/dist/pmtiles.js"></script>
  <script>
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);
    const origin = location.origin; // server root = world-data/
    fetch("../style.json")
      .then((r) => r.json())
      .then((style) => {
        style.sources.exandria.url = "pmtiles://" + origin + "/build/exandria.pmtiles";
        style.glyphs = origin + "/build/glyphs/{fontstack}/{range}.pbf";
        const map = new maplibregl.Map({
          container: "map",
          style,
          center: [11.806, 5.193],
          zoom: 4,
          minZoom: 3,
          maxZoom: 12,
        });
        map.addControl(new maplibregl.NavigationControl());
        map.on("error", (e) => console.error("map error:", e.error));
      });
  </script>
</body>
</html>
```

- [ ] **Step 2: Write the preview server script**

Create `scripts/world/serve-preview.sh`. It serves the `world-data/` directory over HTTP with byte-range support (Python's server supports ranges, which the PMTiles reader requires):

```bash
#!/usr/bin/env bash
set -euo pipefail
cd world-data
echo "Preview at http://localhost:8080/preview/  (Ctrl-C to stop)"
python3 -m http.server 8080
```

- [ ] **Step 3: Serve and open the preview**

Run:
```bash
chmod +x scripts/world/serve-preview.sh
scripts/world/serve-preview.sh
```
Then open `http://localhost:8080/preview/` in a browser.

Expected: **both continents of Exandria render** — parchment land on a blue sea, city labels, region labels — and you can pan and **zoom in deeply (to z12) with crisp vector edges** (no pixelation, unlike a raster image). City labels declutter (don't overlap). Check the browser console: no fatal errors (a benign 404 for an out-of-range glyph is fine). If the map is blank, check the console — the most common cause is a `source-layer` name in `style.json` not matching one of the eight layer names tippecanoe reported in Task 3 (`land`, `bathymetry`, `inland_water`, `landcover`, `roads`, `cities`, `pois`, `labels`).

- [ ] **Step 4: Tune the style live**

This is the point of Plan 1. With the preview open, iterate on `world-data/style.json` (colors, label sizes, road widths, landcover treatment, halos) and refresh the browser to compare against the redgiants aesthetic until it looks right. Split `landcover` into per-category fills using the category property recorded in Task 2 Step 3 (e.g. a `["match", ["get", "<category>"], "forest", "#c7d3a4", "mountain", "#ded3bf", "#d9cfa8"]` fill-color expression) if the data supports it. Re-validate JSON after edits (`node -e "JSON.parse(require('fs').readFileSync('world-data/style.json','utf8'))"`).

- [ ] **Step 5: Commit the preview + the tuned style**

```bash
git add world-data/preview/index.html scripts/world/serve-preview.sh world-data/style.json
git commit -m "feat: add standalone Exandria preview and tune baseline style"
```

---

### Task 7: Finalize + document reproducibility

**Files:**
- Modify: `world-data/README.md`

- [ ] **Step 1: Prove the pipeline is reproducible from a clean tree**

Run:
```bash
rm -rf world-data/src world-data/build
scripts/world/fetch-geojson.sh
scripts/world/build-tiles.sh
node scripts/world/build-glyphs.js
```
Expected: all three complete with no errors and recreate `world-data/build/exandria.pmtiles` and `world-data/build/glyphs/`. This confirms nothing depends on hand-massaged intermediate files.

- [ ] **Step 2: Re-open the preview to confirm the rebuilt artifacts still render**

Run `scripts/world/serve-preview.sh`, open `http://localhost:8080/preview/`, confirm the map still renders correctly with the tuned style.

- [ ] **Step 3: Finalize the README**

Ensure `world-data/README.md` records: the confirmed `.pmtiles` size, the eight source-layer names, the three fontstack names, and the landcover/roads property names from Task 2. This is the handoff contract Plan 2 consumes.

- [ ] **Step 4: Commit**

```bash
git add world-data/README.md
git commit -m "docs: finalize world-data pipeline reproducibility notes"
```

---

## What this plan deliberately leaves for later plans

- **Plan 2 (app integration):** serving `exandria.pmtiles` + glyphs + `style.json` from the Next app (range-capable route vs bundled `public/` asset — decided using the real file size recorded in Task 3); a `/world` route + "World" nav item; a `WorldMapCanvas` React component (MapLibre + the `pmtiles` protocol + the committed style); the entity/marker overlay storing lng/lat and using MapLibre `project`/`unproject`; the per-campaign `'world'` `maps` record + get-or-create API; loading/error overlays.
- **Plan 3 (retire the sub-project-6 mode):** remove the promote-a-tiled-map → World Map flow, Terra Draw drawing, the `map_features` table + CRUD + `FeatureFormDialog`, and the raster-Mercator `vtiles` route + `mercator-adapter`; keep the uploaded static/tiled map viewers intact.

Plans 2 and 3 will be written against the concrete artifacts and contracts this plan produces (real source-layer names, real file size, the tuned style), rather than against guesses.
```
