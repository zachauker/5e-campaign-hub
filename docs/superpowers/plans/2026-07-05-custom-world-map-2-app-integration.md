# Custom World Map — Plan 2 of 3: App Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the Plan 1 artifacts (`exandria.pmtiles` + self-hosted glyphs + the four theme styles) behind a self-hosted `/world` page in the app — a MapLibre vector world map of Exandria with the existing entity/marker overlay on top (markers stored as real lng/lat) and a four-theme switcher.

**Architecture:** A new dedicated per-campaign `maps` record with `renderMode: 'world'` (created lazily by `GET /api/world?campaignId=`) reuses the existing `map_markers` table and marker API unchanged — for a world map, a marker's `x`/`y` columns hold **lng/lat** instead of the 0–1 image fractions the uploaded maps use, and MapLibre's `project`/`unproject` (via `lngLat`) handle the mapping directly, so there is no Mercator-adapter math. A `WorldMapCanvas` component (MapLibre + the `pmtiles` protocol) renders the pmtiles vector source with the selected theme style; a `WorldMapViewer` page wraps it with the marker info-card / dialog shell (mirrored from `MapViewer`) plus a theme toggle. The static artifacts are served with HTTP Range support by a catch-all route reading from a `WORLD_DIR` directory (dev: `world-data/build`; prod: `/data/world`, populated by a deploy script — keeping `tippecanoe` out of the Docker build).

**Tech Stack:** existing Next.js 16 / React 19 / Drizzle / better-sqlite3 stack, `maplibre-gl` + `pmtiles` (added in Plan 1). No new dependencies.

**Verification convention for this plan:** no test framework exists in this codebase (established across every prior sub-project — no jest/vitest, no `*.test.*`, no `test` script). Each task ends with `npm run build` (type-check) and, where relevant, a concrete manual check (curl or the browser preview). The end-to-end browser smoke test is Task 10.

**Prerequisites (from Plan 1, already on `main`):**
- `world-data/build/exandria.pmtiles` (14M; source-layers `land`, `bathymetry`, `inland_water`, `landcover`, `roads`, `cities`, `pois`, `labels`), `world-data/build/glyphs/<fontstack>/<range>.pbf` (fontstacks `Noto Sans Regular`, `Noto Sans Bold`, `Noto Serif Italic`), and `world-data/build/styles/<id>.json` + `themes.json` (themes `classic` (default), `vibrant`, `antique`, `dark`). Regenerate with the `scripts/world/*` scripts if missing. The theme style files contain placeholder `sources.exandria.url = "pmtiles://build/exandria.pmtiles"` and `glyphs = "build/glyphs/{fontstack}/{range}.pbf"` — the client rewrites these to the app's serving URLs at load time (see Task 5).

---

### Task 1: Add the `'world'` render mode

**Files:**
- Modify: `lib/db/schema.ts:144`
- Modify: `components/maps/map-types.ts:69`

- [ ] **Step 1: Widen the `renderMode` enum in the Drizzle schema**

In `lib/db/schema.ts`, change the `maps.renderMode` column (line 144) from:
```ts
  renderMode: text("render_mode", { enum: ["static", "tiled"] }).notNull().default("static"),
```
to:
```ts
  renderMode: text("render_mode", { enum: ["static", "tiled", "world"] }).notNull().default("static"),
```
No database migration is needed: `render_mode` is a plain `TEXT` column (see `lib/db/migrate.ts`), so the widened TypeScript enum requires no schema change — existing rows keep their values and new `'world'` rows insert fine.

- [ ] **Step 2: Widen the `renderMode` union in the shared frontend types**

In `components/maps/map-types.ts`, change the `MapData.renderMode` field (line 69) from:
```ts
  renderMode: "static" | "tiled";
```
to:
```ts
  renderMode: "static" | "tiled" | "world";
```

- [ ] **Step 3: Verify types compile**

Run: `npm run build`
Expected: succeeds. (`MapRow`/`NewMapRow` pick up the widened enum automatically; the existing `MapViewer` dispatch on `renderMode === "tiled"` still type-checks.)

- [ ] **Step 4: Commit**

```bash
git add lib/db/schema.ts components/maps/map-types.ts
git commit -m "feat: add 'world' render mode to maps schema + types"
```

---

### Task 2: World-artifact deploy script + serving directory convention

**Files:**
- Create: `scripts/world/deploy-to-data.sh`
- Modify: `world-data/README.md`

- [ ] **Step 1: Write the deploy script**

The app serves the world artifacts from a `WORLD_DIR` directory. In development that defaults to `world-data/build` (where Plan 1's scripts already put them). In production the artifacts are **not** baked into the Docker image (that would require `tippecanoe` at build time); instead they are generated on the host and copied onto the `/data` volume, and the app is pointed at them with `WORLD_DATA_DIR=/data/world`. This script does that copy.

Create `scripts/world/deploy-to-data.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

# Copies the generated world artifacts into the serving directory.
# Prod: run on the host with WORLD_DATA_DIR pointing at the mounted volume
#   (e.g. WORLD_DATA_DIR=/data/world scripts/world/deploy-to-data.sh)
# Dev:  not needed — the app serves world-data/build directly by default.

SRC="world-data/build"
DEST="${WORLD_DATA_DIR:-world-data/build}"

if [ ! -f "$SRC/exandria.pmtiles" ]; then
  echo "error: $SRC/exandria.pmtiles not found — run the Plan 1 build scripts first." >&2
  exit 1
fi

if [ "$DEST" = "$SRC" ]; then
  echo "WORLD_DATA_DIR not set (or equals $SRC) — nothing to copy; the app serves $SRC directly."
  exit 0
fi

mkdir -p "$DEST"
cp "$SRC/exandria.pmtiles" "$DEST/"
rm -rf "$DEST/glyphs" "$DEST/styles"
cp -R "$SRC/glyphs" "$DEST/glyphs"
cp -R "$SRC/styles" "$DEST/styles"
echo "Deployed world artifacts to $DEST"
```

- [ ] **Step 2: Make it executable and document it**

Run: `chmod +x scripts/world/deploy-to-data.sh`

Append to `world-data/README.md`:
```markdown

## Serving in the app (Plan 2)

The app serves the artifacts from `WORLD_DIR`:
- **Dev:** defaults to `world-data/build` (no copy needed after running the build scripts).
- **Prod:** set `WORLD_DATA_DIR=/data/world` and run `scripts/world/deploy-to-data.sh`
  on the host to copy `exandria.pmtiles` + `glyphs/` + `styles/` onto the mounted
  `/data` volume. `tippecanoe`/`fontnik` are NOT needed in the production image —
  only the generated files are.
```

- [ ] **Step 3: Commit**

```bash
git add scripts/world/deploy-to-data.sh world-data/README.md
git commit -m "feat: add world-artifact deploy script + serving-dir docs"
```

---

### Task 3: Range-capable world-asset serving route

**Files:**
- Create: `app/api/world/[...path]/route.ts`

- [ ] **Step 1: Write the asset route**

Create `app/api/world/[...path]/route.ts`. It serves files under `WORLD_DIR` (the pmtiles, glyphs, and theme styles) with HTTP Range support (the PMTiles reader issues byte-range requests) and path-traversal protection:

```ts
import { NextResponse } from "next/server";
import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { Readable } from "stream";

// Dev default: the Plan 1 build output. Prod: WORLD_DATA_DIR=/data/world (see deploy-to-data.sh).
const WORLD_DIR = process.env.WORLD_DATA_DIR || path.join(process.cwd(), "world-data", "build");

const TYPES: Record<string, string> = {
  ".pmtiles": "application/octet-stream",
  ".pbf": "application/x-protobuf",
  ".json": "application/json",
};

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params;
  const rel = parts.join("/");
  const filePath = path.normalize(path.join(WORLD_DIR, rel));
  const root = path.normalize(WORLD_DIR);
  if (!filePath.startsWith(root)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let size: number;
  try {
    const st = await fs.stat(filePath);
    if (!st.isFile()) throw new Error("not a file");
    size = st.size;
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const type = TYPES[path.extname(filePath)] || "application/octet-stream";
  const range = req.headers.get("range");

  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    if (m) {
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : size - 1;
      if (start >= size || end >= size || start > end) {
        return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      }
      const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream;
      return new NextResponse(stream, {
        status: 206,
        headers: {
          "Content-Type": type,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(end - start + 1),
          "Cache-Control": "public, max-age=86400",
        },
      });
    }
  }

  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run build`
Expected: succeeds; the route registers as `ƒ /api/world/[...path]`.

- [ ] **Step 3: Manually verify Range serving against the real pmtiles**

Ensure the artifacts exist (`ls world-data/build/exandria.pmtiles` — if missing, run the Plan 1 scripts). Start the dev server (`npm run dev`) and in another terminal:
```bash
curl -s -o /dev/null -D - -H "Range: bytes=0-99" http://localhost:3000/api/world/exandria.pmtiles | grep -iE "^HTTP|content-range|content-length"
curl -s -o /dev/null -D - http://localhost:3000/api/world/styles/themes.json | grep -iE "^HTTP|content-type"
```
Expected: the first prints `HTTP/1.1 206 Partial Content`, `Content-Range: bytes 0-99/13963980`, `Content-Length: 100`. The second prints `HTTP/1.1 200 OK` and `Content-Type: application/json`. (A 206 on the range request is the critical proof — MapLibre's PMTiles reader depends on it.)

- [ ] **Step 4: Commit**

```bash
git add app/api/world/\[...path\]/route.ts
git commit -m "feat: add range-capable world-asset serving route"
```

---

### Task 4: Get-or-create world-map record API

**Files:**
- Create: `app/api/world/route.ts`

- [ ] **Step 1: Write the route**

The world map is a per-campaign `maps` record with `renderMode: 'world'`. This route returns it, creating it lazily on first request. Create `app/api/world/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { maps } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { and, eq } from "drizzle-orm";

// GET /api/world?campaignId=<id> -> the campaign's world map record (created if absent).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  if (!campaignId) {
    return NextResponse.json({ error: '"campaignId" is required' }, { status: 400 });
  }

  const existing = await db.query.maps.findFirst({
    where: and(eq(maps.campaignId, campaignId), eq(maps.renderMode, "world")),
  });
  if (existing) return NextResponse.json(existing);

  const now = new Date();
  const [created] = await db
    .insert(maps)
    .values({
      id: generateId(),
      campaignId,
      name: "Exandria",
      imagePath: "world", // no uploaded image; column is NOT NULL, so a sentinel
      parentMapId: null,
      renderMode: "world",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return NextResponse.json(created);
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run build`
Expected: succeeds; route registers as `ƒ /api/world`.

- [ ] **Step 3: Manually verify get-or-create**

With `npm run dev` running, get a real campaign id (`curl -s http://localhost:3000/api/campaigns | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d)[0].id))"`), then:
```bash
CID=<paste campaign id>
curl -s "http://localhost:3000/api/world?campaignId=$CID" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const m=JSON.parse(d);console.log('id',m.id,'renderMode',m.renderMode,'name',m.name)})"
# Call again — must return the SAME id (get-or-create, not create-twice):
curl -s "http://localhost:3000/api/world?campaignId=$CID" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('second call id',JSON.parse(d).id))"
```
Expected: both calls print the same `id`, `renderMode world`, `name Exandria`.

- [ ] **Step 4: Commit**

```bash
git add app/api/world/route.ts
git commit -m "feat: add get-or-create world-map record API"
```

---

### Task 5: WorldMapCanvas — base vector viewer + theme switching

**Files:**
- Create: `components/maps/WorldMapCanvas.tsx`

- [ ] **Step 1: Write the component (base render + theme, no markers yet)**

Create `components/maps/WorldMapCanvas.tsx`. It registers the PMTiles protocol once, fetches the selected theme style, rewrites its `sources.exandria.url`/`glyphs` to the app's `/api/world/...` routes, and renders. Switching `theme` re-loads the style via `setStyle` (camera preserved). Markers are added in Task 6.

```tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { MapLibreMap, addProtocol, type MapMouseEvent, type StyleSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import { Loader2 } from "lucide-react";

// Register the pmtiles:// protocol once for the whole app. The Protocol instance
// is module-level so it (and its tile cache) persists for the app's lifetime.
const pmtilesProtocol = new Protocol();
let pmtilesRegistered = false;
function ensurePmtilesProtocol() {
  if (pmtilesRegistered) return;
  addProtocol("pmtiles", pmtilesProtocol.tile);
  pmtilesRegistered = true;
}

const WORLD_CENTER: [number, number] = [11.806, 5.193];
const WORLD_MIN_ZOOM = 3;
const WORLD_MAX_ZOOM = 12;

export interface WorldMapCanvasProps {
  theme: string;
  addMode: boolean;
  onMapClick: (lngLat: { lng: number; lat: number }) => void;
  onReady?: (map: MapLibreMap) => void;
  onZoomChange?: (zoom: number) => void;
}

// Point a fetched theme style at the app's world-asset routes.
function fixupStyle(style: StyleSpecification, origin: string): StyleSpecification {
  const src = style.sources?.exandria;
  if (src && "url" in src) src.url = `pmtiles://${origin}/api/world/exandria.pmtiles`;
  style.glyphs = `${origin}/api/world/glyphs/{fontstack}/{range}.pbf`;
  return style;
}

async function loadThemeStyle(theme: string, origin: string): Promise<StyleSpecification> {
  const res = await fetch(`/api/world/styles/${theme}.json`);
  if (!res.ok) throw new Error(`theme ${theme} not found`);
  return fixupStyle(await res.json(), origin);
}

export function WorldMapCanvas({ theme, addMode, onMapClick, onReady, onZoomChange }: WorldMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const glMapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const cbRef = useRef({ addMode, onMapClick, onReady, onZoomChange });
  useEffect(() => {
    cbRef.current = { addMode, onMapClick, onReady, onZoomChange };
  });

  // Mount once. Theme changes are handled by the separate effect below.
  useEffect(() => {
    if (!containerRef.current) return;
    ensurePmtilesProtocol();
    let cancelled = false;
    let glMap: MapLibreMap | null = null;

    loadThemeStyle(theme, window.location.origin)
      .then((style) => {
        if (cancelled || !containerRef.current) return;
        glMap = new MapLibreMap({
          container: containerRef.current,
          style,
          center: WORLD_CENTER,
          zoom: 4,
          minZoom: WORLD_MIN_ZOOM,
          maxZoom: WORLD_MAX_ZOOM,
          renderWorldCopies: false,
          attributionControl: false,
        });
        glMapRef.current = glMap;

        glMap.on("error", (e) => {
          console.error("MapLibre error:", e.error);
          if (!readyRef.current) setMapError("Failed to load the world map. Try refreshing.");
        });
        glMap.on("click", (e: MapMouseEvent) => {
          if (cbRef.current.addMode) cbRef.current.onMapClick(e.lngLat);
        });
        glMap.on("zoomend", () => cbRef.current.onZoomChange?.(glMap!.getZoom()));
        glMap.on("load", () => {
          setReady(true);
          cbRef.current.onZoomChange?.(glMap!.getZoom());
          cbRef.current.onReady?.(glMap!);
        });
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setMapError("Failed to load the world map. Try refreshing.");
      });

    return () => {
      cancelled = true;
      glMap?.remove();
      glMapRef.current = null;
      setReady(false);
    };
    // Mount once; theme handled separately so the map isn't torn down on switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  // Cursor feedback for add-marker mode.
  useEffect(() => {
    const glMap = glMapRef.current;
    if (!glMap) return;
    glMap.getCanvasContainer().style.cursor = addMode ? "crosshair" : "";
  }, [addMode, ready]);

  // Switch theme without remounting (camera preserved).
  useEffect(() => {
    const glMap = glMapRef.current;
    if (!glMap || !ready) return;
    let cancelled = false;
    loadThemeStyle(theme, window.location.origin).then((style) => {
      if (!cancelled) glMap.setStyle(style);
    });
    return () => {
      cancelled = true;
    };
  }, [theme, ready]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-black/40">
      <div ref={containerRef} className="w-full h-full" />
      {!ready && !mapError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {mapError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-sm text-destructive bg-card/90 border border-border rounded-md px-3 py-2">{mapError}</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run build`
Expected: succeeds. (`StyleSpecification` is exported by `maplibre-gl`; `Protocol` by `pmtiles`.)

- [ ] **Step 3: Commit**

```bash
git add components/maps/WorldMapCanvas.tsx
git commit -m "feat: add WorldMapCanvas base vector viewer with theme switching"
```

---

### Task 6: WorldMapCanvas — entity marker overlay (lng/lat)

**Files:**
- Modify: `components/maps/WorldMapCanvas.tsx`

- [ ] **Step 1: Add marker props + overlay**

World-map markers store real lng/lat in their `x`/`y` fields, so no coordinate conversion is needed — `marker.x` is lng, `marker.y` is lat. Reuse `MapMarkerPin` (rendered to an element like `VectorMapCanvas` does) with `minZoom` progressive reveal. Update `components/maps/WorldMapCanvas.tsx`.

Add imports near the top (after the existing imports):
```tsx
import { Marker } from "maplibre-gl";
import { renderToStaticMarkup } from "react-dom/server";
import { MapMarkerPin } from "@/components/maps/MapMarkerPin";
import type { ResolvedMarker } from "@/components/maps/map-types";
```

Add these props to `WorldMapCanvasProps`:
```tsx
  markers: ResolvedMarker[];
  selectedId: string | null;
  onMarkerClick: (marker: ResolvedMarker) => void;
  onMarkerDragEnd: (markerId: string, lngLat: { lng: number; lat: number }) => void;
```

Add them to the destructured params of `WorldMapCanvas({ ... })` alongside the existing ones.

Add a marker-instances ref and a zoom state near the other refs (after `const [mapError, setMapError] = useState<string | null>(null);`):
```tsx
  const markerInstancesRef = useRef<Map<string, Marker>>(new Map());
  const [zoom, setZoom] = useState<number>(WORLD_MIN_ZOOM);
  const markerCbRef = useRef({ onMarkerClick, onMarkerDragEnd });
  useEffect(() => {
    markerCbRef.current = { onMarkerClick, onMarkerDragEnd };
  });
```

In the mount effect's `zoomend` handler, also track zoom for reveal — change:
```tsx
        glMap.on("zoomend", () => cbRef.current.onZoomChange?.(glMap!.getZoom()));
```
to:
```tsx
        glMap.on("zoomend", () => {
          setZoom(glMap!.getZoom());
          cbRef.current.onZoomChange?.(glMap!.getZoom());
        });
```
and in the `load` handler add `setZoom(glMap!.getZoom());` right after `setReady(true);`.

In the mount effect's cleanup, remove marker instances before `glMap?.remove()`:
```tsx
    return () => {
      cancelled = true;
      for (const inst of markerInstancesRef.current.values()) inst.remove();
      markerInstancesRef.current.clear();
      glMap?.remove();
      glMapRef.current = null;
      setReady(false);
    };
```

Add the marker-sync effect (after the theme-switch effect). Note: markers are attached to the map instance, not the style, so they survive `setStyle`:
```tsx
  useEffect(() => {
    const glMap = glMapRef.current;
    if (!glMap || !ready) return;
    const instances = markerInstancesRef.current;
    const visible = markers.filter((m) => m.minZoom === null || zoom >= m.minZoom);
    const seen = new Set(visible.map((m) => m.id));

    for (const [id, inst] of instances) {
      if (!seen.has(id)) {
        inst.remove();
        instances.delete(id);
      }
    }

    for (const marker of visible) {
      const lngLat: [number, number] = [marker.x, marker.y]; // x=lng, y=lat for world maps
      let inst = instances.get(marker.id);
      if (!inst) {
        const el = document.createElement("div");
        el.innerHTML = renderToStaticMarkup(<MapMarkerPin type={marker.type} selected={marker.id === selectedId} />);
        el.addEventListener("click", (evt) => {
          evt.stopPropagation();
          markerCbRef.current.onMarkerClick(marker);
        });
        inst = new Marker({ element: el, draggable: true, anchor: "bottom" }).setLngLat(lngLat).addTo(glMap);
        inst.on("dragend", () => {
          const { lng, lat } = inst!.getLngLat();
          markerCbRef.current.onMarkerDragEnd(marker.id, { lng, lat });
        });
        instances.set(marker.id, inst);
      } else {
        inst.setLngLat(lngLat);
        inst.getElement().innerHTML = renderToStaticMarkup(
          <MapMarkerPin type={marker.type} selected={marker.id === selectedId} />
        );
      }
    }
  }, [markers, selectedId, ready, zoom]);
```

- [ ] **Step 2: Verify types compile**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/maps/WorldMapCanvas.tsx
git commit -m "feat: add lng/lat entity marker overlay to WorldMapCanvas"
```

---

### Task 7: WorldMapViewer page shell (markers, dialog, theme toggle)

**Files:**
- Create: `components/maps/WorldMapViewer.tsx`

- [ ] **Step 1: Write the viewer**

This mirrors `MapViewer`'s marker info-card + `MarkerFormDialog` shell, but for the world map: it get-or-creates the world map record, loads markers, renders `WorldMapCanvas`, and adds a theme `<select>` (persisted to `localStorage`). World markers are created via the existing `POST /api/maps/[id]/markers` with `x=lng`, `y=lat`; the `MarkerFormDialog` already posts `position.x`/`position.y`, so passing `{ x: lng, y: lat }` as the position works unchanged.

Create `components/maps/WorldMapViewer.tsx`:
```tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarkerFormDialog } from "@/components/maps/MarkerFormDialog";
import { useCampaignStore } from "@/lib/store/campaign-store";
import type { ResolvedMarker } from "@/components/maps/map-types";

const WorldMapCanvas = dynamic(
  () => import("@/components/maps/WorldMapCanvas").then((m) => m.WorldMapCanvas),
  { ssr: false }
);

const ENTITY_PATH: Record<string, string> = { character: "characters", location: "locations", faction: "factions" };
const THEME_KEY = "worldMapTheme";

interface ThemeOption {
  id: string;
  label: string;
}

export function WorldMapViewer() {
  const { activeCampaignId } = useCampaignStore();
  const [worldMapId, setWorldMapId] = useState<string | null>(null);
  const [markers, setMarkers] = useState<ResolvedMarker[]>([]);
  const [themes, setThemes] = useState<ThemeOption[]>([]);
  const [theme, setTheme] = useState<string>("classic");
  const [loading, setLoading] = useState(true);
  const [addMode, setAddMode] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<ResolvedMarker | null>(null);
  const [viewZoom, setViewZoom] = useState<number | undefined>(undefined);

  const loadMarkers = useCallback(async (mapId: string) => {
    const res = await fetch(`/api/maps/${mapId}/markers`);
    if (res.ok) setMarkers(await res.json());
  }, []);

  // Theme list + persisted choice.
  useEffect(() => {
    fetch("/api/world/styles/themes.json")
      .then((r) => (r.ok ? r.json() : { themes: [] }))
      .then((d: { themes: ThemeOption[] }) => setThemes(d.themes));
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(THEME_KEY) : null;
    if (saved) setTheme(saved);
  }, []);

  // Get-or-create the world map for the active campaign, then load markers.
  useEffect(() => {
    if (!activeCampaignId) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/world?campaignId=${activeCampaignId}`)
      .then((r) => r.json())
      .then(async (map: { id: string }) => {
        if (cancelled) return;
        setWorldMapId(map.id);
        await loadMarkers(map.id);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [activeCampaignId, loadMarkers]);

  function changeTheme(id: string) {
    setTheme(id);
    window.localStorage.setItem(THEME_KEY, id);
  }

  function handleMapClick(lngLat: { lng: number; lat: number }) {
    setPending({ x: lngLat.lng, y: lngLat.lat });
    setAddMode(false);
  }

  function handleMarkerDragEnd(markerId: string, lngLat: { lng: number; lat: number }) {
    setMarkers((prev) => prev.map((m) => (m.id === markerId ? { ...m, x: lngLat.lng, y: lngLat.lat } : m)));
    fetch(`/api/maps/markers/${markerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: lngLat.lng, y: lngLat.lat }),
    });
  }

  const selectedMarker = markers.find((m) => m.id === selectedId) ?? null;

  if (!activeCampaignId) {
    return <div className="flex items-center justify-center h-full text-muted-foreground">Select a campaign first.</div>;
  }
  if (loading || !worldMapId) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border flex-none">
        <span className="font-medium text-sm">Exandria — World Map</span>
        <div className="flex items-center gap-2 flex-none">
          <select
            value={theme}
            onChange={(e) => changeTheme(e.target.value)}
            className="text-xs bg-muted border border-border rounded-md px-2 py-1"
            title="Map theme"
          >
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant={addMode ? "initiative" : "outline"}
            onClick={() => setAddMode((v) => !v)}
            className="gap-1.5"
          >
            {addMode ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {addMode ? "Cancel" : "Add Marker"}
          </Button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <WorldMapCanvas
          theme={theme}
          markers={markers}
          selectedId={selectedId}
          addMode={addMode}
          onMapClick={handleMapClick}
          onMarkerClick={(m) => setSelectedId(m.id === selectedId ? null : m.id)}
          onMarkerDragEnd={handleMarkerDragEnd}
          onZoomChange={setViewZoom}
        />

        {selectedMarker && (
          <div className="absolute top-4 left-4 w-64 rounded-lg border border-border bg-card p-3 shadow-xl space-y-2 z-[1000]">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium text-sm">{selectedMarker.resolvedTitle}</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">{selectedMarker.type}</div>
              </div>
              <button onClick={() => setSelectedId(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {selectedMarker.type === "note" && selectedMarker.note && (
              <p className="text-sm text-muted-foreground">{selectedMarker.note}</p>
            )}
            {selectedMarker.resolvedSubtitle && <p className="text-xs text-destructive">{selectedMarker.resolvedSubtitle}</p>}
            <div className="flex gap-2 pt-1">
              {ENTITY_PATH[selectedMarker.type] && selectedMarker.entityId && (
                <Link
                  href={`/${ENTITY_PATH[selectedMarker.type]}/${selectedMarker.entityId}`}
                  className="text-xs text-primary hover:underline"
                >
                  View {selectedMarker.type} →
                </Link>
              )}
              <button
                onClick={() => {
                  setEditing(selectedMarker);
                  setSelectedId(null);
                }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Edit
              </button>
              <button
                onClick={async () => {
                  await fetch(`/api/maps/markers/${selectedMarker.id}`, { method: "DELETE" });
                  setSelectedId(null);
                  loadMarkers(worldMapId);
                }}
                className="text-xs text-destructive hover:underline"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>

      {(pending || editing) && (
        <MarkerFormDialog
          mapId={worldMapId}
          campaignId={activeCampaignId}
          position={pending}
          marker={editing}
          currentZoom={viewZoom}
          onClose={() => {
            setPending(null);
            setEditing(null);
          }}
          onSaved={() => {
            setPending(null);
            setEditing(null);
            loadMarkers(worldMapId);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run build`
Expected: succeeds. (`MarkerFormDialog`'s props — `mapId`, `campaignId`, `position`, `marker`, `currentZoom`, `onClose`, `onSaved` — match; it posts `position.x`/`position.y`, which for the world map are lng/lat.)

- [ ] **Step 3: Commit**

```bash
git add components/maps/WorldMapViewer.tsx
git commit -m "feat: add WorldMapViewer shell with marker overlay + theme toggle"
```

---

### Task 8: The `/world` route + "World" nav item

**Files:**
- Create: `app/world/page.tsx`
- Modify: `components/shell/TopBar.tsx:6,12-19`

- [ ] **Step 1: Create the route**

Create `app/world/page.tsx`:
```tsx
import { WorldMapViewer } from "@/components/maps/WorldMapViewer";

export default function WorldPage() {
  return (
    <div className="h-[calc(100vh-3rem)]">
      <WorldMapViewer />
    </div>
  );
}
```
(The `h-[calc(100vh-3rem)]` accounts for the 3rem/`h-12` top bar so the map fills the viewport, matching how `/maps/[id]` renders full-height.)

- [ ] **Step 2: Add the "World" nav item**

In `components/shell/TopBar.tsx`, add `Globe` to the lucide import on line 6:
```tsx
import { Swords, Users, MapPin, Package, Shield, Command, Settings, Map, Globe } from "lucide-react";
```
Then add a `World` entry to the `SECTIONS` array (before the `Maps` entry so the overworld sits next to the map library):
```tsx
const SECTIONS = [
  { href: "/encounters", label: "Encounters", icon: Swords },
  { href: "/characters", label: "Characters", icon: Users },
  { href: "/locations", label: "Locations", icon: MapPin },
  { href: "/items", label: "Items", icon: Package },
  { href: "/factions", label: "Factions", icon: Shield },
  { href: "/world", label: "World", icon: Globe },
  { href: "/maps", label: "Maps", icon: Map },
];
```

- [ ] **Step 3: Verify types compile**

Run: `npm run build`
Expected: succeeds; `/world` appears in the route list.

- [ ] **Step 4: Commit**

```bash
git add app/world/page.tsx components/shell/TopBar.tsx
git commit -m "feat: add /world route + World nav item"
```

---

### Task 9: "View on Map" back-links point at the world map (optional reuse check)

**Files:**
- Read-only verification (no code unless a gap is found)

- [ ] **Step 1: Confirm entity "View on Map" links still resolve**

The existing entity detail pages link back to markers via a `#marker-<id>` hash on `/maps/<mapId>`. World-map markers live on the `renderMode: 'world'` record, whose viewer is `/world`, not `/maps/<id>`. Grep for where those back-links are built:
```bash
grep -rn "marker-" app components | grep -v node_modules
```
Expected: this surfaces the reverse-lookup that builds `/maps/<mapId>#marker-<id>` links. **If** a world-map marker would produce a `/maps/<world-map-id>#...` link (which would 404 or mis-render, since the world map has no `/maps/[id]` image viewer), that is a real gap — note it. For v1 this is acceptable to leave as a known limitation IF the reverse-lookup only runs for uploaded maps; record what you find in the task report. Do not change behavior in this task unless the grep shows world markers actively producing broken links — if so, the minimal fix is to route `renderMode === 'world'` markers' back-links to `/world` instead, which can be folded into Plan 3.

- [ ] **Step 2: Commit only if a change was required**

If no change: no commit (this is a verification checkpoint). If a change was required, commit it with a clear message describing the fix.

---

### Task 10: End-to-end smoke test

**Files:** none (manual browser verification)

- [ ] **Step 1: Ensure artifacts are present + start the dev server**

```bash
ls world-data/build/exandria.pmtiles world-data/build/styles/classic.json  # regenerate via scripts/world/* if missing
npm run dev
```

- [ ] **Step 2: Open the world map**

In the browser, click the new **World** nav item (or go to `/world`).
Expected: Exandria renders (both continents, Classic theme), pannable and deep-zoomable with crisp vector labels — served entirely from the app's own `/api/world/...` routes (check the Network tab: `exandria.pmtiles` requests return `206`, glyph `.pbf` and `styles/classic.json` return `200`). No console errors.

- [ ] **Step 3: Switch themes**

Use the theme `<select>` in the header to switch to Vibrant, Antique, Dark, and back.
Expected: the map restyles in place (camera preserved). Reload the page — the last-selected theme persists (localStorage).

- [ ] **Step 4: Place, link, edit, drag, and delete a marker**

Click **Add Marker**, click a spot on the map (e.g. near Emon), and in the dialog create a Location-linked marker (or a Note if no Locations exist). Then:
- Click the marker → the info card shows its title/type and a working "View location →" link (for entity markers).
- Confirm the "Visible from zoom" control appeared in the dialog (world maps report zoom, so `currentZoom` is defined).
- Drag the marker → it moves; reload → it persists at the new spot (lng/lat saved).
- Edit → change the title, save → updates. Delete → it's gone after reload.

- [ ] **Step 5: Confirm per-campaign isolation**

Switch the active campaign (top-bar campaign selector) and open `/world` again.
Expected: a fresh Exandria world map with its own (empty or different) markers — the marker just placed does not appear under the other campaign. Switch back → the marker is still there.

- [ ] **Step 6: Final build check**

Run: `npm run build`
Expected: succeeds with no type errors.

---

## What this plan leaves for Plan 3

- **Retire the sub-project-6 World-Map mode:** remove the promote-a-tiled-map → World Map flow (`isWorldMap` promotion UI in `MapViewer` + the `PATCH /api/maps/[id]` `isWorldMap` branch/guard + the maps-list badge/sort), the Terra Draw drawing tool, the `map_features` table + CRUD + `FeatureFormDialog`, and the raster-Mercator `vtiles` route + `mercator-adapter`. Keep the uploaded static/tiled map viewers. Fold in the "View on Map" back-link routing for `renderMode: 'world'` markers if Task 9 flagged it.
