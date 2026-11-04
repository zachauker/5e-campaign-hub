# Obsidian Vault Migration — Design Spec

**Date:** 2026-10-23
**Status:** Approved for planning
**Sub-project:** #20 of the campaign hub expansion

## Summary

The DM's campaign notes have moved from Notion to an Obsidian vault. All content
is already migrated; the Claude skills that maintain it already target the new
paradigm. This sub-project moves the hub's ingestion layer to match, and deletes
Notion from the codebase entirely.

The hub keeps its current shape: a **full mirror** of the notes plus the at-table
instrument built on top. Every screen behaves as it does today. What changes is
the source — a read-only directory of markdown files instead of an HTTP API.

The architectural bet is that `lib/notion/sync.ts` was already source-agnostic in
its back half. Steps 3-6 of its pipeline — reconcile, link relations, archive
unseen, push to the search index — never knew they were talking to Notion. Only
the front half (query, map) is Notion-shaped. So this is a front-half
replacement, not a rewrite.

Two of the Notion era's compromises die with it. Briefings can finally tell when
a note changed, and the DM's own prose becomes searchable in run mode. Both were
blocked purely by the cost of an API round-trip, and a local file read costs
nothing.

## Goals

- Mirror the vault into the hub with no loss of capability relative to Notion,
  and no loss of data in the live database on first sync.
- Survive a note being renamed or moved in Obsidian without orphaning the hub
  rows that point at it.
- Render the DM's actual authoring style — a 30-type callout taxonomy, wikilinks,
  embeds, tables — rather than degrading it to plain text.
- Remove `@notionhq/client` and every Notion code path. The branch is not done
  while both sources exist.
- Make briefing staleness notice note edits, and make note prose searchable.

## Non-goals

- **Writing to the vault.** The mount is read-only. The hub never authors a
  note, and never writes an id into one. Anything the vault needs (`hub_id` on
  new notes) comes from Templater.
- **Resolving the Plot Threads collision.** The vault has `type: thread` and the
  hub has a `threads` table populated by session review. Both keep their own
  copy for now. See Parked.
- **Extracting callout semantics into briefing fields.** The taxonomy makes this
  possible and it is the obvious next move, but it changes what a briefing
  *means*, which is a different project from changing where it comes from. The
  parser emits the callout type so this stays cheap later.
- **Player-facing surfaces.** `type: player-note` is recognised and skipped.
  That is its own sub-project.
- **Mirroring new vault concepts the hub has no table for.** No new entity types
  beyond re-keying what `session_notes` already held.

## Context: what this replaces

`lib/notion/` is 1,896 lines across 20 files (925 of them tests). Its pipeline, per entity type:

1. Resolve a configured database URL to a Notion data-source id.
2. Query the data source, paging, into `NotionRow[]`.
3. Map each row to a `MappedEntity` via a per-type mapper.
4. `reconcileEntity` against a repo keyed on `notion_page_id` — create, adopt,
   update or no-op.
5. Link relations additively.
6. Archive rows that have a page id but weren't seen this pass.
7. Push to the run-mode search index.

Steps 4-7 port with only the key column renamed. Steps 1-3 are replaced.

Page bodies were never stored — they were fetched on demand through
`/api/notion/page` and rendered by `NotionBlocks.tsx`. Two consumers also fetched
bodies server-side: the briefing builder, and the chronicle's session review.

## Decisions taken during design

| Decision | Choice | Why |
|---|---|---|
| Hub's role | Full mirror, vault as source | Keeps every screen; a source swap, not an amputation |
| Transport | Read-only bind mount | Reuses the existing scheduler; free change detection; images off disk |
| Identity | `hub_id` -> `notion_id` -> basename | Only option that can't silently destroy a map pin |
| Note bodies | Store hash + text, render from file | Correct staleness, searchable prose, no sync lag during prep |
| Scope | Five hub tables, nine vault types | Anything less archives rows that exist today |

## Transport and configuration

The vault is mounted read-only into the container:

```yaml
volumes:
  - /mnt/user/<path-to-vault>:/vault:ro
```

- **`VAULT_PATH`** (env) — absolute path in the container to the *Obsidian vault
  root*, not the campaign folder. Defaults to `/vault`.
- **`vault_sources`** (table, replaces `notion_sources`) — one row per campaign:
  `campaign_id` PK, `root_path`, `last_synced_at`, `last_status`. `root_path` is
  **vault-relative** (e.g. `D&D/Explorers of Exandria`), never absolute, so the
  same database file works on the DM's Mac and in the container.
- **`vault_name`** (setting) — the Obsidian vault name, used only to build
  `obsidian://` URIs. For this vault, `Willowbrook-Remote`.

Collapsing five database URLs into one campaign folder is a simplification, and
it means the vault's second campaign folder (`Planescape`) can become a second
hub campaign with no new code.

The existing auto-sync scheduler is reused as-is: a 15-minute tick, interval
re-read from settings each pass, per-campaign locking, first tick 30s after boot.
Only the settings key names and the work done per tick change.

## Identity

Each note's `source_key` resolves in order:

1. `hub_id:` in frontmatter — emitted by Templater on new notes.
2. `notion_id:` in frontmatter — present on 153 of the 155 notes the scan sees,
   and equal to the `notion_page_id` already in the live database.
3. The note's basename — best-effort fallback.

Tier 2 is what makes the cutover invisible: the backfill
`UPDATE <table> SET source_key = notion_page_id WHERE source_key IS NULL AND
notion_page_id IS NOT NULL` adopts every existing row before the first scan runs.

**Key promotion.** A note keyed on its basename that later gains a `hub_id` would
otherwise read as a delete plus a create. So `reconcileEntity` looks up by the
resolved key first, and on a miss tries the note's *lower-tier* candidate keys
against `source_key`; a hit adopts the row and rewrites `source_key` to the
higher tier. This generalises the `findByNameUnlinked` adoption already in
`repos.ts`.

**Duplicate keys.** Two notes resolving to the same key warn once and resolve
deterministically by sorted vault path, so the winner cannot flap between ticks.

**Vault-side prerequisite.** The six templates in `_Templates/` emit no id field.
Each gains a Templater-generated `hub_id`. `Item` and `Faction` templates do not
exist and should be authored. Notes created before this lands and after the
Notion migration have neither id and fall to basename until edited.

**Pre-flight: two notes have no id, and both are mirrored types.**

| Note | Type | Risk |
|---|---|---|
| `Arcs/Dangerous Designs Pt 1.md` | `arc` | Falls to basename. Adopts its hub row only if the row's name matches exactly. |
| `Characters/PCs/Shale Telenna (Hill).md` | `pc` | Falls to basename — **and the basename carries a parenthetical player name**, so it almost certainly will not match the existing hub row. |

The second is the real hazard: a basename mismatch means the existing row
archives and a new one is created, taking that PC's map pins and briefing with
it. Both notes should get a `notion_id` (copied from the hub row) or a `hub_id`
before the first sync, or be renamed to match. This is a one-time vault edit, not
code, and it belongs in the implementation plan as a pre-flight step with a
verification query.

Note also that the hub entity's name comes from the **basename**, since vault
notes carry no `name:` frontmatter — the filename is the title, as it is in
Obsidian. `aliases:` feeds link resolution, not the display name.

## Data model

Additive only. The house convention in `lib/db/migrate.ts` is
`addColumnIfMissing` — there is an existing comment explaining that a dead
`maps` column was left in place "because SQLite DROP COLUMN support is
version-dependent." The `notion_*` columns get the same treatment: left in place,
unread, never migrated.

On each of `characters`, `locations`, `items`, `factions`, `session_notes`:

| Column | Type | Purpose |
|---|---|---|
| `source_key` | TEXT | Stable identity (see above) |
| `source_path` | TEXT | Vault-relative path to the `.md`, for reads and `obsidian://` |
| `source_props` | TEXT | JSON `{label, value}[]`, replaces `notion_props` |
| `source_synced_at` | INTEGER | Last successful scan touch |
| `source_hash` | TEXT | Content hash of the body, for staleness |
| `source_text` | TEXT | Body stripped to plain text, for search; `[!dm]` removed |

On `locations` additionally:

| Column | Type | Purpose |
|---|---|---|
| `parent_location_id` | TEXT | Resolved from `parent:`; no FK, ids may dangle |

`parent` is worth a real column: 34 notes use it, it gives locations the
hierarchy the hub currently lacks, and it is what answers the `#Places within`
base embed.

## Module layout

`lib/notion/` becomes `lib/vault/`:

| File | Role |
|---|---|
| `config.ts` | Resolve campaign -> absolute folder from `VAULT_PATH` + `root_path` |
| `scan.ts` | Walk the folder, return `VaultNote[]` (path, basename, frontmatter, body) |
| `frontmatter.ts` | Split the `---` block, YAML parse |
| `links.ts` | Parse and resolve `[[Name]]`, `[[Name\|label]]`, `[[Name#heading]]` |
| `body.ts` | Read, hash, strip to plain text |
| `map.ts` | `VaultNote` -> `MappedEntity`, per type |
| `markdown.ts` | mdast -> the hub's block model |
| `reconcile.ts` `repos.ts` `sync.ts` `run-sync.ts` `scheduler.ts` | Ported, re-keyed |

One new runtime dependency: `gray-matter` for frontmatter, `remark` +
`remark-gfm` for markdown. Both are used server-side only.

## Type routing

Routing is driven by `type:` frontmatter, **not** folder path, so reorganising
folders in Obsidian costs nothing.

| Vault `type:` | Count | Hub table | Notes |
|---|---|---|---|
| `npc` | 34 | `characters` | sets `type = 'npc'` |
| `pc` | 8 | `characters` | sets `type = 'pc'` |
| `location` | 33 | `locations` | |
| `item` | 5 | `items` | |
| `faction` | 8 | `factions` | |
| `session` | 30 | `session_notes` | `note_type = 'Session Notes'` |
| `arc` | 3 | `session_notes` | `note_type = 'Story Outline'` |
| `encounter` | 6 | `session_notes` | `note_type` from `encounter_type` |
| `scene` | 5 | `session_notes` | `note_type = 'Character Event'` |
| `thread` | 15 | — | recognised, skipped (Parked) |
| `player-note` | 5 | — | recognised, skipped (own sub-project) |
| `reference`, `campaign` | 3 | — | recognised, skipped |

Counts are the 155 notes the scan actually sees. **The scan excludes
`_Templates/` and any dot-directory** — the latter matters because `D&D/` holds
`.backup-*`, `.migration` and `.notion-import` folders full of pre-migration
copies. They sit outside the campaign `root_path`, but the exclusion is explicit
so a future `root_path` can't accidentally ingest a backup.

Recognised-but-skipped types are skipped **silently**. Warning on them would
produce ~40 warnings every tick. An unknown or absent `type:` warns, mirroring
today's no-name warning.

### Why `session_notes` takes four types

`session_notes` never mirrored only sessions — it mirrored Notion's Session
Timeline database, whose `Type` select `marker-meta.ts` still enumerates:
`Session Notes`, `Story Outline`, `Combat Encounter`, `RP Encounter`,
`Character Event`. The migration split that one database into four vault folders.
Those notes carry exactly the fields `mapSessionNoteRow` reads — `status`,
`date`, `arc`, `locations`, `settings`, `session` — and `_Bases/Side Content.base`
treats encounters and scenes as one collection.

Ingesting only `type: session` would archive every Encounter, Scene and Story
Outline row in the live database, dangle any event pin aimed at one, and kill
four of five marker icons. That is a regression, not a deferral.

`encounter_type` maps to the old labels: `combat` -> `Combat Encounter`,
`social` -> `RP Encounter`. The vault's `exploration` has no Notion equivalent
and gets a sixth entry in `EVENT_TYPE_META` rather than falling back to the
generic event visual.

`encounter_type` is **orthogonal to `type:`** — 4 of the 5 scenes carry one too.
The two axes mean different things: `type:` says whether a note is a prepped
set-piece (`encounter`) or a PC spotlight moment (`scene`), while
`encounter_type` says what category of play it is. So `type: scene` maps to
`Character Event` regardless of its `encounter_type`, because the spotlight axis
is what the old Notion label captured. `encounter_type` is displayed as
**Category** on both.

## Frontmatter to properties

`source_props` is a curated per-type allowlist, mirroring today's curation rather
than dumping all frontmatter. Always suppressed: `type`, `tags`, `cssclasses`,
`hub_id`, `notion_id`, `aliases` (used for link resolution, not displayed).

| Table | Displayed properties | Written to columns |
|---|---|---|
| `characters` | Race, Class (joined), Level, Disposition, Role, Sheet (only if no D&D Beyond id extracted) | `type`, `ddb_character_id` from `sheet` |
| `locations` | Type (`location_type`), Status, Region, Parent | `description` (only when non-empty), `parent_location_id` |
| `items` | Type (`item_type`), Rarity | `description` (only when non-empty) |
| `factions` | Type (`faction_type`), Alignment (`stance`), Headquarters | — |
| `session_notes` | Session, Date, Status, Arc, Category (`encounter_type`) | `note_type`, `status`, `date`, `arc` |

Two existing behaviours are preserved deliberately:

- **`archived` comes from `active: false` on characters and factions only.**
  Locations, items and session notes archive by disappearing from the vault,
  exactly as under Notion.
- **The hub's `locations.type` enum stays world-authoritative.** The vault's
  `location_type` values (e.g. `Underground`) do not match the enum and are
  rendered as a property only, honouring the existing comment in `map.ts`.
- **`description` is written only when non-empty**, so a blank frontmatter field
  never overwrites world-composed text. Same guard as today's location mapper.

`arc:` is a wikilink in the vault (`"[[Caught in the Web — ...]]"`) but a plain
string column in the hub; the link target's display name is stored.

## Relations

All relation linking stays additive — links are added, never removed — matching
today's `repos.ts`.

| Vault frontmatter | Hub table |
|---|---|
| character `factions:` | `character_factions` |
| character `location:` | `character_locations` |
| item `held_by:` | `character_items` |
| session/encounter/scene `locations:` | `session_note_locations` |
| location `parent:` | `locations.parent_location_id` |
| faction `headquarters:` | none — displayed as a property |
| scene `featuring:` | none — displayed as a property |

`featuring:` holds PC wikilinks on scenes. There is no `session_note_characters`
table and this sub-project does not add one, which is also why the
`#Scenes featuring` embed renders nothing.

Note the direction change on `character_locations`. Notion fed it from the
location side via a `Notable NPCs` relation; the vault has NPCs declaring their
own `location:`. One authoritative direction replaces a relation that had to be
maintained at both ends.

Session notes fall back to the `settings:` string list when `locations:`
wikilinks are absent, preserving today's name-matching path and its
"no hub location matches setting" warning.

## Note bodies

`body.ts` reads each note once per scan and produces:

- **`source_hash`** — a content hash. `briefing-build.ts` currently hashes
  `{...inputs, notionBody: null}` because re-fetching 30 pages to answer "is this
  stale?" was too expensive. The hash goes into the staleness inputs, so an edited
  note correctly marks its briefing stale.
- **`source_text`** — the body stripped to plain text, with **all `[!dm]` callout
  content removed**, then fed to `search_index.body`. This makes the DM's prose
  searchable in run mode for the first time, while behind-the-screen content never
  enters the index — the same rule `entity_briefings.secret` already follows.

**Rendering reads the file, not the database.** A detail page resolves
`source_path` and reads the markdown at request time, so a note edited during
prep shows immediately rather than after the next tick. The database holds only
what must be queryable.

`entity_briefings.partial` survives but now trips only when a note is genuinely
unreadable, not when a network call failed.

Cost per tick: 155 notes, roughly 1.5 MB of reads and hashes. No mtime caching —
the existing `differs()` check already skips no-op writes.

## Markdown rendering

`remark` + `remark-gfm` to mdast, two custom transforms, then a flat block model
shaped like today's `NotionBlockData` so the six consumers change as little as
possible: the entity detail pages, `EntityQuickView`, `SimpleEntityDetail`,
`SessionNoteDetail`, `BriefingCard`, `EventNoteBody`.

- `NotionBlocks.tsx` -> `MarkdownBlocks.tsx`
- `NotionPropsTable.tsx` -> `PropsTable.tsx` (already generic; rename only)

### Callouts

All 30 types the vault uses render with a type-appropriate icon and colour,
honouring the collapsed suffix (`> [!dm]-`). The taxonomy is documented in the
vault's own `D&D Style Guide.md` and is semantic, not decorative — `read-aloud`
is boxed text for players, `dm` is behind the screen, `describe` is how to play
an NPC at the table, `check` carries DCs, `owed` tracks debts to players.

Only one type gets non-cosmetic treatment in this sub-project: **`[!dm]` content
is excluded from `source_text`.** Every block carries its callout type in the
block model so the richer uses stay cheap later.

### Wikilinks

`[[Name]]`, `[[Name|label]]` and `[[Name#heading]]` resolve against the scan's
basename and `aliases:` index. A link to a mirrored note renders as an internal
hub link to that entity; a link to a skipped type (a thread, a player note)
renders as plain text, not a dead link.

### Base embeds become live hub relations

Roughly 300 `![[Related.base#...]]` embeds sit on nearly every note.
`_Bases/Related.base` defines ten named views, and the hub's own tables already
answer most of them:

| Embed | Vault filter | Hub source |
|---|---|---|
| `#NPCs here` | `type=="npc" && location.contains(this)` | `character_locations` |
| `#Members` | pc/npc by `factions` | `character_factions` |
| `#Items held` | item by `held_by` | `character_items` |
| `#Sessions here` | session by `locations` | `session_note_locations` |
| `#Content here` | encounter/scene by `locations` | `session_note_locations` |
| `#Places within` | `parent == this` | `locations.parent_location_id` |
| `#Threads`, `#Threads advanced` | thread by character/session | — render nothing |
| `#Scenes featuring` | scene by `featuring` | — render nothing |
| `#Player notes` | player-note by character | — render nothing |
| `#Items found` | item by `found_in` | — render nothing |

Where the hub can answer, it renders its own live relation list — strictly better
than the "View in Notion" fallback it replaces, because the embed becomes
clickable hub navigation. Where it cannot, it renders **nothing**, not a broken
embed stub. `#Content here` becomes answerable precisely because encounters and
scenes are being ingested.

### Attachments

`_Attachments/` is 64 MB across 22 files, mostly large PNGs.
`GET /api/vault/attachment?path=…` serves them from the read-only mount through
`sharp` (already a dependency) with resizing and long cache headers.
`![[image.png]]` resolves by basename, following Obsidian's own rule.

Two guards: the resolved absolute path must remain inside `VAULT_PATH`, and the
extension must be an allowed image type. A missing attachment degrades to alt
text.

### Open in Obsidian

`source_path` plus the `vault_name` setting produce
`obsidian://open?vault=…&file=…` on every detail page — the direct replacement
for today's "View in Notion ↗". It only resolves on a machine holding the vault,
which is the entire audience.

## Settings and UI

`NotionSyncPanel` -> `VaultSyncPanel`. The token field is gone; the panel shows
the resolved vault path, whether it is readable, the per-type counts and
warnings from the last pass, and a **Sync now** button.

The auto-sync settings keys are renamed `notion_auto_sync_*` ->
`vault_auto_sync_*`, with a one-time read-through of the old names so the DM's
current interval survives the rename instead of silently resetting to the
default.

## Decommission

The branch is not complete until all of this is done:

| Target | Action |
|---|---|
| `lib/notion/` | Deleted (20 files, 1,896 lines) |
| `@notionhq/client` | Removed from `package.json` |
| `app/api/notion/{page,sources,sync}` | -> `app/api/vault/{page,source,sync}` |
| `notion_token` setting + Settings field | Removed |
| `components/settings/NotionSyncPanel.tsx` | -> `VaultSyncPanel.tsx` |
| `components/glossary/NotionBlocks.tsx` | -> `MarkdownBlocks.tsx` |
| `components/glossary/NotionPropsTable.tsx` | -> `PropsTable.tsx` |
| `components/maps/EventNoteBody.tsx` | Reads `source_path`; "Open in Obsidian" |
| `components/maps/marker-meta.ts` | Comment re-worded; `Exploration Encounter` added |
| `lib/run/briefing-build.ts` | `FetchNotionBodyFn` removed; hash from `source_hash` |
| `lib/run/briefing-inputs.ts` | `notionProps`/`notionUrl` -> `sourceProps`/`sourcePath` |
| `lib/assistant/tools.ts` | `propose_notion_sync` -> `propose_vault_sync` |
| `lib/assistant/read-tools.ts` | `notionProps` -> `sourceProps` |
| `lib/assistant/proposals.ts` | `buildNotionSyncProposal` -> `buildVaultSyncProposal` |
| `app/api/campaigns/[id]/state/review/route.ts` | Reads the note file instead of the Notion API |
| `instrumentation.ts` | `startNotionAutoSync` -> `startVaultSync` |
| `docs/user-guide/notion-sync.md` | -> `vault-sync.md`; README, `sessions.md`, `entities.md` updated |

The session-review route is the subtlest of these. It currently refuses when a
note has no `notion_page_id` and fails with a 502 when Notion is unreachable;
both become a local file read, and its extracted source text benefits from the
same `[!dm]` handling as the search index.

## Error handling

Failure is isolated **per note**, where Notion's was per source.

| Condition | Behaviour |
|---|---|
| `VAULT_PATH` missing or unreadable | Abort before reconcile. Nothing archived. Status says the mount is unavailable. |
| Campaign folder has no `.md` at all | Same abort. A failed mount must never archive a campaign. |
| Scan saw rows but none usable | Existing guard: warn, skip archiving |
| Malformed YAML in one note | Skip that note, warn, continue the scan |
| Duplicate `source_key` across notes | Warn once; winner is the sorted-first path, so it cannot flap |
| Unresolvable wikilink | Warn once per target name, like today's unmatched-setting warning |
| Missing attachment | Alt text; no crash |
| Search-index write fails | Already log-and-continue; unchanged |

The mass-wipe guard matters more than it did. Under Notion it caught an outage.
Now it catches the bind mount not being there, which is a far likelier event.

## Testing

The existing 925 lines of Notion tests are the template and most port directly.

- `lib/vault/test-helpers.ts` writes a **temp fixture vault directory** rather
  than stubbing API responses, so the scan is exercised against real files.
- A fixture built from four real notes (an NPC with factions and a location, a
  location with `parent` and base embeds, a session with `locations`, an
  encounter with `encounter_type`) locks in callout, wikilink and embed parsing.
- `reconcile` tests gain cases for all three identity tiers and for key
  promotion.
- `sync` tests gain the abort-on-unreadable-root and duplicate-key cases.
- `scheduler` tests port essentially unchanged.
- A migration test asserts the `source_key` backfill adopts a row that has only
  `notion_page_id`.

## Prerequisite

> **Resolved 2026-11-04:** one-way Syncthing, Send Only on the Mac to Receive Only
> on Unraid, sharing the `D&D/` folder only and mirroring it *into* the mounted
> directory so the campaign path keeps its prefix. See
> [DEPLOYMENT.md](../../../DEPLOYMENT.md#mirroring-the-vault-with-syncthing). The
> paragraph below is the original record of the open question.

**What places the vault on Willowbrook is unresolved.** The vault lives at
`~/Documents/Willowbrook-Remote/` on the DM's Mac; it is not a git repository and
carries no sync journal. Nextcloud is installed on the Mac and the folder is
named `-Remote`, but whether those files exist on the server was not confirmed.

Everything in this spec is developable and testable against the local vault. Only
deployment is blocked, and only on pointing `VAULT_PATH` at a real directory in
the container.

## Parked

- **The Plot Threads collision.** The vault has 16 `type: thread` notes with
  `status`, `priority`, `arc` and `characters` wikilinks. The hub has a `threads`
  table authored by session review, carrying `stakes`, `opened_on_day` and
  `last_touched_day` that the vault notes do not. Until resolved, threads are
  maintained in two places. Resolving it means deciding whether session review
  still writes threads or only reads them.
- **Callout semantics as typed briefing inputs.** `read-aloud`, `describe`,
  `check` and `owed` carry structure that briefings and run mode could consume
  directly instead of as one body blob.
- **Player-facing input surface.** How player notes, backstory and feedback
  reach the DM's workflow. `type: player-note` already exists in the vault with
  five notes, so whatever is built can land in the same ingestion path. Its own
  sub-project.
- **A second campaign.** `Planescape` is already a vault folder and
  `vault_sources` is per-campaign, so this costs no new code when wanted.
