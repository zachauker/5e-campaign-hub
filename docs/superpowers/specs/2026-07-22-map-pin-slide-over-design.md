# Map Pin Quick-View Slide-Over — Design

**Date:** 2026-07-22
**Status:** Approved (design), pending spec review

## Context — part of a larger UI/UX effort

This is **sub-project 2 (SP2) of 4** UI/UX enhancements (see
`2026-07-21-entity-quick-view-design.md` for the full sequencing):

1. **SP1 (done, merged)** — Entity quick-view popover on entity list pages.
   Produced the container-agnostic `EntityQuickView`.
2. **SP2 (this doc)** — Map pin quick-view slide-overs for every pin type,
   reusing SP1's entity summary.
3. **SP3** — Entity list filters + alternate views.
4. **SP4** — Editable pin appearance.

## Problem

On maps, only **event** (session-note) pins get a rich slide-over
(`EventNotePanel` — full-height left panel with the Notion body). Every other
pin type (`location`, `character`, `faction`, `submap`, `note`) gets only the
compact `MarkerInfoPanel` card — icon + title + type + a single "View {entity} →"
link, no description, properties, or related entities. And the **world map**
viewer has no rich panel at all: it only ever renders `MarkerInfoPanel` and has
no event branch, so session-note pins on the world map show nothing rich.

The DM wants every pin type to open a slide-over quick view like the session
notes have — e.g. a location pin should show its description and related
entities inline, without leaving the map.

## Goal

Promote **every** pin type to a single, consistent left-docked slide-over
(matching the existing `EventNotePanel` chrome), with per-type body content,
across both the local/city map viewer and the world map viewer. Reuse SP1's
`EntityQuickView` content for entity-backed pins.

## Decisions

- **One shell for all types.** A new `MarkerSlideOver` component provides the
  panel chrome (`EventNotePanel`'s `absolute top-4 left-4 bottom-4 w-96
  max-w-[calc(100%-2rem)]` full-height left dock, `panel-in` animation), the
  marker header, and the footer. It switches the body on `marker.type`. The
  compact `MarkerInfoPanel` is **retired**; `EventNotePanel` is folded into the
  shell as one body variant.
- **Header** uses the marker's visual (`markerVisual(marker)` → icon + color +
  type label) and `marker.resolvedTitle`, identical to the two current panels —
  the map's own language, not the entity's.
- **Body per type:**
  - `location` / `character` / `faction` → SP1's entity summary sections
    (description, key Notion props, related entities), fetched from
    `/api/{resourcePath}/{id}` via the `marker.type → resourcePath` mapping.
  - `note` → the freeform `marker.note` text.
  - `submap` → the target map name (`resolvedTitle`) + an "Open sub-map →"
    action.
  - `event` → the existing Notion-body fetch/render, extracted from
    `EventNotePanel` into an `EventNoteBody`.
- **Footer — single row (chosen "Option A"):**
  - entity pin: `Open page →` · `Edit pin` · `Delete pin`
  - `note`: `Edit pin` · `Delete pin`
  - `submap`: `Open sub-map →` · `Edit pin` · `Delete pin`
  - `event`: `Open page →` · Notion ↗ · `Edit pin` · `Delete pin`
  - "Delete" removes the **pin** (existing `DELETE /api/maps/markers/{id}`
    behavior), never the underlying entity. There is **no** "Edit entity" action
    in the map context — entity editing happens on the full page reached via
    "Open page".
- **Sub-map pins open the slide-over** (with "Open sub-map →") rather than
  navigating immediately on click — consistent with every other pin. This
  changes today's one-click-navigates behavior for sub-map pins.
- **World map parity.** `WorldMapViewer` uses the same `MarkerSlideOver`,
  gaining rich panels and event-pin support for the first time.

## Reuse & refactor of SP1's `EntityQuickView`

`EntityQuickView` currently renders header + body + footer as one unit (used by
the entity-page popover). SP2 needs the **body only** (description / props /
related) inside the marker shell, which supplies its own header and footer.

- Extract the section-rendering into a reusable body so both consumers share it:
  the entity-page popover (SP1) keeps its header + footer; the map shell uses the
  body with its own chrome. The exact split (a `showChrome`-style prop vs. a
  separate exported sections component) is an implementation detail for the plan;
  the constraint is **the SP1 entity-page popover must keep working unchanged**
  and the shared piece must stay free of map/popover coupling.
- The fetch + loading/error handling continues to live with the body (it already
  uses the cancellation-guarded pattern — see `[[feedback-set-state-in-effect]]`).

## Components & changes

### New: `components/maps/MarkerSlideOver.tsx`
The shell. Props mirror what the current panels receive:
`{ marker: ResolvedMarker; onClose: () => void; onEditPin: () => void;
onDeletePin: () => void }`. Renders the marker header (via `markerVisual`), a
scrollable body chosen by `marker.type`, and the per-type footer. Owns no data
fetching itself — each body variant fetches what it needs.

### New: `components/maps/marker-slideover-target.ts` (pure, tested)
A tiny pure helper `entityTargetOf(marker)` returning
`{ resourcePath: "characters" | "locations" | "factions"; id: string } | null`
for entity-backed pins (null for `note`/`submap`/`event`). Unit-tested. Keeps the
type→resourcePath mapping out of the component and independently verifiable.

### New: `components/maps/EventNoteBody.tsx`
The event body, extracted from `EventNotePanel`: fetches `/api/sessions/{id}` +
the Notion page, renders linked-location chips + `NotionBlocks` + loading/error
states. Consumed by `MarkerSlideOver` for `event` pins.

### Refactor: `components/entities/EntityQuickView.tsx` (SP1)
Split so the body sections are reusable by `MarkerSlideOver` without the
page-oriented header/footer, per "Reuse & refactor" above. No behavior change for
the entity-page popover.

### Wiring: `components/maps/MapViewer.tsx`
Replace the two panel branches (`EventNotePanel` for `event`, `MarkerInfoPanel`
otherwise) with a single `<MarkerSlideOver marker={selectedMarker} onClose=…
onEditPin=… onDeletePin=… />`. `onEditPin` = the existing `setEditingMarker(...)
+ setSelectedId(null)`; `onDeletePin` = the existing delete-marker handler
(`DELETE /api/maps/markers/{id}` + reload + tray bump).

### Wiring: `components/maps/WorldMapViewer.tsx`
Replace the single `MarkerInfoPanel` with `<MarkerSlideOver>`, wired to its
existing `setEditing`/delete handlers.

### Remove: `components/maps/MarkerInfoPanel.tsx`
Retired once both viewers use `MarkerSlideOver`. `EventNotePanel.tsx` is removed
too, its logic living on in `EventNoteBody`.

## Data flow

```
pin click → viewer sets selectedId → selectedMarker (ResolvedMarker)
        │
        ▼
  <MarkerSlideOver marker onClose onEditPin onDeletePin>
        header = markerVisual(marker) + resolvedTitle
        body by marker.type:
          entity (via entityTargetOf) → fetch /api/{resourcePath}/{id} → summary sections
          note   → marker.note
          submap → resolvedTitle + Open sub-map → (/maps/{targetMapId})
          event  → EventNoteBody: /api/sessions/{id} + /api/notion/page
        footer by type (Option A)
```

No schema, DB, or marker-API changes. Reuses existing detail/session/notion
endpoints and the existing marker edit/delete flows.

## Out of scope (YAGNI)

- Sub-map thumbnail previews (name + link only).
- Pin appearance editing (SP4).
- Any change to placing / moving / the unpinned-notes tray / layer & date
  filters.
- Mobile-specific panel repositioning (keeps the current left-dock; it already
  uses `max-w-[calc(100%-2rem)]`).

## Testing

- Unit test `marker-slideover-target.ts`: entity types → correct
  `{resourcePath,id}`; `note`/`submap`/`event` → null; missing `entityId` → null.
- Browser verification (dev server), on a **local/city map** and the **world
  map**: each pin type opens the slide-over with the right body and footer;
  entity pins show description/props/related; "Open page"/"Open sub-map" navigate;
  "Edit pin" opens the marker form; "Delete pin" removes the pin and closes;
  event pins render the Notion body; world-map event pins now work; no console
  errors.

## Risks / notes

- **Behavior change:** sub-map pins no longer navigate on a single click (they
  open the slide-over first). Intentional, per the consistency decision; the
  "Open sub-map →" action is the new navigation path. Sub-map pins that currently
  `router.push` on select must be re-routed to open the panel instead.
- **Two viewers, one component:** `MarkerSlideOver` must not assume local-map
  specifics (e.g. the unpinned-notes tray is MapViewer-only); it only needs
  `marker` + the three callbacks, so it stays viewer-agnostic like the panels it
  replaces.
- **SP1 coupling:** the `EntityQuickView` refactor touches merged SP1 code —
  keep the entity-page popover's behavior identical and re-verify it.
- World map markers store lng/lat rather than fractional x/y, but the slide-over
  never touches coordinates, so this is irrelevant to SP2.
