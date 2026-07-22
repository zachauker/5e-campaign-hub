# Map Pin Quick-View Slide-Over Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every map pin type (local + world maps) a single consistent left-docked slide-over quick view, reusing SP1's `EntityQuickView` for entity-backed pins.

**Architecture:** One `MarkerSlideOver` shell owns the panel chrome (header via `markerVisual`, scrollable body, single footer) and switches the body on `marker.type`. Entity pins (location/character/faction) render SP1's entity summary sections (via a small refactor that exposes `EntityQuickView`'s body without its page header/footer); event pins render an extracted `EventNoteBody` (the Notion-page fetch/render); note/sub-map render inline. The shell replaces both current panels (`MarkerInfoPanel` retired, `EventNotePanel` folded in) in `MapViewer` and `WorldMapViewer` — giving the world map rich panels + event support for the first time.

**Tech Stack:** Next.js 16 client components, React 19, Tailwind v4, lucide-react, Vitest (node env — pure-logic tests only; components browser-verified per repo convention).

**Testing convention:** Same as SP1 — Vitest runs in `node` (no jsdom). Only pure logic is unit-tested (here: the `marker.type → resourcePath` mapping). Components and wiring are verified in the browser on a local/city map AND the world map. No component-render tests, no new test tooling.

---

## File structure

**New files**
- `components/maps/marker-slideover-target.ts` (+ `.test.ts`) — pure `entityTargetOf(marker)` mapping.
- `components/maps/EventNoteBody.tsx` — event body extracted from `EventNotePanel`.
- `components/maps/MarkerSlideOver.tsx` — the shell.

**Modified files**
- `components/entities/EntityQuickView.tsx` — refactor to expose a body (`EntityQuickViewBody`) + sections + a fetch hook, without changing the entity-page popover's behavior.
- `components/maps/MapViewer.tsx` — sub-map pins open the panel (stop navigating on click); replace the two panel branches with `<MarkerSlideOver>`.
- `components/maps/WorldMapViewer.tsx` — replace `MarkerInfoPanel` with `<MarkerSlideOver>`.

**Deleted files**
- `components/maps/MarkerInfoPanel.tsx`
- `components/maps/EventNotePanel.tsx`

**Untouched (reused):** `components/maps/marker-meta.ts` (`markerVisual`), `components/maps/map-types.ts` (`ResolvedMarker`), `components/glossary/NotionBlocks.tsx`, `NotionPropsTable`, `RelatedCard`, the marker edit/delete flows and `MarkerFormDialog` in both viewers.

---

## Task 1: Refactor EntityQuickView to expose a reusable body

**Files:**
- Modify (full rewrite): `components/entities/EntityQuickView.tsx`

Splits the fetch into a hook, the sections into a pure component, and adds `EntityQuickViewBody` (fetch + sections, no page header/footer) for the map shell. `EntityQuickView`'s public API and rendered output are unchanged, so the SP1 popover keeps working.

- [ ] **Step 1: Replace the file contents**

```tsx
// components/entities/EntityQuickView.tsx
"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ArrowUpRight, Pencil, MapPin, Users, Package, Flag, type LucideIcon } from "lucide-react";
import { NotionPropsTable } from "@/components/glossary/NotionPropsTable";
import { RelatedCard } from "@/components/glossary/RelatedCard";
import {
  buildEntityQuickView,
  type EntityQuickViewModel,
  type EntityResourcePath,
  type EntityDetailResponse,
} from "@/components/entities/entity-quick-view-model";

const ENTITY_ICON: Record<EntityResourcePath, LucideIcon> = {
  characters: Users,
  locations: MapPin,
  items: Package,
  factions: Flag,
};

const ENTITY_ACCENT: Record<EntityResourcePath, string> = {
  characters: "var(--marker-character)",
  locations: "var(--marker-location)",
  items: "var(--marker-item)",
  factions: "var(--marker-faction)",
};

function LoadingRow() {
  return (
    <div className="flex items-center justify-center py-6 text-muted-foreground">
      <Loader2 className="w-4 h-4 animate-spin" />
    </div>
  );
}

function ErrorRow() {
  return <p className="py-4 text-sm text-destructive">Couldn&apos;t load this entity.</p>;
}

/** Fetches an entity's detail and builds the quick-view model (cancellation-guarded). */
export function useEntityQuickViewModel(resourcePath: EntityResourcePath, id: string) {
  const [raw, setRaw] = useState<EntityDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(`/api/${resourcePath}/${id}`);
        if (cancelled) return;
        if (res.ok) {
          setRaw((await res.json()) as EntityDetailResponse);
        } else {
          setError(true);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [resourcePath, id]);

  const model = raw ? buildEntityQuickView(resourcePath, raw) : null;
  return { raw, model, loading, error };
}

/** Pure body sections (description / key props / related). Shared by the entity-page
 *  popover and the map slide-over. */
export function EntityQuickViewSections({ model }: { model: EntityQuickViewModel }) {
  return (
    <>
      {model.description && (
        <p className="mt-2.5 text-[13px] leading-relaxed text-foreground/80 line-clamp-3">{model.description}</p>
      )}

      {model.props.length > 0 && (
        <div className="mt-3">
          <NotionPropsTable props={model.props} />
        </div>
      )}

      {model.related.map((g) => (
        <div key={g.label} className="mt-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">{g.label}</p>
          <div className="flex flex-wrap gap-1.5">
            {g.items.map((it) => (
              <RelatedCard key={it.id} href={it.href} name={it.name} type={it.type ?? ""} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/** Body-only variant: fetch + loading/error + sections, no header/footer.
 *  Used by the map slide-over (which supplies its own marker header + footer). */
export function EntityQuickViewBody({ resourcePath, id }: { resourcePath: EntityResourcePath; id: string }) {
  const { model, loading, error } = useEntityQuickViewModel(resourcePath, id);
  if (loading) return <LoadingRow />;
  if (error || !model) return <ErrorRow />;
  return (
    <div className="text-sm">
      <EntityQuickViewSections model={model} />
    </div>
  );
}

interface EntityQuickViewProps {
  resourcePath: EntityResourcePath;
  id: string;
  onEdit?: (entity: EntityDetailResponse) => void;
}

export function EntityQuickView({ resourcePath, id, onEdit }: EntityQuickViewProps) {
  const { raw, model, loading, error } = useEntityQuickViewModel(resourcePath, id);

  if (loading) return <LoadingRow />;
  if (error || !model || !raw) return <ErrorRow />;

  const Icon = ENTITY_ICON[resourcePath];
  const accent = ENTITY_ACCENT[resourcePath];

  return (
    <div className="text-sm">
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <Icon className="w-5 h-5 flex-none mt-0.5" style={{ color: accent }} />
        <div className="min-w-0">
          <p className="font-medium text-[15px] leading-tight truncate">{model.name}</p>
          {model.typeLabel && (
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mt-0.5">{model.typeLabel}</p>
          )}
        </div>
      </div>

      <EntityQuickViewSections model={model} />

      {/* Footer actions */}
      <div className="mt-3.5 flex items-center gap-2 border-t border-border pt-2.5">
        <Link
          href={model.fullHref}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Open full page <ArrowUpRight className="w-3 h-3" />
        </Link>
        {onEdit && (
          <button
            type="button"
            onClick={() => onEdit(raw)}
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Pencil className="w-3 h-3" /> Edit
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint components/entities/EntityQuickView.tsx`
Expected: clean (0 errors). The hook keeps the cancellation-guarded inner-`async run()` pattern, so no `set-state-in-effect` error.

- [ ] **Step 3: Run the model tests (still green — untouched module)**

Run: `npx vitest run components/entities/entity-quick-view-model.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 4: Commit**

```bash
git add components/entities/EntityQuickView.tsx
git commit -m "refactor(entities): expose EntityQuickView body for reuse on maps"
```

---

## Task 2: `marker-slideover-target.ts` — entity mapping (pure, TDD)

**Files:**
- Create: `components/maps/marker-slideover-target.ts`
- Test: `components/maps/marker-slideover-target.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// components/maps/marker-slideover-target.test.ts
import { describe, it, expect } from "vitest";
import { entityTargetOf } from "./marker-slideover-target";
import type { ResolvedMarker } from "./map-types";

function marker(over: Partial<ResolvedMarker>): ResolvedMarker {
  return {
    id: "m",
    mapId: "map",
    x: 0,
    y: 0,
    type: "note",
    entityId: null,
    targetMapId: null,
    title: null,
    note: null,
    minZoom: null,
    resolvedTitle: "",
    resolvedSubtitle: null,
    ...over,
  } as ResolvedMarker;
}

describe("entityTargetOf", () => {
  it("maps character/location/faction to resourcePath + id", () => {
    expect(entityTargetOf(marker({ type: "character", entityId: "c1" }))).toEqual({ resourcePath: "characters", id: "c1" });
    expect(entityTargetOf(marker({ type: "location", entityId: "l1" }))).toEqual({ resourcePath: "locations", id: "l1" });
    expect(entityTargetOf(marker({ type: "faction", entityId: "f1" }))).toEqual({ resourcePath: "factions", id: "f1" });
  });

  it("returns null for note / submap / event", () => {
    expect(entityTargetOf(marker({ type: "note" }))).toBeNull();
    expect(entityTargetOf(marker({ type: "submap", targetMapId: "m2" }))).toBeNull();
    expect(entityTargetOf(marker({ type: "event", entityId: "s1" }))).toBeNull();
  });

  it("returns null when an entity pin has no entityId", () => {
    expect(entityTargetOf(marker({ type: "character", entityId: null }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/maps/marker-slideover-target.test.ts`
Expected: FAIL — cannot resolve `./marker-slideover-target`.

- [ ] **Step 3: Write the implementation**

```ts
// components/maps/marker-slideover-target.ts
import type { ResolvedMarker } from "@/components/maps/map-types";

export interface EntityMarkerTarget {
  resourcePath: "characters" | "locations" | "factions";
  id: string;
}

const TYPE_TO_RESOURCE: Record<string, EntityMarkerTarget["resourcePath"]> = {
  character: "characters",
  location: "locations",
  faction: "factions",
};

/** For entity-backed pins (character/location/faction) returns the entity detail
 *  target; null for note/submap/event or when entityId is missing. */
export function entityTargetOf(marker: ResolvedMarker): EntityMarkerTarget | null {
  const resourcePath = TYPE_TO_RESOURCE[marker.type];
  if (!resourcePath || !marker.entityId) return null;
  return { resourcePath, id: marker.entityId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/maps/marker-slideover-target.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/maps/marker-slideover-target.ts components/maps/marker-slideover-target.test.ts
git commit -m "feat(maps): entity-target mapping for pin slide-over"
```

---

## Task 3: `EventNoteBody.tsx` — extract the event body

**Files:**
- Create: `components/maps/EventNoteBody.tsx`

The Notion-page body from `EventNotePanel` as a standalone body (no panel chrome, no subtitle — the shell owns those). Keeps the exact fetch flow (session detail → Notion page) and the async-IIFE effect pattern so lint stays clean.

- [ ] **Step 1: Create the component**

```tsx
// components/maps/EventNoteBody.tsx
"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ExternalLink } from "lucide-react";
import { NotionBlocks } from "@/components/glossary/NotionBlocks";
import type { ResolvedMarker } from "@/components/maps/map-types";
import type { NotionBlockData } from "@/lib/notion/client";

interface NoteDetail {
  id: string;
  name: string;
  notionUrl: string | null;
  linkedLocations: { id: string; name: string }[];
  notionProps: { label: string; value: string }[];
}

/** Body for an event (session-note) pin: linked settings, the Notion page body,
 *  and a "View in Notion" link. Fetched on open. Rendered inside MarkerSlideOver. */
export function EventNoteBody({ marker }: { marker: ResolvedMarker }) {
  const [detail, setDetail] = useState<NoteDetail | null>(null);
  const [blocks, setBlocks] = useState<NotionBlockData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!marker.entityId) {
        if (!cancelled) {
          setLoading(false);
          setError("Session note not found.");
        }
        return;
      }
      setLoading(true);
      setError(null);
      setBlocks(null);
      try {
        const res = await fetch(`/api/sessions/${marker.entityId}`);
        if (!res.ok) {
          if (!cancelled) setError("Session note not found.");
          return;
        }
        const d: NoteDetail = await res.json();
        if (cancelled) return;
        setDetail(d);
        if (d.notionUrl) {
          const pageRes = await fetch(`/api/notion/page?url=${encodeURIComponent(d.notionUrl)}`);
          const pageData = await pageRes.json();
          if (cancelled) return;
          if (pageRes.ok) setBlocks(pageData.blocks);
          else setError(pageData.error ?? null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [marker.entityId]);

  return (
    <div className="space-y-3">
      {detail?.linkedLocations && detail.linkedLocations.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {detail.linkedLocations.map((l) => (
            <Link
              key={l.id}
              href={`/locations/${l.id}`}
              className="rounded-full border border-border px-2 py-0.5 text-xs hover:border-muted-foreground/40"
            >
              {l.name}
            </Link>
          ))}
        </div>
      )}
      {detail?.notionUrl && (
        <a
          href={detail.notionUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          View in Notion <ExternalLink className="w-3 h-3" />
        </a>
      )}
      {loading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
      {error && <p className="text-sm text-muted-foreground">{error}</p>}
      {blocks && <NotionBlocks blocks={blocks} />}
      {!loading && !error && !blocks && detail && !detail.notionUrl && (
        <p className="text-sm text-muted-foreground">No Notion page linked.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint components/maps/EventNoteBody.tsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/maps/EventNoteBody.tsx
git commit -m "feat(maps): extract EventNoteBody from EventNotePanel"
```

---

## Task 4: `MarkerSlideOver.tsx` — the shell

**Files:**
- Create: `components/maps/MarkerSlideOver.tsx`

- [ ] **Step 1: Create the shell**

```tsx
// components/maps/MarkerSlideOver.tsx
"use client";

import Link from "next/link";
import { X, Pencil, Trash2, ArrowUpRight } from "lucide-react";
import { markerVisual } from "@/components/maps/marker-meta";
import { entityTargetOf } from "@/components/maps/marker-slideover-target";
import { EntityQuickViewBody } from "@/components/entities/EntityQuickView";
import { EventNoteBody } from "@/components/maps/EventNoteBody";
import type { ResolvedMarker } from "@/components/maps/map-types";

interface MarkerSlideOverProps {
  marker: ResolvedMarker;
  onClose: () => void;
  onEditPin: () => void;
  onDeletePin: () => void;
}

/**
 * The unified left-docked quick-view slide-over shown when a map marker is
 * selected. One shell for every pin type: marker header, a per-type body, and a
 * single footer (Open link + Edit pin + Delete pin). Used by both map viewers.
 */
export function MarkerSlideOver({ marker, onClose, onEditPin, onDeletePin }: MarkerSlideOverProps) {
  const meta = markerVisual(marker);
  const Icon = meta.icon;
  const target = entityTargetOf(marker);

  let openLink: { href: string; label: string } | null = null;
  if (target) {
    openLink = { href: `/${target.resourcePath}/${target.id}`, label: "Open page" };
  } else if (marker.type === "event" && marker.entityId) {
    openLink = { href: `/sessions/${marker.entityId}`, label: "Open page" };
  } else if (marker.type === "submap" && marker.targetMapId) {
    openLink = { href: `/maps/${marker.targetMapId}`, label: "Open sub-map" };
  }

  return (
    <div className="panel-in absolute top-4 left-4 bottom-4 w-96 max-w-[calc(100%-2rem)] flex flex-col rounded-xl border border-border bg-card shadow-2xl z-[1000]">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 p-3.5 border-b border-border flex-none">
        <div className="flex items-start gap-2.5 min-w-0">
          <Icon className="w-4 h-4 mt-1 flex-none" style={{ color: meta.color }} aria-hidden />
          <div className="min-w-0">
            <div className="font-display text-lg leading-tight">{marker.resolvedTitle}</div>
            <div className="mt-0.5 text-xs font-medium" style={{ color: meta.color }}>{meta.label}</div>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="flex-none text-muted-foreground hover:text-foreground">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body (per type) */}
      <div className="flex-1 overflow-y-auto p-3.5">
        {marker.resolvedSubtitle && <p className="text-xs text-destructive mb-2">{marker.resolvedSubtitle}</p>}

        {target && <EntityQuickViewBody resourcePath={target.resourcePath} id={target.id} />}

        {marker.type === "event" && <EventNoteBody marker={marker} />}

        {marker.type === "note" &&
          (marker.note ? (
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{marker.note}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No note text.</p>
          ))}

        {marker.type === "submap" && <p className="text-sm text-muted-foreground">Links to another map.</p>}
      </div>

      {/* Footer (Option A: single row) */}
      <div className="flex items-center gap-3 border-t border-border p-3 text-xs flex-none">
        {openLink && (
          <Link href={openLink.href} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            {openLink.label} <ArrowUpRight className="w-3 h-3" />
          </Link>
        )}
        <button onClick={onEditPin} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
          <Pencil className="w-3 h-3" /> Edit pin
        </button>
        <button onClick={onDeletePin} className="ml-auto inline-flex items-center gap-1 text-destructive hover:underline">
          <Trash2 className="w-3 h-3" /> Delete pin
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint components/maps/MarkerSlideOver.tsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/maps/MarkerSlideOver.tsx
git commit -m "feat(maps): MarkerSlideOver unified pin quick-view shell"
```

---

## Task 5: Wire MarkerSlideOver into MapViewer (local/city maps)

**Files:**
- Modify: `components/maps/MapViewer.tsx`

- [ ] **Step 1: Swap imports**

Replace the two panel imports (currently around lines 13-14):

```ts
import { MarkerInfoPanel } from "@/components/maps/MarkerInfoPanel";
import { EventNotePanel } from "@/components/maps/EventNotePanel";
```

with:

```ts
import { MarkerSlideOver } from "@/components/maps/MarkerSlideOver";
```

- [ ] **Step 2: Stop sub-map pins navigating on click**

In `handleMarkerClick` (around lines 166-172), remove the sub-map early-return so sub-map pins select (and open the panel) like every other type. Replace the whole function body:

```tsx
  function handleMarkerClick(marker: ResolvedMarker) {
    setSelectedId(marker.id === selectedId ? null : marker.id);
  }
```

(The `marker` param stays; `router` is still used elsewhere in the file, so leave its import.)

- [ ] **Step 3: Replace the two panel branches with one shell**

Replace the entire block containing the `{selectedMarker && selectedMarker.type === "event" && ( <EventNotePanel ... /> )}` and `{selectedMarker && selectedMarker.type !== "event" && ( <MarkerInfoPanel ... /> )}` branches (currently around lines 399-432) with:

```tsx
        {selectedMarker && (
          <MarkerSlideOver
            key={selectedMarker.id}
            marker={selectedMarker}
            onClose={() => setSelectedId(null)}
            onEditPin={() => {
              setEditingMarker(selectedMarker);
              setSelectedId(null);
            }}
            onDeletePin={async () => {
              await fetch(`/api/maps/markers/${selectedMarker.id}`, { method: "DELETE" });
              setSelectedId(null);
              loadMarkers();
              setTrayReloadKey((k) => k + 1);
            }}
          />
        )}
```

- [ ] **Step 4: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint components/maps/MapViewer.tsx`
Expected: clean (no unused `MarkerInfoPanel`/`EventNotePanel`).

- [ ] **Step 5: Commit**

```bash
git add components/maps/MapViewer.tsx
git commit -m "feat(maps): use MarkerSlideOver in MapViewer; sub-map pins open the panel"
```

---

## Task 6: Wire MarkerSlideOver into WorldMapViewer

**Files:**
- Modify: `components/maps/WorldMapViewer.tsx`

- [ ] **Step 1: Swap the import**

Replace (around line 8):

```ts
import { MarkerInfoPanel } from "@/components/maps/MarkerInfoPanel";
```

with:

```ts
import { MarkerSlideOver } from "@/components/maps/MarkerSlideOver";
```

- [ ] **Step 2: Replace the panel**

Replace the `{selectedMarker && ( <MarkerInfoPanel ... /> )}` block (currently around lines 303-318) with:

```tsx
        {selectedMarker && (
          <MarkerSlideOver
            key={selectedMarker.id}
            marker={selectedMarker}
            onClose={() => setSelectedId(null)}
            onEditPin={() => {
              setEditing(selectedMarker);
              setSelectedId(null);
            }}
            onDeletePin={async () => {
              await fetch(`/api/maps/markers/${selectedMarker.id}`, { method: "DELETE" });
              setSelectedId(null);
              loadMarkers(worldMapId);
            }}
          />
        )}
```

(This mirrors the existing handlers exactly — `setEditing` and `loadMarkers(worldMapId)` are the world viewer's names; `worldMapId` is non-null here because the component early-returns while it's null.)

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint components/maps/WorldMapViewer.tsx`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/maps/WorldMapViewer.tsx
git commit -m "feat(maps): use MarkerSlideOver in WorldMapViewer (adds rich + event panels)"
```

---

## Task 7: Remove the retired panels

**Files:**
- Delete: `components/maps/MarkerInfoPanel.tsx`, `components/maps/EventNotePanel.tsx`

- [ ] **Step 1: Confirm no remaining importers**

Run: `grep -rn "MarkerInfoPanel\|EventNotePanel" components app`
Expected: NO matches (both viewers now use `MarkerSlideOver`; the only hits would be the files themselves).

- [ ] **Step 2: Delete the files**

```bash
git rm components/maps/MarkerInfoPanel.tsx components/maps/EventNotePanel.tsx
```

- [ ] **Step 3: Type-check + build-sanity**

Run: `npx tsc --noEmit`
Expected: clean (no dangling references).

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(maps): remove MarkerInfoPanel and EventNotePanel (replaced by MarkerSlideOver)"
```

---

## Task 8: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Tests + type-check + lint**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all tests PASS (incl. the new `marker-slideover-target.test.ts`); tsc clean; lint introduces **no new errors** (pre-existing warnings elsewhere are fine — compare against the SP1 baseline: the only lint *error* the repo had was fixed in SP1; this work must not add another).

- [ ] **Step 2: Browser — local/city map** (dev server; seed markers if the DB is empty — create a map, place location/character/faction/note/sub-map/event pins, or reuse existing)

Verify each pin type opens the slide-over:
- location/character/faction → description + props + related sections; footer `Open page → · Edit pin · Delete pin`.
- note → the note text; footer `Edit pin · Delete pin`.
- sub-map → opens the panel (does NOT navigate on click); footer `Open sub-map → · Edit pin · Delete pin`; the link navigates.
- event → Notion body (or "No Notion page linked."); footer `Open page → · Edit pin · Delete pin` + in-body "View in Notion".
- `Edit pin` opens `MarkerFormDialog`; `Delete pin` removes the pin and closes the panel; `Close` (✕) works.
- Confirm no console errors (`read_console_messages`).

- [ ] **Step 3: Browser — world map** (`/world`)

Verify the world map now shows the slide-over (previously only a compact card), including an **event** pin rendering its Notion body — the capability the world viewer lacked entirely. Same footer/behavior checks.

- [ ] **Step 4: Browser — SP1 regression check**

Open an entity list page (e.g. `/characters`), click a row → the SP1 popover still renders header + description + related + footer correctly (the Task 1 refactor must not have changed it). Confirm no console errors.

- [ ] **Step 5: Screenshot proof + final commit (if any fixups were needed)**

Capture one open slide-over (e.g. a location pin on a city map) to share.

```bash
git add -A
git commit -m "chore(maps): pin slide-over verification fixups"
```

(Skip the commit if no fixups were needed.)

---

## Self-review notes (for the implementer)

- **SP1 must keep working:** Task 1 rewrites merged SP1 code. `EntityQuickView`'s props and rendered output are unchanged; `EntityQuickViewPopover` imports only `EntityQuickView`. Verify the entity-page popover in Step 4 of Task 8.
- **One shell, two viewers:** `MarkerSlideOver` depends only on `{marker, onClose, onEditPin, onDeletePin}` — no MapViewer-only state (tray/filters). Keep it that way.
- **Sub-map behavior change is intentional:** clicking a sub-map pin now opens the panel; navigation is the "Open sub-map →" footer link.
- **Footer note:** the event "View in Notion" link lives in `EventNoteBody` (it has the fetched `notionUrl`), not the shell footer — a deliberate, documented placement so the shell needs no fetched data.
- **No new test tooling:** only `marker-slideover-target.ts` is unit-tested; everything else is browser-verified.
