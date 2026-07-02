# Glossary Detail Pages + Notion/D&D Beyond Feed — Design

## Context

The hub shell (previous sub-project) gave every campaign entity — characters, locations, items, factions — a shared data model, list views, and edit dialogs. What it deliberately deferred was sub-project 2 from the original brainstorm ("glossary/tabular view... link to more detailed views and show related materials across sources") and part of sub-project 3 (live Notion/D&D Beyond content, as opposed to the static clickable-link fields the hub shell already stores).

This spec merges those two: real detail pages for every entity, with Notion and D&D Beyond content fetched live into them. Cross-source *search* beyond the existing ⌘K palette, an agentic chat interface, and the interactive map all remain separate, not-yet-brainstormed sub-projects.

## Goals

- Give every entity (character, location, item, faction) a real detail page — a permalink, not just an edit dialog.
- Surface a linked Notion page's content on that detail page.
- Surface a linked D&D Beyond character's live stats on a Character's detail page.
- Make relationships genuinely cross-referential: a Faction's page shows which Characters belong to it, not just the reverse.

## Non-Goals

- Cross-source search beyond what ⌘K already does today.
- Any agentic chat / assistant interface.
- The interactive world map.
- Writing back to Notion (read-only).
- Caching or background sync of external content — content is fetched live on each page view.

## Routing & Navigation

New routes: `/characters/[id]`, `/locations/[id]`, `/items/[id]`, `/factions/[id]`.

- List pages (`app/characters/page.tsx`, `components/entities/SimpleEntityManager.tsx`) change their row `onClick` from opening the edit dialog to `router.push` to the new detail route.
- The existing edit dialogs (`CharacterFormDialog`, the dialog inside `SimpleEntityManager`) are unchanged in their own logic, but are now opened via an "Edit" button on the detail page rather than by clicking a list row.
- List pages keep their existing hover-delete for quick cleanup from the list; the detail page also gets a delete action for consistency, which navigates back to the list on success.
- `app/api/search/route.ts`'s generated hrefs change from `/characters?open=<id>` (dialog deep-link) to `/characters/<id>` (real page) for all four entity types, and likewise for `components/shell/CommandPalette.tsx`'s consumption of them. The `?open=` query-param deep-link mechanism (and its Suspense-boundary requirement) is removed from the list pages entirely, since navigation now goes straight to the detail page.

## Detail Page Layout

Tabbed, per entity type:

- **Characters**: Overview / Notion Notes / D&D Beyond
- **Locations, Items, Factions**: Overview / Notion Notes

**Overview tab:**
- Name, type badge (Characters only), description.
- **Related** — existing forward relationships (e.g. a Character's linked factions/locations/items) rendered as clickable cards that navigate to *their* detail pages.
- **Reverse relationships** for Locations/Items/Factions — which Characters are linked to *this* entity. This is new: today the `character_factions`/`character_locations`/`character_items` junction tables are only ever queried from the Character side (`GET /api/characters/[id]`). `GET /api/locations/[id]`, `/api/items/[id]`, `/api/factions/[id]` gain the mirrored reverse query, returning a `linkedCharacters: { id, name, type }[]` array (full summaries, not bare IDs) so the Overview tab can render the cards directly without a follow-up fetch per character.

**Notion Notes tab:**
- Empty state if the entity has no `notionUrl`.
- Otherwise, fetches and renders the linked page's content (see Notion Integration below).

**D&D Beyond tab (Characters only):**
- Empty state if the character has no `ddbCharacterId`.
- Otherwise, fetches the character live and renders it with the existing `StatBlock` component (`components/tracker/StatBlock.tsx`) — the same presentational component already used in combat, taking a `StatBlock`-shaped object as a prop with no coupling to the encounter store.

## Notion Integration

- **Client**: adds the official `@notionhq/client` SDK as a new dependency, used server-side only, inside API routes — never bundled to the browser. This is a deliberate deviation from the D&D Beyond client's zero-dependency, raw-`fetch` style: DDB's endpoint is a single unofficial JSON blob with no SDK to begin with, while Notion's block/pagination model (nested blocks, cursor pagination, ~30 block types) is complex enough that the official SDK's typing and pagination helpers pay for themselves.
- **Token storage**: a new `notion_token` entry in the existing `settings` table, added to `ALLOWED_KEYS` in `app/api/settings/route.ts`, masked in `GET /api/settings` the same way `ddb_cobalt_token` already is. Set from the Settings page UI, next to the existing D&D Beyond share-URL configuration.
- **Page ID resolution**: a small utility (`lib/notion/client.ts`) extracts the 32-character Notion page ID from the stored `notionUrl` (handles both dashed and dashless ID formats, and IDs embedded after a page-title slug).
- **Content fetching**: retrieves the page's block children (paginating via the SDK's cursor helpers) and renders them through a lightweight block-to-JSX renderer supporting: paragraphs, headings (1–3), bulleted/numbered list items, quotes, to-dos, callouts, dividers, and images. Any other block type renders as a "View in Notion ↗" link to that specific block/page rather than attempting full fidelity — this app is a reference view of your notes, not a Notion clone.
- **Error handling**: three distinct, non-crashing states in the Notion Notes tab — no token configured ("Add a Notion integration token in Settings to see notes here"), page not shared with the integration or not found ("This page hasn't been shared with the integration, or doesn't exist"), and a generic fetch failure. Each replaces the tab content, not the whole page.

## D&D Beyond Integration

No new client code. Reuses `fetchPublicCharacter` from `lib/ddb/client.ts` (already used by `AddCombatantDialog`'s "D&D Beyond" tab) and the same DDB-character-to-`StatBlock` mapping logic already implemented there, now also called from the Character detail page.

## Data Model / API Changes

- `GET /api/locations/[id]`, `/api/items/[id]`, `/api/factions/[id]` gain a reverse-relationship query against `character_locations`/`character_items`/`character_factions` respectively, mirroring the pattern already used by `GET /api/characters/[id]`.
- `notion_token` added to `app/api/settings/route.ts`'s `ALLOWED_KEYS`.
- No schema or migration changes — `notionUrl` and `ddbCharacterId` already exist on the relevant tables from the hub shell.

## Open Questions for the Implementation Plan

- Exact Notion block-renderer component structure (one component with a switch, vs. a component-per-block-type map) — an implementation detail, not a design decision.
