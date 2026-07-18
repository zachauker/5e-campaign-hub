# Marker Label Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-map toolbar toggle on the world map and city maps that shows/hides text labels (each visible marker's `resolvedTitle`) directly on the map.

**Architecture:** A tiny localStorage helper (`marker-labels.ts`) persists the on/off flag per map (`markerLabels:${mapId}`). Each viewer (`MapViewer`, `WorldMapViewer`) owns a `showLabels` boolean, seeded from that helper, exposed via a `Tag`-icon toolbar button, and threaded as a prop into whichever canvas it renders. A shared presentational `MarkerLabel` component renders a truncated chip absolutely positioned below the pin; all three canvases render it the same way so geometry is identical. No API, schema, or data-model changes — labels reuse the existing `resolvedTitle`.

**Tech Stack:** Next.js (client components), React, TypeScript, Tailwind, lucide-react icons, react-leaflet (tiled), MapLibre GL (world), react-zoom-pan-pinch (static), Vitest (node env).

---

## Key facts the implementer needs

- A marker's display text is `marker.resolvedTitle` (already present on every `ResolvedMarker`; see [`components/maps/map-types.ts:16-21`](../../../components/maps/map-types.ts)). Never use `marker.title` — that's the optional raw override.
- Each canvas already receives the **pre-filtered** marker list (layer filter + event-date filter applied in the viewers), so rendering a label for every marker the canvas is handed automatically means "only visible markers get labels." Do NOT re-filter inside the canvases.
- Existing persistence patterns to mirror: `readHiddenLayers` in [`components/maps/marker-layers.ts:101-110`](../../../components/maps/marker-layers.ts) and the `theme` seeding in [`components/maps/WorldMapViewer.tsx:33-36`](../../../components/maps/WorldMapViewer.tsx). Both avoid set-state-in-effect by seeding during render.
- Vitest environment is `node` (see `vitest.config.ts`) — `window`/`localStorage` are undefined by default. The localStorage helper test must stub `window` via `vi.stubGlobal`.
- Button variant `"initiative"` is the project's "active toggle" style (already used for Move Pins / Add Marker). Use it for the labels toggle's active state.
- Tailwind opacity modifiers on CSS-var colors work here — `bg-card/90` is already used at [`components/maps/WorldMapCanvas.tsx:278`](../../../components/maps/WorldMapCanvas.tsx).

---

### Task 1: `marker-labels.ts` persistence helper (TDD)

**Files:**
- Create: `components/maps/marker-labels.ts`
- Test: `components/maps/marker-labels.test.ts`

- [ ] **Step 1: Write the failing test**

Create `components/maps/marker-labels.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readShowLabels, writeShowLabels } from "./marker-labels";

function fakeWindow() {
  const store = new Map<string, string>();
  return {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
}

describe("marker-labels persistence", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to false when nothing is stored", () => {
    vi.stubGlobal("window", fakeWindow());
    expect(readShowLabels("map-1")).toBe(false);
  });

  it("round-trips a true value", () => {
    vi.stubGlobal("window", fakeWindow());
    writeShowLabels("map-1", true);
    expect(readShowLabels("map-1")).toBe(true);
  });

  it("round-trips a false value", () => {
    vi.stubGlobal("window", fakeWindow());
    writeShowLabels("map-1", true);
    writeShowLabels("map-1", false);
    expect(readShowLabels("map-1")).toBe(false);
  });

  it("keys are per-map", () => {
    vi.stubGlobal("window", fakeWindow());
    writeShowLabels("map-1", true);
    expect(readShowLabels("map-2")).toBe(false);
  });

  it("treats a malformed stored value as false", () => {
    const w = fakeWindow();
    w.localStorage.setItem("markerLabels:map-1", "garbage");
    vi.stubGlobal("window", w);
    expect(readShowLabels("map-1")).toBe(false);
  });
});

describe("marker-labels without window", () => {
  beforeEach(() => vi.stubGlobal("window", undefined));
  afterEach(() => vi.unstubAllGlobals());

  it("readShowLabels returns false and writeShowLabels is a no-op", () => {
    expect(readShowLabels("map-1")).toBe(false);
    expect(() => writeShowLabels("map-1", true)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/maps/marker-labels.test.ts`
Expected: FAIL — cannot import `readShowLabels`/`writeShowLabels` (module does not exist).

- [ ] **Step 3: Write minimal implementation**

Create `components/maps/marker-labels.ts`:

```ts
// Per-map show/hide state for on-map marker labels, persisted in localStorage
// under `markerLabels:${mapId}`. Mirrors the readHiddenLayers pattern in
// marker-layers.ts: safe on the server and against malformed storage, so it can
// seed React state during render without a set-state-in-effect hydration step.

const keyFor = (mapId: string) => `markerLabels:${mapId}`;

// Read the persisted "show labels" flag for a map. Defaults to false (labels
// off). Returns false on the server or if storage is unavailable/malformed.
export function readShowLabels(mapId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(keyFor(mapId)) === "true";
  } catch {
    return false;
  }
}

// Persist the "show labels" flag for a map. No-op on the server or if storage
// is unavailable.
export function writeShowLabels(mapId: string, value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(mapId), value ? "true" : "false");
  } catch {
    // ignore storage failures (quota, disabled, etc.)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/maps/marker-labels.test.ts`
Expected: PASS (7 tests across 2 describe blocks).

- [ ] **Step 5: Commit**

```bash
git add components/maps/marker-labels.ts components/maps/marker-labels.test.ts
git commit -m "feat(maps): per-map marker-label show/hide persistence helper"
```

---

### Task 2: `MarkerLabel` presentational component

**Files:**
- Create: `components/maps/MarkerLabel.tsx`

The chip is absolutely positioned so it hangs below the pin **without changing the pin's layout box** — this keeps the pin tip anchored to the marker coordinate in all three canvases (critical for the MapLibre world map, whose markers anchor on their bottom edge). It is `pointer-events-none` so clicks pass through to the pin.

- [ ] **Step 1: Create the component**

Create `components/maps/MarkerLabel.tsx`:

```tsx
"use client";

// A small text chip rendered under a map marker pin. Absolutely positioned so
// it does not affect the pin's layout box (keeps the pin tip on its coordinate)
// and non-interactive so marker clicks still register. Used identically by the
// static, tiled, and world canvases — two of which stringify it via
// renderToStaticMarkup — so it stays a pure presentational component.
export function MarkerLabel({ text }: { text: string }) {
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-full mt-0.5 -translate-x-1/2 max-w-[7.5rem] truncate rounded bg-card/85 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-foreground ring-1 ring-border"
    >
      {text}
    </div>
  );
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). The component is not yet imported anywhere; this just confirms it compiles.

- [ ] **Step 3: Commit**

```bash
git add components/maps/MarkerLabel.tsx
git commit -m "feat(maps): MarkerLabel chip component for on-map marker titles"
```

---

### Task 3: Thread `showLabels` through the canvas prop types

**Files:**
- Modify: `components/maps/map-types.ts:35-46` (add optional `showLabels` to `MapCanvasProps`)
- Modify: `components/maps/WorldMapCanvas.tsx:26-37` (add `showLabels` to `WorldMapCanvasProps`)

- [ ] **Step 1: Add `showLabels` to `MapCanvasProps`**

In `components/maps/map-types.ts`, inside the `MapCanvasProps` interface, add the field after `selectedId`:

```ts
export interface MapCanvasProps {
  map: MapData;
  markers: ResolvedMarker[];
  addMode: boolean;
  markersDraggable: boolean;
  selectedId: string | null;
  showLabels?: boolean;
  onImageClick: (pos: { x: number; y: number }) => void;
  onMarkerClick: (marker: ResolvedMarker) => void;
  onMarkerDragMove: (markerId: string, pos: { x: number; y: number }) => void;
  onMarkerDragEnd: (markerId: string, pos: { x: number; y: number }) => void;
  onZoomChange?: (zoom: number) => void;
}
```

- [ ] **Step 2: Add `showLabels` to `WorldMapCanvasProps`**

In `components/maps/WorldMapCanvas.tsx`, add the field to the interface (after `selectedId`):

```ts
export interface WorldMapCanvasProps {
  theme: string;
  addMode: boolean;
  markersDraggable: boolean;
  onMapClick: (lngLat: { lng: number; lat: number }) => void;
  onReady?: (map: MapLibreMap) => void;
  onZoomChange?: (zoom: number) => void;
  markers: ResolvedMarker[];
  selectedId: string | null;
  showLabels: boolean;
  onMarkerClick: (marker: ResolvedMarker) => void;
  onMarkerDragEnd: (markerId: string, lngLat: { lng: number; lat: number }) => void;
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: PASS. `showLabels` is optional on `MapCanvasProps` (so existing call sites still compile) and required on `WorldMapCanvasProps` (its single call site is updated in Task 8; if you run tsc before Task 8 this file compiles, but the `WorldMapViewer` call site will error until Task 8 — that's expected and fine to defer, or do Tasks 6–8 before the next tsc gate).

- [ ] **Step 4: Commit**

```bash
git add components/maps/map-types.ts components/maps/WorldMapCanvas.tsx
git commit -m "feat(maps): add showLabels to canvas prop types"
```

---

### Task 4: Render labels in `StaticMapCanvas`

**Files:**
- Modify: `components/maps/StaticMapCanvas.tsx:1-18` (import + destructure), `:94-107` (render label)

- [ ] **Step 1: Import `MarkerLabel` and destructure `showLabels`**

At the top of `components/maps/StaticMapCanvas.tsx`, add the import after the `MapMarkerPin` import (line 5):

```tsx
import { MapMarkerPin } from "@/components/maps/MapMarkerPin";
import { MarkerLabel } from "@/components/maps/MarkerLabel";
```

Add `showLabels = false` to the destructured props (the function signature starting at line 8):

```tsx
export function StaticMapCanvas({
  map,
  markers,
  addMode,
  markersDraggable,
  selectedId,
  showLabels = false,
  onImageClick,
  onMarkerClick,
  onMarkerDragMove,
  onMarkerDragEnd,
}: MapCanvasProps) {
```

- [ ] **Step 2: Render the label inside each marker's positioned wrapper**

Replace the marker render block (lines 94–107) — add the label as a sibling of `MapMarkerPin` inside the existing positioned `<div>`:

```tsx
            {markers.map((m) => (
              <div
                key={m.id}
                className={`absolute -translate-x-1/2 -translate-y-full ${markersDraggable ? "cursor-move" : "cursor-pointer"}`}
                style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
                onPointerDown={markersDraggable ? (e) => startDrag(m.id, e) : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  onMarkerClick(m);
                }}
              >
                <MapMarkerPin type={m.type} subtype={m.entitySubtype} selected={m.id === selectedId} />
                {showLabels && <MarkerLabel text={m.resolvedTitle} />}
              </div>
            ))}
```

(The wrapper `<div>` is `absolute`, so it is the positioning context for the absolutely-positioned label; the label hangs below the pin without shifting it.)

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/maps/StaticMapCanvas.tsx
git commit -m "feat(maps): render marker labels on the static canvas"
```

(Visual verification happens in Task 9 against the running dev server.)

---

### Task 5: Render labels in `TiledMapCanvas`

**Files:**
- Modify: `components/maps/TiledMapCanvas.tsx:8-9` (import), `:13-20` (`markerIcon` signature), `:78-134` (`MarkerWithReveal` prop + memo), `:136-147` (destructure), `:190-204` (pass prop)

- [ ] **Step 1: Import `MarkerLabel`**

After the `MapMarkerPin` import (line 8):

```tsx
import { MapMarkerPin } from "@/components/maps/MapMarkerPin";
import { MarkerLabel } from "@/components/maps/MarkerLabel";
```

- [ ] **Step 2: Extend `markerIcon` to include the label**

Replace `markerIcon` (lines 13–20). Take the whole marker so it can read `resolvedTitle`, plus a `showLabels` flag:

```tsx
function markerIcon(marker: ResolvedMarker, selected: boolean, showLabels: boolean) {
  return L.divIcon({
    className: "",
    html: renderToStaticMarkup(
      <>
        <MapMarkerPin type={marker.type} subtype={marker.entitySubtype} selected={selected} />
        {showLabels && <MarkerLabel text={marker.resolvedTitle} />}
      </>
    ),
    iconSize: [28, 36],
    iconAnchor: [14, 36],
  });
}
```

(The Leaflet icon container is `position:absolute` and sized 28×36; the label is `absolute top-full left-1/2`, so it centers under the pin and hangs below without moving the anchor.)

- [ ] **Step 3: Add `showLabels` to `MarkerWithReveal` and its icon memo**

In the `MarkerWithReveal` props type (lines 89–100), add `showLabels: boolean;` after `selected: boolean;`. Then update the destructure list (lines 78–89) to include `showLabels`, and replace the `icon` memo (lines 109–112):

```tsx
  const icon = useMemo(
    () => markerIcon(marker, selected, showLabels),
    [marker.type, marker.entitySubtype, marker.resolvedTitle, selected, showLabels]
  );
```

The updated component header (lines 78–100) becomes:

```tsx
function MarkerWithReveal({
  marker,
  selected,
  showLabels,
  position,
  draggable,
  onMarkerClick,
  onMarkerDragMove,
  onMarkerDragEnd,
  width,
  height,
  maxZoom,
}: {
  marker: ResolvedMarker;
  selected: boolean;
  showLabels: boolean;
  position: L.LatLng;
  draggable: boolean;
  onMarkerClick: (marker: ResolvedMarker) => void;
  onMarkerDragMove: (markerId: string, pos: { x: number; y: number }) => void;
  onMarkerDragEnd: (markerId: string, pos: { x: number; y: number }) => void;
  width: number;
  height: number;
  maxZoom: number;
}) {
```

- [ ] **Step 4: Destructure `showLabels` in `TiledMapCanvas` and pass it down**

Add `showLabels = false` to the `TiledMapCanvas` destructure (lines 136–147), after `selectedId`:

```tsx
export function TiledMapCanvas({
  map,
  markers,
  addMode,
  markersDraggable,
  selectedId,
  showLabels = false,
  onImageClick,
  onMarkerClick,
  onMarkerDragMove,
  onMarkerDragEnd,
  onZoomChange,
}: MapCanvasProps) {
```

Then pass it to each `MarkerWithReveal` (in the `markers.map` at lines 190–204), adding the prop after `selected`:

```tsx
        {markers.map((m) => (
          <MarkerWithReveal
            key={m.id}
            marker={m}
            selected={m.id === selectedId}
            showLabels={showLabels}
            position={fractionalToLatLng(m.x, m.y)}
            draggable={markersDraggable}
            onMarkerClick={onMarkerClick}
            onMarkerDragMove={onMarkerDragMove}
            onMarkerDragEnd={onMarkerDragEnd}
            width={width}
            height={height}
            maxZoom={maxZoom}
          />
        ))}
```

- [ ] **Step 5: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/maps/TiledMapCanvas.tsx
git commit -m "feat(maps): render marker labels on the tiled canvas"
```

---

### Task 6: Render labels in `WorldMapCanvas`

**Files:**
- Modify: `components/maps/WorldMapCanvas.tsx:9-10` (import), `:53-64` (destructure `showLabels`), `:169-228` (marker-sync effect: create + update branches + deps)

The world canvas builds markers imperatively and regenerates a pin's markup only when its selected state flips. Labels are folded into that same markup and tracked with a `data-lbl` flag so a `showLabels` toggle regenerates existing pins too.

> **Correction (post-review):** an earlier draft of this task set `el.style.position = "relative"` on the marker element. Do **not** — MapLibre's own stylesheet sets `.maplibregl-marker { position: absolute }` and positions markers via a transform that assumes that absolute box origin; overriding it to `relative` displaces every pin off its coordinate. The absolutely-positioned `MarkerLabel` already anchors correctly against MapLibre's `position: absolute`, so no `position` override is needed. Steps below reflect the corrected version.

- [ ] **Step 1: Import `MarkerLabel`**

After the `MapMarkerPin` import (line 9):

```tsx
import { MapMarkerPin } from "@/components/maps/MapMarkerPin";
import { MarkerLabel } from "@/components/maps/MarkerLabel";
```

- [ ] **Step 2: Destructure `showLabels` from props**

In the `WorldMapCanvas` destructure (lines 53–64), add `showLabels` after `selectedId`:

```tsx
export function WorldMapCanvas({
  theme,
  addMode,
  markersDraggable,
  onMapClick,
  onReady,
  onZoomChange,
  markers,
  selectedId,
  showLabels,
  onMarkerClick,
  onMarkerDragEnd,
}: WorldMapCanvasProps) {
```

- [ ] **Step 3: Fold the label into the create branch**

In the marker-sync effect, replace the create branch (lines 188–213) so the element renders the optional label and records `data-lbl` (do **not** set `el.style.position` — see the correction note above):

```tsx
      if (!inst) {
        const el = document.createElement("div");
        el.innerHTML = renderToStaticMarkup(
          <>
            <MapMarkerPin type={marker.type} subtype={marker.entitySubtype} selected={sel} />
            {showLabels && <MarkerLabel text={marker.resolvedTitle} />}
          </>
        );
        el.dataset.sel = sel ? "1" : "0";
        el.dataset.lbl = showLabels ? "1" : "0";
        // Staggered rise-in for newly-revealed pins (skip the selected one — it
        // gets the bloom instead, and two transform animations would fight).
        const pin = el.firstElementChild as HTMLElement | null;
        if (pin && !sel) {
          pin.classList.add("marker-rise");
          pin.style.animationDelay = `${Math.min(revealIndex * 14, 280)}ms`;
          revealIndex++;
        }
        el.addEventListener("click", (evt) => {
          evt.stopPropagation();
          markerCbRef.current.onMarkerClick(marker);
        });
        inst = new Marker({ element: el, draggable: markersDraggableRef.current, anchor: "bottom" })
          .setLngLat(lngLat)
          .addTo(glMap);
        inst.on("dragend", () => {
          const { lng, lat } = inst!.getLngLat();
          markerCbRef.current.onMarkerDragEnd(marker.id, { lng, lat });
        });
        instances.set(marker.id, inst);
      } else {
```

(`el.firstElementChild` is still the pin because it renders first in the fragment; the rise animation targets the pin, not the label.)

- [ ] **Step 4: Regenerate on label OR selection change in the update branch**

Replace the update (`else`) branch (lines 214–226):

```tsx
      } else {
        inst.setLngLat(lngLat);
        // Regenerate the pin+label markup when either the selected state or the
        // label visibility changes. This stops per-zoom churn (a perf win) and
        // lets the freshly-mounted selected pin play its one-shot arrival bloom.
        const el = inst.getElement();
        if (el.dataset.sel !== (sel ? "1" : "0") || el.dataset.lbl !== (showLabels ? "1" : "0")) {
          el.innerHTML = renderToStaticMarkup(
            <>
              <MapMarkerPin type={marker.type} subtype={marker.entitySubtype} selected={sel} />
              {showLabels && <MarkerLabel text={marker.resolvedTitle} />}
            </>
          );
          el.dataset.sel = sel ? "1" : "0";
          el.dataset.lbl = showLabels ? "1" : "0";
        }
      }
```

- [ ] **Step 5: Add `showLabels` to the effect dependency array**

Update the marker-sync effect's dependency array (line 228) so toggling labels re-runs it:

```tsx
  }, [markers, selectedId, ready, zoom, showLabels]);
```

- [ ] **Step 6: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: PASS for this file. (`WorldMapViewer`'s call site still omits `showLabels` until Task 8 — that error is expected now and resolved there.)

- [ ] **Step 7: Commit**

```bash
git add components/maps/WorldMapCanvas.tsx
git commit -m "feat(maps): render marker labels on the world canvas"
```

---

### Task 7: Toolbar toggle in `MapViewer` (city maps)

**Files:**
- Modify: `components/maps/MapViewer.tsx:10` (icon import), `:21` (helper import), `:63-75` (state seeding), `:263-273` (pass prop), `:311-313` (toolbar button)

- [ ] **Step 1: Import the `Tag` icon and the helper**

Update the lucide import (line 10) to include `Tag`:

```tsx
import { ArrowLeft, Loader2, Plus, X, ChevronRight, Move, Pencil, Trash2, Tag } from "lucide-react";
```

Add the helper import after the `marker-layers` import (line 21):

```tsx
import { isMarkerVisible, readHiddenLayers } from "@/components/maps/marker-layers";
import { readShowLabels, writeShowLabels } from "@/components/maps/marker-labels";
```

- [ ] **Step 2: Seed `showLabels` state (per-map, during render)**

Immediately after the `hidden` seeding block (after line 70, before `updateHidden`), add — mirroring the same set-state-in-render pattern:

```tsx
  const [showLabels, setShowLabels] = useState<boolean>(() => readShowLabels(id));
  const [labelsLoadedFor, setLabelsLoadedFor] = useState(id);
  if (id !== labelsLoadedFor) {
    setLabelsLoadedFor(id);
    setShowLabels(readShowLabels(id));
  }

  function toggleLabels() {
    const next = !showLabels;
    setShowLabels(next);
    writeShowLabels(id, next);
  }
```

- [ ] **Step 3: Pass `showLabels` into the canvases**

Add `showLabels` to the `sharedCanvasProps` object (lines 263–273), after `selectedId`:

```tsx
  const sharedCanvasProps = {
    map,
    markers: filterByEventDate(markers.filter((m) => isMarkerVisible(m, hidden)), selectedDate),
    addMode,
    markersDraggable: moveMode,
    selectedId,
    showLabels,
    onImageClick: handleCanvasClick,
    onMarkerClick: handleMarkerClick,
    onMarkerDragMove: handleMarkerDragMove,
    onMarkerDragEnd: handleMarkerDragEnd,
  };
```

- [ ] **Step 4: Add the toolbar toggle button**

In the toolbar, insert the button immediately after `<MarkerLayerControl ... />` (line 313):

```tsx
          <MarkerLayerControl markers={markers} hidden={hidden} onChange={updateHidden} />
          <Button
            size="sm"
            variant={showLabels ? "initiative" : "outline"}
            onClick={toggleLabels}
            className="gap-1.5"
            title="Show or hide marker name labels on the map"
          >
            <Tag className="w-3.5 h-3.5" />
            {showLabels ? "Hide Labels" : "Show Labels"}
          </Button>
```

- [ ] **Step 5: Verify it type-checks and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS (no type errors, no new lint errors).

- [ ] **Step 6: Commit**

```bash
git add components/maps/MapViewer.tsx
git commit -m "feat(maps): Show Labels toggle on the city map toolbar"
```

---

### Task 8: Toolbar toggle in `WorldMapViewer`

**Files:**
- Modify: `components/maps/WorldMapViewer.tsx:5` (icon import), `:12` (helper import), `:48-63` (state seeding), `:209` (toolbar button), `:252-262` (pass prop)

- [ ] **Step 1: Import the `Tag` icon and the helper**

Update the lucide import (line 5) to include `Tag`:

```tsx
import { Loader2, Plus, X, Download, Move, Tag } from "lucide-react";
```

Add the helper import after the `marker-layers` import (line 12):

```tsx
import { isMarkerVisible, readHiddenLayers } from "@/components/maps/marker-layers";
import { readShowLabels, writeShowLabels } from "@/components/maps/marker-labels";
```

- [ ] **Step 2: Seed `showLabels` state (per-map, once `worldMapId` is known)**

After the `hidden` seeding block and `updateHidden` (after line 63), add — mirroring the `hidden`/`hiddenLoadedFor` async-seed pattern:

```tsx
  const [showLabels, setShowLabels] = useState(false);
  const [labelsLoadedFor, setLabelsLoadedFor] = useState<string | null>(null);
  if (worldMapId && worldMapId !== labelsLoadedFor) {
    setLabelsLoadedFor(worldMapId);
    setShowLabels(readShowLabels(worldMapId));
  }

  function toggleLabels() {
    const next = !showLabels;
    setShowLabels(next);
    if (worldMapId) writeShowLabels(worldMapId, next);
  }
```

- [ ] **Step 3: Add the toolbar toggle button**

Insert the button immediately after `<MarkerLayerControl ... />` (line 209):

```tsx
          <MarkerLayerControl markers={markers} hidden={hidden} onChange={updateHidden} />
          <Button
            size="sm"
            variant={showLabels ? "initiative" : "outline"}
            onClick={toggleLabels}
            className="gap-1.5"
            title="Show or hide marker name labels on the map"
          >
            <Tag className="w-3.5 h-3.5" />
            {showLabels ? "Hide Labels" : "Show Labels"}
          </Button>
```

- [ ] **Step 4: Pass `showLabels` into `WorldMapCanvas`**

In the `<WorldMapCanvas ... />` element (lines 252–262), add the prop after `selectedId`:

```tsx
        <WorldMapCanvas
          theme={theme}
          markers={visibleMarkers}
          selectedId={selectedId}
          showLabels={showLabels}
          addMode={addMode}
          markersDraggable={moveMode}
          onMapClick={handleMapClick}
          onMarkerClick={(m) => setSelectedId(m.id === selectedId ? null : m.id)}
          onMarkerDragEnd={handleMarkerDragEnd}
          onZoomChange={setViewZoom}
        />
```

- [ ] **Step 5: Verify it type-checks and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. This resolves the `WorldMapCanvas` required-prop error deferred from Task 6.

- [ ] **Step 6: Commit**

```bash
git add components/maps/WorldMapViewer.tsx
git commit -m "feat(maps): Show Labels toggle on the world map toolbar"
```

---

### Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite and static checks**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all tests pass (including the new `marker-labels.test.ts`), no type errors, no lint errors.

- [ ] **Step 2: Browser-verify each canvas variant**

Start the dev server via the preview tool (`preview_start` with the dev config) and, for each of the three map types, confirm:

1. **Static city map** (a map with `renderMode: "static"`): toolbar shows a "Show Labels" button; clicking it reveals a title chip below each visible pin; clicking again hides them; the pin is still clickable (popup opens) with labels on; long titles truncate with an ellipsis; reload the page and confirm the state persisted for that map.
2. **Tiled city map** (`renderMode: "tiled"`): same checks; also confirm labels only appear for pins currently revealed by zoom (`minZoom`) and respect the Layers + date filters.
3. **World map** (`/world`): same checks; toggling labels does not shift any pin off its coordinate; labels appear/disappear on existing pins without a page reload; per-map persistence holds on reload.

Confirm labels respect filters: hide a layer via the Layers control (or pick a specific date) and verify hidden markers show no label.

- [ ] **Step 3: Capture proof**

Take a screenshot of each viewer with labels on and share it. Check `read_console_messages` for errors.

- [ ] **Step 4: Final commit (if any verification fixes were needed)**

Only if Step 2 surfaced issues that required source changes:

```bash
git add -A
git commit -m "fix(maps): address marker-label verification findings"
```

---

## Self-review notes

- **Spec coverage:** per-map persistence (Tasks 1, 7, 8) ✓; toolbar toggle both viewers (Tasks 7, 8) ✓; labels only for visible markers — inherent, canvases get the pre-filtered list (noted in Key facts) ✓; below-the-pin placement + truncation (Task 2 `MarkerLabel`) ✓; reuse `resolvedTitle`, no API/schema change ✓; three canvases each render labels (Tasks 4, 5, 6) ✓.
- **Type consistency:** helper names `readShowLabels`/`writeShowLabels` used identically in Tasks 1, 7, 8. `MarkerLabel` prop is `text` everywhere. `markerIcon(marker, selected, showLabels)` signature matches its single call in Task 5's memo. `showLabels` optional on `MapCanvasProps`, required on `WorldMapCanvasProps` — both call sites supply it.
- **Ordering note:** `npx tsc --noEmit` is fully green only after Task 8 (world canvas requires the prop). Tasks 6→8 should be completed before treating a global tsc as a gate; per-file expectations are called out in each task.
