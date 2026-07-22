# Entity Quick-View Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the DM peek at an entity's summary in a popover anchored to its list row (all four entity types), without navigating to the full page.

**Architecture:** A pure, unit-tested view-model builder normalizes the two entity-detail API shapes into one render model. A container-agnostic `EntityQuickView` presentational component renders that model (loading/error/sections) and is deliberately reusable by SP2's map slide-over. An `EntityQuickViewPopover` wraps it in a Radix popover. The four list pages restructure each row so clicking it opens the popover while a dedicated nav icon links to the full page. One small server addition resolves character related-entity **names** so the popover needs only a single fetch.

**Tech Stack:** Next.js 16 (client components + REST route handlers), React 19, Radix `@radix-ui/react-popover`, Drizzle ORM (SQLite), Vitest (node environment — pure-logic tests only, UI verified in the browser), Tailwind v4.

**Testing convention (important):** This repo's Vitest runs in the **`node`** environment with **no jsdom / no @testing-library**, and the include glob is `.ts` only. Every existing test is a pure-logic unit test (see `components/maps/marker-labels.test.ts`). Therefore: the **view-model builder is TDD'd as a pure module**; components, the API route, and row wiring are **verified in the browser** via the dev server (same approach the marker-label-toggle feature used). Do **not** add component-render tests or new test tooling.

---

## File structure

**New files**
- `components/entities/entity-quick-view-model.ts` — pure view-model builder + types (the only unit-tested unit).
- `components/entities/entity-quick-view-model.test.ts` — its tests.
- `components/ui/popover.tsx` — thin Radix popover wrapper (reused later by SP3).
- `components/entities/EntityQuickView.tsx` — container-agnostic body: fetch + render model. **SP2 reuses this unchanged.**
- `components/entities/EntityQuickViewPopover.tsx` — popover wrapper around `EntityQuickView`.

**Modified files**
- `app/api/characters/[id]/route.ts` — add resolved `relatedFactions` / `relatedLocations` / `relatedItems` (`{id,name}[]`) to the GET response (keep existing id arrays).
- `components/entities/SimpleEntityManager.tsx` — row → popover trigger + `ArrowUpRight` nav link; add edit-dialog state for popover "Edit".
- `app/characters/page.tsx` — same row restructure; open `CharacterFormDialog` from popover "Edit" using the fetched detail.

**Untouched (reused as-is):** `components/glossary/NotionPropsTable.tsx`, `components/glossary/RelatedCard.tsx`, the four `[id]` GET routes for locations/items/factions (already return `linkedCharacters`), `SimpleEntityFormDialog`, `CharacterFormDialog`.

---

## Task 1: Entity quick-view model (pure, TDD)

**Files:**
- Create: `components/entities/entity-quick-view-model.ts`
- Test: `components/entities/entity-quick-view-model.test.ts`

The two detail APIs return different shapes:
- Simple entities (locations/items/factions) return `linkedCharacters: {id,name,type}[]`.
- Characters return related **ids only** today; Task 2 adds `relatedFactions/relatedLocations/relatedItems: {id,name}[]`.

This module normalizes both into one model and decides which sections exist.

- [ ] **Step 1: Write the failing test**

```ts
// components/entities/entity-quick-view-model.test.ts
import { describe, it, expect } from "vitest";
import { buildEntityQuickView, PROP_LIMIT } from "./entity-quick-view-model";

describe("buildEntityQuickView", () => {
  it("maps a fully-populated location", () => {
    const m = buildEntityQuickView("locations", {
      id: "loc1",
      name: "Emon",
      description: "Capital of Tal'Dorei.",
      type: "city",
      notionProps: [{ label: "Region", value: "Tal'Dorei" }],
      linkedCharacters: [{ id: "c1", name: "Vex", type: "pc" }],
    });
    expect(m.name).toBe("Emon");
    expect(m.typeLabel).toBe("City");
    expect(m.description).toBe("Capital of Tal'Dorei.");
    expect(m.props).toEqual([{ label: "Region", value: "Tal'Dorei" }]);
    expect(m.fullHref).toBe("/locations/loc1");
    expect(m.related).toEqual([
      { label: "Characters", items: [{ id: "c1", name: "Vex", href: "/characters/c1", type: "PC" }] },
    ]);
  });

  it("omits empty sections for a bare faction", () => {
    const m = buildEntityQuickView("factions", { id: "f1", name: "Clasp", description: null });
    expect(m.typeLabel).toBeNull();
    expect(m.description).toBeNull();
    expect(m.props).toEqual([]);
    expect(m.related).toEqual([]);
  });

  it("labels character pc/npc and groups character relations", () => {
    const m = buildEntityQuickView("characters", {
      id: "c1",
      name: "Vex",
      type: "npc",
      relatedFactions: [{ id: "f1", name: "Vox Machina" }],
      relatedLocations: [],
      relatedItems: [{ id: "i1", name: "Fenthras" }],
    });
    expect(m.typeLabel).toBe("NPC");
    expect(m.related).toEqual([
      { label: "Factions", items: [{ id: "f1", name: "Vox Machina", href: "/factions/f1" }] },
      { label: "Items", items: [{ id: "i1", name: "Fenthras", href: "/items/i1" }] },
    ]);
  });

  it("caps props at PROP_LIMIT", () => {
    const props = Array.from({ length: PROP_LIMIT + 3 }, (_, i) => ({ label: `L${i}`, value: `V${i}` }));
    const m = buildEntityQuickView("items", { id: "i1", name: "Cloak", notionProps: props });
    expect(m.props).toHaveLength(PROP_LIMIT);
    expect(m.props[0]).toEqual({ label: "L0", value: "V0" });
  });

  it("passes an unknown location type through verbatim as its own label", () => {
    const m = buildEntityQuickView("locations", { id: "l9", name: "?", type: "plane" });
    expect(m.typeLabel).toBe("plane");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/entities/entity-quick-view-model.test.ts`
Expected: FAIL — `Failed to resolve import "./entity-quick-view-model"`.

- [ ] **Step 3: Write the implementation**

```ts
// components/entities/entity-quick-view-model.ts

export type EntityResourcePath = "characters" | "locations" | "items" | "factions";

/** How many Notion props the compact popover shows before truncating. */
export const PROP_LIMIT = 4;

export interface RelatedItem {
  id: string;
  name: string;
  href: string;
  type?: string;
}

export interface RelatedGroup {
  label: string;
  items: RelatedItem[];
}

export interface EntityQuickViewModel {
  id: string;
  name: string;
  typeLabel: string | null;
  description: string | null;
  props: { label: string; value: string }[];
  related: RelatedGroup[];
  fullHref: string;
}

/** The union of fields the four `/api/{resourcePath}/{id}` GET endpoints return. */
export interface EntityDetailResponse {
  id: string;
  name: string;
  description?: string | null;
  type?: string | null;
  notionUrl?: string | null;
  notionProps?: { label: string; value: string }[];
  // Simple entities (locations/items/factions):
  linkedCharacters?: { id: string; name: string; type: string }[];
  // Characters (added in Task 2):
  relatedFactions?: { id: string; name: string }[];
  relatedLocations?: { id: string; name: string }[];
  relatedItems?: { id: string; name: string }[];
}

const LOCATION_TYPE_LABELS: Record<string, string> = {
  city: "City",
  town: "Town",
  poi: "Point of Interest",
  region: "Region",
  other: "Other",
};

function resolveTypeLabel(resourcePath: EntityResourcePath, type?: string | null): string | null {
  if (!type) return null;
  if (resourcePath === "locations") return LOCATION_TYPE_LABELS[type] ?? type;
  if (resourcePath === "characters") {
    if (type === "pc") return "PC";
    if (type === "npc") return "NPC";
    return null;
  }
  return null;
}

function group(label: string, rows: { id: string; name: string }[], hrefBase: string): RelatedGroup[] {
  if (!rows || rows.length === 0) return [];
  return [{ label, items: rows.map((r) => ({ id: r.id, name: r.name, href: `${hrefBase}/${r.id}` })) }];
}

function buildRelated(resourcePath: EntityResourcePath, raw: EntityDetailResponse): RelatedGroup[] {
  if (resourcePath === "characters") {
    return [
      ...group("Factions", raw.relatedFactions ?? [], "/factions"),
      ...group("Locations", raw.relatedLocations ?? [], "/locations"),
      ...group("Items", raw.relatedItems ?? [], "/items"),
    ];
  }
  const chars = raw.linkedCharacters ?? [];
  if (chars.length === 0) return [];
  return [
    {
      label: "Characters",
      items: chars.map((c) => ({
        id: c.id,
        name: c.name,
        href: `/characters/${c.id}`,
        type: c.type === "pc" ? "PC" : "NPC",
      })),
    },
  ];
}

export function buildEntityQuickView(
  resourcePath: EntityResourcePath,
  raw: EntityDetailResponse,
): EntityQuickViewModel {
  return {
    id: raw.id,
    name: raw.name,
    typeLabel: resolveTypeLabel(resourcePath, raw.type),
    description: raw.description ?? null,
    props: (raw.notionProps ?? []).slice(0, PROP_LIMIT),
    related: buildRelated(resourcePath, raw),
    fullHref: `/${resourcePath}/${raw.id}`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/entities/entity-quick-view-model.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add components/entities/entity-quick-view-model.ts components/entities/entity-quick-view-model.test.ts
git commit -m "feat(entities): entity quick-view model builder"
```

---

## Task 2: Resolve character related-entity names in the API

**Files:**
- Modify: `app/api/characters/[id]/route.ts` (GET handler)

The character GET currently returns `factionIds/locationIds/itemIds` (ids only). Add resolved name arrays so the popover (and SP2) get names in one fetch, mirroring the `linkedCharacters` pattern in the locations route. Keep the id arrays — `CharacterFormDialog` and the character detail page still consume them.

- [ ] **Step 1: Update imports**

In `app/api/characters/[id]/route.ts`, change the schema import line (line 3) to also import the target tables and add `inArray`:

```ts
import { characters, characterFactions, characterLocations, characterItems, factions, locations, items, mapMarkers, maps } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
```

- [ ] **Step 2: Resolve names after the link queries**

In the GET handler, immediately after the existing `const [factionLinks, locationLinks, itemLinks, markerLinks] = await Promise.all([...]);` block, add:

```ts
  const [relatedFactions, relatedLocations, relatedItems] = await Promise.all([
    factionLinks.length
      ? db.query.factions.findMany({ where: inArray(factions.id, factionLinks.map((l) => l.factionId)) })
      : Promise.resolve([]),
    locationLinks.length
      ? db.query.locations.findMany({ where: inArray(locations.id, locationLinks.map((l) => l.locationId)) })
      : Promise.resolve([]),
    itemLinks.length
      ? db.query.items.findMany({ where: inArray(items.id, itemLinks.map((l) => l.itemId)) })
      : Promise.resolve([]),
  ]);
```

- [ ] **Step 3: Add the arrays to the response**

In the `return NextResponse.json({ ... })`, add these three fields alongside the existing `factionIds/locationIds/itemIds`:

```ts
    relatedFactions: relatedFactions.map((f) => ({ id: f.id, name: f.name })),
    relatedLocations: relatedLocations.map((l) => ({ id: l.id, name: l.name })),
    relatedItems: relatedItems.map((i) => ({ id: i.id, name: i.name })),
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Verify against the running app** (start the dev server via the preview tool if not already running)

Fetch a character detail in the browser dev tools / preview network panel and confirm the JSON now includes `relatedFactions`, `relatedLocations`, `relatedItems` with `{id,name}` objects for a character that has links, and empty arrays for one that doesn't. (Pick a real id from `/api/characters?campaignId=…`.)

- [ ] **Step 6: Commit**

```bash
git add app/api/characters/[id]/route.ts
git commit -m "feat(api): resolve character related-entity names in detail response"
```

---

## Task 3: Popover UI primitive

**Files:**
- Create: `components/ui/popover.tsx`

A thin wrapper over the already-installed `@radix-ui/react-popover`, styled to match the app's popover token usage (`ConditionPicker.tsx` uses `bg-popover`, `border-border`). No unit test (trivial re-export); exercised by browser verification in later tasks.

- [ ] **Step 1: Create the primitive**

```tsx
// components/ui/popover.tsx
"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "start", sideOffset = 8, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl outline-none",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = "PopoverContent";
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors. (If `text-popover-foreground` isn't a defined token, drop it — `bg-popover` and `border-border` are confirmed present via `ConditionPicker.tsx`.)

- [ ] **Step 3: Commit**

```bash
git add components/ui/popover.tsx
git commit -m "feat(ui): add Popover primitive wrapping radix popover"
```

---

## Task 4: EntityQuickView component (container-agnostic body)

**Files:**
- Create: `components/entities/EntityQuickView.tsx`

Fetches `/api/{resourcePath}/{id}` on mount (cancellation-guarded, per the repo's set-state-in-effect convention — see `SimpleEntityDetail.tsx:66-82`), builds the model, and renders header / description / props / related / footer. Renders body content only — **no popover chrome** — so SP2 mounts it inside the map slide-over. `onEdit` receives the fetched detail so callers can open their existing edit dialog without a second fetch.

- [ ] **Step 1: Create the component**

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

interface EntityQuickViewProps {
  resourcePath: EntityResourcePath;
  id: string;
  onEdit?: (entity: EntityDetailResponse) => void;
}

export function EntityQuickView({ resourcePath, id, onEdit }: EntityQuickViewProps) {
  const [raw, setRaw] = useState<EntityDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch(`/api/${resourcePath}/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not ok"))))
      .then((data: EntityDetailResponse) => {
        if (!cancelled) setRaw(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resourcePath, id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    );
  }

  if (error || !raw) {
    return <p className="py-4 text-sm text-destructive">Couldn&apos;t load this entity.</p>;
  }

  const model = buildEntityQuickView(resourcePath, raw);
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

      {/* Description */}
      {model.description && (
        <p className="mt-2.5 text-[13px] leading-relaxed text-foreground/80 line-clamp-3">{model.description}</p>
      )}

      {/* Key properties */}
      {model.props.length > 0 && (
        <div className="mt-3">
          <NotionPropsTable props={model.props} />
        </div>
      )}

      {/* Related */}
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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors. (`line-clamp-3` ships with Tailwind v4 core; if the build flags it, replace with the existing `truncate` used elsewhere.)

- [ ] **Step 3: Commit**

```bash
git add components/entities/EntityQuickView.tsx
git commit -m "feat(entities): EntityQuickView body component"
```

---

## Task 5: EntityQuickViewPopover wrapper

**Files:**
- Create: `components/entities/EntityQuickViewPopover.tsx`

Wraps arbitrary trigger `children` in the Radix popover and mounts `EntityQuickView` **only when open**, so the fetch fires on open rather than on every list render.

- [ ] **Step 1: Create the wrapper**

```tsx
// components/entities/EntityQuickViewPopover.tsx
"use client";

import React, { useState } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { EntityQuickView } from "@/components/entities/EntityQuickView";
import type { EntityResourcePath, EntityDetailResponse } from "@/components/entities/entity-quick-view-model";

interface EntityQuickViewPopoverProps {
  resourcePath: EntityResourcePath;
  id: string;
  onEdit?: (entity: EntityDetailResponse) => void;
  children: React.ReactNode;
}

export function EntityQuickViewPopover({ resourcePath, id, onEdit, children }: EntityQuickViewPopoverProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" side="bottom">
        {open && (
          <EntityQuickView
            resourcePath={resourcePath}
            id={id}
            onEdit={(entity) => {
              setOpen(false);
              onEdit?.(entity);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/entities/EntityQuickViewPopover.tsx
git commit -m "feat(entities): EntityQuickViewPopover wrapper"
```

---

## Task 6: Wire the popover into SimpleEntityManager (locations / items / factions)

**Files:**
- Modify: `components/entities/SimpleEntityManager.tsx`

Restructure each row: the name/description region becomes the popover trigger (click = peek); add an `ArrowUpRight` nav link to the full page; keep the hover-reveal delete button. Add edit-dialog state so the popover's "Edit" opens the existing `SimpleEntityFormDialog` prefilled.

- [ ] **Step 1: Update imports**

Change the lucide import (line 7) and add the popover import:

```ts
import { Plus, Trash2, ArrowUpRight, type LucideIcon } from "lucide-react";
import { EntityQuickViewPopover } from "@/components/entities/EntityQuickViewPopover";
```

- [ ] **Step 2: Add edit state**

After the existing `const [dialogOpen, setDialogOpen] = useState(false);` (line 38), add:

```ts
  const [editEntity, setEditEntity] = useState<SimpleEntity | null>(null);
```

- [ ] **Step 3: Replace the row markup**

Replace the entire row `<div key={e.id} …> … </div>` block (currently `SimpleEntityManager.tsx:119-149`) with:

```tsx
            <div
              key={e.id}
              className="relative flex items-center gap-3 px-2 py-3.5 hover:bg-accent/40 transition-colors group"
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-none"
                style={{ backgroundColor: accent }}
                aria-hidden
              />
              <EntityQuickViewPopover
                resourcePath={resourcePath}
                id={e.id}
                onEdit={(entity) =>
                  setEditEntity({
                    id: entity.id,
                    name: entity.name,
                    description: entity.description ?? null,
                    notionUrl: entity.notionUrl ?? null,
                    type: entity.type ?? null,
                  })
                }
              >
                <button
                  type="button"
                  aria-label={`Preview ${singular}: ${e.name}`}
                  className="flex-1 min-w-0 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <p className="font-medium text-[15px] leading-tight truncate">{e.name}</p>
                  {e.description && (
                    <p className="text-[13px] text-muted-foreground truncate mt-0.5">{e.description}</p>
                  )}
                </button>
              </EntityQuickViewPopover>
              <Link
                href={`/${resourcePath}/${e.id}`}
                aria-label={`Open ${singular}: ${e.name}`}
                className="relative z-10 flex-none rounded-md p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ArrowUpRight className="w-4 h-4" />
              </Link>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Delete ${singular}: ${e.name}`}
                className="relative z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-destructive hover:text-destructive"
                onClick={(ev) => remove(e.id, ev)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
```

- [ ] **Step 4: Render an edit dialog instance**

The component currently renders one `SimpleEntityFormDialog` for "new" (entity={null}). Add a second instance for editing, right after that existing dialog (after line 162):

```tsx
      <SimpleEntityFormDialog
        key={editEntity?.id ?? "edit"}
        open={editEntity !== null}
        onClose={() => setEditEntity(null)}
        resourcePath={resourcePath}
        label={label}
        campaignId={activeCampaignId ?? ""}
        entity={editEntity}
        onSaved={load}
      />
```

- [ ] **Step 5: Verify in the browser** (dev server)

On `/locations`, `/items`, `/factions`: click a row → popover opens with header/description/props/related; the `ArrowUpRight` icon (hover-revealed) navigates to the full page; "Edit" opens the prefilled dialog and saving refreshes the list; delete still works; Esc / click-away closes the popover. Confirm no console errors (`read_console_messages`).

- [ ] **Step 6: Commit**

```bash
git add components/entities/SimpleEntityManager.tsx
git commit -m "feat(entities): quick-view popover on locations/items/factions lists"
```

---

## Task 7: Wire the popover into the characters list

**Files:**
- Modify: `app/characters/page.tsx`

Same restructure. The character edit dialog needs `CharacterWithLinks` (with `factionIds/locationIds/itemIds`); the popover's `onEdit` supplies the fetched detail, which already contains those, so no extra fetch.

- [ ] **Step 1: Update imports**

Add to the lucide import (line 8) and add the popover + type imports:

```ts
import { Plus, Trash2, Users, ArrowUpRight } from "lucide-react";
import { EntityQuickViewPopover } from "@/components/entities/EntityQuickViewPopover";
import { CharacterFormDialog, type CharacterWithLinks } from "@/components/entities/CharacterFormDialog";
```

(Remove the now-duplicated `CharacterFormDialog` import on line 11 — merge into the line above.)

- [ ] **Step 2: Add edit state**

After `const [dialogOpen, setDialogOpen] = useState(false);` (line 21), add:

```ts
  const [editCharacter, setEditCharacter] = useState<CharacterWithLinks | null>(null);
```

- [ ] **Step 3: Replace the row markup**

Replace the row `<div key={c.id} …> … </div>` block (currently `app/characters/page.tsx:92-121`) with:

```tsx
            <div
              key={c.id}
              className="relative flex items-center gap-3 px-2 py-3.5 hover:bg-accent/40 transition-colors group"
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-none bg-[var(--marker-character)]"
                aria-hidden
              />
              <EntityQuickViewPopover
                resourcePath="characters"
                id={c.id}
                onEdit={(entity) => setEditCharacter(entity as unknown as CharacterWithLinks)}
              >
                <button
                  type="button"
                  aria-label={`Preview character: ${c.name}`}
                  className="flex-1 min-w-0 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <p className="font-medium text-[15px] leading-tight truncate">{c.name}</p>
                </button>
              </EntityQuickViewPopover>
              <Badge variant={c.type === "pc" ? "hp" : "outline"} className="capitalize relative z-10">
                {c.type}
              </Badge>
              <Link
                href={`/characters/${c.id}`}
                aria-label={`Open character: ${c.name}`}
                className="relative z-10 flex-none rounded-md p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ArrowUpRight className="w-4 h-4" />
              </Link>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Delete character: ${c.name}`}
                className="relative z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-destructive hover:text-destructive"
                onClick={(e) => remove(c.id, e)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
```

- [ ] **Step 4: Add the edit dialog instance**

After the existing `<CharacterFormDialog … character={null} … />` (currently line 126-132), add:

```tsx
      <CharacterFormDialog
        key={editCharacter?.id ?? "edit"}
        open={editCharacter !== null}
        onClose={() => setEditCharacter(null)}
        campaignId={activeCampaignId ?? ""}
        character={editCharacter}
        onSaved={load}
      />
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors. The `entity as unknown as CharacterWithLinks` cast is intentional — the character GET response is a structural superset of `CharacterWithLinks` (it carries `factionIds/locationIds/itemIds/mapMarkers/notionProps`), the same shape the character **detail** page already feeds into this dialog.

- [ ] **Step 6: Verify in the browser** (dev server)

On `/characters`: click a row → popover shows type label + description + related factions/locations/items (names, not ids) + props; the nav icon opens the full page; "Edit" opens the character dialog prefilled (relations preselected) and saving refreshes; delete still works. Confirm no console errors.

- [ ] **Step 7: Commit**

```bash
git add app/characters/page.tsx
git commit -m "feat(entities): quick-view popover on characters list"
```

---

## Task 8: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS, including the new `entity-quick-view-model.test.ts`.

- [ ] **Step 2: Lint + type-check**

Run: `npm run lint && npx tsc --noEmit`
Expected: no errors introduced by this work.

- [ ] **Step 3: Cross-page browser sweep** (dev server)

For each of `/characters`, `/locations`, `/items`, `/factions`:
- Row click opens the popover anchored to the row.
- Sections auto-adapt: an entity with no description/props/relations shows just the header + footer (no empty section headers).
- `ArrowUpRight` navigates to the full detail page.
- "Edit" opens the correct existing dialog, prefilled; save refreshes the list.
- Delete and search still work; popover closes on Esc / click-away.
- Take a screenshot of one open popover (e.g. a character with relations) to share as proof.

- [ ] **Step 4: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore(entities): quick-view verification fixups"
```

---

## Self-review notes (for the implementer)

- **Reuse contract for SP2:** `EntityQuickView` takes only `{resourcePath, id, onEdit?}` and renders body-only — no popover/list assumptions. SP2 mounts it inside the map slide-over unchanged. Do not add list- or popover-specific props to it.
- **Behavior change:** row click no longer navigates; the `ArrowUpRight` icon does. Keep its `aria-label` and hover-reveal so it stays discoverable.
- **Edit path:** the list pages previously had no inline edit — this adds a second dialog instance keyed to the edited entity. Keep the existing "new" dialog (entity={null}) instance separate so the two never collide.
- **No new test tooling:** only the pure model module is unit-tested; everything else is browser-verified, per repo convention.
