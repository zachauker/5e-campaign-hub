# Campaign Hub Shell + Entity Model — Design

## Context

The encounter tracker is a focused, at-the-table combat tool. Zach wants to grow it into a broader campaign management hub: a central place for campaign entities (characters, locations, items, factions), eventually joined by an interactive world map, a glossary/entity browser, and a cross-source search/agentic assistant (Notion, D&D Beyond, other lore sources).

That full vision is too large for one spec. It decomposes into four largely independent sub-projects:

1. **Hub shell + entity model** (this spec)
2. Glossary / entity browser
3. Universal search / agentic assistant
4. Interactive world map

The other three depend on decisions made here — how entities are modeled, how they relate to each other, and how the app is structured — so this sub-project goes first.

## Goals

- Turn `encounter-tracker` into the foundation of the campaign hub without splitting it into a new repo or a monorepo.
- Introduce a shared data model for campaign entities (characters, locations, items, factions) that the encounter tracker, and later the glossary/search/map sub-projects, all build on.
- Give the app real multi-section navigation while preserving the combat tracker's existing full-bleed, non-dashboard feel.
- Link encounter combatants to the new Character entities so PC/NPC data isn't duplicated between "combat" and "campaign" views.

## Non-Goals (deferred to later sub-projects)

- Interactive world map and character/movement tracking on it.
- Live search or sync against Notion, D&D Beyond, or other external sources. This spec adds static reference fields (a clickable URL/ID) but does not fetch or index external content.
- An agentic chat assistant.
- Multi-user support or authentication (app remains single-user, home-network only, matching current behavior).

## Architecture

Evolve the existing Next.js 16 App Router app in place:

- Same repo, same Drizzle + `better-sqlite3` stack, same Docker/Unraid deployment (`docker-compose.yml`, volume-mounted DB).
- No new services, no monorepo split — consistent with the existing preference for monolithic deployment.
- The combat tracker screens (`app/encounters/**`) become one section of the app rather than the entire app. A new top-level shell wraps all sections.

## Data Model

New Drizzle tables, all scoped by `campaign_id`:

- **`campaigns`** — top-level scoping record: `id`, `name`, `created_at`. Every other new table has a `campaign_id` FK. The app supports multiple campaigns from the start (a campaign switcher lives in the shell), even though Zach currently runs one.
- **`characters`** — unified PCs and NPCs. Fields: `id`, `campaign_id`, `name`, `type` (`pc` | `npc`), `ddb_character_id` (nullable, links to existing D&D Beyond integration), `notion_url` (nullable), plus freeform notes/description fields as needed.
- **`locations`** — `id`, `campaign_id`, `name`, `notion_url` (nullable), description.
- **`items`** — `id`, `campaign_id`, `name`, `notion_url` (nullable), description.
- **`factions`** — `id`, `campaign_id`, `name`, `notion_url` (nullable), description.
- **`encounters`** gains a `campaign_id` FK, since encounters are campaign-scoped data like everything else here.
- **Relationship junction tables** — structured (not free-text) links between entities:
  - `character_factions` (character ↔ faction, e.g. affiliation)
  - `character_locations` (character ↔ location, e.g. current location / origin)
  - `character_items` (character ↔ item, e.g. possession)
- **`encounters` combatants** — existing combatant records gain an optional `character_id` FK. A combatant can reference a real `characters` row instead of (or in addition to) its existing ad-hoc combat fields (HP, conditions, initiative stay combatant-specific and don't move to the Character record — those are per-encounter state, not campaign state).

External reference fields (`notion_url`, `ddb_character_id`) are stored and rendered as plain clickable links in this sub-project. No fetching, indexing, or live sync — that's the search sub-project's job.

### Data Migration

On first deploy of the new schema:

1. Create a single `campaigns` row representing Zach's current campaign.
2. Backfill every existing `encounters` row (and any existing PC data pulled from D&D Beyond) to reference that campaign.
3. No manual re-entry required; existing encounter history remains intact.

## Navigation & Shell

- A slim, dark top bar replaces the current implicit single-page structure. Section labels, not icon-only nav: **Encounters · Characters · Locations · Items · Factions**.
- Content renders full-bleed below the bar — the combat tracker keeps its current full-screen, chrome-free feel during active encounters.
- A `⌘K` command palette layers on top of the top bar: fuzzy-jump to any section or any entity by name (e.g. type "Vex" → jump straight to that character's page) without leaving the keyboard.
- This deliberately avoids the "sidebar nav / dashboard" pattern that `PRODUCT.md` calls out as an anti-reference for this app's brand.
- A campaign switcher lives in the top bar (exact visibility/placement is an open question below, since only one campaign exists today).

## Landing Page

Opening the app now lands on a campaign overview/dashboard rather than jumping straight into encounters:

- Active or most-recent encounter (if any), one click back into combat.
- Recently-touched characters.
- Quick links into each section (Characters, Locations, Items, Factions).

This becomes the hub's own front door, visually distinct from (but consistent in style with) the combat screens.

## Entity CRUD

Full create/edit/delete forms for Characters, Locations, Items, and Factions:

- Follows the app's existing atmospheric/tactile visual language (dark, high-contrast, Radix + Tailwind v4 component patterns already in `components/ui/`) — not generic admin-panel styling.
- Relationship fields (faction, location, item links) are managed from the entity's own edit form via searchable selects, not a separate junction-table UI.

## Encounter Integration

- When building/editing an encounter, a combatant can be linked to an existing `characters` record (PC or NPC) instead of manually re-entering their stats.
- Per-encounter state (current HP, active conditions, initiative roll) stays on the combatant row — only identity/reference data comes from the linked Character.
- Existing D&D Beyond Cobalt-token sync continues to populate PC data; that data now lands in the `characters` table instead of being encounter-scoped only.

## Open Questions for the Implementation Plan

- Exact searchable-select component for linking relationships (reuse an existing Radix pattern vs. new component).
- Whether the campaign switcher is visible by default (single campaign today) or hidden until a second campaign exists.
