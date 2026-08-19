# Session Run Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/run`, an at-table mode that answers "who is this and what do they want" from local SQLite in milliseconds, and captures one-keystroke marks that feed the #18 post-session review.

**Architecture:** Briefings are a projection built during prep — an Anthropic call per entity writes structured fields into `entity_briefings`, and a single FTS5 `search_index` table serves lookups. During a session `/run` reads only local SQLite: no Notion, no model, no embeddings. Marks are timestamped beats written optimistically with a `localStorage`-backed retry queue.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, drizzle-orm + better-sqlite3 (SQLite with FTS5), zustand, Tailwind 4, vitest, `@anthropic-ai/sdk`.

---

## Conventions you must follow

Read these before Task 1. Every task assumes them.

**Migrations are hand-written SQL.** There are no drizzle migration files. `lib/db/migrate.ts` runs `CREATE TABLE IF NOT EXISTS` statements plus an `addColumnIfMissing` helper. Add new tables there; `lib/db/schema.ts` is the drizzle mirror used for typed queries.

**Tests live in `lib/`.** `vitest.config.ts` only includes `lib/**/*.test.ts` and `components/**/*.test.ts`, environment `node`. There is no React test runner — `.tsx` files are never tested. Keep logic in `lib/` so it is testable, and keep components thin.

**Test databases come from `createTestDb()`** in `lib/notion/test-helpers.ts`. It writes a temp DB file, runs `runMigrations()`, and returns `{ db, campaignId }`.

**Polymorphic targets carry no `.references()`.** Follow the `thread_links` precedent in `lib/db/schema.ts:269` — a `targetKind` + `targetId` pair whose table varies cannot have one FK, and dangling ids are preferred over cascading away history. Add the same explanatory comment.

**Repos take the db as their first argument** and use the `StateDb` type from `lib/state/types.ts`. See `lib/state/threads.ts`.

**Routes validate input, then map errors** with `toClientErrorMessage` from `lib/state/errors.ts`. See `app/api/threads/route.ts`.

**Run tests with:**

```bash
npm test
```

**Run one file with:**

```bash
npx vitest run lib/run/search-index.test.ts
```

---

### Task 1: Database tables

**Files:**
- Modify: `lib/db/migrate.ts` (append before the `sqlite.close()` call at the end)
- Modify: `lib/db/schema.ts` (append before the type exports block)

- [ ] **Step 1: Add the three tables and the FTS index to migrate.ts**

Find the vec0 virtual table block near the end of `runMigrations()` (it starts with the comment `// Vector table for reference search`). Insert this **immediately before** it:

```ts
  // Sub-project 19: session run mode.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS entity_briefings (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      identity TEXT,
      wants TEXT,
      party_knows TEXT,
      secret TEXT,
      voice TEXT,
      aliases TEXT NOT NULL DEFAULT '[]',
      source_hash TEXT NOT NULL,
      manual_fields TEXT NOT NULL DEFAULT '[]',
      partial INTEGER NOT NULL DEFAULT 0,
      built_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_briefings_target
      ON entity_briefings (campaign_id, target_kind, target_id);

    CREATE TABLE IF NOT EXISTS run_sessions (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      label TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      session_note_id TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_run_sessions_campaign
      ON run_sessions (campaign_id, started_at);

    CREATE TABLE IF NOT EXISTS session_marks (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      run_session_id TEXT NOT NULL REFERENCES run_sessions(id) ON DELETE CASCADE,
      at_ms INTEGER NOT NULL,
      wall_clock INTEGER NOT NULL,
      tag TEXT,
      note TEXT,
      context_kind TEXT,
      context_id TEXT,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      local_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_session_marks_run
      ON session_marks (run_session_id, at_ms);
  `);

  // Additive: session_marks existed before local_id (see above), so a
  // database created before this migration needs the column added rather
  // than relying on the CREATE TABLE. The unique index makes a retried mark
  // write idempotent (lib/run/marks.ts createMark dedupes on local_id) —
  // partial so the many pre-existing rows with no local_id don't collide
  // with each other under NULL.
  addColumnIfMissing("session_marks", "local_id", "TEXT");
  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_session_marks_local
      ON session_marks (local_id) WHERE local_id IS NOT NULL;
  `);

  // FTS5 index backing /api/search. Standalone (not external-content): rows are
  // written by lib/run/search-index.ts on entity and briefing writes, so the
  // index survives even when an entity has no briefing yet.
  sqlite.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    campaign_id UNINDEXED,
    kind UNINDEXED,
    target_id UNINDEXED,
    name,
    aliases,
    body
  );`);
```

`addColumnIfMissing` is defined further down in `runMigrations()` (the additive-migrations block, used for `combatants`, `maps`, etc.). Since `session_marks` itself is created in this later sub-project-19 block rather than the file's opening `CREATE TABLE` block, the `addColumnIfMissing("session_marks", ...)` call above must run after this whole block, not be folded into that earlier additive-migrations section — the table doesn't exist yet at that point.

- [ ] **Step 2: Add the drizzle mirrors to schema.ts**

Insert immediately before the line `export type Encounter = typeof encounters.$inferSelect;`:

```ts
export const entityBriefings = sqliteTable("entity_briefings", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  // character | location | item | faction
  targetKind: text("target_kind").notNull(),
  // Polymorphic (its table depends on targetKind), so it cannot carry a single
  // FK target. No .references() by design. Ids may dangle.
  targetId: text("target_id").notNull(),
  identity: text("identity"),
  wants: text("wants"),
  partyKnows: text("party_knows"),
  // DM-only. Never indexed for search and never rendered on the default card.
  secret: text("secret"),
  voice: text("voice"),
  // JSON array of strings.
  aliases: text("aliases").notNull().default("[]"),
  sourceHash: text("source_hash").notNull(),
  // JSON array of field names the DM edited by hand; a rebuild leaves these alone.
  manualFields: text("manual_fields").notNull().default("[]"),
  // True when built without the Notion page body — either the fetch failed or
  // the page had no readable content. Not specifically "Notion was unreachable".
  partial: integer("partial", { mode: "boolean" }).notNull().default(false),
  builtAt: integer("built_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const runSessions = sqliteTable("run_sessions", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  label: text("label"),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp" }),
  // Deliberately no .references(): linked once the transcript lands, and
  // deleting that note must not cascade away the run. Same rationale as
  // threads.openedSessionId. Ids may dangle.
  sessionNoteId: text("session_note_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const sessionMarks = sqliteTable("session_marks", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  runSessionId: text("run_session_id").notNull().references(() => runSessions.id, { onDelete: "cascade" }),
  // Milliseconds since the run started.
  atMs: integer("at_ms").notNull(),
  wallClock: integer("wall_clock", { mode: "timestamp" }).notNull(),
  // npc | promise | loot | lore | todo | null
  tag: text("tag"),
  note: text("note"),
  // What was on screen: an entity kind, "encounter", or null. Polymorphic, so
  // no .references() — same rationale as thread_links.
  contextKind: text("context_kind"),
  contextId: text("context_id"),
  resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  // Client-generated. Lets createMark() dedupe a retried write that succeeded
  // server-side but whose response was lost — see lib/run/marks.ts. Nullable:
  // rows written before this column existed have none.
  localId: text("local_id"),
});
```

Then append to the type-export block at the bottom of the file:

```ts
export type EntityBriefing = typeof entityBriefings.$inferSelect;
export type NewEntityBriefing = typeof entityBriefings.$inferInsert;
export type RunSession = typeof runSessions.$inferSelect;
export type NewRunSession = typeof runSessions.$inferInsert;
export type SessionMark = typeof sessionMarks.$inferSelect;
export type NewSessionMark = typeof sessionMarks.$inferInsert;
```

- [ ] **Step 3: Write a migration test**

Create `lib/run/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/lib/notion/test-helpers";

describe("run mode migrations", () => {
  it("creates the three run-mode tables", () => {
    const { db } = createTestDb();
    const rows = db.all<{ name: string }>(sql`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('entity_briefings', 'run_sessions', 'session_marks')
      ORDER BY name
    `);
    expect(rows.map((r) => r.name)).toEqual(["entity_briefings", "run_sessions", "session_marks"]);
  });

  it("creates the FTS5 search index and accepts a MATCH query", () => {
    const { db, campaignId } = createTestDb();
    db.run(sql`
      INSERT INTO search_index (campaign_id, kind, target_id, name, aliases, body)
      VALUES (${campaignId}, 'character', 'c1', 'Garrick Veldros', 'the mask guy', 'A broker of favours.')
    `);
    const hits = db.all<{ name: string }>(sql`
      SELECT name FROM search_index WHERE search_index MATCH 'garr*'
    `);
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe("Garrick Veldros");
  });

  it("enforces one briefing per target", () => {
    const { db, campaignId } = createTestDb();
    const insert = (id: string) => db.run(sql`
      INSERT INTO entity_briefings (id, campaign_id, target_kind, target_id, source_hash, built_at, created_at, updated_at)
      VALUES (${id}, ${campaignId}, 'character', 'c1', 'h', 1, 1, 1)
    `);
    insert("b1");
    expect(() => insert("b2")).toThrow();
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/run/schema.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/db/migrate.ts lib/db/schema.ts lib/run/schema.test.ts
git commit -m "feat(run): briefing, run session, mark tables and FTS index"
```

---

### Task 2: FTS query sanitising

An unsanitised string passed to `MATCH` throws a SQLite syntax error — `"` , `*`, `(`, `AND`, and a bare `-` are all FTS5 operators. This module is the only place that builds a MATCH expression.

**Files:**
- Create: `lib/run/fts.ts`
- Test: `lib/run/fts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/run/fts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toFtsQuery } from "./fts";

describe("toFtsQuery", () => {
  it("turns a single word into a quoted prefix term", () => {
    expect(toFtsQuery("garr")).toBe('"garr"*');
  });

  it("ANDs multiple words, each a prefix term", () => {
    expect(toFtsQuery("mask guy")).toBe('"mask"* AND "guy"*');
  });

  it("strips FTS operators rather than passing them through", () => {
    expect(toFtsQuery('mask" OR guy')).toBe('"mask"* AND "or"* AND "guy"*');
  });

  it("keeps digits and drops punctuation", () => {
    expect(toFtsQuery("session #29!")).toBe('"session"* AND "29"*');
  });

  it("returns null for a query with no usable characters", () => {
    expect(toFtsQuery("   ")).toBeNull();
    expect(toFtsQuery("***")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/run/fts.test.ts`
Expected: FAIL — `Failed to resolve import "./fts"`.

- [ ] **Step 3: Write the implementation**

Create `lib/run/fts.ts`:

```ts
/**
 * Build an FTS5 MATCH expression from raw DM input.
 *
 * Everything outside [a-z0-9] is dropped rather than escaped: FTS5 treats `"`,
 * `*`, `(`, `-`, `OR`, and `NEAR` as syntax, and a stray one raises a SQLite
 * error rather than returning no rows. At the table there is no room for a
 * query that throws, so the input is reduced to plain lowercase tokens and each
 * is quoted and given the prefix operator.
 *
 * Returns null when nothing usable survives — callers should return no results
 * rather than issuing a MATCH.
 */
export function toFtsQuery(raw: string): string | null {
  const tokens = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(" AND ");
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/run/fts.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/run/fts.ts lib/run/fts.test.ts
git commit -m "feat(run): sanitise DM input into an FTS5 prefix query"
```

---

### Task 3: Search index maintenance and query

**Files:**
- Create: `lib/run/search-index.ts`
- Test: `lib/run/search-index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/run/search-index.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/lib/notion/test-helpers";
import { indexEntity, indexBriefing, removeFromIndex, searchIndex } from "./search-index";

function seedCharacter(db: ReturnType<typeof createTestDb>["db"], campaignId: string, id: string, name: string, description: string | null) {
  db.run(sql`
    INSERT INTO characters (id, campaign_id, name, type, description, archived, created_at, updated_at)
    VALUES (${id}, ${campaignId}, ${name}, 'npc', ${description}, 0, 1, 1)
  `);
}

describe("indexEntity", () => {
  it("makes an entity findable with no briefing present", async () => {
    const { db, campaignId } = createTestDb();
    seedCharacter(db, campaignId, "c1", "Garrick Veldros", "A broker of favours.");
    await indexEntity(db, { campaignId, kind: "character", targetId: "c1", name: "Garrick Veldros", body: "A broker of favours." });

    const hits = await searchIndex(db, { campaignId, q: "garr" });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: "character", targetId: "c1", name: "Garrick Veldros" });
  });

  it("replaces the row rather than duplicating it on re-index", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId, kind: "character", targetId: "c1", name: "Garrick", body: null });
    await indexEntity(db, { campaignId, kind: "character", targetId: "c1", name: "Garrick Veldros", body: null });
    const hits = await searchIndex(db, { campaignId, q: "garrick" });
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe("Garrick Veldros");
  });
});

describe("indexBriefing", () => {
  it("enriches an existing row with aliases and briefing body", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId, kind: "character", targetId: "c1", name: "Garrick Veldros", body: "A broker." });
    await indexBriefing(db, {
      campaignId, kind: "character", targetId: "c1",
      aliases: ["the mask guy"],
      identity: "A broker of favours in Druvenlode.",
      wants: "Leverage over the Assembly.",
      partyKnows: "That he sold them a forged writ.",
    });

    const byAlias = await searchIndex(db, { campaignId, q: "mask guy" });
    expect(byAlias.map((h) => h.targetId)).toEqual(["c1"]);
    const byWant = await searchIndex(db, { campaignId, q: "assembly" });
    expect(byWant.map((h) => h.targetId)).toEqual(["c1"]);
  });

  it("never indexes the secret field", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId, kind: "character", targetId: "c1", name: "Garrick", body: null });
    await indexBriefing(db, {
      campaignId, kind: "character", targetId: "c1",
      aliases: [], identity: null, wants: null, partyKnows: null,
      secret: "He is the Assembly's informant.",
    });
    expect(await searchIndex(db, { campaignId, q: "informant" })).toEqual([]);
  });
});

describe("searchIndex", () => {
  it("ranks exact name above alias above body", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId, kind: "character", targetId: "body", name: "Pelara Voss", body: null });
    await indexBriefing(db, { campaignId, kind: "character", targetId: "body", aliases: [], identity: "Sworn enemy of Mereth.", wants: null, partyKnows: null });
    await indexEntity(db, { campaignId, kind: "character", targetId: "alias", name: "Elfryn Voss", body: null });
    await indexBriefing(db, { campaignId, kind: "character", targetId: "alias", aliases: ["Mereth"], identity: null, wants: null, partyKnows: null });
    await indexEntity(db, { campaignId, kind: "character", targetId: "exact", name: "Mereth", body: null });

    const hits = await searchIndex(db, { campaignId, q: "mereth" });
    expect(hits.map((h) => h.targetId)).toEqual(["exact", "alias", "body"]);
  });

  it("scopes results to the campaign", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId, kind: "character", targetId: "mine", name: "Mereth Kain", body: null });
    await indexEntity(db, { campaignId: "other-campaign", kind: "character", targetId: "theirs", name: "Mereth Kain", body: null });
    const hits = await searchIndex(db, { campaignId, q: "mereth" });
    expect(hits.map((h) => h.targetId)).toEqual(["mine"]);
  });

  it("filters by kind when asked", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId, kind: "character", targetId: "c1", name: "Druvenlode Watch", body: null });
    await indexEntity(db, { campaignId, kind: "location", targetId: "l1", name: "Druvenlode", body: null });
    const hits = await searchIndex(db, { campaignId, q: "druvenlode", kinds: ["location"] });
    expect(hits.map((h) => h.targetId)).toEqual(["l1"]);
  });

  it("returns no results for an unusable query instead of throwing", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId, kind: "character", targetId: "c1", name: "Mereth", body: null });
    expect(await searchIndex(db, { campaignId, q: '"""' })).toEqual([]);
  });

  // A DM reading "Al'Jinn" off their own screen will often type it without the
  // punctuation. FTS tokenises the stored name as "al" + "jinn", so the single
  // token "aljinn" prefix-matches neither and the DM gets silence.
  it("finds a name typed without its punctuation", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId, kind: "character", targetId: "c1", name: "Al'Jinn", body: null });
    expect((await searchIndex(db, { campaignId, q: "aljinn" })).map((h) => h.targetId)).toEqual(["c1"]);
  });

  it("finds a two-word name typed as one word", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId, kind: "character", targetId: "c1", name: "Mereth Kain", body: null });
    expect((await searchIndex(db, { campaignId, q: "merethkain" })).map((h) => h.targetId)).toEqual(["c1"]);
  });

  it("prefers the FTS result and does not fall back when FTS already matched", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId, kind: "character", targetId: "exact", name: "Mereth", body: null });
    await indexEntity(db, { campaignId, kind: "character", targetId: "other", name: "Merethkain Hall", body: null });
    expect((await searchIndex(db, { campaignId, q: "mereth" })).map((h) => h.targetId)).toEqual(["exact", "other"]);
  });

  it("keeps the flattened fallback inside the campaign", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId: "other-campaign", kind: "character", targetId: "theirs", name: "Al'Jinn", body: null });
    expect(await searchIndex(db, { campaignId, q: "aljinn" })).toEqual([]);
  });

  it("makes a briefed entity findable by name even if it was never indexed", async () => {
    const { db, campaignId } = createTestDb();
    seedCharacter(db, campaignId, "c1", "Garrick Veldros", null);
    // No indexEntity call — the briefing repo may run before anything indexed it.
    await indexBriefing(db, {
      campaignId, kind: "character", targetId: "c1",
      aliases: [], identity: null, wants: null, partyKnows: null,
    });
    expect((await searchIndex(db, { campaignId, q: "garrick" })).map((h) => h.targetId)).toEqual(["c1"]);
  });

  it("keeps briefing-derived aliases through a later rename", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId, kind: "character", targetId: "c1", name: "Garrick Veldros", body: null });
    await indexBriefing(db, {
      campaignId, kind: "character", targetId: "c1",
      aliases: ["the mask guy"], identity: null, wants: null, partyKnows: null,
    });
    await indexEntity(db, { campaignId, kind: "character", targetId: "c1", name: "Garrick Veldros II", body: null });

    expect((await searchIndex(db, { campaignId, q: "mask guy" })).map((h) => h.targetId)).toEqual(["c1"]);
    expect((await searchIndex(db, { campaignId, q: "veldros" })).map((h) => h.targetId)).toEqual(["c1"]);
  });
});

describe("removeFromIndex", () => {
  it("drops the row", async () => {
    const { db, campaignId } = createTestDb();
    await indexEntity(db, { campaignId, kind: "character", targetId: "c1", name: "Mereth", body: null });
    await removeFromIndex(db, { campaignId, kind: "character", targetId: "c1" });
    expect(await searchIndex(db, { campaignId, q: "mereth" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/run/search-index.test.ts`
Expected: FAIL — `Failed to resolve import "./search-index"`.

- [ ] **Step 3: Write the implementation**

Create `lib/run/search-index.ts`:

```ts
import { sql } from "drizzle-orm";
import type { StateDb } from "@/lib/state/types";
import { toFtsQuery } from "./fts";

export type SearchKind = "character" | "location" | "item" | "faction" | "thread" | "clock";

export interface SearchHit {
  kind: SearchKind;
  targetId: string;
  name: string;
}

interface IndexRow {
  campaignId: string;
  kind: SearchKind;
  targetId: string;
  name: string;
  body: string | null;
}

interface BriefingRow {
  campaignId: string;
  kind: SearchKind;
  targetId: string;
  aliases: string[];
  identity: string | null;
  wants: string | null;
  partyKnows: string | null;
  /** Accepted so callers can pass a whole briefing; deliberately never indexed. */
  secret?: string | null;
}

/** Read the current row for a target, if any. */
function readRow(
  db: StateDb,
  campaignId: string,
  kind: string,
  targetId: string,
): { name: string; aliases: string; body: string } | undefined {
  return db.all<{ name: string; aliases: string; body: string }>(sql`
    SELECT name, aliases, body FROM search_index
    WHERE campaign_id = ${campaignId} AND kind = ${kind} AND target_id = ${targetId}
  `)[0];
}

function deleteRow(db: StateDb, campaignId: string, kind: string, targetId: string): void {
  db.run(sql`
    DELETE FROM search_index
    WHERE campaign_id = ${campaignId} AND kind = ${kind} AND target_id = ${targetId}
  `);
}

function writeRow(
  db: StateDb,
  campaignId: string,
  kind: string,
  targetId: string,
  name: string,
  aliases: string,
  body: string,
): void {
  deleteRow(db, campaignId, kind, targetId);
  db.run(sql`
    INSERT INTO search_index (campaign_id, kind, target_id, name, aliases, body)
    VALUES (${campaignId}, ${kind}, ${targetId}, ${name}, ${aliases}, ${body})
  `);
}

/**
 * Index (or re-index) a searchable object from its own table. Called on entity,
 * thread, and clock writes. An entity is findable whether or not it has a
 * briefing — that is what keeps the fallback card reachable.
 */
export async function indexEntity(db: StateDb, row: IndexRow): Promise<void> {
  const existing = readRow(db, row.campaignId, row.kind, row.targetId);
  // Preserve briefing-derived aliases; only a briefing write owns that column.
  const aliases = existing?.aliases ?? "";
  writeRow(db, row.campaignId, row.kind, row.targetId, row.name, aliases, row.body ?? "");
}

/**
 * Entity tables a briefing can belong to. Threads and clocks never carry
 * briefings, so they are absent by design.
 */
const ENTITY_TABLE_FOR_KIND: Partial<Record<SearchKind, string>> = {
  character: "characters",
  location: "locations",
  item: "items",
  faction: "factions",
};

/**
 * Read an entity's own name. Used when a briefing arrives for something that was
 * never indexed, so the row can still be written with a real name. Returns ""
 * for a dangling id — thread_links and briefings both tolerate those by design.
 */
function lookupEntityName(
  db: StateDb,
  campaignId: string,
  kind: SearchKind,
  targetId: string,
): string {
  const table = ENTITY_TABLE_FOR_KIND[kind];
  if (!table) return "";
  const row = db.all<{ name: string }>(sql`
    SELECT name FROM ${sql.raw(table)}
    WHERE id = ${targetId} AND campaign_id = ${campaignId}
  `)[0];
  return row?.name ?? "";
}

/**
 * Enrich the row with briefing content.
 *
 * When the entity was never indexed, its name is read from its own table rather
 * than left blank — the briefing repo calls this without a name in hand, and on
 * a database whose index has not been backfilled that would otherwise write a
 * row matching nothing at all.
 *
 * `secret` is never written: a DM-only field that can be retrieved by typing its
 * contents into a search box is not DM-only.
 */
export async function indexBriefing(db: StateDb, row: BriefingRow): Promise<void> {
  const existing = readRow(db, row.campaignId, row.kind, row.targetId);
  const body = [row.identity, row.wants, row.partyKnows].filter(Boolean).join(" ");
  // `||` rather than `??`: an existing row with a blank name (written by an
  // older build) should self-heal on the next briefing write.
  const name = existing?.name || lookupEntityName(db, row.campaignId, row.kind, row.targetId);
  writeRow(db, row.campaignId, row.kind, row.targetId, name, row.aliases.join(" "), body);
}

export async function removeFromIndex(
  db: StateDb,
  target: { campaignId: string; kind: SearchKind; targetId: string },
): Promise<void> {
  deleteRow(db, target.campaignId, target.kind, target.targetId);
}

/**
 * Ranked lookup. Tier ordering is explicit rather than left to bm25: at the
 * table an exact name match must win, and bm25 alone will happily rank a long
 * body paragraph above the name it belongs to.
 */
export async function searchIndex(
  db: StateDb,
  opts: { campaignId: string; q: string; kinds?: SearchKind[]; limit?: number },
): Promise<SearchHit[]> {
  const match = toFtsQuery(opts.q);
  if (!match) return [];
  const limit = opts.limit ?? 20;
  // SQLite LIKE treats % and _ as wildcards. Escaped so a query containing them
  // ranks on the literal characters — these tiers exist precisely to make the
  // ordering deterministic, and a stray underscore silently undoes that.
  const needle = opts.q.trim().toLowerCase().replace(/[%_\\]/g, "\\$&");
  const kinds = opts.kinds?.length ? opts.kinds : null;

  const rows = db.all<{ kind: SearchKind; targetId: string; name: string }>(sql`
    SELECT kind, target_id AS targetId, name
    FROM search_index
    WHERE search_index MATCH ${match}
      AND campaign_id = ${opts.campaignId}
      ${kinds ? sql`AND kind IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})` : sql``}
    ORDER BY
      CASE
        WHEN lower(name) = ${needle} THEN 0
        WHEN lower(name) LIKE ${needle + "%"} ESCAPE '\\' THEN 1
        WHEN lower(aliases) LIKE ${"%" + needle + "%"} ESCAPE '\\' THEN 2
        ELSE 3
      END,
      bm25(search_index),
      name
    LIMIT ${limit}
  `);
  if (rows.length > 0) return rows;

  return flattenedFallback(db, opts, limit);
}

/**
 * Last resort when FTS matched nothing.
 *
 * FTS5 splits "Al'Jinn" into the tokens "al" and "jinn", so a DM who reads the
 * name off their own screen and types "aljinn" prefix-matches neither and gets
 * silence — no error, no empty-state hint, just a wrong answer at the worst
 * possible moment. This compares against the name with its punctuation and
 * spaces removed, which is what they actually typed.
 *
 * Only runs when FTS found nothing, so the common path never pays for it. It is
 * a full scan with string functions, which is fine over the few hundred rows one
 * campaign holds and would not be at a much larger scale.
 */
function flattenedFallback(
  db: StateDb,
  opts: { campaignId: string; q: string; kinds?: SearchKind[] },
  limit: number,
): SearchHit[] {
  const flat = opts.q.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!flat) return [];
  const kinds = opts.kinds?.length ? opts.kinds : null;

  // SQLite has no regex, so the separators are stripped by nested replace().
  // These four cover the punctuation that actually appears in entity names.
  const flatName = sql`replace(replace(replace(replace(lower(name), '''', ''), ' ', ''), '-', ''), '.', '')`;

  return db.all<{ kind: SearchKind; targetId: string; name: string }>(sql`
    SELECT kind, target_id AS targetId, name
    FROM search_index
    WHERE campaign_id = ${opts.campaignId}
      ${kinds ? sql`AND kind IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})` : sql``}
      AND ${flatName} LIKE ${flat + "%"}
    ORDER BY length(name), name
    LIMIT ${limit}
  `);
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/run/search-index.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/run/search-index.ts lib/run/search-index.test.ts
git commit -m "feat(run): FTS5 search index with explicit name-over-body ranking"
```

---

### Task 4: Backfill the search index

Existing campaigns have hundreds of rows that predate the index. Without a backfill, `/api/search` returns nothing until every entity happens to be re-saved.

**Files:**
- Modify: `lib/run/search-index.ts` (append)
- Modify: `lib/run/search-index.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Add `rebuildSearchIndex` to the existing `./search-index` import at the top of
`lib/run/search-index.test.ts` — do not add a second import statement from the
same module — then append:

```ts
describe("rebuildSearchIndex", () => {
  it("indexes every entity, thread, and clock in the campaign", async () => {
    const { db, campaignId } = createTestDb();
    db.run(sql`INSERT INTO characters (id, campaign_id, name, type, description, archived, created_at, updated_at)
      VALUES ('c1', ${campaignId}, 'Mereth Kain', 'npc', 'A duellist.', 0, 1, 1)`);
    db.run(sql`INSERT INTO locations (id, campaign_id, name, description, type, archived, created_at, updated_at)
      VALUES ('l1', ${campaignId}, 'Druvenlode', 'A sunken town.', 'town', 0, 1, 1)`);
    db.run(sql`INSERT INTO threads (id, campaign_id, title, stakes, status, archived, created_at, updated_at)
      VALUES ('t1', ${campaignId}, 'Who forged the writ?', 'The party stays hunted.', 'open', 0, 1, 1)`);
    db.run(sql`INSERT INTO clocks (id, campaign_id, name, segments, filled, archived, created_at, updated_at)
      VALUES ('k1', ${campaignId}, 'Assembly closes in', 8, 2, 0, 1, 1)`);

    const count = await rebuildSearchIndex(db, campaignId);
    expect(count).toBe(4);

    expect((await searchIndex(db, { campaignId, q: "mereth" }))[0].targetId).toBe("c1");
    expect((await searchIndex(db, { campaignId, q: "druvenlode" }))[0].targetId).toBe("l1");
    expect((await searchIndex(db, { campaignId, q: "forged" }))[0].targetId).toBe("t1");
    expect((await searchIndex(db, { campaignId, q: "assembly" }))[0].targetId).toBe("k1");
  });

  it("skips archived entities and is safe to run twice", async () => {
    const { db, campaignId } = createTestDb();
    db.run(sql`INSERT INTO characters (id, campaign_id, name, type, description, archived, created_at, updated_at)
      VALUES ('c1', ${campaignId}, 'Mereth Kain', 'npc', NULL, 0, 1, 1)`);
    db.run(sql`INSERT INTO characters (id, campaign_id, name, type, description, archived, created_at, updated_at)
      VALUES ('c2', ${campaignId}, 'Retired Kain', 'npc', NULL, 1, 1, 1)`);

    await rebuildSearchIndex(db, campaignId);
    await rebuildSearchIndex(db, campaignId);

    const hits = await searchIndex(db, { campaignId, q: "kain" });
    expect(hits.map((h) => h.targetId)).toEqual(["c1"]);
  });

  it("carries existing briefing aliases through a rebuild", async () => {
    const { db, campaignId } = createTestDb();
    db.run(sql`INSERT INTO characters (id, campaign_id, name, type, description, archived, created_at, updated_at)
      VALUES ('c1', ${campaignId}, 'Garrick Veldros', 'npc', NULL, 0, 1, 1)`);
    db.run(sql`INSERT INTO entity_briefings (id, campaign_id, target_kind, target_id, identity, aliases, source_hash, built_at, created_at, updated_at)
      VALUES ('b1', ${campaignId}, 'character', 'c1', 'A broker.', '["the mask guy"]', 'h', 1, 1, 1)`);

    await rebuildSearchIndex(db, campaignId);

    const hits = await searchIndex(db, { campaignId, q: "mask guy" });
    expect(hits.map((h) => h.targetId)).toEqual(["c1"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/run/search-index.test.ts`
Expected: FAIL — `rebuildSearchIndex is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `lib/run/search-index.ts`:

```ts
/**
 * Rebuild the whole index for one campaign from the source tables. Run once per
 * campaign at rollout, and available from Settings afterwards. Returns the row
 * count written.
 */
export async function rebuildSearchIndex(db: StateDb, campaignId: string): Promise<number> {
  db.run(sql`DELETE FROM search_index WHERE campaign_id = ${campaignId}`);

  const briefings = db.all<{ targetKind: string; targetId: string; aliases: string; identity: string | null; wants: string | null; partyKnows: string | null }>(sql`
    SELECT target_kind AS targetKind, target_id AS targetId, aliases,
           identity, wants, party_knows AS partyKnows
    FROM entity_briefings WHERE campaign_id = ${campaignId}
  `);
  const briefingByTarget = new Map(briefings.map((b) => [`${b.targetKind}:${b.targetId}`, b]));

  let written = 0;

  const entityTables: { table: string; kind: SearchKind }[] = [
    { table: "characters", kind: "character" },
    { table: "locations", kind: "location" },
    { table: "items", kind: "item" },
    { table: "factions", kind: "faction" },
  ];

  for (const { table, kind } of entityTables) {
    const rows = db.all<{ id: string; name: string; description: string | null }>(sql`
      SELECT id, name, description FROM ${sql.raw(table)}
      WHERE campaign_id = ${campaignId} AND archived = 0
    `);
    for (const row of rows) {
      const b = briefingByTarget.get(`${kind}:${row.id}`);
      const body = b
        ? [b.identity, b.wants, b.partyKnows].filter(Boolean).join(" ")
        : (row.description ?? "");
      let aliases = "";
      if (b) {
        try {
          const parsed: unknown = JSON.parse(b.aliases);
          if (Array.isArray(parsed)) aliases = parsed.filter((a) => typeof a === "string").join(" ");
        } catch {
          // A malformed aliases blob costs alias matching for one entity; it
          // must not abort the whole rebuild.
        }
      }
      writeRow(db, campaignId, kind, row.id, row.name, aliases, body);
      written++;
    }
  }

  const threads = db.all<{ id: string; title: string; stakes: string | null }>(sql`
    SELECT id, title, stakes FROM threads WHERE campaign_id = ${campaignId} AND archived = 0
  `);
  for (const t of threads) {
    writeRow(db, campaignId, "thread", t.id, t.title, "", t.stakes ?? "");
    written++;
  }

  const clocks = db.all<{ id: string; name: string }>(sql`
    SELECT id, name FROM clocks WHERE campaign_id = ${campaignId} AND archived = 0
  `);
  for (const c of clocks) {
    writeRow(db, campaignId, "clock", c.id, c.name, "", "");
    written++;
  }

  return written;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/run/search-index.test.ts`
Expected: PASS, 18 tests (15 from Task 3 plus the 3 added here).

- [ ] **Step 5: Commit**

```bash
git add lib/run/search-index.ts lib/run/search-index.test.ts
git commit -m "feat(run): campaign-wide search index rebuild"
```

---

### Task 5: Replace the search endpoint

The current `app/api/search/route.ts` loads five entire tables and returns name-only rows for the client to filter.

**Files:**
- Modify: `app/api/search/route.ts` (full rewrite)
- Modify: `components/shell/CommandPalette.tsx`

- [ ] **Step 1: Rewrite the route**

Replace the entire contents of `app/api/search/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { searchIndex, rebuildSearchIndex, type SearchKind } from "@/lib/run/search-index";
import { toClientErrorMessage } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";

const sdb: StateDb = db;

const VALID_KINDS: SearchKind[] = ["character", "location", "item", "faction", "thread", "clock"];

const HREF: Record<SearchKind, (id: string, campaignId: string) => string> = {
  character: (id) => `/characters/${id}`,
  location: (id) => `/locations/${id}`,
  item: (id) => `/items/${id}`,
  faction: (id) => `/factions/${id}`,
  thread: (_id, campaignId) => `/chronicle?campaignId=${campaignId}`,
  clock: (_id, campaignId) => `/chronicle?campaignId=${campaignId}`,
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  // Required and enforced here: CommandPalette.tsx carries a comment about a
  // cross-campaign leak this shell shipped once before, and the old endpoint
  // tolerated a missing campaignId by returning everything.
  if (!campaignId) {
    return NextResponse.json({ error: '"campaignId" is required' }, { status: 400 });
  }

  const q = searchParams.get("q") ?? "";
  if (!q.trim()) return NextResponse.json({ items: [] });

  const kindsParam = searchParams.get("kinds");
  const kinds = kindsParam
    ? kindsParam.split(",").filter((k): k is SearchKind => (VALID_KINDS as string[]).includes(k))
    : undefined;

  try {
    const hits = await searchIndex(sdb, { campaignId, q, kinds });
    return NextResponse.json({
      items: hits.map((h) => ({
        id: h.targetId,
        name: h.name,
        type: h.kind,
        href: HREF[h.kind](h.targetId, campaignId),
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status: 400 });
  }
}

/** Rebuild the campaign's index. Called once at rollout and from Settings. */
export async function POST(req: Request) {
  const body = await req.json();
  if (typeof body.campaignId !== "string" || !body.campaignId) {
    return NextResponse.json({ error: '"campaignId" is required and must be a string' }, { status: 400 });
  }
  try {
    const indexed = await rebuildSearchIndex(sdb, body.campaignId);
    return NextResponse.json({ indexed });
  } catch (err) {
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status: 400 });
  }
}
```

- [ ] **Step 2: Update CommandPalette to use the new shape**

In `components/shell/CommandPalette.tsx`, replace the `useEffect` that fetches results (the one beginning `if (!open) return;` and containing `const url = activeCampaignId ? ...`) with a debounced query-driven fetch:

```tsx
  useEffect(() => {
    if (!open) return;
    if (!activeCampaignId) {
      setAllResults([]);
      return;
    }
    // /api/search now requires a campaignId and does the filtering server-side,
    // so results are re-fetched per keystroke rather than filtered client-side.
    // Threads and clocks come back from the same index — the separate
    // /api/threads fetch this component used to make is gone.
    if (!query.trim()) {
      setAllResults([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      fetch(`/api/search?campaignId=${activeCampaignId}&q=${encodeURIComponent(query)}`)
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((data: { items?: SearchResult[] }) => {
          if (!cancelled) setAllResults(data.items ?? []);
        })
        .catch(() => {
          if (!cancelled) setAllResults([]);
        });
    }, 80);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, activeCampaignId]);
```

- [ ] **Step 2b: Keep the command entry the palette already had**

The existing component injects a client-side command result alongside entity
results — `Advance in-world date`, typed `"action"`, pointing at the chronicle
timeline tab — and caps the merged list at 8. That command is **not** a row in
the search index and never will be, so the server cannot return it. Dropping it
would quietly delete a #18 feature from the palette.

Replace the existing `results` memo with one that merges the two sources:

```tsx
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Entities, threads and clocks arrive already filtered from /api/search.
    // Commands are client-side only — they are not rows in the search index —
    // so they still need matching here.
    const commands: SearchResult[] =
      activeCampaignId && q
        ? [
            {
              id: "advance-in-world-date",
              name: "Advance in-world date",
              type: "action",
              href: `/chronicle?campaignId=${activeCampaignId}&tab=timeline`,
            },
          ].filter((c) => c.name.toLowerCase().includes(q))
        : [];
    return [...allResults, ...commands].slice(0, 8);
  }, [query, allResults, activeCampaignId]);
```

Do not filter `allResults` here — the server already did, and re-filtering on a
substring would discard the fallback matches (a DM typing `aljinn` gets `Al'Jinn`
from the server, which `"al'jinn".includes("aljinn")` would then throw away).

- [ ] **Step 3: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. If `tsc` reports an unused import in `CommandPalette.tsx` (the threads fetch is gone), delete it.

- [ ] **Step 4: Verify in the browser**

Start the preview (`preview_start` with the project's dev-server config), open the app, press `Cmd+K`, and type three letters of a known NPC. Expected: results appear. Check `read_console_messages` for errors and `read_network_requests` for a `200` on `/api/search?campaignId=...&q=...`.

If the palette is empty, the index has not been backfilled yet — POST to rebuild:

```bash
curl -s -X POST localhost:3000/api/search -H 'content-type: application/json' -d '{"campaignId":"<your-campaign-id>"}'
```

- [ ] **Step 5: Commit**

```bash
git add app/api/search/route.ts components/shell/CommandPalette.tsx
git commit -m "feat(run): server-side search endpoint over the FTS index"
```

---

### Task 6: Briefing repo

**Files:**
- Create: `lib/run/briefings.ts`
- Test: `lib/run/briefings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/run/briefings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/lib/notion/test-helpers";
import { NotFoundError } from "@/lib/state/errors";
import { getBriefing, upsertBriefing, setManualFields, BRIEFING_FIELDS } from "./briefings";
import { searchIndex } from "./search-index";

const base = { campaignId: "", targetKind: "character" as const, targetId: "c1" };

describe("upsertBriefing", () => {
  it("creates a briefing and returns it with parsed aliases", async () => {
    const { db, campaignId } = createTestDb();
    const b = await upsertBriefing(db, {
      ...base, campaignId,
      identity: "A broker of favours.",
      wants: "Leverage over the Assembly.",
      partyKnows: "That he sold them a forged writ.",
      secret: "He is the Assembly's informant.",
      voice: "Clipped, over-formal, never uses contractions.",
      aliases: ["the mask guy"],
      sourceHash: "h1",
      partial: false,
    });

    expect(b.identity).toBe("A broker of favours.");
    expect(b.aliases).toEqual(["the mask guy"]);
    expect(b.manualFields).toEqual([]);
    expect(b.partial).toBe(false);
  });

  it("updates in place rather than creating a second row", async () => {
    const { db, campaignId } = createTestDb();
    await upsertBriefing(db, { ...base, campaignId, identity: "First", sourceHash: "h1" });
    const second = await upsertBriefing(db, { ...base, campaignId, identity: "Second", sourceHash: "h2" });
    expect(second.identity).toBe("Second");
    expect(second.sourceHash).toBe("h2");

    const fetched = await getBriefing(db, campaignId, "character", "c1");
    expect(fetched?.identity).toBe("Second");
  });

  it("never clobbers a field the DM edited by hand", async () => {
    const { db, campaignId } = createTestDb();
    await upsertBriefing(db, { ...base, campaignId, voice: "Model-written voice.", sourceHash: "h1" });
    await setManualFields(db, campaignId, "character", "c1", { voice: "Clipped. Never contractions." });

    const rebuilt = await upsertBriefing(db, {
      ...base, campaignId,
      identity: "A broker.",
      voice: "A different model-written voice.",
      sourceHash: "h2",
    });

    expect(rebuilt.voice).toBe("Clipped. Never contractions.");
    expect(rebuilt.identity).toBe("A broker.");
    expect(rebuilt.manualFields).toEqual(["voice"]);
  });

  it("clears partial on a successful rebuild", async () => {
    const { db, campaignId } = createTestDb();
    await upsertBriefing(db, { ...base, campaignId, sourceHash: "h1", partial: true });
    const rebuilt = await upsertBriefing(db, { ...base, campaignId, sourceHash: "h2", partial: false });
    expect(rebuilt.partial).toBe(false);
  });

  it("writes the briefing into the search index without the secret", async () => {
    const { db, campaignId } = createTestDb();
    await upsertBriefing(db, {
      ...base, campaignId,
      identity: "A broker of favours.",
      secret: "Informant.",
      aliases: ["the mask guy"],
      sourceHash: "h1",
    });
    expect((await searchIndex(db, { campaignId, q: "mask guy" })).map((h) => h.targetId)).toEqual(["c1"]);
    expect(await searchIndex(db, { campaignId, q: "informant" })).toEqual([]);
  });

  it("rejects an unknown targetKind", async () => {
    const { db, campaignId } = createTestDb();
    await expect(
      upsertBriefing(db, { ...base, campaignId, targetKind: "session" as never, sourceHash: "h" }),
    ).rejects.toThrow(/targetKind/);
  });
});

describe("setManualFields", () => {
  it("records each edited field once", async () => {
    const { db, campaignId } = createTestDb();
    await upsertBriefing(db, { ...base, campaignId, sourceHash: "h1" });
    await setManualFields(db, campaignId, "character", "c1", { voice: "A" });
    const b = await setManualFields(db, campaignId, "character", "c1", { voice: "B", wants: "C" });
    expect(b.voice).toBe("B");
    expect(b.wants).toBe("C");
    expect([...b.manualFields].sort()).toEqual(["voice", "wants"]);
  });

  it("throws when no briefing exists for the target", async () => {
    const { db, campaignId } = createTestDb();
    await expect(
      setManualFields(db, campaignId, "character", "nope", { voice: "A" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects a field name that is not a briefing field", async () => {
    const { db, campaignId } = createTestDb();
    await upsertBriefing(db, { ...base, campaignId, sourceHash: "h1" });
    await expect(
      setManualFields(db, campaignId, "character", "c1", { sourceHash: "x" } as never),
    ).rejects.toThrow(/field/);
  });
});

describe("BRIEFING_FIELDS", () => {
  it("lists exactly the model-writable fields", () => {
    expect([...BRIEFING_FIELDS].sort()).toEqual(
      ["aliases", "identity", "partyKnows", "secret", "voice", "wants"],
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/run/briefings.test.ts`
Expected: FAIL — `Failed to resolve import "./briefings"`.

- [ ] **Step 3: Write the implementation**

Create `lib/run/briefings.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { entityBriefings } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { NotFoundError } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";
import { indexBriefing, type SearchKind } from "./search-index";

export type BriefingTargetKind = "character" | "location" | "item" | "faction";

// Derived from BriefingTargetKind via an exhaustiveness check: the Record
// literal must have exactly one key per union member, so adding a member
// without updating this record is a compile error.
const TARGET_KIND_SET: Record<BriefingTargetKind, true> = {
  character: true,
  location: true,
  item: true,
  faction: true,
};
export const BRIEFING_TARGET_KINDS = Object.keys(TARGET_KIND_SET) as BriefingTargetKind[];

/** The fields a build writes and the DM may override. Never includes sourceHash or partial. */
export const BRIEFING_FIELDS = [
  "identity", "wants", "partyKnows", "secret", "voice", "aliases",
] as const;
export type BriefingField = (typeof BRIEFING_FIELDS)[number];

export interface Briefing {
  id: string;
  campaignId: string;
  targetKind: BriefingTargetKind;
  targetId: string;
  identity: string | null;
  wants: string | null;
  partyKnows: string | null;
  secret: string | null;
  voice: string | null;
  aliases: string[];
  sourceHash: string;
  manualFields: BriefingField[];
  partial: boolean;
  builtAt: Date;
}

export interface UpsertBriefingInput {
  campaignId: string;
  targetKind: BriefingTargetKind;
  targetId: string;
  identity?: string | null;
  wants?: string | null;
  partyKnows?: string | null;
  secret?: string | null;
  voice?: string | null;
  aliases?: string[];
  sourceHash: string;
  partial?: boolean;
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function toBriefing(row: typeof entityBriefings.$inferSelect): Briefing {
  return {
    id: row.id,
    campaignId: row.campaignId,
    targetKind: row.targetKind as BriefingTargetKind,
    targetId: row.targetId,
    identity: row.identity,
    wants: row.wants,
    partyKnows: row.partyKnows,
    secret: row.secret,
    voice: row.voice,
    aliases: parseStringArray(row.aliases),
    sourceHash: row.sourceHash,
    manualFields: parseStringArray(row.manualFields) as BriefingField[],
    partial: row.partial,
    builtAt: row.builtAt,
  };
}

function assertTargetKind(kind: string): asserts kind is BriefingTargetKind {
  if (!(BRIEFING_TARGET_KINDS as string[]).includes(kind)) {
    throw new Error(`Unknown targetKind "${kind}"`);
  }
}

async function readRow(db: StateDb, campaignId: string, targetKind: string, targetId: string) {
  return db.query.entityBriefings.findFirst({
    where: and(
      eq(entityBriefings.campaignId, campaignId),
      eq(entityBriefings.targetKind, targetKind),
      eq(entityBriefings.targetId, targetId),
    ),
  });
}

export async function getBriefing(
  db: StateDb,
  campaignId: string,
  targetKind: string,
  targetId: string,
): Promise<Briefing | null> {
  const row = await readRow(db, campaignId, targetKind, targetId);
  return row ? toBriefing(row) : null;
}

async function syncIndex(db: StateDb, b: Briefing): Promise<void> {
  await indexBriefing(db, {
    campaignId: b.campaignId,
    kind: b.targetKind as SearchKind,
    targetId: b.targetId,
    aliases: b.aliases,
    identity: b.identity,
    wants: b.wants,
    partyKnows: b.partyKnows,
  });
}

/**
 * Write a built briefing. Fields listed in `manualFields` are preserved exactly
 * as the DM left them — a rebuild that silently overwrote a hand-written voice
 * line would make the whole feature untrustworthy.
 */
export async function upsertBriefing(db: StateDb, input: UpsertBriefingInput): Promise<Briefing> {
  assertTargetKind(input.targetKind);
  const now = new Date();
  const existing = await readRow(db, input.campaignId, input.targetKind, input.targetId);
  const manual = existing ? (parseStringArray(existing.manualFields) as BriefingField[]) : [];
  const keep = (field: BriefingField) => manual.includes(field);

  const values = {
    identity: keep("identity") ? existing!.identity : (input.identity ?? null),
    wants: keep("wants") ? existing!.wants : (input.wants ?? null),
    partyKnows: keep("partyKnows") ? existing!.partyKnows : (input.partyKnows ?? null),
    secret: keep("secret") ? existing!.secret : (input.secret ?? null),
    voice: keep("voice") ? existing!.voice : (input.voice ?? null),
    aliases: keep("aliases") ? existing!.aliases : JSON.stringify(input.aliases ?? []),
    sourceHash: input.sourceHash,
    partial: input.partial ?? false,
    builtAt: now,
    updatedAt: now,
  };

  if (existing) {
    await db.update(entityBriefings).set(values).where(eq(entityBriefings.id, existing.id));
  } else {
    await db.insert(entityBriefings).values({
      id: generateId(),
      campaignId: input.campaignId,
      targetKind: input.targetKind,
      targetId: input.targetId,
      manualFields: "[]",
      createdAt: now,
      ...values,
    });
  }

  const written = await readRow(db, input.campaignId, input.targetKind, input.targetId);
  const briefing = toBriefing(written!);
  await syncIndex(db, briefing);
  return briefing;
}

/**
 * Apply DM edits and mark each edited field as manual so future rebuilds leave
 * it alone.
 */
export async function setManualFields(
  db: StateDb,
  campaignId: string,
  targetKind: string,
  targetId: string,
  edits: Partial<Record<BriefingField, string | string[] | null>>,
): Promise<Briefing> {
  const existing = await readRow(db, campaignId, targetKind, targetId);
  if (!existing) throw new NotFoundError("No briefing found for that target");

  const manual = new Set(parseStringArray(existing.manualFields) as BriefingField[]);
  const values: Record<string, unknown> = { updatedAt: new Date() };

  for (const [field, value] of Object.entries(edits)) {
    if (!(BRIEFING_FIELDS as readonly string[]).includes(field)) {
      throw new Error(`"${field}" is not a briefing field`);
    }
    manual.add(field as BriefingField);
    values[field] = field === "aliases" ? JSON.stringify(value ?? []) : value;
  }
  values.manualFields = JSON.stringify([...manual]);

  await db.update(entityBriefings).set(values).where(eq(entityBriefings.id, existing.id));
  const written = await readRow(db, campaignId, targetKind, targetId);
  const briefing = toBriefing(written!);
  await syncIndex(db, briefing);
  return briefing;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/run/briefings.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/run/briefings.ts lib/run/briefings.test.ts
git commit -m "feat(run): briefing repo that preserves hand-edited fields"
```

---

### Task 7: Build inputs and source hash

**Files:**
- Create: `lib/run/briefing-inputs.ts`
- Test: `lib/run/briefing-inputs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/run/briefing-inputs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/lib/notion/test-helpers";
import { NotFoundError } from "@/lib/state/errors";
import { gatherInputs, hashInputs } from "./briefing-inputs";

function seed(db: ReturnType<typeof createTestDb>["db"], campaignId: string) {
  db.run(sql`INSERT INTO characters (id, campaign_id, name, type, description, notion_props, archived, created_at, updated_at)
    VALUES ('c1', ${campaignId}, 'Garrick Veldros', 'npc', 'A broker of favours.', '{"Role":"Fixer"}', 0, 1, 1)`);
  db.run(sql`INSERT INTO threads (id, campaign_id, title, stakes, status, archived, created_at, updated_at)
    VALUES ('t1', ${campaignId}, 'Who forged the writ?', 'The party stays hunted.', 'open', 0, 1, 1)`);
  db.run(sql`INSERT INTO thread_links (id, thread_id, target_kind, target_id, role)
    VALUES ('tl1', 't1', 'character', 'c1', 'subject')`);
  db.run(sql`INSERT INTO timeline_events (id, campaign_id, day, kind, title, body, source_kind, thread_id, created_at)
    VALUES ('e1', ${campaignId}, 100, 'thread_opened', 'Writ questioned', 'The party found the seal was wrong.', 'manual', 't1', 1)`);
}

describe("gatherInputs", () => {
  it("collects the entity, its linked threads, and recent timeline events", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);

    const inputs = await gatherInputs(db, campaignId, "character", "c1");

    expect(inputs.name).toBe("Garrick Veldros");
    expect(inputs.description).toBe("A broker of favours.");
    expect(inputs.notionProps).toBe('{"Role":"Fixer"}');
    expect(inputs.threads).toEqual([
      { title: "Who forged the writ?", stakes: "The party stays hunted.", status: "open", role: "subject" },
    ]);
    expect(inputs.timeline).toEqual([
      { day: 100, kind: "thread_opened", title: "Writ questioned", body: "The party found the seal was wrong." },
    ]);
    expect(inputs.notionBody).toBeNull();
  });

  it("throws when the target does not exist", async () => {
    const { db, campaignId } = createTestDb();
    await expect(gatherInputs(db, campaignId, "character", "nope")).rejects.toThrow(NotFoundError);
  });

  it("rejects an unknown targetKind rather than interpolating it into SQL", async () => {
    const { db, campaignId } = createTestDb();
    await expect(gatherInputs(db, campaignId, "sessions; DROP TABLE characters", "c1")).rejects.toThrow(/targetKind/);
  });
});

describe("hashInputs", () => {
  it("is stable across repeated calls", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    const a = await gatherInputs(db, campaignId, "character", "c1");
    const b = await gatherInputs(db, campaignId, "character", "c1");
    expect(hashInputs(a)).toBe(hashInputs(b));
  });

  it("changes when the description changes", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    const before = hashInputs(await gatherInputs(db, campaignId, "character", "c1"));
    db.run(sql`UPDATE characters SET description = 'A broker of grudges.' WHERE id = 'c1'`);
    const after = hashInputs(await gatherInputs(db, campaignId, "character", "c1"));
    expect(after).not.toBe(before);
  });

  it("is sensitive to the Notion body, which is why callers null it out", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    const inputs = await gatherInputs(db, campaignId, "character", "c1");
    const withoutBody = hashInputs(inputs);
    const withBody = hashInputs({ ...inputs, notionBody: "A long page of prose." });
    expect(withBody).not.toBe(withoutBody);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/run/briefing-inputs.test.ts`
Expected: FAIL — `Failed to resolve import "./briefing-inputs"`.

- [ ] **Step 3: Write the implementation**

Create `lib/run/briefing-inputs.ts`:

```ts
import { sql } from "drizzle-orm";
import { NotFoundError } from "@/lib/state/errors";
import { hashContent } from "@/lib/state/content-hash";
import type { StateDb } from "@/lib/state/types";
import { BRIEFING_TARGET_KINDS, type BriefingTargetKind } from "./briefings";

/** How many recent timeline events feed a briefing. Enough for context, small enough to stay cheap. */
const TIMELINE_LIMIT = 12;

export interface BriefingInputs {
  targetKind: BriefingTargetKind;
  targetId: string;
  name: string;
  description: string | null;
  notionProps: string | null;
  notionUrl: string | null;
  threads: { title: string; stakes: string | null; status: string; role: string }[];
  timeline: { day: number; kind: string; title: string; body: string | null }[];
  /** Fetched at build time, not stored on the entity. Null when unavailable. */
  notionBody: string | null;
}

const TABLE_FOR_KIND: Record<BriefingTargetKind, string> = {
  character: "characters",
  location: "locations",
  item: "items",
  faction: "factions",
};

function assertKind(kind: string): asserts kind is BriefingTargetKind {
  if (!(BRIEFING_TARGET_KINDS as string[]).includes(kind)) {
    throw new Error(`Unknown targetKind "${kind}"`);
  }
}

/**
 * Read everything a briefing is built from. The Notion page body is fetched
 * separately by the caller and attached to the returned object — this function
 * touches only local SQLite.
 */
export async function gatherInputs(
  db: StateDb,
  campaignId: string,
  targetKind: string,
  targetId: string,
): Promise<BriefingInputs> {
  // Validated against the union before it reaches sql.raw: the table name is
  // interpolated, so an unchecked value here would be an injection point.
  assertKind(targetKind);
  const table = TABLE_FOR_KIND[targetKind];

  const entity = db.all<{ name: string; description: string | null; notionProps: string | null; notionUrl: string | null }>(sql`
    SELECT name, description, notion_props AS notionProps, notion_url AS notionUrl
    FROM ${sql.raw(table)}
    WHERE id = ${targetId} AND campaign_id = ${campaignId}
  `)[0];
  if (!entity) throw new NotFoundError(`No ${targetKind} found with that id`);

  const threads = db.all<{ title: string; stakes: string | null; status: string; role: string }>(sql`
    SELECT t.title AS title, t.stakes AS stakes, t.status AS status, tl.role AS role
    FROM thread_links tl
    JOIN threads t ON t.id = tl.thread_id
    WHERE tl.target_kind = ${targetKind} AND tl.target_id = ${targetId}
      AND t.campaign_id = ${campaignId} AND t.archived = 0
    ORDER BY t.title
  `);

  // Relevant two ways, and both are needed: an event may name the entity
  // outright, or it may sit on a thread the entity is linked to and never
  // mention them by name. Matching only on the name would drop the second kind,
  // which is most of what makes a briefing worth reading — "what has been
  // happening around this person" rather than "where does this string appear".
  //
  // The LIKE is deliberately unescaped. Here it only widens a relevance net, so
  // a stray % or _ in a name costs a few extra events in the prompt. That is
  // unlike the ranking tiers in search-index.ts, where an unescaped wildcard
  // silently corrupted the ordering and had to be escaped.
  const timeline = db.all<{ day: number; kind: string; title: string; body: string | null }>(sql`
    SELECT day, kind, title, body FROM timeline_events
    WHERE campaign_id = ${campaignId}
      AND (
        title LIKE ${"%" + entity.name + "%"}
        OR body LIKE ${"%" + entity.name + "%"}
        OR thread_id IN (
          SELECT thread_id FROM thread_links
          WHERE target_kind = ${targetKind} AND target_id = ${targetId}
        )
      )
    -- Thread-linked events sort ahead of mere name matches, because the two
    -- signals are not equally strong. An entity called "The Watch" is named in
    -- passing all over the campaign; sorting purely by recency lets that chatter
    -- fill all twelve slots and crowd out the events on threads the entity is
    -- actually tangled in — which is the material a briefing is for.
    --
    -- id is a tiebreak, not a preference: SQLite leaves the order of rows that
    -- tie on every ORDER BY column undefined. Same-day, same-timestamp events
    -- are ordinary here, and without a total order the sequence could shift
    -- when the query plan changes — churning hashInputs and reporting every
    -- briefing in the campaign stale at once, for no visible reason.
    ORDER BY
      CASE WHEN thread_id IN (
        SELECT thread_id FROM thread_links
        WHERE target_kind = ${targetKind} AND target_id = ${targetId}
      ) THEN 0 ELSE 1 END,
      day DESC, created_at DESC, id DESC
    LIMIT ${TIMELINE_LIMIT}
  `);

  return {
    targetKind,
    targetId,
    name: entity.name,
    description: entity.description,
    notionProps: entity.notionProps,
    notionUrl: entity.notionUrl,
    threads,
    timeline,
    notionBody: null,
  };
}

/**
 * Stable watermark over everything a build read. Fields are serialised in a
 * fixed order rather than via JSON.stringify of the whole object, so key
 * ordering can never churn the hash and mark every briefing stale.
 */
export function hashInputs(inputs: BriefingInputs): string {
  const parts = [
    inputs.targetKind,
    inputs.targetId,
    inputs.name,
    inputs.description ?? "",
    inputs.notionProps ?? "",
    inputs.notionBody ?? "",
    ...inputs.threads.map((t) => `${t.role}|${t.status}|${t.title}|${t.stakes ?? ""}`),
    ...inputs.timeline.map((e) => `${e.day}|${e.kind}|${e.title}|${e.body ?? ""}`),
  ];
  return hashContent(parts.join("\n"));
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/run/briefing-inputs.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/run/briefing-inputs.ts lib/run/briefing-inputs.test.ts
git commit -m "feat(run): briefing build inputs and stable source hash"
```

---

### Task 8: The briefing agent

One Anthropic call per entity, using structured outputs so the response is a validated object rather than prose to parse.

**Files:**
- Create: `lib/run/briefing-agent.ts`
- Test: `lib/run/briefing-agent.test.ts`

**Model note:** this uses `claude-opus-5`. The existing `lib/assistant/agent.ts` and `lib/state/review-agent.ts` are pinned to `claude-opus-4-8`; leave those alone in this sub-project. Do not send `temperature`, `top_p`, or `thinking.budget_tokens` — all three return a 400 on this model.

- [ ] **Step 1: Write the failing test**

Create `lib/run/briefing-agent.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { BRIEFING_SCHEMA, BRIEFING_SYSTEM, buildPrompt, parseBriefingResponse } from "./briefing-agent";
import type { BriefingInputs } from "./briefing-inputs";

const inputs: BriefingInputs = {
  targetKind: "character",
  targetId: "c1",
  name: "Garrick Veldros",
  description: "A broker of favours.",
  notionProps: '{"Role":"Fixer"}',
  notionUrl: null,
  threads: [{ title: "Who forged the writ?", stakes: "The party stays hunted.", status: "open", role: "subject" }],
  timeline: [{ day: 100, kind: "thread_opened", title: "Writ questioned", body: "The seal was wrong." }],
  notionBody: "Garrick keeps a mask on his belt at all times.",
};

describe("BRIEFING_SCHEMA", () => {
  it("forbids extra properties and requires every field", () => {
    expect(BRIEFING_SCHEMA.additionalProperties).toBe(false);
    expect([...BRIEFING_SCHEMA.required].sort()).toEqual(
      ["aliases", "identity", "partyKnows", "secret", "voice", "wants"],
    );
  });
});

describe("buildPrompt", () => {
  it("includes the name, description, threads, timeline, and Notion body", () => {
    const prompt = buildPrompt(inputs);
    expect(prompt).toContain("Garrick Veldros");
    expect(prompt).toContain("A broker of favours.");
    expect(prompt).toContain("Who forged the writ?");
    expect(prompt).toContain("Writ questioned");
    expect(prompt).toContain("mask on his belt");
  });

  it("says the page body was unavailable when it is null", () => {
    const prompt = buildPrompt({ ...inputs, notionBody: null });
    expect(prompt).toMatch(/page body (was )?not available/i);
  });

  it("only asks for a voice line on characters", () => {
    expect(buildPrompt(inputs)).toContain("voice");
    expect(buildPrompt({ ...inputs, targetKind: "location" })).toContain('"voice": leave null');
  });
});

describe("parseBriefingResponse", () => {
  it("reads the JSON out of the text block", () => {
    const result = parseBriefingResponse({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({
        identity: "A broker of favours in Druvenlode.",
        wants: "Leverage over the Assembly.",
        partyKnows: "That he sold them a forged writ.",
        secret: "He informs for the Assembly.",
        voice: "Clipped, over-formal.",
        aliases: ["the mask guy"],
      }) }],
    });
    expect(result.identity).toBe("A broker of favours in Druvenlode.");
    expect(result.aliases).toEqual(["the mask guy"]);
  });

  it("coerces a missing or non-array aliases field to an empty array", () => {
    const result = parseBriefingResponse({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ identity: "A broker.", aliases: "the mask guy" }) }],
    });
    expect(result.aliases).toEqual([]);
    expect(result.wants).toBeNull();
  });

  it("throws on a refusal rather than reading content", () => {
    expect(() => parseBriefingResponse({ stop_reason: "refusal", content: [] })).toThrow(/declined/i);
  });

  it("throws when there is no text block", () => {
    expect(() => parseBriefingResponse({ stop_reason: "end_turn", content: [] })).toThrow(/no text/i);
  });

  it("throws on unparseable JSON", () => {
    expect(() =>
      parseBriefingResponse({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }),
    ).toThrow(/could not read/i);
  });
});

describe("BRIEFING_SYSTEM", () => {
  it("tells the model not to invent facts", () => {
    expect(BRIEFING_SYSTEM).toMatch(/null/);
    expect(BRIEFING_SYSTEM.length).toBeGreaterThan(100);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/run/briefing-agent.test.ts`
Expected: FAIL — `Failed to resolve import "./briefing-agent"`.

- [ ] **Step 3: Write the implementation**

Create `lib/run/briefing-agent.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import type { BriefingInputs } from "./briefing-inputs";

/** Structured-output schema. `additionalProperties: false` and a full `required` list are mandatory. */
export const BRIEFING_SCHEMA = {
  type: "object",
  properties: {
    identity: { type: ["string", "null"], description: "One line: who or what this is." },
    wants: { type: ["string", "null"], description: "What they are currently after. Null if the notes do not say." },
    partyKnows: { type: ["string", "null"], description: "What the party has actually learned, as distinct from what the DM knows." },
    secret: { type: ["string", "null"], description: "DM-only. Something true the party has not learned." },
    voice: { type: ["string", "null"], description: "One line of speech and manner. Characters only; null otherwise." },
    aliases: {
      type: "array",
      items: { type: "string" },
      description: "Nicknames, titles, and how the party refers to them. Empty array if none.",
    },
  },
  required: ["identity", "wants", "partyKnows", "secret", "voice", "aliases"],
  additionalProperties: false,
} as const;

export const BRIEFING_SYSTEM = `You are writing a Dungeon Master's at-table briefing card for one campaign entity.

The DM reads this mid-scene with players waiting, so every field is one or two sentences at most. No preamble, no headings, no restating the name.

Write only what the supplied notes support. If the notes do not establish a field, return null for it — an invented motive is worse than a missing one, because the DM will say it out loud and it becomes canon.

"partyKnows" is what the player characters have actually learned. "secret" is something true that they have not. Keeping them apart is the point of the card; do not put a secret in partyKnows.

"voice" is how to sound like this person again three sessions later — speech rhythm, register, verbal habits. Not backstory. Leave it null for anything that is not a person.

"aliases" are the names the DM might actually type when searching: nicknames, titles, and how the party refers to them in play.`;

export interface BriefingResult {
  identity: string | null;
  wants: string | null;
  partyKnows: string | null;
  secret: string | null;
  voice: string | null;
  aliases: string[];
}

export function buildPrompt(inputs: BriefingInputs): string {
  const lines: string[] = [
    `Entity kind: ${inputs.targetKind}`,
    `Name: ${inputs.name}`,
    "",
    "Description:",
    inputs.description?.trim() || "(none recorded)",
    "",
    "Notion properties:",
    inputs.notionProps?.trim() || "(none recorded)",
    "",
    "Notion page body:",
    inputs.notionBody?.trim() || "(the page body was not available for this build)",
    "",
    "Linked open threads:",
    inputs.threads.length
      ? inputs.threads
          .map((t) => `- [${t.role}, ${t.status}] ${t.title}${t.stakes ? ` — stakes: ${t.stakes}` : ""}`)
          .join("\n")
      : "(none)",
    "",
    "Recent timeline events mentioning them:",
    inputs.timeline.length
      ? inputs.timeline.map((e) => `- day ${e.day} [${e.kind}] ${e.title}${e.body ? `: ${e.body}` : ""}`).join("\n")
      : "(none)",
    "",
  ];
  lines.push(
    inputs.targetKind === "character"
      ? 'Write the card. Include a "voice" line.'
      : 'Write the card. "voice": leave null — this is not a person.',
  );
  return lines.join("\n");
}

interface RawResponse {
  stop_reason: string | null;
  content: { type: string; text?: string }[];
}

/**
 * Pull the briefing object out of a response. Exported separately from the API
 * call so the parsing rules are testable without a network round-trip.
 */
export function parseBriefingResponse(response: RawResponse): BriefingResult {
  // Checked before reading content: on a refusal the content array is empty or
  // partial, and indexing into it would throw something unhelpful.
  if (response.stop_reason === "refusal") {
    throw new Error("The model declined to write this briefing.");
  }
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("The model returned no text to read.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Could not read the model's response as JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Could not read the model's response as a briefing.");
  }

  const obj = parsed as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    identity: str(obj.identity),
    wants: str(obj.wants),
    partyKnows: str(obj.partyKnows),
    secret: str(obj.secret),
    voice: str(obj.voice),
    aliases: Array.isArray(obj.aliases)
      ? obj.aliases.filter((a): a is string => typeof a === "string" && a.trim().length > 0)
      : [],
  };
}

/**
 * One call per entity. Runs at prep time only — nothing on the /run path ever
 * reaches this function.
 */
export async function generateBriefing(
  inputs: BriefingInputs,
  opts: { apiKey: string },
): Promise<BriefingResult> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 16000,
    system: BRIEFING_SYSTEM,
    output_config: {
      // Summarising notes into six short fields does not need deep reasoning,
      // and a campaign-wide build is hundreds of these calls.
      effort: "medium",
      format: { type: "json_schema", schema: BRIEFING_SCHEMA },
    },
    messages: [{ role: "user", content: buildPrompt(inputs) }],
  });
  return parseBriefingResponse(response as unknown as RawResponse);
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/run/briefing-agent.test.ts`
Expected: PASS, 12 tests (10, plus 2 request-shape tests added after review).

If `tsc` complains that `output_config` is not a known property, the installed SDK's typings predate structured outputs. Cast the argument (`as Parameters<typeof client.messages.create>[0]`) rather than dropping the parameter, and leave a comment saying why.

- [ ] **Step 5: Commit**

```bash
git add lib/run/briefing-agent.ts lib/run/briefing-agent.test.ts
git commit -m "feat(run): briefing generation with structured output"
```

---

### Task 9: Build orchestrator

Ties together: gather inputs → fetch the Notion body → hash → generate → upsert. This is where `partial` is decided.

**Files:**
- Create: `lib/run/briefing-build.ts`
- Test: `lib/run/briefing-build.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/run/briefing-build.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/lib/notion/test-helpers";
import { buildBriefing, isStale } from "./briefing-build";
import { getBriefing, upsertBriefing, setManualFields } from "./briefings";
import type { BriefingResult } from "./briefing-agent";

const result: BriefingResult = {
  identity: "A broker of favours in Druvenlode.",
  wants: "Leverage over the Assembly.",
  partyKnows: "That he sold them a forged writ.",
  secret: "He informs for the Assembly.",
  voice: "Clipped, over-formal.",
  aliases: ["the mask guy"],
};

function seed(db: ReturnType<typeof createTestDb>["db"], campaignId: string, notionUrl: string | null = null) {
  db.run(sql`INSERT INTO characters (id, campaign_id, name, type, description, notion_url, archived, created_at, updated_at)
    VALUES ('c1', ${campaignId}, 'Garrick Veldros', 'npc', 'A broker of favours.', ${notionUrl}, 0, 1, 1)`);
}

describe("buildBriefing", () => {
  it("writes the generated briefing", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    const generate = vi.fn().mockResolvedValue(result);

    const b = await buildBriefing(db, {
      campaignId, targetKind: "character", targetId: "c1",
      generate, fetchNotionBody: async () => null,
    });

    expect(b.identity).toBe("A broker of favours in Druvenlode.");
    expect(b.aliases).toEqual(["the mask guy"]);
    expect(generate).toHaveBeenCalledOnce();
  });

  it("marks the briefing partial when the Notion body cannot be fetched", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId, "https://notion.so/page");
    const b = await buildBriefing(db, {
      campaignId, targetKind: "character", targetId: "c1",
      generate: async () => result,
      fetchNotionBody: async () => { throw new Error("Notion unreachable"); },
    });
    expect(b.partial).toBe(true);
  });

  it("is not partial when the entity has no Notion page to fetch", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId, null);
    const fetchNotionBody = vi.fn();
    const b = await buildBriefing(db, {
      campaignId, targetKind: "character", targetId: "c1",
      generate: async () => result, fetchNotionBody,
    });
    expect(b.partial).toBe(false);
    expect(fetchNotionBody).not.toHaveBeenCalled();
  });

  it("clears partial on a later successful build", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId, "https://notion.so/page");
    await buildBriefing(db, {
      campaignId, targetKind: "character", targetId: "c1",
      generate: async () => result,
      fetchNotionBody: async () => { throw new Error("down"); },
    });
    const b = await buildBriefing(db, {
      campaignId, targetKind: "character", targetId: "c1",
      generate: async () => result,
      fetchNotionBody: async () => "The page body.",
    });
    expect(b.partial).toBe(false);
  });

  it("preserves a hand-edited field across a rebuild", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    await buildBriefing(db, {
      campaignId, targetKind: "character", targetId: "c1",
      generate: async () => result, fetchNotionBody: async () => null,
    });
    await setManualFields(db, campaignId, "character", "c1", { voice: "Never uses contractions." });

    const rebuilt = await buildBriefing(db, {
      campaignId, targetKind: "character", targetId: "c1",
      generate: async () => ({ ...result, voice: "Something else entirely." }),
      fetchNotionBody: async () => null,
    });
    expect(rebuilt.voice).toBe("Never uses contractions.");
  });
});

describe("isStale", () => {
  it("is false right after a build", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    await buildBriefing(db, {
      campaignId, targetKind: "character", targetId: "c1",
      generate: async () => result, fetchNotionBody: async () => null,
    });
    const b = await getBriefing(db, campaignId, "character", "c1");
    expect(await isStale(db, b!)).toBe(false);
  });

  it("is true once the entity's description changes", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    await buildBriefing(db, {
      campaignId, targetKind: "character", targetId: "c1",
      generate: async () => result, fetchNotionBody: async () => null,
    });
    db.run(sql`UPDATE characters SET description = 'A broker of grudges.' WHERE id = 'c1'`);
    const b = await getBriefing(db, campaignId, "character", "c1");
    expect(await isStale(db, b!)).toBe(true);
  });

  it("reports stale rather than throwing when the entity has been deleted", async () => {
    const { db, campaignId } = createTestDb();
    await upsertBriefing(db, {
      campaignId, targetKind: "character", targetId: "gone", sourceHash: "h",
    });
    const b = await getBriefing(db, campaignId, "character", "gone");
    expect(await isStale(db, b!)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/run/briefing-build.test.ts`
Expected: FAIL — `Failed to resolve import "./briefing-build"`.

- [ ] **Step 3: Write the implementation**

Create `lib/run/briefing-build.ts`:

```ts
import type { StateDb } from "@/lib/state/types";
import { gatherInputs, hashInputs, type BriefingInputs } from "./briefing-inputs";
import { upsertBriefing, type Briefing, type BriefingTargetKind } from "./briefings";
import type { BriefingResult } from "./briefing-agent";

export type GenerateFn = (inputs: BriefingInputs) => Promise<BriefingResult>;
export type FetchNotionBodyFn = (notionUrl: string) => Promise<string | null>;

export interface BuildOptions {
  campaignId: string;
  targetKind: BriefingTargetKind;
  targetId: string;
  generate: GenerateFn;
  fetchNotionBody: FetchNotionBodyFn;
}

/**
 * Build one briefing. Prep-time only.
 *
 * The Notion fetch is allowed to fail: a build that refuses to proceed without
 * the page body would leave the DM with no card at all, which is strictly worse
 * than a card built from local data and labelled `partial`.
 */
export async function buildBriefing(db: StateDb, opts: BuildOptions): Promise<Briefing> {
  const inputs = await gatherInputs(db, opts.campaignId, opts.targetKind, opts.targetId);

  let partial = false;
  if (inputs.notionUrl) {
    try {
      inputs.notionBody = await opts.fetchNotionBody(inputs.notionUrl);
      // A page that exists but returned nothing is not the same as a failure,
      // but the briefing is equally uninformed by it either way.
      if (inputs.notionBody === null) partial = true;
    } catch (err) {
      // Logged, not just swallowed. A revoked or misconfigured Notion token
      // fails identically on every entity, so without this the DM sees the same
      // "built without the page body" badge on every card and cannot tell a
      // systemic misconfiguration from one page having a bad day. Matches the
      // log-and-continue convention in lib/notion/scheduler.ts.
      console.warn(
        `[briefing-build] Notion fetch failed for ${opts.targetKind} ${opts.targetId}:`,
        (err as Error).message,
      );
      inputs.notionBody = null;
      partial = true;
    }
  }

  const result = await opts.generate(inputs);

  return upsertBriefing(db, {
    campaignId: opts.campaignId,
    targetKind: opts.targetKind,
    targetId: opts.targetId,
    identity: result.identity,
    wants: result.wants,
    partyKnows: result.partyKnows,
    secret: result.secret,
    voice: result.voice,
    aliases: result.aliases,
    // Hashed without the Notion body so staleness stays answerable from local
    // SQLite. isStale() cannot re-fetch the page without a network round-trip
    // per card, and a hash the checker can never reproduce is always stale.
    sourceHash: hashInputs({ ...inputs, notionBody: null }),
    partial,
  });
}

/**
 * Whether the briefing is behind its inputs. Never blocks a read — the card is
 * still served, with a stale pip. A deleted entity counts as stale rather than
 * an error: the card should say it is behind, not fail to render.
 */
export async function isStale(db: StateDb, briefing: Briefing): Promise<boolean> {
  try {
    const inputs = await gatherInputs(db, briefing.campaignId, briefing.targetKind, briefing.targetId);
    // The Notion body is not re-fetched here — staleness must be answerable
    // from local SQLite alone, or checking it would cost a network round-trip
    // on every card.
    return hashInputs({ ...inputs, notionBody: null }) !== briefing.sourceHash;
  } catch {
    return true;
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/run/briefing-build.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/run/briefing-build.ts lib/run/briefing-build.test.ts
git commit -m "feat(run): briefing build orchestrator with partial and staleness"
```

---

### Task 10: Briefing API routes

**Files:**
- Create: `app/api/briefings/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/briefings/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { getBriefing, setManualFields, BRIEFING_TARGET_KINDS, type BriefingTargetKind } from "@/lib/run/briefings";
import { buildBriefing, isStale } from "@/lib/run/briefing-build";
import { generateBriefing } from "@/lib/run/briefing-agent";
import { blocksToPlainText } from "@/lib/state/content-hash";
import { extractNotionPageId, fetchNotionPageBlocks } from "@/lib/notion/client";
import { toClientErrorMessage, NotFoundError } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";

const sdb: StateDb = db;

function readKind(raw: string | null): BriefingTargetKind | null {
  return raw && (BRIEFING_TARGET_KINDS as string[]).includes(raw) ? (raw as BriefingTargetKind) : null;
}

async function notionToken(): Promise<string | null> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, "notion_token") });
  return row?.value?.trim() || null;
}

/** Fetch and flatten a Notion page body. Returns null when there is no token or no page id. */
async function fetchNotionBody(notionUrl: string): Promise<string | null> {
  const token = await notionToken();
  if (!token) return null;
  const pageId = extractNotionPageId(notionUrl);
  if (!pageId) return null;
  const blocks = await fetchNotionPageBlocks(pageId, token);
  return blocksToPlainText(blocks);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  const targetKind = readKind(searchParams.get("targetKind"));
  const targetId = searchParams.get("targetId");
  if (!campaignId) return NextResponse.json({ error: '"campaignId" is required' }, { status: 400 });
  if (!targetKind) return NextResponse.json({ error: '"targetKind" must be a briefing target kind' }, { status: 400 });
  if (!targetId) return NextResponse.json({ error: '"targetId" is required' }, { status: 400 });

  try {
    const briefing = await getBriefing(sdb, campaignId, targetKind, targetId);
    if (!briefing) return NextResponse.json({ briefing: null, stale: false });
    return NextResponse.json({ briefing, stale: await isStale(sdb, briefing) });
  } catch (err) {
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status: 400 });
  }
}

/** Build (or rebuild) one briefing. Prep-time only — never called from /run's hot path. */
export async function POST(req: Request) {
  const body = await req.json();
  const targetKind = readKind(body.targetKind);
  if (typeof body.campaignId !== "string" || !body.campaignId) {
    return NextResponse.json({ error: '"campaignId" is required and must be a string' }, { status: 400 });
  }
  if (!targetKind) return NextResponse.json({ error: '"targetKind" must be a briefing target kind' }, { status: 400 });
  if (typeof body.targetId !== "string" || !body.targetId) {
    return NextResponse.json({ error: '"targetId" is required and must be a string' }, { status: 400 });
  }

  const keyRow = await db.query.settings.findFirst({ where: eq(settings.key, "anthropic_api_key") });
  const apiKey = keyRow?.value?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Add an Anthropic API key in Settings to build briefings." },
      { status: 400 },
    );
  }

  try {
    const briefing = await buildBriefing(sdb, {
      campaignId: body.campaignId,
      targetKind,
      targetId: body.targetId,
      generate: (inputs) => generateBriefing(inputs, { apiKey }),
      fetchNotionBody,
    });
    return NextResponse.json({ briefing, stale: false }, { status: 201 });
  } catch (err) {
    const status = err instanceof NotFoundError ? 404 : 400;
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status });
  }
}

/** Apply DM edits. Edited fields survive every future rebuild. */
export async function PATCH(req: Request) {
  const body = await req.json();
  const targetKind = readKind(body.targetKind);
  if (typeof body.campaignId !== "string" || !body.campaignId) {
    return NextResponse.json({ error: '"campaignId" is required and must be a string' }, { status: 400 });
  }
  if (!targetKind) return NextResponse.json({ error: '"targetKind" must be a briefing target kind' }, { status: 400 });
  if (typeof body.targetId !== "string" || !body.targetId) {
    return NextResponse.json({ error: '"targetId" is required and must be a string' }, { status: 400 });
  }
  if (!body.edits || typeof body.edits !== "object") {
    return NextResponse.json({ error: '"edits" is required and must be an object' }, { status: 400 });
  }

  try {
    const briefing = await setManualFields(sdb, body.campaignId, targetKind, body.targetId, body.edits);
    return NextResponse.json({ briefing });
  } catch (err) {
    const status = err instanceof NotFoundError ? 404 : 400;
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status });
  }
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors. If `NotFoundError` is not exported from `lib/state/errors.ts` as a value, adjust the import — it is declared there as an exported class.

- [ ] **Step 3: Verify the route end to end**

With the dev server running and a real entity id:

```bash
curl -s "localhost:3000/api/briefings?campaignId=<id>&targetKind=character&targetId=<char-id>"
```

Expected: `{"briefing":null,"stale":false}` before any build.

- [ ] **Step 4: Commit**

```bash
git add app/api/briefings/route.ts
git commit -m "feat(run): briefing read, build, and manual-edit routes"
```

---

### Task 11: Run session repo

**Files:**
- Create: `lib/run/runs.ts`
- Test: `lib/run/runs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/run/runs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/lib/notion/test-helpers";
import { NotFoundError } from "@/lib/state/errors";
import { startRun, endRun, getActiveRun, listRuns, linkSessionNote } from "./runs";

describe("startRun", () => {
  it("creates an open run", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    expect(run.endedAt).toBeNull();
    expect(run.campaignId).toBe(campaignId);
  });

  it("auto-closes a run the DM forgot to end", async () => {
    const { db, campaignId } = createTestDb();
    const first = await startRun(db, { campaignId });
    const second = await startRun(db, { campaignId });

    const runs = await listRuns(db, campaignId);
    expect(runs.find((r) => r.id === first.id)!.endedAt).not.toBeNull();
    expect(runs.find((r) => r.id === second.id)!.endedAt).toBeNull();
  });

  it("does not close another campaign's open run", async () => {
    const { db, campaignId } = createTestDb();
    // A real row, not a made-up id: run_sessions.campaign_id is a genuine
    // foreign key and the test database runs with foreign_keys = ON, so an
    // invented campaign id fails on insert rather than exercising the filter.
    db.run(sql`INSERT INTO campaigns (id, name, created_at) VALUES ('other-campaign', 'Other', 1)`);
    const other = await startRun(db, { campaignId });
    await startRun(db, { campaignId: "other-campaign" });
    const runs = await listRuns(db, campaignId);
    expect(runs.find((r) => r.id === other.id)!.endedAt).toBeNull();
  });

  it("leaves exactly one open run when starts race", async () => {
    const { db, campaignId } = createTestDb();
    // POST /api/runs is reachable twice in quick succession — a double-click
    // entering run mode, a retry, or React re-invoking the start effect.
    // Without the close and the insert being one operation, each request closes
    // nothing and inserts one, leaving several open runs at once.
    await Promise.all([
      startRun(db, { campaignId }),
      startRun(db, { campaignId }),
      startRun(db, { campaignId }),
    ]);
    const open = db.all<{ n: number }>(sql`
      SELECT COUNT(*) AS n FROM run_sessions
      WHERE campaign_id = ${campaignId} AND ended_at IS NULL
    `);
    expect(open[0].n).toBe(1);
  });
});

describe("getActiveRun", () => {
  it("returns the open run", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    expect((await getActiveRun(db, campaignId))?.id).toBe(run.id);
  });

  it("returns null once the run has ended", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    await endRun(db, run.id);
    expect(await getActiveRun(db, campaignId)).toBeNull();
  });
});

describe("endRun", () => {
  it("stamps endedAt", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    const ended = await endRun(db, run.id);
    expect(ended.endedAt).toBeInstanceOf(Date);
  });

  it("leaves an already-ended run's timestamp alone", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    const first = await endRun(db, run.id);
    const second = await endRun(db, run.id);
    expect(second.endedAt!.getTime()).toBe(first.endedAt!.getTime());
  });

  it("throws for an unknown run", async () => {
    const { db } = createTestDb();
    await expect(endRun(db, "nope")).rejects.toThrow(NotFoundError);
  });
});

describe("linkSessionNote", () => {
  it("attaches the note id so the review pass can find the marks", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    const linked = await linkSessionNote(db, run.id, "note-1");
    expect(linked.sessionNoteId).toBe("note-1");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/run/runs.test.ts`
Expected: FAIL — `Failed to resolve import "./runs"`.

- [ ] **Step 3: Write the implementation**

Create `lib/run/runs.ts`:

```ts
import { and, desc, eq, isNull } from "drizzle-orm";
import { runSessions, type RunSession } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { NotFoundError } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";

async function read(db: StateDb, id: string): Promise<RunSession> {
  const row = await db.query.runSessions.findFirst({ where: eq(runSessions.id, id) });
  if (!row) throw new NotFoundError("No run found with that id");
  return row;
}

/**
 * Open a run. Any run left open in this campaign is closed first — a DM who
 * forgets to end a session should not have tonight's marks land on last week's
 * run.
 */
export async function startRun(
  db: StateDb,
  input: { campaignId: string; label?: string | null },
): Promise<RunSession> {
  const now = new Date();
  await db
    .update(runSessions)
    .set({ endedAt: now })
    .where(and(eq(runSessions.campaignId, input.campaignId), isNull(runSessions.endedAt)));

  const id = generateId();
  await db.insert(runSessions).values({
    id,
    campaignId: input.campaignId,
    label: input.label ?? null,
    startedAt: now,
    endedAt: null,
    sessionNoteId: null,
    createdAt: now,
  });
  return read(db, id);
}

/** Read one run, or throw NotFoundError. Exported so routes can check ownership. */
export async function getRun(db: StateDb, id: string): Promise<RunSession> {
  return read(db, id);
}

export async function getActiveRun(db: StateDb, campaignId: string): Promise<RunSession | null> {
  const row = await db.query.runSessions.findFirst({
    where: and(eq(runSessions.campaignId, campaignId), isNull(runSessions.endedAt)),
    orderBy: desc(runSessions.startedAt),
  });
  return row ?? null;
}

/** Idempotent: re-ending a closed run keeps the original timestamp. */
export async function endRun(db: StateDb, id: string): Promise<RunSession> {
  const run = await read(db, id);
  if (run.endedAt) return run;
  await db.update(runSessions).set({ endedAt: new Date() }).where(eq(runSessions.id, id));
  return read(db, id);
}

export async function listRuns(db: StateDb, campaignId: string): Promise<RunSession[]> {
  return db.query.runSessions.findMany({
    where: eq(runSessions.campaignId, campaignId),
    orderBy: desc(runSessions.startedAt),
  });
}

/** Link the run to the session note whose transcript covers it. */
export async function linkSessionNote(
  db: StateDb,
  id: string,
  sessionNoteId: string | null,
): Promise<RunSession> {
  await read(db, id);
  await db.update(runSessions).set({ sessionNoteId }).where(eq(runSessions.id, id));
  return read(db, id);
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/run/runs.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/run/runs.ts lib/run/runs.test.ts
git commit -m "feat(run): run session repo with forgotten-run auto-close"
```

---

### Task 12: Marks repo

**Files:**
- Create: `lib/run/marks.ts`
- Test: `lib/run/marks.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/run/marks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/lib/notion/test-helpers";
import { NotFoundError } from "@/lib/state/errors";
import { startRun } from "./runs";
import { createMark, listMarks, setMarkResolved, MARK_TAGS } from "./marks";

describe("createMark", () => {
  it("stores the offset, wall clock, and context", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    const mark = await createMark(db, {
      campaignId, runSessionId: run.id, atMs: 84_000,
      tag: "npc", contextKind: "character", contextId: "c1",
    });

    expect(mark.atMs).toBe(84_000);
    expect(mark.tag).toBe("npc");
    expect(mark.contextKind).toBe("character");
    expect(mark.contextId).toBe("c1");
    expect(mark.wallClock).toBeInstanceOf(Date);
    expect(mark.resolved).toBe(false);
  });

  it("accepts a bare mark with no tag, note, or context", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    const mark = await createMark(db, { campaignId, runSessionId: run.id, atMs: 0 });
    expect(mark.tag).toBeNull();
    expect(mark.note).toBeNull();
    expect(mark.contextKind).toBeNull();
  });

  it("rejects an unknown tag", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    await expect(
      createMark(db, { campaignId, runSessionId: run.id, atMs: 0, tag: "vibes" as never }),
    ).rejects.toThrow(/tag/);
  });

  it("rejects a negative offset", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    await expect(
      createMark(db, { campaignId, runSessionId: run.id, atMs: -1 }),
    ).rejects.toThrow(/atMs/);
  });

  it("throws for an unknown run", async () => {
    const { db, campaignId } = createTestDb();
    await expect(
      createMark(db, { campaignId, runSessionId: "nope", atMs: 0 }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("listMarks", () => {
  it("returns marks in table order", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    await createMark(db, { campaignId, runSessionId: run.id, atMs: 5_000 });
    await createMark(db, { campaignId, runSessionId: run.id, atMs: 1_000 });
    const marks = await listMarks(db, run.id);
    expect(marks.map((m) => m.atMs)).toEqual([1_000, 5_000]);
  });

  it("does not leak another run's marks", async () => {
    const { db, campaignId } = createTestDb();
    const first = await startRun(db, { campaignId });
    await createMark(db, { campaignId, runSessionId: first.id, atMs: 1 });
    const second = await startRun(db, { campaignId });
    await createMark(db, { campaignId, runSessionId: second.id, atMs: 2 });
    expect((await listMarks(db, second.id)).map((m) => m.atMs)).toEqual([2]);
  });
});

describe("setMarkResolved", () => {
  it("flips and unflips resolved", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    const mark = await createMark(db, { campaignId, runSessionId: run.id, atMs: 0 });
    expect((await setMarkResolved(db, mark.id, true)).resolved).toBe(true);
    expect((await setMarkResolved(db, mark.id, false)).resolved).toBe(false);
  });
});

describe("MARK_TAGS", () => {
  it("is the five tags the number keys map to", () => {
    expect(MARK_TAGS).toEqual(["npc", "promise", "loot", "lore", "todo"]);
  });
});

describe("createMark idempotency", () => {
  it("returns the existing mark for a repeated localId instead of inserting a second row", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    const first = await createMark(db, {
      campaignId, runSessionId: run.id, atMs: 1_000, localId: "local-1",
    });
    // Simulates a retry after the first response was lost: same localId, same
    // logical mark, arrives a second time.
    const second = await createMark(db, {
      campaignId, runSessionId: run.id, atMs: 1_000, localId: "local-1",
    });
    expect(second.id).toBe(first.id);
    expect(await listMarks(db, run.id)).toHaveLength(1);
  });

  it("does not dedupe marks with no localId", async () => {
    const { db, campaignId } = createTestDb();
    const run = await startRun(db, { campaignId });
    await createMark(db, { campaignId, runSessionId: run.id, atMs: 1_000 });
    await createMark(db, { campaignId, runSessionId: run.id, atMs: 1_000 });
    expect(await listMarks(db, run.id)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/run/marks.test.ts`
Expected: FAIL — `Failed to resolve import "./marks"`.

- [ ] **Step 3: Write the implementation**

Create `lib/run/marks.ts`:

```ts
import { asc, eq } from "drizzle-orm";
import { sessionMarks, runSessions, type SessionMark } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { NotFoundError } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";

/** Ordered: keys 1-5 in /run map to these positionally. */
export const MARK_TAGS = ["npc", "promise", "loot", "lore", "todo"] as const;
export type MarkTag = (typeof MARK_TAGS)[number];

export interface CreateMarkInput {
  campaignId: string;
  runSessionId: string;
  atMs: number;
  tag?: MarkTag | null;
  note?: string | null;
  contextKind?: string | null;
  contextId?: string | null;
  /** Client-generated id of the queued mark. See the idempotency check below. */
  localId?: string | null;
}

async function read(db: StateDb, id: string): Promise<SessionMark> {
  const row = await db.query.sessionMarks.findFirst({ where: eq(sessionMarks.id, id) });
  if (!row) throw new NotFoundError("No mark found with that id");
  return row;
}

export async function createMark(db: StateDb, input: CreateMarkInput): Promise<SessionMark> {
  // Object.is catches -0, which the other two checks both wave through:
  // Number.isInteger(-0) is true and -0 < 0 is false. Math.round() turns any
  // value in (-1, 0) into -0, so without this a mark timestamped a fraction of
  // a second before the run started is silently accepted as 0.
  if (!Number.isInteger(input.atMs) || input.atMs < 0 || Object.is(input.atMs, -0)) {
    throw new Error('"atMs" must be a non-negative integer');
  }
  if (input.tag != null && !(MARK_TAGS as readonly string[]).includes(input.tag)) {
    throw new Error(`Unknown mark tag "${input.tag}"`);
  }
  const run = await db.query.runSessions.findFirst({ where: eq(runSessions.id, input.runSessionId) });
  if (!run) throw new NotFoundError("No run found with that id");

  // A retry can legitimately duplicate a mark: the POST succeeds and inserts
  // a row, the response is lost in transit, and the client — having no way to
  // tell "failed" from "succeeded but I never heard back" — retries with the
  // same localId. No client-side guard can prevent that. This check is what
  // actually makes the retry idempotent: return the row that already exists
  // instead of inserting a second one. idx_session_marks_local backs this
  // with a unique constraint so a race between two such retries can't slip
  // both inserts through.
  if (input.localId) {
    const existing = await db.query.sessionMarks.findFirst({
      where: eq(sessionMarks.localId, input.localId),
    });
    if (existing) return existing;
  }

  const now = new Date();
  const id = generateId();
  await db.insert(sessionMarks).values({
    id,
    campaignId: input.campaignId,
    runSessionId: input.runSessionId,
    atMs: input.atMs,
    wallClock: now,
    tag: input.tag ?? null,
    note: input.note?.trim() || null,
    contextKind: input.contextKind ?? null,
    contextId: input.contextId ?? null,
    resolved: false,
    createdAt: now,
    localId: input.localId ?? null,
  });
  return read(db, id);
}

export async function listMarks(db: StateDb, runSessionId: string): Promise<SessionMark[]> {
  return db.query.sessionMarks.findMany({
    where: eq(sessionMarks.runSessionId, runSessionId),
    orderBy: asc(sessionMarks.atMs),
  });
}

export async function setMarkResolved(
  db: StateDb,
  id: string,
  resolved: boolean,
): Promise<SessionMark> {
  await read(db, id);
  await db.update(sessionMarks).set({ resolved }).where(eq(sessionMarks.id, id));
  return read(db, id);
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/run/marks.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/run/marks.ts lib/run/marks.test.ts
git commit -m "feat(run): one-key marks with tag validation and context capture"
```

---

### Task 13: Run and mark API routes

**Files:**
- Create: `app/api/runs/route.ts`
- Create: `app/api/runs/[id]/route.ts`
- Create: `app/api/marks/route.ts`

Next.js 16 route handlers receive `params` as a Promise. Read `node_modules/next/dist/docs/` if the signature below does not match what the installed version expects.

- [ ] **Step 1: Write the runs collection route**

Create `app/api/runs/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { startRun, getActiveRun, listRuns } from "@/lib/run/runs";
import { toClientErrorMessage } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";

const sdb: StateDb = db;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  if (!campaignId) return NextResponse.json({ error: '"campaignId" is required' }, { status: 400 });

  try {
    if (searchParams.get("active") === "1") {
      return NextResponse.json({ run: await getActiveRun(sdb, campaignId) });
    }
    return NextResponse.json({ items: await listRuns(sdb, campaignId) });
  } catch (err) {
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status: 400 });
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  if (typeof body.campaignId !== "string" || !body.campaignId) {
    return NextResponse.json({ error: '"campaignId" is required and must be a string' }, { status: 400 });
  }
  try {
    const run = await startRun(sdb, { campaignId: body.campaignId, label: body.label ?? null });
    return NextResponse.json(run, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status: 400 });
  }
}
```

- [ ] **Step 2: Write the single-run route**

Create `app/api/runs/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { endRun, linkSessionNote, getRun } from "@/lib/run/runs";
import { listMarks } from "@/lib/run/marks";
import { toClientErrorMessage, NotFoundError } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";

const sdb: StateDb = db;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const campaignId = new URL(req.url).searchParams.get("campaignId");
  // Required for the same reason /api/search and /api/briefings require it.
  // Without it this endpoint would hand over any run's marks to anyone holding
  // the id, which is a different posture from the rest of the sub-project —
  // and this shell has shipped a cross-campaign leak once already.
  if (!campaignId) {
    return NextResponse.json({ error: '"campaignId" is required' }, { status: 400 });
  }
  try {
    const run = await getRun(sdb, id);
    if (run.campaignId !== campaignId) throw new NotFoundError("No run found with that id");
    return NextResponse.json({ marks: await listMarks(sdb, id) });
  } catch (err) {
    const status = err instanceof NotFoundError ? 404 : 400;
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  try {
    if (body.end === true) return NextResponse.json(await endRun(sdb, id));
    if ("sessionNoteId" in body) {
      const noteId = body.sessionNoteId === null ? null : String(body.sessionNoteId);
      return NextResponse.json(await linkSessionNote(sdb, id, noteId));
    }
    return NextResponse.json({ error: 'Provide "end" or "sessionNoteId"' }, { status: 400 });
  } catch (err) {
    const status = err instanceof NotFoundError ? 404 : 400;
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status });
  }
}
```

- [ ] **Step 3: Write the marks route**

Create `app/api/marks/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createMark, listMarks, setMarkResolved } from "@/lib/run/marks";
import { toClientErrorMessage, NotFoundError } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";

const sdb: StateDb = db;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const runSessionId = searchParams.get("runSessionId");
  if (!runSessionId) return NextResponse.json({ error: '"runSessionId" is required' }, { status: 400 });
  try {
    return NextResponse.json({ items: await listMarks(sdb, runSessionId) });
  } catch (err) {
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status: 400 });
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  if (typeof body.campaignId !== "string" || !body.campaignId) {
    return NextResponse.json({ error: '"campaignId" is required and must be a string' }, { status: 400 });
  }
  if (typeof body.runSessionId !== "string" || !body.runSessionId) {
    return NextResponse.json({ error: '"runSessionId" is required and must be a string' }, { status: 400 });
  }
  if (typeof body.atMs !== "number" || !Number.isFinite(body.atMs)) {
    return NextResponse.json({ error: '"atMs" is required and must be a number' }, { status: 400 });
  }
  // Checked before rounding: Math.round() maps anything in (-1, 0) to -0, which
  // then passes createMark's non-negative guard and stores as 0.
  if (body.atMs < 0) {
    return NextResponse.json({ error: '"atMs" must not be negative' }, { status: 400 });
  }
  try {
    const mark = await createMark(sdb, {
      campaignId: body.campaignId,
      runSessionId: body.runSessionId,
      atMs: Math.round(body.atMs),
      tag: body.tag ?? null,
      note: body.note ?? null,
      contextKind: body.contextKind ?? null,
      contextId: body.contextId ?? null,
    });
    return NextResponse.json(mark, { status: 201 });
  } catch (err) {
    const status = err instanceof NotFoundError ? 404 : 400;
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status });
  }
}

export async function PATCH(req: Request) {
  const body = await req.json();
  if (typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ error: '"id" is required and must be a string' }, { status: 400 });
  }
  if (typeof body.resolved !== "boolean") {
    return NextResponse.json({ error: '"resolved" is required and must be a boolean' }, { status: 400 });
  }
  try {
    return NextResponse.json(await setMarkResolved(sdb, body.id, body.resolved));
  } catch (err) {
    const status = err instanceof NotFoundError ? 404 : 400;
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status });
  }
}
```

- [ ] **Step 4: Verify types and exercise the routes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

With the dev server running:

```bash
curl -s -X POST localhost:3000/api/runs -H 'content-type: application/json' -d '{"campaignId":"<id>"}'
```

Expected: a `201` with a run object whose `endedAt` is `null`.

- [ ] **Step 5: Commit**

```bash
git add app/api/runs app/api/marks
git commit -m "feat(run): run and mark API routes"
```

---

### Task 14: Run store and the mark queue

The one thing that must not be lost silently. Marks are written optimistically, POSTed, retried, and the pending queue is persisted to `localStorage` so a browser crash at 10pm does not cost the night's flags.

**Files:**
- Create: `lib/run/mark-queue.ts` (pure queue logic — this is what gets tested)
- Test: `lib/run/mark-queue.test.ts`
- Create: `lib/store/run-store.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/run/mark-queue.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { enqueue, markSent, markFailed, dueItems, serialise, deserialise, type QueuedMark } from "./mark-queue";

const item: QueuedMark = {
  localId: "m1", campaignId: "c", runSessionId: "r", atMs: 1000,
  tag: null, note: null, contextKind: null, contextId: null,
  attempts: 0, nextAttemptAt: 0,
};

describe("enqueue", () => {
  it("appends without mutating the input queue", () => {
    const queue: QueuedMark[] = [];
    const next = enqueue(queue, item);
    expect(next).toHaveLength(1);
    expect(queue).toHaveLength(0);
  });

  it("ignores a duplicate localId so a double-send cannot double-write", () => {
    const next = enqueue(enqueue([], item), item);
    expect(next).toHaveLength(1);
  });
});

describe("markSent", () => {
  it("removes the item", () => {
    expect(markSent(enqueue([], item), "m1")).toHaveLength(0);
  });

  it("is a no-op for an unknown id", () => {
    expect(markSent(enqueue([], item), "nope")).toHaveLength(1);
  });
});

describe("markFailed", () => {
  it("backs off exponentially and caps the delay", () => {
    let queue = enqueue([], item);
    queue = markFailed(queue, "m1", 1_000);
    expect(queue[0].attempts).toBe(1);
    expect(queue[0].nextAttemptAt).toBe(3_000);

    queue = markFailed(queue, "m1", 3_000);
    expect(queue[0].nextAttemptAt).toBe(7_000);

    for (let i = 0; i < 12; i++) queue = markFailed(queue, "m1", 0);
    expect(queue[0].nextAttemptAt).toBeLessThanOrEqual(60_000);
  });

  it("never drops the item, however many attempts fail", () => {
    let queue = enqueue([], item);
    for (let i = 0; i < 50; i++) queue = markFailed(queue, "m1", 0);
    expect(queue).toHaveLength(1);
  });
});

describe("dueItems", () => {
  it("returns only items whose backoff has elapsed", () => {
    let queue = enqueue([], item);
    queue = markFailed(queue, "m1", 10_000);
    expect(dueItems(queue, 11_000)).toHaveLength(0);
    expect(dueItems(queue, 13_000)).toHaveLength(1);
  });
});

describe("serialise / deserialise", () => {
  it("round-trips a queue", () => {
    const queue = enqueue([], item);
    expect(deserialise(serialise(queue))).toEqual(queue);
  });

  it("returns an empty queue for corrupt storage rather than throwing", () => {
    expect(deserialise("not json")).toEqual([]);
    expect(deserialise(null)).toEqual([]);
    expect(deserialise('{"not":"an array"}')).toEqual([]);
  });

  it("drops entries that are missing required fields", () => {
    expect(deserialise(JSON.stringify([{ localId: "x" }]))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/run/mark-queue.test.ts`
Expected: FAIL — `Failed to resolve import "./mark-queue"`.

- [ ] **Step 3: Write the implementation**

Create `lib/run/mark-queue.ts`:

```ts
import type { MarkTag } from "./marks";

/** Backoff bounds. A mark is never dropped — the ceiling only stops the delay growing. */
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 60_000;

export interface QueuedMark {
  /** Client-generated so a retry can never write the same mark twice. */
  localId: string;
  campaignId: string;
  runSessionId: string;
  atMs: number;
  tag: MarkTag | null;
  note: string | null;
  contextKind: string | null;
  contextId: string | null;
  attempts: number;
  nextAttemptAt: number;
}

export function enqueue(queue: QueuedMark[], item: QueuedMark): QueuedMark[] {
  if (queue.some((q) => q.localId === item.localId)) return queue;
  return [...queue, item];
}

export function markSent(queue: QueuedMark[], localId: string): QueuedMark[] {
  return queue.filter((q) => q.localId !== localId);
}

/**
 * Record a failed attempt and schedule the next one. The item stays in the
 * queue no matter how many attempts fail: a mark that vanishes because the
 * server was down for a minute is the one failure mode this feature cannot
 * have.
 */
export function markFailed(queue: QueuedMark[], localId: string, now: number): QueuedMark[] {
  return queue.map((q) => {
    if (q.localId !== localId) return q;
    const attempts = q.attempts + 1;
    const delay = Math.min(BASE_DELAY_MS * 2 ** (attempts - 1), MAX_DELAY_MS);
    return { ...q, attempts, nextAttemptAt: now + delay };
  });
}

export function dueItems(queue: QueuedMark[], now: number): QueuedMark[] {
  return queue.filter((q) => q.nextAttemptAt <= now);
}

export function serialise(queue: QueuedMark[]): string {
  return JSON.stringify(queue);
}

function isQueuedMark(v: unknown): v is QueuedMark {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.localId === "string" &&
    typeof o.campaignId === "string" &&
    typeof o.runSessionId === "string" &&
    typeof o.atMs === "number" &&
    typeof o.attempts === "number" &&
    typeof o.nextAttemptAt === "number"
  );
}

/** Never throws: a corrupt blob must not stop the run from starting. */
export function deserialise(raw: string | null): QueuedMark[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isQueuedMark) : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/run/mark-queue.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Write the zustand store**

Create `lib/store/run-store.ts`:

```ts
import { create } from "zustand";
import type { MarkTag } from "@/lib/run/marks";
import {
  enqueue, markSent, markFailed, dueItems, serialise, deserialise, type QueuedMark,
} from "@/lib/run/mark-queue";

const STORAGE_KEY = "run-mark-queue";

export interface PinnedCard {
  kind: string;
  targetId: string;
  name: string;
}

interface RunState {
  runSessionId: string | null;
  startedAt: number | null;
  pinned: PinnedCard[];
  queue: QueuedMark[];
  /** Marks accepted by the server this run, newest last. Drives the bottom strip. */
  sent: { localId: string; atMs: number; tag: MarkTag | null }[];
  lastError: string | null;

  beginRun: (runSessionId: string, startedAt: number) => void;
  endRunLocal: () => void;
  pin: (card: PinnedCard) => void;
  unpin: (targetId: string) => void;
  addMark: (input: Omit<QueuedMark, "attempts" | "nextAttemptAt">) => void;
  tagLastMark: (tag: MarkTag) => void;
  flush: () => Promise<void>;
  restoreQueue: () => void;
}

function persist(queue: QueuedMark[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, serialise(queue));
  } catch {
    // Storage full or blocked. The in-memory queue still retries; losing the
    // crash-recovery copy is worse than nothing but not worth failing the mark.
  }
}

export const useRunStore = create<RunState>((set, get) => ({
  runSessionId: null,
  startedAt: null,
  pinned: [],
  queue: [],
  sent: [],
  lastError: null,

  beginRun: (runSessionId, startedAt) => set({ runSessionId, startedAt, sent: [], lastError: null }),
  endRunLocal: () => set({ runSessionId: null, startedAt: null, pinned: [] }),

  pin: (card) =>
    set((s) =>
      s.pinned.some((p) => p.targetId === card.targetId) ? s : { pinned: [...s.pinned, card] },
    ),
  unpin: (targetId) => set((s) => ({ pinned: s.pinned.filter((p) => p.targetId !== targetId) })),

  addMark: (input) => {
    const item: QueuedMark = { ...input, attempts: 0, nextAttemptAt: 0 };
    const queue = enqueue(get().queue, item);
    persist(queue);
    set({ queue });
    void get().flush();
  },

  // Applies to the most recent queued mark. The tag window is a UI concern; by
  // the time a mark has been accepted it is no longer taggable from the strip.
  tagLastMark: (tag) => {
    const queue = get().queue;
    if (queue.length === 0) return;
    const next = queue.map((q, i) => (i === queue.length - 1 ? { ...q, tag } : q));
    persist(next);
    set({ queue: next });
  },

  flush: async () => {
    const now = Date.now();
    for (const item of dueItems(get().queue, now)) {
      try {
        const res = await fetch("/api/marks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(item),
        });
        if (!res.ok) throw new Error(`Mark write failed (${res.status})`);
        const queue = markSent(get().queue, item.localId);
        persist(queue);
        set((s) => ({
          queue,
          sent: [...s.sent, { localId: item.localId, atMs: item.atMs, tag: item.tag }],
          lastError: null,
        }));
      } catch (err) {
        const queue = markFailed(get().queue, item.localId, Date.now());
        persist(queue);
        set({ queue, lastError: err instanceof Error ? err.message : "Mark write failed" });
      }
    }
  },

  restoreQueue: () => {
    if (typeof window === "undefined") return;
    const queue = deserialise(window.localStorage.getItem(STORAGE_KEY));
    if (queue.length > 0) set({ queue });
  },
}));
```

- [ ] **Step 6: Verify types**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/run/mark-queue.ts lib/run/mark-queue.test.ts lib/store/run-store.ts
git commit -m "feat(run): crash-surviving mark queue and run store"
```

---

### Task 15: The briefing card

**Files:**
- Create: `components/run/BriefingCard.tsx`

- [ ] **Step 1: Write the component**

Create `components/run/BriefingCard.tsx`:

```tsx
"use client";

import React, { useState } from "react";
import { AlertTriangle, Eye, EyeOff, Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface BriefingCardData {
  targetKind: string;
  targetId: string;
  name: string;
  identity: string | null;
  wants: string | null;
  partyKnows: string | null;
  secret: string | null;
  voice: string | null;
  partial: boolean;
}

interface BriefingCardProps {
  name: string;
  briefing: BriefingCardData | null;
  /** Shown when there is no briefing: description, notionProps summary, thread titles. */
  fallback: { description: string | null; threads: string[] };
  stale: boolean;
  pinned: boolean;
  onTogglePin: () => void;
  onBuild: () => void;
  building: boolean;
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-sm leading-snug text-foreground">{value}</div>
    </div>
  );
}

export function BriefingCard({
  name, briefing, fallback, stale, pinned, onTogglePin, onBuild, building,
}: BriefingCardProps) {
  const [secretShown, setSecretShown] = useState(false);

  return (
    <div className={cn(
      "rounded-lg border border-border bg-card p-4 space-y-3",
      pinned && "border-amber-500/50",
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold leading-tight text-foreground">{name}</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            {stale && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                Behind its notes
              </Badge>
            )}
            {briefing?.partial && (
              <Badge variant="outline" className="text-[10px]">Built without the page body</Badge>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 px-2"
          onClick={onTogglePin}
          aria-label={pinned ? `Unpin ${name}` : `Pin ${name}`}
        >
          {pinned ? <PinOff className="h-4 w-4" aria-hidden /> : <Pin className="h-4 w-4" aria-hidden />}
        </Button>
      </div>

      {briefing ? (
        <div className="space-y-2.5">
          <Field label="Is" value={briefing.identity} />
          <Field label="Wants" value={briefing.wants} />
          <Field label="Party knows" value={briefing.partyKnows} />
          <Field label="Voice" value={briefing.voice} />
          {briefing.secret && (
            <div className="space-y-0.5">
              {/* aria-expanded because the Eye/EyeOff swap is aria-hidden — without
                  it a screen reader gets no signal that the secret is revealed. */}
              <button
                type="button"
                onClick={() => setSecretShown((s) => !s)}
                aria-expanded={secretShown}
                className="flex items-center gap-1.5 rounded-sm text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {secretShown
                  ? <EyeOff className="h-3 w-3" aria-hidden />
                  : <Eye className="h-3 w-3" aria-hidden />}
                Secret
              </button>
              {secretShown && (
                <div className="text-sm leading-snug text-amber-200">{briefing.secret}</div>
              )}
            </div>
          )}
        </div>
      ) : (
        // Degraded, never empty. A card that says "no briefing yet" and nothing
        // else is worse than the raw description the DM already had.
        <div className="space-y-2.5">
          <Field label="Notes" value={fallback.description ?? "Nothing recorded locally."} />
          {fallback.threads.length > 0 && (
            <Field label="Open threads" value={fallback.threads.join(" · ")} />
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onBuild} disabled={building}>
            {building ? "Building briefing…" : "Build briefing"}
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. If `Badge` does not accept `variant="outline"`, check `components/ui/badge.tsx` for the variants it defines and use one that exists.

- [ ] **Step 3: Commit**

```bash
git add components/run/BriefingCard.tsx
git commit -m "feat(run): briefing card with collapsed secret and fallback state"
```

---

### Task 16: The answer panel

**Files:**
- Create: `components/run/AnswerPanel.tsx`

- [ ] **Step 1: Write the component**

Create `components/run/AnswerPanel.tsx`:

```tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { BriefingCard, type BriefingCardData } from "./BriefingCard";
import { useRunStore } from "@/lib/store/run-store";
import { cn } from "@/lib/utils";

interface Hit { id: string; name: string; type: string; href: string }

interface AnswerPanelProps {
  campaignId: string;
  /** Reports what is on screen so a mark can capture it for free. */
  onContextChange: (context: { kind: string; id: string } | null) => void;
}

const BRIEFABLE = new Set(["character", "location", "item", "faction"]);

export function AnswerPanel({ campaignId, onContextChange }: AnswerPanelProps) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [cursor, setCursor] = useState(0);
  const [briefing, setBriefing] = useState<BriefingCardData | null>(null);
  const [stale, setStale] = useState(false);
  const [fallback, setFallback] = useState<{ description: string | null; threads: string[] }>({
    description: null, threads: [],
  });
  const [building, setBuilding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // The live selection, readable from inside an in-flight async callback.
  // `build`'s closure captures whichever hit was selected when it was created,
  // which is precisely the value that must not decide where the result lands.
  const selectedRef = useRef<Hit | null>(null);

  const pinned = useRunStore((s) => s.pinned);
  const pin = useRunStore((s) => s.pin);
  const unpin = useRunStore((s) => s.unpin);

  const selected = hits[cursor] ?? null;

  // Search. Debounced lightly — the query is local SQLite, so this is about
  // avoiding wasted renders, not about protecting a slow backend.
  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      setCursor(0);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch(`/api/search?campaignId=${campaignId}&q=${encodeURIComponent(query)}`)
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((data: { items?: Hit[] }) => {
          if (cancelled) return;
          setHits(data.items ?? []);
          setCursor(0);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        });
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, campaignId]);

  // Load the selected hit's briefing.
  useEffect(() => {
    if (!selected || !BRIEFABLE.has(selected.type)) {
      setBriefing(null);
      setStale(false);
      setFallback({ description: null, threads: [] });
      onContextChange(selected ? { kind: selected.type, id: selected.id } : null);
      return;
    }
    onContextChange({ kind: selected.type, id: selected.id });

    let cancelled = false;
    fetch(`/api/briefings?campaignId=${campaignId}&targetKind=${selected.type}&targetId=${selected.id}`)
      .then((r) => (r.ok ? r.json() : { briefing: null, stale: false }))
      .then((data: { briefing: BriefingCardData | null; stale: boolean }) => {
        if (cancelled) return;
        setBriefing(data.briefing);
        setStale(data.stale);
      })
      .catch(() => {
        if (!cancelled) {
          setBriefing(null);
          setStale(false);
        }
      });

    fetch(`/api/threads?campaignId=${campaignId}&targetKind=${selected.type}&targetId=${selected.id}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data: { items?: { title: string }[] }) => {
        if (!cancelled) {
          setFallback((f) => ({ ...f, threads: (data.items ?? []).map((t) => t.title) }));
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [selected, campaignId, onContextChange]);

  const build = useCallback(async () => {
    if (!selected) return;
    const target = { type: selected.type, id: selected.id };
    setBuilding(true);
    try {
      const res = await fetch("/api/briefings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId, targetKind: target.type, targetId: target.id }),
      });
      if (res.ok) {
        const data: { briefing: BriefingCardData } = await res.json();
        // A build takes a model call, so the DM can easily type ahead before it
        // lands. Without this check the result is written into whatever card is
        // on screen now — one NPC's briefing rendered under another's name, read
        // aloud at the table as if it were theirs.
        if (selectedRef.current?.id === target.id) {
          setBriefing(data.briefing);
          setStale(false);
        }
      }
    } finally {
      setBuilding(false);
    }
  }, [selected, campaignId]);

  // Any letter focuses search — no Cmd+K ceremony at the table.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, hits.length - 1)); }
        if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
        if (e.key === "Escape") { setQuery(""); inputRef.current?.blur(); }
        if (e.key === "Enter" && selected) {
          e.preventDefault();
          const isPinned = pinned.some((p) => p.targetId === selected.id);
          if (isPinned) unpin(selected.id);
          else pin({ kind: selected.type, targetId: selected.id, name: selected.name });
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[a-zA-Z]$/.test(e.key)) {
        inputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [hits.length, selected, pinned, pin, unpin]);

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      <div className="relative shrink-0">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a name…"
          aria-label="Search the campaign"
          className="pl-9"
        />
      </div>

      {hits.length > 0 && (
        <ul className="max-h-40 shrink-0 overflow-y-auto rounded-md border border-border" role="listbox">
          {hits.map((hit, i) => (
            <li key={`${hit.type}:${hit.id}`}>
              <button
                type="button"
                role="option"
                aria-selected={i === cursor}
                onClick={() => setCursor(i)}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-1.5 text-left text-sm",
                  i === cursor ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                )}
              >
                <span>{hit.name}</span>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{hit.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto">
        {selected && BRIEFABLE.has(selected.type) && (
          <BriefingCard
            name={selected.name}
            briefing={briefing}
            fallback={fallback}
            stale={stale}
            pinned={pinned.some((p) => p.targetId === selected.id)}
            onTogglePin={() =>
              pinned.some((p) => p.targetId === selected.id)
                ? unpin(selected.id)
                : pin({ kind: selected.type, targetId: selected.id, name: selected.name })
            }
            onBuild={build}
            building={building}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. If `Input` does not forward a ref, wrap it with `React.forwardRef` in `components/ui/input.tsx` — check first, most shadcn-style inputs already do.

- [ ] **Step 3: Commit**

```bash
git add components/run/AnswerPanel.tsx
git commit -m "feat(run): answer panel with type-to-search and pinning"
```

---

### Task 17: Mark strip and run controls

**Files:**
- Create: `components/run/MarkStrip.tsx`

- [ ] **Step 1: Write the component**

Create `components/run/MarkStrip.tsx`:

```tsx
"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRunStore } from "@/lib/store/run-store";
import { MARK_TAGS } from "@/lib/run/marks";

function formatOffset(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

interface MarkStripProps {
  /** Visible while the tag window is open, so digits 1-5 have somewhere to land. */
  tagWindowOpen: boolean;
  onEndRun: () => void;
}

export function MarkStrip({ tagWindowOpen, onEndRun }: MarkStripProps) {
  const startedAt = useRunStore((s) => s.startedAt);
  const sent = useRunStore((s) => s.sent);
  const queue = useRunStore((s) => s.queue);
  const lastError = useRunStore((s) => s.lastError);
  const tagLastMark = useRunStore((s) => s.tagLastMark);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = startedAt ? now - startedAt : 0;
  const recent = sent.slice(-3).reverse();

  return (
    <div className="flex items-center gap-4 border-t border-border bg-card px-4 py-2 text-xs">
      <span className="font-mono tabular-nums text-foreground">{formatOffset(elapsed)}</span>

      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Flag className="h-3.5 w-3.5" aria-hidden />
        {sent.length + queue.length} marks
      </span>

      {tagWindowOpen && (
        <span className="flex items-center gap-1.5">
          {MARK_TAGS.map((tag, i) => (
            <button
              key={tag}
              type="button"
              onClick={() => tagLastMark(tag)}
              className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide hover:bg-accent"
            >
              {i + 1} {tag}
            </button>
          ))}
        </span>
      )}

      <span className="flex-1 truncate text-muted-foreground">
        {recent.map((m) => `${formatOffset(m.atMs)}${m.tag ? ` ${m.tag}` : ""}`).join("  ·  ")}
      </span>

      {(queue.length > 0 || lastError) && (
        <span className="flex items-center gap-1.5 text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          {queue.length > 0 ? `${queue.length} unsaved` : lastError}
        </span>
      )}

      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onEndRun}>
        End run
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/run/MarkStrip.tsx
git commit -m "feat(run): bottom strip with timer, marks, and unsaved warning"
```

---

### Task 18: The scene board

**Files:**
- Create: `components/run/SceneBoard.tsx`

- [ ] **Step 1: Write the component**

Create `components/run/SceneBoard.tsx`:

```tsx
"use client";

import React, { useEffect, useState } from "react";
import { useRunStore } from "@/lib/store/run-store";

interface Thread { id: string; title: string; status: string; stakes: string | null }
interface Clock { id: string; name: string; segments: number; filled: number }

interface SceneBoardProps {
  campaignId: string;
}

/**
 * What the left column shows when no encounter is running. Non-combat play gets
 * a home for the first time here, as a composition of #18 data rather than new
 * machinery.
 */
export function SceneBoard({ campaignId }: SceneBoardProps) {
  const pinned = useRunStore((s) => s.pinned);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [clocks, setClocks] = useState<Clock[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/threads?campaignId=${campaignId}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items?: Thread[] }) => { if (!cancelled) setThreads(d.items ?? []); })
      .catch(() => {});
    fetch(`/api/clocks?campaignId=${campaignId}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items?: Clock[] }) => { if (!cancelled) setClocks(d.items ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [campaignId]);

  const open = threads.filter((t) => t.status === "open");

  return (
    <div className="space-y-6 overflow-y-auto p-4">
      <section>
        <h2 className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">In the room</h2>
        {pinned.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing pinned. Search for someone and press Enter to keep them on screen.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {pinned.map((p) => (
              <li key={p.targetId} className="rounded border border-amber-500/40 bg-card px-2.5 py-1 text-sm">
                {p.name}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">Open threads</h2>
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open threads.</p>
        ) : (
          <ul className="space-y-1.5">
            {open.map((t) => (
              <li key={t.id} className="text-sm">
                <span className="text-foreground">{t.title}</span>
                {t.stakes && <span className="text-muted-foreground"> — {t.stakes}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">Clocks</h2>
        {clocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No clocks running.</p>
        ) : (
          <ul className="space-y-1.5">
            {clocks.map((c) => (
              <li key={c.id} className="flex items-center justify-between text-sm">
                <span className="text-foreground">{c.name}</span>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {c.filled}/{c.segments}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Confirm the clocks endpoint shape**

Run: `sed -n 1,40p app/api/clocks/route.ts`
If its GET returns a bare array rather than `{ items }`, adjust the `.then` above to match. Do not change the route.

- [ ] **Step 3: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/run/SceneBoard.tsx
git commit -m "feat(run): scene board for non-combat play"
```

---

### Task 19: The /run route

Composes `InitiativeTracker` unchanged, owns the keyboard model, and starts/ends the run.

**Files:**
- Create: `app/run/page.tsx`

- [ ] **Step 1: Write the page**

Create `app/run/page.tsx`:

```tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { useEncounterStore } from "@/lib/store/encounter-store";
import { useRunStore } from "@/lib/store/run-store";
import { InitiativeTracker } from "@/components/tracker/InitiativeTracker";
import { AnswerPanel } from "@/components/run/AnswerPanel";
import { SceneBoard } from "@/components/run/SceneBoard";
import { MarkStrip } from "@/components/run/MarkStrip";
import { MARK_TAGS } from "@/lib/run/marks";
import { generateId } from "@/lib/utils";

/** How long the digit keys stay bound to the last mark. */
const TAG_WINDOW_MS = 4000;

export default function RunPage() {
  const router = useRouter();
  const { activeCampaignId } = useCampaignStore();
  const { encounter } = useEncounterStore();
  const {
    runSessionId, startedAt, beginRun, endRunLocal, addMark, tagLastMark, flush, restoreQueue,
  } = useRunStore();

  const [tagWindowOpen, setTagWindowOpen] = useState(false);
  const contextRef = useRef<{ kind: string; id: string } | null>(null);
  const tagTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Recover anything a crash left behind before the DM adds tonight's first mark.
  useEffect(() => { restoreQueue(); }, [restoreQueue]);

  // Open the run.
  useEffect(() => {
    if (!activeCampaignId || runSessionId) return;
    let cancelled = false;
    fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignId: activeCampaignId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((run: { id: string; startedAt: string } | null) => {
        if (cancelled || !run) return;
        beginRun(run.id, new Date(run.startedAt).getTime());
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeCampaignId, runSessionId, beginRun]);

  // Drain the queue on an interval so a mark written while the server was down
  // still lands without the DM touching anything.
  useEffect(() => {
    const timer = setInterval(() => { void flush(); }, 5000);
    return () => clearInterval(timer);
  }, [flush]);

  const dropMark = useCallback(() => {
    if (!activeCampaignId || !runSessionId || startedAt == null) return;
    addMark({
      localId: generateId(),
      campaignId: activeCampaignId,
      runSessionId,
      atMs: Date.now() - startedAt,
      tag: null,
      note: null,
      contextKind: contextRef.current?.kind ?? null,
      contextId: contextRef.current?.id ?? null,
    });
    setTagWindowOpen(true);
    if (tagTimerRef.current) clearTimeout(tagTimerRef.current);
    tagTimerRef.current = setTimeout(() => setTagWindowOpen(false), TAG_WINDOW_MS);
  }, [activeCampaignId, runSessionId, startedAt, addMark]);

  // Space marks; digits 1-5 tag it. Digits rather than letters because letters
  // collide with starting a search right after marking, which is exactly what
  // happens when an NPC gets named.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === " " && !typing) {
        e.preventDefault();
        dropMark();
        return;
      }
      if (tagWindowOpen && /^[1-5]$/.test(e.key)) {
        e.preventDefault();
        tagLastMark(MARK_TAGS[Number(e.key) - 1]);
        setTagWindowOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dropMark, tagWindowOpen, tagLastMark]);

  const endRun = useCallback(async () => {
    if (runSessionId) {
      await flush();
      await fetch(`/api/runs/${runSessionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ end: true }),
      }).catch(() => {});
    }
    endRunLocal();
    router.push("/");
  }, [runSessionId, flush, endRunLocal, router]);

  const onContextChange = useCallback((ctx: { kind: string; id: string } | null) => {
    contextRef.current = ctx;
  }, []);

  if (!activeCampaignId) {
    return (
      <div className="flex h-screen items-center justify-center p-8 text-sm text-muted-foreground">
        Pick a campaign before starting a run.
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-[3] border-r border-border">
          {encounter ? <InitiativeTracker /> : <SceneBoard campaignId={activeCampaignId} />}
        </div>
        <div className="min-w-0 flex-[2] p-4">
          <AnswerPanel campaignId={activeCampaignId} onContextChange={onContextChange} />
        </div>
      </div>
      <MarkStrip tagWindowOpen={tagWindowOpen} onEndRun={() => void endRun()} />
    </div>
  );
}
```

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. If `useCampaignStore` exposes the active id under a different name, check `lib/store/campaign-store.ts` and match it.

- [ ] **Step 3: Verify in the browser**

Start the preview and navigate to `/run`. Check:

1. `read_page` shows the search field and the scene board.
2. Type three letters of a known NPC — results appear, arrow keys move the highlight, Enter pins.
3. Click outside any input and press Space — the mark count increments and the tag buttons appear for four seconds.
4. Press `2` while they are visible — the strip's most recent mark shows `promise`.
5. `read_console_messages` shows no errors.
6. `read_network_requests` shows `POST /api/marks` returning `201`.
7. Press "End run" — you land back on `/` and `PATCH /api/runs/<id>` returns `200`.
8. `computer {action: "screenshot"}` for the record.

- [ ] **Step 4: Commit**

```bash
git add app/run/page.tsx
git commit -m "feat(run): /run mode composing the initiative tracker"
```

---

### Task 20: Keep the search index current on entity writes

Task 4 backfills the index; without this task it drifts the moment an entity is renamed or a Notion sync lands, and the DM's search silently goes stale.

**Files:**
- Create: `lib/run/index-sync.ts`
- Test: `lib/run/index-sync.test.ts`
- Modify: `lib/notion/reconcile.ts` (or whichever module writes entity rows — confirm in Step 1)
- Modify: `lib/state/threads.ts`, `lib/state/clocks.ts`

- [ ] **Step 1: Find the entity write paths**

Run: `grep -rn "db.insert(characters)\|db.update(characters)\|db.insert(locations)\|db.update(locations)\|db.insert(items)\|db.update(items)\|db.insert(factions)\|db.update(factions)" lib/ app/ --include=*.ts`

Write down every file and line. Those are the call sites Step 4 hooks. Also run the same grep for `threads` and `clocks`.

- [ ] **Step 2: Write the failing test**

Create `lib/run/index-sync.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/lib/notion/test-helpers";
import { syncEntityToIndex, syncThreadToIndex, syncClockToIndex } from "./index-sync";
import { searchIndex } from "./search-index";

describe("syncEntityToIndex", () => {
  it("indexes a newly written entity", async () => {
    const { db, campaignId } = createTestDb();
    db.run(sql`INSERT INTO characters (id, campaign_id, name, type, description, archived, created_at, updated_at)
      VALUES ('c1', ${campaignId}, 'Mereth Kain', 'npc', 'A duellist.', 0, 1, 1)`);

    await syncEntityToIndex(db, campaignId, "character", "c1");

    expect((await searchIndex(db, { campaignId, q: "mereth" })).map((h) => h.targetId)).toEqual(["c1"]);
  });

  it("follows a rename", async () => {
    const { db, campaignId } = createTestDb();
    db.run(sql`INSERT INTO characters (id, campaign_id, name, type, archived, created_at, updated_at)
      VALUES ('c1', ${campaignId}, 'Merith Kane', 'npc', 0, 1, 1)`);
    await syncEntityToIndex(db, campaignId, "character", "c1");

    db.run(sql`UPDATE characters SET name = 'Mereth Kain' WHERE id = 'c1'`);
    await syncEntityToIndex(db, campaignId, "character", "c1");

    expect(await searchIndex(db, { campaignId, q: "merith" })).toEqual([]);
    expect((await searchIndex(db, { campaignId, q: "mereth" })).map((h) => h.targetId)).toEqual(["c1"]);
  });

  it("removes an archived entity from the index", async () => {
    const { db, campaignId } = createTestDb();
    db.run(sql`INSERT INTO characters (id, campaign_id, name, type, archived, created_at, updated_at)
      VALUES ('c1', ${campaignId}, 'Mereth Kain', 'npc', 0, 1, 1)`);
    await syncEntityToIndex(db, campaignId, "character", "c1");

    db.run(sql`UPDATE characters SET archived = 1 WHERE id = 'c1'`);
    await syncEntityToIndex(db, campaignId, "character", "c1");

    expect(await searchIndex(db, { campaignId, q: "mereth" })).toEqual([]);
  });

  it("removes a deleted entity from the index rather than throwing", async () => {
    const { db, campaignId } = createTestDb();
    db.run(sql`INSERT INTO characters (id, campaign_id, name, type, archived, created_at, updated_at)
      VALUES ('c1', ${campaignId}, 'Mereth Kain', 'npc', 0, 1, 1)`);
    await syncEntityToIndex(db, campaignId, "character", "c1");

    db.run(sql`DELETE FROM characters WHERE id = 'c1'`);
    await syncEntityToIndex(db, campaignId, "character", "c1");

    expect(await searchIndex(db, { campaignId, q: "mereth" })).toEqual([]);
  });

  it("keeps briefing aliases through an entity re-sync", async () => {
    const { db, campaignId } = createTestDb();
    db.run(sql`INSERT INTO characters (id, campaign_id, name, type, archived, created_at, updated_at)
      VALUES ('c1', ${campaignId}, 'Garrick Veldros', 'npc', 0, 1, 1)`);
    db.run(sql`INSERT INTO entity_briefings (id, campaign_id, target_kind, target_id, aliases, source_hash, built_at, created_at, updated_at)
      VALUES ('b1', ${campaignId}, 'character', 'c1', '["the mask guy"]', 'h', 1, 1, 1)`);

    await syncEntityToIndex(db, campaignId, "character", "c1");

    expect((await searchIndex(db, { campaignId, q: "mask guy" })).map((h) => h.targetId)).toEqual(["c1"]);
  });
});

describe("syncThreadToIndex", () => {
  it("indexes a thread and drops it when archived", async () => {
    const { db, campaignId } = createTestDb();
    db.run(sql`INSERT INTO threads (id, campaign_id, title, stakes, status, archived, created_at, updated_at)
      VALUES ('t1', ${campaignId}, 'Who forged the writ?', 'The party stays hunted.', 'open', 0, 1, 1)`);
    await syncThreadToIndex(db, campaignId, "t1");
    expect((await searchIndex(db, { campaignId, q: "forged" })).map((h) => h.targetId)).toEqual(["t1"]);

    db.run(sql`UPDATE threads SET archived = 1 WHERE id = 't1'`);
    await syncThreadToIndex(db, campaignId, "t1");
    expect(await searchIndex(db, { campaignId, q: "forged" })).toEqual([]);
  });
});

describe("syncClockToIndex", () => {
  it("indexes a clock by name", async () => {
    const { db, campaignId } = createTestDb();
    db.run(sql`INSERT INTO clocks (id, campaign_id, name, segments, filled, archived, created_at, updated_at)
      VALUES ('k1', ${campaignId}, 'Assembly closes in', 8, 2, 0, 1, 1)`);
    await syncClockToIndex(db, campaignId, "k1");
    expect((await searchIndex(db, { campaignId, q: "assembly" })).map((h) => h.targetId)).toEqual(["k1"]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run lib/run/index-sync.test.ts`
Expected: FAIL — `Failed to resolve import "./index-sync"`.

- [ ] **Step 4: Write the implementation**

Create `lib/run/index-sync.ts`:

```ts
import { sql } from "drizzle-orm";
import type { StateDb } from "@/lib/state/types";
import { indexEntity, removeFromIndex, type SearchKind } from "./search-index";
import { BRIEFING_TARGET_KINDS, type BriefingTargetKind } from "./briefings";

const TABLE_FOR_KIND: Record<BriefingTargetKind, string> = {
  character: "characters",
  location: "locations",
  item: "items",
  faction: "factions",
};

/**
 * Re-index one entity after a write. Deliberately re-reads the row rather than
 * taking the written values as arguments: sync and manual-edit paths write
 * different subsets of columns, and a caller that forgot to pass the new name
 * would silently leave a stale index entry.
 *
 * Archived and deleted rows are removed rather than skipped, so a hidden entity
 * cannot keep answering searches.
 */
export async function syncEntityToIndex(
  db: StateDb,
  campaignId: string,
  kind: string,
  targetId: string,
): Promise<void> {
  if (!(BRIEFING_TARGET_KINDS as string[]).includes(kind)) return;
  const table = TABLE_FOR_KIND[kind as BriefingTargetKind];

  const row = db.all<{ name: string; description: string | null; archived: number }>(sql`
    SELECT name, description, archived FROM ${sql.raw(table)}
    WHERE id = ${targetId} AND campaign_id = ${campaignId}
  `)[0];

  if (!row || row.archived) {
    await removeFromIndex(db, { campaignId, kind: kind as SearchKind, targetId });
    return;
  }
  await indexEntity(db, {
    campaignId,
    kind: kind as SearchKind,
    targetId,
    name: row.name,
    body: row.description,
  });
}

export async function syncThreadToIndex(db: StateDb, campaignId: string, threadId: string): Promise<void> {
  const row = db.all<{ title: string; stakes: string | null; archived: number }>(sql`
    SELECT title, stakes, archived FROM threads WHERE id = ${threadId} AND campaign_id = ${campaignId}
  `)[0];
  if (!row || row.archived) {
    await removeFromIndex(db, { campaignId, kind: "thread", targetId: threadId });
    return;
  }
  await indexEntity(db, {
    campaignId, kind: "thread", targetId: threadId, name: row.title, body: row.stakes,
  });
}

export async function syncClockToIndex(db: StateDb, campaignId: string, clockId: string): Promise<void> {
  const row = db.all<{ name: string; archived: number }>(sql`
    SELECT name, archived FROM clocks WHERE id = ${clockId} AND campaign_id = ${campaignId}
  `)[0];
  if (!row || row.archived) {
    await removeFromIndex(db, { campaignId, kind: "clock", targetId: clockId });
    return;
  }
  await indexEntity(db, { campaignId, kind: "clock", targetId: clockId, name: row.name, body: null });
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run lib/run/index-sync.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Call it from every write path found in Step 1**

For each entity write site, add a call after the write completes. In the Notion reconcile path, call it once per reconciled row:

```ts
await syncEntityToIndex(db, campaignId, "character", row.id);
```

In `lib/state/threads.ts`, add `await syncThreadToIndex(db, campaignId, thread.id);` at the end of `createThread` and `updateThread`. In `lib/state/clocks.ts`, add the clock equivalent at the end of its create and update functions.

Wrap each call in a `try { } catch { }` that logs and continues:

```ts
    try {
      await syncEntityToIndex(db, campaignId, "character", row.id);
    } catch (err) {
      // A failed index write must never fail the entity write that caused it —
      // the index is a derived convenience and Settings can rebuild it.
      console.warn("[search-index] sync failed:", (err as Error).message);
    }
```

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: all tests pass. If a Notion sync test now fails because the index write threw, the try/catch in Step 6 is missing from that call site.

- [ ] **Step 8: Commit**

```bash
git add lib/run/index-sync.ts lib/run/index-sync.test.ts lib/notion lib/state
git commit -m "feat(run): keep the search index current on entity, thread, and clock writes"
```

---

### Task 21: Batch and lazy briefing builds

Task 10 builds one briefing on demand. The spec calls for three triggers; this task adds the other two.

**Files:**
- Create: `lib/run/briefing-batch.ts`
- Test: `lib/run/briefing-batch.test.ts`
- Create: `app/api/briefings/batch/route.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/run/briefing-batch.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/lib/notion/test-helpers";
import { selectBuildTargets } from "./briefing-batch";

function seedEntities(db: ReturnType<typeof createTestDb>["db"], campaignId: string) {
  db.run(sql`INSERT INTO characters (id, campaign_id, name, type, archived, created_at, updated_at)
    VALUES ('linked', ${campaignId}, 'Garrick Veldros', 'npc', 0, 1, 1)`);
  db.run(sql`INSERT INTO characters (id, campaign_id, name, type, archived, created_at, updated_at)
    VALUES ('loose', ${campaignId}, 'A Passing Guard', 'npc', 0, 1, 1)`);
  db.run(sql`INSERT INTO characters (id, campaign_id, name, type, archived, created_at, updated_at)
    VALUES ('gone', ${campaignId}, 'Retired NPC', 'npc', 1, 1, 1)`);
  db.run(sql`INSERT INTO threads (id, campaign_id, title, status, archived, created_at, updated_at)
    VALUES ('t1', ${campaignId}, 'Who forged the writ?', 'open', 0, 1, 1)`);
  db.run(sql`INSERT INTO thread_links (id, thread_id, target_kind, target_id, role)
    VALUES ('tl1', 't1', 'character', 'linked', 'subject')`);
}

describe("selectBuildTargets", () => {
  it("scope 'session' picks only entities linked to open threads", async () => {
    const { db, campaignId } = createTestDb();
    seedEntities(db, campaignId);
    const targets = await selectBuildTargets(db, campaignId, "session");
    expect(targets).toEqual([{ targetKind: "character", targetId: "linked" }]);
  });

  it("scope 'session' ignores entities linked only to resolved threads", async () => {
    const { db, campaignId } = createTestDb();
    seedEntities(db, campaignId);
    db.run(sql`UPDATE threads SET status = 'resolved' WHERE id = 't1'`);
    expect(await selectBuildTargets(db, campaignId, "session")).toEqual([]);
  });

  it("scope 'all' picks every unarchived entity", async () => {
    const { db, campaignId } = createTestDb();
    seedEntities(db, campaignId);
    const ids = (await selectBuildTargets(db, campaignId, "all")).map((t) => t.targetId).sort();
    expect(ids).toEqual(["linked", "loose"]);
  });

  it("skips entities that already have a fresh briefing", async () => {
    const { db, campaignId } = createTestDb();
    seedEntities(db, campaignId);
    // A briefing whose hash matches nothing is stale, so seed one that matches.
    const { gatherInputs, hashInputs } = await import("./briefing-inputs");
    const inputs = await gatherInputs(db, campaignId, "character", "loose");
    const hash = hashInputs({ ...inputs, notionBody: null });
    db.run(sql`INSERT INTO entity_briefings (id, campaign_id, target_kind, target_id, source_hash, built_at, created_at, updated_at)
      VALUES ('b1', ${campaignId}, 'character', 'loose', ${hash}, 1, 1, 1)`);

    const ids = (await selectBuildTargets(db, campaignId, "all")).map((t) => t.targetId);
    expect(ids).toEqual(["linked"]);
  });

  it("includes an entity whose briefing has gone stale", async () => {
    const { db, campaignId } = createTestDb();
    seedEntities(db, campaignId);
    db.run(sql`INSERT INTO entity_briefings (id, campaign_id, target_kind, target_id, source_hash, built_at, created_at, updated_at)
      VALUES ('b1', ${campaignId}, 'character', 'loose', 'a-hash-that-no-longer-matches', 1, 1, 1)`);
    const ids = (await selectBuildTargets(db, campaignId, "all")).map((t) => t.targetId).sort();
    expect(ids).toEqual(["linked", "loose"]);
  });

  it("scopes to the campaign", async () => {
    const { db, campaignId } = createTestDb();
    seedEntities(db, campaignId);
    db.run(sql`INSERT INTO characters (id, campaign_id, name, type, archived, created_at, updated_at)
      VALUES ('theirs', 'other-campaign', 'Someone Else', 'npc', 0, 1, 1)`);
    const ids = (await selectBuildTargets(db, campaignId, "all")).map((t) => t.targetId);
    expect(ids).not.toContain("theirs");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/run/briefing-batch.test.ts`
Expected: FAIL — `Failed to resolve import "./briefing-batch"`.

- [ ] **Step 3: Write the implementation**

Create `lib/run/briefing-batch.ts`:

```ts
import { sql } from "drizzle-orm";
import type { StateDb } from "@/lib/state/types";
import { getBriefing, type BriefingTargetKind } from "./briefings";
import { isStale } from "./briefing-build";

export type BuildScope = "session" | "all";

export interface BuildTarget {
  targetKind: BriefingTargetKind;
  targetId: string;
}

const ENTITY_TABLES: { table: string; kind: BriefingTargetKind }[] = [
  { table: "characters", kind: "character" },
  { table: "locations", kind: "location" },
  { table: "items", kind: "item" },
  { table: "factions", kind: "faction" },
];

/**
 * Decide what a batch build should cover.
 *
 * "session" walks entities linked to open threads — the ones likely to come up
 * at the next table. "all" walks the campaign. Both skip anything whose
 * briefing is already current, so a repeated build costs nothing and a run that
 * dies partway can simply be started again.
 */
export async function selectBuildTargets(
  db: StateDb,
  campaignId: string,
  scope: BuildScope,
): Promise<BuildTarget[]> {
  const candidates: BuildTarget[] = [];

  if (scope === "session") {
    const rows = db.all<{ targetKind: string; targetId: string }>(sql`
      SELECT DISTINCT tl.target_kind AS targetKind, tl.target_id AS targetId
      FROM thread_links tl
      JOIN threads t ON t.id = tl.thread_id
      WHERE t.campaign_id = ${campaignId} AND t.archived = 0 AND t.status = 'open'
        AND tl.target_kind IN ('character', 'location', 'item', 'faction')
      ORDER BY tl.target_kind, tl.target_id
    `);
    candidates.push(...rows.map((r) => ({ targetKind: r.targetKind as BriefingTargetKind, targetId: r.targetId })));
  } else {
    for (const { table, kind } of ENTITY_TABLES) {
      const rows = db.all<{ id: string }>(sql`
        SELECT id FROM ${sql.raw(table)}
        WHERE campaign_id = ${campaignId} AND archived = 0
        ORDER BY name
      `);
      candidates.push(...rows.map((r) => ({ targetKind: kind, targetId: r.id })));
    }
  }

  const targets: BuildTarget[] = [];
  for (const candidate of candidates) {
    const existing = await getBriefing(db, campaignId, candidate.targetKind, candidate.targetId);
    if (!existing || (await isStale(db, existing))) targets.push(candidate);
  }
  return targets;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/run/briefing-batch.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the batch route**

Create `app/api/briefings/batch/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { selectBuildTargets, type BuildScope } from "@/lib/run/briefing-batch";
import { buildBriefing } from "@/lib/run/briefing-build";
import { generateBriefing } from "@/lib/run/briefing-agent";
import { blocksToPlainText } from "@/lib/state/content-hash";
import { extractNotionPageId, fetchNotionPageBlocks } from "@/lib/notion/client";
import { toClientErrorMessage } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";

const sdb: StateDb = db;

/** Bounds one request. A large campaign is built by calling again until `remaining` is 0. */
const MAX_PER_REQUEST = 25;

async function fetchNotionBody(notionUrl: string): Promise<string | null> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, "notion_token") });
  const token = row?.value?.trim();
  if (!token) return null;
  const pageId = extractNotionPageId(notionUrl);
  if (!pageId) return null;
  return blocksToPlainText(await fetchNotionPageBlocks(pageId, token));
}

export async function POST(req: Request) {
  const body = await req.json();
  if (typeof body.campaignId !== "string" || !body.campaignId) {
    return NextResponse.json({ error: '"campaignId" is required and must be a string' }, { status: 400 });
  }
  const scope: BuildScope = body.scope === "all" ? "all" : "session";

  const keyRow = await db.query.settings.findFirst({ where: eq(settings.key, "anthropic_api_key") });
  const apiKey = keyRow?.value?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Add an Anthropic API key in Settings to build briefings." },
      { status: 400 },
    );
  }

  try {
    const targets = await selectBuildTargets(sdb, body.campaignId, scope);
    const batch = targets.slice(0, MAX_PER_REQUEST);

    let built = 0;
    const failures: { targetId: string; error: string }[] = [];

    for (const target of batch) {
      try {
        await buildBriefing(sdb, {
          campaignId: body.campaignId,
          targetKind: target.targetKind,
          targetId: target.targetId,
          generate: (inputs) => generateBriefing(inputs, { apiKey }),
          fetchNotionBody,
        });
        built++;
      } catch (err) {
        // One entity that will not build must not abandon the other 24. The
        // caller sees exactly what was skipped rather than a silent shortfall.
        failures.push({ targetId: target.targetId, error: toClientErrorMessage(err) });
      }
    }

    return NextResponse.json({
      built,
      failures,
      remaining: Math.max(targets.length - batch.length, 0),
    });
  } catch (err) {
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status: 400 });
  }
}
```

- [ ] **Step 6: Add a lazy build to the entity detail pages**

For each of `app/characters/[id]/page.tsx`, `app/locations/[id]/page.tsx`, `app/items/[id]/page.tsx`, and `app/factions/[id]/page.tsx`, add a briefing section that fetches the briefing on mount and builds it when absent. This is the lazy trigger, and it lives **only** on prep surfaces — `/run` never fires it.

```tsx
  const [briefing, setBriefing] = useState<BriefingCardData | null>(null);
  const [briefingStale, setBriefingStale] = useState(false);
  const [buildingBriefing, setBuildingBriefing] = useState(false);

  useEffect(() => {
    if (!activeCampaignId || !id) return;
    let cancelled = false;
    fetch(`/api/briefings?campaignId=${activeCampaignId}&targetKind=character&targetId=${id}`)
      .then((r) => (r.ok ? r.json() : { briefing: null, stale: false }))
      .then((data: { briefing: BriefingCardData | null; stale: boolean }) => {
        if (cancelled) return;
        setBriefing(data.briefing);
        setBriefingStale(data.stale);
        // Lazily build on first view, but only here — a prep surface can afford
        // the round-trip and the model call. /run cannot.
        if (!data.briefing) void buildBriefing();
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeCampaignId, id]);
```

Replace `targetKind=character` with the page's own kind. Render the result with `BriefingCard` from `@/components/run/BriefingCard`, passing `onBuild={buildBriefing}` and the same `fallback` shape the answer panel uses.

- [ ] **Step 7: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add lib/run/briefing-batch.ts lib/run/briefing-batch.test.ts app/api/briefings app/characters app/locations app/items app/factions
git commit -m "feat(run): batch and lazy briefing builds"
```

---

### Task 22: Related-entity navigation

The spec's `→` (follow a related entity) and `←` (go back) keys. Related entities come from shared thread links: two entities linked to the same open thread are, for a DM mid-scene, the relationship that matters.

**Files:**
- Create: `lib/run/relations.ts`
- Test: `lib/run/relations.test.ts`
- Create: `app/api/relations/route.ts`
- Modify: `components/run/AnswerPanel.tsx`

- [ ] **Step 1: Write the failing test**

Create `lib/run/relations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/lib/notion/test-helpers";
import { relatedEntities } from "./relations";

function seed(db: ReturnType<typeof createTestDb>["db"], campaignId: string) {
  db.run(sql`INSERT INTO characters (id, campaign_id, name, type, archived, created_at, updated_at)
    VALUES ('a', ${campaignId}, 'Garrick Veldros', 'npc', 0, 1, 1)`);
  db.run(sql`INSERT INTO characters (id, campaign_id, name, type, archived, created_at, updated_at)
    VALUES ('b', ${campaignId}, 'Mereth Kain', 'npc', 0, 1, 1)`);
  db.run(sql`INSERT INTO factions (id, campaign_id, name, archived, created_at, updated_at)
    VALUES ('f', ${campaignId}, 'Cerberus Assembly', 0, 1, 1)`);
  db.run(sql`INSERT INTO threads (id, campaign_id, title, status, archived, created_at, updated_at)
    VALUES ('t1', ${campaignId}, 'Who forged the writ?', 'open', 0, 1, 1)`);
  for (const [id, kind, target] of [["l1", "character", "a"], ["l2", "character", "b"], ["l3", "faction", "f"]]) {
    db.run(sql`INSERT INTO thread_links (id, thread_id, target_kind, target_id, role)
      VALUES (${id}, 't1', ${kind}, ${target}, 'subject')`);
  }
}

describe("relatedEntities", () => {
  it("returns everything else linked to the same open thread", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    const related = await relatedEntities(db, campaignId, "character", "a");
    expect(related.map((r) => r.targetId).sort()).toEqual(["b", "f"]);
    expect(related.find((r) => r.targetId === "f")).toMatchObject({
      kind: "faction", name: "Cerberus Assembly",
    });
  });

  it("never includes the entity itself", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    const related = await relatedEntities(db, campaignId, "character", "a");
    expect(related.map((r) => r.targetId)).not.toContain("a");
  });

  it("ignores resolved and archived threads", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    db.run(sql`UPDATE threads SET status = 'resolved' WHERE id = 't1'`);
    expect(await relatedEntities(db, campaignId, "character", "a")).toEqual([]);
  });

  it("drops links whose target row no longer exists", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    db.run(sql`DELETE FROM characters WHERE id = 'b'`);
    const related = await relatedEntities(db, campaignId, "character", "a");
    expect(related.map((r) => r.targetId)).toEqual(["f"]);
  });

  it("returns an empty list for an entity with no links", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    expect(await relatedEntities(db, campaignId, "character", "unlinked")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/run/relations.test.ts`
Expected: FAIL — `Failed to resolve import "./relations"`.

- [ ] **Step 3: Write the implementation**

Create `lib/run/relations.ts`:

```ts
import { sql } from "drizzle-orm";
import type { StateDb } from "@/lib/state/types";
import { BRIEFING_TARGET_KINDS, type BriefingTargetKind } from "./briefings";

const TABLE_FOR_KIND: Record<BriefingTargetKind, string> = {
  character: "characters",
  location: "locations",
  item: "items",
  faction: "factions",
};

export interface RelatedEntity {
  kind: BriefingTargetKind;
  targetId: string;
  name: string;
}

/**
 * Entities that share an open thread with this one. Shared stakes is the
 * relationship a DM actually reaches for mid-scene — "who else is tangled up in
 * this" — rather than any structural link between the entity rows.
 *
 * thread_links carries no FK, so a target id may dangle; a link whose row has
 * gone is dropped rather than surfaced as a nameless entry.
 */
export async function relatedEntities(
  db: StateDb,
  campaignId: string,
  kind: string,
  targetId: string,
): Promise<RelatedEntity[]> {
  if (!(BRIEFING_TARGET_KINDS as string[]).includes(kind)) return [];

  const links = db.all<{ targetKind: string; targetId: string }>(sql`
    SELECT DISTINCT other.target_kind AS targetKind, other.target_id AS targetId
    FROM thread_links mine
    JOIN threads t ON t.id = mine.thread_id
    JOIN thread_links other ON other.thread_id = mine.thread_id
    WHERE mine.target_kind = ${kind} AND mine.target_id = ${targetId}
      AND t.campaign_id = ${campaignId} AND t.archived = 0 AND t.status = 'open'
      AND NOT (other.target_kind = ${kind} AND other.target_id = ${targetId})
      AND other.target_kind IN ('character', 'location', 'item', 'faction')
  `);

  const out: RelatedEntity[] = [];
  for (const link of links) {
    const table = TABLE_FOR_KIND[link.targetKind as BriefingTargetKind];
    const row = db.all<{ name: string }>(sql`
      SELECT name FROM ${sql.raw(table)}
      WHERE id = ${link.targetId} AND campaign_id = ${campaignId} AND archived = 0
    `)[0];
    if (row) {
      out.push({ kind: link.targetKind as BriefingTargetKind, targetId: link.targetId, name: row.name });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/run/relations.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the route**

Create `app/api/relations/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { relatedEntities } from "@/lib/run/relations";
import { toClientErrorMessage } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";

const sdb: StateDb = db;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  const targetKind = searchParams.get("targetKind");
  const targetId = searchParams.get("targetId");
  if (!campaignId) return NextResponse.json({ error: '"campaignId" is required' }, { status: 400 });
  if (!targetKind) return NextResponse.json({ error: '"targetKind" is required' }, { status: 400 });
  if (!targetId) return NextResponse.json({ error: '"targetId" is required' }, { status: 400 });

  try {
    return NextResponse.json({ items: await relatedEntities(sdb, campaignId, targetKind, targetId) });
  } catch (err) {
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status: 400 });
  }
}
```

- [ ] **Step 6: Wire ← and → into the answer panel**

In `components/run/AnswerPanel.tsx`, add a view stack and a related-entity fetch. Add this state alongside the existing hooks:

```tsx
  const [related, setRelated] = useState<{ kind: string; targetId: string; name: string }[]>([]);
  const [relatedCursor, setRelatedCursor] = useState(0);
  // Cards the DM arrived at by following a relation. Left arrow walks back up it.
  const [history, setHistory] = useState<Hit[]>([]);
  const [override, setOverride] = useState<Hit | null>(null);
```

Change the `selected` line to prefer the override:

```tsx
  const selected = override ?? hits[cursor] ?? null;
```

Add a fetch for relations, keyed on `selected`:

```tsx
  useEffect(() => {
    if (!selected || !BRIEFABLE.has(selected.type)) {
      setRelated([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/relations?campaignId=${campaignId}&targetKind=${selected.type}&targetId=${selected.id}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items?: { kind: string; targetId: string; name: string }[] }) => {
        if (cancelled) return;
        setRelated(d.items ?? []);
        setRelatedCursor(0);
      })
      .catch(() => { if (!cancelled) setRelated([]); });
    return () => { cancelled = true; };
  }, [selected, campaignId]);
```

Add the two keys to the existing `onKeyDown` handler, inside the `if (typing)` branch alongside the arrow-up/down cases:

```tsx
        if (e.key === "ArrowRight" && related.length > 0) {
          e.preventDefault();
          const next = related[relatedCursor % related.length];
          if (selected) setHistory((h) => [...h, selected]);
          setOverride({ id: next.targetId, name: next.name, type: next.kind, href: "" });
          setRelatedCursor((c) => c + 1);
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setHistory((h) => {
            if (h.length === 0) { setOverride(null); return h; }
            setOverride(h[h.length - 1]);
            return h.slice(0, -1);
          });
        }
```

Add `related`, `relatedCursor` to the effect's dependency array. Finally, render the related names beneath the card so the DM can see where `→` will go:

```tsx
        {related.length > 0 && (
          <div className="text-xs text-muted-foreground">
            <span className="uppercase tracking-widest text-[10px]">Tangled up with</span>{" "}
            {related.map((r) => r.name).join(" · ")}
          </div>
        )}
```

- [ ] **Step 7: Verify types, lint, and behaviour**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

In the browser at `/run`: search an NPC that is linked to an open thread, press `→` — the card switches to a related entity and the related list updates. Press `←` — you return to the first card.

- [ ] **Step 8: Commit**

```bash
git add lib/run/relations.ts lib/run/relations.test.ts app/api/relations components/run/AnswerPanel.tsx
git commit -m "feat(run): follow related entities with the arrow keys"
```

---

### Task 23: Entry points and index backfill

`/run` and the briefing build are unreachable from the UI until they are linked.

**Files:**
- Modify: `components/shell/TopBar.tsx`
- Modify: `app/settings/page.tsx`

- [ ] **Step 1: Add a Run link to the top bar**

Read `components/shell/TopBar.tsx` and add a link to `/run` alongside the existing navigation, matching whatever pattern the file already uses for its links. Label it `Run`, and give it the `Play` icon from `lucide-react`.

- [ ] **Step 2: Add a rebuild control to Settings**

Read `app/settings/page.tsx` and add a section following its existing card pattern:

```tsx
<Button
  size="sm"
  variant="outline"
  onClick={async () => {
    if (!activeCampaignId) return;
    setIndexing(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId: activeCampaignId }),
      });
      const data: { indexed?: number; error?: string } = await res.json();
      setIndexResult(res.ok ? `Indexed ${data.indexed} records.` : (data.error ?? "Rebuild failed."));
    } finally {
      setIndexing(false);
    }
  }}
  disabled={indexing}
>
  {indexing ? "Rebuilding…" : "Rebuild search index"}
</Button>
```

Add the `indexing` and `indexResult` `useState` hooks alongside the page's existing state, render `indexResult` beneath the button, and give the section a heading of `Search index` with the explanatory line: *"Rebuilds the at-table lookup index from your entities, threads, and clocks. Run this once after upgrading."*

- [ ] **Step 3: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Verify in the browser**

Open Settings, click **Rebuild search index**. Expected: the button reports a record count. Then open `/run` from the top bar and confirm search returns results.

- [ ] **Step 5: Commit**

```bash
git add components/shell/TopBar.tsx app/settings/page.tsx
git commit -m "feat(run): run mode entry point and search index rebuild control"
```

---

### Task 24: Full verification

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: all tests pass, including the ~90 new ones across `lib/run/`.

- [ ] **Step 2: Typecheck and lint the whole project**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: a successful production build.

- [ ] **Step 4: End-to-end check against real data**

With the dev server running:

1. Settings → **Rebuild search index** → reports a non-zero count.
2. Open a character detail page, build its briefing, and confirm the card fills in.
3. Open `/run`. Search that character — the card appears with identity, wants, party knows, and voice.
4. Press Space three times, tagging one with `1`. The strip shows three marks.
5. Stop the dev server, press Space twice more, restart the server. The queue drains and the strip's unsaved count returns to zero.
6. End the run and confirm `GET /api/runs?campaignId=<id>` shows it closed with an `endedAt`.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(run): close verification gaps"
```
