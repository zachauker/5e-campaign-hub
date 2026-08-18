# Campaign State Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the campaign a durable model of its own state over time — open threads, faction clocks, and an in-world calendar — moved by a deterministic date-advance engine and an AI review pass that emits cited proposals over synced session notes.

**Architecture:** Five new SQLite tables plus two columns on `campaigns`. All logic lives in `lib/` (pure functions and db repos); `app/api/` routes stay thin wrappers, because `vitest.config.ts` only collects tests under `lib/**` and `components/**`. Engine 1 (date advance + cadence ticking) is deterministic with no model and no network. Engine 2 (post-session review) reuses the existing Tool Runner + `{summary, targetRoute, method, payload}` proposal contract from `lib/assistant/`, adding a hard citation requirement.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Drizzle ORM over better-sqlite3, `@anthropic-ai/sdk` beta Tool Runner + `betaZodTool`, zod, Radix primitives, Tailwind v4, vitest.

---

## Conventions you must follow

Read these before Task 1. They are not optional and they differ from defaults you may assume.

**Migrations are raw SQL, not drizzle-kit.** `drizzle.config.ts` exists but the app migrates via `runMigrations()` in `lib/db/migrate.ts`, a single function of `CREATE TABLE IF NOT EXISTS` statements followed by an idempotent `addColumnIfMissing(table, column, definition)` helper. Never run `drizzle-kit generate`. Add tables to the big `sqlite.exec()` block and new columns via `addColumnIfMissing`.

**Tests only run from `lib/**/*.test.ts` and `components/**/*.test.ts`, in a node environment.** There is no React testing library, no jsdom, no route-handler test harness. Consequences:
- Logic that needs a test goes in `lib/`. API routes are thin and untested by unit tests.
- UI tasks (11–16) have **no unit tests**. They are verified in the browser with the preview tools. Do not add a testing library.

**DB-backed tests use `createTestDb()` from `lib/notion/test-helpers.ts`.** It writes a fresh migrated SQLite file to tmp, sets `process.env.DB_PATH`, and returns `{ db, campaignId }`. Reuse it — do not write a second one. In tests, drizzle's better-sqlite3 driver is synchronous, so `db.insert(...).values(...).run()` is the idiom; in routes, `await` the same builders.

**Route style** follows `app/api/factions/route.ts`: `NextResponse.json`, manual body validation returning `{ error }` with a 400, `generateId()` from `lib/utils.ts` for ids, `new Date()` for timestamp columns, `params` typed as `Promise<{ id: string }>` and awaited.

**Pages are client components** that fetch from `/api/*` (see `app/factions/[id]/page.tsx` → `SimpleEntityDetail`). Do not write server components that touch the db directly.

**Run tests with** `npm test` (`vitest run`), or a single file with `npx vitest run lib/path/file.test.ts`.

---

## Spec deviation, recorded

The spec's `Calendar` interface listed `format(day, epochLabel)` and `parse(input, epochLabel)`. This plan replaces `parse` with `toParts(day)` / `fromParts(parts)`. Reason: the only caller is the date-advance UI, which uses three inputs (day-of-month, month select, year) rather than a free-text field — so a string parser would be dead code, and free-text date parsing is a bug farm. Everything else in the spec is implemented as written.

---

## File structure

**New — pure logic (fully unit-tested):**
- `lib/calendar/exandria.ts` — `Calendar` interface, the 11-month/328-day Exandrian calendar, day↔parts conversion, formatting.
- `lib/calendar/exandria.test.ts`
- `lib/state/cadence.ts` — `computeDueTicks()`. No db, no dates, just arithmetic.
- `lib/state/cadence.test.ts`
- `lib/state/content-hash.ts` — stable hash of a Notion page body.
- `lib/state/content-hash.test.ts`

**New — db repos (unit-tested against `createTestDb`):**
- `lib/state/threads.ts` — thread create/update/list + staleness ordering.
- `lib/state/threads.test.ts`
- `lib/state/clocks.ts` — clock create/update + `applyTick` range validation.
- `lib/state/clocks.test.ts`
- `lib/state/advance.ts` — `previewAdvance()` / `applyAdvance()` / `setDate()`, timeline event writes.
- `lib/state/advance.test.ts`
- `lib/state/timeline.ts` — `recordEvent()` helper used by every writer.

**New — Engine 2:**
- `lib/state/review-tools.ts` — `betaZodTool` definitions for the four propose tools + read tools.
- `lib/state/review-agent.ts` — `runSessionReview()`, mirroring `runAssistant`.
- `lib/state/review-agent.test.ts` — wiring only, stubbed model.

**Modified:**
- `lib/db/schema.ts` — five tables + two `campaigns` columns.
- `lib/db/migrate.ts` — matching raw SQL + `addColumnIfMissing` calls.
- `lib/assistant/proposals.ts` — four new builders + `assertCitation`.
- `lib/assistant/proposals.test.ts` — cases for the above.
- `lib/assistant/read-tools.ts` — `listThreads` / `listClocks`.
- `lib/assistant/tools.ts` — expose those two to the existing chat assistant.
- `components/shell/TopBar.tsx` — one nav entry.
- `components/shell/CommandPalette.tsx` — thread search + advance-date command.
- `components/glossary/SimpleEntityDetail.tsx` — "Open threads" block.
- `components/sessions/SessionNoteDetail.tsx` — "Review session" action.

**New — API routes (thin):**
- `app/api/threads/route.ts`, `app/api/threads/[id]/route.ts`
- `app/api/clocks/route.ts`, `app/api/clocks/[id]/route.ts`, `app/api/clocks/[id]/tick/route.ts`
- `app/api/campaigns/[id]/advance-date/route.ts`, `app/api/campaigns/[id]/set-date/route.ts`
- `app/api/campaigns/[id]/state/route.ts`, `app/api/campaigns/[id]/state/review/route.ts`

**New — UI:**
- `components/state/ClockDial.tsx`, `components/state/ThreadRow.tsx`, `components/state/ThreadsTab.tsx`, `components/state/TimelineTab.tsx`, `components/state/AdvanceDateDialog.tsx`, `components/state/ReviewSlideOver.tsx`, `components/state/ChronicleBrowser.tsx`
- `app/chronicle/page.tsx`

---

# Phase 1 — Foundation

### Task 1: Exandrian calendar module

Pure integer↔date conversion. Nothing else in the feature works until in-world days can be rendered.

**Files:**
- Create: `lib/calendar/exandria.ts`
- Test: `lib/calendar/exandria.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/calendar/exandria.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EXANDRIA, formatInWorldDay } from "./exandria";

describe("EXANDRIA calendar shape", () => {
  it("has 11 months totalling 328 days", () => {
    expect(EXANDRIA.months).toHaveLength(11);
    expect(EXANDRIA.months.reduce((n, m) => n + m.days, 0)).toBe(328);
    expect(EXANDRIA.daysInYear).toBe(328);
  });
});

describe("toParts", () => {
  it("day 0 is the 1st of Horisal, year 0", () => {
    expect(EXANDRIA.toParts(0)).toEqual({ year: 0, monthIndex: 0, dayOfMonth: 1 });
  });
  it("day 28 is the last day of Horisal (29 days)", () => {
    expect(EXANDRIA.toParts(28)).toEqual({ year: 0, monthIndex: 0, dayOfMonth: 29 });
  });
  it("day 29 rolls into Misuthar", () => {
    expect(EXANDRIA.toParts(29)).toEqual({ year: 0, monthIndex: 1, dayOfMonth: 1 });
  });
  it("day 327 is the last day of the year", () => {
    expect(EXANDRIA.toParts(327)).toEqual({ year: 0, monthIndex: 10, dayOfMonth: 32 });
  });
  it("day 328 rolls the year over", () => {
    expect(EXANDRIA.toParts(328)).toEqual({ year: 1, monthIndex: 0, dayOfMonth: 1 });
  });
  it("rejects negative days", () => {
    expect(() => EXANDRIA.toParts(-1)).toThrow(/non-negative/);
  });
});

describe("fromParts", () => {
  it("round-trips every day of a full year", () => {
    for (let day = 0; day < 328 * 2; day++) {
      expect(EXANDRIA.fromParts(EXANDRIA.toParts(day))).toBe(day);
    }
  });
  it("rejects a day beyond the month length", () => {
    // Horisal has 29 days.
    expect(() => EXANDRIA.fromParts({ year: 843, monthIndex: 0, dayOfMonth: 30 })).toThrow(/dayOfMonth/);
  });
  it("rejects an out-of-range month", () => {
    expect(() => EXANDRIA.fromParts({ year: 843, monthIndex: 11, dayOfMonth: 1 })).toThrow(/monthIndex/);
  });
  it("rejects a negative year", () => {
    expect(() => EXANDRIA.fromParts({ year: -1, monthIndex: 0, dayOfMonth: 1 })).toThrow(/year/);
  });
});

describe("formatInWorldDay", () => {
  it("renders ordinal, month, year and epoch label", () => {
    const day = EXANDRIA.fromParts({ year: 843, monthIndex: 7, dayOfMonth: 13 });
    expect(formatInWorldDay(day, "P.D.")).toBe("13th of Fessuran, 843 P.D.");
  });
  it("uses st/nd/rd suffixes", () => {
    expect(formatInWorldDay(EXANDRIA.fromParts({ year: 1, monthIndex: 0, dayOfMonth: 1 }), "P.D.")).toContain("1st of Horisal");
    expect(formatInWorldDay(EXANDRIA.fromParts({ year: 1, monthIndex: 0, dayOfMonth: 2 }), "P.D.")).toContain("2nd of Horisal");
    expect(formatInWorldDay(EXANDRIA.fromParts({ year: 1, monthIndex: 0, dayOfMonth: 3 }), "P.D.")).toContain("3rd of Horisal");
  });
  it("uses th for the 11th through 13th", () => {
    for (const d of [11, 12, 13]) {
      expect(formatInWorldDay(EXANDRIA.fromParts({ year: 1, monthIndex: 0, dayOfMonth: d }), "P.D.")).toContain(`${d}th`);
    }
  });
  it("tolerates an empty epoch label without a trailing space", () => {
    expect(formatInWorldDay(0, "")).toBe("1st of Horisal, 0");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/calendar/exandria.test.ts`
Expected: FAIL — `Failed to resolve import "./exandria"`.

- [ ] **Step 3: Write the implementation**

Create `lib/calendar/exandria.ts`:

```ts
export interface CalendarMonth {
  name: string;
  days: number;
}

export interface CalendarDate {
  year: number;
  monthIndex: number; // 0-based
  dayOfMonth: number; // 1-based
}

/**
 * An in-world calendar. Days are stored everywhere as a non-negative integer
 * absolute day number so that all date math is integer math; this interface is
 * the only place that knows how to render one.
 */
export interface Calendar {
  readonly daysInYear: number;
  readonly months: ReadonlyArray<CalendarMonth>;
  toParts(day: number): CalendarDate;
  fromParts(parts: CalendarDate): number;
}

// The Calendar of Exandria: 11 months, 328 days, no leap year.
const MONTHS: ReadonlyArray<CalendarMonth> = [
  { name: "Horisal", days: 29 },
  { name: "Misuthar", days: 30 },
  { name: "Dualahei", days: 30 },
  { name: "Thunsheer", days: 31 },
  { name: "Unndilar", days: 28 },
  { name: "Brussendar", days: 31 },
  { name: "Sydenstar", days: 32 },
  { name: "Fessuran", days: 29 },
  { name: "Quen'pillar", days: 27 },
  { name: "Cuersaar", days: 29 },
  { name: "Duscar", days: 32 },
];

const DAYS_IN_YEAR = MONTHS.reduce((n, m) => n + m.days, 0);

export const EXANDRIA: Calendar = {
  daysInYear: DAYS_IN_YEAR,
  months: MONTHS,

  toParts(day: number): CalendarDate {
    if (!Number.isInteger(day) || day < 0) {
      throw new Error(`in-world day must be a non-negative integer, got ${day}`);
    }
    const year = Math.floor(day / DAYS_IN_YEAR);
    let rem = day - year * DAYS_IN_YEAR;
    for (let monthIndex = 0; monthIndex < MONTHS.length; monthIndex++) {
      const month = MONTHS[monthIndex];
      if (rem < month.days) return { year, monthIndex, dayOfMonth: rem + 1 };
      rem -= month.days;
    }
    // Unreachable: rem < DAYS_IN_YEAR by construction.
    throw new Error(`could not resolve day ${day}`);
  },

  fromParts({ year, monthIndex, dayOfMonth }: CalendarDate): number {
    if (!Number.isInteger(year) || year < 0) {
      throw new Error(`year must be a non-negative integer, got ${year}`);
    }
    if (!Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex >= MONTHS.length) {
      throw new Error(`monthIndex must be 0..${MONTHS.length - 1}, got ${monthIndex}`);
    }
    const month = MONTHS[monthIndex];
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > month.days) {
      throw new Error(`dayOfMonth must be 1..${month.days} for ${month.name}, got ${dayOfMonth}`);
    }
    let day = year * DAYS_IN_YEAR + (dayOfMonth - 1);
    for (let i = 0; i < monthIndex; i++) day += MONTHS[i].days;
    return day;
  },
};

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** "13th of Fessuran, 843 P.D." */
export function formatInWorldDay(day: number, epochLabel: string): string {
  const { year, monthIndex, dayOfMonth } = EXANDRIA.toParts(day);
  const base = `${ordinal(dayOfMonth)} of ${EXANDRIA.months[monthIndex].name}, ${year}`;
  return epochLabel ? `${base} ${epochLabel}` : base;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/calendar/exandria.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/calendar/exandria.ts lib/calendar/exandria.test.ts
git commit -m "feat(state): Exandrian calendar with integer day math"
```

---

### Task 2: Schema and migrations

Five tables plus two `campaigns` columns. No behavior yet — this task is verified by the migration running clean and the drizzle types compiling.

**Files:**
- Modify: `lib/db/schema.ts` (append after the existing `mapMarkers` / reference tables)
- Modify: `lib/db/migrate.ts` (add to the `sqlite.exec()` block, and add `addColumnIfMissing` calls)
- Test: `lib/state/schema.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `lib/state/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/notion/test-helpers";
import { threads, threadLinks, clocks, timelineEvents, sessionReviews, campaigns } from "@/lib/db/schema";

describe("campaign state schema", () => {
  it("stores a thread with links and cascades the link on thread delete", () => {
    const { db, campaignId } = createTestDb();
    const now = new Date();

    db.insert(threads).values({
      id: "t1", campaignId, title: "Who hired the assassins?", stakes: "The party stays hunted.",
      status: "open", openedOnDay: 100, lastTouchedDay: 100, createdAt: now, updatedAt: now,
    }).run();

    db.insert(threadLinks).values({
      id: "tl1", threadId: "t1", targetKind: "faction", targetId: "f1", role: "stakeholder",
    }).run();

    expect(db.select().from(threadLinks).where(eq(threadLinks.threadId, "t1")).all()).toHaveLength(1);

    db.delete(threads).where(eq(threads.id, "t1")).run();
    expect(db.select().from(threadLinks).where(eq(threadLinks.threadId, "t1")).all()).toHaveLength(0);
  });

  it("stores a clock, a timeline event, and a session review", () => {
    const { db, campaignId } = createTestDb();
    const now = new Date();

    db.insert(clocks).values({
      id: "c1", campaignId, name: "Assembly investigation", segments: 8, filled: 3,
      ownerKind: "faction", ownerId: "f1", cadenceDays: 7, lastTickedDay: 100,
      status: "running", payoff: "They identify the party.", createdAt: now, updatedAt: now,
    }).run();
    expect(db.select().from(clocks).all()[0].filled).toBe(3);

    db.insert(timelineEvents).values({
      id: "e1", campaignId, day: 107, kind: "clock_ticked", title: "Assembly investigation +1",
      sourceKind: "cadence", clockId: "c1", createdAt: now,
    }).run();
    expect(db.select().from(timelineEvents).all()[0].sourceKind).toBe("cadence");

    db.insert(sessionReviews).values({
      id: "r1", sessionNoteId: "s1", reviewedAt: now, contentHash: "abc", proposalCount: 4,
    }).run();
    expect(db.select().from(sessionReviews).all()[0].proposalCount).toBe(4);
  });

  it("defaults campaigns.inWorldDay to null and accepts an epoch label", () => {
    const { db, campaignId } = createTestDb();
    const row = db.select().from(campaigns).where(eq(campaigns.id, campaignId)).all()[0];
    expect(row.inWorldDay).toBeNull();

    db.update(campaigns).set({ inWorldDay: 276_000, calendarEpochLabel: "P.D." }).where(eq(campaigns.id, campaignId)).run();
    const updated = db.select().from(campaigns).where(eq(campaigns.id, campaignId)).all()[0];
    expect(updated.inWorldDay).toBe(276_000);
    expect(updated.calendarEpochLabel).toBe("P.D.");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/state/schema.test.ts`
Expected: FAIL — `threads` (and the other names) are not exported from `@/lib/db/schema`.

- [ ] **Step 3: Add the drizzle tables**

Append to `lib/db/schema.ts`:

```ts
export const threads = sqliteTable("threads", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  stakes: text("stakes"),
  // open | dormant | resolved | abandoned. Set manually; nothing auto-dormants on staleness.
  status: text("status").notNull().default("open"),
  openedSessionId: text("opened_session_id"),
  resolvedSessionId: text("resolved_session_id"),
  openedOnDay: integer("opened_on_day"),
  lastTouchedDay: integer("last_touched_day"),
  notes: text("notes"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const threadLinks = sqliteTable("thread_links", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull().references(() => threads.id, { onDelete: "cascade" }),
  // character | location | item | faction | session
  targetKind: text("target_kind").notNull(),
  targetId: text("target_id").notNull(),
  // subject | stakeholder | obstacle
  role: text("role").notNull().default("subject"),
});

export const clocks = sqliteTable("clocks", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  segments: integer("segments").notNull().default(8),
  filled: integer("filled").notNull().default(0),
  // faction | location | thread | null
  ownerKind: text("owner_kind"),
  ownerId: text("owner_id"),
  // in-world days per automatic tick; null = manual only
  cadenceDays: integer("cadence_days"),
  lastTickedDay: integer("last_ticked_day"),
  // running | paused | complete
  status: text("status").notNull().default("running"),
  payoff: text("payoff"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const timelineEvents = sqliteTable("timeline_events", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  day: integer("day").notNull(),
  // thread_opened | thread_resolved | clock_ticked | clock_completed | date_advanced | session_played | note
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  // manual | proposal | cadence
  sourceKind: text("source_kind").notNull().default("manual"),
  threadId: text("thread_id"),
  clockId: text("clock_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const sessionReviews = sqliteTable("session_reviews", {
  id: text("id").primaryKey(),
  sessionNoteId: text("session_note_id").notNull(),
  reviewedAt: integer("reviewed_at", { mode: "timestamp" }).notNull(),
  contentHash: text("content_hash").notNull(),
  proposalCount: integer("proposal_count").notNull().default(0),
});
```

Then add the two columns to the existing `campaigns` table definition in the same file:

```ts
export const campaigns = sqliteTable("campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  inWorldDay: integer("in_world_day"),
  calendarEpochLabel: text("calendar_epoch_label"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
```

**Note on the nullable fks:** `openedSessionId`, `resolvedSessionId`, `threadLinks.targetId`, `timelineEvents.threadId` and `.clockId` are deliberately plain `text` with no `.references()`. `targetId` is polymorphic so it cannot have one; the session and timeline columns are left unconstrained so that deleting a session note or a clock does not cascade away thread history. Reads must tolerate a dangling id — every consumer in this plan does.

- [ ] **Step 4: Add the raw SQL migration**

In `lib/db/migrate.ts`, add to the end of the big `sqlite.exec(\`...\`)` template literal (before the closing backtick):

```sql
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      stakes TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      opened_session_id TEXT,
      resolved_session_id TEXT,
      opened_on_day INTEGER,
      last_touched_day INTEGER,
      notes TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS thread_links (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'subject'
    );

    CREATE TABLE IF NOT EXISTS clocks (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      segments INTEGER NOT NULL DEFAULT 8,
      filled INTEGER NOT NULL DEFAULT 0,
      owner_kind TEXT,
      owner_id TEXT,
      cadence_days INTEGER,
      last_ticked_day INTEGER,
      status TEXT NOT NULL DEFAULT 'running',
      payoff TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS timeline_events (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      day INTEGER NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      source_kind TEXT NOT NULL DEFAULT 'manual',
      thread_id TEXT,
      clock_id TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_reviews (
      id TEXT PRIMARY KEY,
      session_note_id TEXT NOT NULL,
      reviewed_at INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      proposal_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_threads_campaign ON threads(campaign_id, status);
    CREATE INDEX IF NOT EXISTS idx_thread_links_thread ON thread_links(thread_id);
    CREATE INDEX IF NOT EXISTS idx_thread_links_target ON thread_links(target_kind, target_id);
    CREATE INDEX IF NOT EXISTS idx_clocks_campaign ON clocks(campaign_id, status);
    CREATE INDEX IF NOT EXISTS idx_timeline_campaign_day ON timeline_events(campaign_id, day);
    CREATE INDEX IF NOT EXISTS idx_session_reviews_note ON session_reviews(session_note_id, reviewed_at);
```

Then, in the "Additive migrations" section alongside the existing `addColumnIfMissing` calls:

```ts
  addColumnIfMissing("campaigns", "in_world_day", "INTEGER");
  addColumnIfMissing("campaigns", "calendar_epoch_label", "TEXT");
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/state/schema.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Verify the whole suite and types still pass**

Run: `npm test && npx tsc --noEmit`
Expected: all existing tests pass; no type errors.

- [ ] **Step 7: Commit**

```bash
git add lib/db/schema.ts lib/db/migrate.ts lib/state/schema.test.ts
git commit -m "feat(state): threads, clocks, timeline, session review tables"
```

---

# Phase 2 — Engine 1 (deterministic, no AI)

### Task 3: Cadence computation

The arithmetic that decides which clocks are due. Pure — no db, no clock reading, no model. This is the single most important thing to get right, because it is what makes "the world moves" true.

**Files:**
- Create: `lib/state/cadence.ts`
- Test: `lib/state/cadence.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/state/cadence.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeDueTicks, type ClockLike } from "./cadence";

const clock = (over: Partial<ClockLike> = {}): ClockLike => ({
  id: "c1",
  name: "Assembly investigation",
  segments: 8,
  filled: 0,
  cadenceDays: 7,
  lastTickedDay: 100,
  status: "running",
  ...over,
});

describe("computeDueTicks", () => {
  it("returns nothing before a full cadence period has elapsed", () => {
    expect(computeDueTicks([clock()], 106)).toEqual([]);
  });

  it("ticks once at exactly one cadence period", () => {
    const [due] = computeDueTicks([clock()], 107);
    expect(due).toMatchObject({ clockId: "c1", ticks: 1, elapsedDays: 7, fromFilled: 0, toFilled: 1 });
  });

  it("ticks multiple times over a long jump", () => {
    const [due] = computeDueTicks([clock()], 100 + 7 * 3);
    expect(due.ticks).toBe(3);
    expect(due.toFilled).toBe(3);
  });

  it("preserves remainder credit in nextLastTickedDay", () => {
    // 20 days elapsed on a 7-day clock = 2 ticks, 6 days of credit toward the third.
    const [due] = computeDueTicks([clock()], 120);
    expect(due.ticks).toBe(2);
    expect(due.nextLastTickedDay).toBe(114); // 100 + 2*7 — NOT 120
  });

  it("caps ticks at the remaining segments and flags completion", () => {
    const [due] = computeDueTicks([clock({ filled: 6, segments: 8 })], 100 + 7 * 10);
    expect(due.rawTicks).toBe(10);
    expect(due.ticks).toBe(2);
    expect(due.toFilled).toBe(8);
    expect(due.completes).toBe(true);
  });

  it("does not flag completion when the clock stays short of full", () => {
    const [due] = computeDueTicks([clock({ filled: 1 })], 114);
    expect(due.completes).toBe(false);
  });

  it("skips paused and complete clocks", () => {
    expect(computeDueTicks([clock({ status: "paused" })], 200)).toEqual([]);
    expect(computeDueTicks([clock({ status: "complete" })], 200)).toEqual([]);
  });

  it("skips clocks with no cadence", () => {
    expect(computeDueTicks([clock({ cadenceDays: null })], 200)).toEqual([]);
  });

  it("skips a non-positive cadence rather than dividing by zero", () => {
    expect(computeDueTicks([clock({ cadenceDays: 0 })], 200)).toEqual([]);
    expect(computeDueTicks([clock({ cadenceDays: -7 })], 200)).toEqual([]);
  });

  it("skips an already-full clock even if it is still marked running", () => {
    expect(computeDueTicks([clock({ filled: 8, segments: 8 })], 200)).toEqual([]);
  });

  it("treats a null lastTickedDay as never ticked and does not tick it", () => {
    expect(computeDueTicks([clock({ lastTickedDay: null })], 200)).toEqual([]);
  });

  it("handles several clocks independently", () => {
    const due = computeDueTicks(
      [clock({ id: "a", cadenceDays: 7 }), clock({ id: "b", cadenceDays: 30 }), clock({ id: "c", status: "paused" })],
      130,
    );
    expect(due.map((d) => d.clockId)).toEqual(["a", "b"]);
    expect(due[0].ticks).toBe(4);
    expect(due[1].ticks).toBe(1);
  });
});

describe("declinedLastTickedDay", () => {
  it("skips a declined tick forward so it is not re-proposed", async () => {
    const { declinedLastTickedDay } = await import("./cadence");
    expect(declinedLastTickedDay(120)).toBe(120);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/state/cadence.test.ts`
Expected: FAIL — `Failed to resolve import "./cadence"`.

- [ ] **Step 3: Write the implementation**

Create `lib/state/cadence.ts`:

```ts
export type ClockStatus = "running" | "paused" | "complete";

export interface ClockLike {
  id: string;
  name: string;
  segments: number;
  filled: number;
  cadenceDays: number | null;
  lastTickedDay: number | null;
  status: ClockStatus;
}

export interface DueTick {
  clockId: string;
  name: string;
  /** Ticks that will actually be applied, capped by the remaining segments. */
  ticks: number;
  /** Cadence periods elapsed, uncapped — shown so the DM can see a clock overshot. */
  rawTicks: number;
  elapsedDays: number;
  fromFilled: number;
  toFilled: number;
  /**
   * lastTickedDay advances by whole cadence periods, never to toDay: advancing
   * 20 days on a 7-day clock yields 2 ticks and leaves 6 days of credit toward
   * the third. Setting it to toDay would silently discard that remainder.
   */
  nextLastTickedDay: number;
  completes: boolean;
}

/**
 * Which running, cadence-bearing clocks are due at `toDay`. Pure: callers read
 * the clocks and persist the result.
 */
export function computeDueTicks(clocks: ClockLike[], toDay: number): DueTick[] {
  const due: DueTick[] = [];

  for (const c of clocks) {
    if (c.status !== "running") continue;
    if (c.cadenceDays === null || c.cadenceDays <= 0) continue;
    if (c.lastTickedDay === null) continue;

    const remaining = c.segments - c.filled;
    if (remaining <= 0) continue;

    const elapsedDays = toDay - c.lastTickedDay;
    if (elapsedDays < c.cadenceDays) continue;

    const rawTicks = Math.floor(elapsedDays / c.cadenceDays);
    const ticks = Math.min(rawTicks, remaining);

    due.push({
      clockId: c.id,
      name: c.name,
      ticks,
      rawTicks,
      elapsedDays,
      fromFilled: c.filled,
      toFilled: c.filled + ticks,
      nextLastTickedDay: c.lastTickedDay + ticks * c.cadenceDays,
      completes: c.filled + ticks >= c.segments,
    });
  }

  return due;
}

/**
 * Where a *declined* tick leaves lastTickedDay. A declined tick is skipped, not
 * deferred: it jumps to the new current day so the same tick is not re-proposed
 * on every subsequent advance.
 */
export function declinedLastTickedDay(toDay: number): number {
  return toDay;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/state/cadence.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/state/cadence.ts lib/state/cadence.test.ts
git commit -m "feat(state): cadence tick computation with remainder credit"
```

---

### Task 4: Timeline event helper and threads repo

**Files:**
- Create: `lib/state/timeline.ts`
- Create: `lib/state/threads.ts`
- Test: `lib/state/threads.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/state/threads.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/notion/test-helpers";
import { threads, threadLinks, timelineEvents } from "@/lib/db/schema";
import { createThread, updateThread, listThreads, listThreadsForTarget } from "./threads";

describe("createThread", () => {
  it("creates an open thread stamped with the current in-world day and logs an event", async () => {
    const { db, campaignId } = createTestDb();
    const t = await createThread(db, {
      campaignId, title: "Who hired the assassins?", stakes: "The party stays hunted.", currentDay: 100,
    });

    expect(t.status).toBe("open");
    expect(t.openedOnDay).toBe(100);
    expect(t.lastTouchedDay).toBe(100);

    const events = db.select().from(timelineEvents).all();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "thread_opened", sourceKind: "manual", threadId: t.id });
  });

  it("records the requested source kind on the event", async () => {
    const { db, campaignId } = createTestDb();
    await createThread(db, { campaignId, title: "T", currentDay: 5, sourceKind: "proposal" });
    expect(db.select().from(timelineEvents).all()[0].sourceKind).toBe("proposal");
  });

  it("persists links", async () => {
    const { db, campaignId } = createTestDb();
    const t = await createThread(db, {
      campaignId, title: "T", currentDay: 5,
      links: [{ targetKind: "faction", targetId: "f1", role: "stakeholder" }],
    });
    const links = db.select().from(threadLinks).where(eq(threadLinks.threadId, t.id)).all();
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ targetKind: "faction", targetId: "f1", role: "stakeholder" });
  });

  it("rejects a blank title", async () => {
    const { db, campaignId } = createTestDb();
    await expect(createThread(db, { campaignId, title: "   ", currentDay: 5 })).rejects.toThrow(/title/);
  });

  it("tolerates a null current day before the campaign date is set", async () => {
    const { db, campaignId } = createTestDb();
    const t = await createThread(db, { campaignId, title: "T", currentDay: null });
    expect(t.openedOnDay).toBeNull();
    // No in-world day means no timeline position, so no event is written.
    expect(db.select().from(timelineEvents).all()).toHaveLength(0);
  });
});

describe("updateThread", () => {
  it("resolving writes a thread_resolved event and stamps the day", async () => {
    const { db, campaignId } = createTestDb();
    const t = await createThread(db, { campaignId, title: "T", currentDay: 100 });

    const updated = await updateThread(db, t.id, { status: "resolved", currentDay: 120, resolvedSessionId: "s9" });
    expect(updated.status).toBe("resolved");
    expect(updated.lastTouchedDay).toBe(120);
    expect(updated.resolvedSessionId).toBe("s9");

    const kinds = db.select().from(timelineEvents).all().map((e) => e.kind);
    expect(kinds).toEqual(["thread_opened", "thread_resolved"]);
  });

  it("a non-status edit touches the day without writing a resolve event", async () => {
    const { db, campaignId } = createTestDb();
    const t = await createThread(db, { campaignId, title: "T", currentDay: 100 });
    await updateThread(db, t.id, { title: "T2", currentDay: 110 });

    expect(db.select().from(timelineEvents).all()).toHaveLength(1);
    const row = db.select().from(threads).where(eq(threads.id, t.id)).all()[0];
    expect(row.title).toBe("T2");
    expect(row.lastTouchedDay).toBe(110);
  });

  it("rejects an unknown status", async () => {
    const { db, campaignId } = createTestDb();
    const t = await createThread(db, { campaignId, title: "T", currentDay: 1 });
    await expect(updateThread(db, t.id, { status: "banana" as never, currentDay: 2 })).rejects.toThrow(/status/);
  });

  it("throws on a missing thread", async () => {
    const { db } = createTestDb();
    await expect(updateThread(db, "nope", { title: "x", currentDay: 1 })).rejects.toThrow(/not found/i);
  });
});

describe("listThreads", () => {
  it("orders open threads by staleness, most stale first", async () => {
    const { db, campaignId } = createTestDb();
    await createThread(db, { campaignId, title: "fresh", currentDay: 190 });
    await createThread(db, { campaignId, title: "stale", currentDay: 100 });
    await createThread(db, { campaignId, title: "middling", currentDay: 150 });

    const rows = await listThreads(db, campaignId, { currentDay: 200 });
    expect(rows.map((r) => r.title)).toEqual(["stale", "middling", "fresh"]);
    expect(rows[0].daysUntouched).toBe(100);
  });

  it("excludes resolved and archived threads unless asked", async () => {
    const { db, campaignId } = createTestDb();
    const a = await createThread(db, { campaignId, title: "open", currentDay: 10 });
    const b = await createThread(db, { campaignId, title: "done", currentDay: 10 });
    await updateThread(db, b.id, { status: "resolved", currentDay: 11 });

    expect((await listThreads(db, campaignId, { currentDay: 20 })).map((r) => r.id)).toEqual([a.id]);
    expect((await listThreads(db, campaignId, { currentDay: 20, includeResolved: true })).map((r) => r.title).sort())
      .toEqual(["done", "open"]);
  });

  it("attaches links", async () => {
    const { db, campaignId } = createTestDb();
    await createThread(db, {
      campaignId, title: "T", currentDay: 10,
      links: [{ targetKind: "faction", targetId: "f1", role: "obstacle" }],
    });
    const [row] = await listThreads(db, campaignId, { currentDay: 10 });
    expect(row.links).toEqual([{ targetKind: "faction", targetId: "f1", role: "obstacle" }]);
  });

  it("reports null staleness when there is no current day", async () => {
    const { db, campaignId } = createTestDb();
    await createThread(db, { campaignId, title: "T", currentDay: null });
    const [row] = await listThreads(db, campaignId, { currentDay: null });
    expect(row.daysUntouched).toBeNull();
  });
});

describe("listThreadsForTarget", () => {
  it("finds open threads linked to an entity", async () => {
    const { db, campaignId } = createTestDb();
    await createThread(db, {
      campaignId, title: "Assembly hunts them", currentDay: 10,
      links: [{ targetKind: "faction", targetId: "f1", role: "stakeholder" }],
    });
    await createThread(db, { campaignId, title: "unrelated", currentDay: 10 });

    const rows = await listThreadsForTarget(db, campaignId, "faction", "f1", 20);
    expect(rows.map((r) => r.title)).toEqual(["Assembly hunts them"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/state/threads.test.ts`
Expected: FAIL — `Failed to resolve import "./threads"`.

- [ ] **Step 3: Write the timeline helper**

Create `lib/state/timeline.ts`:

```ts
import { timelineEvents } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import type { StateDb } from "./types";

export type TimelineKind =
  | "thread_opened"
  | "thread_resolved"
  | "clock_ticked"
  | "clock_completed"
  | "date_advanced"
  | "session_played"
  | "note";

export type SourceKind = "manual" | "proposal" | "cadence";

export interface RecordEventInput {
  campaignId: string;
  day: number | null;
  kind: TimelineKind;
  title: string;
  body?: string | null;
  sourceKind?: SourceKind;
  threadId?: string | null;
  clockId?: string | null;
}

/**
 * Append one timeline event. A null `day` means the campaign has no in-world
 * date yet, so the event has no position on the timeline and is skipped rather
 * than being written at a fabricated day 0.
 */
export async function recordEvent(db: StateDb, input: RecordEventInput): Promise<void> {
  if (input.day === null) return;
  await db.insert(timelineEvents).values({
    id: generateId(),
    campaignId: input.campaignId,
    day: input.day,
    kind: input.kind,
    title: input.title,
    body: input.body ?? null,
    sourceKind: input.sourceKind ?? "manual",
    threadId: input.threadId ?? null,
    clockId: input.clockId ?? null,
    createdAt: new Date(),
  });
}
```

Create `lib/state/types.ts` (shared db type, so every state module agrees):

```ts
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "@/lib/db/schema";

/** Matches AppDb in lib/assistant/read-tools.ts — same drizzle instance shape. */
export type StateDb = BetterSQLite3Database<typeof schema>;
```

- [ ] **Step 4: Write the threads repo**

Create `lib/state/threads.ts`:

```ts
import { and, eq, inArray } from "drizzle-orm";
import { threads, threadLinks } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { recordEvent, type SourceKind } from "./timeline";
import type { StateDb } from "./types";

export type ThreadStatus = "open" | "dormant" | "resolved" | "abandoned";
export const THREAD_STATUSES: ThreadStatus[] = ["open", "dormant", "resolved", "abandoned"];

export type ThreadTargetKind = "character" | "location" | "item" | "faction" | "session";
export type ThreadLinkRole = "subject" | "stakeholder" | "obstacle";

export interface ThreadLinkInput {
  targetKind: ThreadTargetKind;
  targetId: string;
  role?: ThreadLinkRole;
}

export interface CreateThreadInput {
  campaignId: string;
  title: string;
  stakes?: string | null;
  notes?: string | null;
  openedSessionId?: string | null;
  currentDay: number | null;
  links?: ThreadLinkInput[];
  sourceKind?: SourceKind;
}

export interface UpdateThreadInput {
  title?: string;
  stakes?: string | null;
  notes?: string | null;
  status?: ThreadStatus;
  resolvedSessionId?: string | null;
  currentDay: number | null;
  links?: ThreadLinkInput[];
}

export interface ThreadWithLinks {
  id: string;
  campaignId: string;
  title: string;
  stakes: string | null;
  status: string;
  openedOnDay: number | null;
  lastTouchedDay: number | null;
  notes: string | null;
  openedSessionId: string | null;
  resolvedSessionId: string | null;
  daysUntouched: number | null;
  links: Array<{ targetKind: string; targetId: string; role: string }>;
}

export async function createThread(db: StateDb, input: CreateThreadInput) {
  const title = input.title.trim();
  if (!title) throw new Error("thread title is required");

  const now = new Date();
  const id = generateId();

  const [row] = await db
    .insert(threads)
    .values({
      id,
      campaignId: input.campaignId,
      title,
      stakes: input.stakes ?? null,
      notes: input.notes ?? null,
      status: "open",
      openedSessionId: input.openedSessionId ?? null,
      openedOnDay: input.currentDay,
      lastTouchedDay: input.currentDay,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await writeLinks(db, id, input.links ?? []);

  await recordEvent(db, {
    campaignId: input.campaignId,
    day: input.currentDay,
    kind: "thread_opened",
    title,
    body: input.stakes ?? null,
    sourceKind: input.sourceKind ?? "manual",
    threadId: id,
  });

  return row;
}

export async function updateThread(db: StateDb, id: string, input: UpdateThreadInput) {
  const existing = await db.query.threads.findFirst({ where: eq(threads.id, id) });
  if (!existing) throw new Error(`thread not found: ${id}`);

  if (input.status && !THREAD_STATUSES.includes(input.status)) {
    throw new Error(`invalid thread status: ${input.status}`);
  }

  const [row] = await db
    .update(threads)
    .set({
      title: input.title?.trim() || existing.title,
      stakes: input.stakes === undefined ? existing.stakes : input.stakes,
      notes: input.notes === undefined ? existing.notes : input.notes,
      status: input.status ?? existing.status,
      resolvedSessionId:
        input.resolvedSessionId === undefined ? existing.resolvedSessionId : input.resolvedSessionId,
      lastTouchedDay: input.currentDay ?? existing.lastTouchedDay,
      updatedAt: new Date(),
    })
    .where(eq(threads.id, id))
    .returning();

  if (input.links) {
    await db.delete(threadLinks).where(eq(threadLinks.threadId, id));
    await writeLinks(db, id, input.links);
  }

  if (input.status === "resolved" && existing.status !== "resolved") {
    await recordEvent(db, {
      campaignId: existing.campaignId,
      day: input.currentDay,
      kind: "thread_resolved",
      title: row.title,
      sourceKind: "manual",
      threadId: id,
    });
  }

  return row;
}

export interface ListThreadsOpts {
  currentDay: number | null;
  includeResolved?: boolean;
  includeArchived?: boolean;
}

export async function listThreads(
  db: StateDb,
  campaignId: string,
  opts: ListThreadsOpts,
): Promise<ThreadWithLinks[]> {
  const rows = await db.query.threads.findMany({ where: eq(threads.campaignId, campaignId) });

  const visible = rows.filter((r) => {
    if (!opts.includeArchived && r.archived) return false;
    if (!opts.includeResolved && (r.status === "resolved" || r.status === "abandoned")) return false;
    return true;
  });

  const links = visible.length
    ? await db.query.threadLinks.findMany({ where: inArray(threadLinks.threadId, visible.map((r) => r.id)) })
    : [];

  const decorated = visible.map((r) => ({
    id: r.id,
    campaignId: r.campaignId,
    title: r.title,
    stakes: r.stakes,
    status: r.status,
    openedOnDay: r.openedOnDay,
    lastTouchedDay: r.lastTouchedDay,
    notes: r.notes,
    openedSessionId: r.openedSessionId,
    resolvedSessionId: r.resolvedSessionId,
    daysUntouched:
      opts.currentDay === null || r.lastTouchedDay === null ? null : opts.currentDay - r.lastTouchedDay,
    links: links
      .filter((l) => l.threadId === r.id)
      .map((l) => ({ targetKind: l.targetKind, targetId: l.targetId, role: l.role })),
  }));

  // Most stale first; unknown staleness sinks to the bottom, then by title for stability.
  decorated.sort((a, b) => {
    if (a.daysUntouched === b.daysUntouched) return a.title.localeCompare(b.title);
    if (a.daysUntouched === null) return 1;
    if (b.daysUntouched === null) return -1;
    return b.daysUntouched - a.daysUntouched;
  });

  return decorated;
}

/** Open threads linked to one entity — powers the inline block on detail pages. */
export async function listThreadsForTarget(
  db: StateDb,
  campaignId: string,
  targetKind: ThreadTargetKind,
  targetId: string,
  currentDay: number | null,
): Promise<ThreadWithLinks[]> {
  const matches = await db.query.threadLinks.findMany({
    where: and(eq(threadLinks.targetKind, targetKind), eq(threadLinks.targetId, targetId)),
  });
  if (!matches.length) return [];

  const ids = new Set(matches.map((m) => m.threadId));
  const all = await listThreads(db, campaignId, { currentDay });
  return all.filter((t) => ids.has(t.id));
}

async function writeLinks(db: StateDb, threadId: string, links: ThreadLinkInput[]): Promise<void> {
  for (const link of links) {
    await db.insert(threadLinks).values({
      id: generateId(),
      threadId,
      targetKind: link.targetKind,
      targetId: link.targetId,
      role: link.role ?? "subject",
    });
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/state/threads.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/state/timeline.ts lib/state/types.ts lib/state/threads.ts lib/state/threads.test.ts
git commit -m "feat(state): threads repo with staleness ordering and timeline events"
```

---

### Task 5: Clocks repo

**Files:**
- Create: `lib/state/clocks.ts`
- Test: `lib/state/clocks.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/state/clocks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/notion/test-helpers";
import { clocks, timelineEvents } from "@/lib/db/schema";
import { createClock, updateClock, applyTick, listClocks, type CreateClockInput } from "./clocks";

async function seed(
  db: ReturnType<typeof createTestDb>["db"],
  campaignId: string,
  over: Partial<CreateClockInput> = {},
) {
  return createClock(db, {
    campaignId, name: "Assembly investigation", segments: 8, cadenceDays: 7, currentDay: 100,
    ownerKind: "faction", ownerId: "f1", payoff: "They identify the party.", ...over,
  });
}

describe("createClock", () => {
  it("creates a running clock at zero, stamped with the current day", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId);
    expect(c).toMatchObject({ filled: 0, status: "running", segments: 8, lastTickedDay: 100 });
  });

  it("rejects an unsupported segment count", async () => {
    const { db, campaignId } = createTestDb();
    await expect(seed(db, campaignId, { segments: 7 })).rejects.toThrow(/segments/);
  });

  it("rejects a blank name", async () => {
    const { db, campaignId } = createTestDb();
    await expect(seed(db, campaignId, { name: "  " })).rejects.toThrow(/name/);
  });

  it("rejects a non-positive cadence", async () => {
    const { db, campaignId } = createTestDb();
    await expect(seed(db, campaignId, { cadenceDays: 0 })).rejects.toThrow(/cadenceDays/);
  });

  it("allows a null cadence for a manual-only clock", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId, { cadenceDays: null });
    expect(c.cadenceDays).toBeNull();
  });
});

describe("applyTick", () => {
  it("applies a positive delta and logs a clock_ticked event", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId);

    const out = await applyTick(db, c.id, { delta: 2, currentDay: 114, reason: "Investigators canvassed the docks." });
    expect(out.filled).toBe(2);
    expect(out.status).toBe("running");

    const events = db.select().from(timelineEvents).all();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "clock_ticked", clockId: c.id, sourceKind: "manual" });
    expect(events[0].body).toContain("canvassed");
  });

  it("applies a negative delta", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId);
    await applyTick(db, c.id, { delta: 3, currentDay: 110 });
    const out = await applyTick(db, c.id, { delta: -1, currentDay: 111 });
    expect(out.filled).toBe(2);
  });

  it("marks the clock complete when it fills and logs a second event", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId, { segments: 4 });
    const out = await applyTick(db, c.id, { delta: 4, currentDay: 120 });

    expect(out.filled).toBe(4);
    expect(out.status).toBe("complete");
    expect(db.select().from(timelineEvents).all().map((e) => e.kind))
      .toEqual(["clock_ticked", "clock_completed"]);
  });

  it("rejects a delta that would exceed the segment count", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId, { segments: 4 });
    await expect(applyTick(db, c.id, { delta: 5, currentDay: 120 })).rejects.toThrow(/out of range/);
  });

  it("rejects a delta that would drop below zero", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId);
    await expect(applyTick(db, c.id, { delta: -1, currentDay: 120 })).rejects.toThrow(/out of range/);
  });

  it("rejects a zero or non-integer delta", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId);
    await expect(applyTick(db, c.id, { delta: 0, currentDay: 120 })).rejects.toThrow(/delta/);
    await expect(applyTick(db, c.id, { delta: 1.5, currentDay: 120 })).rejects.toThrow(/delta/);
  });

  it("throws on a missing clock", async () => {
    const { db } = createTestDb();
    await expect(applyTick(db, "nope", { delta: 1, currentDay: 1 })).rejects.toThrow(/not found/i);
  });

  it("advances lastTickedDay to the given nextLastTickedDay when supplied", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId);
    await applyTick(db, c.id, { delta: 2, currentDay: 120, nextLastTickedDay: 114, sourceKind: "cadence" });
    const row = db.select().from(clocks).where(eq(clocks.id, c.id)).all()[0];
    expect(row.lastTickedDay).toBe(114);
    expect(db.select().from(timelineEvents).all()[0].sourceKind).toBe("cadence");
  });
});

describe("updateClock", () => {
  it("pauses a clock", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId);
    const out = await updateClock(db, c.id, { status: "paused" });
    expect(out.status).toBe("paused");
  });

  it("rejects an invalid status", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId);
    await expect(updateClock(db, c.id, { status: "banana" as never })).rejects.toThrow(/status/);
  });

  it("rejects shrinking segments below the filled count", async () => {
    const { db, campaignId } = createTestDb();
    const c = await seed(db, campaignId);
    await applyTick(db, c.id, { delta: 6, currentDay: 150 });
    await expect(updateClock(db, c.id, { segments: 4 })).rejects.toThrow(/segments/);
  });
});

describe("listClocks", () => {
  it("returns running clocks first and skips archived ones", async () => {
    const { db, campaignId } = createTestDb();
    const a = await seed(db, campaignId, { name: "alpha" });
    const b = await seed(db, campaignId, { name: "beta" });
    await updateClock(db, a.id, { status: "paused" });

    const rows = await listClocks(db, campaignId);
    expect(rows.map((r) => r.name)).toEqual(["beta", "alpha"]);
    expect(rows.every((r) => r.id === a.id || r.id === b.id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/state/clocks.test.ts`
Expected: FAIL — `Failed to resolve import "./clocks"`.

- [ ] **Step 3: Write the implementation**

Create `lib/state/clocks.ts`:

```ts
import { eq } from "drizzle-orm";
import { clocks } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { recordEvent, type SourceKind } from "./timeline";
import type { ClockStatus } from "./cadence";
import type { StateDb } from "./types";

export const CLOCK_STATUSES: ClockStatus[] = ["running", "paused", "complete"];
export const CLOCK_SEGMENT_CHOICES = [4, 6, 8, 12] as const;

export type ClockOwnerKind = "faction" | "location" | "thread";

export interface CreateClockInput {
  campaignId: string;
  name: string;
  segments?: number;
  cadenceDays?: number | null;
  ownerKind?: ClockOwnerKind | null;
  ownerId?: string | null;
  payoff?: string | null;
  currentDay: number | null;
}

export interface UpdateClockInput {
  name?: string;
  segments?: number;
  cadenceDays?: number | null;
  ownerKind?: ClockOwnerKind | null;
  ownerId?: string | null;
  payoff?: string | null;
  status?: ClockStatus;
}

export interface ApplyTickInput {
  delta: number;
  currentDay: number | null;
  reason?: string;
  /** Where lastTickedDay should land. Defaults to currentDay. Cadence ticks pass the remainder-preserving value. */
  nextLastTickedDay?: number | null;
  sourceKind?: SourceKind;
}

export async function createClock(db: StateDb, input: CreateClockInput) {
  const name = input.name.trim();
  if (!name) throw new Error("clock name is required");

  const segments = input.segments ?? 8;
  if (!CLOCK_SEGMENT_CHOICES.includes(segments as (typeof CLOCK_SEGMENT_CHOICES)[number])) {
    throw new Error(`segments must be one of ${CLOCK_SEGMENT_CHOICES.join(", ")}, got ${segments}`);
  }

  const cadenceDays = input.cadenceDays ?? null;
  if (cadenceDays !== null && (!Number.isInteger(cadenceDays) || cadenceDays <= 0)) {
    throw new Error(`cadenceDays must be a positive integer or null, got ${cadenceDays}`);
  }

  const now = new Date();
  const [row] = await db
    .insert(clocks)
    .values({
      id: generateId(),
      campaignId: input.campaignId,
      name,
      segments,
      filled: 0,
      ownerKind: input.ownerKind ?? null,
      ownerId: input.ownerId ?? null,
      cadenceDays,
      lastTickedDay: input.currentDay,
      status: "running",
      payoff: input.payoff ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return row;
}

export async function updateClock(db: StateDb, id: string, input: UpdateClockInput) {
  const existing = await db.query.clocks.findFirst({ where: eq(clocks.id, id) });
  if (!existing) throw new Error(`clock not found: ${id}`);

  if (input.status && !CLOCK_STATUSES.includes(input.status)) {
    throw new Error(`invalid clock status: ${input.status}`);
  }

  const segments = input.segments ?? existing.segments;
  if (input.segments !== undefined) {
    if (!CLOCK_SEGMENT_CHOICES.includes(segments as (typeof CLOCK_SEGMENT_CHOICES)[number])) {
      throw new Error(`segments must be one of ${CLOCK_SEGMENT_CHOICES.join(", ")}, got ${segments}`);
    }
    if (segments < existing.filled) {
      throw new Error(`segments (${segments}) cannot be below the filled count (${existing.filled})`);
    }
  }

  const cadenceDays = input.cadenceDays === undefined ? existing.cadenceDays : input.cadenceDays;
  if (cadenceDays !== null && (!Number.isInteger(cadenceDays) || cadenceDays <= 0)) {
    throw new Error(`cadenceDays must be a positive integer or null, got ${cadenceDays}`);
  }

  const [row] = await db
    .update(clocks)
    .set({
      name: input.name?.trim() || existing.name,
      segments,
      cadenceDays,
      ownerKind: input.ownerKind === undefined ? existing.ownerKind : input.ownerKind,
      ownerId: input.ownerId === undefined ? existing.ownerId : input.ownerId,
      payoff: input.payoff === undefined ? existing.payoff : input.payoff,
      status: input.status ?? existing.status,
      updatedAt: new Date(),
    })
    .where(eq(clocks.id, id))
    .returning();

  return row;
}

/**
 * Move a clock by a delta. Deltas only — never an absolute `filled` — so that a
 * caller (including the model, via a proposal) cannot silently reset a clock.
 */
export async function applyTick(db: StateDb, id: string, input: ApplyTickInput) {
  const existing = await db.query.clocks.findFirst({ where: eq(clocks.id, id) });
  if (!existing) throw new Error(`clock not found: ${id}`);

  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new Error(`delta must be a non-zero integer, got ${input.delta}`);
  }

  const next = existing.filled + input.delta;
  if (next < 0 || next > existing.segments) {
    throw new Error(
      `tick out of range: ${existing.filled} + ${input.delta} is outside 0..${existing.segments}`,
    );
  }

  const completes = next >= existing.segments;
  const lastTickedDay =
    input.nextLastTickedDay !== undefined && input.nextLastTickedDay !== null
      ? input.nextLastTickedDay
      : (input.currentDay ?? existing.lastTickedDay);

  const [row] = await db
    .update(clocks)
    .set({
      filled: next,
      status: completes ? "complete" : existing.status === "complete" ? "running" : existing.status,
      lastTickedDay,
      updatedAt: new Date(),
    })
    .where(eq(clocks.id, id))
    .returning();

  const sign = input.delta > 0 ? `+${input.delta}` : `${input.delta}`;
  await recordEvent(db, {
    campaignId: existing.campaignId,
    day: input.currentDay,
    kind: "clock_ticked",
    title: `${existing.name} ${sign} (${next}/${existing.segments})`,
    body: input.reason ?? null,
    sourceKind: input.sourceKind ?? "manual",
    clockId: id,
  });

  if (completes) {
    await recordEvent(db, {
      campaignId: existing.campaignId,
      day: input.currentDay,
      kind: "clock_completed",
      title: `${existing.name} filled`,
      body: existing.payoff ?? null,
      sourceKind: input.sourceKind ?? "manual",
      clockId: id,
    });
  }

  return row;
}

export async function listClocks(db: StateDb, campaignId: string) {
  const rows = await db.query.clocks.findMany({ where: eq(clocks.campaignId, campaignId) });
  const order: Record<string, number> = { running: 0, paused: 1, complete: 2 };
  return rows
    .filter((r) => !r.archived)
    .sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/state/clocks.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/state/clocks.ts lib/state/clocks.test.ts
git commit -m "feat(state): clocks repo with delta-only ticking and range validation"
```

---

### Task 6: Date-advance engine

Ties the calendar, the cadence math, and the clocks repo together. This is the whole of Engine 1.

**Files:**
- Create: `lib/state/advance.ts`
- Test: `lib/state/advance.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/state/advance.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/notion/test-helpers";
import { campaigns, clocks, timelineEvents } from "@/lib/db/schema";
import { createClock } from "./clocks";
import { previewAdvance, applyAdvance, setDate, getCampaignDay } from "./advance";

async function withDate(campaignId: string, db: ReturnType<typeof createTestDb>["db"], day = 100) {
  await setDate(db, campaignId, day, "P.D.");
}

describe("setDate", () => {
  it("sets the in-world day and epoch label without ticking anything", async () => {
    const { db, campaignId } = createTestDb();
    const c = await createClock(db, { campaignId, name: "C", cadenceDays: 7, currentDay: 100 });

    await setDate(db, campaignId, 100, "P.D.");
    await setDate(db, campaignId, 300, "P.D."); // a correction, far in the future

    expect(await getCampaignDay(db, campaignId)).toBe(300);
    const row = db.select().from(clocks).where(eq(clocks.id, c.id)).all()[0];
    expect(row.filled).toBe(0);
    expect(db.select().from(timelineEvents).all()).toHaveLength(0);
  });

  it("rejects a negative or non-integer day", async () => {
    const { db, campaignId } = createTestDb();
    await expect(setDate(db, campaignId, -1, "P.D.")).rejects.toThrow(/non-negative/);
    await expect(setDate(db, campaignId, 1.5, "P.D.")).rejects.toThrow(/non-negative/);
  });
});

describe("previewAdvance", () => {
  it("returns due ticks without mutating anything", async () => {
    const { db, campaignId } = createTestDb();
    await withDate(campaignId, db);
    const c = await createClock(db, { campaignId, name: "Assembly", segments: 8, cadenceDays: 7, currentDay: 100 });

    const preview = await previewAdvance(db, campaignId, 120);
    expect(preview.fromDay).toBe(100);
    expect(preview.toDay).toBe(120);
    expect(preview.dueTicks).toHaveLength(1);
    expect(preview.dueTicks[0]).toMatchObject({ clockId: c.id, ticks: 2, nextLastTickedDay: 114 });

    expect(await getCampaignDay(db, campaignId)).toBe(100);
    expect(db.select().from(clocks).all()[0].filled).toBe(0);
  });

  it("rejects moving time backwards or standing still", async () => {
    const { db, campaignId } = createTestDb();
    await withDate(campaignId, db);
    await expect(previewAdvance(db, campaignId, 99)).rejects.toThrow(/forward/);
    await expect(previewAdvance(db, campaignId, 100)).rejects.toThrow(/forward/);
  });

  it("refuses to advance before the campaign date is set", async () => {
    const { db, campaignId } = createTestDb();
    await expect(previewAdvance(db, campaignId, 100)).rejects.toThrow(/in-world date/);
  });
});

describe("applyAdvance", () => {
  it("applies accepted ticks with remainder-preserving lastTickedDay", async () => {
    const { db, campaignId } = createTestDb();
    await withDate(campaignId, db);
    const c = await createClock(db, { campaignId, name: "Assembly", segments: 8, cadenceDays: 7, currentDay: 100 });

    const result = await applyAdvance(db, campaignId, 120, [c.id]);
    expect(result).toMatchObject({ applied: 1, declined: 0, toDay: 120 });

    const row = db.select().from(clocks).where(eq(clocks.id, c.id)).all()[0];
    expect(row.filled).toBe(2);
    expect(row.lastTickedDay).toBe(114); // remainder credit preserved
    expect(await getCampaignDay(db, campaignId)).toBe(120);
  });

  it("skips a declined tick and jumps its lastTickedDay so it is not re-proposed", async () => {
    const { db, campaignId } = createTestDb();
    await withDate(campaignId, db);
    const c = await createClock(db, { campaignId, name: "Assembly", segments: 8, cadenceDays: 7, currentDay: 100 });

    const result = await applyAdvance(db, campaignId, 120, []); // accepted nothing
    expect(result).toMatchObject({ applied: 0, declined: 1 });

    const row = db.select().from(clocks).where(eq(clocks.id, c.id)).all()[0];
    expect(row.filled).toBe(0);
    expect(row.lastTickedDay).toBe(120);

    // And a second advance proposes nothing new until another full period passes.
    expect((await previewAdvance(db, campaignId, 126)).dueTicks).toEqual([]);
  });

  it("writes a date_advanced event plus one clock_ticked event per applied tick", async () => {
    const { db, campaignId } = createTestDb();
    await withDate(campaignId, db);
    const c = await createClock(db, { campaignId, name: "Assembly", segments: 8, cadenceDays: 7, currentDay: 100 });

    await applyAdvance(db, campaignId, 120, [c.id]);
    const kinds = db.select().from(timelineEvents).all().map((e) => e.kind).sort();
    expect(kinds).toEqual(["clock_ticked", "date_advanced"]);
    expect(db.select().from(timelineEvents).all().every((e) => e.day === 120)).toBe(true);
  });

  it("marks a clock complete and logs completion when it fills mid-jump", async () => {
    const { db, campaignId } = createTestDb();
    await withDate(campaignId, db);
    const c = await createClock(db, { campaignId, name: "Doom", segments: 4, cadenceDays: 7, currentDay: 100 });

    await applyAdvance(db, campaignId, 100 + 7 * 10, [c.id]);
    const row = db.select().from(clocks).where(eq(clocks.id, c.id)).all()[0];
    expect(row.filled).toBe(4);
    expect(row.status).toBe("complete");
    expect(db.select().from(timelineEvents).all().map((e) => e.kind)).toContain("clock_completed");
  });

  it("leaves manual-only and paused clocks entirely alone", async () => {
    const { db, campaignId } = createTestDb();
    await withDate(campaignId, db);
    const manual = await createClock(db, { campaignId, name: "manual", cadenceDays: null, currentDay: 100 });

    await applyAdvance(db, campaignId, 200, []);
    const row = db.select().from(clocks).where(eq(clocks.id, manual.id)).all()[0];
    expect(row.filled).toBe(0);
    expect(row.lastTickedDay).toBe(100); // untouched, not jumped
  });

  it("ignores accepted ids that are not actually due", async () => {
    const { db, campaignId } = createTestDb();
    await withDate(campaignId, db);
    await createClock(db, { campaignId, name: "C", cadenceDays: 7, currentDay: 100 });

    const result = await applyAdvance(db, campaignId, 103, ["not-a-real-clock"]);
    expect(result).toMatchObject({ applied: 0, declined: 0 });
    expect(await getCampaignDay(db, campaignId)).toBe(103);
  });

  it("rejects moving time backwards", async () => {
    const { db, campaignId } = createTestDb();
    await withDate(campaignId, db);
    await expect(applyAdvance(db, campaignId, 50, [])).rejects.toThrow(/forward/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/state/advance.test.ts`
Expected: FAIL — `Failed to resolve import "./advance"`.

- [ ] **Step 3: Write the implementation**

Create `lib/state/advance.ts`:

```ts
import { eq } from "drizzle-orm";
import { campaigns, clocks } from "@/lib/db/schema";
import { computeDueTicks, declinedLastTickedDay, type ClockLike, type DueTick } from "./cadence";
import { applyTick, listClocks } from "./clocks";
import { recordEvent } from "./timeline";
import { formatInWorldDay } from "@/lib/calendar/exandria";
import type { StateDb } from "./types";

export interface AdvancePreview {
  fromDay: number;
  toDay: number;
  dueTicks: DueTick[];
}

export interface AdvanceResult {
  fromDay: number;
  toDay: number;
  applied: number;
  declined: number;
}

export async function getCampaignDay(db: StateDb, campaignId: string): Promise<number | null> {
  const row = await db.query.campaigns.findFirst({ where: eq(campaigns.id, campaignId) });
  return row?.inWorldDay ?? null;
}

export async function getCampaignEpochLabel(db: StateDb, campaignId: string): Promise<string> {
  const row = await db.query.campaigns.findFirst({ where: eq(campaigns.id, campaignId) });
  return row?.calendarEpochLabel ?? "";
}

/**
 * Set the in-world date WITHOUT cadence processing. This is the correction path:
 * fixing a mistyped date must never re-tick clocks, or a typo'd jump followed by
 * a correction would leave clocks permanently over-ticked.
 */
export async function setDate(
  db: StateDb,
  campaignId: string,
  day: number,
  epochLabel: string,
): Promise<void> {
  if (!Number.isInteger(day) || day < 0) {
    throw new Error(`in-world day must be a non-negative integer, got ${day}`);
  }
  await db
    .update(campaigns)
    .set({ inWorldDay: day, calendarEpochLabel: epochLabel })
    .where(eq(campaigns.id, campaignId));
}

async function requireCurrentDay(db: StateDb, campaignId: string, toDay: number): Promise<number> {
  const fromDay = await getCampaignDay(db, campaignId);
  if (fromDay === null) {
    throw new Error("set the campaign's in-world date before advancing time");
  }
  if (!Number.isInteger(toDay) || toDay <= fromDay) {
    throw new Error(`time only moves forward: toDay (${toDay}) must be an integer after ${fromDay}`);
  }
  return fromDay;
}

function toClockLike(row: Awaited<ReturnType<typeof listClocks>>[number]): ClockLike {
  return {
    id: row.id,
    name: row.name,
    segments: row.segments,
    filled: row.filled,
    cadenceDays: row.cadenceDays,
    lastTickedDay: row.lastTickedDay,
    status: row.status as ClockLike["status"],
  };
}

/** What would happen at `toDay`. Read-only. */
export async function previewAdvance(
  db: StateDb,
  campaignId: string,
  toDay: number,
): Promise<AdvancePreview> {
  const fromDay = await requireCurrentDay(db, campaignId, toDay);
  const rows = await listClocks(db, campaignId);
  return { fromDay, toDay, dueTicks: computeDueTicks(rows.map(toClockLike), toDay) };
}

/**
 * Advance the date, applying only the ticks whose clock id appears in
 * `acceptedClockIds`. Declined ticks are skipped, not deferred.
 */
export async function applyAdvance(
  db: StateDb,
  campaignId: string,
  toDay: number,
  acceptedClockIds: string[],
): Promise<AdvanceResult> {
  const fromDay = await requireCurrentDay(db, campaignId, toDay);
  const rows = await listClocks(db, campaignId);
  const due = computeDueTicks(rows.map(toClockLike), toDay);
  const accepted = new Set(acceptedClockIds);

  let applied = 0;
  let declined = 0;

  for (const tick of due) {
    if (accepted.has(tick.clockId)) {
      await applyTick(db, tick.clockId, {
        delta: tick.ticks,
        currentDay: toDay,
        nextLastTickedDay: tick.nextLastTickedDay,
        sourceKind: "cadence",
        reason: `${tick.elapsedDays} in-world days elapsed`,
      });
      applied++;
    } else {
      await db
        .update(clocks)
        .set({ lastTickedDay: declinedLastTickedDay(toDay), updatedAt: new Date() })
        .where(eq(clocks.id, tick.clockId));
      declined++;
    }
  }

  const epochLabel = await getCampaignEpochLabel(db, campaignId);
  await db.update(campaigns).set({ inWorldDay: toDay }).where(eq(campaigns.id, campaignId));

  await recordEvent(db, {
    campaignId,
    day: toDay,
    kind: "date_advanced",
    title: `Time advances to ${formatInWorldDay(toDay, epochLabel)}`,
    body: `${toDay - fromDay} day(s) elapsed. ${applied} clock(s) ticked, ${declined} declined.`,
    sourceKind: "cadence",
  });

  return { fromDay, toDay, applied, declined };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/state/advance.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test && npx tsc --noEmit`
Expected: everything passes.

- [ ] **Step 6: Commit**

```bash
git add lib/state/advance.ts lib/state/advance.test.ts
git commit -m "feat(state): deterministic date-advance engine with preview and apply"
```

---

### Task 7: API routes for threads, clocks, and time

Thin wrappers over Phase 2's repos. No new logic — every branch here delegates. Errors thrown by the repos become 400s.

**Files:**
- Create: `app/api/threads/route.ts`
- Create: `app/api/threads/[id]/route.ts`
- Create: `app/api/clocks/route.ts`
- Create: `app/api/clocks/[id]/route.ts`
- Create: `app/api/clocks/[id]/tick/route.ts`
- Create: `app/api/campaigns/[id]/advance-date/route.ts`
- Create: `app/api/campaigns/[id]/set-date/route.ts`
- Create: `app/api/campaigns/[id]/state/route.ts`

- [ ] **Step 1: Create the threads collection route**

Create `app/api/threads/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createThread, listThreads } from "@/lib/state/threads";
import { getCampaignDay } from "@/lib/state/advance";
import type { StateDb } from "@/lib/state/types";

const sdb = db as unknown as StateDb;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  if (!campaignId) return NextResponse.json({ error: '"campaignId" is required' }, { status: 400 });

  const currentDay = await getCampaignDay(sdb, campaignId);
  const items = await listThreads(sdb, campaignId, {
    currentDay,
    includeResolved: searchParams.get("includeResolved") === "1",
    includeArchived: searchParams.get("includeArchived") === "1",
  });
  return NextResponse.json({ items, currentDay });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (typeof body.campaignId !== "string" || !body.campaignId) {
    return NextResponse.json({ error: '"campaignId" is required and must be a string' }, { status: 400 });
  }
  if (typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: '"title" is required and must be a string' }, { status: 400 });
  }

  try {
    const currentDay = await getCampaignDay(sdb, body.campaignId);
    const thread = await createThread(sdb, {
      campaignId: body.campaignId,
      title: body.title,
      stakes: body.stakes ?? null,
      notes: body.notes ?? null,
      openedSessionId: body.openedSessionId ?? null,
      links: body.links ?? [],
      sourceKind: body.sourceKind === "proposal" ? "proposal" : "manual",
      currentDay,
    });
    return NextResponse.json(thread, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
```

- [ ] **Step 2: Create the single-thread route**

Create `app/api/threads/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { threads, threadLinks } from "@/lib/db/schema";
import { updateThread } from "@/lib/state/threads";
import { getCampaignDay } from "@/lib/state/advance";
import type { StateDb } from "@/lib/state/types";

const sdb = db as unknown as StateDb;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.query.threads.findFirst({ where: eq(threads.id, id) });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const links = await db.query.threadLinks.findMany({ where: eq(threadLinks.threadId, id) });
  return NextResponse.json({ ...row, links });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const existing = await db.query.threads.findFirst({ where: eq(threads.id, id) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const currentDay = await getCampaignDay(sdb, existing.campaignId);
    const row = await updateThread(sdb, id, {
      title: body.title,
      stakes: body.stakes,
      notes: body.notes,
      status: body.status,
      resolvedSessionId: body.resolvedSessionId,
      links: body.links,
      currentDay,
    });
    return NextResponse.json(row);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.delete(threads).where(eq(threads.id, id));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Create the clocks routes**

Create `app/api/clocks/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createClock, listClocks } from "@/lib/state/clocks";
import { getCampaignDay } from "@/lib/state/advance";
import type { StateDb } from "@/lib/state/types";

const sdb = db as unknown as StateDb;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  if (!campaignId) return NextResponse.json({ error: '"campaignId" is required' }, { status: 400 });
  return NextResponse.json({ items: await listClocks(sdb, campaignId) });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (typeof body.campaignId !== "string" || !body.campaignId) {
    return NextResponse.json({ error: '"campaignId" is required and must be a string' }, { status: 400 });
  }
  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: '"name" is required and must be a string' }, { status: 400 });
  }
  try {
    const currentDay = await getCampaignDay(sdb, body.campaignId);
    const clock = await createClock(sdb, {
      campaignId: body.campaignId,
      name: body.name,
      segments: body.segments,
      cadenceDays: body.cadenceDays ?? null,
      ownerKind: body.ownerKind ?? null,
      ownerId: body.ownerId ?? null,
      payoff: body.payoff ?? null,
      currentDay,
    });
    return NextResponse.json(clock, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
```

Create `app/api/clocks/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clocks } from "@/lib/db/schema";
import { updateClock } from "@/lib/state/clocks";
import type { StateDb } from "@/lib/state/types";

const sdb = db as unknown as StateDb;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  try {
    return NextResponse.json(
      await updateClock(sdb, id, {
        name: body.name,
        segments: body.segments,
        cadenceDays: body.cadenceDays,
        ownerKind: body.ownerKind,
        ownerId: body.ownerId,
        payoff: body.payoff,
        status: body.status,
      }),
    );
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: /not found/i.test(msg) ? 404 : 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.delete(clocks).where(eq(clocks.id, id));
  return NextResponse.json({ ok: true });
}
```

Create `app/api/clocks/[id]/tick/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clocks } from "@/lib/db/schema";
import { applyTick } from "@/lib/state/clocks";
import { getCampaignDay } from "@/lib/state/advance";
import type { StateDb } from "@/lib/state/types";

const sdb = db as unknown as StateDb;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const existing = await db.query.clocks.findFirst({ where: eq(clocks.id, id) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const currentDay = await getCampaignDay(sdb, existing.campaignId);
    const row = await applyTick(sdb, id, {
      delta: body.delta,
      reason: body.reason,
      sourceKind: body.sourceKind === "proposal" ? "proposal" : "manual",
      currentDay,
    });
    return NextResponse.json(row);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
```

- [ ] **Step 4: Create the time routes**

Create `app/api/campaigns/[id]/advance-date/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { previewAdvance, applyAdvance } from "@/lib/state/advance";
import type { StateDb } from "@/lib/state/types";

const sdb = db as unknown as StateDb;

/**
 * Without `apply`, this previews and mutates nothing. With
 * `apply: { clockIds }`, it advances the date and applies only those ticks.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  if (typeof body.toDay !== "number") {
    return NextResponse.json({ error: '"toDay" is required and must be a number' }, { status: 400 });
  }

  try {
    if (!body.apply) return NextResponse.json(await previewAdvance(sdb, id, body.toDay));
    const clockIds: string[] = Array.isArray(body.apply.clockIds) ? body.apply.clockIds : [];
    return NextResponse.json(await applyAdvance(sdb, id, body.toDay, clockIds));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
```

Create `app/api/campaigns/[id]/set-date/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { setDate } from "@/lib/state/advance";
import type { StateDb } from "@/lib/state/types";

const sdb = db as unknown as StateDb;

/** Correction path: sets the date with NO cadence processing. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  if (typeof body.day !== "number") {
    return NextResponse.json({ error: '"day" is required and must be a number' }, { status: 400 });
  }

  try {
    await setDate(sdb, id, body.day, typeof body.epochLabel === "string" ? body.epochLabel : "");
    return NextResponse.json({ ok: true, day: body.day });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
```

- [ ] **Step 5: Create the chronicle bootstrap route**

Create `app/api/campaigns/[id]/state/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { timelineEvents } from "@/lib/db/schema";
import { listThreads } from "@/lib/state/threads";
import { listClocks } from "@/lib/state/clocks";
import { getCampaignDay, getCampaignEpochLabel } from "@/lib/state/advance";
import { formatInWorldDay } from "@/lib/calendar/exandria";
import type { StateDb } from "@/lib/state/types";

const sdb = db as unknown as StateDb;

/** Everything /chronicle needs in one round trip. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const includeResolved = searchParams.get("includeResolved") === "1";

  const currentDay = await getCampaignDay(sdb, id);
  const epochLabel = await getCampaignEpochLabel(sdb, id);

  const events = await db.query.timelineEvents.findMany({
    where: eq(timelineEvents.campaignId, id),
    orderBy: [desc(timelineEvents.day), desc(timelineEvents.createdAt)],
    limit: 200,
  });

  return NextResponse.json({
    currentDay,
    epochLabel,
    currentDateLabel: currentDay === null ? null : formatInWorldDay(currentDay, epochLabel),
    threads: await listThreads(sdb, id, { currentDay, includeResolved }),
    clocks: await listClocks(sdb, id),
    events: events.map((e) => ({
      ...e,
      dateLabel: formatInWorldDay(e.day, epochLabel),
    })),
  });
}
```

**Note:** remove the unused `and` import if your editor flags it — `npm run lint` must pass.

- [ ] **Step 6: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 7: Smoke-test the routes in the browser**

Start the dev server via the preview tooling (not `npm run dev` in a shell), then in the browser console:

```js
const c = await (await fetch("/api/campaigns")).json();
const id = c.items?.[0]?.id ?? c[0]?.id;
await (await fetch(`/api/campaigns/${id}/set-date`, {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({day: 276_000, epochLabel: "P.D."})})).json();
await (await fetch("/api/clocks", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({campaignId:id,name:"Test clock",segments:8,cadenceDays:7})})).json();
await (await fetch(`/api/campaigns/${id}/advance-date`, {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({toDay: 276_020})})).json();
```

Expected: the last call returns `dueTicks` with one entry of `ticks: 2` and `nextLastTickedDay: 276014`, and re-fetching the clock shows `filled: 0` (preview did not mutate).

- [ ] **Step 8: Commit**

```bash
git add app/api/threads app/api/clocks app/api/campaigns
git commit -m "feat(state): thread, clock, and in-world time API routes"
```

---

# Phase 3 — Engine 2 (cited AI proposals)

### Task 8: Proposal builders and citation validation

Extends the existing proposal contract. The citation rule is the whole anti-hallucination story: a proposal that cannot quote the session notes verbatim is rejected before it ever reaches the DM.

**Files:**
- Modify: `lib/assistant/proposals.ts`
- Modify: `lib/assistant/proposals.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `lib/assistant/proposals.test.ts`:

```ts
import {
  assertCitation,
  normalizeForCitation,
  buildThreadOpenProposal,
  buildThreadResolveProposal,
  buildClockTickProposal,
  buildDateAdvanceProposal,
} from "./proposals";

const NOTES = `The party cornered Ovid in the Pentamarket. He admitted the contract came
through a broker in Zadash, but died before naming them. Nine days pass on the road east.`;

describe("normalizeForCitation", () => {
  it("lowercases, strips punctuation, and collapses whitespace", () => {
    expect(normalizeForCitation("  He ADMITTED the contract,\n came through!  ")).toBe(
      "he admitted the contract came through",
    );
  });
});

describe("assertCitation", () => {
  it("accepts a verbatim quote", () => {
    expect(() => assertCitation("the contract came through a broker in Zadash", NOTES)).not.toThrow();
  });
  it("accepts a quote differing only in case, punctuation, and line breaks", () => {
    expect(() => assertCitation("He admitted the contract\ncame through a BROKER!", NOTES)).not.toThrow();
  });
  it("rejects a paraphrase that is not in the notes", () => {
    expect(() => assertCitation("Ovid revealed the name of his employer", NOTES)).toThrow(/not found/i);
  });
  it("rejects an empty or too-short citation", () => {
    expect(() => assertCitation("", NOTES)).toThrow(/at least/i);
    expect(() => assertCitation("Ovid died", NOTES)).toThrow(/at least/i);
  });
});

describe("buildThreadOpenProposal", () => {
  it("targets the threads route and carries the citation", () => {
    const p = buildThreadOpenProposal("camp1", {
      title: "Who is the Zadash broker?",
      stakes: "The contract holder is still hunting the party.",
      citation: "the contract came through a broker in Zadash",
      links: [{ targetKind: "location", targetId: "loc-zadash", role: "subject" }],
    }, NOTES);

    expect(p).toMatchObject({ targetRoute: "/api/threads", method: "POST" });
    expect(p.payload).toMatchObject({ campaignId: "camp1", sourceKind: "proposal" });
    expect(p.payload.links).toHaveLength(1);
    expect(p.citation).toContain("broker in Zadash");
    expect(p.summary).toContain("Who is the Zadash broker?");
  });

  it("throws when the citation is not in the notes", () => {
    expect(() =>
      buildThreadOpenProposal("camp1", { title: "T", citation: "totally invented sentence here", links: [] }, NOTES),
    ).toThrow(/not found/i);
  });
});

describe("buildThreadResolveProposal", () => {
  it("PATCHes the thread to resolved", () => {
    const p = buildThreadResolveProposal(
      { threadId: "t1", threadTitle: "Find Ovid", citation: "The party cornered Ovid in the Pentamarket" },
      NOTES,
    );
    expect(p).toMatchObject({ targetRoute: "/api/threads/t1", method: "PATCH" });
    expect(p.payload).toMatchObject({ status: "resolved" });
    expect(p.summary).toContain("Find Ovid");
  });
});

describe("buildClockTickProposal", () => {
  it("sends a delta, never an absolute filled value", () => {
    const p = buildClockTickProposal(
      { clockId: "c1", clockName: "Assembly investigation", delta: 1, reason: "Ovid's death draws attention", citation: "He admitted the contract came through a broker" },
      NOTES,
    );
    expect(p).toMatchObject({ targetRoute: "/api/clocks/c1/tick", method: "POST" });
    expect(p.payload).toMatchObject({ delta: 1, sourceKind: "proposal" });
    expect(p.payload).not.toHaveProperty("filled");
    expect(p.summary).toContain("+1");
  });

  it("rejects a zero or non-integer delta", () => {
    const base = { clockId: "c1", clockName: "C", citation: "the contract came through a broker in Zadash" };
    expect(() => buildClockTickProposal({ ...base, delta: 0 }, NOTES)).toThrow(/delta/);
    expect(() => buildClockTickProposal({ ...base, delta: 1.5 }, NOTES)).toThrow(/delta/);
  });
});

describe("buildDateAdvanceProposal", () => {
  it("proposes a preview, not a blind apply", () => {
    const p = buildDateAdvanceProposal("camp1", { toDay: 276_009, days: 9, citation: "Nine days pass on the road east" }, NOTES);
    expect(p).toMatchObject({ targetRoute: "/api/campaigns/camp1/advance-date", method: "POST" });
    expect(p.payload).toEqual({ toDay: 276_009 });
    expect(p.payload).not.toHaveProperty("apply");
    expect(p.summary).toContain("9");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/assistant/proposals.test.ts`
Expected: FAIL — `assertCitation` and the four builders are not exported.

- [ ] **Step 3: Extend the proposals module**

In `lib/assistant/proposals.ts`, add `citation` to the `Proposal` interface and append the new code:

```ts
export interface Proposal {
  summary: string;
  targetRoute: string;
  method: "POST" | "PATCH";
  payload: Record<string, unknown>;
  /** Verbatim quote from the source the proposal was derived from. Present on review-pass proposals. */
  citation?: string;
}

const MIN_CITATION_WORDS = 4;

/** Case-, punctuation-, and whitespace-insensitive form used for citation matching. */
export function normalizeForCitation(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * A review-pass proposal must quote the source verbatim. Paraphrase is rejected:
 * the failure mode we want is "fewer proposals offered", not "plausible wrong
 * state silently applied". Matching is tolerant of case, punctuation, and line
 * wrapping so that a correct quote copied out of Notion still passes.
 */
export function assertCitation(citation: string, sourceText: string): void {
  const normalized = normalizeForCitation(citation ?? "");
  const words = normalized.split(" ").filter(Boolean);
  if (words.length < MIN_CITATION_WORDS) {
    throw new Error(`citation must quote at least ${MIN_CITATION_WORDS} words from the source`);
  }
  if (!normalizeForCitation(sourceText).includes(normalized)) {
    throw new Error("citation not found verbatim in the source text");
  }
}

export interface ThreadLinkProposalInput {
  targetKind: "character" | "location" | "item" | "faction" | "session";
  targetId: string;
  role?: "subject" | "stakeholder" | "obstacle";
}

export function buildThreadOpenProposal(
  campaignId: string,
  input: { title: string; stakes?: string; notes?: string; links?: ThreadLinkProposalInput[]; citation: string },
  sourceText: string,
): Proposal {
  assertCitation(input.citation, sourceText);
  return {
    summary: `Open thread "${input.title}".`,
    targetRoute: "/api/threads",
    method: "POST",
    citation: input.citation,
    payload: {
      campaignId,
      title: input.title,
      stakes: input.stakes ?? null,
      notes: input.notes ?? null,
      links: input.links ?? [],
      sourceKind: "proposal",
    },
  };
}

export function buildThreadResolveProposal(
  input: { threadId: string; threadTitle: string; resolvedSessionId?: string; citation: string },
  sourceText: string,
): Proposal {
  assertCitation(input.citation, sourceText);
  return {
    summary: `Resolve thread "${input.threadTitle}".`,
    targetRoute: `/api/threads/${input.threadId}`,
    method: "PATCH",
    citation: input.citation,
    payload: { status: "resolved", resolvedSessionId: input.resolvedSessionId ?? null },
  };
}

export function buildClockTickProposal(
  input: { clockId: string; clockName: string; delta: number; reason?: string; citation: string },
  sourceText: string,
): Proposal {
  assertCitation(input.citation, sourceText);
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new Error(`delta must be a non-zero integer, got ${input.delta}`);
  }
  const sign = input.delta > 0 ? `+${input.delta}` : `${input.delta}`;
  return {
    summary: `Tick "${input.clockName}" ${sign}.`,
    targetRoute: `/api/clocks/${input.clockId}/tick`,
    method: "POST",
    citation: input.citation,
    payload: { delta: input.delta, reason: input.reason ?? null, sourceKind: "proposal" },
  };
}

/**
 * Proposes advancing in-world time. The payload is a PREVIEW request (no
 * `apply` key), because which cadence clocks tick is the DM's call, not the
 * model's. The review UI opens the advance dialog seeded with `toDay` rather
 * than POSTing this blind — see the review slide-over.
 */
export function buildDateAdvanceProposal(
  campaignId: string,
  input: { toDay: number; days: number; citation: string },
  sourceText: string,
): Proposal {
  assertCitation(input.citation, sourceText);
  return {
    summary: `Advance in-world time by ${input.days} day(s).`,
    targetRoute: `/api/campaigns/${campaignId}/advance-date`,
    method: "POST",
    citation: input.citation,
    payload: { toDay: input.toDay },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/assistant/proposals.test.ts`
Expected: PASS — the pre-existing cases plus 12 new ones.

- [ ] **Step 5: Commit**

```bash
git add lib/assistant/proposals.ts lib/assistant/proposals.test.ts
git commit -m "feat(state): cited proposal builders for threads, clocks, and time"
```

---

### Task 9: Session-note plain text and content hash

The review pass needs one flattened string — to give the model, to validate citations against, and to hash for the staleness watermark.

**Files:**
- Create: `lib/state/content-hash.ts`
- Test: `lib/state/content-hash.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/state/content-hash.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { blocksToPlainText, hashContent } from "./content-hash";
import type { NotionBlockData } from "@/lib/notion/client";

const block = (type: string, text: string): NotionBlockData => ({
  id: `${type}-${text.slice(0, 4)}`,
  type,
  richText: [{ text }],
});

describe("blocksToPlainText", () => {
  it("joins block text with newlines", () => {
    const out = blocksToPlainText([block("heading_1", "The Pentamarket"), block("paragraph", "Ovid ran.")]);
    expect(out).toBe("The Pentamarket\nOvid ran.");
  });

  it("concatenates rich-text runs within one block", () => {
    const out = blocksToPlainText([{ id: "b", type: "paragraph", richText: [{ text: "He " }, { text: "admitted it." }] }]);
    expect(out).toBe("He admitted it.");
  });

  it("skips blocks with no text", () => {
    const out = blocksToPlainText([block("paragraph", "kept"), { id: "d", type: "divider" }, { id: "i", type: "image", imageUrl: "x" }]);
    expect(out).toBe("kept");
  });

  it("returns an empty string for no blocks", () => {
    expect(blocksToPlainText([])).toBe("");
  });
});

describe("hashContent", () => {
  it("is stable for identical text", () => {
    expect(hashContent("abc")).toBe(hashContent("abc"));
  });
  it("differs for different text", () => {
    expect(hashContent("abc")).not.toBe(hashContent("abd"));
  });
  it("ignores leading and trailing whitespace differences", () => {
    expect(hashContent("  abc\n")).toBe(hashContent("abc"));
  });
  it("returns a hex digest", () => {
    expect(hashContent("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/state/content-hash.test.ts`
Expected: FAIL — `Failed to resolve import "./content-hash"`.

- [ ] **Step 3: Write the implementation**

Create `lib/state/content-hash.ts`:

```ts
import { createHash } from "crypto";
import type { NotionBlockData } from "@/lib/notion/client";

/** Flatten Notion blocks into the plain text the review pass reads and cites against. */
export function blocksToPlainText(blocks: NotionBlockData[]): string {
  return blocks
    .map((b) => (b.richText ?? []).map((r) => r.text).join(""))
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

/** Stable content watermark. Trimmed so trailing-newline churn does not invalidate a review. */
export function hashContent(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/state/content-hash.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/state/content-hash.ts lib/state/content-hash.test.ts
git commit -m "feat(state): session-note plain text flattening and content hash"
```

---

### Task 10: Review tools

The tool surface the review pass gives the model: read the current state, then propose. Every propose tool returns a `{proposal}` object or a `{rejected}` object — it never mutates and never throws out to the runner, so a bad citation costs the model one turn instead of killing the pass.

**Files:**
- Create: `lib/state/review-tools.ts`
- Test: `lib/state/review-tools.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/state/review-tools.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/lib/notion/test-helpers";
import { buildReviewTools } from "./review-tools";
import { createThread } from "./threads";
import { createClock } from "./clocks";
import { setDate } from "./advance";

const NOTES = `The party cornered Ovid in the Pentamarket. He admitted the contract came
through a broker in Zadash, but died before naming them. Nine days pass on the road east.`;

async function ctx() {
  const { db, campaignId } = createTestDb();
  await setDate(db, campaignId, 276_000, "P.D.");
  const tools = buildReviewTools({ db, campaignId, sourceText: NOTES, sessionNoteId: "s1", currentDay: 276_000 });
  const call = async (name: string, input: unknown) => {
    const tool = tools.find((t) => t.name === name)!;
    const run = tool.run as (i: unknown) => Promise<string>;
    return JSON.parse(await run(input));
  };
  return { db, campaignId, tools, call };
}

describe("buildReviewTools", () => {
  it("exposes the read + propose set", async () => {
    const { tools } = await ctx();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "list_clocks", "list_open_threads", "propose_clock_tick", "propose_date_advance",
      "propose_thread_open", "propose_thread_resolve", "search_entities",
    ]);
  });

  it("list_open_threads returns open threads with ids", async () => {
    const { db, campaignId, call } = await ctx();
    await createThread(db, { campaignId, title: "Find Ovid", currentDay: 275_990 });
    const out = await call("list_open_threads", {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: "Find Ovid", status: "open" });
    expect(out[0].id).toBeTruthy();
  });

  it("list_clocks returns clocks with filled/segments", async () => {
    const { db, campaignId, call } = await ctx();
    await createClock(db, { campaignId, name: "Assembly", segments: 8, cadenceDays: 7, currentDay: 276_000 });
    const out = await call("list_clocks", {});
    expect(out[0]).toMatchObject({ name: "Assembly", filled: 0, segments: 8 });
  });

  it("propose_thread_open returns a proposal without mutating", async () => {
    const { db, campaignId, call } = await ctx();
    const out = await call("propose_thread_open", {
      title: "Who is the Zadash broker?",
      stakes: "The contract holder still hunts them.",
      citation: "the contract came through a broker in Zadash",
      links: [],
    });
    expect(out.proposal).toMatchObject({ targetRoute: "/api/threads", method: "POST" });
    const { listThreads } = await import("./threads");
    expect(await listThreads(db, campaignId, { currentDay: 276_000 })).toHaveLength(0);
  });

  it("rejects an uncited proposal instead of throwing", async () => {
    const { call } = await ctx();
    const out = await call("propose_thread_open", { title: "T", citation: "a sentence never written", links: [] });
    expect(out.rejected).toBe(true);
    expect(out.error).toMatch(/not found/i);
    expect(out.proposal).toBeUndefined();
  });

  it("propose_clock_tick carries a delta", async () => {
    const { db, campaignId, call } = await ctx();
    const c = await createClock(db, { campaignId, name: "Assembly", currentDay: 276_000 });
    const out = await call("propose_clock_tick", {
      clockId: c.id, delta: 1, reason: "attention drawn",
      citation: "He admitted the contract came through a broker",
    });
    expect(out.proposal.payload).toMatchObject({ delta: 1, sourceKind: "proposal" });
  });

  it("propose_clock_tick rejects an unknown clock id", async () => {
    const { call } = await ctx();
    const out = await call("propose_clock_tick", {
      clockId: "nope", delta: 1, citation: "the contract came through a broker in Zadash",
    });
    expect(out.rejected).toBe(true);
    expect(out.error).toMatch(/unknown clock/i);
  });

  it("propose_thread_resolve rejects an unknown thread id", async () => {
    const { call } = await ctx();
    const out = await call("propose_thread_resolve", {
      threadId: "nope", citation: "The party cornered Ovid in the Pentamarket",
    });
    expect(out.rejected).toBe(true);
    expect(out.error).toMatch(/unknown thread/i);
  });

  it("propose_date_advance converts elapsed days into an absolute toDay", async () => {
    const { call } = await ctx();
    const out = await call("propose_date_advance", { days: 9, citation: "Nine days pass on the road east" });
    expect(out.proposal.payload).toEqual({ toDay: 276_009 });
  });

  it("propose_date_advance rejects a non-positive span", async () => {
    const { call } = await ctx();
    const out = await call("propose_date_advance", { days: 0, citation: "Nine days pass on the road east" });
    expect(out.rejected).toBe(true);
    expect(out.error).toMatch(/days/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/state/review-tools.test.ts`
Expected: FAIL — `Failed to resolve import "./review-tools"`.

- [ ] **Step 3: Write the implementation**

Create `lib/state/review-tools.ts`:

```ts
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { searchEntities } from "@/lib/assistant/read-tools";
import {
  buildThreadOpenProposal,
  buildThreadResolveProposal,
  buildClockTickProposal,
  buildDateAdvanceProposal,
} from "@/lib/assistant/proposals";
import { listThreads } from "./threads";
import { listClocks } from "./clocks";
import type { StateDb } from "./types";

const j = (v: unknown) => JSON.stringify(v);

/** A rejected proposal is data, not an exception — the model gets a chance to re-quote. */
const rejected = (err: unknown) => j({ rejected: true, error: (err as Error).message });

const linkSchema = z.object({
  targetKind: z.enum(["character", "location", "item", "faction", "session"]),
  targetId: z.string(),
  role: z.enum(["subject", "stakeholder", "obstacle"]).optional(),
});

export interface ReviewToolsContext {
  db: StateDb;
  campaignId: string;
  /** Flattened session-note text. Every citation is checked against this. */
  sourceText: string;
  sessionNoteId: string;
  currentDay: number | null;
}

export function buildReviewTools(ctx: ReviewToolsContext) {
  const { db, campaignId, sourceText, sessionNoteId, currentDay } = ctx;

  return [
    betaZodTool({
      name: "list_open_threads",
      description: "List the campaign's currently open plot threads with their ids, stakes, and staleness. Call this first — you need thread ids before you can propose resolving one.",
      inputSchema: z.object({}),
      run: async () => j(await listThreads(db, campaignId, { currentDay })),
    }),
    betaZodTool({
      name: "list_clocks",
      description: "List the campaign's clocks with id, name, filled/segments, owner, and status. Call before proposing a tick — you need the clock id.",
      inputSchema: z.object({}),
      run: async () => j(await listClocks(db, campaignId)),
    }),
    betaZodTool({
      name: "search_entities",
      description: "Search characters, locations, items, and factions by name to resolve a name in the session notes to an entity id, for linking a thread.",
      inputSchema: z.object({ query: z.string() }),
      run: async ({ query }) => j(searchEntities(db, campaignId, { query })),
    }),

    betaZodTool({
      name: "propose_thread_open",
      description: "Propose opening a new plot thread that this session raised. Does NOT create it. `citation` MUST be copied verbatim from the session notes — paraphrase is rejected.",
      inputSchema: z.object({
        title: z.string(),
        stakes: z.string().optional(),
        links: z.array(linkSchema).optional(),
        citation: z.string(),
      }),
      run: async (input) => {
        try {
          return j({ proposal: buildThreadOpenProposal(campaignId, { ...input, links: input.links ?? [] }, sourceText) });
        } catch (err) {
          return rejected(err);
        }
      },
    }),
    betaZodTool({
      name: "propose_thread_resolve",
      description: "Propose marking an existing thread resolved because this session answered it. Get the id from list_open_threads. `citation` MUST be verbatim from the session notes.",
      inputSchema: z.object({ threadId: z.string(), citation: z.string() }),
      run: async ({ threadId, citation }) => {
        try {
          const open = await listThreads(db, campaignId, { currentDay });
          const thread = open.find((t) => t.id === threadId);
          if (!thread) throw new Error(`unknown thread id: ${threadId}`);
          return j({
            proposal: buildThreadResolveProposal(
              { threadId, threadTitle: thread.title, resolvedSessionId: sessionNoteId, citation },
              sourceText,
            ),
          });
        } catch (err) {
          return rejected(err);
        }
      },
    }),
    betaZodTool({
      name: "propose_clock_tick",
      description: "Propose moving a clock by a delta (never an absolute value) because of what happened this session. Get the id from list_clocks. `citation` MUST be verbatim from the session notes.",
      inputSchema: z.object({
        clockId: z.string(),
        delta: z.number().int(),
        reason: z.string().optional(),
        citation: z.string(),
      }),
      run: async ({ clockId, delta, reason, citation }) => {
        try {
          const all = await listClocks(db, campaignId);
          const clock = all.find((c) => c.id === clockId);
          if (!clock) throw new Error(`unknown clock id: ${clockId}`);
          return j({
            proposal: buildClockTickProposal(
              { clockId, clockName: clock.name, delta, reason, citation },
              sourceText,
            ),
          });
        } catch (err) {
          return rejected(err);
        }
      },
    }),
    betaZodTool({
      name: "propose_date_advance",
      description: "Propose advancing in-world time by a number of days that passed during this session. `citation` MUST be verbatim from the session notes. Which clocks tick is the DM's call, not yours.",
      inputSchema: z.object({ days: z.number().int(), citation: z.string() }),
      run: async ({ days, citation }) => {
        try {
          if (currentDay === null) throw new Error("the campaign has no in-world date set yet");
          if (!Number.isInteger(days) || days <= 0) throw new Error(`days must be a positive integer, got ${days}`);
          return j({
            proposal: buildDateAdvanceProposal(campaignId, { toDay: currentDay + days, days, citation }, sourceText),
          });
        } catch (err) {
          return rejected(err);
        }
      },
    }),
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/state/review-tools.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/state/review-tools.ts lib/state/review-tools.test.ts
git commit -m "feat(state): review tool surface with citation-gated proposals"
```

---

### Task 11: Review agent and SSE route

Mirrors `runAssistant` in `lib/assistant/agent.ts` — read that file first; this is the same shape with a different tool set and a rejection counter.

**Files:**
- Create: `lib/state/review-agent.ts`
- Create: `app/api/campaigns/[id]/state/review/route.ts`
- Test: `lib/state/review-agent.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/state/review-agent.test.ts`. This tests the capture wrapper — the part that turns tool output into stream events — without a model:

```ts
import { describe, it, expect } from "vitest";
import { captureFromToolResult, REVIEW_SYSTEM } from "./review-agent";

describe("captureFromToolResult", () => {
  it("captures a proposal", () => {
    const proposals: unknown[] = [];
    const counts = { rejected: 0 };
    captureFromToolResult(JSON.stringify({ proposal: { summary: "s", targetRoute: "/api/threads" } }), proposals, counts);
    expect(proposals).toHaveLength(1);
    expect(counts.rejected).toBe(0);
  });

  it("counts a rejection without capturing a proposal", () => {
    const proposals: unknown[] = [];
    const counts = { rejected: 0 };
    captureFromToolResult(JSON.stringify({ rejected: true, error: "citation not found verbatim" }), proposals, counts);
    expect(proposals).toHaveLength(0);
    expect(counts.rejected).toBe(1);
  });

  it("ignores plain read-tool output", () => {
    const proposals: unknown[] = [];
    const counts = { rejected: 0 };
    captureFromToolResult(JSON.stringify([{ id: "t1", title: "Find Ovid" }]), proposals, counts);
    expect(proposals).toHaveLength(0);
    expect(counts.rejected).toBe(0);
  });

  it("ignores non-JSON output without throwing", () => {
    const proposals: unknown[] = [];
    const counts = { rejected: 0 };
    expect(() => captureFromToolResult("not json", proposals, counts)).not.toThrow();
    expect(proposals).toHaveLength(0);
  });
});

describe("REVIEW_SYSTEM", () => {
  it("tells the model citations must be verbatim and that nothing is applied", () => {
    expect(REVIEW_SYSTEM).toMatch(/verbatim/i);
    expect(REVIEW_SYSTEM).toMatch(/not applied|confirm/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/state/review-agent.test.ts`
Expected: FAIL — `Failed to resolve import "./review-agent"`.

- [ ] **Step 3: Write the review agent**

Create `lib/state/review-agent.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { buildReviewTools, type ReviewToolsContext } from "./review-tools";

export interface ReviewEvent {
  type: "text" | "proposal" | "summary" | "done" | "error";
  text?: string;
  proposal?: unknown;
  /** On "summary": how many proposals survived and how many were rejected for a bad citation. */
  proposalCount?: number;
  rejectedCount?: number;
  message?: string;
}

export const REVIEW_SYSTEM = `You are reviewing a Dungeon Master's notes from a session that has already been played, to propose updates to the campaign's tracked state.

First call list_open_threads and list_clocks so you know what already exists — never propose opening a thread that duplicates an open one, and never propose ticking a clock you have not read.

Then propose only what the notes actually support:
- propose_thread_resolve for an open thread the session answered.
- propose_thread_open for a genuinely new unresolved question the session raised. Use search_entities to link it to the characters, locations, and factions involved.
- propose_clock_tick when the session advanced a faction's or location's ongoing effort.
- propose_date_advance if the notes state that in-world time passed.

Every proposal requires a \`citation\`: a passage COPIED VERBATIM from the session notes. Do not paraphrase, summarize, or reconstruct it from memory — a citation that is not literally present in the notes is rejected and the proposal is discarded. If you cannot quote it, do not propose it.

Nothing you propose is applied. The DM confirms each proposal in the UI. Never say you have changed anything.

Finish with one short paragraph naming what you proposed. Be sparing: three well-grounded proposals beat ten speculative ones.`;

/**
 * Pull a proposal (or a rejection) out of one tool result. Exported for testing;
 * `runSessionReview` wires it into each tool's `run`.
 */
export function captureFromToolResult(
  result: unknown,
  proposalSink: unknown[],
  counts: { rejected: number },
): void {
  if (typeof result !== "string") return;
  try {
    const parsed = JSON.parse(result);
    if (!parsed || typeof parsed !== "object") return;
    if ("proposal" in parsed && parsed.proposal != null) proposalSink.push(parsed.proposal);
    else if ("rejected" in parsed && parsed.rejected === true) counts.rejected++;
  } catch {
    // Not JSON — nothing to capture.
  }
}

export async function runSessionReview(
  opts: { apiKey: string } & ReviewToolsContext,
  onEvent: (e: ReviewEvent) => void,
): Promise<void> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const proposals: unknown[] = [];
  const counts = { rejected: 0 };

  const tools = buildReviewTools(opts).map((tool) => {
    const originalRun = tool.run as (args: unknown, context?: unknown) => unknown;
    const run = async (args: unknown, context?: unknown) => {
      const result = await originalRun(args, context);
      captureFromToolResult(result, proposals, counts);
      return result;
    };
    return { ...tool, run } as typeof tool;
  });

  const runner = client.beta.messages.toolRunner({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    max_iterations: 16,
    output_config: { effort: "high" },
    system: REVIEW_SYSTEM,
    tools,
    messages: [
      {
        role: "user",
        content: `Review these session notes and propose state updates.\n\n<session_notes>\n${opts.sourceText}\n</session_notes>`,
      },
    ],
    stream: true,
  });

  let emittedText = false;
  for await (const messageStream of runner) {
    for await (const event of messageStream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta" && event.delta.text) {
        emittedText = true;
        onEvent({ type: "text", text: event.delta.text });
      }
    }
    await messageStream.finalMessage();
  }

  if (!emittedText) {
    onEvent({ type: "text", text: "No review output was produced — try again." });
  }

  for (const proposal of proposals) onEvent({ type: "proposal", proposal });

  onEvent({ type: "summary", proposalCount: proposals.length, rejectedCount: counts.rejected });
  onEvent({ type: "done" });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/state/review-agent.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the SSE route**

Create `app/api/campaigns/[id]/state/review/route.ts`:

```ts
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings, sessionNotes, sessionReviews } from "@/lib/db/schema";
import { fetchNotionPageBlocks } from "@/lib/notion/client";
import { blocksToPlainText, hashContent } from "@/lib/state/content-hash";
import { getCampaignDay } from "@/lib/state/advance";
import { runSessionReview, type ReviewEvent } from "@/lib/state/review-agent";
import { generateId } from "@/lib/utils";
import type { StateDb } from "@/lib/state/types";

const sdb = db as unknown as StateDb;

const fail = (message: string, status: number) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: campaignId } = await params;
  const body = (await req.json().catch(() => ({}))) as { sessionNoteId?: string };
  if (!body.sessionNoteId) return fail("sessionNoteId required", 400);

  const note = await db.query.sessionNotes.findFirst({ where: eq(sessionNotes.id, body.sessionNoteId) });
  if (!note) return fail("Session note not found", 404);
  if (!note.notionPageId) return fail("This session note has no linked Notion page to review", 400);

  const apiKeyRow = await db.query.settings.findFirst({ where: eq(settings.key, "anthropic_api_key") });
  if (!apiKeyRow?.value) return fail("Add an Anthropic API key in Settings first", 400);

  const notionTokenRow = await db.query.settings.findFirst({ where: eq(settings.key, "notion_token") });
  if (!notionTokenRow?.value) return fail("Add a Notion token in Settings first", 400);

  // Fetch the page body up front: if Notion fails, the pass emits no proposals at all
  // rather than half a review.
  let sourceText: string;
  try {
    const blocks = await fetchNotionPageBlocks(note.notionPageId, notionTokenRow.value);
    sourceText = blocksToPlainText(blocks);
  } catch (err) {
    return fail(`Could not read the Notion page: ${(err as Error).message}`, 502);
  }
  if (!sourceText.trim()) return fail("The linked Notion page has no readable text", 400);

  const contentHash = hashContent(sourceText);
  const currentDay = await getCampaignDay(sdb, campaignId);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: ReviewEvent & { contentHash?: string }) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        let proposalCount = 0;
        await runSessionReview(
          {
            apiKey: apiKeyRow.value,
            db: sdb,
            campaignId,
            sessionNoteId: body.sessionNoteId!,
            sourceText,
            currentDay,
          },
          (e) => {
            if (e.type === "summary") {
              proposalCount = e.proposalCount ?? 0;
              send({ ...e, contentHash });
            } else {
              send(e);
            }
          },
        );

        await db.insert(sessionReviews).values({
          id: generateId(),
          sessionNoteId: body.sessionNoteId!,
          reviewedAt: new Date(),
          contentHash,
          proposalCount,
        });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Review failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" },
  });
}
```

- [ ] **Step 6: Add the review-status endpoint**

The session-note UI needs to know whether to badge "Review session". Create `app/api/campaigns/[id]/state/review/status/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessionNotes, sessionReviews, settings } from "@/lib/db/schema";
import { fetchNotionPageBlocks } from "@/lib/notion/client";
import { blocksToPlainText, hashContent } from "@/lib/state/content-hash";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sessionNoteId = searchParams.get("sessionNoteId");
  if (!sessionNoteId) return NextResponse.json({ error: "sessionNoteId required" }, { status: 400 });

  const note = await db.query.sessionNotes.findFirst({ where: eq(sessionNotes.id, sessionNoteId) });
  if (!note?.notionPageId) return NextResponse.json({ reviewable: false, needsReview: false });

  const last = await db.query.sessionReviews.findFirst({
    where: eq(sessionReviews.sessionNoteId, sessionNoteId),
    orderBy: [desc(sessionReviews.reviewedAt)],
  });

  const tokenRow = await db.query.settings.findFirst({ where: eq(settings.key, "notion_token") });
  if (!tokenRow?.value) return NextResponse.json({ reviewable: true, needsReview: !last, lastReviewedAt: last?.reviewedAt ?? null });

  let currentHash: string | null = null;
  try {
    currentHash = hashContent(blocksToPlainText(await fetchNotionPageBlocks(note.notionPageId, tokenRow.value)));
  } catch {
    // Notion unreachable — fall back to "needs review only if never reviewed".
  }

  return NextResponse.json({
    reviewable: true,
    // Never reviewed, or the page changed since the last review.
    needsReview: !last || (currentHash !== null && currentHash !== last.contentHash),
    lastReviewedAt: last?.reviewedAt ?? null,
    lastProposalCount: last?.proposalCount ?? 0,
    // Returned so the review slide-over can detect the page changing underneath
    // an open review before it applies anything.
    currentHash,
  });
}
```

- [ ] **Step 7: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add lib/state/review-agent.ts lib/state/review-agent.test.ts app/api/campaigns
git commit -m "feat(state): post-session review agent and SSE route"
```

---

# Phase 4 — Surfaces

**No unit tests in this phase.** `vitest.config.ts` runs in a node environment with no React testing library, and this plan does not add one. Each UI task ends with explicit browser verification instead. Use the preview tooling to run the dev server — never `npm run dev` in a shell.

### Task 12: ClockDial component

A segmented arc that reads from across a table. Per `PRODUCT.md`, color never carries state alone — the numeral is always rendered.

**Files:**
- Create: `components/state/ClockDial.tsx`

- [ ] **Step 1: Write the component**

Create `components/state/ClockDial.tsx`:

```tsx
"use client";

import { cn } from "@/lib/utils";

interface ClockDialProps {
  segments: number;
  filled: number;
  name?: string;
  status?: string;
  size?: number;
  className?: string;
}

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/**
 * Segmented progress arc. Urgency colour is an accent on top of the numeral,
 * never the only signal: the `filled/segments` label is always rendered, and the
 * whole dial carries an aria-label for screen readers.
 */
export function ClockDial({ segments, filled, name, status, size = 56, className }: ClockDialProps) {
  const cx = size / 2;
  const cy = size / 2;
  const stroke = Math.max(4, Math.round(size * 0.12));
  const r = cx - stroke;
  const gapDeg = segments > 8 ? 3 : 5;
  const step = 360 / segments;

  const ratio = segments === 0 ? 0 : filled / segments;
  const tone =
    status === "complete" || ratio >= 1
      ? "text-destructive"
      : ratio >= 0.75
        ? "text-orange-500"
        : ratio >= 0.5
          ? "text-amber-500"
          : "text-primary";

  const arcs = Array.from({ length: segments }, (_, i) => {
    const start = i * step + gapDeg / 2;
    const end = (i + 1) * step - gapDeg / 2;
    const [x1, y1] = polar(cx, cy, r, start);
    const [x2, y2] = polar(cx, cy, r, end);
    return { d: `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`, on: i < filled };
  });

  return (
    <div className={cn("inline-flex flex-col items-center gap-1", className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          role="img"
          aria-label={`${name ? `${name}: ` : ""}${filled} of ${segments} segments filled${status === "complete" ? ", complete" : ""}`}
          className={tone}
        >
          {arcs.map((arc, i) => (
            <path
              key={i}
              d={arc.d}
              fill="none"
              strokeWidth={stroke}
              strokeLinecap="butt"
              className={arc.on ? "stroke-current" : "stroke-border"}
            />
          ))}
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums"
          aria-hidden="true"
        >
          {filled}/{segments}
        </span>
      </div>
      {name && <span className="max-w-[10rem] truncate text-xs text-muted-foreground">{name}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Verify in the browser**

Temporarily render a few dials on `app/chronicle/page.tsx` (created in Task 13) or any page you can load, at `segments` 4/6/8/12 and `filled` 0, half, and full. Confirm:
- the numeral is legible at the default size,
- an unfilled dial shows all segments in the border colour,
- a full dial reads `8/8` and turns the destructive tone,
- zooming the browser to 50% still leaves the numeral readable.

- [ ] **Step 3: Commit**

```bash
git add components/state/ClockDial.tsx
git commit -m "feat(state): segmented clock dial with always-visible numeral"
```

---

### Task 13: Chronicle route, nav entry, and the Threads tab

**Files:**
- Create: `app/chronicle/page.tsx`
- Create: `components/state/ChronicleBrowser.tsx`
- Create: `components/state/ThreadsTab.tsx`
- Create: `components/state/SetDatePrompt.tsx`
- Modify: `components/shell/TopBar.tsx`

- [ ] **Step 1: Add the nav entry**

In `components/shell/TopBar.tsx`, import `BookOpen` from `lucide-react` and add to the nav array, after the `/sessions` entry:

```ts
  { href: "/chronicle", label: "Chronicle", icon: BookOpen },
```

- [ ] **Step 2: Create the set-date prompt**

Nothing else works until the campaign has an in-world date, so this is the gate.

Create `components/state/SetDatePrompt.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EXANDRIA } from "@/lib/calendar/exandria";

interface SetDatePromptProps {
  campaignId: string;
  /** Prefills when correcting an existing date. */
  initialDay?: number | null;
  initialEpochLabel?: string;
  onSaved: () => void;
  onCancel?: () => void;
}

export function SetDatePrompt({ campaignId, initialDay, initialEpochLabel, onSaved, onCancel }: SetDatePromptProps) {
  const initial = initialDay != null ? EXANDRIA.toParts(initialDay) : { year: 843, monthIndex: 0, dayOfMonth: 1 };
  const [year, setYear] = useState(String(initial.year));
  const [monthIndex, setMonthIndex] = useState(initial.monthIndex);
  const [dayOfMonth, setDayOfMonth] = useState(String(initial.dayOfMonth));
  const [epochLabel, setEpochLabel] = useState(initialEpochLabel ?? "P.D.");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    let day: number;
    try {
      day = EXANDRIA.fromParts({
        year: Number(year),
        monthIndex,
        dayOfMonth: Number(dayOfMonth),
      });
    } catch (err) {
      setError((err as Error).message);
      return;
    }

    setBusy(true);
    const res = await fetch(`/api/campaigns/${campaignId}/set-date`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ day, epochLabel }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Could not set the date");
      return;
    }
    onSaved();
  }

  return (
    <div className="max-w-md space-y-3 rounded-lg border border-border p-4">
      <div>
        <h2 className="font-semibold">Set the in-world date</h2>
        <p className="text-sm text-muted-foreground">
          Threads, clocks, and the timeline are all positioned by this date. Setting it here does not tick any clocks.
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          aria-label="Day of month"
          className="w-20"
          value={dayOfMonth}
          onChange={(e) => setDayOfMonth(e.target.value)}
        />
        <select
          aria-label="Month"
          className="flex-1 rounded-md border border-border bg-background px-2 text-sm"
          value={monthIndex}
          onChange={(e) => setMonthIndex(Number(e.target.value))}
        >
          {EXANDRIA.months.map((m, i) => (
            <option key={m.name} value={i}>
              {m.name} ({m.days} days)
            </option>
          ))}
        </select>
        <Input aria-label="Year" className="w-24" value={year} onChange={(e) => setYear(e.target.value)} />
        <Input aria-label="Epoch label" className="w-20" value={epochLabel} onChange={(e) => setEpochLabel(e.target.value)} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Set date"}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create the shared state types and fetch hook**

Create `components/state/chronicle-types.ts`:

```ts
export interface ThreadView {
  id: string;
  title: string;
  stakes: string | null;
  status: string;
  daysUntouched: number | null;
  lastTouchedDay: number | null;
  links: Array<{ targetKind: string; targetId: string; role: string }>;
}

export interface ClockView {
  id: string;
  name: string;
  segments: number;
  filled: number;
  status: string;
  cadenceDays: number | null;
  ownerKind: string | null;
  ownerId: string | null;
  payoff: string | null;
}

export interface TimelineEventView {
  id: string;
  day: number;
  kind: string;
  title: string;
  body: string | null;
  sourceKind: string;
  dateLabel: string;
}

export interface CampaignStateView {
  currentDay: number | null;
  epochLabel: string;
  currentDateLabel: string | null;
  threads: ThreadView[];
  clocks: ClockView[];
  events: TimelineEventView[];
}
```

- [ ] **Step 4: Create the Threads tab**

Create `components/state/ThreadsTab.tsx`:

```tsx
"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ThreadView } from "./chronicle-types";

const KIND_ROUTES: Record<string, string> = {
  character: "/characters",
  location: "/locations",
  item: "/items",
  faction: "/factions",
  session: "/sessions",
};

function staleness(days: number | null): { label: string; tone: string } {
  if (days === null) return { label: "—", tone: "text-muted-foreground" };
  if (days >= 90) return { label: `${days}d untouched`, tone: "text-destructive" };
  if (days >= 30) return { label: `${days}d untouched`, tone: "text-orange-500" };
  return { label: `${days}d untouched`, tone: "text-muted-foreground" };
}

interface ThreadsTabProps {
  threads: ThreadView[];
  onResolve: (thread: ThreadView) => void;
  onEdit: (thread: ThreadView) => void;
}

export function ThreadsTab({ threads, onResolve, onEdit }: ThreadsTabProps) {
  const open = threads.filter((t) => t.status === "open");
  const dormant = threads.filter((t) => t.status === "dormant");

  if (!threads.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No open threads. Open one from here, or run a session review to have them proposed from your notes.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <Section title="Open" threads={open} onResolve={onResolve} onEdit={onEdit} />
      {dormant.length > 0 && <Section title="Dormant" threads={dormant} onResolve={onResolve} onEdit={onEdit} />}
    </div>
  );
}

function Section({
  title,
  threads,
  onResolve,
  onEdit,
}: { title: string } & ThreadsTabProps) {
  if (!threads.length) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title} ({threads.length})
      </h3>
      <ul className="space-y-2">
        {threads.map((t) => {
          const stale = staleness(t.daysUntouched);
          return (
            <li key={t.id} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{t.title}</p>
                  {t.stakes && <p className="mt-0.5 text-sm text-muted-foreground">{t.stakes}</p>}
                </div>
                <span className={`flex-none text-xs tabular-nums ${stale.tone}`}>{stale.label}</span>
              </div>

              {t.links.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {t.links.map((l, i) => {
                    const base = KIND_ROUTES[l.targetKind];
                    const chip = (
                      <Badge key={i} variant="outline" className="text-[11px]">
                        {l.targetKind}
                        {l.role !== "subject" ? ` · ${l.role}` : ""}
                      </Badge>
                    );
                    return base ? (
                      <Link key={i} href={`${base}/${l.targetId}`}>
                        {chip}
                      </Link>
                    ) : (
                      chip
                    );
                  })}
                </div>
              )}

              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => onEdit(t)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onResolve(t)}>
                  Resolve
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

**Note on the link chips:** `targetId` may be dangling if the entity was deleted (the schema deliberately does not cascade). The chip renders the kind and role regardless, so a dangling link degrades to a dead chip rather than a crash.

- [ ] **Step 5: Create the chronicle browser and page**

Create `components/state/ChronicleBrowser.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { SetDatePrompt } from "./SetDatePrompt";
import { ThreadsTab } from "./ThreadsTab";
import { TimelineTab } from "./TimelineTab";
import type { CampaignStateView, ThreadView } from "./chronicle-types";

export function ChronicleBrowser({ campaignId }: { campaignId: string }) {
  const [state, setState] = useState<CampaignStateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${campaignId}/state`);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Could not load campaign state");
      return;
    }
    setState(await res.json());
    setError(null);
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolveThread(thread: ThreadView) {
    await fetch(`/api/threads/${thread.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });
    await load();
  }

  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>;
  if (!state) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;

  if (state.currentDay === null) {
    return (
      <div className="p-6">
        <SetDatePrompt campaignId={campaignId} onSaved={load} />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{state.currentDateLabel}</h1>
          <p className="text-sm text-muted-foreground">
            {state.threads.filter((t) => t.status === "open").length} open thread(s),{" "}
            {state.clocks.filter((c) => c.status === "running").length} running clock(s)
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setEditingDate((v) => !v)}>
          {editingDate ? "Cancel" : "Correct date"}
        </Button>
      </header>

      {editingDate && (
        <SetDatePrompt
          campaignId={campaignId}
          initialDay={state.currentDay}
          initialEpochLabel={state.epochLabel}
          onSaved={async () => {
            setEditingDate(false);
            await load();
          }}
          onCancel={() => setEditingDate(false)}
        />
      )}

      <Tabs defaultValue="threads">
        <TabsList>
          <TabsTrigger value="threads">Threads</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        <TabsContent value="threads" className="mt-4">
          <ThreadsTab threads={state.threads} onResolve={resolveThread} onEdit={resolveThread} />
        </TabsContent>

        <TabsContent value="timeline" className="mt-4">
          <TimelineTab campaignId={campaignId} state={state} onChanged={load} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

**Note:** `onEdit` is wired to `resolveThread` here only so this step compiles on its own. Steps 7–8 replace it with the real edit dialog — do not ship the intermediate state.

Create `app/chronicle/page.tsx`:

```tsx
"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ChronicleBrowser } from "@/components/state/ChronicleBrowser";

function ChronicleInner() {
  const params = useSearchParams();
  const campaignId = params.get("campaignId");
  if (!campaignId) return <p className="p-6 text-sm text-muted-foreground">No campaign selected.</p>;
  return <ChronicleBrowser campaignId={campaignId} />;
}

export default function ChroniclePage() {
  // useSearchParams requires a Suspense boundary or the production build fails —
  // this bit the hub shell sub-project once already.
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading…</p>}>
      <ChronicleInner />
    </Suspense>
  );
}
```

**Check how sibling pages resolve the active campaign** (`components/entities/SimpleEntityManager.tsx` and `components/sessions/SessionNotesBrowser.tsx`) and match whatever they do — if they read the campaign from a store or a settings fetch rather than a query param, use that instead of `useSearchParams` and drop the Suspense wrapper.

- [ ] **Step 6: Verify in the browser**

Load `/chronicle`. Expect the set-date prompt on a campaign with no date. Set 1 Horisal 843 P.D., confirm the header renders "1st of Horisal, 843 P.D." and both tabs appear. Check the console and network panel for errors.

- [ ] **Step 7: Create the thread form dialog**

Create `components/state/ThreadFormDialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ThreadView } from "./chronicle-types";

const STATUSES = ["open", "dormant", "resolved", "abandoned"] as const;

interface ThreadFormDialogProps {
  campaignId: string;
  /** Omit to create a new thread. */
  thread?: ThreadView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function ThreadFormDialog({ campaignId, thread, open, onOpenChange, onSaved }: ThreadFormDialogProps) {
  const [title, setTitle] = useState(thread?.title ?? "");
  const [stakes, setStakes] = useState(thread?.stakes ?? "");
  const [status, setStatus] = useState<string>(thread?.status ?? "open");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    if (!title.trim()) {
      setError("A title is required.");
      return;
    }

    setBusy(true);
    const res = thread
      ? await fetch(`/api/threads/${thread.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, stakes, status }),
        })
      : await fetch("/api/threads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ campaignId, title, stakes }),
        });
    setBusy(false);

    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Could not save the thread");
      return;
    }
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{thread ? "Edit thread" : "Open a thread"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">
              The question ({"e.g."} &ldquo;Who hired the assassins?&rdquo;)
            </span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Stakes — what goes wrong if it stays open</span>
            <Input value={stakes} onChange={(e) => setStakes(e.target.value)} />
          </label>

          {thread && (
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Status</span>
              <select
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 8: Wire the dialog into the browser**

In `components/state/ChronicleBrowser.tsx`, import `ThreadFormDialog`, add state, replace the placeholder `onEdit`, and add a "New thread" button in the header:

```tsx
const [editing, setEditing] = useState<ThreadView | null>(null);
const [creating, setCreating] = useState(false);
```

```tsx
<Button size="sm" onClick={() => setCreating(true)}>New thread</Button>
```

```tsx
<ThreadsTab threads={state.threads} onResolve={resolveThread} onEdit={setEditing} />
```

```tsx
{(editing || creating) && (
  <ThreadFormDialog
    campaignId={campaignId}
    thread={editing}
    open
    onOpenChange={(o) => {
      if (!o) { setEditing(null); setCreating(false); }
    }}
    onSaved={load}
  />
)}
```

Remove the placeholder note above the `ChronicleBrowser` code block once this is wired.

**Note on dialog state:** `ThreadFormDialog` seeds its fields from props via `useState`, so it must be **mounted fresh** per edit — that is why it is rendered conditionally on `(editing || creating)` rather than kept mounted with an `open` prop. Keeping it mounted would show stale field values on the second edit.

- [ ] **Step 9: Commit**

```bash
git add app/chronicle components/state components/shell/TopBar.tsx
git commit -m "feat(state): chronicle route with threads board and in-world date"
```

---

### Task 14: Timeline tab and the advance-date dialog

**Files:**
- Create: `components/state/TimelineTab.tsx`
- Create: `components/state/AdvanceDateDialog.tsx`

- [ ] **Step 1: Create the advance dialog**

Create `components/state/AdvanceDateDialog.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatInWorldDay } from "@/lib/calendar/exandria";

interface DueTick {
  clockId: string;
  name: string;
  ticks: number;
  rawTicks: number;
  elapsedDays: number;
  fromFilled: number;
  toFilled: number;
  completes: boolean;
}

interface AdvanceDateDialogProps {
  campaignId: string;
  currentDay: number;
  epochLabel: string;
  /** Prefilled target day, e.g. from a review proposal. */
  seedToDay?: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: () => void;
}

export function AdvanceDateDialog({
  campaignId, currentDay, epochLabel, seedToDay, open, onOpenChange, onApplied,
}: AdvanceDateDialogProps) {
  const [days, setDays] = useState(String(seedToDay != null ? seedToDay - currentDay : 1));
  const [due, setDue] = useState<DueTick[] | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toDay = currentDay + Number(days || 0);

  const preview = useCallback(async () => {
    setError(null);
    setBusy(true);
    const res = await fetch(`/api/campaigns/${campaignId}/advance-date`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toDay }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Preview failed");
      setDue(null);
      return;
    }
    const data = await res.json();
    setDue(data.dueTicks);
    // Everything due is accepted by default; the DM unchecks what they don't want.
    setAccepted(new Set(data.dueTicks.map((t: DueTick) => t.clockId)));
  }, [campaignId, toDay]);

  useEffect(() => {
    if (open && Number(days) > 0) void preview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function apply() {
    setBusy(true);
    const res = await fetch(`/api/campaigns/${campaignId}/advance-date`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toDay, apply: { clockIds: [...accepted] } }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Could not advance the date");
      return;
    }
    onOpenChange(false);
    onApplied();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Advance in-world time</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-end gap-2">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Days to advance</span>
              <Input className="w-24" value={days} onChange={(e) => setDays(e.target.value)} />
            </label>
            <Button variant="ghost" onClick={preview} disabled={busy || Number(days) <= 0}>
              Preview
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            {formatInWorldDay(currentDay, epochLabel)} → <strong>{Number(days) > 0 ? formatInWorldDay(toDay, epochLabel) : "—"}</strong>
          </p>

          {due && due.length === 0 && (
            <p className="text-sm text-muted-foreground">No clocks are due at that date.</p>
          )}

          {due && due.length > 0 && (
            <ul className="space-y-2">
              {due.map((t) => (
                <li key={t.clockId} className="flex items-start gap-2 rounded-md border border-border p-2">
                  <input
                    id={`tick-${t.clockId}`}
                    type="checkbox"
                    className="mt-1"
                    checked={accepted.has(t.clockId)}
                    onChange={(e) => {
                      const next = new Set(accepted);
                      if (e.target.checked) next.add(t.clockId);
                      else next.delete(t.clockId);
                      setAccepted(next);
                    }}
                  />
                  <label htmlFor={`tick-${t.clockId}`} className="text-sm">
                    <span className="font-medium">{t.name}</span> +{t.ticks}{" "}
                    <span className="text-muted-foreground">
                      ({t.fromFilled} → {t.toFilled}, {t.elapsedDays} days elapsed)
                    </span>
                    {t.completes && <span className="ml-1 text-destructive">fills</span>}
                    {t.rawTicks > t.ticks && (
                      <span className="ml-1 text-muted-foreground">· capped from +{t.rawTicks}</span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-muted-foreground">
            Unchecked clocks are skipped, not deferred — they will not be re-proposed on the next advance.
          </p>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button onClick={apply} disabled={busy || Number(days) <= 0}>
              {busy ? "Working…" : "Advance"}
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create the Timeline tab**

Create `components/state/TimelineTab.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClockDial } from "./ClockDial";
import { AdvanceDateDialog } from "./AdvanceDateDialog";
import type { CampaignStateView } from "./chronicle-types";

const SOURCE_LABEL: Record<string, string> = {
  manual: "manual",
  proposal: "from review",
  cadence: "time",
};

interface TimelineTabProps {
  campaignId: string;
  state: CampaignStateView;
  onChanged: () => void;
}

export function TimelineTab({ campaignId, state, onChanged }: TimelineTabProps) {
  const [advancing, setAdvancing] = useState(false);
  const running = state.clocks.filter((c) => c.status !== "complete");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-wrap gap-4">
          {running.length === 0 && <p className="text-sm text-muted-foreground">No running clocks.</p>}
          {running.map((c) => (
            <ClockDial key={c.id} name={c.name} segments={c.segments} filled={c.filled} status={c.status} />
          ))}
        </div>
        <Button onClick={() => setAdvancing(true)} disabled={state.currentDay === null}>
          Advance time
        </Button>
      </div>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timeline</h3>
        {state.events.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing has happened yet. Advancing time or reviewing a session will fill this in.</p>
        )}
        <ul className="space-y-2">
          {state.events.map((e) => (
            <li key={e.id} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium">{e.title}</p>
                <span className="flex-none text-xs text-muted-foreground">{e.dateLabel}</span>
              </div>
              {e.body && <p className="mt-0.5 text-sm text-muted-foreground">{e.body}</p>}
              <Badge variant="outline" className="mt-2 text-[11px]">
                {SOURCE_LABEL[e.sourceKind] ?? e.sourceKind}
              </Badge>
            </li>
          ))}
        </ul>
      </section>

      {state.currentDay !== null && (
        <AdvanceDateDialog
          campaignId={campaignId}
          currentDay={state.currentDay}
          epochLabel={state.epochLabel}
          open={advancing}
          onOpenChange={setAdvancing}
          onApplied={onChanged}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify in the browser**

On `/chronicle`:
1. Create a clock via the console: `fetch("/api/clocks", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({campaignId:"<id>",name:"Assembly",segments:8,cadenceDays:7})})`, then reload.
2. Open the Timeline tab — the dial shows `0/8`.
3. Click **Advance time**, enter 20 days, Preview. Expect one row: `Assembly +2 (0 → 2, 20 days elapsed)`.
4. Uncheck it and Advance. Expect the dial still `0/8`, the date moved, and a `date_advanced` event.
5. Advance 6 more days and preview — expect **no** due ticks (the declined tick was skipped, not deferred).
6. Advance 8 more days with the box checked. Expect `1/8` and a `clock_ticked` event tagged "time".

- [ ] **Step 4: Commit**

```bash
git add components/state/TimelineTab.tsx components/state/AdvanceDateDialog.tsx
git commit -m "feat(state): timeline tab and advance-date preview dialog"
```

---

### Task 15: Review slide-over

The payoff surface for Engine 2. Modelled on `components/maps/MarkerSlideOver.tsx` (shell) and `components/assistant/ChatPanel.tsx` (SSE consumption + proposal confirm) — read both before starting.

**Files:**
- Create: `components/state/ReviewSlideOver.tsx`
- Modify: `components/sessions/SessionNoteDetail.tsx`

- [ ] **Step 1: Create the slide-over**

Create `components/state/ReviewSlideOver.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdvanceDateDialog } from "./AdvanceDateDialog";

interface Proposal {
  summary: string;
  targetRoute: string;
  method: "POST" | "PATCH";
  payload: Record<string, unknown>;
  citation?: string;
}

type Outcome = { proposal: Proposal; ok: boolean; detail: string };

interface ReviewSlideOverProps {
  campaignId: string;
  sessionNoteId: string;
  currentDay: number | null;
  epochLabel: string;
  onClose: () => void;
  onApplied: () => void;
}

/** A date-advance proposal opens the advance dialog rather than POSTing blind. */
function isDateAdvance(p: Proposal): boolean {
  return p.targetRoute.endsWith("/advance-date");
}

export function ReviewSlideOver({
  campaignId, sessionNoteId, currentDay, epochLabel, onClose, onApplied,
}: ReviewSlideOverProps) {
  const [narration, setNarration] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [summary, setSummary] = useState<{ proposalCount: number; rejectedCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [advanceSeed, setAdvanceSeed] = useState<number | null>(null);
  const [staleWarning, setStaleWarning] = useState(false);
  const reviewedHash = useRef<string | null>(null);
  const started = useRef(false);

  const run = useCallback(async () => {
    setBusy(true);
    const res = await fetch(`/api/campaigns/${campaignId}/state/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionNoteId }),
    });

    if (!res.ok || !res.body) {
      setError((await res.json().catch(() => ({}))).error ?? "Review failed");
      setBusy(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        if (!chunk.startsWith("data: ")) continue;
        const evt = JSON.parse(chunk.slice(6)) as {
          type: string; text?: string; proposal?: Proposal;
          proposalCount?: number; rejectedCount?: number; message?: string; contentHash?: string;
        };
        if (evt.type === "text" && evt.text) setNarration((t) => t + evt.text);
        else if (evt.type === "proposal" && evt.proposal) setProposals((p) => [...p, evt.proposal!]);
        else if (evt.type === "summary") {
          setSummary({ proposalCount: evt.proposalCount ?? 0, rejectedCount: evt.rejectedCount ?? 0 });
          reviewedHash.current = evt.contentHash ?? null;
        } else if (evt.type === "error") setError(evt.message ?? "Review failed");
      }
    }
    setBusy(false);
  }, [campaignId, sessionNoteId]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  /**
   * The background sync may have rewritten the Notion page while this review was
   * open. Applying then would be applying against text the DM never read, so the
   * first attempt warns instead; a second attempt proceeds.
   */
  async function isStale(): Promise<boolean> {
    if (reviewedHash.current === null || staleWarning) return false;
    const res = await fetch(
      `/api/campaigns/${campaignId}/state/review/status?sessionNoteId=${sessionNoteId}`,
    );
    if (!res.ok) return false;
    const { currentHash } = (await res.json()) as { currentHash: string | null };
    return currentHash !== null && currentHash !== reviewedHash.current;
  }

  async function approve(p: Proposal) {
    if (await isStale()) {
      setStaleWarning(true);
      return;
    }

    if (isDateAdvance(p)) {
      setAdvanceSeed(Number(p.payload.toDay));
      setProposals((list) => list.filter((x) => x !== p));
      return;
    }

    const res = await fetch(p.targetRoute, {
      method: p.method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(p.payload),
    });
    const ok = res.ok;
    const detail = ok ? "applied" : ((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);

    setProposals((list) => list.filter((x) => x !== p));
    setOutcomes((o) => [...o, { proposal: p, ok, detail }]);
    if (ok) onApplied();
  }

  function reject(p: Proposal) {
    setProposals((list) => list.filter((x) => x !== p));
    setOutcomes((o) => [...o, { proposal: p, ok: false, detail: "rejected" }]);
  }

  async function approveAll() {
    // Sequential, not parallel: each application is independent and one failure
    // must not abort the rest.
    for (const p of [...proposals]) await approve(p);
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-background shadow-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="font-semibold">Session review</span>
        <button onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {staleWarning && (
          <p className="rounded-md border border-orange-500/50 bg-orange-500/10 p-2 text-xs text-orange-600 dark:text-orange-400">
            This Notion page changed since the review ran, so these proposals were derived from
            older text. Re-run the review, or click Approve again to apply anyway.
          </p>
        )}
        {busy && <p className="text-sm text-muted-foreground">Reading the session notes…</p>}
        {narration && <p className="whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm">{narration}</p>}

        {proposals.map((p, i) => (
          <div key={`p${i}`} className="rounded-lg border border-border p-3 text-sm">
            {/* whitespace-pre-wrap below is load-bearing, not styling. assertCitation
                stores the SOURCE's own slice, so a citation glued across two sentences
                or bullets carries the literal newline that proves the glue. HTML would
                collapse it and show the DM a seamless sentence the notes never contain
                — nullifying the only mitigation for that hazard. Do not remove it. */}
            {p.citation && (
              <blockquote className="mb-2 whitespace-pre-wrap border-l-2 border-border pl-2 text-xs italic text-muted-foreground">
                “{p.citation}”
              </blockquote>
            )}
            <p className="mb-2 font-medium">{p.summary}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => approve(p)}>
                {isDateAdvance(p) ? "Review ticks" : "Approve"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => reject(p)}>
                Reject
              </Button>
            </div>
          </div>
        ))}

        {outcomes.map((o, i) => (
          <p key={`o${i}`} className={`text-xs ${o.ok ? "text-muted-foreground" : "text-destructive"}`}>
            {o.ok ? "✓" : "⚠️"} {o.proposal.summary} — {o.detail}
          </p>
        ))}

        {summary && !busy && (
          <p className="text-xs text-muted-foreground">
            {summary.proposalCount} proposal(s) offered
            {summary.rejectedCount > 0 && `, ${summary.rejectedCount} discarded for an ungrounded citation`}.
          </p>
        )}
      </div>

      {proposals.length > 1 && (
        <div className="border-t border-border p-3">
          <Button className="w-full" onClick={approveAll}>
            Approve all ({proposals.length})
          </Button>
        </div>
      )}

      {currentDay !== null && advanceSeed !== null && (
        <AdvanceDateDialog
          campaignId={campaignId}
          currentDay={currentDay}
          epochLabel={epochLabel}
          seedToDay={advanceSeed}
          open
          onOpenChange={(open) => !open && setAdvanceSeed(null)}
          onApplied={() => {
            setAdvanceSeed(null);
            onApplied();
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the trigger to the session note page**

In `components/sessions/SessionNoteDetail.tsx`:

1. Add state: `const [reviewing, setReviewing] = useState(false);` and `const [status, setStatus] = useState<{ reviewable: boolean; needsReview: boolean } | null>(null);`
2. On mount, fetch `/api/campaigns/${campaignId}/state/review/status?sessionNoteId=${id}` into `status`, and fetch `/api/campaigns/${campaignId}/state` for `currentDay` / `epochLabel`.
3. Render a button in the note's header area:

```tsx
{status?.reviewable && (
  <Button variant={status.needsReview ? "default" : "ghost"} size="sm" onClick={() => setReviewing(true)}>
    Review session
    {status.needsReview && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary-foreground" aria-label="has unreviewed changes" />}
  </Button>
)}
```

4. Render the slide-over when open:

```tsx
{reviewing && (
  <ReviewSlideOver
    campaignId={campaignId}
    sessionNoteId={id}
    currentDay={campaignState?.currentDay ?? null}
    epochLabel={campaignState?.epochLabel ?? ""}
    onClose={() => setReviewing(false)}
    onApplied={() => { /* refetch the status badge */ }}
  />
)}
```

Match the file's existing prop names and data-loading style rather than copying these identifiers blindly.

- [ ] **Step 3: Verify in the browser end to end**

1. Open a session note with a linked Notion page. Confirm **Review session** appears with the unreviewed dot.
2. Click it. Confirm narration streams in and proposals appear, each under a quoted citation.
3. Approve a thread-open proposal. Confirm it appears on `/chronicle`'s Threads tab.
4. Approve a date-advance proposal. Confirm it opens the advance dialog seeded with the right number of days rather than applying blind.
5. Reload the note and confirm the unreviewed dot is gone (the review row was written).
6. **Stale guard:** run a review, then edit the Notion page and let a background sync pick it up (or edit the page and wait for the auto-sync interval) while the slide-over is still open. Click Approve — expect the orange "this page changed" warning and no write. Click Approve again — expect it to apply.
7. Check `read_console_messages` and `preview_logs` for errors.

- [ ] **Step 4: Commit**

```bash
git add components/state/ReviewSlideOver.tsx components/sessions/SessionNoteDetail.tsx
git commit -m "feat(state): post-session review slide-over with cited proposals"
```

---

### Task 16: Inline threads on entity detail pages

Where the feature actually pays off: you learn a faction has three open threads while reading the faction.

**Files:**
- Modify: `app/api/threads/route.ts`
- Create: `components/state/EntityThreadsBlock.tsx`
- Modify: `components/glossary/SimpleEntityDetail.tsx`

- [ ] **Step 1: Support target filtering on the threads route**

In `app/api/threads/route.ts`, import `listThreadsForTarget` and add this branch inside `GET`, immediately after `currentDay` is resolved:

```ts
  const targetKind = searchParams.get("targetKind");
  const targetId = searchParams.get("targetId");
  if (targetKind && targetId) {
    const items = await listThreadsForTarget(
      sdb,
      campaignId,
      targetKind as "character" | "location" | "item" | "faction" | "session",
      targetId,
      currentDay,
    );
    return NextResponse.json({ items, currentDay });
  }
```

- [ ] **Step 2: Create the block**

Create `components/state/EntityThreadsBlock.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClockDial } from "./ClockDial";
import type { ThreadView, ClockView } from "./chronicle-types";

interface EntityThreadsBlockProps {
  campaignId: string;
  targetKind: "character" | "location" | "item" | "faction";
  targetId: string;
}

export function EntityThreadsBlock({ campaignId, targetKind, targetId }: EntityThreadsBlockProps) {
  const [threads, setThreads] = useState<ThreadView[]>([]);
  const [clocks, setClocks] = useState<ClockView[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const tRes = await fetch(
        `/api/threads?campaignId=${campaignId}&targetKind=${targetKind}&targetId=${targetId}`,
      );
      if (tRes.ok && !cancelled) setThreads((await tRes.json()).items ?? []);

      // Clocks are owned, not linked, so they come from the clock list.
      const cRes = await fetch(`/api/clocks?campaignId=${campaignId}`);
      if (cRes.ok && !cancelled) {
        const all: ClockView[] = (await cRes.json()).items ?? [];
        setClocks(all.filter((c) => c.ownerKind === targetKind && c.ownerId === targetId));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [campaignId, targetKind, targetId]);

  if (!threads.length && !clocks.length) return null;

  return (
    <section className="space-y-3">
      {threads.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Open threads ({threads.length})
          </h3>
          <ul className="space-y-1.5">
            {threads.map((t) => (
              <li key={t.id} className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{t.title}</span>
                  {t.daysUntouched !== null && (
                    <span className="flex-none text-xs tabular-nums text-muted-foreground">
                      {t.daysUntouched}d
                    </span>
                  )}
                </div>
                {t.stakes && <p className="mt-0.5 text-xs text-muted-foreground">{t.stakes}</p>}
              </li>
            ))}
          </ul>
          <Link href={`/chronicle?campaignId=${campaignId}`} className="mt-2 inline-block text-xs text-primary hover:underline">
            Open the chronicle →
          </Link>
        </div>
      )}

      {clocks.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Clocks</h3>
          <div className="flex flex-wrap gap-4">
            {clocks.map((c) => (
              <ClockDial key={c.id} name={c.name} segments={c.segments} filled={c.filled} status={c.status} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Mount it on the detail pages**

In `components/glossary/SimpleEntityDetail.tsx`, render `<EntityThreadsBlock>` in the same column as the existing `linkedCharacters` / `mapMarkers` blocks (around the `RelatedCard` usage near line 220). Derive `targetKind` from the existing `resourcePath` prop by stripping the trailing `s`:

```tsx
<EntityThreadsBlock
  campaignId={entity.campaignId}
  targetKind={resourcePath.replace(/s$/, "") as "character" | "location" | "item" | "faction"}
  targetId={entity.id}
/>
```

The block renders nothing when there are no threads or clocks, so it is safe to mount unconditionally. Also update the "No description or linked characters yet" empty-state condition so it does not claim emptiness when threads exist.

- [ ] **Step 4: Verify in the browser**

1. On `/chronicle`, create a thread linked to a faction (via the console if the edit dialog does not yet support links):
   `fetch("/api/threads",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({campaignId:"<id>",title:"Assembly hunts them",stakes:"They are being tracked.",links:[{targetKind:"faction",targetId:"<factionId>",role:"stakeholder"}]})})`
2. Open that faction's detail page. Confirm the "Open threads (1)" block renders with the staleness count.
3. Create a clock owned by the same faction and confirm its dial appears.
4. Open a faction with no threads and confirm no empty block renders.

- [ ] **Step 5: Commit**

```bash
git add app/api/threads/route.ts components/state/EntityThreadsBlock.tsx components/glossary/SimpleEntityDetail.tsx
git commit -m "feat(state): inline thread and clock blocks on entity detail pages"
```

---

### Task 17: Command palette and assistant integration

Two cheap wins that make the state reachable from where the DM already works.

**Files:**
- Modify: `lib/assistant/read-tools.ts`
- Modify: `lib/assistant/tools.ts`
- Modify: `lib/assistant/tools.test.ts`
- Modify: `components/shell/CommandPalette.tsx`

- [ ] **Step 1: Write the failing test**

In `lib/assistant/tools.test.ts`, update the expected tool-name list to include the two new names:

```ts
    expect(names).toEqual([
      "get_entity", "get_map_context", "get_relationships",
      "list_clocks", "list_entities", "list_monsters", "list_open_threads",
      "propose_encounter", "propose_entity", "propose_marker", "propose_notion_sync",
      "search_entities", "search_reference",
    ]);
```

And add:

```ts
  it("list_open_threads returns the campaign's open threads", async () => {
    const { db, campaignId } = createTestDb();
    const { createThread } = await import("@/lib/state/threads");
    await createThread(db, { campaignId, title: "Find Ovid", currentDay: 100 });

    const tool = buildTools(db, campaignId).find((t) => t.name === "list_open_threads")!;
    const run = tool.run as (input: Record<string, never>) => Promise<string>;
    expect(JSON.parse(await run({}))[0]).toMatchObject({ title: "Find Ovid" });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/assistant/tools.test.ts`
Expected: FAIL — the name list does not match and `list_open_threads` is not found.

- [ ] **Step 3: Add the tools**

In `lib/assistant/tools.ts`, import the repos and add two entries to the returned array, next to the other read tools:

```ts
import { listThreads } from "@/lib/state/threads";
import { listClocks } from "@/lib/state/clocks";
import { getCampaignDay } from "@/lib/state/advance";
```

```ts
    betaZodTool({
      name: "list_open_threads",
      description: "List the campaign's open plot threads with their stakes and how long each has gone untouched. Use for 'what's still unresolved' questions.",
      inputSchema: z.object({}),
      run: async () => j(await listThreads(db, campaignId, { currentDay: await getCampaignDay(db, campaignId) })),
    }),
    betaZodTool({
      name: "list_clocks",
      description: "List the campaign's progress clocks with filled/segments, owner, and status. Use for 'how close is X' questions.",
      inputSchema: z.object({}),
      run: async () => j(await listClocks(db, campaignId)),
    }),
```

`buildTools` receives `db: AppDb`, which is structurally the same drizzle instance as `StateDb`; if TypeScript complains, widen the call with `db as unknown as StateDb` rather than changing either alias.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/assistant/tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Extend the command palette**

In `components/shell/CommandPalette.tsx`, follow the existing search and command patterns to add:

1. **Thread search** — fetch `/api/threads?campaignId=<id>` alongside the existing entity search, match on `title`, and navigate to `/chronicle?campaignId=<id>` on select. Match the file's existing result-grouping shape; do not invent a new one.
2. **A static command** — "Advance in-world date", navigating to `/chronicle?campaignId=<id>` with the Timeline tab active. If the existing palette has no mechanism for a static action, add it as a single result row in the same shape as the others.

Scope the thread fetch to the active campaign. The hub shell sub-project shipped a cross-campaign leak in this exact file once — the fix was passing `campaignId` on every search request, so do not omit it.

- [ ] **Step 6: Verify in the browser**

Open ⌘K, type part of a thread title, confirm it appears and navigates to `/chronicle`. Confirm no results from another campaign appear if you have more than one. In the assistant panel, ask "what's still open?" and confirm it calls `list_open_threads` and answers from real data.

- [ ] **Step 7: Full verification**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass. The production build is the one that catches `useSearchParams`-without-`Suspense`.

- [ ] **Step 8: Commit**

```bash
git add lib/assistant components/shell/CommandPalette.tsx
git commit -m "feat(state): expose threads and clocks to the assistant and command palette"
```

---

## Done criteria

The feature is complete when all of the following hold:

1. `npm test`, `npx tsc --noEmit`, `npm run lint`, and `npm run build` all pass.
2. `/chronicle` prompts for an in-world date on a fresh campaign, and refuses to advance time before one is set.
3. Advancing time previews due ticks, applies only the checked ones, preserves remainder credit, and skips (does not defer) the unchecked ones.
4. Correcting the date via "Correct date" never ticks a clock.
5. A session note with a Notion page shows "Review session", badged when never reviewed or when the page changed since the last review.
6. Every proposal in the review sheet renders a verbatim citation above it; the summary line reports how many were discarded for an ungrounded citation.
7. Approving a thread proposal creates the thread and it appears on the Threads tab and on the linked entity's detail page.
8. A date-advance proposal opens the advance dialog seeded with the proposed day instead of applying blind.
9. Approving against a Notion page that changed since the review warns once before applying.
10. The timeline records every applied change with its source (`manual` / `from review` / `time`).
