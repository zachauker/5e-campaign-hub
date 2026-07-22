# Entity List Filters, Views & Sorting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add filtering (by Type + Notion properties), three switchable views (list / gallery / table), and sorting to all four entity list pages, built once via a shared toolkit.

**Architecture:** A pure, unit-tested engine (`lib/entities/entity-list-view.ts`) normalizes rows and does derive-fields / filter / sort. A tiny `localStorage` store persists the view choice. A shared `EntityListView` component owns view/filter/sort state and renders a toolbar (`EntityListToolbar`) plus one of three view renderers. `SimpleEntityManager` and the characters page become thin wrappers that fetch, own their header + form dialogs, and render `<EntityListView>` with their type config + handlers.

**Tech Stack:** Next.js 16 client components, React 19, Tailwind v4, lucide-react, the SP1 `components/ui/popover.tsx` primitive, Vitest (node env — pure-logic tests only; components browser-verified).

**Testing convention:** Vitest is node-env (no jsdom). Only the pure engine + store are unit-tested. Components (toolbar, views, shell, wrappers) are verified in the browser on all four pages. No component-render tests, no new tooling.

---

## File structure

**New**
- `lib/entities/entity-list-view.ts` (+ `.test.ts`) — pure engine (normalize / derive / filter / sort) + types.
- `components/entities/entity-view-store.ts` (+ `.test.ts`) — persisted view choice.
- `components/entities/views/EntityListRows.tsx` — list view.
- `components/entities/views/EntityCardGrid.tsx` — gallery view.
- `components/entities/views/EntityTable.tsx` — table view.
- `components/entities/EntityListToolbar.tsx` — search + filter chips + sort + view switch + columns.
- `components/entities/EntityListView.tsx` — shared shell composing all of the above.

**Modified**
- `components/entities/SimpleEntityManager.tsx` — thin wrapper over `EntityListView`.
- `app/characters/page.tsx` — thin wrapper over `EntityListView`.

**Reused unchanged:** `EntityQuickViewPopover`, `components/ui/popover.tsx`, `Badge`, `Button`, `Input`, the form dialogs, the list/detail/delete APIs.

---

## Shared types (defined in Task 1, imported everywhere)

```ts
export type EntityView = "list" | "gallery" | "table";
export const FIELD_TYPE = "__type__";      // sentinel key for the structured type field
export const SORT_NAME = "__name__";        // sentinel sort key for name
export interface EntityProp { label: string; value: string }
export interface EntityListItem { id: string; name: string; description: string | null; type: string | null; props: EntityProp[] }
export interface TypeOption { value: string; label: string; badgeVariant?: string }
export interface TypeConfig { label: string; options: TypeOption[] }
export interface FilterFieldValue { value: string; label: string }
export interface FilterField { key: string; label: string; values: FilterFieldValue[] }  // key = FIELD_TYPE or a property label
export interface ActiveFilter { field: string; values: string[] }   // field = FIELD_TYPE or property label; values OR-ed
export interface SortState { key: string; dir: "asc" | "desc" }     // key = SORT_NAME, FIELD_TYPE, or property label
```

---

## Task 1: Pure engine `lib/entities/entity-list-view.ts` (TDD)

**Files:** Create `lib/entities/entity-list-view.ts` + `lib/entities/entity-list-view.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/entities/entity-list-view.test.ts
import { describe, it, expect } from "vitest";
import {
  normalizeRow,
  deriveFilterFields,
  applyFilters,
  sortItems,
  FIELD_TYPE,
  SORT_NAME,
  type EntityListItem,
  type TypeConfig,
} from "./entity-list-view";

const TYPE_CFG: TypeConfig = {
  label: "Type",
  options: [
    { value: "city", label: "City" },
    { value: "town", label: "Town" },
  ],
};

function row(over: Record<string, unknown>) {
  return { id: "x", name: "X", description: null, type: null, notionProps: null, ...over };
}

describe("normalizeRow", () => {
  it("parses notionProps JSON into props", () => {
    const item = normalizeRow(row({ id: "a", name: "Emon", type: "city", notionProps: JSON.stringify([{ label: "Region", value: "Tal'Dorei" }]) }));
    expect(item).toEqual({ id: "a", name: "Emon", description: null, type: "city", props: [{ label: "Region", value: "Tal'Dorei" }] });
  });
  it("treats null/malformed notionProps as empty props", () => {
    expect(normalizeRow(row({ notionProps: null })).props).toEqual([]);
    expect(normalizeRow(row({ notionProps: "not json" })).props).toEqual([]);
  });
});

const ITEMS: EntityListItem[] = [
  { id: "1", name: "Emon", description: "Capital", type: "city", props: [{ label: "Region", value: "Tal'Dorei" }, { label: "Status", value: "Active" }] },
  { id: "2", name: "Alfield", description: null, type: "town", props: [{ label: "Region", value: "Tal'Dorei" }] },
  { id: "3", name: "Vasselheim", description: null, type: "city", props: [{ label: "Region", value: "Issylra" }] },
];

describe("deriveFilterFields", () => {
  it("includes a Type field (from config) plus property labels with distinct values", () => {
    const fields = deriveFilterFields(ITEMS, TYPE_CFG);
    const type = fields.find((f) => f.key === FIELD_TYPE)!;
    expect(type.label).toBe("Type");
    expect(type.values.map((v) => v.value).sort()).toEqual(["city", "town"]);
    expect(type.values.find((v) => v.value === "city")!.label).toBe("City");
    const region = fields.find((f) => f.key === "Region")!;
    expect(region.values.map((v) => v.value).sort()).toEqual(["Issylra", "Tal'Dorei"]);
    expect(fields.find((f) => f.key === "Status")).toBeTruthy();
  });
  it("omits the Type field when there is no typeConfig", () => {
    expect(deriveFilterFields(ITEMS, null).find((f) => f.key === FIELD_TYPE)).toBeUndefined();
  });
});

describe("applyFilters", () => {
  it("filters by name query (case-insensitive)", () => {
    expect(applyFilters(ITEMS, { query: "va", filters: [] }).map((i) => i.id)).toEqual(["3"]);
  });
  it("filters by type field", () => {
    expect(applyFilters(ITEMS, { query: "", filters: [{ field: FIELD_TYPE, values: ["city"] }] }).map((i) => i.id).sort()).toEqual(["1", "3"]);
  });
  it("ORs multiple values within a field", () => {
    expect(applyFilters(ITEMS, { query: "", filters: [{ field: FIELD_TYPE, values: ["city", "town"] }] }).length).toBe(3);
  });
  it("ANDs across fields", () => {
    const out = applyFilters(ITEMS, { query: "", filters: [{ field: FIELD_TYPE, values: ["city"] }, { field: "Region", values: ["Tal'Dorei"] }] });
    expect(out.map((i) => i.id)).toEqual(["1"]);
  });
  it("excludes items missing the filtered property", () => {
    const out = applyFilters(ITEMS, { query: "", filters: [{ field: "Status", values: ["Active"] }] });
    expect(out.map((i) => i.id)).toEqual(["1"]);
  });
  it("returns all with no query and no filters", () => {
    expect(applyFilters(ITEMS, { query: "", filters: [] }).length).toBe(3);
  });
});

describe("sortItems", () => {
  it("sorts by name asc/desc case-insensitively", () => {
    expect(sortItems(ITEMS, { key: SORT_NAME, dir: "asc" }).map((i) => i.name)).toEqual(["Alfield", "Emon", "Vasselheim"]);
    expect(sortItems(ITEMS, { key: SORT_NAME, dir: "desc" }).map((i) => i.name)).toEqual(["Vasselheim", "Emon", "Alfield"]);
  });
  it("sorts by a property, missing-key items last", () => {
    const items: EntityListItem[] = [
      { id: "a", name: "A", description: null, type: null, props: [{ label: "Region", value: "Zephrah" }] },
      { id: "b", name: "B", description: null, type: null, props: [] },
      { id: "c", name: "C", description: null, type: null, props: [{ label: "Region", value: "Emon" }] },
    ];
    expect(sortItems(items, { key: "Region", dir: "asc" }).map((i) => i.id)).toEqual(["c", "a", "b"]);
  });
  it("sorts by type field", () => {
    expect(sortItems(ITEMS, { key: FIELD_TYPE, dir: "asc" }).map((i) => i.type)[0]).toBe("city");
  });
  it("does not mutate the input", () => {
    const copy = [...ITEMS];
    sortItems(ITEMS, { key: SORT_NAME, dir: "desc" });
    expect(ITEMS).toEqual(copy);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/entities/entity-list-view.test.ts`
Expected: FAIL — cannot resolve `./entity-list-view`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/entities/entity-list-view.ts

export type EntityView = "list" | "gallery" | "table";

/** Sentinel keys so a Notion property literally named "Type"/"Name" can't collide
 *  with the structured type field or the name sort. */
export const FIELD_TYPE = "__type__";
export const SORT_NAME = "__name__";

export interface EntityProp {
  label: string;
  value: string;
}

export interface EntityListItem {
  id: string;
  name: string;
  description: string | null;
  type: string | null;
  props: EntityProp[];
}

export interface TypeOption {
  value: string;
  label: string;
  badgeVariant?: string;
}

export interface TypeConfig {
  label: string;
  options: TypeOption[];
}

export interface FilterFieldValue {
  value: string;
  label: string;
}

export interface FilterField {
  key: string; // FIELD_TYPE or a property label
  label: string;
  values: FilterFieldValue[];
}

export interface ActiveFilter {
  field: string; // FIELD_TYPE or a property label
  values: string[]; // OR-ed
}

export interface SortState {
  key: string; // SORT_NAME, FIELD_TYPE, or a property label
  dir: "asc" | "desc";
}

/** A raw list row from GET /api/{resourcePath} (a superset of these fields). */
export interface RawEntityRow {
  id: string;
  name: string;
  description?: string | null;
  type?: string | null;
  notionProps?: string | null;
}

export function normalizeRow(row: RawEntityRow): EntityListItem {
  let props: EntityProp[] = [];
  if (row.notionProps) {
    try {
      const parsed = JSON.parse(row.notionProps);
      if (Array.isArray(parsed)) {
        props = parsed.filter(
          (p): p is EntityProp => p && typeof p.label === "string" && typeof p.value === "string",
        );
      }
    } catch {
      props = [];
    }
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    type: row.type ?? null,
    props,
  };
}

function distinct(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function deriveFilterFields(items: EntityListItem[], typeConfig: TypeConfig | null): FilterField[] {
  const fields: FilterField[] = [];

  if (typeConfig) {
    const present = distinct(items.map((i) => i.type).filter((t): t is string => !!t));
    if (present.length > 0) {
      fields.push({
        key: FIELD_TYPE,
        label: typeConfig.label,
        values: present.map((v) => ({
          value: v,
          label: typeConfig.options.find((o) => o.value === v)?.label ?? v,
        })),
      });
    }
  }

  // Property labels in first-seen order, each with its distinct values.
  const labelOrder: string[] = [];
  const byLabel = new Map<string, Set<string>>();
  for (const item of items) {
    for (const p of item.props) {
      if (!byLabel.has(p.label)) {
        byLabel.set(p.label, new Set());
        labelOrder.push(p.label);
      }
      byLabel.get(p.label)!.add(p.value);
    }
  }
  for (const label of labelOrder) {
    fields.push({
      key: label,
      label,
      values: distinct([...byLabel.get(label)!]).map((v) => ({ value: v, label: v })),
    });
  }

  return fields;
}

function valueForField(item: EntityListItem, field: string): string | null {
  if (field === FIELD_TYPE) return item.type;
  return item.props.find((p) => p.label === field)?.value ?? null;
}

export function applyFilters(
  items: EntityListItem[],
  { query, filters }: { query: string; filters: ActiveFilter[] },
): EntityListItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    if (q && !item.name.toLowerCase().includes(q)) return false;
    for (const f of filters) {
      if (f.values.length === 0) continue;
      const v = valueForField(item, f.field);
      if (v === null || !f.values.includes(v)) return false; // AND across fields, OR within
    }
    return true;
  });
}

export function sortItems(items: EntityListItem[], sort: SortState): EntityListItem[] {
  const keyOf = (item: EntityListItem): string | null =>
    sort.key === SORT_NAME ? item.name : valueForField(item, sort.key);
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka === null && kb === null) return 0;
    if (ka === null) return 1; // missing keys always last
    if (kb === null) return -1;
    return factor * ka.localeCompare(kb, undefined, { sensitivity: "base" });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/entities/entity-list-view.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/entities/entity-list-view.ts lib/entities/entity-list-view.test.ts
git commit -m "feat(entities): pure filter/sort/derive engine for list views"
```

---

## Task 2: View store `components/entities/entity-view-store.ts` (TDD)

**Files:** Create `components/entities/entity-view-store.ts` + `.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// components/entities/entity-view-store.test.ts
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { readEntityView, writeEntityView } from "./entity-view-store";

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

describe("entity-view-store", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to list when unset", () => {
    vi.stubGlobal("window", fakeWindow());
    expect(readEntityView("locations")).toBe("list");
  });
  it("round-trips a value per resource", () => {
    vi.stubGlobal("window", fakeWindow());
    writeEntityView("locations", "gallery");
    expect(readEntityView("locations")).toBe("gallery");
    expect(readEntityView("items")).toBe("list");
  });
  it("treats a malformed stored value as list", () => {
    const w = fakeWindow();
    w.localStorage.setItem("entityView:locations", "spreadsheet");
    vi.stubGlobal("window", w);
    expect(readEntityView("locations")).toBe("list");
  });
});

describe("entity-view-store without window", () => {
  beforeEach(() => vi.stubGlobal("window", undefined));
  afterEach(() => vi.unstubAllGlobals());
  it("reads default and write is a no-op", () => {
    expect(readEntityView("locations")).toBe("list");
    expect(() => writeEntityView("locations", "table")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/entities/entity-view-store.test.ts`
Expected: FAIL — cannot resolve `./entity-view-store`.

- [ ] **Step 3: Write the implementation**

```ts
// components/entities/entity-view-store.ts
import type { EntityView } from "@/lib/entities/entity-list-view";

const KEY = (resourcePath: string) => `entityView:${resourcePath}`;
const ALLOWED: EntityView[] = ["list", "gallery", "table"];

export function readEntityView(resourcePath: string): EntityView {
  try {
    if (typeof window === "undefined") return "list";
    const raw = window.localStorage.getItem(KEY(resourcePath));
    return ALLOWED.includes(raw as EntityView) ? (raw as EntityView) : "list";
  } catch {
    return "list";
  }
}

export function writeEntityView(resourcePath: string, view: EntityView): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(KEY(resourcePath), view);
  } catch {
    /* ignore */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/entities/entity-view-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/entities/entity-view-store.ts components/entities/entity-view-store.test.ts
git commit -m "feat(entities): persist entity list view choice per resource"
```

---

## Shared view-renderer contract (Tasks 3–5)

All three view renderers take the same props:

```ts
import type { EntityListItem, TypeConfig, SortState } from "@/lib/entities/entity-list-view";
import type { EntityDetailResponse } from "@/components/entities/entity-quick-view-model";

export interface EntityViewProps {
  items: EntityListItem[];
  resourcePath: "characters" | "locations" | "items" | "factions";
  singular: string;
  accent: string;                 // CSS color, e.g. "var(--marker-location)"
  typeConfig: TypeConfig | null;  // for the type badge
  onEdit: (entity: EntityDetailResponse) => void;   // forwarded to EntityQuickViewPopover
  onDelete: (id: string, e: React.MouseEvent) => void;
}
```

`EntityTable` additionally takes `columns: string[]` (property labels), `sort: SortState`, and `onSort: (key: string) => void`.

A helper for the type badge (define inline in each view that needs it):

```tsx
function typeBadge(typeConfig: TypeConfig | null, type: string | null) {
  if (!typeConfig || !type) return null;
  const opt = typeConfig.options.find((o) => o.value === type);
  return { label: opt?.label ?? type, variant: (opt?.badgeVariant ?? "outline") as "hp" | "outline" | "secondary" };
}
```

---

## Task 3: `EntityListRows.tsx` — list view

**Files:** Create `components/entities/views/EntityListRows.tsx`

This is the current row markup (from `SimpleEntityManager`/characters), generalized to also show a type badge when `typeConfig` is present.

- [ ] **Step 1: Create the component**

```tsx
// components/entities/views/EntityListRows.tsx
"use client";

import React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, ArrowUpRight } from "lucide-react";
import { EntityQuickViewPopover } from "@/components/entities/EntityQuickViewPopover";
import type { EntityListItem, TypeConfig } from "@/lib/entities/entity-list-view";
import type { EntityDetailResponse } from "@/components/entities/entity-quick-view-model";

export interface EntityViewProps {
  items: EntityListItem[];
  resourcePath: "characters" | "locations" | "items" | "factions";
  singular: string;
  accent: string;
  typeConfig: TypeConfig | null;
  onEdit: (entity: EntityDetailResponse) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}

function typeBadge(typeConfig: TypeConfig | null, type: string | null) {
  if (!typeConfig || !type) return null;
  const opt = typeConfig.options.find((o) => o.value === type);
  return { label: opt?.label ?? type, variant: (opt?.badgeVariant ?? "outline") as "hp" | "outline" | "secondary" };
}

export function EntityListRows({ items, resourcePath, singular, accent, typeConfig, onEdit, onDelete }: EntityViewProps) {
  return (
    <div className="mt-3 divide-y divide-border/60">
      {items.map((e) => {
        const badge = typeBadge(typeConfig, e.type);
        return (
          <div key={e.id} className="relative flex items-center gap-3 px-2 py-3.5 hover:bg-accent/40 transition-colors group">
            <span className="w-1.5 h-1.5 rounded-full flex-none" style={{ backgroundColor: accent }} aria-hidden />
            <EntityQuickViewPopover resourcePath={resourcePath} id={e.id} onEdit={onEdit}>
              <button type="button" aria-label={`Preview ${singular}: ${e.name}`} className="flex-1 min-w-0 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <p className="font-medium text-[15px] leading-tight truncate">{e.name}</p>
                {e.description && <p className="text-[13px] text-muted-foreground truncate mt-0.5">{e.description}</p>}
              </button>
            </EntityQuickViewPopover>
            {badge && <Badge variant={badge.variant} className="capitalize flex-none">{badge.label}</Badge>}
            <Link href={`/${resourcePath}/${e.id}`} aria-label={`Open ${singular}: ${e.name}`} className="flex-none rounded-md p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ArrowUpRight className="w-4 h-4" />
            </Link>
            <Button size="icon-sm" variant="ghost" aria-label={`Delete ${singular}: ${e.name}`} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-destructive hover:text-destructive" onClick={(ev) => onDelete(e.id, ev)}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint components/entities/views/EntityListRows.tsx`
Expected: clean. (Confirm the `Badge` variants `hp`/`outline`/`secondary` exist in `components/ui/badge.tsx`.)

- [ ] **Step 3: Commit**

```bash
git add components/entities/views/EntityListRows.tsx
git commit -m "feat(entities): list view renderer"
```

---

## Task 4: `EntityCardGrid.tsx` — gallery view

**Files:** Create `components/entities/views/EntityCardGrid.tsx`

- [ ] **Step 1: Create the component**

```tsx
// components/entities/views/EntityCardGrid.tsx
"use client";

import React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, ArrowUpRight } from "lucide-react";
import { EntityQuickViewPopover } from "@/components/entities/EntityQuickViewPopover";
import type { EntityViewProps } from "@/components/entities/views/EntityListRows";
import type { TypeConfig } from "@/lib/entities/entity-list-view";

function typeBadge(typeConfig: TypeConfig | null, type: string | null) {
  if (!typeConfig || !type) return null;
  const opt = typeConfig.options.find((o) => o.value === type);
  return { label: opt?.label ?? type, variant: (opt?.badgeVariant ?? "outline") as "hp" | "outline" | "secondary" };
}

export function EntityCardGrid({ items, resourcePath, singular, accent, typeConfig, onEdit, onDelete }: EntityViewProps) {
  return (
    <div className="mt-4 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((e) => {
        const badge = typeBadge(typeConfig, e.type);
        return (
          <div key={e.id} className="relative group rounded-xl border border-border bg-card p-3.5 hover:border-muted-foreground/40 transition-colors">
            <div className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full flex-none mt-2" style={{ backgroundColor: accent }} aria-hidden />
              <EntityQuickViewPopover resourcePath={resourcePath} id={e.id} onEdit={onEdit}>
                <button type="button" aria-label={`Preview ${singular}: ${e.name}`} className="flex-1 min-w-0 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <p className="font-medium text-[15px] leading-tight truncate">{e.name}</p>
                  {badge && <Badge variant={badge.variant} className="capitalize mt-1">{badge.label}</Badge>}
                </button>
              </EntityQuickViewPopover>
            </div>
            {e.description && <p className="mt-2 text-[13px] text-muted-foreground line-clamp-3">{e.description}</p>}
            <div className="mt-3 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <Link href={`/${resourcePath}/${e.id}`} aria-label={`Open ${singular}: ${e.name}`} className="rounded-md p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <ArrowUpRight className="w-4 h-4" />
              </Link>
              <Button size="icon-sm" variant="ghost" aria-label={`Delete ${singular}: ${e.name}`} className="ml-auto text-destructive hover:text-destructive" onClick={(ev) => onDelete(e.id, ev)}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint components/entities/views/EntityCardGrid.tsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/entities/views/EntityCardGrid.tsx
git commit -m "feat(entities): gallery (card grid) view renderer"
```

---

## Task 5: `EntityTable.tsx` — table view

**Files:** Create `components/entities/views/EntityTable.tsx`

Sortable headers (Name, Type, + selected property columns) and a per-row actions cell. Clicking a header calls `onSort(key)` (the shell toggles direction).

- [ ] **Step 1: Create the component**

```tsx
// components/entities/views/EntityTable.tsx
"use client";

import React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, ArrowUpRight, ArrowUp, ArrowDown } from "lucide-react";
import { EntityQuickViewPopover } from "@/components/entities/EntityQuickViewPopover";
import { FIELD_TYPE, SORT_NAME, type EntityListItem, type TypeConfig, type SortState } from "@/lib/entities/entity-list-view";
import type { EntityDetailResponse } from "@/components/entities/entity-quick-view-model";

interface EntityTableProps {
  items: EntityListItem[];
  resourcePath: "characters" | "locations" | "items" | "factions";
  singular: string;
  typeConfig: TypeConfig | null;
  columns: string[]; // property labels
  sort: SortState;
  onSort: (key: string) => void;
  onEdit: (entity: EntityDetailResponse) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}

function SortHeader({ label, sortKey, sort, onSort, className }: { label: string; sortKey: string; sort: SortState; onSort: (k: string) => void; className?: string }) {
  const active = sort.key === sortKey;
  return (
    <th className={`text-left text-[11px] uppercase tracking-wide text-muted-foreground font-medium px-3 py-2 ${className ?? ""}`}>
      <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        {active && (sort.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      </button>
    </th>
  );
}

export function EntityTable({ items, resourcePath, singular, typeConfig, columns, sort, onSort, onEdit, onDelete }: EntityTableProps) {
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <SortHeader label="Name" sortKey={SORT_NAME} sort={sort} onSort={onSort} />
            {typeConfig && <SortHeader label={typeConfig.label} sortKey={FIELD_TYPE} sort={sort} onSort={onSort} />}
            {columns.map((c) => (
              <SortHeader key={c} label={c} sortKey={c} sort={sort} onSort={onSort} />
            ))}
            <th className="px-3 py-2 w-px" />
          </tr>
        </thead>
        <tbody>
          {items.map((e) => {
            const opt = typeConfig?.options.find((o) => o.value === e.type);
            return (
              <tr key={e.id} className="border-b border-border/60 last:border-0 hover:bg-accent/30 group">
                <td className="px-3 py-2">
                  <EntityQuickViewPopover resourcePath={resourcePath} id={e.id} onEdit={onEdit}>
                    <button type="button" aria-label={`Preview ${singular}: ${e.name}`} className="text-left font-medium rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:underline">
                      {e.name}
                    </button>
                  </EntityQuickViewPopover>
                </td>
                {typeConfig && (
                  <td className="px-3 py-2">
                    {e.type && <Badge variant={(opt?.badgeVariant ?? "outline") as "hp" | "outline" | "secondary"} className="capitalize">{opt?.label ?? e.type}</Badge>}
                  </td>
                )}
                {columns.map((c) => (
                  <td key={c} className="px-3 py-2 text-muted-foreground">{e.props.find((p) => p.label === c)?.value ?? "—"}</td>
                ))}
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                    <Link href={`/${resourcePath}/${e.id}`} aria-label={`Open ${singular}: ${e.name}`} className="rounded-md p-1 text-muted-foreground hover:text-foreground">
                      <ArrowUpRight className="w-4 h-4" />
                    </Link>
                    <Button size="icon-sm" variant="ghost" aria-label={`Delete ${singular}: ${e.name}`} className="text-destructive hover:text-destructive" onClick={(ev) => onDelete(e.id, ev)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint components/entities/views/EntityTable.tsx`
Expected: clean. (Confirm lucide exports `ArrowUp`/`ArrowDown`.)

- [ ] **Step 3: Commit**

```bash
git add components/entities/views/EntityTable.tsx
git commit -m "feat(entities): table view renderer with sortable headers"
```

---

## Task 6: `EntityListToolbar.tsx` — search, filters, sort, view switch, columns

**Files:** Create `components/entities/EntityListToolbar.tsx`

Composes: search Input, an **Add-filter** popover (fields → values checklist) with removable chips, a **Sort** popover (Name + fields, toggling dir), a **view switcher** (three icon buttons), and — in table view only — a **Columns** popover (property-label checklist).

- [ ] **Step 1: Create the component**

```tsx
// components/entities/EntityListToolbar.tsx
"use client";

import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { List, LayoutGrid, Table as TableIcon, Filter, ArrowUpDown, Columns3, X, Check } from "lucide-react";
import {
  FIELD_TYPE,
  SORT_NAME,
  type EntityView,
  type FilterField,
  type ActiveFilter,
  type SortState,
} from "@/lib/entities/entity-list-view";

interface EntityListToolbarProps {
  label: string;
  query: string;
  onQuery: (q: string) => void;
  fields: FilterField[];
  filters: ActiveFilter[];
  onToggleFilterValue: (field: string, value: string) => void;
  onClearField: (field: string) => void;
  sort: SortState;
  onSort: (key: string) => void; // toggles dir if same key
  view: EntityView;
  onView: (v: EntityView) => void;
  columns: string[];
  onToggleColumn: (label: string) => void;
}

const VIEWS: { view: EntityView; icon: typeof List; label: string }[] = [
  { view: "list", icon: List, label: "List" },
  { view: "gallery", icon: LayoutGrid, label: "Gallery" },
  { view: "table", icon: TableIcon, label: "Table" },
];

function fieldLabel(fields: FilterField[], key: string) {
  return fields.find((f) => f.key === key)?.label ?? key;
}
function valueLabel(fields: FilterField[], key: string, value: string) {
  return fields.find((f) => f.key === key)?.values.find((v) => v.value === value)?.label ?? value;
}

export function EntityListToolbar(props: EntityListToolbarProps) {
  const { label, query, onQuery, fields, filters, onToggleFilterValue, onClearField, sort, onSort, view, onView, columns, onToggleColumn } = props;
  const [openField, setOpenField] = useState<string | null>(null); // which field's values are shown in the add-filter popover
  const propertyFields = fields.filter((f) => f.key !== FIELD_TYPE);

  return (
    <div className="mt-6 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="flex-1 min-w-[12rem]" placeholder={`Search ${label.toLowerCase()}…`} value={query} onChange={(e) => onQuery(e.target.value)} />

        {/* Add filter */}
        {fields.length > 0 && (
          <Popover onOpenChange={(o) => !o && setOpenField(null)}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5"><Filter className="w-3.5 h-3.5" /> Filter</Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-1">
              {openField === null ? (
                <div className="max-h-72 overflow-y-auto">
                  <p className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">Filter by</p>
                  {fields.map((f) => (
                    <button key={f.key} type="button" onClick={() => setOpenField(f.key)} className="w-full text-left px-2 py-1.5 text-sm rounded-md hover:bg-accent">{f.label}</button>
                  ))}
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  <button type="button" onClick={() => setOpenField(null)} className="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground">← {fieldLabel(fields, openField)}</button>
                  {fields.find((f) => f.key === openField)!.values.map((v) => {
                    const checked = filters.find((f) => f.field === openField)?.values.includes(v.value) ?? false;
                    return (
                      <button key={v.value} type="button" onClick={() => onToggleFilterValue(openField, v.value)} className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent">
                        <span className="w-3.5 h-3.5 flex-none">{checked && <Check className="w-3.5 h-3.5" />}</span>
                        <span className="truncate">{v.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </PopoverContent>
          </Popover>
        )}

        {/* Sort */}
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5"><ArrowUpDown className="w-3.5 h-3.5" /> Sort</Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-1">
            <div className="max-h-72 overflow-y-auto">
              <button type="button" onClick={() => onSort(SORT_NAME)} className="w-full flex items-center justify-between px-2 py-1.5 text-sm rounded-md hover:bg-accent">
                Name {sort.key === SORT_NAME && <span className="text-xs text-muted-foreground">{sort.dir === "asc" ? "A→Z" : "Z→A"}</span>}
              </button>
              {fields.map((f) => (
                <button key={f.key} type="button" onClick={() => onSort(f.key)} className="w-full flex items-center justify-between px-2 py-1.5 text-sm rounded-md hover:bg-accent">
                  {f.label} {sort.key === f.key && <span className="text-xs text-muted-foreground">{sort.dir === "asc" ? "↑" : "↓"}</span>}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Columns (table only) */}
        {view === "table" && propertyFields.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5"><Columns3 className="w-3.5 h-3.5" /> Columns</Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-1">
              <div className="max-h-72 overflow-y-auto">
                <p className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">Property columns</p>
                {propertyFields.map((f) => {
                  const on = columns.includes(f.key);
                  return (
                    <button key={f.key} type="button" onClick={() => onToggleColumn(f.key)} className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent">
                      <span className="w-3.5 h-3.5 flex-none">{on && <Check className="w-3.5 h-3.5" />}</span>
                      <span className="truncate">{f.label}</span>
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        )}

        {/* View switcher */}
        <div className="flex items-center rounded-lg border border-border p-0.5">
          {VIEWS.map(({ view: v, icon: Icon, label: l }) => (
            <button key={v} type="button" aria-label={`${l} view`} aria-pressed={view === v} onClick={() => onView(v)} className={`rounded-md p-1.5 ${view === v ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <Icon className="w-4 h-4" />
            </button>
          ))}
        </div>
      </div>

      {/* Active filter chips */}
      {filters.some((f) => f.values.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {filters.filter((f) => f.values.length > 0).map((f) => (
            <span key={f.field} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-accent/40 pl-2.5 pr-1 py-0.5 text-xs">
              <span className="text-muted-foreground">{fieldLabel(fields, f.field)}:</span>
              <span className="font-medium">{f.values.map((v) => valueLabel(fields, f.field, v)).join(", ")}</span>
              <button type="button" aria-label={`Clear ${fieldLabel(fields, f.field)} filter`} onClick={() => onClearField(f.field)} className="rounded-full p-0.5 hover:bg-background">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint components/entities/EntityListToolbar.tsx`
Expected: clean. (Confirm lucide exports `List`, `LayoutGrid`, `Table`, `Filter`, `ArrowUpDown`, `Columns3`, `Check` — all standard.)

- [ ] **Step 3: Commit**

```bash
git add components/entities/EntityListToolbar.tsx
git commit -m "feat(entities): list toolbar — filters, sort, view switch, columns"
```

---

## Task 7: `EntityListView.tsx` — shared shell

**Files:** Create `components/entities/EntityListView.tsx`

Owns view/filter/sort/columns state; composes the engine + store + toolbar + the chosen view. Seeds `view` from `readEntityView` during render (the app's seed-during-render pattern, e.g. `WorldMapViewer`), and writes on change. Default columns = first up to 3 property labels present.

- [ ] **Step 1: Create the component**

```tsx
// components/entities/EntityListView.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { EntityListToolbar } from "@/components/entities/EntityListToolbar";
import { EntityListRows, type EntityViewProps } from "@/components/entities/views/EntityListRows";
import { EntityCardGrid } from "@/components/entities/views/EntityCardGrid";
import { EntityTable } from "@/components/entities/views/EntityTable";
import { readEntityView, writeEntityView } from "@/components/entities/entity-view-store";
import {
  normalizeRow,
  deriveFilterFields,
  applyFilters,
  sortItems,
  FIELD_TYPE,
  SORT_NAME,
  type RawEntityRow,
  type TypeConfig,
  type EntityView,
  type ActiveFilter,
  type SortState,
} from "@/lib/entities/entity-list-view";
import type { EntityDetailResponse } from "@/components/entities/entity-quick-view-model";

interface EntityListViewProps {
  resourcePath: EntityViewProps["resourcePath"];
  label: string;
  singular: string;
  accent: string;
  typeConfig: TypeConfig | null;
  items: RawEntityRow[];
  emptyHint: string; // e.g. "No locations yet."
  onEdit: (entity: EntityDetailResponse) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}

export function EntityListView(props: EntityListViewProps) {
  const { resourcePath, label, singular, accent, typeConfig, items: rawItems, emptyHint, onEdit, onDelete } = props;

  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<ActiveFilter[]>([]);
  const [sort, setSort] = useState<SortState>({ key: SORT_NAME, dir: "asc" });
  const [columns, setColumns] = useState<string[] | null>(null); // null = default

  // Start at the SSR-safe default and read the persisted choice AFTER mount, so
  // the server-rendered HTML (always "list") matches the first client render —
  // reading localStorage during render would cause a hydration mismatch. These
  // pages are SSR'd client components (unlike the ssr:false map viewers, which
  // seed during render).
  const [view, setViewState] = useState<EntityView>("list");
  useEffect(() => {
    setViewState(readEntityView(resourcePath));
  }, [resourcePath]);
  const setView = (v: EntityView) => {
    setViewState(v);
    writeEntityView(resourcePath, v);
  };

  const items = useMemo(() => rawItems.map(normalizeRow), [rawItems]);
  const fields = useMemo(() => deriveFilterFields(items, typeConfig), [items, typeConfig]);
  const visible = useMemo(() => sortItems(applyFilters(items, { query, filters }), sort), [items, query, filters, sort]);

  const propertyLabels = fields.filter((f) => f.key !== FIELD_TYPE).map((f) => f.key);
  const activeColumns = columns ?? propertyLabels.slice(0, 3);

  function toggleFilterValue(field: string, value: string) {
    setFilters((prev) => {
      const existing = prev.find((f) => f.field === field);
      if (!existing) return [...prev, { field, values: [value] }];
      const values = existing.values.includes(value) ? existing.values.filter((v) => v !== value) : [...existing.values, value];
      return prev.map((f) => (f.field === field ? { ...f, values } : f)).filter((f) => f.values.length > 0);
    });
  }
  function clearField(field: string) {
    setFilters((prev) => prev.filter((f) => f.field !== field));
  }
  function handleSort(key: string) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }
  function toggleColumn(label: string) {
    setColumns(() => {
      const base = columns ?? propertyLabels.slice(0, 3);
      return base.includes(label) ? base.filter((c) => c !== label) : [...base, label];
    });
  }

  const viewProps: EntityViewProps = { items: visible, resourcePath, singular, accent, typeConfig, onEdit, onDelete };

  return (
    <>
      <EntityListToolbar
        label={label}
        query={query}
        onQuery={setQuery}
        fields={fields}
        filters={filters}
        onToggleFilterValue={toggleFilterValue}
        onClearField={clearField}
        sort={sort}
        onSort={handleSort}
        view={view}
        onView={setView}
        columns={activeColumns}
        onToggleColumn={toggleColumn}
      />

      {visible.length === 0 ? (
        <div className="mt-6 text-center py-16 border border-dashed border-border rounded-xl text-muted-foreground">
          {items.length === 0 ? emptyHint : "Nothing matches those filters."}
        </div>
      ) : view === "gallery" ? (
        <EntityCardGrid {...viewProps} />
      ) : view === "table" ? (
        <EntityTable items={visible} resourcePath={resourcePath} singular={singular} typeConfig={typeConfig} columns={activeColumns} sort={sort} onSort={handleSort} onEdit={onEdit} onDelete={onDelete} />
      ) : (
        <EntityListRows {...viewProps} />
      )}
    </>
  );
}
```

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint components/entities/EntityListView.tsx`
Expected: clean. The persisted view is read in a **mount effect** (not during render) to stay hydration-safe on these SSR'd pages. If eslint's `react-hooks/set-state-in-effect` flags the `setViewState(readEntityView(...))` call, it is a legitimate external-store sync that cannot run during SSR render — report it and resolve by guarding with a `useSyncExternalStore`-style read or a `hasMounted` ref; do NOT move the localStorage read into render (that reintroduces the hydration mismatch).

- [ ] **Step 3: Commit**

```bash
git add components/entities/EntityListView.tsx
git commit -m "feat(entities): EntityListView shared shell composing toolbar + views"
```

---

## Task 8: Refactor `SimpleEntityManager.tsx` to use EntityListView

**Files:** Modify `components/entities/SimpleEntityManager.tsx`

Keep the fetch/load, the header (title/count/archived/New), and the two form dialogs. Replace the inline search + row list with `<EntityListView>`.

- [ ] **Step 1: Replace the file**

```tsx
// components/entities/SimpleEntityManager.tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Plus, type LucideIcon } from "lucide-react";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SimpleEntityFormDialog, type SimpleEntity } from "@/components/entities/SimpleEntityFormDialog";
import { EntityListView } from "@/components/entities/EntityListView";
import type { TypeConfig, RawEntityRow } from "@/lib/entities/entity-list-view";
import type { EntityDetailResponse } from "@/components/entities/entity-quick-view-model";

interface SimpleEntityManagerProps {
  resourcePath: "locations" | "items" | "factions";
  label: string;
  icon: LucideIcon;
}

const ACCENT: Record<SimpleEntityManagerProps["resourcePath"], string> = {
  locations: "var(--marker-location)",
  items: "var(--marker-item)",
  factions: "var(--marker-faction)",
};

const TYPE_CONFIG: Partial<Record<SimpleEntityManagerProps["resourcePath"], TypeConfig>> = {
  locations: {
    label: "Type",
    options: [
      { value: "city", label: "City" },
      { value: "town", label: "Town" },
      { value: "poi", label: "Point of Interest" },
      { value: "region", label: "Region" },
      { value: "other", label: "Other" },
    ],
  },
};

export function SimpleEntityManager({ resourcePath, label, icon: Icon }: SimpleEntityManagerProps) {
  const { activeCampaignId } = useCampaignStore();
  const confirm = useConfirm();
  const [entities, setEntities] = useState<RawEntityRow[]>([]);
  const [archivedCount, setArchivedCount] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editEntity, setEditEntity] = useState<SimpleEntity | null>(null);

  const load = useCallback(() => {
    if (!activeCampaignId) return;
    const url = `/api/${resourcePath}?campaignId=${activeCampaignId}${showArchived ? "&includeArchived=1" : ""}`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        setEntities(data.items);
        setArchivedCount(data.archivedCount);
      });
  }, [activeCampaignId, resourcePath, showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  const singular = label.toLowerCase().replace(/s$/, "");
  async function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const ok = await confirm({ title: `Delete ${singular}?`, description: "This permanently removes it from the campaign.", confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    await fetch(`/api/${resourcePath}/${id}`, { method: "DELETE" });
    setEntities((prev) => prev.filter((x) => x.id !== id));
  }

  const accent = ACCENT[resourcePath];

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <header className="flex items-end justify-between gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-3.5 min-w-0">
          <Icon className="w-7 h-7 flex-none" style={{ color: accent }} />
          <div className="min-w-0">
            <h1 className="font-display text-4xl leading-none">{label}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="tabular-nums font-medium text-foreground">{entities.length}</span>{" "}
              {entities.length === 1 ? singular : label.toLowerCase()} across Exandria
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-none">
          {archivedCount > 0 && (
            <Button size="sm" variant="outline" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
            </Button>
          )}
          <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5 flex-none">
            <Plus className="w-4 h-4" /> New {singular}
          </Button>
        </div>
      </header>

      <EntityListView
        resourcePath={resourcePath}
        label={label}
        singular={singular}
        accent={accent}
        typeConfig={TYPE_CONFIG[resourcePath] ?? null}
        items={entities}
        emptyHint={`No ${label.toLowerCase()} yet.`}
        onEdit={(entity: EntityDetailResponse) =>
          setEditEntity({ id: entity.id, name: entity.name, description: entity.description ?? null, notionUrl: entity.notionUrl ?? null, type: entity.type ?? null })
        }
        onDelete={remove}
      />

      <SimpleEntityFormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} resourcePath={resourcePath} label={label} campaignId={activeCampaignId ?? ""} entity={null} onSaved={load} />
      <SimpleEntityFormDialog key={editEntity?.id ?? "edit"} open={editEntity !== null} onClose={() => setEditEntity(null)} resourcePath={resourcePath} label={label} campaignId={activeCampaignId ?? ""} entity={editEntity} onSaved={load} />
    </div>
  );
}
```

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint components/entities/SimpleEntityManager.tsx`
Expected: clean (no unused imports — `Input`, `Link`, `Trash2`, `ArrowUpRight`, `EntityQuickViewPopover` are gone from this file, now living in the views).

- [ ] **Step 3: Commit**

```bash
git add components/entities/SimpleEntityManager.tsx
git commit -m "refactor(entities): SimpleEntityManager uses shared EntityListView"
```

---

## Task 9: Refactor `app/characters/page.tsx` to use EntityListView

**Files:** Modify `app/characters/page.tsx`

- [ ] **Step 1: Replace the file**

```tsx
// app/characters/page.tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Users } from "lucide-react";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EntityListView } from "@/components/entities/EntityListView";
import { CharacterFormDialog, type CharacterWithLinks } from "@/components/entities/CharacterFormDialog";
import type { TypeConfig, RawEntityRow } from "@/lib/entities/entity-list-view";
import type { EntityDetailResponse } from "@/components/entities/entity-quick-view-model";

const TYPE_CONFIG: TypeConfig = {
  label: "Type",
  options: [
    { value: "pc", label: "PC", badgeVariant: "hp" },
    { value: "npc", label: "NPC", badgeVariant: "outline" },
  ],
};

export default function CharactersPage() {
  const { activeCampaignId } = useCampaignStore();
  const confirm = useConfirm();
  const [characters, setCharacters] = useState<RawEntityRow[]>([]);
  const [archivedCount, setArchivedCount] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editCharacter, setEditCharacter] = useState<CharacterWithLinks | null>(null);

  const load = useCallback(() => {
    if (!activeCampaignId) return;
    const url = `/api/characters?campaignId=${activeCampaignId}${showArchived ? "&includeArchived=1" : ""}`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        setCharacters(data.items);
        setArchivedCount(data.archivedCount);
      });
  }, [activeCampaignId, showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const ok = await confirm({ title: "Delete character?", description: "This permanently removes the character from the campaign.", confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    await fetch(`/api/characters/${id}`, { method: "DELETE" });
    setCharacters((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <header className="flex items-end justify-between gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-3.5 min-w-0">
          <Users className="w-7 h-7 flex-none text-[var(--marker-character)]" />
          <div className="min-w-0">
            <h1 className="font-display text-4xl leading-none">Characters</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="tabular-nums font-medium text-foreground">{characters.length}</span>{" "}
              {characters.length === 1 ? "hero and villain" : "heroes and villains"} in your campaign
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-none">
          {archivedCount > 0 && (
            <Button size="sm" variant="outline" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
            </Button>
          )}
          <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5 flex-none">
            <Plus className="w-4 h-4" /> New character
          </Button>
        </div>
      </header>

      <EntityListView
        resourcePath="characters"
        label="Characters"
        singular="character"
        accent="var(--marker-character)"
        typeConfig={TYPE_CONFIG}
        items={characters}
        emptyHint="No characters yet."
        onEdit={(entity: EntityDetailResponse) => setEditCharacter(entity as unknown as CharacterWithLinks)}
        onDelete={remove}
      />

      <CharacterFormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} campaignId={activeCampaignId ?? ""} character={null} onSaved={load} />
      <CharacterFormDialog key={editCharacter?.id ?? "edit"} open={editCharacter !== null} onClose={() => setEditCharacter(null)} campaignId={activeCampaignId ?? ""} character={editCharacter} onSaved={load} />
    </div>
  );
}
```

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint app/characters/page.tsx`
Expected: clean (no unused imports).

- [ ] **Step 3: Commit**

```bash
git add app/characters/page.tsx
git commit -m "refactor(entities): characters page uses shared EntityListView"
```

---

## Task 10: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Tests + type-check + lint**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all tests PASS (incl. the two new suites); tsc clean; lint introduces **no new errors** (baseline is 0 errors / 14 warnings).

- [ ] **Step 2: Browser sweep** (dev server; seed a few entities per type if the DB is empty — several with differing `type` and Notion props so filters/sort/table columns have data to work with; note the worktree DB has SP1/SP2's Emon/Vex/Vox Machina/Fenthras)

For each of `/characters`, `/locations`, `/items`, `/factions`:
- **View switch**: toggle list → gallery → table; reload the page and confirm the choice persisted (per resource).
- **Filter**: open Filter → pick a field (Type where present, and a Notion property) → pick value(s); confirm chips appear and the set narrows; multiple values within a field OR; a second field ANDs; remove a chip via its ✕.
- **Sort**: Sort → Name (toggles A→Z / Z→A) and a property; in Table, click a column header to sort and toggle direction.
- **Columns** (table): add/remove a property column via Columns ▾.
- **Interactions preserved**: clicking a name opens the SP1 quick-view popover; the ArrowUpRight icon opens the full page; Edit opens the correct form dialog; Delete removes and the list updates; archived toggle + New still work; empty-state text is right.
- Confirm no console errors on each page.
- Screenshot the table view with an active filter + a couple property columns to share.

- [ ] **Step 3: Final commit (if fixups were needed)**

```bash
git add -A
git commit -m "chore(entities): filters/views verification fixups"
```

---

## Self-review notes (for the implementer)

- **SP1/SP2 must keep working:** the row view preserves SP1's popover/nav/delete behavior exactly; `EntityQuickViewPopover` and the engine are reused unchanged.
- **Refactor discipline:** Tasks 8–9 remove now-unused imports from the two wrappers (Input/Link/Badge/Trash2/ArrowUpRight/EntityQuickViewPopover moved into the views). tsc + eslint must be clean.
- **Widened container:** wrappers use `max-w-5xl` (was `max-w-3xl`) so table/gallery have room; verify list still reads well.
- **Ephemeral filters/sort, persisted view:** only `entityView:{resourcePath}` is stored; filters/sort live in component state and reset on unmount — by design.
- **No new test tooling:** only the engine + store are unit-tested; the rest is browser-verified.
- **Badge variants:** confirm `hp`/`outline`/`secondary` exist in `components/ui/badge.tsx` before relying on them (they were listed in the SP1 exploration).
