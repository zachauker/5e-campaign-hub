# Notion Database Sync — Design

**Date:** 2026-07-10
**Status:** Approved, ready for planning
**Sub-project:** Campaign hub expansion — Notion integration, phase 1 (database sync)

## Problem

Notion is the DM's canonical note repository. The Explorers of Exandria workspace is
richly structured: under the campaign page live real databases — **Characters**,
**Locations**, **Items & Loot**, **Factions & Organizations** — each with a proper
property schema (selects, multi-selects, relations, urls), plus page bodies (stat
blocks, toggles, callouts).

The hub already has matching `characters` / `locations` / `items` / `factions` tables
with the same relationships, but today the integration is:

- **Manual to connect** — you hand-recreate each entity in the hub and paste one Notion
  page URL per entity. The hub has no knowledge of the Notion databases.
- **Lossy** — the only thing pulled is page *blocks*, via a renderer that supports ~10
  flat block types and never recurses, so tables (stat blocks) and toggles (primer
  sections) collapse to "View in Notion ↗".

This is duplicate data entry plus inconsistent transfer. This phase eliminates the
manual connection by **syncing entities from the Notion databases**. (Block-rendering
fidelity is a separate, deliberately-deferred follow-up.)

## Goal

A **one-way Notion → hub sync** for **Characters, Items, and Factions** that:

- Queries the configured Notion databases and snapshots their structured properties into
  the hub's own tables (fast, offline-capable at the table).
- Auto-creates, updates, and adopts entities so there's no manual re-entry.
- Populates character↔faction and character↔item relationships.
- Leaves page *body* content live-fetched on the detail page exactly as today (hybrid).

### Decisions locked during brainstorming

| Decision | Choice |
|---|---|
| Direction | One-way Notion → hub (Notion is source of truth) |
| Scope (v1) | Characters, Items, Factions. **Locations deferred** (world-map reconciliation) |
| Freshness | **Hybrid** — structured props snapshotted locally; page body stays live-fetched |
| Trigger | **Manual "Sync now"** button. Scheduled sync deferred |
| Reconcile | **Additive + Active-gated** — create/update/adopt, never hard-delete; `Active=false` or removed → archived |
| Connection config | **Explicit per-database URLs, stored per campaign** (not auto-discovery) |
| Extra properties | Generic **`notionProps` JSON snapshot** per entity → rendered as a meta-table (not typed columns) |

## Architecture

### Data flow

```
[Settings › Notion Sync panel]  paste 3 database URLs  ──►  notion_sources table (per campaign)
                                                                 │
[ "Sync now" ] ──► POST /api/notion/sync ──► lib/notion/sync.ts  │
                                                                 ▼
   for each configured source (order: Factions → Characters → Items):
     queryDataSource(rows)  ──►  map row → entity fields  ──►  reconcile against DB
                                                                 │
     (additive + Active-gated, Notion wins on synced columns)   ▼
   result summary { created, adopted, updated, archived, unchanged, errors[] }  ──► toast
```

The detail page is unchanged in *how* it renders — it gains real synced data plus a
"Notion properties" meta-table, and its Notion-body tab still calls the existing
`/api/notion/page`.

### Modules

- **`lib/notion/client.ts`** (extend) — add `queryDataSource(databaseUrlOrId, token)`
  using the v5 data-source query API (`notion.dataSources.query`), paginating on
  `has_more`. Keep the existing block fetcher untouched.
- **`lib/notion/sync.ts`** (new) — the engine. Focused, testable units:
  - `mapFactionRow` / `mapCharacterRow` / `mapItemRow` — pure Notion-row → hub-fields.
  - helpers: `extractNotionPageId` (exists), `extractDdbId`, property readers tolerant of
    missing/renamed properties.
  - `reconcileEntity` — match/adopt/create/update/archive against a repo interface.
  - `syncCampaign(campaignId)` — orchestrates the three sources in dependency order,
    returns the summary.
- **`app/api/notion/sync/route.ts`** (new) — `POST { campaignId, entityType? }`.
- **`app/api/notion/sources/route.ts`** (new) — `GET/PUT ?campaignId=` for the DB URLs.

### Schema changes

Applied via the existing `addColumnIfMissing` + `migrate.ts` pattern (matches how
`locations.type` etc. were added).

**New table `notion_sources`:**

| column | type | notes |
|---|---|---|
| campaignId | text FK → campaigns | |
| entityType | text | `'characters' \| 'items' \| 'factions'` |
| databaseUrl | text | the URL the user pasted |
| dataSourceId | text | resolved `collection://` / data-source id |
| lastSyncedAt | timestamp | nullable |
| lastStatus | text | nullable — serialized `{ ok, counts, error }` |

PK `(campaignId, entityType)`.

**New columns on `characters`, `items`, `factions`:**

| column | type | purpose |
|---|---|---|
| `notionPageId` | text | dashless page id — durable match key (survives renames; `notionUrl` alone can change) |
| `notionProps` | text (JSON) | extra-properties snapshot for the meta-table |
| `archived` | boolean, default false | Active-gating; archived hides from lists, keeps markers/links |
| `notionSyncedAt` | timestamp | per-entity freshness |

`notionUrl` already exists on all three and continues to drive the live body fetch + link.

## Property mapping

Sync order is **Factions → Characters → Items** so link targets exist before linkers run.

### Characters (`collection://82f89c80-3900-4681-bbcf-4de4f9331aba`)

| Notion property | → Hub destination |
|---|---|
| Name (title) | `characters.name` |
| Type (Player/NPC) | `characters.type` → `pc` / `npc` |
| Character Sheet (url) | `characters.ddbCharacterId` (extract D&D Beyond id; non-DDB urls → `notionProps`) |
| Affiliations (multi-select) | `character_factions` links, matched to synced factions by name (case-insensitive) |
| Active (checkbox) | `characters.archived` = `!Active` |
| Race, Class, Character Level, Disposition Toward Party, Role/Title | `characters.notionProps` |
| _(identity)_ | `notionPageId`, `notionUrl` |

`characters.description` stays **hub-authored** — sync never writes it (no matching
Notion property; avoid clobbering prose).

### Items (`collection://5dae0edc-69b6-499e-97f9-a7ce3da304e5`)

| Notion property | → Hub destination |
|---|---|
| Name | `items.name` |
| Description (text) | `items.description` — **synced, Notion wins** |
| Held By (relation→Characters) | `character_items` links (resolve related page ids → hub characters by `notionPageId`) |
| Type, Rarity | `items.notionProps` |
| _(identity)_ | `notionPageId`, `notionUrl` |

Items have no `Active` property → `archived` stays false unless the row is deleted in
Notion (removal logic).

### Factions (`collection://9380408e-eb15-46c3-8a5c-4b3eef73da60`)

| Notion property | → Hub destination |
|---|---|
| Name | `factions.name` |
| Active (checkbox) | `factions.archived` = `!Active` |
| Type, Alignment Toward Party | `factions.notionProps` |
| _(identity)_ | `notionPageId`, `notionUrl` |

`factions.description` stays hub-authored (no matching property).

### Deferred relations (all target the Locations DB, out of scope)

`Character.Location`, `Item.Found In`, `Faction.Headquarters`, and
`Faction.Key Members` (redundant with `Affiliations` — character↔faction links come
purely from the character side to keep one code path). These light up when Locations
sync lands.

## Sync engine behavior

- **Matching / adoption (per entity):**
  1. match by stored `notionPageId` → **update**;
  2. else case-insensitive name-match within the same campaign+type where
     `notionPageId` is null → **adopt** (stamp it with the page id);
  3. else **create**.
- **Notion wins on synced columns only.** Update overwrites mapped columns; hub-only data
  (character/faction `description`, map markers, hand-added relations) is untouched.
- **Relationship links are additive** — sync *adds* the faction/item links it finds but
  never removes existing links. A dropped affiliation lingers until cleared by hand.
- **Active-gating & removals:** `Active=false` → `archived=true`; a row that vanishes from
  the Notion result set (deleted) → its hub entity is `archived=true`, **never
  hard-deleted**; a re-activated / re-appearing row flips `archived` back to false.
- **Idempotent:** re-running with no Notion changes = 0 writes; `updatedAt` bumps only on
  a real field change; `notionSyncedAt` stamps every run.
- **Result summary** per type: `{ created, adopted, updated, archived, unchanged, errors[] }`.

## UI

### Configuration & trigger

- Global **Notion token** stays in Settings (unchanged).
- New **"Notion Sync"** panel in Settings, scoped to the **active campaign**: three URL
  fields (Characters, Items & Loot, Factions & Organizations), each showing last-synced
  time + last result, persisted to `notion_sources`.
- **"Sync now"** button in that panel and mirrored on glossary list headers →
  `POST /api/notion/sync` → spinner → toast summary + inline per-source errors.
- v1 trigger is **manual only**.

### Detail-page display

- Character / Item / Faction detail pages gain a **"Notion properties"** meta-table
  rendering `notionProps`, styled to the field-journal aesthetic. Live Notion-body tab
  unchanged.
- List pages **hide archived** by default with a small **"Show archived (N)"** toggle.

## Error handling & edge cases

- **No token** → "Add a Notion token in Settings." **Integration not shared** on a DB →
  the existing friendly "share it with the integration" message, per source.
- **Bad/blank source URL** → that source errors; others still sync (per-source isolation,
  best-effort).
- **Pagination & rate limits** → query pages 100 rows at a time on `has_more`; 429s get a
  short backoff.
- **Ambiguous name adoption** (two hub entities share a name) → adopt the first, surface a
  warning in the summary rather than guessing silently.
- **Non-DDB Character Sheet url** → skip ddb extraction, keep raw url in `notionProps`.
- **Renamed/missing Notion property** → read by known name, tolerate absence, skip that
  mapping (no crash).

## Testing

- **TDD on pure mappers** (`mapFactionRow` / `mapCharacterRow` / `mapItemRow`) and helpers
  (`extractDdbId`, `extractNotionPageId`) with fixture rows → expected field objects.
- **Reconcile-logic tests** against a fake repo: create → adopt → update →
  archive-on-removal → unchanged (idempotent second run = 0 writes) → additive links.
- **Integration test:** run `syncCampaign` against a temp SQLite with a mocked Notion
  client returning fixtures; assert counts, idempotency, adoption, archival.
- **Browser verification:** configure the three sources, Sync now, confirm summary counts,
  a character's faction links + meta-table, and archived hiding.

## Guardrails (per AGENTS.md)

- Verify the **v5 `dataSources` query API** against the installed `@notionhq/client`
  (5.22.0) before writing the query layer — the modern API queries data sources, not
  databases directly.
- Follow this repo's **Next 16** route-handler conventions (read the relevant guide in
  `node_modules/next/dist/docs/`).

## Out of scope for v1

Locations sync + world-map reconciliation · block-rendering fidelity
(tables/toggles/nesting — a natural next sub-project) · write-back to Notion · scheduled
sync · the Session Timeline / Plot Threads databases.
