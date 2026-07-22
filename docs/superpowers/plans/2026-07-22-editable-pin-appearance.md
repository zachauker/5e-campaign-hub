# Editable Pin Appearance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the DM customize pin appearance (size, shape, icon, label size, color) per marker type (global defaults) and per individual pin (overrides), on both map viewers.

**Architecture:** A pure `resolveMarkerAppearance(marker, typeDefaults)` merges built-in type meta ← per-type default (a `marker_appearance` settings JSON) ← per-pin override (new nullable `map_markers` columns) into a `ResolvedAppearance`. `MapMarkerPin`/`MarkerLabel` become appearance-parameterized pure components; the three canvases resolve appearance per marker and pass it in (handling anchor scaling). A shared `MarkerAppearanceEditor` powers both the Edit-pin dialog (per-pin) and a toolbar "Pin styles" panel (per-type).

**Tech Stack:** Next.js 16, React 19, Tailwind v4, lucide-react, better-sqlite3 + Drizzle, leaflet / maplibre-gl / react-zoom-pan-pinch canvases, Vitest (node env — pure logic tested; rendering browser-verified).

**Testing convention:** Vitest is node-env (no jsdom). Only the pure resolver is unit-tested. Components/canvases/dialog/panel are browser-verified on a local map AND the world map. No component-render tests.

---

## File structure

**New**
- `components/maps/marker-appearance.ts` (+`.test.ts`) — types + curated sets + `resolveMarkerAppearance`.
- `components/maps/MarkerAppearanceEditor.tsx` — shared editor (size/shape/icon/label/color + preview).
- `components/maps/PinStylesPanel.tsx` — per-type panel (toolbar).

**Modified**
- `lib/db/schema.ts` — 5 nullable columns on `mapMarkers`.
- `lib/db/migrate.ts` — 5 `addColumnIfMissing` calls.
- `components/maps/map-types.ts` — 5 fields on `MarkerData`; `typeDefaults` on `MapCanvasProps`.
- `app/api/maps/[id]/markers/route.ts` — POST persists 5 fields.
- `app/api/maps/markers/[markerId]/route.ts` — PATCH persists 5 fields.
- `app/api/settings/route.ts` — allow `marker_appearance` key.
- `components/maps/MapMarkerPin.tsx` — appearance-parameterized.
- `components/maps/MarkerLabel.tsx` — `labelSize` + `hidden`.
- `components/maps/StaticMapCanvas.tsx`, `TiledMapCanvas.tsx`, `WorldMapCanvas.tsx` — resolve + thread appearance.
- `components/maps/MarkerFormDialog.tsx` — per-pin appearance section.
- `components/maps/MapViewer.tsx`, `WorldMapViewer.tsx` — load `marker_appearance`, pass `typeDefaults`, add "Pin styles" button.

---

## Task 1: Pure appearance model + resolver (TDD)

**Files:** Create `components/maps/marker-appearance.ts` + `components/maps/marker-appearance.test.ts`

The resolver merges three layers into a `ResolvedAppearance` with concrete geometry so the pin component and canvases stay dumb.

- [ ] **Step 1: Write the failing test**

```ts
// components/maps/marker-appearance.test.ts
import { describe, it, expect } from "vitest";
import {
  resolveMarkerAppearance,
  resolveIcon,
  SIZE_SCALE,
  type TypeAppearanceMap,
  type MarkerAppearanceInput,
} from "./marker-appearance";

// minimal marker-shaped input for the resolver
function marker(over: Partial<MarkerAppearanceInput> = {}): MarkerAppearanceInput {
  return { type: "location", entitySubtype: null, size: null, shape: null, icon: null, labelSize: null, color: null, ...over };
}

describe("resolveMarkerAppearance", () => {
  it("uses built-in type defaults when nothing is overridden", () => {
    const a = resolveMarkerAppearance(marker(), {});
    expect(a.shape).toBe("teardrop");
    expect(a.anchor).toBe("bottom");
    expect(a.color).toBe("var(--marker-location)");
    expect(a.labelSize).toBe("md");
    expect(a.labelHidden).toBe(false);
    expect(a.width).toBe(28); // md teardrop
    expect(a.height).toBe(36);
    expect(typeof a.icon).toBe("function"); // a lucide component
  });

  it("applies a per-type default", () => {
    const defaults: TypeAppearanceMap = { location: { size: "lg", shape: "square", color: "#ff0000" } };
    const a = resolveMarkerAppearance(marker(), defaults);
    expect(a.shape).toBe("square");
    expect(a.anchor).toBe("center"); // symmetric shapes anchor at center
    expect(a.color).toBe("#ff0000");
    expect(a.width).toBe(Math.round(30 * SIZE_SCALE.lg));
  });

  it("per-pin override beats the per-type default beats built-in", () => {
    const defaults: TypeAppearanceMap = { location: { size: "lg", color: "#ff0000" } };
    const a = resolveMarkerAppearance(marker({ size: "sm", color: "#00ff00" }), defaults);
    expect(a.color).toBe("#00ff00");
    expect(a.width).toBe(Math.round(28 * SIZE_SCALE.sm));
  });

  it("resolves a named icon override, falling back to the type icon on unknown names", () => {
    const known = resolveMarkerAppearance(marker({ icon: "Castle" }), {});
    expect(known.icon).toBe(resolveIcon("Castle"));
    const unknown = resolveMarkerAppearance(marker({ icon: "NotARealIcon" }), {});
    expect(unknown.icon).toBe(resolveMarkerAppearance(marker(), {}).icon); // type default icon
  });

  it("labelSize 'hide' sets labelHidden and keeps a concrete size for text", () => {
    const a = resolveMarkerAppearance(marker({ labelSize: "hide" }), {});
    expect(a.labelHidden).toBe(true);
    expect(["sm", "md", "lg"]).toContain(a.labelSize);
  });

  it("resolveIcon returns null for an unknown name", () => {
    expect(resolveIcon("Nope___")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/maps/marker-appearance.test.ts` → FAIL (module missing).

- [ ] **Step 3: Write the implementation**

```ts
// components/maps/marker-appearance.ts
import {
  MapPin, Castle, Mountain, MountainSnow, Trees, TreePine, Skull, Crown, Swords, Shield,
  House, Church, Anchor, Ship, Tent, Flag, Gem, Coins, Landmark, Waves, Flame, Snowflake,
  Eye, Star, Compass, Key, ScrollText, Footprints, Sparkles, Zap, type LucideIcon,
} from "lucide-react";
import type { MarkerType } from "@/components/maps/map-types";
import { visualForType } from "@/components/maps/marker-meta";

export type MarkerSize = "sm" | "md" | "lg" | "xl";
export type MarkerShape = "teardrop" | "circle" | "square" | "diamond";
export type MarkerLabelSize = "sm" | "md" | "lg" | "hide";

/** A per-marker or per-type appearance override; every field optional (null/undef = inherit).
 *  Typed — used by the editor and the per-type settings map. */
export interface MarkerAppearanceOverride {
  size?: MarkerSize | null;
  shape?: MarkerShape | null;
  icon?: string | null;
  labelSize?: MarkerLabelSize | null;
  color?: string | null;
}

/** The marker fields the resolver reads. Loose (string) because they come straight
 *  from DB TEXT columns (a ResolvedMarker satisfies this); the resolver validates them. */
export interface MarkerAppearanceInput {
  type: MarkerType;
  entitySubtype?: string | null;
  size?: string | null;
  shape?: string | null;
  icon?: string | null;
  labelSize?: string | null;
  color?: string | null;
}

export type TypeAppearanceMap = Partial<Record<MarkerType, MarkerAppearanceOverride>>;

export interface ResolvedAppearance {
  width: number;
  height: number;
  iconSize: number;
  shape: MarkerShape;
  color: string;
  icon: LucideIcon;
  anchor: "bottom" | "center";
  labelSize: "sm" | "md" | "lg";
  labelHidden: boolean;
}

export const SIZE_SCALE: Record<MarkerSize, number> = { sm: 0.72, md: 1, lg: 1.4, xl: 1.85 };
export const SIZES: MarkerSize[] = ["sm", "md", "lg", "xl"];
export const SHAPES: MarkerShape[] = ["teardrop", "circle", "square", "diamond"];
export const LABEL_SIZES: MarkerLabelSize[] = ["sm", "md", "lg", "hide"];
export const LABEL_TEXT_PX: Record<"sm" | "md" | "lg", string> = { sm: "9px", md: "10px", lg: "13px" };

/** Curated fantasy/map icon set (name → component). Bounded, explicit imports (no all-icons). */
export const ICON_SET: Record<string, LucideIcon> = {
  MapPin, Castle, Mountain, MountainSnow, Trees, TreePine, Skull, Crown, Swords, Shield,
  House, Church, Anchor, Ship, Tent, Flag, Gem, Coins, Landmark, Waves, Flame, Snowflake,
  Eye, Star, Compass, Key, ScrollText, Footprints, Sparkles, Zap,
};
export const ICON_NAMES: string[] = Object.keys(ICON_SET);

/** Swatch palette: the marker CSS vars + a few extras. "" = default (by type). */
export const COLOR_OPTIONS: { label: string; value: string }[] = [
  { label: "Location", value: "var(--marker-location)" },
  { label: "Faction", value: "var(--marker-faction)" },
  { label: "Character", value: "var(--marker-character)" },
  { label: "Item", value: "var(--marker-item)" },
  { label: "Event", value: "var(--marker-event)" },
  { label: "Red", value: "#c0504d" },
  { label: "Green", value: "#4fae8f" },
  { label: "Blue", value: "#5a8fd0" },
  { label: "Purple", value: "#7c6fd0" },
  { label: "Gold", value: "#e0b050" },
  { label: "Slate", value: "#8a8f98" },
];

export function resolveIcon(name: string | null | undefined): LucideIcon | null {
  if (!name) return null;
  return ICON_SET[name] ?? null;
}

const SIZE_SET = new Set<string>(SIZES);
const SHAPE_SET = new Set<string>(SHAPES);
const LABEL_SET = new Set<string>(LABEL_SIZES);

/** First value that is a member of `set`; else undefined. Guards malformed DB/JSON. */
function firstValid<T extends string>(set: Set<string>, ...vals: (string | null | undefined)[]): T | undefined {
  for (const v of vals) if (v != null && set.has(v)) return v as T;
  return undefined;
}
function firstNonNull(...vals: (string | null | undefined)[]): string | undefined {
  for (const v of vals) if (v != null) return v;
  return undefined;
}

export function resolveMarkerAppearance(
  marker: MarkerAppearanceInput,
  typeDefaults: TypeAppearanceMap,
): ResolvedAppearance {
  const base = visualForType(marker.type, marker.entitySubtype);
  const td = typeDefaults[marker.type] ?? {};

  const size = firstValid<MarkerSize>(SIZE_SET, marker.size, td.size, "md")!;
  const shape = firstValid<MarkerShape>(SHAPE_SET, marker.shape, td.shape, "teardrop")!;
  const labelRaw = firstValid<MarkerLabelSize>(LABEL_SET, marker.labelSize, td.labelSize, "md")!;
  const color = firstNonNull(marker.color, td.color, base.color)!;
  const iconName = firstNonNull(marker.icon, td.icon);
  const icon = resolveIcon(iconName) ?? base.icon;

  const scale = SIZE_SCALE[size];
  const teardrop = shape === "teardrop";
  const width = teardrop ? Math.round(28 * scale) : Math.round(30 * scale);
  const height = teardrop ? Math.round(36 * scale) : Math.round(30 * scale);
  const iconSize = Math.round(14 * scale);

  return {
    width,
    height,
    iconSize,
    shape,
    color,
    icon,
    anchor: teardrop ? "bottom" : "center",
    labelSize: labelRaw === "hide" ? "md" : labelRaw,
    labelHidden: labelRaw === "hide",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/maps/marker-appearance.test.ts` → PASS.
NOTE: if any icon in `ICON_SET` is not exported by the installed `lucide-react`, tsc/the import will error — remove that single name from the import + `ICON_SET` and re-run (keep at least ~20). Confirm with `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add components/maps/marker-appearance.ts components/maps/marker-appearance.test.ts
git commit -m "feat(maps): pure marker-appearance model + resolver"
```

---

## Task 2: Schema + migration + marker types

**Files:** Modify `lib/db/schema.ts`, `lib/db/migrate.ts`, `components/maps/map-types.ts`

- [ ] **Step 1: Add columns to the Drizzle schema**

In `lib/db/schema.ts`, in the `mapMarkers` table (after `minZoom: integer("min_zoom"),`, before `createdAt`), add:

```ts
  size: text("size"),
  shape: text("shape"),
  icon: text("icon"),
  labelSize: text("label_size"),
  color: text("color"),
```

- [ ] **Step 2: Add idempotent migrations**

In `lib/db/migrate.ts`, next to the existing `addColumnIfMissing("map_markers", "min_zoom", "INTEGER");` line, add:

```ts
addColumnIfMissing("map_markers", "size", "TEXT");
addColumnIfMissing("map_markers", "shape", "TEXT");
addColumnIfMissing("map_markers", "icon", "TEXT");
addColumnIfMissing("map_markers", "label_size", "TEXT");
addColumnIfMissing("map_markers", "color", "TEXT");
```

- [ ] **Step 3: Add the fields to the client marker types**

In `components/maps/map-types.ts`, add to the `MarkerData` interface (after `minZoom: number | null;`):

```ts
  size: string | null;
  shape: string | null;
  icon: string | null;
  labelSize: string | null;
  color: string | null;
```

- [ ] **Step 4: Type-check + migration runtime test**

Run: `npx tsc --noEmit` → expect new errors ONLY where markers are constructed without the new fields (fix those in later tasks; note them). Then verify the migration runs cleanly against the existing dev DB:

Run: `node -e "process.env.DB_PATH='./encounter-tracker.db'; require('tsx/cjs'); require('./lib/db/migrate.ts')"` — if that invocation form fails, instead run the app's normal migrate entry (check how `lib/db/index.ts` / `instrumentation.ts` triggers `runMigrations`) OR: `node -e "const D=require('better-sqlite3'); const db=new D('./encounter-tracker.db'); console.log(db.prepare('PRAGMA table_info(map_markers)').all().map(c=>c.name).join(','))"` after starting the dev server once (the server runs migrations on boot). The five columns must appear. Report which method you used.

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts lib/db/migrate.ts components/maps/map-types.ts
git commit -m "feat(maps): add per-pin appearance columns to map_markers"
```

---

## Task 3: Marker create/update APIs persist appearance

**Files:** Modify `app/api/maps/[id]/markers/route.ts` (POST), `app/api/maps/markers/[markerId]/route.ts` (PATCH), `app/api/settings/route.ts`

- [ ] **Step 1: POST — insert the 5 fields**

In `app/api/maps/[id]/markers/route.ts`, in the `.values({ ... })` insert object (after `minZoom: ...,`), add:

```ts
      size: body.size ?? null,
      shape: body.shape ?? null,
      icon: body.icon ?? null,
      labelSize: body.labelSize ?? null,
      color: body.color ?? null,
```

- [ ] **Step 2: PATCH — update the 5 fields**

In `app/api/maps/markers/[markerId]/route.ts`, in the `.set({ ... })` object (after `minZoom: ...,`), add:

```ts
      size: body.size !== undefined ? body.size : existing.size,
      shape: body.shape !== undefined ? body.shape : existing.shape,
      icon: body.icon !== undefined ? body.icon : existing.icon,
      labelSize: body.labelSize !== undefined ? body.labelSize : existing.labelSize,
      color: body.color !== undefined ? body.color : existing.color,
```

- [ ] **Step 3: Settings — allow the appearance key**

In `app/api/settings/route.ts`, add `"marker_appearance"` to the `ALLOWED_KEYS` array. (It is NOT masked; GET returns the raw JSON string.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit` → the marker routes should now type-check (the GET already spreads `{...m}`, so the new columns flow to `ResolvedMarker` automatically).

- [ ] **Step 5: Commit**

```bash
git add "app/api/maps/[id]/markers/route.ts" "app/api/maps/markers/[markerId]/route.ts" app/api/settings/route.ts
git commit -m "feat(api): persist per-pin appearance + allow marker_appearance setting"
```

---

## Task 4: Appearance-parameterize MapMarkerPin + MarkerLabel

**Files:** Modify `components/maps/MapMarkerPin.tsx`, `components/maps/MarkerLabel.tsx`

Both stay PURE (consumed via `renderToStaticMarkup`). The pin draws the resolved shape at the resolved size with the resolved icon/color; every shape uses an inner "card" disc holding the colored icon (uniform look), teardrop keeping its bottom tip.

- [ ] **Step 1: Rewrite `MapMarkerPin.tsx`**

Geometry approach: each shape has a **fixed viewBox** (so the shape/disc paths are simple constants), and the SVG scales via `width`/`height` (px, from the resolver). The icon is positioned with **percentages** (so it tracks the scaled box) at the shape's head center. Teardrop keeps the exact original 28×36 path.

```tsx
// components/maps/MapMarkerPin.tsx
"use client";

import { cn } from "@/lib/utils";
import type { MarkerShape, ResolvedAppearance } from "@/components/maps/marker-appearance";

// Per-shape fixed viewBox, the shape path/element, the inner "card" disc, and the
// head-center as a fraction of the box (for the absolutely-positioned icon).
const SHAPE_GEOM: Record<MarkerShape, { vb: string; disc: { cx: number; cy: number; r: number }; headX: number; headY: number; el: (color: string) => React.ReactNode }> = {
  teardrop: {
    vb: "0 0 28 36",
    disc: { cx: 14, cy: 14, r: 9 },
    headX: 0.5,
    headY: 14 / 36,
    el: (color) => <path d="M14 0C6.3 0 0 6.3 0 14c0 9.6 14 22 14 22s14-12.4 14-22c0-7.7-6.3-14-14-14z" fill={color} />,
  },
  circle: {
    vb: "0 0 30 30",
    disc: { cx: 15, cy: 15, r: 9.6 },
    headX: 0.5,
    headY: 0.5,
    el: (color) => <circle cx="15" cy="15" r="14" fill={color} />,
  },
  square: {
    vb: "0 0 30 30",
    disc: { cx: 15, cy: 15, r: 9.6 },
    headX: 0.5,
    headY: 0.5,
    el: (color) => <rect x="1" y="1" width="28" height="28" rx="6" fill={color} />,
  },
  diamond: {
    vb: "0 0 30 30",
    disc: { cx: 15, cy: 15, r: 8.4 },
    headX: 0.5,
    headY: 0.5,
    el: (color) => <polygon points="15,1 29,15 15,29 1,15" fill={color} />,
  },
};

export function MapMarkerPin({
  appearance,
  selected,
}: {
  appearance: ResolvedAppearance;
  selected?: boolean;
}) {
  const { width, height, iconSize, shape, color, icon: Icon } = appearance;
  const g = SHAPE_GEOM[shape];

  return (
    <div className={cn("relative", selected && "marker-selected marker-bloom")} style={{ width, height }}>
      <svg width={width} height={height} viewBox={g.vb} className="drop-shadow-md">
        {g.el(color)}
        <circle cx={g.disc.cx} cy={g.disc.cy} r={g.disc.r} fill="var(--card)" />
      </svg>
      <Icon
        style={{
          position: "absolute",
          width: iconSize,
          height: iconSize,
          color,
          left: `${g.headX * 100}%`,
          top: `${g.headY * 100}%`,
          transform: "translate(-50%, -50%)",
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `MarkerLabel.tsx`**

```tsx
// components/maps/MarkerLabel.tsx
"use client";

import { LABEL_TEXT_PX } from "@/components/maps/marker-appearance";

// A small text chip rendered under a map marker pin. Pure (stringified via
// renderToStaticMarkup by two canvases). Font size follows labelSize.
export function MarkerLabel({ text, labelSize = "md" }: { text: string; labelSize?: "sm" | "md" | "lg" }) {
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-full mt-0.5 -translate-x-1/2 max-w-[7.5rem] truncate rounded bg-card/85 px-1.5 py-0.5 font-medium leading-tight text-foreground ring-1 ring-border"
      style={{ fontSize: LABEL_TEXT_PX[labelSize] }}
    >
      {text}
    </div>
  );
}
```

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint components/maps/MapMarkerPin.tsx components/maps/MarkerLabel.tsx`
Expected: errors ONLY at the canvas call sites (fixed in Tasks 5-7). The two files themselves lint clean. Confirm no hooks are used (must stay pure).

- [ ] **Step 4: Commit**

```bash
git add components/maps/MapMarkerPin.tsx components/maps/MarkerLabel.tsx
git commit -m "feat(maps): appearance-parameterized MapMarkerPin + MarkerLabel"
```

---

## Task 5: Thread appearance through StaticMapCanvas (+ MapCanvasProps.typeDefaults)

**Files:** Modify `components/maps/map-types.ts`, `components/maps/StaticMapCanvas.tsx`

- [ ] **Step 1: Add `typeDefaults` to `MapCanvasProps`**

In `components/maps/map-types.ts`, add an import at the top and a prop:

```ts
import type { TypeAppearanceMap } from "@/components/maps/marker-appearance";
```
and in `MapCanvasProps` (after `showLabels?: boolean;`):
```ts
  typeDefaults?: TypeAppearanceMap;
```

- [ ] **Step 2: Resolve + pass appearance in StaticMapCanvas**

In `components/maps/StaticMapCanvas.tsx`: import the resolver, read `typeDefaults` from props (default `{}`), and replace the marker render block. Add near the imports:

```ts
import { resolveMarkerAppearance } from "@/components/maps/marker-appearance";
```
Destructure `typeDefaults = {}` from props alongside the others. Replace the `<MapMarkerPin .../>` + label block (currently lines ~96-110) with:

```tsx
{markers.map((m) => {
  const appearance = resolveMarkerAppearance(m, typeDefaults);
  return (
    <div
      key={m.id}
      className={`absolute -translate-x-1/2 ${appearance.anchor === "bottom" ? "-translate-y-full" : "-translate-y-1/2"} ${markersDraggable ? "cursor-move" : "cursor-pointer"}`}
      style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
      onPointerDown={markersDraggable ? (e) => startDrag(m.id, e) : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onMarkerClick(m);
      }}
    >
      <MapMarkerPin appearance={appearance} selected={m.id === selectedId} />
      {showLabels && !appearance.labelHidden && <MarkerLabel text={m.resolvedTitle} labelSize={appearance.labelSize} />}
    </div>
  );
})}
```

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint components/maps/StaticMapCanvas.tsx components/maps/map-types.ts`
Expected: clean for these two (tiled/world still error until Tasks 6-7).

- [ ] **Step 4: Commit**

```bash
git add components/maps/map-types.ts components/maps/StaticMapCanvas.tsx
git commit -m "feat(maps): appearance in StaticMapCanvas + typeDefaults prop"
```

---

## Task 6: Thread appearance through TiledMapCanvas (leaflet anchor math)

**Files:** Modify `components/maps/TiledMapCanvas.tsx`

- [ ] **Step 1: Update `markerIcon` to take appearance + derive iconSize/iconAnchor**

Add the import:
```ts
import { resolveMarkerAppearance, type ResolvedAppearance } from "@/components/maps/marker-appearance";
```
Replace the `markerIcon` function (currently lines ~14-26) with:

```tsx
function markerIcon(marker: ResolvedMarker, appearance: ResolvedAppearance, selected: boolean, showLabels: boolean) {
  const anchor: [number, number] =
    appearance.anchor === "bottom" ? [appearance.width / 2, appearance.height] : [appearance.width / 2, appearance.height / 2];
  return L.divIcon({
    className: "",
    html: renderToStaticMarkup(
      <>
        <MapMarkerPin appearance={appearance} selected={selected} />
        {showLabels && !appearance.labelHidden && <MarkerLabel text={marker.resolvedTitle} labelSize={appearance.labelSize} />}
      </>
    ),
    iconSize: [appearance.width, appearance.height],
    iconAnchor: anchor,
  });
}
```

- [ ] **Step 2: Resolve appearance and pass it + extend the memo deps**

Find where `markerIcon(marker, selected, showLabels)` is called inside the per-marker component (the `useMemo` at lines ~117-121). The canvas receives `typeDefaults` via `MapCanvasProps` — thread it into that inner marker component as a prop (follow how `showLabels` reaches it). Compute the appearance and pass it:

```tsx
const appearance = useMemo(
  () => resolveMarkerAppearance(marker, typeDefaults),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [marker.type, marker.entitySubtype, marker.size, marker.shape, marker.icon, marker.labelSize, marker.color, typeDefaults]
);
const icon = useMemo(
  () => markerIcon(marker, appearance, selected, showLabels),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [appearance, marker.resolvedTitle, selected, showLabels]
);
```

If `typeDefaults` is not currently passed to the inner per-marker component, add it: destructure `typeDefaults = {}` from the canvas props and pass it down alongside `showLabels`/`selected`. Read the file to place this correctly.

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint components/maps/TiledMapCanvas.tsx`
Expected: clean for this file (world still errors until Task 7).

- [ ] **Step 4: Commit**

```bash
git add components/maps/TiledMapCanvas.tsx
git commit -m "feat(maps): appearance + anchor scaling in TiledMapCanvas"
```

---

## Task 7: Thread appearance through WorldMapCanvas (maplibre)

**Files:** Modify `components/maps/WorldMapCanvas.tsx`

WorldMapCanvas has its own `WorldMapCanvasProps` (not the shared `MapCanvasProps`). It builds DOM markers with two `renderToStaticMarkup` blocks (create + update) and diffs `el.dataset` to decide when to re-render. Both blocks need the appearance; the diff needs an appearance signature; the sync effect deps need the marker set (already `[markers, ...]`).

- [ ] **Step 1: Add `typeDefaults` to `WorldMapCanvasProps` + import the resolver**

Add the import:
```ts
import { resolveMarkerAppearance } from "@/components/maps/marker-appearance";
```
Add to `WorldMapCanvasProps` (read lines ~27-39): `typeDefaults?: TypeAppearanceMap;` (import the type). Destructure `typeDefaults = {}` where props are read.

- [ ] **Step 2: Compute appearance + a signature; update both render blocks + the diff**

Inside the marker-sync effect, where it iterates markers (the block around lines ~188-236), compute once per marker:

```ts
const appearance = resolveMarkerAppearance(marker, typeDefaults);
const appSig = `${appearance.width}x${appearance.height}:${appearance.shape}:${appearance.color}:${appearance.labelSize}:${appearance.labelHidden}`;
```

Replace BOTH `renderToStaticMarkup(<>...</>)` blocks (create ~193-198 and update ~228-233) with:

```tsx
renderToStaticMarkup(
  <>
    <MapMarkerPin appearance={appearance} selected={sel} />
    {showLabels && !appearance.labelHidden && <MarkerLabel text={marker.resolvedTitle} labelSize={appearance.labelSize} />}
  </>
)
```

In the create block, after setting `el.dataset.sel`/`el.dataset.lbl`, also set `el.dataset.app = appSig;`. Change the marker anchor from the hardcoded `anchor: "bottom"` to `anchor: appearance.anchor` in the `new Marker({...})` call (line ~213).

In the update diff (line ~227), extend the condition to also re-render when the appearance signature changes:

```ts
if (el.dataset.sel !== (sel ? "1" : "0") || el.dataset.lbl !== (showLabels ? "1" : "0") || el.dataset.app !== appSig) {
```
and after re-rendering set `el.dataset.app = appSig;` alongside the existing dataset writes. (Note: maplibre's marker anchor can't change after creation without recreating the marker; a shape change between bottom/center anchor is an accepted minor imperfection until the pin is re-placed — the size/color/icon/label all update live. Add a comment noting this.)

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint components/maps/WorldMapCanvas.tsx`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/maps/WorldMapCanvas.tsx
git commit -m "feat(maps): appearance in WorldMapCanvas markers"
```

---

## Task 8: Shared `MarkerAppearanceEditor`

**Files:** Create `components/maps/MarkerAppearanceEditor.tsx`

Controlled editor: takes a `MarkerAppearanceOverride` value + `onChange`, plus the marker `type`/`subtype` for the live preview. Every control has a "default" state (undefined/null) so a field can inherit.

- [ ] **Step 1: Create the component**

```tsx
// components/maps/MarkerAppearanceEditor.tsx
"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { MapMarkerPin } from "@/components/maps/MapMarkerPin";
import {
  resolveMarkerAppearance,
  SIZES, SHAPES, LABEL_SIZES, ICON_NAMES, ICON_SET, COLOR_OPTIONS,
  type MarkerAppearanceOverride, type MarkerSize, type MarkerShape, type MarkerLabelSize,
} from "@/components/maps/marker-appearance";
import type { MarkerType } from "@/components/maps/map-types";

interface Props {
  value: MarkerAppearanceOverride;
  onChange: (next: MarkerAppearanceOverride) => void;
  type: MarkerType;
  subtype?: string | null;
}

function Seg<T extends string>({ options, value, onChange, labels }: { options: (T | null)[]; value: T | null | undefined; onChange: (v: T | null) => void; labels?: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((opt) => {
        const active = (value ?? null) === opt;
        return (
          <button key={opt ?? "default"} type="button" onClick={() => onChange(opt)}
            className={cn("rounded-md border px-2 py-1 text-xs", active ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
            {opt === null ? "Default" : (labels?.[opt] ?? opt)}
          </button>
        );
      })}
    </div>
  );
}

export function MarkerAppearanceEditor({ value, onChange, type, subtype }: Props) {
  const set = (patch: Partial<MarkerAppearanceOverride>) => onChange({ ...value, ...patch });
  const preview = resolveMarkerAppearance({ type, entitySubtype: subtype, ...value }, {});

  return (
    <div className="flex gap-4">
      <div className="flex-1 space-y-3">
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Size</p>
          <Seg<MarkerSize> options={[null, ...SIZES]} value={value.size} onChange={(v) => set({ size: v })} labels={{ sm: "S", md: "M", lg: "L", xl: "XL" }} />
        </div>
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Shape</p>
          <Seg<MarkerShape> options={[null, ...SHAPES]} value={value.shape} onChange={(v) => set({ shape: v })} labels={{ teardrop: "Pin", circle: "Circle", square: "Square", diamond: "Diamond" }} />
        </div>
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Label</p>
          <Seg<MarkerLabelSize> options={[null, ...LABEL_SIZES]} value={value.labelSize} onChange={(v) => set({ labelSize: v })} labels={{ sm: "S", md: "M", lg: "L", hide: "Hide" }} />
        </div>
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Color</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => set({ color: null })} className={cn("h-6 rounded-md border px-2 text-xs", !value.color ? "border-primary text-primary" : "border-border text-muted-foreground")}>Default</button>
            {COLOR_OPTIONS.map((c) => (
              <button key={c.value} type="button" aria-label={c.label} onClick={() => set({ color: c.value })}
                className={cn("h-6 w-6 rounded-md border-2", value.color === c.value ? "border-foreground" : "border-transparent")} style={{ backgroundColor: c.value }} />
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Icon</p>
          <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
            <button type="button" onClick={() => set({ icon: null })} className={cn("rounded-md border px-2 py-1 text-xs", !value.icon ? "border-primary text-primary" : "border-border text-muted-foreground")}>Default</button>
            {ICON_NAMES.map((name) => {
              const Icon = ICON_SET[name];
              return (
                <button key={name} type="button" aria-label={name} onClick={() => set({ icon: name })}
                  className={cn("rounded-md border p-1.5", value.icon === name ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
                  <Icon className="w-4 h-4" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex-none w-24 text-center">
        <p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">Preview</p>
        <div className="flex items-end justify-center h-16"><MapMarkerPin appearance={preview} /></div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint components/maps/MarkerAppearanceEditor.tsx` → clean.

- [ ] **Step 3: Commit**

```bash
git add components/maps/MarkerAppearanceEditor.tsx
git commit -m "feat(maps): shared MarkerAppearanceEditor"
```

---

## Task 9: Per-pin appearance in MarkerFormDialog

**Files:** Modify `components/maps/MarkerFormDialog.tsx`

- [ ] **Step 1: Add appearance state seeded from the marker**

Add the import:
```ts
import { MarkerAppearanceEditor } from "@/components/maps/MarkerAppearanceEditor";
import type { MarkerAppearanceOverride, MarkerSize, MarkerShape, MarkerLabelSize } from "@/components/maps/marker-appearance";
```
Add state alongside the others (near `minZoom`):
```ts
const [appearance, setAppearance] = useState<MarkerAppearanceOverride>({
  size: (marker?.size ?? null) as MarkerSize | null,
  shape: (marker?.shape ?? null) as MarkerShape | null,
  icon: marker?.icon ?? null,
  labelSize: (marker?.labelSize ?? null) as MarkerLabelSize | null,
  color: marker?.color ?? null,
});
```

- [ ] **Step 2: Render the editor**

Add an "Appearance" section in the form body (near the minZoom block, before the Save button):
```tsx
<div className="space-y-1.5">
  <label className="text-xs font-medium text-muted-foreground">Appearance</label>
  <MarkerAppearanceEditor value={appearance} onChange={setAppearance} type={type} subtype={marker?.entitySubtype} />
</div>
```

- [ ] **Step 3: Include appearance in the save payload**

In the `payload` object inside `save()` (after `minZoom,`), add:
```ts
  size: appearance.size ?? null,
  shape: appearance.shape ?? null,
  icon: appearance.icon ?? null,
  labelSize: appearance.labelSize ?? null,
  color: appearance.color ?? null,
```

- [ ] **Step 4: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint components/maps/MarkerFormDialog.tsx` → clean. (`MarkerData` now has the 5 fields, so `marker?.size` etc. type-check.)

- [ ] **Step 5: Commit**

```bash
git add components/maps/MarkerFormDialog.tsx
git commit -m "feat(maps): per-pin appearance controls in MarkerFormDialog"
```

---

## Task 10: Per-type "Pin styles" panel + viewer wiring

**Files:** Create `components/maps/PinStylesPanel.tsx`; modify `components/maps/MapViewer.tsx`, `components/maps/WorldMapViewer.tsx`

- [ ] **Step 1: Create `PinStylesPanel.tsx`**

```tsx
// components/maps/PinStylesPanel.tsx
"use client";

import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MarkerAppearanceEditor } from "@/components/maps/MarkerAppearanceEditor";
import { MARKER_TYPES, MARKER_TYPE_META } from "@/components/maps/marker-meta";
import type { TypeAppearanceMap, MarkerAppearanceOverride } from "@/components/maps/marker-appearance";
import type { MarkerType } from "@/components/maps/map-types";

interface Props {
  open: boolean;
  value: TypeAppearanceMap;
  onClose: () => void;
  onSaved: (next: TypeAppearanceMap) => void;
}

export function PinStylesPanel({ open, value, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<TypeAppearanceMap>(value);
  const [saving, setSaving] = useState(false);

  // reseed when reopened with new value
  React.useEffect(() => { if (open) setDraft(value); }, [open, value]);

  const setType = (type: MarkerType, next: MarkerAppearanceOverride) => setDraft((d) => ({ ...d, [type]: next }));

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marker_appearance: JSON.stringify(draft) }),
      });
      onSaved(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Pin styles</DialogTitle></DialogHeader>
        <div className="space-y-5">
          {MARKER_TYPES.map((type) => (
            <div key={type} className="space-y-1.5">
              <p className="text-sm font-medium" style={{ color: MARKER_TYPE_META[type].color }}>{MARKER_TYPE_META[type].label}</p>
              <MarkerAppearanceEditor value={draft[type] ?? {}} onChange={(next) => setType(type, next)} type={type} />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save styles"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire into MapViewer**

In `components/maps/MapViewer.tsx`:
- Import: `import { PinStylesPanel } from "@/components/maps/PinStylesPanel";` and `import { Palette } from "lucide-react";` and `import type { TypeAppearanceMap } from "@/components/maps/marker-appearance";`.
- State: `const [typeDefaults, setTypeDefaults] = useState<TypeAppearanceMap>({});` and `const [stylesOpen, setStylesOpen] = useState(false);`.
- Load the setting: in the mount effect's `Promise.all`, also fetch settings and parse `marker_appearance`:
  ```ts
  const [mapRes, settingsRes] = await Promise.all([fetch(`/api/maps/${id}`), fetch(`/api/settings`), loadMarkers()]).then((r) => [r[0], r[1]] as const);
  ```
  (Adjust to the existing `Promise.all` shape — it currently destructures `[mapRes]`. Add a settings fetch and, after it resolves, `try { setTypeDefaults(JSON.parse(s.marker_appearance ?? "{}")); } catch { setTypeDefaults({}); }`.) Read the file and integrate cleanly with the existing structure; the goal: `typeDefaults` is populated from `GET /api/settings` → `marker_appearance`.
- Toolbar: add a button in the toolbar `<div>` (near Show Labels):
  ```tsx
  <Button size="sm" variant="outline" onClick={() => setStylesOpen(true)} className="gap-1.5">
    <Palette className="w-3.5 h-3.5" /> Pin styles
  </Button>
  ```
- Pass `typeDefaults` to the canvas: add `typeDefaults={typeDefaults}` to the `sharedCanvasProps` object (or the props handed to Static/Tiled canvas).
- Render the panel near the other dialogs:
  ```tsx
  <PinStylesPanel open={stylesOpen} value={typeDefaults} onClose={() => setStylesOpen(false)} onSaved={setTypeDefaults} />
  ```

- [ ] **Step 3: Wire into WorldMapViewer**

Same as Step 2 for `components/maps/WorldMapViewer.tsx`: import `PinStylesPanel`/`Palette`/`TypeAppearanceMap`; add `typeDefaults` + `stylesOpen` state; fetch `/api/settings` (in the world-map get-or-create effect, or a small separate effect) and populate `typeDefaults`; add the "Pin styles" toolbar button; add `typeDefaults={typeDefaults}` to the `<WorldMapCanvas .../>` props; render `<PinStylesPanel .../>`.

- [ ] **Step 4: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint components/maps/PinStylesPanel.tsx components/maps/MapViewer.tsx components/maps/WorldMapViewer.tsx`
Expected: clean. (If reading `s.marker_appearance` needs a type, treat the settings response as `Record<string,string>`.)

- [ ] **Step 5: Commit**

```bash
git add components/maps/PinStylesPanel.tsx components/maps/MapViewer.tsx components/maps/WorldMapViewer.tsx
git commit -m "feat(maps): per-type Pin styles panel + viewer wiring"
```

---

## Task 11: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Tests + type-check + lint**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all tests PASS (incl. `marker-appearance.test.ts`); tsc clean; lint introduces **no new errors** (baseline 0 errors / 14 warnings).

- [ ] **Step 2: Browser — local/city map** (dev server; seed a map + a few markers of different types if needed, or use the world map which already has markers)

- Open a pin's **Edit-pin** dialog → change size, shape, icon, color, label size → save → the pin updates on the map and **persists across reload**.
- Toggle a per-pin **Hide** label with global labels on → that pin's label hides, others show.
- Confirm the **pin tip stays anchored** to its coordinate at every size (teardrop = tip; circle/square/diamond = centered), including after zoom.

- [ ] **Step 3: Browser — world map** (`/world`)

- Same per-pin edits on world markers (maplibre): size/color/icon/label update live; verify persistence.
- Open **Pin styles** → set a whole type (e.g. Location → Large + Square + Red) → Save → **all** Location pins update, while any pin with its own override keeps it (per-pin beats per-type). Reload → the type default persists (from `marker_appearance` setting).
- Confirm no console errors on both maps.

- [ ] **Step 4: Screenshot proof + final commit (if fixups needed)**

Screenshot a map showing customized pins (mixed sizes/shapes/colors) to share.
```bash
git add -A
git commit -m "chore(maps): pin appearance verification fixups"
```

---

## Self-review notes (for the implementer)

- **Purity:** `MapMarkerPin`/`MarkerLabel` must not use hooks (stringified via `renderToStaticMarkup` in tiled + world). The resolver runs in the canvas, not the pin.
- **Anchor scaling:** teardrop anchors at its bottom tip; circle/square/diamond anchor at center. Static uses `-translate-y-full` vs `-translate-y-1/2`; tiled uses `iconAnchor` `[w/2,h]` vs `[w/2,h/2]`; world uses maplibre `anchor` `"bottom"` vs `"center"` (set at marker creation — a later shape change between anchor modes only fully re-anchors when the pin is re-placed; size/color/icon/label update live — documented).
- **Backwards compatible:** all 5 columns nullable; existing pins (all-null) resolve to exactly today's look (md teardrop, type color/icon).
- **Layering:** per-pin override → per-type default → built-in, via `resolveMarkerAppearance`. `MarkerAppearanceEditor` uses `null` to mean "inherit".
- **Icon set:** curated explicit imports only. If any name isn't in the installed lucide-react, drop it from the import + `ICON_SET` (Task 1 note).
- **No new test tooling:** only the resolver is unit-tested; everything else browser-verified.
```
