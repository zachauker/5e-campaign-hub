# Entity List Filters, Views & Sorting — Design

**Date:** 2026-07-22
**Status:** Approved (design), pending spec review

## Context — part of a larger UI/UX effort

**Sub-project 3 (SP3) of 4** (see `2026-07-21-entity-quick-view-design.md` for the
full sequencing):

1. **SP1 (done, merged)** — Entity quick-view popover.
2. **SP2 (done, merged)** — Map pin quick-view slide-overs.
3. **SP3 (this doc)** — Entity list filters + alternate views (gallery/table) + sorting.
4. **SP4** — Editable pin appearance.

## Problem

The four entity list pages (characters, locations, items, factions) offer only a
name search and an archived toggle, and render a single fixed layout — divided
rows in alphabetical order. There's no way to filter by an entity's properties
(e.g. locations of Type "City", or characters with Disposition "Hostile"), no way
to change the layout to compare entities, and no sorting beyond the fixed A→Z.
The rich data is there — every entity carries a `type` (locations/characters) and
a bag of Notion properties (`notionProps`) — but the list surfaces none of it.

Additionally, `components/entities/SimpleEntityManager.tsx` (locations/items/
factions) and `app/characters/page.tsx` duplicate their list logic, so adding
this behavior naïvely would mean building it twice.

## Goal

Give every entity list: (1) **filtering** by Type and by any Notion property,
(2) **alternate views** — list, gallery (cards), table, and (3) **sorting**. Build
the shared behavior once and have both list surfaces consume it.

## Decisions

- **Client-side, no API/schema changes.** The list endpoint
  (`GET /api/{resourcePath}`) already returns full rows including `type` and the
  raw `notionProps` JSON string. Filtering/sorting/deriving-fields happens on the
  already-loaded list; `notionProps` is parsed on the client.
- **Views: list · gallery · table**, chosen via a header **view switcher**. The
  choice **persists per resource** in `localStorage` (key `entityView:{resourcePath}`),
  mirroring the map's `markerLabels:` / `markerLayers:` pattern. Default: `list`.
- **Filters = "Add filter" chips.** Available fields = `Type` (only where the
  entity has one) + the distinct set of Notion property labels present across the
  loaded items. Choosing a field then a value adds a removable chip. **Within one
  field, multiple values OR; across fields, AND.** Combined with the existing name
  search (AND) and archived toggle. Filters are **ephemeral** — they reset when
  the user leaves the page (not persisted), to avoid stale-filter confusion.
- **Sorting** = by Name (A→Z default, Z→A) or by any property, via a sort control;
  in Table view, clicking a column header sorts by that column (toggling
  direction). Sort is ephemeral like filters.
- **Table columns:** Name, Type (where present), Description, plus a **Columns ▾**
  picker to add any Notion property label as a column. Defaults to the 2–3
  most-common property labels present in the data. Property values come from the
  parsed `notionProps`.
- **Scope: all four entity types.** The shared toolkit powers
  `SimpleEntityManager` (locations/items/factions) and the characters page alike;
  each passes its type config + edit dialog.
- **Interactions preserved across views:** every view keeps SP1's behavior —
  clicking an entity opens the quick-view popover, a dedicated icon opens the full
  page, and delete is available.
- **Container widens** for gallery/table (from `max-w-3xl` to a wider max) so cards
  and columns have room; list stays comfortable.

## Out of scope (YAGNI)

- Server-side filtering/sorting/pagination (list sizes are campaign-scoped and
  small; client-side is sufficient).
- Saving named filter/view presets.
- Persisting filters/sort across navigation (view choice persists; filters/sort do
  not).
- Filtering on relationships or map presence (only Type + Notion props).
- Numeric/range/date-aware filtering — property values are treated as strings
  (equality match). A follow-up could add typed operators.
- Bulk actions / multi-select in the table.
- Any change to the entity detail pages or the SP1 popover internals.

## Architecture & components

### New: `lib/entities/entity-list-view.ts` (pure, unit-tested)
The derive/filter/sort engine, pure and testable in the node Vitest env:
- A normalized item shape `EntityListItem` = `{ id; name; description; type?;
  props: {label; value}[]; archived? }` built from a raw list row (parsing
  `notionProps`).
- `deriveFilterFields(items, typeConfig)` → the available filter fields (`Type` +
  property labels) each with their distinct values.
- `applyFilters(items, { query, filters })` → items matching name-search AND the
  active field/value filters (within-field OR, across-field AND).
- `sortItems(items, sort)` → sorted copy (by `name` or a property label; asc/desc;
  case-insensitive; entities missing the sort key sort last).
- Types for `FilterState` (`{ field: string; values: string[] }[]`), `SortState`
  (`{ key: string; dir: "asc" | "desc" }`), `EntityView` (`"list" | "gallery" |
  "table"`).
This is the ONLY unit-tested unit; components are browser-verified per repo
convention.

### New: `components/entities/entity-view-store.ts`
Tiny `localStorage` helper `readEntityView(resourcePath)` / `writeEntityView(...)`
(key `entityView:{resourcePath}`), SSR-guarded and defaulting to `"list"` —
modeled on `components/maps/marker-labels.ts`. Unit-tested alongside the engine.

### New: `components/entities/EntityListView.tsx` (the shared shell)
The component both surfaces render. Props:
- `resourcePath`, `label`, `singular`, `icon`, `accent`
- `items: RawEntityRow[]` + `reload: () => void` (owner still fetches)
- `typeConfig: { label: string; options: { value: string; label: string;
  badgeVariant?: string }[] } | null` (locations/characters supply it; items/
  factions pass null)
- `archived`: `{ count: number; show: boolean; onToggle: () => void } | null`
- `onNew: () => void`, `onEdit: (row) => void`, `onDelete: (id) => Promise<void>`
- `renderDialogs?: React.ReactNode` (the owner mounts its own form dialogs)

It owns: the journal-style header (title/count/New/archived), the toolbar
(`EntityListToolbar`), view state (seeded from `readEntityView`), filter + sort
state, and it renders the chosen view. It composes the engine + store.

### New: `components/entities/EntityListToolbar.tsx`
Search input, the **Add-filter** control (a `Popover` listing fields → values;
active filters shown as removable chips), the **sort** control, and the **view
switcher** (segmented list/gallery/table icons). For Table view it also exposes
the **Columns ▾** picker. Uses the SP1 `components/ui/popover.tsx` primitive.

### New view renderers
- `components/entities/views/EntityListRows.tsx` — the current row layout (the
  markup currently inline in `SimpleEntityManager`), each row wrapping
  `EntityQuickViewPopover` + nav link + delete.
- `components/entities/views/EntityCardGrid.tsx` — responsive card grid; each card
  = accent dot/icon + name + type badge + description snippet, wrapped in
  `EntityQuickViewPopover`, with hover open/delete affordances.
- `components/entities/views/EntityTable.tsx` — table with sortable headers and
  the Name/Type/Description + selected-property columns; row name cell wraps the
  popover; open/delete in an actions cell.

### Refactor: `components/entities/SimpleEntityManager.tsx`
Becomes a thin wrapper: fetches (unchanged), builds the location type config
(`city/town/poi/region/other`) or `null` (items/factions), and renders
`<EntityListView>` + its `SimpleEntityFormDialog` instances (new + edit).

### Refactor: `app/characters/page.tsx`
Same: fetches, supplies the pc/npc type config (with the `hp`/`outline` badge
variants it uses today), and renders `<EntityListView>` + its
`CharacterFormDialog` instances.

## Data flow

```
owner fetches /api/{resourcePath}  → RawEntityRow[]  (incl. type + notionProps string)
        │
        ▼
   <EntityListView items reload typeConfig onEdit onDelete ...>
        normalize rows → EntityListItem[] (parse notionProps)
        deriveFilterFields(items, typeConfig)         → toolbar field/value options
        applyFilters(items, {query, filters})          → matched
        sortItems(matched, sort)                        → visible
        view = readEntityView(resourcePath) (persisted)
        render EntityListRows | EntityCardGrid | EntityTable(columns)
        each entity → EntityQuickViewPopover (peek) + nav link + delete + onEdit
```

## Testing

- Unit tests (Vitest, node) for `lib/entities/entity-list-view.ts`:
  - `deriveFilterFields`: Type field present only with a typeConfig; property
    labels collected from `notionProps`; distinct values per field.
  - `applyFilters`: name search; single filter; within-field OR; across-field AND;
    empty filters → all; property absent on an item → excluded by that filter.
  - `sortItems`: name asc/desc; by-property asc/desc; missing-key items sort last;
    case-insensitive.
- Unit tests for `entity-view-store.ts` (default / round-trip / malformed / no
  window), mirroring `marker-labels.test.ts`.
- Browser verification (dev server) on each of the four list pages: switch
  list/gallery/table (choice persists across reload); add/remove filter chips
  (Type + a Notion property) and confirm the set narrows correctly across views;
  sort by name and by a property, and via a table header; the SP1 popover / nav /
  edit / delete still work in every view; empty-state and archived toggle behave.

## Risks / notes

- **Refactor touches SP1-modified files.** `SimpleEntityManager` and the
  characters page were restructured in SP1 (popover rows). The row view must keep
  that exact behavior; verify the SP1 popover/nav/delete/edit in the browser after
  refactor.
- **Heterogeneous props.** Property labels/values differ per Notion source and per
  entity; the derive step must union labels across items and treat a missing
  property as "no value" (excluded by a filter on it, blank in a table cell).
- **`notionProps` is an unparsed string in the list payload** (parsed only in the
  detail route today) — the normalize step must `JSON.parse` defensively (treat
  malformed/na as `[]`).
- **Characters unification.** Folding the bespoke characters page into the shared
  component is the largest change; keep its pc/npc badge styling and its
  `CharacterFormDialog` wiring identical. The D&D Beyond bits live on the detail
  page, not the list, so they're unaffected.
- **View persistence only.** Filters/sort intentionally reset on navigation; only
  the view choice is stored.
