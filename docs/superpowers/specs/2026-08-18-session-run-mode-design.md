# Session Run Mode — Design Spec

**Date:** 2026-08-18
**Status:** Approved for planning
**Sub-project:** #19 of the campaign hub expansion

## Summary

An at-table mode, `/run`, that makes the campaign hub usable *during* play rather
than only before and after it.

Two capabilities. **Briefings** answer "who is this again, and what do they
want" in the three seconds a table will tolerate. **Marks** capture "something
happened here" for one keystroke, and hand those flags to #18's post-session
review.

The architectural bet is that a briefing is a *projection built during prep*,
not an answer computed at the table. Briefings are materialised into local
SQLite ahead of time. During a session, `/run` makes zero network calls beyond
local SQLite — no Notion, no model, no embedding. The intelligence runs at prep
time, where minutes are available. The table gets a dumb, instant lookup.

The app never touches a microphone. The DM records with a portable mic and the
existing transcript pipeline is untouched.

## Goals

- Answer an improv lookup from local storage, at the table, without a network
  round-trip or a page of prose to read.
- Let the DM flag a moment for one keystroke, with no typing, and have that flag
  still mean something a week later.
- Give non-combat play a home in the app without building a second combat
  tracker.
- Replace the full-table-dump search endpoint with real server-side search.

## Non-goals

- **Any audio capture.** The laptop mic is worse than the DM's portable mic, and
  duplicating a working recording setup buys nothing. No recording, no
  transcription, no live listening.
- **Anything player-facing.** #19 is DM-only, like every surface before it.
- **Notion write-back.** Notion stays the home for prose. Sync stays
  one-directional.
- **Re-implementing the initiative tracker.** `/run` composes
  `components/tracker/InitiativeTracker.tsx`; it does not fork it.
- **Semantic search at the table.** Query-time embedding needs a model call.
  Semantic retrieval stays in the assistant and reference paths, used in prep.
- **The Prep Room and off-screen world tick.** Still wanted; they move to #20.

## Context: what this replaces

Today, mid-session, the DM alt-tabs to Notion or the hub, finds an entity page,
and reads prose while the table waits. Finding the page was never the hard part.
Reading 800 words to recover one motive is.

Meanwhile anything invented at the table — a name, a promise, a rumour — survives
only in the session recording, and surfaces days later when the transcript is
processed.

## Prior art in this codebase

- `components/shell/CommandPalette.tsx` — the overlay and hotkey pattern. Its
  client-side filtering over a full fetch is what the new search replaces.
- `components/tracker/InitiativeTracker.tsx` — takes no props and reads
  `useEncounterStore` directly, so it mounts inside `/run` unchanged.
- `components/tracker/EncounterControls.tsx` — takes props including
  `onNavigateBack`, which `/run` supplies differently.
- `lib/state/content-hash.ts` — the content-hash pattern reused for briefing
  staleness.
- `lib/state/threads.ts`, `lib/db/schema.ts` `thread_links` — the polymorphic,
  FK-free target pattern (`targetKind` + `targetId`, ids may dangle) reused by
  briefings and marks.
- `lib/reference/retrieve.ts` — precedent for loading a SQLite extension
  (vec0). FTS5 follows the same shape.
- `lib/db/schema.ts` — `id / campaignId / archived / createdAt / updatedAt`
  convention followed by all three new tables.

## Constraint that shaped everything

Notion page bodies are **not stored locally**. `app/api/notion/page/route.ts`
fetches blocks live from Notion on every view. Entities carry only `name`,
`description`, `notionProps`, and `notionUrl`. `reference_chunks` and vec0 hold
uploaded rulebooks, not campaign prose.

So a briefing cannot be assembled at the table. It must be built ahead and
stored.

## Data model

Three new tables. All campaign-scoped. Polymorphic targets carry no
`.references()`, matching the `thread_links` rationale — ids may dangle rather
than cascade away history.

### `entity_briefings`

Unique on `(campaignId, targetKind, targetId)`.

| column | notes |
| --- | --- |
| `id` | text primary key |
| `campaignId` | → `campaigns.id`, cascade delete |
| `targetKind` | `character` \| `location` \| `item` \| `faction` |
| `targetId` | polymorphic; no FK by design |
| `identity` | one line — who or what this is |
| `wants` | current agenda; nullable |
| `partyKnows` | what the party has actually learned, as distinct from what the DM knows; nullable |
| `secret` | DM-only. Rendered collapsed, never on the default card; nullable |
| `voice` | one line of speech and manner. Characters only; nullable |
| `aliases` | JSON array of nicknames, titles, and how the party refers to them. Indexed for search |
| `sourceHash` | hash over the build inputs; drives staleness |
| `manualFields` | JSON array of field names the DM edited by hand |
| `partial` | boolean — true when built without the Notion page body |
| `builtAt` | timestamp |
| `createdAt`, `updatedAt` | convention. No `archived` column: a briefing is derived, so archiving one is meaningless — it is rebuilt or deleted |

`voice` earns its row. The recurring improv failure is not forgetting facts, it
is failing to sound like the same person three sessions later. One line
("clipped, over-formal, never uses contractions") outperforms paragraphs of
backstory at the table.

`partyKnows` is separate from `identity` because conflating them is how a DM
leaks information that the characters have not earned.

### `session_marks`

| column | notes |
| --- | --- |
| `id` | text primary key |
| `campaignId` | → `campaigns.id`, cascade delete |
| `runSessionId` | → `run_sessions.id`, cascade delete |
| `atMs` | integer — milliseconds since run start |
| `wallClock` | timestamp |
| `tag` | `npc` \| `promise` \| `loot` \| `lore` \| `todo` \| null |
| `note` | nullable; the one-key path always leaves this null |
| `contextKind` | what was on screen: an entity kind, `encounter`, or null |
| `contextId` | polymorphic; no FK by design; nullable |
| `resolved` | boolean — cleared during post-session review |
| `createdAt` | convention |

`contextKind` / `contextId` are the reason a mark still means something later.
If a briefing card was open when the key was pressed, the mark records it for
free — no extra keystrokes, and no contextless timestamps on Tuesday.

### `run_sessions`

| column | notes |
| --- | --- |
| `id` | text primary key |
| `campaignId` | → `campaigns.id`, cascade delete |
| `label` | nullable; defaults to the start date |
| `startedAt` | timestamp |
| `endedAt` | nullable timestamp |
| `sessionNoteId` | nullable; linked once the transcript lands. No FK — same dangling-id rationale as `threads.openedSessionId` |
| `createdAt` | convention |

Linking a run to a `session_notes` row is what lets #18's review pass read the
DM's marks alongside the notes.

## Building briefings

Runs at prep time. Never at the table.

**Inputs:** the entity's `description` and `notionProps`; the Notion page body
fetched once at build time; threads linked via `thread_links`; recent
`timeline_events` referencing the entity; the session notes it appears in.

**Process:** one Anthropic call per entity, structured output into the briefing
fields, following the existing agent conventions in `lib/assistant/agent.ts`.
Unlike the #18 review pass, this writes directly rather than emitting
proposals — a briefing is a derived summary the DM can edit or rebuild at will,
not a mutation of tracked campaign state.

**Triggers:**

1. **Lazily**, on first request for an entity that has no briefing — but
   **only outside `/run`**, on entity detail pages and other prep surfaces.
   Inside `/run` a missing briefing renders the fallback card and never
   silently reaches the network; the DM can invoke a build explicitly from the
   card, which is a deliberate act with a visible cost, not a hidden one.
2. **A prep-time batch** — "build for next session" walks entities linked to
   open threads plus the party's current location.
3. **A campaign-wide build**, kicked off once and left to run.

Nothing rebuilds automatically on Notion sync. Sync marks briefings stale; it
does not spend model calls on hundreds of entities the DM may never open.

**Three rules:**

1. **Staleness never blocks.** A stale briefing still serves instantly and shows
   a stale pip. At a table, a fast slightly-old answer beats a slow correct one.
2. **Manual wins.** Fields listed in `manualFields` survive rebuilds untouched.
   A rebuild silently overwriting a hand-written voice line would make the
   feature untrustworthy.
3. **Partial is labelled.** If Notion is unreachable, the build proceeds from
   local data and sets `partial`, so the DM knows the page body was never read.

## Search

`GET /api/search?campaignId=&q=&kinds=` replaces the current endpoint, which
loads five entire tables and returns name-only rows for client-side filtering.

Backed by a single **FTS5 virtual table**, `search_index`, holding one row per
searchable object: `campaignId`, `kind`, `targetId`, `name`, `aliases`, and
`body`. Ranked prefix matching from local SQLite, single-digit milliseconds, no
network.

What populates each column depends on the row:

| kind | `name` | `aliases` | `body` |
| --- | --- | --- | --- |
| character, location, item, faction | entity `name` | briefing `aliases`, when one exists | briefing `identity` / `wants` / `partyKnows`, else entity `description` |
| thread | `title` | — | `stakes` |
| clock | `name` | — | owner name |

**An entity is indexed whether or not it has a briefing.** The index is
maintained on entity write and on briefing write, and a briefing write enriches
the existing row rather than creating it. This is what makes the fallback card
reachable: an entity with no briefing is still findable, it just answers with
less.

`secret` is never indexed. A DM-only field must not be retrievable by typing its
contents into a search box.

Ranking: exact name match, then alias match, then body match.

`campaignId` is required and enforced server-side.

`aliases` is what rescues lexical search from its obvious weakness. The DM types
"the mask guy," not "Garrick Veldros." A build-time alias list catches that
without any query-time model call.

## The `/run` surface

A mode, not a page: full-bleed, no sidebar, no top bar. Entered when the session
starts, left when it ends.

**Left (~60%) — the live scene.** With an active encounter, this is
`InitiativeTracker` and `EncounterControls` mounted against `useEncounterStore`.
Without one, it is the scene board: pinned briefing cards, the party's current
location, open threads touching that location, and clocks that could tick
tonight.

The scene board gives non-combat play a home for the first time, as a
composition of existing #18 data rather than new machinery.

**Right (~40%) — the answer panel.** Search at top, briefing card below, pinned
cards stacking beneath.

**Bottom strip** — run timer, mark count, the last three marks, and any pending
mark-write warning.

### Keyboard

No modifiers on the hot path. The DM has one hand free, mid-sentence.

| key | action |
| --- | --- |
| any letter | focuses search and begins the query |
| `Space`, when not typing | drops a mark |
| `1`–`5`, while the mark toast is visible | tags it: NPC / promise / loot / lore / todo |
| `↑` `↓` | move through results |
| `→` | follow a related entity; `←` goes back |
| `Enter` | pin the card so it persists |
| `Esc` | clear and blur |

**Tags are digits, not letters**, because letters collide with starting a search
immediately after marking — which is exactly what happens when an NPC gets
named. Digits almost never begin a query.

**Tagging is optional by construction.** `Space` alone is a complete mark. The
tag window is a four-second toast, free to ignore. The moment tagging becomes
mandatory, marking stops happening.

`Enter`-to-pin is what carries a long scene: the three NPCs in the room stay on
screen while the DM looks up everything around them.

## Error handling

Governing rule: **`/run` never shows nothing.**

| condition | behaviour |
| --- | --- |
| no briefing built | card falls back to `name`, `description`, `notionProps`, and linked threads, with a build action. Degraded, never empty, never a bare spinner |
| Notion unreachable at build | build proceeds from local data; briefing flagged `partial` |
| no API key or model unavailable | briefings cannot build; `/run` degrades to fast local lookup over existing data |
| mark write fails | optimistic local write, retry, pending queue persisted to `localStorage`; failure surfaces in the bottom strip |
| browser crash mid-session | queued marks recovered from `localStorage` on next load |
| `endedAt` never set | auto-closed when the next run starts |

Marks are the one thing that must not be lost silently. A crash at 10pm must not
cost the night's flags.

## Testing

Vitest, following the `lib/state/*.test.ts` pattern.

- `sourceHash` stability across irrelevant input reordering.
- **Rebuilding never clobbers a field listed in `manualFields`** — the contract
  test that keeps the feature trustworthy.
- `partial` is set when the Notion fetch fails and cleared on a successful
  rebuild.
- Mark offset arithmetic, the tag window boundary, context capture, and queue
  drain and retry.
- FTS ranking order: exact name above alias above body field.
- **Campaign scoping on the new search endpoint.** `CommandPalette.tsx` carries
  a comment about a cross-campaign leak this shell shipped once before; the
  replacement gets explicit scoping tests.
- Fallback card renders with no briefing row present.

## Parked

Not part of #19, recorded because it surfaced during design:

**Generate the transcript name dictionary from the database.** The
`dnd-transcript-processor` skill hand-maintains 69 sed substitutions mapping
mis-hearings back to canonical names. Every canonical name is already a row in
`characters`, `locations`, `factions`, or `items`. An endpoint could serve that
dictionary and retire a growing pile of hand-curated regex. Small, unglamorous,
and independent of #19.
