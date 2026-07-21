# Notion Auto Background Sync — Design

**Date:** 2026-07-21
**Status:** Approved (pending spec review)

## Goal

Keep the app's local data automatically up to date with Notion by running the
existing campaign sync periodically in the background, without removing the
manual "Sync now" option.

## Background / Current State

- Sync today has exactly one trigger: the manual **Sync now** button in
  `components/settings/NotionSyncPanel.tsx`, which `POST`s to
  `app/api/notion/sync/route.ts`, which loads the token + sources and calls
  `syncCampaign()` in `lib/notion/sync.ts`.
- Data is stored in SQLite (better-sqlite3 + drizzle). Per-source sync config
  and state live in the `notion_sources` table (`databaseUrl`, `dataSourceId`,
  `lastSyncedAt`, `lastStatus`).
- The Notion integration token is stored in the `settings` key/value table under
  `notion_token` (not an env var).
- Production runs a single standalone `server.js` in one Docker container on
  Unraid (`restart: unless-stopped`). `instrumentation.ts` `register()` already
  runs once at boot (Node runtime only) and executes DB migrations.
- No server-side scheduling / cron / worker infrastructure exists today.
- `lib/notion/sync.ts` already contains a **zero-rows guard** that prevents
  mass-archiving local data when Notion transiently returns an empty result set.
- `lib/notion/reconcile.ts` already distinguishes `updated` vs `unchanged` rows.

## Decisions

- **Trigger:** periodic polling (server-side timer). No Notion webhooks.
- **Control:** configurable in Settings — on/off toggle + interval; default 15 min.
- **Scope:** all campaigns that have `notion_sources` configured.
- **Default state:** auto-sync **on** by default.
- **First run:** ~30s after boot, then every interval.
- **Overlap:** an in-process lock shared between manual and auto sync prevents
  concurrent syncs of the same campaign.

## Architecture

### 1. Shared sync core (`lib/notion/run-sync.ts`)

Extract the orchestration currently inline in `app/api/notion/sync/route.ts`
into a reusable function:

```
runCampaignSync(campaignId: string): Promise<SyncSummary>
```

Responsibilities (moved verbatim from the route):
1. Load `notion_token` from settings; throw/return a clear error if missing.
2. Load configured `notion_sources` rows for the campaign.
3. Resolve/update each source's `dataSourceId` as needed.
4. Call `syncCampaign()`.
5. Write back `lastSyncedAt` + `lastStatus` per source.

The manual route (`POST /api/notion/sync`) becomes a thin wrapper that calls
`runCampaignSync(campaignId)` and returns its summary. This guarantees manual
and automatic syncs behave identically.

A helper to enumerate campaigns with configured sources:

```
listCampaignsWithSources(): Promise<string[]>   // distinct campaignId from notion_sources
```

### 2. Scheduler (`lib/notion/scheduler.ts`)

Exports `startNotionAutoSync()`.

- Self-rescheduling `setTimeout` (mirrors the existing `lib/hooks/useDDBSync.ts`
  pattern): the next tick is scheduled only after the current one settles, so
  runs never stack.
- On each tick:
  1. Read config from settings (`notion_auto_sync_enabled`,
     `notion_auto_sync_interval_minutes`).
  2. If disabled → reschedule a lightweight re-check (at the configured interval,
     or a sane fallback) and return.
  3. If enabled → `listCampaignsWithSources()`, then run `runCampaignSync()` for
     each **sequentially**.
  4. Reschedule the next tick using the current configured interval (re-read each
     tick so interval changes take effect without restart).
- Every run is wrapped so a thrown error is caught + logged and never kills the
  loop. Per-campaign failures are isolated (one campaign failing doesn't skip the
  others). Errors surface through the existing `lastStatus` writeback.
- **Overlap lock:** a module-level set of in-flight campaign IDs, shared with the
  manual route. `runCampaignSync` (or a wrapper) acquires the lock per campaign;
  if a campaign is already in-flight, the scheduler skips it this tick and the
  manual route can reject or wait (manual takes precedence — see below).

### 3. Overlap lock (`lib/notion/sync-lock.ts`)

A tiny module holding a `Set<string>` of campaign IDs currently syncing, with
`tryAcquire(campaignId): boolean` and `release(campaignId): void`. Because
manual sync (via the route) and auto sync (via the scheduler) run in the **same**
Node process, this in-process lock is sufficient — no DB lock needed.

- Manual route: if lock is held, it may either wait briefly or return a
  "sync already in progress" response (decision: return a clear 409-style status
  so the UI can show "already syncing"). Manual is never silently dropped.
- Scheduler: if lock is held for a campaign, skip that campaign this tick.

### 4. Startup (`instrumentation.ts`)

After `runMigrations()`, call `startNotionAutoSync()`, guarded so it only starts
once per process (a module-level `started` boolean in the scheduler). Node
runtime only (`NEXT_RUNTIME === "nodejs"`), matching the existing guard.

- First tick fires ~30s after boot (not a full interval) so a freshly started
  container refreshes promptly.

### 5. Config storage (`settings` table)

Two new keys, same pattern as `notion_token`:

| Key | Type | Default |
|---|---|---|
| `notion_auto_sync_enabled` | `"true"` / `"false"` | `"true"` (on) |
| `notion_auto_sync_interval_minutes` | integer string | `"15"` |

Reads must tolerate missing keys (fall back to defaults) so existing
deployments get auto-sync on at 15 min without manual configuration.
`app/api/settings/route.ts` `ALLOWED_KEYS` must include both new keys.

### 6. UI (`components/settings/NotionSyncPanel.tsx`)

- Add an **on/off toggle** bound to `notion_auto_sync_enabled`.
- Add an **interval selector** (5 / 15 / 30 / 60 min) bound to
  `notion_auto_sync_interval_minutes`.
- Both save via the existing settings `PUT` path.
- The manual **Sync now** button and the **Last synced …** display are unchanged
  (auto-sync writes `lastSyncedAt` the same way manual does).

## Data Flow

```
boot → instrumentation.register()
     → runMigrations()
     → startNotionAutoSync()  (once, node runtime)
        └─ setTimeout(~30s) ─► tick:
             read config from settings
             enabled? ── no ──► reschedule, return
                │ yes
             listCampaignsWithSources()
             for each campaign (sequential):
                lock.tryAcquire? ── no ──► skip (manual in progress)
                   │ yes
                runCampaignSync(campaignId)  ── writes lastSyncedAt/lastStatus
                lock.release()
             reschedule(next = interval from settings)

manual button → POST /api/notion/sync → runCampaignSync(campaignId)
             (same lock; returns "already syncing" if held)
```

## Error Handling

- Missing `notion_token`: `runCampaignSync` returns/throws a clear error; the
  scheduler logs and continues; the manual route surfaces it to the UI as today.
- Notion API / network failure during a tick: caught per campaign, logged,
  recorded in `lastStatus`; loop continues.
- Transient empty result from Notion: existing zero-rows guard in `sync.ts`
  prevents mass-archival — no change needed, but explicitly relied upon.
- Scheduler must never throw out of its own callback (would stop rescheduling).

## Testing

- `run-sync` — unit test the extracted orchestration with injected token/source
  loaders and a stubbed `syncCampaign`, asserting `lastSyncedAt`/`lastStatus`
  writeback and missing-token handling.
- `scheduler` — unit test the enabled/disabled and interval-selection decision
  logic and the per-campaign loop with injected dependencies (no real timers,
  no real Notion). Verify a thrown `runCampaignSync` doesn't stop the loop and
  that a locked campaign is skipped.
- `sync-lock` — unit test acquire/release/contention.
- Existing `sync.test.ts`, `reconcile.test.ts`, etc. must remain green; the route
  refactor must not change observable sync behavior.

## Out of Scope (YAGNI)

- Notion webhooks / push updates.
- Per-source or per-entity-type independent intervals (single global interval).
- Multi-process / distributed locking (single container in production).
- Backoff/retry tuning beyond "log and continue to next tick".
