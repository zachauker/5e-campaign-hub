# Interactive Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a campaign one or more pannable/zoomable map images, with markers that link to existing Characters/Locations/Factions, nest into sub-maps, or stand alone as free notes — plus back-links from those entities' detail pages.

**Architecture:** Two new tables (`maps`, `map_markers`). Map images live on the local Docker volume already used for the SQLite DB, served through a dedicated route handler. The viewer is a custom pan/zoom canvas (`react-zoom-pan-pinch`, new dependency) with markers as absolutely-positioned overlay elements — no third-party map-library chrome, matching this app's existing pattern of small hand-built UI primitives (`Tabs`, `StatBlock`) over themed component libraries.

**Tech Stack:** Next.js 16, TypeScript, Drizzle ORM + `better-sqlite3`, `react-zoom-pan-pinch` (new), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-07-02-interactive-map-design.md`

**Note on verification:** This project has no test runner. Every task is verified with `npx tsc --noEmit`, `npx eslint .`, and either a `curl` check (API tasks) or a manual browser check (UI tasks).

**Note on `eslint .` and nested worktrees:** If this plan is executed inside a git worktree living under `.claude/worktrees/<name>/`, running `eslint .` from a *different* checkout that has this worktree nested inside it (e.g. the main repo root) will scan the worktree's own `.next/**` build output as if it were source, producing a wildly inflated error count. This is a scanning artifact, not a real regression — always run `eslint .` from *inside* the actual worktree being worked in, and if a huge (1000+) error count ever shows up unexpectedly, that's the cause, not a real problem to fix.

**Note on `npm run dev`: DO NOT USE.** A prior session on this exact codebase triggered a runaway process fork-bomb that crashed the host machine specifically when Turbopack dev-mode compiled a new dynamic route for the first time. The root cause was never fully isolated. For every manual/browser verification step in this plan, use `npm run build && npm run start` (production mode — confirmed safe and already used successfully this session) instead of `npm run dev`. Never background `npm run dev` unmonitored, and never run it at all unless the user explicitly asks for it and is aware of this history.

---

## File Structure

**New files:**
- `lib/maps/storage.ts` — local-disk read/write/delete for map image files, on the same volume as the SQLite DB.
- `app/api/maps/route.ts` — GET (list top-level maps for a campaign, or all maps with `includeNested=true`), POST (multipart upload: creates a map + its image file in one request).
- `app/api/maps/[id]/route.ts` — GET (single map + breadcrumb chain), PATCH (rename), DELETE (removes row + image file; markers cascade via FK).
- `app/api/maps/[id]/image/route.ts` — GET, streams the map's image file with the correct content type.
- `app/api/maps/[id]/markers/route.ts` — GET (list markers for a map, with resolved display labels), POST (create a marker).
- `app/api/maps/markers/[markerId]/route.ts` — PATCH (reposition/edit), DELETE.
- `components/maps/MapMarkerPin.tsx` — the color-coded teardrop pin SVG, one per marker type.
- `components/maps/MarkerFormDialog.tsx` — the placement/edit dialog (type picker + conditional entity/sub-map/note fields).
- `components/maps/MapViewer.tsx` — the pan/zoom canvas, marker overlay, add-marker mode, drag-to-reposition, breadcrumb, and marker popup.
- `components/maps/UploadMapDialog.tsx` — the "Upload Map" dialog used by the Maps list page.
- `app/maps/page.tsx` — the Maps list/grid page.
- `app/maps/[id]/page.tsx` — thin wrapper rendering `MapViewer`.

**Modified files:**
- `package.json` — add `react-zoom-pan-pinch`.
- `lib/db/schema.ts` — add `maps` and `mapMarkers` tables + inferred types.
- `lib/db/migrate.ts` — add `CREATE TABLE IF NOT EXISTS` for both tables + indexes.
- `app/globals.css` — add marker type color tokens + a `.marker-selected` glow class (mirroring the existing `.combatant-active` glow).
- `app/api/characters/[id]/route.ts`, `app/api/locations/[id]/route.ts`, `app/api/factions/[id]/route.ts` — GET gains a `mapMarkers: { mapId, mapName, markerId }[]` field.
- `components/entities/CharacterFormDialog.tsx` — `CharacterWithLinks` type gains an optional `mapMarkers` field.
- `app/characters/[id]/page.tsx`, `components/glossary/SimpleEntityDetail.tsx` — Overview tab gains a "View on Map" section.
- `components/shell/TopBar.tsx` — add a "Maps" nav item.

**Explicitly not modified:** `app/api/items/[id]/route.ts` and `components/glossary/SimpleEntityDetail.tsx`'s Items usage do **not** gain `mapMarkers` — per the design spec, Items aren't a linkable marker type.

---

## Task 1: Extend Drizzle schema with `maps` and `map_markers`

**Files:**
- Modify: `lib/db/schema.ts`

- [ ] **Step 1: Add the two tables and their inferred types**

At the end of `lib/db/schema.ts`, after the existing `characterItems` table definition and before the `export type Encounter = ...` block, add:

```typescript
export const maps = sqliteTable("maps", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  imagePath: text("image_path").notNull(),
  parentMapId: text("parent_map_id"),
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
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
```

Note: the inferred types below are named `MapRow`/`NewMapRow`, not `Map`/`NewMap` — `Map` is a built-in JS/TS global type and shadowing it would break any file that also needs the real `Map` collection type.

At the end of the file, after the existing `export type Faction = ...` / `export type NewFaction = ...` lines, add:

```typescript
export type MapRow = typeof maps.$inferSelect;
export type NewMapRow = typeof maps.$inferInsert;
export type MapMarker = typeof mapMarkers.$inferSelect;
export type NewMapMarker = typeof mapMarkers.$inferInsert;
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/db/schema.ts
git commit -m "feat: add maps and map_markers tables to schema"
```

---

## Task 2: Extend migration script

**Files:**
- Modify: `lib/db/migrate.ts`

- [ ] **Step 1: Add the new tables to the main migration block**

In `lib/db/migrate.ts`, find the existing block ending in:

```
    CREATE INDEX IF NOT EXISTS idx_characters_campaign ON characters(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_locations_campaign ON locations(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_items_campaign ON items(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_factions_campaign ON factions(campaign_id);
  `);
```

Replace it with:

```
    CREATE INDEX IF NOT EXISTS idx_characters_campaign ON characters(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_locations_campaign ON locations(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_items_campaign ON items(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_factions_campaign ON factions(campaign_id);

    CREATE TABLE IF NOT EXISTS maps (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      image_path TEXT NOT NULL,
      parent_map_id TEXT REFERENCES maps(id),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS map_markers (
      id TEXT PRIMARY KEY,
      map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
      x REAL NOT NULL,
      y REAL NOT NULL,
      type TEXT NOT NULL,
      entity_id TEXT,
      target_map_id TEXT REFERENCES maps(id),
      title TEXT,
      note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_maps_campaign ON maps(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_maps_parent ON maps(parent_map_id);
    CREATE INDEX IF NOT EXISTS idx_map_markers_map ON map_markers(map_id);
  `);
```

- [ ] **Step 2: Verify the migration runs cleanly**

Run: `rm -f /tmp/migrate-test.db && DB_PATH=/tmp/migrate-test.db npx tsx -e "require('./lib/db/migrate').runMigrations()"`
Expected: no errors. Then confirm the tables exist:
Run: `sqlite3 /tmp/migrate-test.db ".tables"`
Expected: output includes `maps` and `map_markers`.
Run: `rm -f /tmp/migrate-test.db`

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/db/migrate.ts
git commit -m "feat: add maps and map_markers tables to migration script"
```

---

## Task 3: Local map-image storage utility

**Files:**
- Create: `lib/maps/storage.ts`

- [ ] **Step 1: Write the storage helpers**

```typescript
// lib/maps/storage.ts
import fs from "fs/promises";
import path from "path";

// Same volume the SQLite DB lives on (DB_PATH is /data/encounter-tracker.db
// in production, per docker-compose.yml's ./data:/data mount) — no new
// volume or env var needed.
const DATA_DIR = path.dirname(process.env.DB_PATH || path.join(process.cwd(), "encounter-tracker.db"));
const MAPS_DIR = path.join(DATA_DIR, "maps");

export async function saveMapImage(mapId: string, file: File): Promise<string> {
  await fs.mkdir(MAPS_DIR, { recursive: true });
  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const filename = `${mapId}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(MAPS_DIR, filename), buffer);
  return filename;
}

export async function readMapImage(imagePath: string): Promise<Buffer> {
  return fs.readFile(path.join(MAPS_DIR, imagePath));
}

export async function deleteMapImage(imagePath: string): Promise<void> {
  await fs.rm(path.join(MAPS_DIR, imagePath), { force: true });
}

export function mapImageContentType(imagePath: string): string {
  const ext = imagePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/maps/storage.ts
git commit -m "feat: add local map image storage utility"
```

---

## Task 4: Maps CRUD API

**Files:**
- Create: `app/api/maps/route.ts`
- Create: `app/api/maps/[id]/route.ts`

- [ ] **Step 1: Write the list/create route**

```typescript
// app/api/maps/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { maps } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { saveMapImage } from "@/lib/maps/storage";
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

  const id = generateId();
  const imagePath = await saveMapImage(id, file);
  const now = new Date();
  const [map] = await db
    .insert(maps)
    .values({
      id,
      campaignId,
      name: name.trim(),
      imagePath,
      parentMapId: typeof parentMapId === "string" && parentMapId ? parentMapId : null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return NextResponse.json(map, { status: 201 });
}
```

- [ ] **Step 2: Write the single-map route**

```typescript
// app/api/maps/[id]/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { maps } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { deleteMapImage } from "@/lib/maps/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const map = await db.query.maps.findFirst({ where: eq(maps.id, id) });
  if (!map) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const breadcrumb: { id: string; name: string }[] = [];
  let current = map;
  while (current.parentMapId) {
    const parent = await db.query.maps.findFirst({ where: eq(maps.id, current.parentMapId) });
    if (!parent) break;
    breadcrumb.unshift({ id: parent.id, name: parent.name });
    current = parent;
  }

  return NextResponse.json({ ...map, breadcrumb });
}

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

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await db.query.maps.findFirst({ where: eq(maps.id, id) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.delete(maps).where(eq(maps.id, id));
  await deleteMapImage(existing.imagePath);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app/api/maps/route.ts app/api/maps/[id]/route.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/maps/route.ts "app/api/maps/[id]/route.ts"
git commit -m "feat: add maps CRUD API"
```

---

## Task 5: Map image serving route

**Files:**
- Create: `app/api/maps/[id]/image/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// app/api/maps/[id]/image/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { maps } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { readMapImage, mapImageContentType } from "@/lib/maps/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const map = await db.query.maps.findFirst({ where: eq(maps.id, id) });
  if (!map) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const buffer = await readMapImage(map.imagePath);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": mapImageContentType(map.imagePath),
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint "app/api/maps/[id]/image/route.ts"`
Expected: no errors.

- [ ] **Step 3: Manually verify end-to-end with a real upload**

Run:
```bash
npm run build && npm run start &
sleep 3
CAMPAIGN_ID=$(curl -s http://localhost:3000/api/campaigns | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d)[0].id))")
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n\x2d\xb4\x00\x00\x00\x00IEND\xaeB\x60\x82' > /tmp/test-map.png
MAP_ID=$(curl -s -X POST http://localhost:3000/api/maps -F "name=Test Map" -F "campaignId=$CAMPAIGN_ID" -F "image=@/tmp/test-map.png" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")
curl -s -o /tmp/downloaded.png -D - "http://localhost:3000/api/maps/$MAP_ID/image" | head -5
diff /tmp/test-map.png /tmp/downloaded.png && echo "IMAGE MATCHES"
rm -f /tmp/test-map.png /tmp/downloaded.png
kill %1
```
Expected: response headers show `Content-Type: image/png`, and `IMAGE MATCHES` prints (the served file is byte-identical to what was uploaded).

- [ ] **Step 4: Commit**

```bash
git add "app/api/maps/[id]/image/route.ts"
git commit -m "feat: add map image serving route"
```

---

## Task 6: Map markers CRUD API

**Files:**
- Create: `app/api/maps/[id]/markers/route.ts`
- Create: `app/api/maps/markers/[markerId]/route.ts`

- [ ] **Step 1: Write the per-map markers list/create route**

```typescript
// app/api/maps/[id]/markers/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mapMarkers, maps, characters, locations, factions } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { eq } from "drizzle-orm";

async function resolveMarkerLabel(
  marker: typeof mapMarkers.$inferSelect
): Promise<{ resolvedTitle: string; resolvedSubtitle: string | null }> {
  if (marker.type === "note") {
    return { resolvedTitle: marker.title || "Note", resolvedSubtitle: null };
  }
  if (marker.type === "submap") {
    const target = marker.targetMapId
      ? await db.query.maps.findFirst({ where: eq(maps.id, marker.targetMapId) })
      : null;
    return {
      resolvedTitle: marker.title || target?.name || "Sub-map",
      resolvedSubtitle: target ? null : "Map not found",
    };
  }
  if (!marker.entityId) {
    return { resolvedTitle: marker.title || "Untitled", resolvedSubtitle: "Entity not found" };
  }
  let entityName: string | undefined;
  if (marker.type === "character") {
    entityName = (await db.query.characters.findFirst({ where: eq(characters.id, marker.entityId) }))?.name;
  } else if (marker.type === "location") {
    entityName = (await db.query.locations.findFirst({ where: eq(locations.id, marker.entityId) }))?.name;
  } else if (marker.type === "faction") {
    entityName = (await db.query.factions.findFirst({ where: eq(factions.id, marker.entityId) }))?.name;
  }
  return {
    resolvedTitle: marker.title || entityName || "Untitled",
    resolvedSubtitle: entityName ? null : "Entity not found",
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await db.query.mapMarkers.findMany({ where: eq(mapMarkers.mapId, id) });
  const resolved = await Promise.all(rows.map(async (m) => ({ ...m, ...(await resolveMarkerLabel(m)) })));
  return NextResponse.json(resolved);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  if (typeof body.x !== "number" || typeof body.y !== "number") {
    return NextResponse.json({ error: '"x" and "y" must be numbers' }, { status: 400 });
  }
  const validTypes = ["location", "faction", "character", "submap", "note"];
  if (!validTypes.includes(body.type)) {
    return NextResponse.json({ error: `"type" must be one of ${validTypes.join(", ")}` }, { status: 400 });
  }

  const now = new Date();
  const [marker] = await db
    .insert(mapMarkers)
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
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return NextResponse.json(marker, { status: 201 });
}
```

- [ ] **Step 2: Write the single-marker route**

```typescript
// app/api/maps/markers/[markerId]/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mapMarkers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(req: Request, { params }: { params: Promise<{ markerId: string }> }) {
  const { markerId } = await params;
  const body = await req.json();
  const existing = await db.query.mapMarkers.findFirst({ where: eq(mapMarkers.id, markerId) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db
    .update(mapMarkers)
    .set({
      x: typeof body.x === "number" ? body.x : existing.x,
      y: typeof body.y === "number" ? body.y : existing.y,
      type: body.type ?? existing.type,
      entityId: body.entityId !== undefined ? body.entityId : existing.entityId,
      targetMapId: body.targetMapId !== undefined ? body.targetMapId : existing.targetMapId,
      title: body.title !== undefined ? body.title : existing.title,
      note: body.note !== undefined ? body.note : existing.note,
      updatedAt: new Date(),
    })
    .where(eq(mapMarkers.id, markerId));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ markerId: string }> }) {
  const { markerId } = await params;
  await db.delete(mapMarkers).where(eq(mapMarkers.id, markerId));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint "app/api/maps/[id]/markers/route.ts" "app/api/maps/markers/[markerId]/route.ts"`
Expected: no errors.

- [ ] **Step 4: Manually verify with curl**

Run (continuing from a map created the same way as Task 5's Step 3 — reuse `$MAP_ID`, or create a fresh one first):
```bash
npm run build && npm run start &
sleep 3
CAMPAIGN_ID=$(curl -s http://localhost:3000/api/campaigns | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d)[0].id))")
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n\x2d\xb4\x00\x00\x00\x00IEND\xaeB\x60\x82' > /tmp/test-map.png
MAP_ID=$(curl -s -X POST http://localhost:3000/api/maps -F "name=Marker Test Map" -F "campaignId=$CAMPAIGN_ID" -F "image=@/tmp/test-map.png" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")
MARKER_ID=$(curl -s -X POST "http://localhost:3000/api/maps/$MAP_ID/markers" -H "Content-Type: application/json" -d '{"x":0.5,"y":0.3,"type":"note","title":"A note","note":"Some text"}' | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")
curl -s "http://localhost:3000/api/maps/$MAP_ID/markers"
curl -s -X PATCH "http://localhost:3000/api/maps/markers/$MARKER_ID" -H "Content-Type: application/json" -d '{"x":0.7}'
curl -s "http://localhost:3000/api/maps/$MAP_ID/markers"
curl -s -X DELETE "http://localhost:3000/api/maps/markers/$MARKER_ID"
curl -s "http://localhost:3000/api/maps/$MAP_ID/markers"
rm -f /tmp/test-map.png
kill %1
```
Expected: the first list call shows one marker with `resolvedTitle: "A note"`, `x: 0.5`. After PATCH, the second list call shows `x: 0.7`. After DELETE, the third list call returns `[]`.

- [ ] **Step 5: Commit**

```bash
git add "app/api/maps/[id]/markers/route.ts" "app/api/maps/markers/[markerId]/route.ts"
git commit -m "feat: add map markers CRUD API"
```

---

## Task 7: Reverse map-marker lookups on entity detail APIs

**Files:**
- Modify: `app/api/characters/[id]/route.ts`
- Modify: `app/api/locations/[id]/route.ts`
- Modify: `app/api/factions/[id]/route.ts`

- [ ] **Step 1: Add the lookup to the Characters route**

In `app/api/characters/[id]/route.ts`, change the import line:

```typescript
import { characters, characterFactions, characterLocations, characterItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
```

to:

```typescript
import { characters, characterFactions, characterLocations, characterItems, mapMarkers, maps } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
```

Then change the `GET` handler from:

```typescript
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.query.characters.findFirst({ where: eq(characters.id, id) });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [factionLinks, locationLinks, itemLinks] = await Promise.all([
    db.query.characterFactions.findMany({ where: eq(characterFactions.characterId, id) }),
    db.query.characterLocations.findMany({ where: eq(characterLocations.characterId, id) }),
    db.query.characterItems.findMany({ where: eq(characterItems.characterId, id) }),
  ]);

  return NextResponse.json({
    ...row,
    factionIds: factionLinks.map((l) => l.factionId),
    locationIds: locationLinks.map((l) => l.locationId),
    itemIds: itemLinks.map((l) => l.itemId),
  });
}
```

to:

```typescript
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.query.characters.findFirst({ where: eq(characters.id, id) });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [factionLinks, locationLinks, itemLinks, markerLinks] = await Promise.all([
    db.query.characterFactions.findMany({ where: eq(characterFactions.characterId, id) }),
    db.query.characterLocations.findMany({ where: eq(characterLocations.characterId, id) }),
    db.query.characterItems.findMany({ where: eq(characterItems.characterId, id) }),
    db.query.mapMarkers.findMany({ where: and(eq(mapMarkers.entityId, id), eq(mapMarkers.type, "character")) }),
  ]);

  const resolvedMapMarkers = await Promise.all(
    markerLinks.map(async (link) => {
      const map = await db.query.maps.findFirst({ where: eq(maps.id, link.mapId) });
      return { mapId: link.mapId, mapName: map?.name ?? "Unknown map", markerId: link.id };
    })
  );

  return NextResponse.json({
    ...row,
    factionIds: factionLinks.map((l) => l.factionId),
    locationIds: locationLinks.map((l) => l.locationId),
    itemIds: itemLinks.map((l) => l.itemId),
    mapMarkers: resolvedMapMarkers,
  });
}
```

- [ ] **Step 2: Add the identical pattern to Locations and Factions routes**

In `app/api/locations/[id]/route.ts`, change the import line:

```typescript
import { locations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
```

to:

```typescript
import { locations, mapMarkers, maps } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
```

Then change the `GET` handler from:

```typescript
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.query.locations.findFirst({ where: eq(locations.id, id) });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}
```

to:

```typescript
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.query.locations.findFirst({ where: eq(locations.id, id) });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const markerLinks = await db.query.mapMarkers.findMany({
    where: and(eq(mapMarkers.entityId, id), eq(mapMarkers.type, "location")),
  });
  const resolvedMapMarkers = await Promise.all(
    markerLinks.map(async (link) => {
      const map = await db.query.maps.findFirst({ where: eq(maps.id, link.mapId) });
      return { mapId: link.mapId, mapName: map?.name ?? "Unknown map", markerId: link.id };
    })
  );

  return NextResponse.json({ ...row, mapMarkers: resolvedMapMarkers });
}
```

Apply the exact same change to `app/api/factions/[id]/route.ts`, substituting `factions`/`"faction"` for `locations`/`"location"` throughout (the `linkedCharacters` reverse-relationship code already in that file, from the prior sub-project, is untouched — this adds a second, independent field alongside it).

**Note:** `app/api/items/[id]/route.ts` is deliberately **not** modified — Items aren't a linkable marker type per the design spec.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint "app/api/characters/[id]/route.ts" "app/api/locations/[id]/route.ts" "app/api/factions/[id]/route.ts"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "app/api/characters/[id]/route.ts" "app/api/locations/[id]/route.ts" "app/api/factions/[id]/route.ts"
git commit -m "feat: add reverse map-marker lookups to Character/Location/Faction APIs"
```

---

## Task 8: Marker color tokens + `MapMarkerPin`

**Files:**
- Modify: `app/globals.css`
- Create: `components/maps/MapMarkerPin.tsx`

- [ ] **Step 1: Add marker color tokens and a selection glow class**

In `app/globals.css`, in the `:root` block, after the existing `--initiative: #d4af37;` line, add:

```css
  --marker-location: #b8925a;
  --marker-faction: #9b6bb0;
  --marker-character: #4fae8f;
  --marker-submap: #5a7ab8;
  --marker-note: #7a8079;
```

After the existing `.combatant-active { ... }` block, add:

```css
/* Map marker selection glow — same recipe as .combatant-active, applied via
   drop-shadow (not box-shadow) since markers are SVGs, not boxes. */
.marker-selected {
  filter: drop-shadow(0 0 3px var(--initiative)) drop-shadow(0 0 8px rgba(212, 175, 55, 0.6));
}
```

- [ ] **Step 2: Write the pin component**

```tsx
// components/maps/MapMarkerPin.tsx
"use client";

import { MapPin, Flag, UserRound, Layers, StickyNote, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const MARKER_META: Record<string, { color: string; icon: LucideIcon }> = {
  location: { color: "var(--marker-location)", icon: MapPin },
  faction: { color: "var(--marker-faction)", icon: Flag },
  character: { color: "var(--marker-character)", icon: UserRound },
  submap: { color: "var(--marker-submap)", icon: Layers },
  note: { color: "var(--marker-note)", icon: StickyNote },
};

export function MapMarkerPin({ type, selected }: { type: string; selected?: boolean }) {
  const meta = MARKER_META[type] ?? MARKER_META.note;
  const Icon = meta.icon;
  return (
    <div className={cn("relative", selected && "marker-selected")}>
      <svg width="28" height="36" viewBox="0 0 28 36" className="drop-shadow-md">
        <path
          d="M14 0C6.3 0 0 6.3 0 14c0 9.6 14 22 14 22s14-12.4 14-22c0-7.7-6.3-14-14-14z"
          fill={meta.color}
        />
        <circle cx="14" cy="14" r="9" fill="var(--card)" />
      </svg>
      <Icon
        className="absolute w-3.5 h-3.5"
        style={{ color: meta.color, top: "8px", left: "50%", transform: "translateX(-50%)" }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint components/maps/MapMarkerPin.tsx`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css components/maps/MapMarkerPin.tsx
git commit -m "feat: add marker color tokens and MapMarkerPin component"
```

---

## Task 9: `MarkerFormDialog`

**Files:**
- Create: `components/maps/MarkerFormDialog.tsx`

- [ ] **Step 1: Write the dialog**

```tsx
// components/maps/MarkerFormDialog.tsx
"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type MarkerType = "location" | "faction" | "character" | "submap" | "note";

interface EntityOption {
  id: string;
  name: string;
}

interface MapOption {
  id: string;
  name: string;
  parentMapId: string | null;
}

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
}

interface MarkerFormDialogProps {
  mapId: string;
  campaignId: string;
  position: { x: number; y: number } | null;
  marker: MarkerData | null;
  onClose: () => void;
  onSaved: () => void;
}

const TYPE_OPTIONS: { value: MarkerType; label: string }[] = [
  { value: "location", label: "Location" },
  { value: "faction", label: "Faction" },
  { value: "character", label: "Character" },
  { value: "submap", label: "Sub-map" },
  { value: "note", label: "Note" },
];

export function MarkerFormDialog({ mapId, campaignId, position, marker, onClose, onSaved }: MarkerFormDialogProps) {
  const [type, setType] = useState<MarkerType>(marker?.type ?? "note");
  const [entityId, setEntityId] = useState(marker?.entityId ?? "");
  const [targetMapId, setTargetMapId] = useState(marker?.targetMapId ?? "");
  const [title, setTitle] = useState(marker?.title ?? "");
  const [note, setNote] = useState(marker?.note ?? "");
  const [entityOptions, setEntityOptions] = useState<EntityOption[]>([]);
  const [mapOptions, setMapOptions] = useState<MapOption[]>([]);
  const [uploadName, setUploadName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (type === "character" || type === "location" || type === "faction") {
        const path = type === "character" ? "characters" : type === "location" ? "locations" : "factions";
        const res = await fetch(`/api/${path}?campaignId=${campaignId}`);
        if (cancelled) return;
        setEntityOptions(res.ok ? await res.json() : []);
      } else if (type === "submap") {
        const res = await fetch(`/api/maps?campaignId=${campaignId}&includeNested=true`);
        if (cancelled) return;
        const data: MapOption[] = res.ok ? await res.json() : [];
        setMapOptions(data.filter((m) => m.parentMapId === null && m.id !== mapId));
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [type, campaignId, mapId]);

  async function save() {
    setSaving(true);
    try {
      let finalTargetMapId = targetMapId || null;

      if (type === "submap" && uploadFile && uploadName.trim()) {
        const form = new FormData();
        form.append("name", uploadName.trim());
        form.append("campaignId", campaignId);
        form.append("parentMapId", mapId);
        form.append("image", uploadFile);
        const res = await fetch("/api/maps", { method: "POST", body: form });
        const newMap = await res.json();
        finalTargetMapId = newMap.id;
      }

      const payload = {
        x: position?.x,
        y: position?.y,
        type,
        entityId: type === "character" || type === "location" || type === "faction" ? entityId || null : null,
        targetMapId: type === "submap" ? finalTargetMapId : null,
        title: title.trim() || null,
        note: type === "note" ? note.trim() || null : null,
      };

      if (marker) {
        await fetch(`/api/maps/markers/${marker.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch(`/api/maps/${mapId}/markers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const canSave =
    (type === "note" && title.trim().length > 0) ||
    ((type === "character" || type === "location" || type === "faction") && entityId.length > 0) ||
    (type === "submap" && (targetMapId.length > 0 || (uploadFile !== null && uploadName.trim().length > 0)));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{marker ? "Edit Marker" : "New Marker"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="grid grid-cols-5 gap-1.5">
            {TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setType(opt.value)}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-xs transition-colors",
                  type === opt.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {(type === "character" || type === "location" || type === "faction") && (
            <select
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
            >
              <option value="">Select {type}...</option>
              {entityOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}

          {type === "submap" && (
            <div className="space-y-2">
              <select
                value={targetMapId}
                onChange={(e) => setTargetMapId(e.target.value)}
                className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
              >
                <option value="">Select an existing map...</option>
                {mapOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Or upload a new map to nest here:</p>
              <Input placeholder="New map name" value={uploadName} onChange={(e) => setUploadName(e.target.value)} />
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                className="w-full text-xs text-muted-foreground"
              />
            </div>
          )}

          {type === "note" && (
            <textarea
              placeholder="Note text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          )}

          <Input
            placeholder={type === "note" ? "Title" : "Title override (optional)"}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <Button className="w-full" onClick={save} disabled={saving || !canSave}>
            {saving ? "Saving..." : marker ? "Save Changes" : "Place Marker"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint components/maps/MarkerFormDialog.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/maps/MarkerFormDialog.tsx
git commit -m "feat: add MarkerFormDialog component"
```

---

## Task 10: `MapViewer` (pan/zoom canvas)

**Files:**
- Modify: `package.json` (via `npm install`)
- Create: `components/maps/MapViewer.tsx`

- [ ] **Step 1: Install the pan/zoom library**

Run: `npm install react-zoom-pan-pinch`
Expected: adds `react-zoom-pan-pinch` to `package.json` dependencies, updates `package-lock.json`.

- [ ] **Step 2: Write the viewer component**

```tsx
// components/maps/MapViewer.tsx
"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Plus, X, ChevronRight } from "lucide-react";
import { MapMarkerPin } from "@/components/maps/MapMarkerPin";
import { MarkerFormDialog, type MarkerData } from "@/components/maps/MarkerFormDialog";
import { useCampaignStore } from "@/lib/store/campaign-store";

interface MapData {
  id: string;
  name: string;
  imagePath: string;
  parentMapId: string | null;
  breadcrumb: { id: string; name: string }[];
}

interface ResolvedMarker extends MarkerData {
  resolvedTitle: string;
  resolvedSubtitle: string | null;
}

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingPosition, setPendingPosition] = useState<{ x: number; y: number } | null>(null);
  const [editingMarker, setEditingMarker] = useState<ResolvedMarker | null>(null);
  const draggingRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  function handleImageClick(e: React.MouseEvent<HTMLImageElement>) {
    if (!addMode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setPendingPosition({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    });
    setAddMode(false);
  }

  function handleMarkerClick(marker: ResolvedMarker) {
    if (draggingRef.current) return;
    if (marker.type === "submap" && marker.targetMapId) {
      router.push(`/maps/${marker.targetMapId}`);
      return;
    }
    setSelectedId(marker.id === selectedId ? null : marker.id);
  }

  function startDrag(markerId: string, e: React.PointerEvent) {
    e.stopPropagation();
    draggingRef.current = markerId;
    const container = containerRef.current;
    if (!container) return;

    function onMove(ev: PointerEvent) {
      const rect = container!.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
      setMarkers((prev) => prev.map((m) => (m.id === markerId ? { ...m, x, y } : m)));
    }
    async function onUp(ev: PointerEvent) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const rect = container!.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
      draggingRef.current = null;
      await fetch(`/api/maps/markers/${markerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x, y }),
      });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
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

      <div className="relative flex-1 overflow-hidden bg-black/40">
        <TransformWrapper panning={{ disabled: addMode }} doubleClick={{ disabled: true }} minScale={0.5} maxScale={6}>
          <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-fit !h-fit">
            <div ref={containerRef} className="relative" style={{ cursor: addMode ? "crosshair" : "default" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- locally-served map image, arbitrary user-upload dimensions */}
              <img
                src={`/api/maps/${map.id}/image`}
                alt={map.name}
                onClick={handleImageClick}
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
                    handleMarkerClick(m);
                  }}
                >
                  <MapMarkerPin type={m.type} selected={m.id === selectedId} />
                </div>
              ))}
            </div>
          </TransformComponent>
        </TransformWrapper>

        {selectedMarker && (
          <div className="absolute top-4 left-4 w-64 rounded-lg border border-border bg-card p-3 shadow-xl space-y-2">
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

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint components/maps/MapViewer.tsx`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json components/maps/MapViewer.tsx
git commit -m "feat: add MapViewer pan/zoom canvas component"
```

---

## Task 11: Maps list page, upload dialog, and detail route

**Files:**
- Create: `components/maps/UploadMapDialog.tsx`
- Create: `app/maps/page.tsx`
- Create: `app/maps/[id]/page.tsx`

- [ ] **Step 1: Write the upload dialog**

```tsx
// components/maps/UploadMapDialog.tsx
"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface UploadMapDialogProps {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  onUploaded: () => void;
}

export function UploadMapDialog({ open, onClose, campaignId, onUploaded }: UploadMapDialogProps) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function upload() {
    if (!name.trim() || !file || !campaignId) return;
    setSaving(true);
    try {
      const form = new FormData();
      form.append("name", name.trim());
      form.append("campaignId", campaignId);
      form.append("image", file);
      await fetch("/api/maps", { method: "POST", body: form });
      onUploaded();
      onClose();
      setName("");
      setFile(null);
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
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-xs text-muted-foreground"
          />
          <Button className="w-full" onClick={upload} disabled={saving || !name.trim() || !file}>
            {saving ? "Uploading..." : "Upload"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Write the Maps list page**

```tsx
// app/maps/page.tsx
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

  const load = useCallback(async () => {
    if (!activeCampaignId) return;
    const res = await fetch(`/api/maps?campaignId=${activeCampaignId}`);
    if (res.ok) setMaps(await res.json());
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
            className="group rounded-xl border border-border bg-card overflow-hidden hover:border-primary/50 transition-colors"
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

- [ ] **Step 3: Write the map detail route**

```tsx
// app/maps/[id]/page.tsx
"use client";

import { MapViewer } from "@/components/maps/MapViewer";

export default function MapDetailPage() {
  return <MapViewer />;
}
```

- [ ] **Step 4: Type-check, lint, and build**

Run: `npx tsc --noEmit && npx eslint components/maps/UploadMapDialog.tsx app/maps/page.tsx "app/maps/[id]/page.tsx" && npm run build`
Expected: no errors; build output includes `○ /maps` and `ƒ /maps/[id]` in the route list.

- [ ] **Step 5: Commit**

```bash
git add components/maps/UploadMapDialog.tsx app/maps/page.tsx "app/maps/[id]/page.tsx"
git commit -m "feat: add Maps list page, upload dialog, and detail route"
```

---

## Task 12: Add Maps nav item

**Files:**
- Modify: `components/shell/TopBar.tsx`

- [ ] **Step 1: Add the nav entry**

In `components/shell/TopBar.tsx`, change the import line:

```typescript
import { Swords, Users, MapPin, Package, Shield, Command, Settings } from "lucide-react";
```

to:

```typescript
import { Swords, Users, MapPin, Package, Shield, Command, Settings, Map } from "lucide-react";
```

Then change the `SECTIONS` array from:

```typescript
const SECTIONS = [
  { href: "/encounters", label: "Encounters", icon: Swords },
  { href: "/characters", label: "Characters", icon: Users },
  { href: "/locations", label: "Locations", icon: MapPin },
  { href: "/items", label: "Items", icon: Package },
  { href: "/factions", label: "Factions", icon: Shield },
];
```

to:

```typescript
const SECTIONS = [
  { href: "/encounters", label: "Encounters", icon: Swords },
  { href: "/characters", label: "Characters", icon: Users },
  { href: "/locations", label: "Locations", icon: MapPin },
  { href: "/items", label: "Items", icon: Package },
  { href: "/factions", label: "Factions", icon: Shield },
  { href: "/maps", label: "Maps", icon: Map },
];
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint components/shell/TopBar.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/shell/TopBar.tsx
git commit -m "feat: add Maps nav item to TopBar"
```

---

## Task 13: "View on Map" back-links on entity detail pages

**Files:**
- Modify: `components/entities/CharacterFormDialog.tsx`
- Modify: `app/characters/[id]/page.tsx`
- Modify: `components/glossary/SimpleEntityDetail.tsx`

- [ ] **Step 1: Extend `CharacterWithLinks`**

In `components/entities/CharacterFormDialog.tsx`, change:

```typescript
export type CharacterWithLinks = Character & {
  factionIds: string[];
  locationIds: string[];
  itemIds: string[];
};
```

to:

```typescript
export type CharacterWithLinks = Character & {
  factionIds: string[];
  locationIds: string[];
  itemIds: string[];
  mapMarkers: { mapId: string; mapName: string; markerId: string }[];
};
```

- [ ] **Step 2: Add the section to the Character detail page**

In `app/characters/[id]/page.tsx`, add this import alongside the existing ones:

```typescript
import { Map as MapIcon } from "lucide-react";
```

In the Overview `TabsContent` block, change:

```tsx
        <TabsContent value="overview" className="space-y-4 pt-4">
          {character.description && <p className="text-sm text-muted-foreground">{character.description}</p>}

          {(factions.length > 0 || locations.length > 0 || items.length > 0) && (
```

to:

```tsx
        <TabsContent value="overview" className="space-y-4 pt-4">
          {character.description && <p className="text-sm text-muted-foreground">{character.description}</p>}

          {character.mapMarkers.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">On the Map</h3>
              <div className="flex flex-wrap gap-2">
                {character.mapMarkers.map((m) => (
                  <Link
                    key={m.markerId}
                    href={`/maps/${m.mapId}`}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:border-primary/50 hover:bg-accent/30 transition-colors text-sm"
                  >
                    <MapIcon className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="font-medium">{m.mapName}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {(factions.length > 0 || locations.length > 0 || items.length > 0) && (
```

- [ ] **Step 3: Add the section to `SimpleEntityDetail`**

In `components/glossary/SimpleEntityDetail.tsx`, add this import alongside the existing ones:

```typescript
import { Map as MapIcon } from "lucide-react";
```

Change the `SimpleEntityDetailData` interface from:

```typescript
interface SimpleEntityDetailData {
  id: string;
  name: string;
  description: string | null;
  notionUrl: string | null;
  linkedCharacters: { id: string; name: string; type: string }[];
}
```

to:

```typescript
interface SimpleEntityDetailData {
  id: string;
  name: string;
  description: string | null;
  notionUrl: string | null;
  linkedCharacters: { id: string; name: string; type: string }[];
  mapMarkers?: { mapId: string; mapName: string; markerId: string }[];
}
```

(`mapMarkers` is optional because `/api/items/[id]` doesn't return it — Items aren't map-linkable.)

In the Overview `TabsContent` block, change:

```tsx
        <TabsContent value="overview" className="space-y-4 pt-4">
          {entity.description && <p className="text-sm text-muted-foreground">{entity.description}</p>}

          {entity.linkedCharacters.length > 0 && (
```

to:

```tsx
        <TabsContent value="overview" className="space-y-4 pt-4">
          {entity.description && <p className="text-sm text-muted-foreground">{entity.description}</p>}

          {entity.mapMarkers && entity.mapMarkers.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">On the Map</h3>
              <div className="flex flex-wrap gap-2">
                {entity.mapMarkers.map((m) => (
                  <Link
                    key={m.markerId}
                    href={`/maps/${m.mapId}`}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:border-primary/50 hover:bg-accent/30 transition-colors text-sm"
                  >
                    <MapIcon className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="font-medium">{m.mapName}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {entity.linkedCharacters.length > 0 && (
```

The existing empty-state check a few lines below (`{!entity.description && entity.linkedCharacters.length === 0 && (...)}`) is left as-is — it's a reasonable simplification that a map marker alone (with no description or linked characters) still shows the "No description..." message alongside the map card, rather than needing a three-way empty-state condition.

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint components/entities/CharacterFormDialog.tsx "app/characters/[id]/page.tsx" components/glossary/SimpleEntityDetail.tsx`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/entities/CharacterFormDialog.tsx "app/characters/[id]/page.tsx" components/glossary/SimpleEntityDetail.tsx
git commit -m "feat: add View on Map back-links to entity detail pages"
```

---

## Task 14: End-to-end smoke test

**Files:** none (verification only)

- [ ] **Step 1: Production build**

Run: `npm run build`
Expected: succeeds, route list includes `○ /maps`, `ƒ /maps/[id]`, `ƒ /api/maps`, `ƒ /api/maps/[id]`, `ƒ /api/maps/[id]/image`, `ƒ /api/maps/[id]/markers`, `ƒ /api/maps/markers/[markerId]`.

- [ ] **Step 2: Full golden-path curl walkthrough**

Run:
```bash
npm run start &
sleep 3

CAMPAIGN_ID=$(curl -s http://localhost:3000/api/campaigns | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d)[0].id))")

# Create a character and a location to link markers to
CHAR_ID=$(curl -s -X POST http://localhost:3000/api/characters -H "Content-Type: application/json" -d "{\"campaignId\":\"$CAMPAIGN_ID\",\"name\":\"Smoke Test Hero\",\"type\":\"pc\"}" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")

# Upload a continent map and a city sub-map
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n\x2d\xb4\x00\x00\x00\x00IEND\xaeB\x60\x82' > /tmp/smoke-map.png

CONTINENT_ID=$(curl -s -X POST http://localhost:3000/api/maps -F "name=Continent" -F "campaignId=$CAMPAIGN_ID" -F "image=@/tmp/smoke-map.png" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")
CITY_ID=$(curl -s -X POST http://localhost:3000/api/maps -F "name=City" -F "campaignId=$CAMPAIGN_ID" -F "parentMapId=$CONTINENT_ID" -F "image=@/tmp/smoke-map.png" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")

echo "--- top-level maps list should show only Continent ---"
curl -s "http://localhost:3000/api/maps?campaignId=$CAMPAIGN_ID"

echo "--- City's breadcrumb should show Continent ---"
curl -s "http://localhost:3000/api/maps/$CITY_ID"

# Place a character marker on the City map, and a sub-map marker on the Continent map pointing at City
curl -s -X POST "http://localhost:3000/api/maps/$CITY_ID/markers" -H "Content-Type: application/json" -d "{\"x\":0.4,\"y\":0.4,\"type\":\"character\",\"entityId\":\"$CHAR_ID\"}"
curl -s -X POST "http://localhost:3000/api/maps/$CONTINENT_ID/markers" -H "Content-Type: application/json" -d "{\"x\":0.6,\"y\":0.5,\"type\":\"submap\",\"targetMapId\":\"$CITY_ID\"}"

echo "--- Continent's markers: one submap marker, resolvedTitle should be City ---"
curl -s "http://localhost:3000/api/maps/$CONTINENT_ID/markers"

echo "--- Character's detail response should now include a mapMarkers entry pointing at City ---"
curl -s "http://localhost:3000/api/characters/$CHAR_ID"

echo "--- image route should serve the correct content-type ---"
curl -s -D - -o /dev/null "http://localhost:3000/api/maps/$CONTINENT_ID/image" | grep -i content-type

rm -f /tmp/smoke-map.png
kill %1
```

Expected:
- The top-level maps list contains only `Continent` (City is nested, excluded).
- City's `GET` response has `breadcrumb: [{ id: "<continent-id>", name: "Continent" }]`.
- Continent's markers list has one entry, `type: "submap"`, `resolvedTitle: "City"`, `resolvedSubtitle: null`.
- The character's `GET` response includes `mapMarkers: [{ mapId: "<city-id>", mapName: "City", markerId: "..." }]`.
- The image route responds with `content-type: image/png`.

- [ ] **Step 3: Manual browser check (production server, not dev)**

With `npm run start` still running from Step 2 (restart it if it was killed): open `http://localhost:3000/maps`, confirm the Continent card renders with its thumbnail. Click into it, confirm the pan/zoom canvas loads with the image, click "Add Marker", click anywhere on the map, and confirm the placement dialog opens. Cancel out, then click the existing sub-map pin and confirm it navigates to the City map with a breadcrumb showing "Continent". Navigate to `/characters/<CHAR_ID>` and confirm an "On the Map" card linking to City appears in the Overview tab.

Stop the server: `kill %1` (or find and kill the `next start` process if it's no longer job `%1`).

- [ ] **Step 4: Full lint pass from inside the actual worktree**

Run: `npx eslint .`
Expected: only the pre-existing baseline (6 errors / 18 warnings in files this plan never touches) — confirm your new files add zero new errors.

This task produces no commit — it's verification only. If any step fails, fix the underlying issue in the relevant earlier task's files and re-run this task's steps before considering the plan complete.
