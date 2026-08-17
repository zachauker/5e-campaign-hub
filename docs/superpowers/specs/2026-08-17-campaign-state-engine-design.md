# Campaign State Engine — Design Spec

**Date:** 2026-08-17
**Status:** Approved for planning
**Sub-project:** #18 of the campaign hub expansion

## Summary

A durable model of campaign state over time: **threads** (open questions with
stakes), **clocks** (segmented progress tracks owned by factions and locations),
and an **in-world calendar** that advances explicitly and ticks cadence clocks
when it does.

Two engines move that state. Advancing the in-world date is deterministic server
logic with no model involved. Reviewing a played session runs the Anthropic Tool
Runner over the synced session notes and emits **cited proposals** — thread
opened, thread resolved, clock ticked — which the DM approves or rejects before
anything is written.

This attacks the prep-phase problem directly: today, "what's still open" and
"what has the world been doing" are re-derived from prose every single prep
cycle, by hand, in a Claude conversation against Notion. After #18 they are
queryable state that survives between sessions.

## Goals

- Give open plot threads a home that persists, links to entities, and shows
  staleness.
- Make in-world time a real, advanceable quantity, and make faction clocks tick
  as a mechanical consequence of it.
- Turn a played session into proposed state diffs the DM reviews in under a
  minute, grounded in quoted evidence from the session notes.
- Surface threads and clocks inside the entity pages the DM already reads, not
  only on a dedicated board.
- Reuse the existing proposal / confirm-before-execute write path rather than
  inventing a second one.

## Non-goals (deferred to #19)

- **Off-screen event generation.** #18 makes the world tick; it does not make the
  world narrate itself. Generated "what the Cerberus Assembly did while you were
  underground" prose is the next sub-project, and it needs #18's thread and clock
  data to be grounded rather than invented.
- **Session outline drafting (the "Prep Room").** Turning state into a runnable
  scene outline is #19.
- **Anything player-facing.** #18 is DM-only, like every surface before it.
- **Notion write-back of threads or clocks.** Notion stays the home for prose;
  the app owns state. The sync stays one-directional.
- **Thread graph / relationship visualizer.** Attractive, low prep value.
- **Thread priority or urgency scoring.** Staleness is computable; priority would
  be re-sorted by hand anyway.

## Prior art in this codebase

This design is mostly composition of things already built:

- `lib/assistant/proposals.ts` — the `{summary, targetRoute, method, payload}`
  proposal contract, and the rule that the agent never mutates. Extended here,
  not replaced.
- `lib/assistant/agent.ts` (`runAssistant`) — Tool Runner setup, SSE streaming,
  API key read from the settings table.
- `lib/assistant/read-tools.ts` — reused as-is by the review pass.
- `lib/notion/run-sync.ts`, `lib/notion/scheduler.ts` — background sync that
  keeps `session_notes` fresh; #18 reads its output, never drives it.
- `components/ui/tabs.tsx`, `components/glossary/RelatedCard.tsx` — the tab and
  related-entity primitives the new surfaces reuse.
- #17 SP2's map-pin slide-over pattern — reused for the review sheet.
- #17 SP3's entity filter/view/sorting work — reused for the threads board.

## Data model

Five new tables, all campaign-scoped, following the existing
`id / campaignId / archived / createdAt / updatedAt` convention.

### `threads`

An open question with stakes — not a task.

| column | notes |
| --- | --- |
| `id` | pk |
| `campaignId` | fk → `campaigns.id`, cascade |
| `title` | the question, e.g. "Who hired the assassins in Rexxentrum?" |
| `stakes` | what goes wrong if it stays unresolved |
| `status` | `open` \| `dormant` \| `resolved` \| `abandoned` — set manually in #18; nothing auto-dormants a thread on staleness |
| `openedSessionId` | nullable fk → `session_notes.id` |
| `resolvedSessionId` | nullable fk → `session_notes.id` |
| `openedOnDay` | in-world absolute day (integer) |
| `lastTouchedDay` | in-world absolute day; drives staleness sort |
| `notes` | free text |
| `archived` | boolean, default false |

### `thread_links`

Polymorphic join describing what a thread is *about*.

| column | notes |
| --- | --- |
| `id` | pk |
| `threadId` | fk → `threads.id`, cascade |
| `targetKind` | `character` \| `location` \| `item` \| `faction` \| `session` |
| `targetId` | id within that kind |
| `role` | `subject` \| `stakeholder` \| `obstacle` |

Deleting a target entity cascades the link row only. The thread survives with
one fewer chip.

### `clocks`

Blades-style segmented progress track.

| column | notes |
| --- | --- |
| `id` | pk |
| `campaignId` | fk → `campaigns.id`, cascade |
| `name` | |
| `segments` | 4, 6, 8, or 12 |
| `filled` | integer, `0 <= filled <= segments` |
| `ownerKind` | `faction` \| `location` \| `thread` \| null |
| `ownerId` | nullable |
| `cadenceDays` | nullable; in-world days per automatic tick. Null = manual only |
| `lastTickedDay` | in-world absolute day |
| `status` | `running` \| `paused` \| `complete` |
| `payoff` | what happens when it fills |

### `timeline_events`

Append-only record of what moved and why. Both the timeline view and the audit
trail — a derived view could not reconstruct *why* a clock ticked.

| column | notes |
| --- | --- |
| `id` | pk |
| `campaignId` | fk → `campaigns.id`, cascade |
| `day` | in-world absolute day |
| `kind` | `thread_opened` \| `thread_resolved` \| `clock_ticked` \| `clock_completed` \| `date_advanced` \| `session_played` \| `note` |
| `title` | |
| `body` | nullable |
| `sourceKind` | `manual` \| `proposal` \| `cadence` |
| `threadId` / `clockId` | nullable fks |

### `session_reviews`

Watermark and idempotency guard for the AI review pass.

| column | notes |
| --- | --- |
| `id` | pk |
| `sessionNoteId` | fk → `session_notes.id`, cascade |
| `reviewedAt` | timestamp |
| `contentHash` | hash of the Notion page body at review time |
| `proposalCount` | integer |

Kept **out of** `session_notes` deliberately: that table's column set is managed
by the Notion reconciler, and review state must not be exposed to a sync run.

### In-world time

Two new columns on `campaigns`: `inWorldDay` (integer, nullable) and
`calendarEpochLabel` (text, e.g. `"P.D."`).

**The date is stored as an integer absolute day number, never as a formatted
string.** All date math becomes integer math. Rendering "13th of Fessuran, 843
P.D." is a pure function in `lib/calendar/exandria.ts`, behind a small `Calendar`
interface:

```ts
interface Calendar {
  format(day: number, epochLabel: string): string;
  parse(input: string, epochLabel: string): number | null;
  daysInYear: number;
  months: ReadonlyArray<{ name: string; days: number }>;
}
```

The Exandrian calendar (11 months, 328 days, no leap year) is hardcoded in that
one module because that is the campaign. The interface means a different
calendar is a new file, not a refactor.

This choice is what makes cadence ticking trivial: a clock is due when
`inWorldDay - lastTickedDay >= cadenceDays`, which is one comparison per clock
rather than calendar arithmetic scattered across the app.

## Engine 1 — Date advance (deterministic, no AI)

`POST /api/campaigns/[id]/advance-date { toDay }`

1. Reject `toDay <= inWorldDay`. Time only moves forward.
2. For each `running` clock with a non-null `cadenceDays`, compute due ticks:
   `floor((toDay - lastTickedDay) / cadenceDays)`, clamped so `filled` never
   exceeds `segments`.
3. Return the result as a **preview**, not a mutation.

The UI renders the preview as a checklist — "Cerberus Assembly investigation +2
(14 days elapsed)" — the DM unchecks anything unwanted and confirms **once**. On
confirm the server applies the accepted ticks, marks any clock reaching
`segments` as `complete`, sets `campaigns.inWorldDay`, and writes one
`timeline_event` per applied tick with `sourceKind: 'cadence'` plus one
`date_advanced` event.

**`lastTickedDay` advances by whole cadence periods, not to `toDay`:**
`lastTickedDay += ticks * cadenceDays`. Advancing 20 days on a 7-day clock yields
2 ticks and leaves 6 days of credit toward the third. Setting it to `toDay` would
silently discard that remainder and make long jumps lose progress.

**A declined tick is skipped, not deferred.** Unchecking a clock in the preview
sets its `lastTickedDay` to `toDay` and applies no tick, so the same tick is not
re-proposed on the next advance. Deferring would nag on every subsequent date
change.

Correcting a mistyped date is a **separate path** that sets `inWorldDay` without
running cadence processing. Without this, a typo'd jump followed by a correction
would leave clocks permanently over-ticked. Ticks are never automatically undone;
the DM edits the clock directly.

This engine involves no model and no network. It is the most testable part of the
feature and is specified first for that reason.

## Engine 2 — Post-session review (cited AI proposals)

### Trigger

Explicit, not automatic. Background auto-sync ticks every 15 minutes; running the
review pass on every sync would spam proposals and burn tokens for no reason.

A session-notes page shows a **"Review session"** action, badged when the note has
no `session_reviews` row at all, or when its current content hash differs from
that of the most recent row.

### Flow

```
Session note page → POST /api/campaigns/[id]/state/review { sessionNoteId }   ← SSE
   │  loads: live Notion page body + open threads + running clocks
   │         + factions/locations + current in-world day
   ▼  Anthropic Tool Runner (same setup as runAssistant)
   │    READ tools    → lib/assistant/read-tools.ts as-is, plus listThreads / listClocks
   │    PROPOSE tools → return Proposal objects; no mutation
   ▼
Review slide-over: each proposal rendered under its citation → approve / reject / apply all
   │  approved → replayed through the real hardened route
   ▼  each application writes a timeline_event with sourceKind: 'proposal'
```

### Proposal builders

Four additions to `lib/assistant/proposals.ts`, using the existing contract:

| builder | route | method |
| --- | --- | --- |
| `buildThreadOpenProposal` | `/api/threads` | POST |
| `buildThreadResolveProposal` | `/api/threads/[id]` | PATCH |
| `buildClockTickProposal` | `/api/clocks/[id]/tick` | POST |
| `buildDateAdvanceProposal` | `/api/campaigns/[id]/advance-date` | POST |

### Two hard constraints

**Clock proposals are deltas, not absolute values.** The tool signature is
`{ clockId, delta, reason, citation }`, and the route validates `filled + delta`
into range. A model that can only say "+1" cannot silently reset a clock to zero.
Same instinct as `assertHubAuthored` in the existing code.

**Every proposal must carry a citation.** The tool schema requires a `citation`
field quoting the passage from the session notes that justifies the proposal, and
the review sheet renders that quote above each item. The DM approves by reading
one sentence rather than re-reading the whole note. Uncited proposals are
rejected server-side before anything streams to the UI, so an invented proposal
never reaches the sheet at all.

## Surfaces

`PRODUCT.md` rules out sidebar and dashboard chrome, so this adds exactly one
top-bar destination and otherwise pushes state into pages the DM already reads.

### `/chronicle` — one route, two tabs

Reuses `components/ui/tabs.tsx`.

**Threads tab** — the "what's rotting" board. Rows sorted by staleness
(`inWorldDay - lastTouchedDay`), each showing title, stakes, linked entities as
chips, and days untouched. Dormant threads collapse into a separate group.
Reuses #17 SP3's filter/view/sorting work rather than inventing new list chrome.

**Timeline tab** — current in-world date rendered large in the header, running
clocks along the top, `timeline_events` stream below. Date advance is initiated
here and opens the Engine 1 preview checklist.

The route name is a working choice: atmospheric without crossing into the
fantasy-kitsch register the anti-references rule out.

### Clock rendering

Segmented arc, filled segments in an urgency color, **always paired with a
literal `5/8` label**. Color alone cannot carry state (the accessibility rule in
`PRODUCT.md`), and the numeral is what reads at a glance from across a table.

### Inline presence — where the feature pays off

Faction, location, and character detail pages each gain an "Open threads" block
driven by `thread_links`, using the existing `RelatedCard` component. Faction
pages additionally render their owned clocks.

The DM learns the Cerberus Assembly has three unresolved threads and a 6/8 clock
*while reading the Cerberus Assembly page* — not by remembering to check a board.

### Review sheet

A slide-over reusing #17 SP2's map-pin pattern: proposal summary, citation quote
above it, approve/reject per item, apply-all at the bottom.

### Two cheap integrations

- ⌘K searches threads by title and exposes "Advance in-world date" as a command.
- The existing assistant gains `listThreads` / `listClocks` read tools, so "what's
  still open involving the Dynasty?" works in chat with no new UI.

## Error handling

- **Backwards time** — `advance-date` rejects `toDay <= inWorldDay`; correction is
  a separate non-ticking path.
- **Uncited proposals** — rejected server-side before streaming.
- **Out-of-range clock tick** — route validates `filled + delta`; 400 on
  violation.
- **Stale review** — `contentHash` captured at review time is re-checked at apply
  time. If a background sync changed the note underneath, the sheet warns rather
  than applying against text the DM did not read.
- **Partial application** — expected and allowed. Each approved proposal replays
  independently; one 4xx marks that row failed and leaves the rest applied. Every
  success writes its `timeline_event`, so the log records exactly what landed.
- **Deleted entities** — `thread_links` cascades on target delete; the thread
  survives.
- **Missing API key** — same settings-table read and same error surface the
  assistant already uses.
- **Notion page fetch failure** — the review pass surfaces the error and emits no
  proposals; nothing is partially applied.

## Testing

Follows the existing vitest setup. The valuable tests are the pure ones.

- `lib/calendar/exandria.ts` — day↔date round-trips, month boundaries, the
  328-day year, year rollover, parse failure cases.
- Cadence computation — multi-tick over a long jump, remainder credit preserved
  in `lastTickedDay`, a clock that completes mid-jump, paused clocks skipped,
  `cadenceDays: null` never ticking, clamping at `segments`, and a declined tick
  advancing `lastTickedDay` without applying.
- Proposal builders and citation validation, mirroring `proposals.test.ts`.
- Route level — clock range clamping, delta-only enforcement, backwards-date
  rejection, stale-hash warning.

The AI pass is tested at the **wiring** level with a stubbed model, as
`tools.test.ts` already does: asserting that a given tool call produces the right
`Proposal`, never that the model's judgment is correct.

## Migration

One drizzle migration adds the five tables plus `campaigns.inWorldDay` and
`campaigns.calendarEpochLabel`.

`inWorldDay` starts null. `/chronicle` prompts once for the campaign's current
in-world date before any other state functions. No backfill guessing, and no
invented starting date.

## Open risk

The value of Engine 2 rests entirely on proposal quality. The citation
requirement is the mitigation: a proposal the model cannot ground in quoted text
never reaches the review sheet, which converts the failure mode from "plausible
wrong state silently applied" into "fewer proposals offered." Engine 1 delivers
value regardless of how Engine 2 performs, which is why the two are separable and
Engine 1 is specified first.
