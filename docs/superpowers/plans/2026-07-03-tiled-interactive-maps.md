# Tiled Interactive Maps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second "tiled" map render mode (Leaflet + `L.CRS.Simple` + a `sharp`-generated tile pyramid) alongside the existing static-image map viewer, so large-scale maps get a smooth, deep-zoom, Google-Maps-like experience while small maps keep using today's viewer unchanged.

**Architecture:** `maps.renderMode` picks between two sibling canvas components (`StaticMapCanvas`, the existing viewer extracted as-is; `TiledMapCanvas`, new) that `MapViewer.tsx` renders behind a shared header/marker-dialog/info-card shell. Both canvases share one prop contract and the same `map_markers` data — this is a new rendering layer, not a new data model. Tiling happens synchronously inside the upload request via `sharp`'s built-in tile-pyramid generator.

**Tech Stack:** `sharp` (server-side tiling), `leaflet` + `react-leaflet` v5 (client-side tiled viewer), existing Next.js/Drizzle/SQLite stack — no other new dependencies.

**Verification convention for this project:** there is no test framework in this codebase (confirmed: no jest/vitest, no `*.test.*` files, `package.json` has no `test` script). Every prior sub-project in this plan series was verified via `npm run build` (type-checking) plus a manual smoke test through the browser, not automated tests. This plan follows that same established convention — each task ends with a build/type-check and, where relevant, a concrete manual check (curl or browser), not a written unit test.

---

### Task 1: Install dependencies, confirm Docker/Alpine compatibility

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install the new dependencies**

Run:
```bash
npm install sharp leaflet react-leaflet
npm install -D @types/leaflet
```
Expected: `package.json` gains `sharp`, `leaflet`, `react-leaflet` under `dependencies` and `@types/leaflet` under `devDependencies`.

- [ ] **Step 2: Verify the project still builds locally**

Run: `npm run build`
Expected: build succeeds (these packages aren't used anywhere yet, so this just confirms `npm install` didn't break anything).

- [ ] **Step 3: Confirm `sharp` installs cleanly in the project's Alpine-based Docker image**

This project deploys via `Dockerfile` (`node:22-alpine`, with `python3 make g++` already installed for native module builds). `sharp` ships prebuilt musl binaries for Alpine, but this must be confirmed before it's relied on elsewhere in this plan — an install failure here would block every later task.

Run: `docker build -t encounter-tracker-sharp-check .`
Expected: the build completes successfully through the `deps` stage (`npm install --prefer-offline`) with no errors related to `sharp` or `libvips`. If it fails, resolve it now (e.g. pinning a `sharp` version with confirmed musl prebuilds) before continuing — every later task in this plan depends on `sharp` working in production.

Clean up the test image afterward: `docker rmi encounter-tracker-sharp-check`

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add sharp, leaflet, react-leaflet dependencies"
```

---

### Task 2: Extend Drizzle schema

**Files:**
- Modify: `lib/db/schema.ts:138-160`

- [ ] **Step 1: Add the new columns**

Replace the `maps` and `mapMarkers` table definitions (`lib/db/schema.ts:138-160`) with:

```ts
export const maps = sqliteTable("maps", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  imagePath: text("image_path").notNull(),
  parentMapId: text("parent_map_id"),
  renderMode: text("render_mode", { enum: ["static", "tiled"] }).notNull().default("static"),
  width: integer("width"),
  height: integer("height"),
  maxZoom: integer("max_zoom"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const mapMarkers = sqliteTable("map_markers", {
  id: text("id").primaryKey(),
  mapId: text("map_id").notNull().references(() => maps.id, { onDelete: "cascade" }),
  x: real("x").notNull(),
  y: real("y").notNull(),
  type: text("type", { enum: ["location", "faction", "character", "submap", "note"] }).notNull(),
  entityId: text("entity_id"),
  targetMapId: text("target_map_id"),
  title: text("title"),
  note: text("note"),
  minZoom: integer("min_zoom"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
```

- [ ] **Step 2: Verify types compile**

Run: `npm run build`
Expected: succeeds. `MapRow`/`NewMapRow`/`MapMarker`/`NewMapMarker` (already exported at the bottom of `schema.ts` via `typeof maps.$inferSelect` etc.) automatically pick up the new fields — no changes needed to those export lines.

- [ ] **Step 3: Commit**

```bash
git add lib/db/schema.ts
git commit -m "feat: add renderMode/width/height/maxZoom to maps, minZoom to map_markers"
```

---

### Task 3: Extend the migration script

**Files:**
- Modify: `lib/db/migrate.ts:172-181`

- [ ] **Step 1: Add the new columns via the existing additive-migration helper**

In `lib/db/migrate.ts`, the `addColumnIfMissing` calls currently end at line 181 (`addColumnIfMissing("encounters", "campaign_id", ...)`). Add these four lines immediately after it, still before the "Ensure a default campaign exists" block:

```ts
  addColumnIfMissing("maps", "render_mode", "TEXT NOT NULL DEFAULT 'static'");
  addColumnIfMissing("maps", "width", "INTEGER");
  addColumnIfMissing("maps", "height", "INTEGER");
  addColumnIfMissing("maps", "max_zoom", "INTEGER");
  addColumnIfMissing("map_markers", "min_zoom", "INTEGER");
```

- [ ] **Step 2: Verify against the local dev database**

The simplest real check is to start the app once and let `instrumentation.ts` run migrations on boot, then inspect the schema directly:

```bash
npm run build
npm run start &
sleep 3
sqlite3 encounter-tracker.db ".schema maps" ".schema map_markers"
kill %1
```
Expected: `maps` shows `render_mode TEXT NOT NULL DEFAULT 'static'`, `width INTEGER`, `height INTEGER`, `max_zoom INTEGER`; `map_markers` shows `min_zoom INTEGER`. (If `sqlite3` isn't installed locally, open `encounter-tracker.db` with any SQLite browser instead — the point is confirming the columns landed with the right names/types on a real run, not trusting the SQL string by inspection alone.)

- [ ] **Step 3: Commit**

```bash
git add lib/db/migrate.ts
git commit -m "feat: migrate render_mode/width/height/max_zoom/min_zoom columns"
```

---

### Task 4: Tiled-map storage (sharp tiling)

**Files:**
- Modify: `lib/maps/storage.ts`

- [ ] **Step 1: Add the tiling, tile-read, and unified-delete functions**

Append to `lib/maps/storage.ts` (keep the existing `saveMapImage`/`readMapImage`/`mapImageContentType` functions unchanged — they still serve static maps exactly as before):

```ts
import sharp from "sharp";

const TILE_SIZE = 256;

export async function saveTiledMapAssets(
  mapId: string,
  file: File
): Promise<{ imagePath: string; width: number; height: number; maxZoom: number }> {
  const mapDir = path.join(MAPS_DIR, mapId);
  await fs.mkdir(mapDir, { recursive: true });

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const originalFilename = `original.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(mapDir, originalFilename), buffer);

  const metadata = await sharp(buffer).metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) {
    throw new Error("Could not read image dimensions");
  }

  const tilesDir = path.join(mapDir, "tiles");
  await sharp(buffer)
    .jpeg({ quality: 85 })
    .tile({ size: TILE_SIZE, layout: "google" })
    .toFile(tilesDir);

  const zoomDirs = await fs.readdir(tilesDir);
  const maxZoom = Math.max(
    ...zoomDirs.map((d) => parseInt(d, 10)).filter((n) => !Number.isNaN(n))
  );

  return { imagePath: `${mapId}/${originalFilename}`, width, height, maxZoom };
}

/** Throws ENOENT if the tile does not exist — callers must catch and handle it. */
export async function readMapTile(mapId: string, z: string, x: string, y: string): Promise<Buffer> {
  return fs.readFile(path.join(MAPS_DIR, mapId, "tiles", z, x, `${y}.jpeg`));
}

export async function deleteMapAssets(map: { id: string; imagePath: string; renderMode: string }): Promise<void> {
  if (map.renderMode === "tiled") {
    await fs.rm(path.join(MAPS_DIR, map.id), { recursive: true, force: true });
  } else {
    await deleteMapImage(map.imagePath);
  }
}
```

- [ ] **Step 2: Verify the real tile output structure against an actual image**

Sharp's exact on-disk output (directory layout, file extension) must be confirmed empirically rather than assumed. Run this one-off script against a real test image:

```bash
node -e "
const sharp = require('sharp');
const fs = require('fs');
sharp({ create: { width: 2000, height: 1500, channels: 3, background: { r: 100, g: 120, b: 200 } } })
  .jpeg()
  .toBuffer()
  .then((buf) => sharp(buf).jpeg({ quality: 85 }).tile({ size: 256, layout: 'google' }).toFile('/tmp/tile-check'))
  .then((info) => console.log(JSON.stringify(info, null, 2)));
"
find /tmp/tile-check -type f | head -20
```
Expected: `/tmp/tile-check/<z>/<x>/<y>.jpeg` files exist for `z` = `0` through some max value. If the actual extension or layout differs from `.jpeg` in nested `<z>/<x>/<y>` form, update `readMapTile`'s file path template in Step 1 to match what sharp actually produced, then re-run this check to confirm. Clean up: `rm -rf /tmp/tile-check`.

- [ ] **Step 3: Verify types compile**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add lib/maps/storage.ts
git commit -m "feat: add sharp-based tile pyramid generation to map storage layer"
```

---

### Task 5: Maps API — upload branches on render mode, delete cleans up tiles

**Files:**
- Modify: `app/api/maps/route.ts`
- Modify: `app/api/maps/[id]/route.ts`

- [ ] **Step 1: Update the POST handler**

Replace `app/api/maps/route.ts` in full:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { maps } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { saveMapImage, saveTiledMapAssets } from "@/lib/maps/storage";
import { eq, and, isNull, asc } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  const includeNested = searchParams.get("includeNested") === "true";

  if (!campaignId) {
    return NextResponse.json({ error: '"campaignId" is required' }, { status: 400 });
  }

  const rows = await db.query.maps.findMany({
    where: includeNested
      ? eq(maps.campaignId, campaignId)
      : and(eq(maps.campaignId, campaignId), isNull(maps.parentMapId)),
    orderBy: [asc(maps.name)],
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const form = await req.formData();
  const name = form.get("name");
  const campaignId = form.get("campaignId");
  const parentMapId = form.get("parentMapId");
  const renderModeField = form.get("renderMode");
  const file = form.get("image");

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: '"name" is required' }, { status: 400 });
  }
  if (typeof campaignId !== "string" || !campaignId) {
    return NextResponse.json({ error: '"campaignId" is required' }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: '"image" file is required' }, { status: 400 });
  }

  const isTiled = renderModeField === "tiled";
  const id = generateId();

  let imagePath: string;
  let width: number | null = null;
  let height: number | null = null;
  let maxZoom: number | null = null;

  if (isTiled) {
    const result = await saveTiledMapAssets(id, file);
    imagePath = result.imagePath;
    width = result.width;
    height = result.height;
    maxZoom = result.maxZoom;
  } else {
    imagePath = await saveMapImage(id, file);
  }

  const now = new Date();
  const [map] = await db
    .insert(maps)
    .values({
      id,
      campaignId,
      name: name.trim(),
      imagePath,
      parentMapId: typeof parentMapId === "string" && parentMapId ? parentMapId : null,
      renderMode: isTiled ? "tiled" : "static",
      width,
      height,
      maxZoom,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return NextResponse.json(map, { status: 201 });
}
```

- [ ] **Step 2: Update the DELETE handler to clean up tile directories**

In `app/api/maps/[id]/route.ts`, change the import on line 5 from:
```ts
import { deleteMapImage } from "@/lib/maps/storage";
```
to:
```ts
import { deleteMapAssets } from "@/lib/maps/storage";
```

And change line 54 (`await deleteMapImage(existing.imagePath);`) to:
```ts
  await deleteMapAssets(existing);
```

- [ ] **Step 3: Verify types compile**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Manual verification — upload a tiled map end to end**

```bash
npm run start &
sleep 3
curl -s -X POST http://localhost:3000/api/maps \
  -F "name=Tile Test" \
  -F "campaignId=<a real campaign id from your local DB>" \
  -F "renderMode=tiled" \
  -F "image=@/tmp/some-test-image.jpg"
```
Expected: JSON response with `renderMode: "tiled"`, non-null `width`/`height`/`maxZoom`. Then confirm on disk: `ls data/maps/<returned-id>/` shows `original.jpg` and a `tiles/` directory. Delete it via `curl -X DELETE http://localhost:3000/api/maps/<returned-id>` and confirm `data/maps/<returned-id>/` is gone entirely (`ls data/maps/<returned-id>` should error with "No such file or directory"). Stop the server: `kill %1`.

- [ ] **Step 5: Commit**

```bash
git add app/api/maps/route.ts "app/api/maps/[id]/route.ts"
git commit -m "feat: branch map upload on renderMode, clean up tile assets on delete"
```

---

### Task 6: Tile-serving API route

**Files:**
- Create: `app/api/maps/[id]/tiles/[z]/[x]/[y]/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { maps } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { readMapTile } from "@/lib/maps/storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; z: string; x: string; y: string }> }
) {
  const { id, z, x, y } = await params;
  const map = await db.query.maps.findFirst({ where: eq(maps.id, id) });
  if (!map || map.renderMode !== "tiled") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const yWithoutExt = y.replace(/\.\w+$/, "");

  let buffer: Buffer;
  try {
    buffer = await readMapTile(id, z, x, yWithoutExt);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
```

Note: the URL's `.jpg`-style suffix on the `y` segment is a cosmetic XYZ-tile-URL convention for the Leaflet tile layer (Task 12) — it's stripped here and doesn't need to match the real on-disk extension confirmed in Task 4.

- [ ] **Step 2: Verify types compile**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Manual verification against a real tiled map**

Using the tiled map ID from Task 5's Step 4 (or upload a fresh one):
```bash
npm run start &
sleep 3
curl -s -o /tmp/tile-0-0-0.jpg -w "%{http_code}\n" http://localhost:3000/api/maps/<mapId>/tiles/0/0/0.jpg
file /tmp/tile-0-0-0.jpg
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/maps/<mapId>/tiles/99/99/99.jpg
kill %1
```
Expected: first `curl` prints `200` and `file` reports a valid JPEG image; second `curl` (an out-of-range tile) prints `404`.

- [ ] **Step 4: Commit**

```bash
git add "app/api/maps/[id]/tiles/[z]/[x]/[y]/route.ts"
git commit -m "feat: serve generated map tiles via a dynamic route"
```

---

### Task 7: Markers API — persist `minZoom`

**Files:**
- Modify: `app/api/maps/[id]/markers/route.ts:58-75`
- Modify: `app/api/maps/markers/[markerId]/route.ts:18-30`

- [ ] **Step 1: Persist `minZoom` on create**

In `app/api/maps/[id]/markers/route.ts`, change the `.values({...})` block (lines 61-73) to:

```ts
    .values({
      id: generateId(),
      mapId: id,
      x: body.x,
      y: body.y,
      type: body.type,
      entityId: body.entityId ?? null,
      targetMapId: body.targetMapId ?? null,
      title: body.title ?? null,
      note: body.note ?? null,
      minZoom: typeof body.minZoom === "number" ? body.minZoom : null,
      createdAt: now,
      updatedAt: now,
    })
```

- [ ] **Step 2: Persist `minZoom` on update**

In `app/api/maps/markers/[markerId]/route.ts`, change the `.set({...})` block (lines 20-29) to:

```ts
    .set({
      x: typeof body.x === "number" ? body.x : existing.x,
      y: typeof body.y === "number" ? body.y : existing.y,
      type: body.type ?? existing.type,
      entityId: body.entityId !== undefined ? body.entityId : existing.entityId,
      targetMapId: body.targetMapId !== undefined ? body.targetMapId : existing.targetMapId,
      title: body.title !== undefined ? body.title : existing.title,
      note: body.note !== undefined ? body.note : existing.note,
      minZoom: body.minZoom !== undefined ? body.minZoom : existing.minZoom,
      updatedAt: new Date(),
    })
```

- [ ] **Step 3: Verify types compile**

Run: `npm run build`
Expected: succeeds. (The `GET` handler in `app/api/maps/[id]/markers/route.ts` needs no change — Drizzle's `findMany` already selects every column, so `minZoom` is included in its response automatically.)

- [ ] **Step 4: Commit**

```bash
git add "app/api/maps/[id]/markers/route.ts" "app/api/maps/markers/[markerId]/route.ts"
git commit -m "feat: persist marker minZoom on create and update"
```

---

### Task 8: Shared map types

**Files:**
- Create: `components/maps/map-types.ts`

- [ ] **Step 1: Write the shared types file**

This consolidates the type shapes currently duplicated/inline across `MapViewer.tsx` and `MarkerFormDialog.tsx`, so both existing files and the two new canvas components (Tasks 11-12) share one definition instead of drifting apart.

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
  renderMode: "static" | "tiled";
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

- [ ] **Step 2: Verify types compile**

Run: `npm run build`
Expected: succeeds (this file isn't imported anywhere yet, so this just confirms it's syntactically valid standalone TypeScript).

- [ ] **Step 3: Commit**

```bash
git add components/maps/map-types.ts
git commit -m "feat: add shared map/marker type definitions"
```

---

### Task 9: MarkerFormDialog — progressive-reveal control

**Files:**
- Modify: `components/maps/MarkerFormDialog.tsx`

- [ ] **Step 1: Replace the local type declarations with imports from `map-types.ts`**

Remove lines 9 (`type MarkerType = ...`) and lines 22-32 (`export interface MarkerData {...}`) from `components/maps/MarkerFormDialog.tsx`. Add this import near the top, alongside the existing imports:

```ts
import type { MarkerType, MarkerData } from "@/components/maps/map-types";
export type { MarkerData };
```

The `export type { MarkerData }` re-export keeps `MapViewer.tsx`'s existing `import { MarkerFormDialog, type MarkerData } from "@/components/maps/MarkerFormDialog";` working unchanged (it gets updated properly in Task 13, but this re-export means nothing breaks in between).

- [ ] **Step 2: Add the `currentZoom` prop and `minZoom` state**

Change the props interface (currently lines 34-41) to add one field:

```ts
interface MarkerFormDialogProps {
  mapId: string;
  campaignId: string;
  position: { x: number; y: number } | null;
  marker: MarkerData | null;
  currentZoom?: number;
  onClose: () => void;
  onSaved: () => void;
}
```

Change the component signature and add `minZoom` state (currently line 51):

```ts
export function MarkerFormDialog({ mapId, campaignId, position, marker, currentZoom, onClose, onSaved }: MarkerFormDialogProps) {
  const [type, setType] = useState<MarkerType>(marker?.type ?? "note");
  const [entityId, setEntityId] = useState(marker?.entityId ?? "");
  const [targetMapId, setTargetMapId] = useState(marker?.targetMapId ?? "");
  const [title, setTitle] = useState(marker?.title ?? "");
  const [note, setNote] = useState(marker?.note ?? "");
  const [minZoom, setMinZoom] = useState<number | null>(marker?.minZoom ?? currentZoom ?? null);
```

- [ ] **Step 3: Include `minZoom` in the save payload**

In the `save()` function, change the `payload` object (currently lines 100-108) to add one field:

```ts
      const payload = {
        x: position?.x,
        y: position?.y,
        type,
        entityId: type === "character" || type === "location" || type === "faction" ? entityId || null : null,
        targetMapId: type === "submap" ? finalTargetMapId : null,
        title: title.trim() || null,
        note: type === "note" ? note.trim() || null : null,
        minZoom,
      };
```

- [ ] **Step 4: Add the UI control**

In the JSX, immediately before the final `<Input placeholder={type === "note" ? ...}>` element (currently lines 227-231), add:

```tsx
          {currentZoom !== undefined && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={minZoom === null}
                  onChange={(e) => setMinZoom(e.target.checked ? null : currentZoom)}
                />
                Always visible
              </label>
              {minZoom !== null && (
                <>
                  <span>Visible from zoom</span>
                  <input
                    type="number"
                    min={0}
                    value={minZoom}
                    onChange={(e) => setMinZoom(Number(e.target.value))}
                    className="w-14 rounded-md border border-border bg-muted px-1.5 py-1 text-xs"
                  />
                </>
              )}
            </div>
          )}
```

- [ ] **Step 5: Verify types compile**

Run: `npm run build`
Expected: fails at this point, specifically in `MapViewer.tsx` and `MapCanvasProps`-adjacent usages, since `MapViewer.tsx` doesn't pass `currentZoom` yet and still uses the old inline types — that's expected and gets fixed in Task 13. Confirm the *only* errors are in `components/maps/MapViewer.tsx` (nothing else) before proceeding.

- [ ] **Step 6: Commit**

```bash
git add components/maps/MarkerFormDialog.tsx
git commit -m "feat: add progressive-reveal zoom control to MarkerFormDialog"
```

---

### Task 10: UploadMapDialog — render mode picker

**Files:**
- Modify: `components/maps/UploadMapDialog.tsx`

- [ ] **Step 1: Replace the file in full**

```tsx
"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface UploadMapDialogProps {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  onUploaded: () => void;
}

export function UploadMapDialog({ open, onClose, campaignId, onUploaded }: UploadMapDialogProps) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [renderMode, setRenderMode] = useState<"static" | "tiled">("static");
  const [saving, setSaving] = useState(false);

  async function upload() {
    if (!name.trim() || !file || !campaignId) return;
    setSaving(true);
    try {
      const form = new FormData();
      form.append("name", name.trim());
      form.append("campaignId", campaignId);
      form.append("renderMode", renderMode);
      form.append("image", file);
      await fetch("/api/maps", { method: "POST", body: form });
      onUploaded();
      onClose();
      setName("");
      setFile(null);
      setRenderMode("static");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Map</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <Input autoFocus placeholder="Map name" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setRenderMode("static")}
              className={cn(
                "rounded-md border px-3 py-2 text-xs text-left transition-colors",
                renderMode === "static"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              <div className="font-medium">Standard</div>
              <div className="text-[11px] opacity-80">City layouts, dungeons, smaller images</div>
            </button>
            <button
              type="button"
              onClick={() => setRenderMode("tiled")}
              className={cn(
                "rounded-md border px-3 py-2 text-xs text-left transition-colors",
                renderMode === "tiled"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              <div className="font-medium">Large-scale interactive</div>
              <div className="text-[11px] opacity-80">Continent maps, deep zoom, upload may take a while</div>
            </button>
          </div>
          <input
            type="file"
            accept={renderMode === "tiled" ? "image/png,image/jpeg,image/webp" : "image/*"}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-xs text-muted-foreground"
          />
          <Button className="w-full" onClick={upload} disabled={saving || !name.trim() || !file}>
            {saving ? (renderMode === "tiled" ? "Generating tiles... this may take a minute" : "Uploading...") : "Upload"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/maps/UploadMapDialog.tsx
git commit -m "feat: add render mode picker to the map upload dialog"
```

---

### Task 11: Extract StaticMapCanvas from MapViewer

**Files:**
- Create: `components/maps/StaticMapCanvas.tsx`

This is a pure extraction — the existing pan/zoom canvas logic currently inside `MapViewer.tsx` moves out unchanged, just restructured to take props from a parent instead of owning top-level page state. `MapViewer.tsx` itself is rewired in Task 13, after `TiledMapCanvas` also exists.

- [ ] **Step 1: Write the extracted component**

```tsx
"use client";

import React, { useState, useRef } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { MapMarkerPin } from "@/components/maps/MapMarkerPin";
import type { MapCanvasProps } from "@/components/maps/map-types";

export function StaticMapCanvas({
  map,
  markers,
  addMode,
  selectedId,
  onImageClick,
  onMarkerClick,
  onMarkerDragMove,
  onMarkerDragEnd,
}: MapCanvasProps) {
  const [minScale, setMinScale] = useState(0.5);
  const draggingRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const viewport = viewportRef.current;
    const { naturalWidth, naturalHeight } = e.currentTarget;
    if (!viewport || !naturalWidth || !naturalHeight) return;
    const { width: viewportWidth, height: viewportHeight } = viewport.getBoundingClientRect();
    const fitScale = Math.min(viewportWidth / naturalWidth, viewportHeight / naturalHeight);
    setMinScale(Math.min(1, Math.max(0.05, fitScale)));
  }

  function handleContainerClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!addMode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onImageClick({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    });
  }

  function startDrag(markerId: string, e: React.PointerEvent) {
    e.stopPropagation();
    draggingRef.current = markerId;
    const container = containerRef.current;
    if (!container) return;

    function posFromEvent(ev: PointerEvent) {
      const rect = container!.getBoundingClientRect();
      return {
        x: Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height)),
      };
    }
    function onMove(ev: PointerEvent) {
      onMarkerDragMove(markerId, posFromEvent(ev));
    }
    function cleanup() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      draggingRef.current = null;
    }
    function onUp(ev: PointerEvent) {
      cleanup();
      onMarkerDragEnd(markerId, posFromEvent(ev));
    }
    function onCancel() {
      cleanup();
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  return (
    <div ref={viewportRef} className="relative flex-1 overflow-hidden bg-black/40">
      <TransformWrapper disabled={addMode} doubleClick={{ disabled: true }} minScale={minScale} maxScale={6}>
        <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-fit !h-fit">
          <div
            ref={containerRef}
            className="relative"
            style={{ cursor: addMode ? "crosshair" : "default" }}
            onClick={handleContainerClick}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- locally-served map image, arbitrary user-upload dimensions */}
            <img
              src={`/api/maps/${map.id}/image`}
              alt={map.name}
              onLoad={handleImageLoad}
              className="max-w-none select-none"
              draggable={false}
            />
            {markers.map((m) => (
              <div
                key={m.id}
                className="absolute -translate-x-1/2 -translate-y-full cursor-pointer"
                style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
                onPointerDown={(e) => startDrag(m.id, e)}
                onClick={(e) => {
                  e.stopPropagation();
                  onMarkerClick(m);
                }}
              >
                <MapMarkerPin type={m.type} selected={m.id === selectedId} />
              </div>
            ))}
          </div>
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run build`
Expected: succeeds (this file isn't imported by `MapViewer.tsx` yet — that happens in Task 13 — so `MapViewer.tsx`'s own errors from Task 9 are still expected here).

- [ ] **Step 3: Commit**

```bash
git add components/maps/StaticMapCanvas.tsx
git commit -m "refactor: extract StaticMapCanvas from MapViewer"
```

---

### Task 12: TiledMapCanvas — Leaflet viewer

**Files:**
- Create: `components/maps/TiledMapCanvas.tsx`

**Coordinate system note:** `L.CRS.Simple` treats coordinates as a flat plane, but Leaflet's internal "lat" axis increases *upward* while our stored `x`/`y` (and the image's own pixel grid) increases *downward*. Rather than hand-deriving a flip formula, this uses Leaflet's own `CRS.pointToLatLng(point, zoom)` / `CRS.latLngToPoint(latlng, zoom)` conversion helpers consistently in both directions — this is Leaflet's documented, standard approach for non-geographic ("game map") content and avoids an easy-to-get-wrong manual inversion.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import React, { useMemo, useCallback, useState } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { renderToStaticMarkup } from "react-dom/server";
import "leaflet/dist/leaflet.css";
import { MapMarkerPin } from "@/components/maps/MapMarkerPin";
import type { MapCanvasProps, ResolvedMarker } from "@/components/maps/map-types";

const CRS = L.CRS.Simple;

function markerIcon(type: ResolvedMarker["type"], selected: boolean) {
  return L.divIcon({
    className: "",
    html: renderToStaticMarkup(<MapMarkerPin type={type} selected={selected} />),
    iconSize: [28, 36],
    iconAnchor: [14, 36],
  });
}

function ClickHandler({
  addMode,
  onImageClick,
  width,
  height,
  maxZoom,
}: {
  addMode: boolean;
  onImageClick: (pos: { x: number; y: number }) => void;
  width: number;
  height: number;
  maxZoom: number;
}) {
  useMapEvents({
    click(e) {
      if (!addMode) return;
      const point = CRS.latLngToPoint(e.latlng, maxZoom);
      onImageClick({ x: point.x / width, y: point.y / height });
    },
  });
  return null;
}

function ZoomReporter({ onZoomChange }: { onZoomChange?: (zoom: number) => void }) {
  const map = useMap();
  useMapEvents({
    zoomend() {
      onZoomChange?.(map.getZoom());
    },
  });
  return null;
}

function MarkerWithReveal({
  marker,
  selected,
  position,
  onMarkerClick,
  onMarkerDragMove,
  onMarkerDragEnd,
  width,
  height,
  maxZoom,
}: {
  marker: ResolvedMarker;
  selected: boolean;
  position: L.LatLng;
  onMarkerClick: (marker: ResolvedMarker) => void;
  onMarkerDragMove: (markerId: string, pos: { x: number; y: number }) => void;
  onMarkerDragEnd: (markerId: string, pos: { x: number; y: number }) => void;
  width: number;
  height: number;
  maxZoom: number;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({
    zoomend() {
      setZoom(map.getZoom());
    },
  });

  if (marker.minZoom !== null && zoom < marker.minZoom) return null;

  return (
    <Marker
      position={position}
      icon={markerIcon(marker.type, selected)}
      draggable
      eventHandlers={{
        click: () => onMarkerClick(marker),
        drag: (e) => {
          const point = CRS.latLngToPoint((e.target as L.Marker).getLatLng(), maxZoom);
          onMarkerDragMove(marker.id, { x: point.x / width, y: point.y / height });
        },
        dragend: (e) => {
          const point = CRS.latLngToPoint((e.target as L.Marker).getLatLng(), maxZoom);
          onMarkerDragEnd(marker.id, { x: point.x / width, y: point.y / height });
        },
      }}
    />
  );
}

export function TiledMapCanvas({
  map,
  markers,
  addMode,
  selectedId,
  onImageClick,
  onMarkerClick,
  onMarkerDragMove,
  onMarkerDragEnd,
  onZoomChange,
}: MapCanvasProps) {
  const width = map.width ?? 0;
  const height = map.height ?? 0;
  const maxZoom = map.maxZoom ?? 0;

  const bounds = useMemo(
    () =>
      L.latLngBounds(
        CRS.pointToLatLng(L.point(0, height), maxZoom),
        CRS.pointToLatLng(L.point(width, 0), maxZoom)
      ),
    [width, height, maxZoom]
  );

  const fractionalToLatLng = useCallback(
    (x: number, y: number) => CRS.pointToLatLng(L.point(x * width, y * height), maxZoom),
    [width, height, maxZoom]
  );

  return (
    <div className="relative flex-1 overflow-hidden bg-black/40" style={{ cursor: addMode ? "crosshair" : "" }}>
      <MapContainer
        crs={CRS}
        bounds={bounds}
        maxBounds={bounds}
        minZoom={0}
        maxZoom={maxZoom}
        zoomControl={false}
        attributionControl={false}
        className="!w-full !h-full !bg-black/40"
      >
        <TileLayer
          url={`/api/maps/${map.id}/tiles/{z}/{x}/{y}.jpg`}
          tileSize={256}
          noWrap
          bounds={bounds}
          maxNativeZoom={maxZoom}
          minZoom={0}
          maxZoom={maxZoom}
        />
        <ClickHandler addMode={addMode} onImageClick={onImageClick} width={width} height={height} maxZoom={maxZoom} />
        <ZoomReporter onZoomChange={onZoomChange} />
        {markers.map((m) => (
          <MarkerWithReveal
            key={m.id}
            marker={m}
            selected={m.id === selectedId}
            position={fractionalToLatLng(m.x, m.y)}
            onMarkerClick={onMarkerClick}
            onMarkerDragMove={onMarkerDragMove}
            onMarkerDragEnd={onMarkerDragEnd}
            width={width}
            height={height}
            maxZoom={maxZoom}
          />
        ))}
      </MapContainer>
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run build`
Expected: succeeds (still separate from `MapViewer.tsx`'s pending errors from Task 9, resolved in Task 13).

- [ ] **Step 3: Commit**

```bash
git add components/maps/TiledMapCanvas.tsx
git commit -m "feat: add Leaflet-based TiledMapCanvas with CRS.Simple and progressive marker reveal"
```

---

### Task 13: Wire MapViewer to dispatch on render mode

**Files:**
- Modify: `components/maps/MapViewer.tsx`

- [ ] **Step 1: Replace the file in full**

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
        setMap(mapRes.ok ? await mapRes.json() : null);
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

  const canvasProps = {
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
        <Button
          size="sm"
          variant={addMode ? "initiative" : "outline"}
          onClick={() => setAddMode((v) => !v)}
          className="gap-1.5 flex-none"
        >
          {addMode ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {addMode ? "Cancel" : "Add Marker"}
        </Button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {map.renderMode === "tiled" ? (
          <TiledMapCanvas {...canvasProps} onZoomChange={setViewZoom} />
        ) : (
          <StaticMapCanvas {...canvasProps} />
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

- [ ] **Step 2: Verify types compile**

Run: `npm run build`
Expected: succeeds with no errors anywhere in `components/maps/`.

- [ ] **Step 3: Commit**

```bash
git add components/maps/MapViewer.tsx
git commit -m "feat: dispatch MapViewer canvas by renderMode, wire progressive-reveal zoom"
```

---

### Task 14: End-to-end smoke test

**Files:** none (verification only)

- [ ] **Step 1: Start the production build**

```bash
npm run build
npm run start
```

Use the `mcp__Claude_Preview__*` browser tools against this running server — **never `npm run dev`** for this project (a prior Turbopack dev-mode crash is why; this is a standing rule for this codebase).

- [ ] **Step 2: Upload a tiled map**

Via the browser: go to `/maps`, click "Upload Map," pick "Large-scale interactive," upload a real test image (a few thousand pixels on a side is enough to produce multiple zoom levels without a long wait), and confirm it redirects into `/maps/[id]` showing the Leaflet viewer (not the static pan/zoom canvas).

- [ ] **Step 3: Verify pan/zoom feel**

Scroll to zoom in and out repeatedly. Confirm: tiles load progressively (network tab shows `/api/maps/[id]/tiles/...` requests, not one giant image request), zooming out fully doesn't cut off any part of the map, and there's no default Leaflet zoom-control widget or attribution badge visible (matches the app's existing no-default-chrome convention).

- [ ] **Step 4: Verify marker placement and the coordinate mapping specifically**

Click "Add Marker," place a marker at the **top-left corner** of the visible image, and separately place one at the **bottom-right corner**. Reload the page. Confirm both markers render in the same corners they were placed in — not flipped or mirrored. This is the concrete check for the `CRS.Simple` y-axis handling described in Task 12; if a marker appears vertically mirrored (e.g., a top-left placement renders at the bottom-left), that confirms a coordinate bug to fix before continuing.

- [ ] **Step 5: Verify progressive reveal**

Place a new marker while zoomed in several levels past the initial view (leave "Always visible" unchecked). Zoom back out past that marker's recorded zoom level and confirm it disappears; zoom back in past that level and confirm it reappears.

- [ ] **Step 6: Verify drag-to-move persists**

Drag an existing tiled-map marker to a new position, reload the page, and confirm it stayed at the new position (not reverted) — this exercises `onMarkerDragEnd`'s `PATCH` call actually persisting.

- [ ] **Step 7: Verify the static viewer still works unchanged**

Navigate to (or create) a "Standard" map and confirm panning, zooming, marker placement, marker dragging, and the info-card popup all still behave exactly as before this plan — this is the regression check for the `StaticMapCanvas` extraction in Task 11.

- [ ] **Step 8: Verify deletion cleans up disk**

Delete the tiled test map from Task 2's upload. Confirm (via `ls data/maps/<mapId>` from a shell) that the entire directory — original image and tile pyramid both — is gone.

- [ ] **Step 9: Stop the server**

No commit for this task — it's verification only. If any step above surfaces a bug, fix it in the relevant task's file, re-run `npm run build`, and repeat this smoke test from the top before considering the plan done.
