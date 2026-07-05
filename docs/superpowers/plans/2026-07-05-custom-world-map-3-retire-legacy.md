# Retire Legacy World-Map Mode (Sub-project 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the superseded sub-project-6 "World Map" mode (promote-a-tiled-map + Terra Draw drawing + `map_features` + raster `vtiles`/`mercator-adapter`) now that the real vector world map (`/world`) has shipped, and fix entity "View on Map" back-links so world-map markers deep-link to `/world` instead of the retired viewer.

**Architecture:** Sub-project 6 layered a MapLibre raster overlay (`VectorMapCanvas`) onto a promoted tiled map, with hand-drawn `map_features` (Terra Draw) served through a raster `vtiles` tile route and a hand-rolled Mercator adapter. All of that is dead weight now that `/world` renders true vector cartography. This plan deletes those files, strips the `isWorldMap` promotion flow from the map viewer/list/API, drops the `map_features` table and `isWorldMap` column from the schema/migrations, and prunes the now-unused `terra-draw*` dependencies — while leaving the uploaded static/tiled map viewers (`StaticMapCanvas`, `TiledMapCanvas`) and the shared marker system untouched. It then teaches the three entity detail APIs to report each marker's `renderMode` so the two "View on Map" consumers route `'world'` markers to `/world#marker-<id>`, and adds hash-based marker auto-select to `WorldMapViewer` (mirroring `MapViewer`).

**Tech Stack:** Next.js 16 (App Router) / React 19 / Drizzle ORM + better-sqlite3 / MapLibre GL. No test framework — verify with `npm run build` (type-check) plus targeted `grep` sweeps and a manual browser smoke test.

---

## Context every task needs

- **No test framework exists** in this codebase (established convention). "Verify it fails / passes" means running `npm run build` and/or a `grep` sweep, not a unit test.
- Run all commands from the worktree root: `/Users/zacharyauker/Development/encounter-tracker/.claude/worktrees/vigorous-hypatia-e1eb00`.
- **Keep intact:** `components/maps/StaticMapCanvas.tsx`, `components/maps/TiledMapCanvas.tsx`, `components/maps/WorldMapCanvas.tsx`, `components/maps/WorldMapViewer.tsx`, `components/maps/MarkerFormDialog.tsx`, `components/maps/MapMarkerPin.tsx`, the `maps`/`map_markers` tables, the `renderMode` enum value `'world'`, and everything under `/world` and `/api/world`.
- **The `renderMode` column stays** (`"static" | "tiled" | "world"`). Only `isWorldMap` and `map_features` go away.
- Shell note: paths containing `[id]` get glob-expanded by zsh. Quote them (e.g. `git rm "app/api/maps/[id]/features/route.ts"`) or the command will fail with "no matches found".

---

## File-by-file impact map

**Delete entirely (sub-project-6 only):**
- `components/maps/VectorMapCanvas.tsx` — raster+TerraDraw+features viewer, superseded by `WorldMapCanvas`.
- `components/maps/FeatureFormDialog.tsx` — region/road/label editor.
- `lib/maps/mercator-adapter.ts` — imported only by `VectorMapCanvas` + the `vtiles` route.
- `app/api/maps/[id]/vtiles/[z]/[x]/[y]/route.ts` — raster-Mercator tile route.
- `app/api/maps/[id]/features/route.ts` — `map_features` list/create.
- `app/api/maps/features/[featureId]/route.ts` — `map_features` update/delete.

**Modify:**
- `components/maps/MapViewer.tsx` — strip promotion + drawing + features; keep static/tiled + markers.
- `app/maps/page.tsx` — remove World Map badge + sort.
- `app/api/maps/[id]/route.ts` — revert PATCH to name-only.
- `components/maps/map-types.ts` — remove `FeatureType`, style types, `MapFeature*`, `MapFeatureData`, `isWorldMap`.
- `lib/db/schema.ts` — remove `mapFeatures` table + type exports + the `isWorldMap` column.
- `lib/db/migrate.ts` — remove `map_features` DDL + `is_world_map` column-add; add a `DROP TABLE IF EXISTS map_features` cleanup.
- `package.json` — remove `terra-draw` + `terra-draw-maplibre-gl-adapter`.
- `app/api/characters/[id]/route.ts`, `app/api/locations/[id]/route.ts`, `app/api/factions/[id]/route.ts` — add `renderMode` to resolved markers.
- `components/entities/CharacterFormDialog.tsx`, `components/glossary/SimpleEntityDetail.tsx`, `app/characters/[id]/page.tsx` — route `'world'` markers to `/world`.
- `components/maps/WorldMapViewer.tsx` — hash-based marker auto-select.

---

## Task 1: Strip promotion + drawing + features from `MapViewer.tsx`

Revert `MapViewer` to a static/tiled uploaded-map viewer with the marker overlay. Remove every reference to `VectorMapCanvas`, `FeatureFormDialog`, `isWorldMap`, `map_features`, Terra Draw, and drawing.

**Files:**
- Modify: `components/maps/MapViewer.tsx`

- [ ] **Step 1: Replace the entire file with the legacy-free version**

Overwrite `components/maps/MapViewer.tsx` with exactly:

```tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Plus, X, ChevronRight } from "lucide-react";
import { StaticMapCanvas } from "@/components/maps/StaticMapCanvas";
import { MarkerFormDialog } from "@/components/maps/MarkerFormDialog";
import { useCampaignStore } from "@/lib/store/campaign-store";
import type { MapData, ResolvedMarker } from "@/components/maps/map-types";

const TiledMapCanvas = dynamic(
  () => import("@/components/maps/TiledMapCanvas").then((mod) => mod.TiledMapCanvas),
  { ssr: false }
);

const ENTITY_PATH: Record<string, string> = { character: "characters", location: "locations", faction: "factions" };

export function MapViewer() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { activeCampaignId } = useCampaignStore();

  const [map, setMap] = useState<MapData | null>(null);
  const [markers, setMarkers] = useState<ResolvedMarker[]>([]);
  const [loading, setLoading] = useState(true);
  const [addMode, setAddMode] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const match = window.location.hash.match(/^#marker-(.+)$/);
    return match ? match[1] : null;
  });
  const [pendingPosition, setPendingPosition] = useState<{ x: number; y: number } | null>(null);
  const [editingMarker, setEditingMarker] = useState<ResolvedMarker | null>(null);
  const [viewZoom, setViewZoom] = useState<number | undefined>(undefined);

  const loadMarkers = useCallback(async () => {
    const res = await fetch(`/api/maps/${id}/markers`);
    if (res.ok) setMarkers(await res.json());
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const [mapRes] = await Promise.all([fetch(`/api/maps/${id}`), loadMarkers()]);
        if (cancelled) return;
        const mapData: MapData | null = mapRes.ok ? await mapRes.json() : null;
        setMap(mapData);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [id, loadMarkers]);

  function handleCanvasClick(pos: { x: number; y: number }) {
    setPendingPosition(pos);
    setAddMode(false);
  }

  function handleMarkerClick(marker: ResolvedMarker) {
    if (marker.type === "submap" && marker.targetMapId) {
      router.push(`/maps/${marker.targetMapId}`);
      return;
    }
    setSelectedId(marker.id === selectedId ? null : marker.id);
  }

  function handleMarkerDragMove(markerId: string, pos: { x: number; y: number }) {
    setMarkers((prev) => prev.map((m) => (m.id === markerId ? { ...m, ...pos } : m)));
  }

  function handleMarkerDragEnd(markerId: string, pos: { x: number; y: number }) {
    fetch(`/api/maps/markers/${markerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pos),
    });
  }

  const selectedMarker = markers.find((m) => m.id === selectedId) ?? null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!map) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">Map not found.</p>
        <Button onClick={() => router.push("/maps")}>Back to Maps</Button>
      </div>
    );
  }

  const sharedCanvasProps = {
    map,
    markers,
    addMode,
    selectedId,
    onImageClick: handleCanvasClick,
    onMarkerClick: handleMarkerClick,
    onMarkerDragMove: handleMarkerDragMove,
    onMarkerDragEnd: handleMarkerDragEnd,
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border flex-none">
        <div className="flex items-center gap-1.5 text-sm min-w-0">
          <Link href="/maps" className="text-muted-foreground hover:text-foreground flex items-center gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" /> Maps
          </Link>
          {map.breadcrumb.map((b) => (
            <React.Fragment key={b.id}>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
              <Link href={`/maps/${b.id}`} className="text-muted-foreground hover:text-foreground truncate">
                {b.name}
              </Link>
            </React.Fragment>
          ))}
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="font-medium truncate">{map.name}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-none">
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
        {map.renderMode === "tiled" ? (
          <TiledMapCanvas {...sharedCanvasProps} onZoomChange={setViewZoom} />
        ) : (
          <StaticMapCanvas {...sharedCanvasProps} />
        )}

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
            {selectedMarker.resolvedSubtitle && (
              <p className="text-xs text-destructive">{selectedMarker.resolvedSubtitle}</p>
            )}
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
                  setEditingMarker(selectedMarker);
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
                  loadMarkers();
                }}
                className="text-xs text-destructive hover:underline"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>

      {(pendingPosition || editingMarker) && (
        <MarkerFormDialog
          mapId={map.id}
          campaignId={activeCampaignId ?? ""}
          position={pendingPosition}
          marker={editingMarker}
          currentZoom={map.renderMode === "tiled" ? viewZoom : undefined}
          onClose={() => {
            setPendingPosition(null);
            setEditingMarker(null);
          }}
          onSaved={() => {
            setPendingPosition(null);
            setEditingMarker(null);
            loadMarkers();
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify no legacy references remain in the file**

Run: `grep -nE "isWorldMap|VectorMapCanvas|FeatureFormDialog|drawMode|features|promot|MapFeature|FeatureType|terra" components/maps/MapViewer.tsx`
Expected: no output (exit 1).

- [ ] **Step 3: Commit**

```bash
git add components/maps/MapViewer.tsx
git commit -m "refactor: strip legacy World Map promotion + drawing from MapViewer"
```

---

## Task 2: Remove the World Map badge + sort from the maps list

**Files:**
- Modify: `app/maps/page.tsx`

- [ ] **Step 1: Overwrite `app/maps/page.tsx`**

Overwrite with exactly:

```tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Map as MapIcon, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UploadMapDialog } from "@/components/maps/UploadMapDialog";
import { useCampaignStore } from "@/lib/store/campaign-store";

interface MapListItem {
  id: string;
  name: string;
}

export default function MapsPage() {
  const { activeCampaignId } = useCampaignStore();
  const [maps, setMaps] = useState<MapListItem[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = useCallback(() => {
    if (!activeCampaignId) return;
    fetch(`/api/maps?campaignId=${activeCampaignId}`).then((res) => {
      if (res.ok) res.json().then(setMaps);
    });
  }, [activeCampaignId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <MapIcon className="w-5 h-5 text-muted-foreground" /> Maps
        </h1>
        <Button size="sm" onClick={() => setUploadOpen(true)} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Upload Map
        </Button>
      </div>

      {maps.length === 0 && <p className="text-sm text-muted-foreground">No maps yet. Upload one to get started.</p>}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {maps.map((m) => (
          <Link
            key={m.id}
            href={`/maps/${m.id}`}
            className="group rounded-xl border border-border bg-card overflow-hidden hover:border-primary/50 transition-colors relative"
          >
            <div className="aspect-video bg-muted overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element -- locally-served map thumbnail */}
              <img
                src={`/api/maps/${m.id}/image`}
                alt={m.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
              />
            </div>
            <div className="px-3 py-2 text-sm font-medium truncate">{m.name}</div>
          </Link>
        ))}
      </div>

      <UploadMapDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        campaignId={activeCampaignId ?? ""}
        onUploaded={load}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `grep -nE "isWorldMap|Badge|Globe|sortedMaps" app/maps/page.tsx`
Expected: no output (exit 1).

- [ ] **Step 3: Commit**

```bash
git add app/maps/page.tsx
git commit -m "refactor: remove World Map badge and sort from maps list"
```

---

## Task 3: Revert the map detail PATCH to name-only

Remove the `isWorldMap` guard and the promotion transaction; the PATCH endpoint only renames a map now.

**Files:**
- Modify: `app/api/maps/[id]/route.ts`

- [ ] **Step 1: Replace the `PATCH` handler**

In `app/api/maps/[id]/route.ts`, replace the entire `PATCH` function (currently lines 24–58) with:

```ts
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const existing = await db.query.maps.findFirst({ where: eq(maps.id, id) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db
    .update(maps)
    .set({ name: body.name ?? existing.name, updatedAt: new Date() })
    .where(eq(maps.id, id));

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Remove the now-unused `and` import**

The file's line 4 imports `{ eq, and }`. `and` was only used by the deleted promotion branch. Change line 4 from:

```ts
import { eq, and } from "drizzle-orm";
```

to:

```ts
import { eq } from "drizzle-orm";
```

- [ ] **Step 3: Verify**

Run: `grep -nE "isWorldMap|transaction|\band\b" app/api/maps/[id]/route.ts` (quote the path if your shell glob-expands it: `grep -nE "isWorldMap|transaction" "app/api/maps/[id]/route.ts"`)
Expected: no `isWorldMap` / `transaction` matches.

- [ ] **Step 4: Commit**

```bash
git add "app/api/maps/[id]/route.ts"
git commit -m "refactor: revert map PATCH to name-only, drop World Map promotion"
```

---

## Task 4: Delete the legacy route + component + adapter files

These files are only reachable through the sub-project-6 flow removed in Tasks 1–3.

**Files:**
- Delete: `components/maps/VectorMapCanvas.tsx`
- Delete: `components/maps/FeatureFormDialog.tsx`
- Delete: `lib/maps/mercator-adapter.ts`
- Delete: `app/api/maps/[id]/vtiles/[z]/[x]/[y]/route.ts`
- Delete: `app/api/maps/[id]/features/route.ts`
- Delete: `app/api/maps/features/[featureId]/route.ts`

- [ ] **Step 1: Remove the files (git rm)**

```bash
git rm "components/maps/VectorMapCanvas.tsx" \
       "components/maps/FeatureFormDialog.tsx" \
       "lib/maps/mercator-adapter.ts" \
       "app/api/maps/[id]/vtiles/[z]/[x]/[y]/route.ts" \
       "app/api/maps/[id]/features/route.ts" \
       "app/api/maps/features/[featureId]/route.ts"
```

- [ ] **Step 2: Remove the now-empty leftover directories**

```bash
rmdir "app/api/maps/[id]/vtiles/[z]/[x]/[y]" "app/api/maps/[id]/vtiles/[z]/[x]" "app/api/maps/[id]/vtiles/[z]" "app/api/maps/[id]/vtiles" 2>/dev/null
rmdir "app/api/maps/[id]/features" "app/api/maps/features/[featureId]" "app/api/maps/features" 2>/dev/null
true
```

(The `2>/dev/null` + trailing `true` keep this from failing if a directory is already gone or non-empty.)

- [ ] **Step 3: Verify no source still imports the deleted modules**

Run: `grep -rnE "VectorMapCanvas|FeatureFormDialog|mercator-adapter|/vtiles|/features" app components lib --include="*.ts" --include="*.tsx"`
Expected: no output (exit 1). If anything matches, it's a dangling import — fix it before committing.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: delete legacy vector-map canvas, feature dialog, vtiles + features routes, mercator adapter"
```

---

## Task 5: Remove `mapFeatures` + `isWorldMap` from the schema and shared types

**Files:**
- Modify: `lib/db/schema.ts`
- Modify: `components/maps/map-types.ts`

- [ ] **Step 1: Drop the `isWorldMap` column from the `maps` table**

In `lib/db/schema.ts`, delete this line (currently line 148):

```ts
  isWorldMap: integer("is_world_map", { mode: "boolean" }).notNull().default(false),
```

- [ ] **Step 2: Drop the `mapFeatures` table definition**

In `lib/db/schema.ts`, delete the entire `mapFeatures` table block (currently lines 168–178):

```ts
export const mapFeatures = sqliteTable("map_features", {
  id: text("id").primaryKey(),
  mapId: text("map_id").notNull().references(() => maps.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["region", "road", "label"] }).notNull(),
  name: text("name"),
  geometry: text("geometry").notNull(),
  style: text("style").notNull().default("{}"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
```

- [ ] **Step 3: Drop the `mapFeatures` type exports**

In `lib/db/schema.ts`, delete these two lines (currently lines 201–202):

```ts
export type MapFeature = typeof mapFeatures.$inferSelect;
export type NewMapFeature = typeof mapFeatures.$inferInsert;
```

- [ ] **Step 4: Confirm `integer` is still used elsewhere in schema.ts**

Removing the `isWorldMap` column removed one `integer(...)` call. Verify the `integer` import is still needed (many other columns use it):

Run: `grep -c "integer(" lib/db/schema.ts`
Expected: a number ≥ 1 (do NOT remove the `integer` import).

- [ ] **Step 5: Strip feature types + `isWorldMap` from `map-types.ts`**

Overwrite `components/maps/map-types.ts` with exactly:

```ts
export type MarkerType = "location" | "faction" | "character" | "submap" | "note";

export interface MarkerData {
  id: string;
  mapId: string;
  x: number;
  y: number;
  type: MarkerType;
  entityId: string | null;
  targetMapId: string | null;
  title: string | null;
  note: string | null;
  minZoom: number | null;
}

export interface ResolvedMarker extends MarkerData {
  resolvedTitle: string;
  resolvedSubtitle: string | null;
}

export interface MapData {
  id: string;
  name: string;
  imagePath: string;
  parentMapId: string | null;
  breadcrumb: { id: string; name: string }[];
  renderMode: "static" | "tiled" | "world";
  width: number | null;
  height: number | null;
  maxZoom: number | null;
}

export interface MapCanvasProps {
  map: MapData;
  markers: ResolvedMarker[];
  addMode: boolean;
  selectedId: string | null;
  onImageClick: (pos: { x: number; y: number }) => void;
  onMarkerClick: (marker: ResolvedMarker) => void;
  onMarkerDragMove: (markerId: string, pos: { x: number; y: number }) => void;
  onMarkerDragEnd: (markerId: string, pos: { x: number; y: number }) => void;
  onZoomChange?: (zoom: number) => void;
}
```

- [ ] **Step 6: Verify no source references the removed symbols**

Run: `grep -rnE "mapFeatures|MapFeatureData|\bFeatureType\b|RegionStyle|RoadStyle|LabelStyle|isWorldMap|MapFeatureRegion|MapFeatureRoad|MapFeatureLabel" app components lib --include="*.ts" --include="*.tsx"`
Expected: no output (exit 1). (`migrate.ts` still references `map_features` as a raw SQL string — that's handled in Task 6 and won't match these identifiers.)

- [ ] **Step 7: Commit**

```bash
git add lib/db/schema.ts components/maps/map-types.ts
git commit -m "refactor: remove map_features table and isWorldMap from schema and types"
```

---

## Task 6: Update the migration runner

Stop creating `map_features` and the `is_world_map` column on fresh databases, and drop the orphaned `map_features` table on existing ones. Leave the `is_world_map` column in place on existing DBs — SQLite `DROP COLUMN` support varies by bundled version and the orphan column is harmless (nothing reads it).

**Files:**
- Modify: `lib/db/migrate.ts`

- [ ] **Step 1: Read the current `map_features` DDL block**

Run: `sed -n '160,200p' lib/db/migrate.ts`
Confirm it contains a `CREATE TABLE IF NOT EXISTS map_features (...)` statement (around line 167), a `CREATE INDEX IF NOT EXISTS idx_map_features_map ON map_features(map_id);` (around line 181), and an `addColumnIfMissing("maps", "is_world_map", "INTEGER NOT NULL DEFAULT 0");` (around line 199).

- [ ] **Step 2: Delete the `map_features` CREATE TABLE + its index**

Remove the `CREATE TABLE IF NOT EXISTS map_features ( ... );` statement and the `CREATE INDEX IF NOT EXISTS idx_map_features_map ON map_features(map_id);` line from the migration SQL. (These live inside the batch of `CREATE TABLE` statements; delete only the `map_features` table statement and its index line, leaving `maps` and `map_markers` intact.)

- [ ] **Step 3: Delete the `is_world_map` column-add**

Remove this line (currently line 199):

```ts
  addColumnIfMissing("maps", "is_world_map", "INTEGER NOT NULL DEFAULT 0");
```

- [ ] **Step 4: Add a cleanup drop for existing databases**

Immediately after the last `addColumnIfMissing(...)` call in the file, add:

```ts
  // Sub-project 6 retired: drop the abandoned map_features table if a prior
  // version created it. The orphaned maps.is_world_map column is left in place
  // (harmless; unread) because SQLite DROP COLUMN support is version-dependent.
  db.run(sql`DROP TABLE IF EXISTS map_features`);
```

If `sql` is not already imported in `migrate.ts`, and the existing code runs raw SQL a different way (e.g. `db.$client.exec(...)` or a `run(...)` helper), match the file's established pattern instead of introducing `sql`. Check first:

Run: `grep -nE "^import|db\.run|\.exec\(|import.*sql" lib/db/migrate.ts`
Use whichever raw-SQL mechanism the file already uses to issue `DROP TABLE IF EXISTS map_features`.

- [ ] **Step 5: Verify**

Run: `grep -nE "is_world_map|CREATE TABLE IF NOT EXISTS map_features|idx_map_features" lib/db/migrate.ts`
Expected: no output (exit 1).
Run: `grep -n "DROP TABLE IF EXISTS map_features" lib/db/migrate.ts`
Expected: one match.

- [ ] **Step 6: Commit**

```bash
git add lib/db/migrate.ts
git commit -m "refactor: stop creating map_features/is_world_map, drop stale map_features table"
```

---

## Task 7: Prune the unused Terra Draw dependencies

`terra-draw` and `terra-draw-maplibre-gl-adapter` were imported only by the now-deleted `VectorMapCanvas.tsx`.

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Confirm nothing imports terra-draw anymore**

Run: `grep -rn "terra-draw" app components lib --include="*.ts" --include="*.tsx"`
Expected: no output (exit 1). If anything matches, stop — a dangling import must be fixed first.

- [ ] **Step 2: Remove the two dependency lines from `package.json`**

Delete these two lines from the `"dependencies"` block:

```json
    "terra-draw": "^1.31.2",
    "terra-draw-maplibre-gl-adapter": "^1.4.1",
```

Leave `maplibre-gl`, `pmtiles`, `leaflet`, `react-leaflet`, and `react-zoom-pan-pinch` — all still used by the surviving viewers.

- [ ] **Step 3: Refresh the lockfile**

Run: `npm install`
Expected: completes without error; `package-lock.json` is updated to drop the two packages.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove unused terra-draw dependencies"
```

---

## Task 8: Report each marker's `renderMode` from the entity detail APIs

So the "View on Map" consumers can tell a world marker from an uploaded-map marker.

**Files:**
- Modify: `app/api/characters/[id]/route.ts`
- Modify: `app/api/locations/[id]/route.ts`
- Modify: `app/api/factions/[id]/route.ts`

- [ ] **Step 1: Add `renderMode` to the resolved marker in the characters route**

In `app/api/characters/[id]/route.ts`, find (around line 21):

```ts
      const map = await db.query.maps.findFirst({ where: eq(maps.id, link.mapId) });
      return { mapId: link.mapId, mapName: map?.name ?? "Unknown map", markerId: link.id };
```

Replace the `return` line with:

```ts
      return {
        mapId: link.mapId,
        mapName: map?.name ?? "Unknown map",
        markerId: link.id,
        renderMode: map?.renderMode ?? "static",
      };
```

- [ ] **Step 2: Apply the identical change to the locations route**

In `app/api/locations/[id]/route.ts`, the same two lines appear (around lines 26–27). Replace the `return` line the same way:

```ts
      return {
        mapId: link.mapId,
        mapName: map?.name ?? "Unknown map",
        markerId: link.id,
        renderMode: map?.renderMode ?? "static",
      };
```

- [ ] **Step 3: Apply the identical change to the factions route**

In `app/api/factions/[id]/route.ts`, same two lines (around lines 26–27). Replace the `return` line the same way:

```ts
      return {
        mapId: link.mapId,
        mapName: map?.name ?? "Unknown map",
        markerId: link.id,
        renderMode: map?.renderMode ?? "static",
      };
```

- [ ] **Step 4: Verify all three now emit `renderMode`**

Run: `grep -rn "renderMode: map?.renderMode" "app/api/characters/[id]/route.ts" "app/api/locations/[id]/route.ts" "app/api/factions/[id]/route.ts"`
Expected: three matches, one per file.

- [ ] **Step 5: Commit**

```bash
git add "app/api/characters/[id]/route.ts" "app/api/locations/[id]/route.ts" "app/api/factions/[id]/route.ts"
git commit -m "feat: include marker renderMode in entity detail marker links"
```

---

## Task 9: Route world markers to `/world` + auto-select on arrival

Update both "View on Map" consumers to deep-link `'world'` markers to `/world#marker-<id>`, and add hash-based auto-select to `WorldMapViewer` so the target marker opens on load (mirroring `MapViewer`).

**Files:**
- Modify: `components/entities/CharacterFormDialog.tsx` (the `CharacterWithLinks` type)
- Modify: `app/characters/[id]/page.tsx` (the character-detail link)
- Modify: `components/glossary/SimpleEntityDetail.tsx` (type + link, used by locations & factions)
- Modify: `components/maps/WorldMapViewer.tsx` (hash auto-select)

- [ ] **Step 1: Widen the `CharacterWithLinks.mapMarkers` type**

In `components/entities/CharacterFormDialog.tsx`, find (line 20):

```ts
  mapMarkers: { mapId: string; mapName: string; markerId: string }[];
```

Replace with:

```ts
  mapMarkers: { mapId: string; mapName: string; markerId: string; renderMode: "static" | "tiled" | "world" }[];
```

- [ ] **Step 2: Route world markers in the character detail page**

In `app/characters/[id]/page.tsx`, find (line 227):

```tsx
                    href={`/maps/${m.mapId}#marker-${m.markerId}`}
```

Replace with:

```tsx
                    href={m.renderMode === "world" ? `/world#marker-${m.markerId}` : `/maps/${m.mapId}#marker-${m.markerId}`}
```

- [ ] **Step 3: Widen the `SimpleEntityDetail` mapMarkers type and route world markers**

In `components/glossary/SimpleEntityDetail.tsx`, find (line 21):

```ts
  mapMarkers?: { mapId: string; mapName: string; markerId: string }[];
```

Replace with:

```ts
  mapMarkers?: { mapId: string; mapName: string; markerId: string; renderMode: "static" | "tiled" | "world" }[];
```

Then find (line 158):

```tsx
                    href={`/maps/${m.mapId}#marker-${m.markerId}`}
```

Replace with:

```tsx
                    href={m.renderMode === "world" ? `/world#marker-${m.markerId}` : `/maps/${m.mapId}#marker-${m.markerId}`}
```

- [ ] **Step 4: Add hash-based marker auto-select to `WorldMapViewer`**

In `components/maps/WorldMapViewer.tsx`, find (line 34):

```tsx
  const [selectedId, setSelectedId] = useState<string | null>(null);
```

Replace with:

```tsx
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const match = window.location.hash.match(/^#marker-(.+)$/);
    return match ? match[1] : null;
  });
```

- [ ] **Step 5: Verify the routing + auto-select changes are in place**

Run: `grep -rn "renderMode === \"world\" ? \`/world#marker" app/characters components/glossary`
Expected: two matches (character page + SimpleEntityDetail).
Run: `grep -n "match(/^#marker-" components/maps/WorldMapViewer.tsx`
Expected: one match.

- [ ] **Step 6: Commit**

```bash
git add components/entities/CharacterFormDialog.tsx app/characters/[id]/page.tsx components/glossary/SimpleEntityDetail.tsx components/maps/WorldMapViewer.tsx
git commit -m "feat: route world-map markers to /world with hash auto-select"
```

---

## Task 10: Full-build verification + manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Type-check / build the whole app**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors. In particular, no "Cannot find module" for the deleted files, no "Property 'isWorldMap' does not exist", and no "Property 'renderMode' does not exist on type" errors from the marker link sites.

- [ ] **Step 2: Final dead-reference sweep**

Run: `grep -rnE "isWorldMap|mapFeatures|map_features|MapFeatureData|VectorMapCanvas|FeatureFormDialog|mercator-adapter|terra-draw|/vtiles" app components lib --include="*.ts" --include="*.tsx"`
Expected: no output (exit 1). Any match is a leftover reference — fix it.

- [ ] **Step 3: Manual browser smoke test**

Start the dev server (via the preview tooling) and confirm:
- `/maps` lists uploaded maps with no "World Map" badge and no promotion button on any map's detail page.
- Opening a static map and a tiled map both still render, and markers place / drag / open entity pages.
- `/world` still renders Exandria, the theme toggle works, and markers place / drag.
- On an entity that has a marker placed on `/world`, the "View on Map" / "On the Map" link points to `/world#marker-<id>` and, when clicked, opens `/world` with that marker's info card already selected.
- No console errors referencing the removed modules.

- [ ] **Step 4: Commit any smoke-test fixes**

If the smoke test surfaced a fix, commit it with a descriptive message. Otherwise, nothing to commit here.

---

## Self-Review (completed during authoring)

- **Spec coverage** (`docs/superpowers/specs/2026-07-05-custom-world-map-design.md` §"Retiring the superseded sub-project-6 mode"): *Remove* the promote-a-tiled-map flow (Tasks 1–3), Terra Draw drawing (Tasks 1, 4, 7), `map_features` table + CRUD + dialog (Tasks 4–6), raster `vtiles` route + `mercator-adapter` (Task 4). *Keep* `StaticMapCanvas`/`TiledMapCanvas` and the shared marker system (untouched by every task; explicitly listed under "Keep intact"). Plan-2 deferred gap (world-marker back-links) is Tasks 8–9. All covered.
- **Placeholder scan:** every code step shows complete code; no "TBD"/"add error handling"/"similar to Task N".
- **Type consistency:** `renderMode` is typed `"static" | "tiled" | "world"` everywhere it's added (Tasks 5, 9); the API supplies `map?.renderMode ?? "static"` (Task 8) which matches. `MapData` keeps `renderMode` and drops only `isWorldMap`, matching every consumer after Tasks 1–2. The `#marker-(.+)` regex in Task 9 matches the existing one in `MapViewer` (Task 1).
- **Ordering note:** Task 6's `DROP TABLE` uses the file's existing raw-SQL mechanism (Step 4 checks before assuming `sql`), avoiding an import mismatch.
