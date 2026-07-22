# Entity Quick-View Popover — Design

**Date:** 2026-07-21
**Status:** Approved (design), pending spec review

## Context — part of a larger UI/UX effort

This is **sub-project 1 (SP1) of 4** UI/UX enhancements, sequenced so shared code
lands first:

1. **SP1 (this doc)** — Entity quick-view popover on entity list pages.
2. **SP2** — Map pin quick-view slide-overs for every pin type (reuses SP1's
   `EntityQuickView` body).
3. **SP3** — Entity list filters + alternate views (gallery / table).
4. **SP4** — Editable pin appearance (size / shape / icon / label).

Each sub-project gets its own spec → plan → implementation cycle. SP1's
deliberately container-agnostic `EntityQuickView` component is the shared core
SP2 depends on.

## Problem

The four entity list pages (characters, locations, items, factions) render as
plain divided rows with name-search and an archived toggle only. To see anything
beyond the name and a truncated description — properties, related entities, the
full description — the DM must navigate to the full detail page and back. That
round-trip is slow when scanning or comparing several entities.

## Goal

Let the DM peek at an entity's summary in-place, without leaving the list.
Clicking an entity row opens a compact **popover** anchored to that row showing a
summary; a dedicated navigation icon on the row remains the way to open the full
page.

## Decisions

- **Container:** a **popover** anchored to the clicked row (not a slide-out or
  modal). Compact, in-place, dismiss on click-away / Esc (Radix default).
- **Trigger inversion:** **clicking the row opens the popover** (the cheap,
  common action). A **dedicated nav icon** (`ArrowUpRight`) on the row is the
  link to the full detail page (the deliberate action). This inverts today's
  behavior, where the whole row is a `<Link>` to the detail page.
- **Scope:** all four entity types — `characters`, `locations`, `items`,
  `factions`. Locations/items/factions share `SimpleEntityManager`; the
  characters list is a separate bespoke page and gets the same treatment.
- **Content sections** (auto-hidden when the entity lacks the data):
  - Header — icon + name + type label (always shown).
  - Description — truncated to ~2–3 lines.
  - Key properties — first few `notionProps` (label/value) as chips.
  - Related entities — linked characters / factions / locations / items.
  - Footer actions — "Open full page →" + "Edit".
- **Edit action:** the popover's "Edit" calls back to open **each page's existing
  create/edit form dialog** — no new/inline edit path.
- **Data source:** the existing per-entity detail endpoint
  `/api/{resourcePath}/{id}`, fetched when the popover opens. No new API.

## Out of scope (YAGNI)

- **"On the map" section** (which map pins reference the entity) — considered and
  dropped for SP1: least useful while scanning a list, and adds a fetch.
- Any map work — that's SP2.
- Filters, sorting, or alternate list views — that's SP3.
- Inline editing inside the popover — reuse the existing dialogs instead.
- Prefetch-on-hover / caching — fetch on open is sufficient at this data scale.
- Multi-entity compare / pinning popovers open.

## Components & changes

### New: `components/ui/popover.tsx`

A thin wrapper around the already-installed `@radix-ui/react-popover`, modeled on
the existing direct usage in `components/tracker/ConditionPicker.tsx` (the only
current consumer of that package). Exports `Popover`, `PopoverTrigger`,
`PopoverContent` (+ anchor as needed), themed to match the app's other `ui/`
primitives. Reusable — SP3's filter controls will consume it too.

### New: `components/entities/EntityQuickView.tsx` — the shared core

**Container-agnostic**: renders body content only (no popover chrome), so SP2 can
drop the same body into the map pin slide-over.

- Props: `{ resourcePath: "characters" | "locations" | "items" | "factions";
  id: string; onEdit?: (entity) => void }`.
- On mount / when `id` changes, fetches `/api/{resourcePath}/{id}` (with a
  cancellation guard on the async effect — see the project's set-state-in-effect
  convention), renders loading and error states.
- Renders the decided sections; each section returns `null` when its data is
  empty so the body naturally adapts per entity type (a faction with no relations
  simply omits that row).
- Type icon + label resolved per `resourcePath` (and `type` subfield for
  characters pc/npc and locations).
- Footer: "Open full page →" (`Link` to `/{resourcePath}/{id}`) and, when
  `onEdit` is provided, an "Edit" button that calls `onEdit(entity)`.

### New: `components/entities/EntityQuickViewPopover.tsx`

Wraps `EntityQuickView` in the new `Popover`. Provides the trigger slot (the row
content) and anchors the content to it. Owns open/close state. Forwards
`resourcePath`, `id`, and `onEdit` through to `EntityQuickView`. The
"Open full page" nav icon lives on the row (outside the popover trigger) so it
navigates rather than opening the popover.

### Row changes — `components/entities/SimpleEntityManager.tsx`

- The row is currently a single stretched `<Link href="/{resourcePath}/{id}">`
  wrapping the colored dot + name + description, with a hover-reveal delete
  button. Restructure so:
  - The name/description/dot region becomes the **popover trigger** (click →
    peek).
  - A dedicated **`ArrowUpRight` nav icon** button is added as a `<Link>` to the
    detail page.
  - The existing hover-reveal **delete** button is preserved.
- Wire the popover's `onEdit` to the manager's existing edit-dialog state (the
  `SimpleEntityFormDialog` it already renders).

### Row changes — `app/characters/page.tsx`

The characters list is bespoke (inlines its own rows + a pc/npc `Badge`). Apply
the same restructure: row → popover trigger, add `ArrowUpRight` nav link, keep
delete, wire `onEdit` to its existing `CharacterFormDialog`.

## Data flow

```
Row click ──▶ EntityQuickViewPopover opens (anchored to row)
                    │
                    ▼
        EntityQuickView fetch /api/{resourcePath}/{id}
                    │  description, notionProps, related, ...
                    ▼
        render sections (empty sections omitted)
                    │
     ┌──────────────┼───────────────┐
     ▼              ▼                ▼
"Open full page"  "Edit"        (row) ArrowUpRight
 Link → detail   onEdit(entity)   Link → detail
                 → existing dialog
```

No schema, DB, or new API routes. Reuses the existing detail endpoints.

## Testing

- Component tests (Vitest) for `EntityQuickView`, mocking `fetch`:
  - Renders header/description/props/related when present.
  - **Omits** each section when its data is empty (per-type adaptation).
  - "Open full page" link points at `/{resourcePath}/{id}`.
  - "Edit" invokes `onEdit`; absent when `onEdit` not provided.
  - Loading and error states render.
- Browser verification via the dev server on each of the four list pages: click a
  row → popover opens with the right content; nav icon navigates to the full
  page; Edit opens the existing dialog; delete still works; click-away / Esc
  closes.

## Risks / notes

- **Behavior change:** row-click no longer navigates. Mitigated by the explicit
  `ArrowUpRight` affordance; call it out so it's discoverable (e.g. tooltip
  "Open page").
- **Related-entities cost:** the character detail page currently fan-out-fetches
  each related entity by id. For the popover, show what the detail endpoint
  already returns (names/links) rather than triggering deep fan-out fetches; if
  the endpoint doesn't return enough for a lightweight related list, prefer
  showing counts/names over adding fetches (revisit in the plan).
- **Reuse contract for SP2:** keep `EntityQuickView` free of popover/list
  assumptions so SP2 mounts it unchanged inside the map slide-over.
- **Touch:** click-to-open works on touch (unlike a hover trigger); the nav icon
  is a normal tap target.
