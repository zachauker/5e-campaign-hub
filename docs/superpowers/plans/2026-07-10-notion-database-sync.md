# Notion Database Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-way Notion → hub sync that pulls the Characters, Items & Loot, and Factions & Organizations databases into the hub's own tables, ending manual per-entity URL pasting.

**Architecture:** A per-campaign `notion_sources` config stores three database URLs. A "Sync now" button hits `POST /api/notion/sync`, which runs a pure-ish engine in `lib/notion/sync.ts`: query each Notion data source, map rows → entity fields, reconcile against the DB (additive + Active-gated, Notion wins on synced columns). Structured properties snapshot into hub tables; page bodies stay live-fetched as today. Extra properties are stored as a `notionProps` JSON array and rendered as a meta-table.

**Tech Stack:** Next.js 16 (App Router, route handlers), TypeScript, Drizzle ORM + better-sqlite3, `@notionhq/client` v5 (data-source query API), vitest (new, dev-only).

**Spec:** `docs/superpowers/specs/2026-07-10-notion-database-sync-design.md`

**Notion data source IDs (Explorers of Exandria, for manual verification):**
- Characters: `collection://82f89c80-3900-4681-bbcf-4de4f9331aba`
- Items & Loot: `collection://5dae0edc-69b6-499e-97f9-a7ce3da304e5`
- Factions & Organizations: `collection://9380408e-eb15-46c3-8a5c-4b3eef73da60`

---

## File structure

| File | Responsibility |
|---|---|
| `vitest.config.ts` (new) | Dev-only test runner config (Node env) |
| `lib/notion/test-helpers.ts` (new) | `createTestDb()` — temp SQLite + drizzle for tests |
| `lib/db/schema.ts` (modify) | Add `notionSources` table + new entity columns |
| `lib/db/migrate.ts` (modify) | Create `notion_sources`; `addColumnIfMissing` the new columns |
| `lib/notion/client.ts` (modify) | `extractNotionDatabaseId`, `resolveDataSourceId`, `queryDataSource` |
| `lib/notion/props.ts` (new) | Pure Notion property readers + `extractDdbId` |
| `lib/notion/map.ts` (new) | `mapFactionRow` / `mapCharacterRow` / `mapItemRow` + shared types |
| `lib/notion/reconcile.ts` (new) | `EntityRepo` interface + pure `reconcileEntity` |
| `lib/notion/repos.ts` (new) | Drizzle-backed repos + link helpers |
| `lib/notion/sync.ts` (new) | `syncCampaign` orchestration + summary |
| `lib/notion/*.test.ts` (new) | Unit + integration tests |
| `app/api/notion/sources/route.ts` (new) | `GET/PUT` the three database URLs per campaign |
| `app/api/notion/sync/route.ts` (new) | `POST` run sync, return summary |
| `components/glossary/NotionPropsTable.tsx` (new) | Renders the `notionProps` meta-table |
| `components/settings/NotionSyncPanel.tsx` (new) | Config + Sync-now UI |
| `app/settings/page.tsx` (modify) | Mount `NotionSyncPanel` |
| `components/glossary/SimpleEntityDetail.tsx` (modify) | Show meta-table (items/factions) |
| `app/characters/[id]/page.tsx` (modify) | Show meta-table (characters) |
| `app/api/{characters,items,factions}/[id]/route.ts` (modify) | Return `notionProps` |
| `app/api/{characters,items,factions}/route.ts` (modify) | Hide archived; `?includeArchived=1` |
| entity list pages (modify) | "Show archived (N)" toggle |

**Shared types (defined in `lib/notion/map.ts`, referenced throughout):**

```typescript
export type PropEntry = { label: string; value: string };

export interface MappedEntity {
  notionPageId: string;                 // dashless page id
  notionUrl: string;                    // canonical page URL
  name: string;
  archived: boolean;
  notionProps: PropEntry[];             // ordered, blanks omitted
  extra: Record<string, unknown>;       // table-specific synced columns
  affiliations?: string[];              // characters only: faction names
  heldByPageIds?: string[];             // items only: character page ids
}
```

---

## Task 1: Vitest setup (dev-only)

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`
- Test: `lib/notion/smoke.test.ts` (temporary, deleted in Step 6)

- [ ] **Step 1: Install vitest as a dev dependency**

Run: `npm install -D vitest@^3`
Expected: `vitest` appears under `devDependencies`; no runtime deps change.

- [ ] **Step 2: Create the config**

`vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
```

- [ ] **Step 3: Add the test script**

In `package.json` `"scripts"`, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Write a smoke test**

`lib/notion/smoke.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("vitest", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run it**

Run: `npm test`
Expected: PASS — 1 test passing.

- [ ] **Step 6: Delete the smoke test and commit**

```bash
rm lib/notion/smoke.test.ts
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest (dev-only) for the notion sync engine"
```

Note: vitest is dev-only. It is never imported by app code, so `next build` and the Docker runtime image are unaffected.

---

## Task 2: Schema + migration for sync

**Files:**
- Modify: `lib/db/schema.ts`
- Modify: `lib/db/migrate.ts:170-193`

- [ ] **Step 1: Add columns + the sources table to the Drizzle schema**

In `lib/db/schema.ts`, add these columns to **each** of `characters`, `items`, and `factions` (place them just before `createdAt` in each table):

```typescript
  notionPageId: text("notion_page_id"),
  notionProps: text("notion_props"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  notionSyncedAt: integer("notion_synced_at", { mode: "timestamp" }),
```

Then add the new table after `factions` (before `characterFactions`):

```typescript
export const notionSources = sqliteTable(
  "notion_sources",
  {
    campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    entityType: text("entity_type", { enum: ["characters", "items", "factions"] }).notNull(),
    databaseUrl: text("database_url").notNull(),
    dataSourceId: text("data_source_id"),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
    lastStatus: text("last_status"),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.entityType] })]
);
```

And export its types near the bottom with the others:

```typescript
export type NotionSource = typeof notionSources.$inferSelect;
export type NewNotionSource = typeof notionSources.$inferInsert;
```

- [ ] **Step 2: Add the raw-SQL migration**

In `lib/db/migrate.ts`, inside the big `sqlite.exec(\`...\`)` block, add this table create alongside the other `CREATE TABLE IF NOT EXISTS` statements (e.g. right after the `character_items` table):

```sql
    CREATE TABLE IF NOT EXISTS notion_sources (
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      database_url TEXT NOT NULL,
      data_source_id TEXT,
      last_synced_at INTEGER,
      last_status TEXT,
      PRIMARY KEY (campaign_id, entity_type)
    );
```

- [ ] **Step 3: Add the additive column migrations**

In `lib/db/migrate.ts`, in the `addColumnIfMissing(...)` block (after the `locations` line ~187), add:

```typescript
  for (const table of ["characters", "items", "factions"]) {
    addColumnIfMissing(table, "notion_page_id", "TEXT");
    addColumnIfMissing(table, "notion_props", "TEXT");
    addColumnIfMissing(table, "archived", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing(table, "notion_synced_at", "INTEGER");
  }
```

- [ ] **Step 4: Verify the migration runs**

Run: `DB_PATH=/tmp/notion-migrate-check.db node --experimental-strip-types -e "import('./lib/db/migrate.ts').then(m=>{m.runMigrations();console.log('ok')})" 2>/dev/null || DB_PATH=/tmp/notion-migrate-check.db npx tsx -e "import {runMigrations} from './lib/db/migrate'; runMigrations(); console.log('ok')"`
Expected: prints `ok`. Then confirm columns exist:
Run: `sqlite3 /tmp/notion-migrate-check.db "PRAGMA table_info(characters);" && sqlite3 /tmp/notion-migrate-check.db ".tables" | tr ' ' '\n' | grep notion_sources`
Expected: `notion_page_id`, `notion_props`, `archived`, `notion_synced_at` present; `notion_sources` listed.

- [ ] **Step 5: Verify build + commit**

Run: `npm run build`
Expected: build succeeds.

```bash
rm -f /tmp/notion-migrate-check.db
git add lib/db/schema.ts lib/db/migrate.ts
git commit -m "feat: schema + migration for notion sync (sources table, entity columns)"
```

---

## Task 3: Test DB helper

**Files:**
- Create: `lib/notion/test-helpers.ts`

- [ ] **Step 1: Write the helper**

`lib/notion/test-helpers.ts`:

```typescript
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import os from "os";
import path from "path";
import crypto from "crypto";
import * as schema from "@/lib/db/schema";
import { runMigrations } from "@/lib/db/migrate";

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/** Fresh migrated SQLite file + drizzle instance for a single test. */
export function createTestDb(): { db: TestDb; campaignId: string } {
  const file = path.join(os.tmpdir(), `notion-sync-${crypto.randomUUID()}.db`);
  process.env.DB_PATH = file; // runMigrations() reads DB_PATH at call time
  runMigrations();

  const sqlite = new Database(file);
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });

  const campaignId = crypto.randomUUID();
  sqlite
    .prepare("INSERT INTO campaigns (id, name, created_at) VALUES (?, ?, ?)")
    .run(campaignId, "Test Campaign", Math.floor(Date.now() / 1000));

  return { db, campaignId };
}
```

- [ ] **Step 2: Verify it compiles via a throwaway test**

Create `lib/notion/test-helpers.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createTestDb } from "./test-helpers";
import { campaigns } from "@/lib/db/schema";

describe("createTestDb", () => {
  it("creates a migrated db with a campaign", async () => {
    const { db, campaignId } = createTestDb();
    const rows = await db.select().from(campaigns);
    expect(rows.find((c) => c.id === campaignId)).toBeTruthy();
  });
});
```

Run: `npm test lib/notion/test-helpers.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/notion/test-helpers.ts lib/notion/test-helpers.test.ts
git commit -m "test: temp-db helper for notion sync tests"
```

---

## Task 4: Pure property readers + DDB id extraction

**Files:**
- Create: `lib/notion/props.ts`
- Test: `lib/notion/props.test.ts`

- [ ] **Step 1: Write failing tests**

`lib/notion/props.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  readTitle, readSelect, readMultiSelect, readCheckbox,
  readNumber, readUrl, readText, readRelationIds, extractDdbId,
} from "./props";

const props = {
  Name: { type: "title", title: [{ plain_text: "Ilthara" }, { plain_text: " Duskweave" }] },
  Type: { type: "select", select: { name: "NPC" } },
  Empty: { type: "select", select: null },
  Class: { type: "multi_select", multi_select: [{ name: "Rogue" }, { name: "Wizard" }] },
  Active: { type: "checkbox", checkbox: true },
  Level: { type: "number", number: 4 },
  Sheet: { type: "url", url: "https://www.dndbeyond.com/characters/145821922" },
  Role: { type: "rich_text", rich_text: [{ plain_text: "Acquisitions Operative" }] },
  Held: { type: "relation", relation: [{ id: "213e996b-e66d-80c4-ac96-d28bdeda0d8b" }] },
} as const;

describe("property readers", () => {
  it("reads title, joining segments", () => expect(readTitle(props.Name)).toBe("Ilthara Duskweave"));
  it("reads select", () => expect(readSelect(props.Type)).toBe("NPC"));
  it("returns null for empty select", () => expect(readSelect(props.Empty)).toBeNull());
  it("reads multi_select", () => expect(readMultiSelect(props.Class)).toEqual(["Rogue", "Wizard"]));
  it("reads checkbox", () => expect(readCheckbox(props.Active)).toBe(true));
  it("reads number", () => expect(readNumber(props.Level)).toBe(4));
  it("reads url", () => expect(readUrl(props.Sheet)).toContain("dndbeyond"));
  it("reads rich_text", () => expect(readText(props.Role)).toBe("Acquisitions Operative"));
  it("reads relation ids dashless", () =>
    expect(readRelationIds(props.Held)).toEqual(["213e996be66d80c4ac96d28bdeda0d8b"]));
  it("handles missing property gracefully", () => expect(readSelect(undefined)).toBeNull());
});

describe("extractDdbId", () => {
  it("pulls the numeric id from a dndbeyond url", () =>
    expect(extractDdbId("https://www.dndbeyond.com/characters/145821922")).toBe("145821922"));
  it("returns null for non-ddb urls", () =>
    expect(extractDdbId("https://example.com/x")).toBeNull());
  it("returns null for null", () => expect(extractDdbId(null)).toBeNull());
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test lib/notion/props.test.ts`
Expected: FAIL — cannot find module `./props`.

- [ ] **Step 3: Implement**

`lib/notion/props.ts`:

```typescript
// Notion data-source query returns each row's properties keyed by property name.
// These readers accept the raw property object (or undefined if absent) and are
// tolerant of missing/renamed properties — a renamed property just reads as empty.
type Prop = Record<string, unknown> | undefined;

function arr(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
}

export function readTitle(p: Prop): string {
  return arr(p?.["title"]).map((t) => String(t.plain_text ?? "")).join("").trim();
}

export function readText(p: Prop): string {
  return arr(p?.["rich_text"]).map((t) => String(t.plain_text ?? "")).join("").trim();
}

export function readSelect(p: Prop): string | null {
  const sel = p?.["select"] as { name?: string } | null | undefined;
  return sel?.name ?? null;
}

export function readMultiSelect(p: Prop): string[] {
  return arr(p?.["multi_select"]).map((o) => String(o.name ?? "")).filter(Boolean);
}

export function readCheckbox(p: Prop): boolean {
  return p?.["checkbox"] === true;
}

export function readNumber(p: Prop): number | null {
  const n = p?.["number"];
  return typeof n === "number" ? n : null;
}

export function readUrl(p: Prop): string | null {
  const u = p?.["url"];
  return typeof u === "string" && u.length > 0 ? u : null;
}

export function readRelationIds(p: Prop): string[] {
  return arr(p?.["relation"]).map((r) => String(r.id ?? "").replace(/-/g, "")).filter(Boolean);
}

export function extractDdbId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/dndbeyond\.com\/(?:profile\/[^/]+\/)?characters\/(\d+)/i);
  return m ? m[1] : null;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test lib/notion/props.test.ts`
Expected: PASS — all cases green.

- [ ] **Step 5: Commit**

```bash
git add lib/notion/props.ts lib/notion/props.test.ts
git commit -m "feat: pure notion property readers + ddb id extraction"
```

---

## Task 5: Row mappers (Factions, Characters, Items)

**Files:**
- Create: `lib/notion/map.ts`
- Test: `lib/notion/map.test.ts`

- [ ] **Step 1: Write failing tests**

`lib/notion/map.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mapFactionRow, mapCharacterRow, mapItemRow } from "./map";

const page = (id: string, properties: Record<string, unknown>) => ({
  id,
  url: `https://www.notion.so/${id.replace(/-/g, "")}`,
  properties,
});

describe("mapFactionRow", () => {
  it("maps name, active→archived, and props", () => {
    const m = mapFactionRow(page("9380408e-eb15-46c3-8a5c-4b3eef73da60", {
      Name: { type: "title", title: [{ plain_text: "Children of Malice" }] },
      Active: { type: "checkbox", checkbox: true },
      Type: { type: "select", select: { name: "Criminal" } },
      "Alignment Toward Party": { type: "select", select: { name: "Opposed" } },
    }));
    expect(m.name).toBe("Children of Malice");
    expect(m.archived).toBe(false);
    expect(m.notionPageId).toBe("9380408eeb1546c38a5c4b3eef73da60");
    expect(m.notionProps).toEqual([
      { label: "Type", value: "Criminal" },
      { label: "Alignment", value: "Opposed" },
    ]);
  });
  it("archives when Active is false", () => {
    const m = mapFactionRow(page("f1", {
      Name: { type: "title", title: [{ plain_text: "Defunct" }] },
      Active: { type: "checkbox", checkbox: false },
    }));
    expect(m.archived).toBe(true);
    expect(m.notionProps).toEqual([]);
  });
});

describe("mapCharacterRow", () => {
  it("maps type, ddb id, affiliations, and props", () => {
    const m = mapCharacterRow(page("c1", {
      Name: { type: "title", title: [{ plain_text: "Shale" }] },
      Type: { type: "select", select: { name: "Player" } },
      "Character Sheet": { type: "url", url: "https://www.dndbeyond.com/characters/145821922" },
      Affiliations: { type: "multi_select", multi_select: [{ name: "Children of Malice" }] },
      Active: { type: "checkbox", checkbox: true },
      Race: { type: "select", select: { name: "Dragonborne" } },
      Class: { type: "multi_select", multi_select: [{ name: "Rogue" }] },
      "Character Level": { type: "number", number: 4 },
      "Disposition Toward Party": { type: "select", select: { name: "Friendly" } },
      "Role/Title": { type: "rich_text", rich_text: [{ plain_text: "Party Rogue" }] },
    }));
    expect(m.extra).toEqual({ type: "pc", ddbCharacterId: "145821922" });
    expect(m.affiliations).toEqual(["Children of Malice"]);
    expect(m.notionProps).toEqual([
      { label: "Race", value: "Dragonborne" },
      { label: "Class", value: "Rogue" },
      { label: "Level", value: "4" },
      { label: "Disposition", value: "Friendly" },
      { label: "Role/Title", value: "Party Rogue" },
    ]);
  });
  it("keeps a non-ddb sheet url in props and leaves ddb id null", () => {
    const m = mapCharacterRow(page("c2", {
      Name: { type: "title", title: [{ plain_text: "NPC" }] },
      Type: { type: "select", select: { name: "NPC" } },
      "Character Sheet": { type: "url", url: "https://example.com/sheet" },
    }));
    expect(m.extra).toEqual({ type: "npc", ddbCharacterId: null });
    expect(m.notionProps).toContainEqual({ label: "Character Sheet", value: "https://example.com/sheet" });
  });
});

describe("mapItemRow", () => {
  it("maps description (synced), held-by ids, and props", () => {
    const m = mapItemRow(page("i1", {
      Name: { type: "title", title: [{ plain_text: "Fragment of Caedrus" }] },
      Description: { type: "rich_text", rich_text: [{ plain_text: "A shard of a divine artifact." }] },
      Type: { type: "select", select: { name: "Quest Item" } },
      Rarity: { type: "select", select: { name: "Artifact" } },
      "Held By": { type: "relation", relation: [{ id: "213e996b-e66d-80d6-a7cd-f142c199b757" }] },
    }));
    expect(m.extra).toEqual({ description: "A shard of a divine artifact." });
    expect(m.heldByPageIds).toEqual(["213e996be66d80d6a7cdf142c199b757"]);
    expect(m.notionProps).toEqual([
      { label: "Type", value: "Quest Item" },
      { label: "Rarity", value: "Artifact" },
    ]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test lib/notion/map.test.ts`
Expected: FAIL — cannot find module `./map`.

- [ ] **Step 3: Implement**

`lib/notion/map.ts`:

```typescript
import { extractNotionPageId } from "./client";
import {
  readTitle, readText, readSelect, readMultiSelect,
  readCheckbox, readNumber, readUrl, readRelationIds, extractDdbId,
} from "./props";

export type PropEntry = { label: string; value: string };

export interface MappedEntity {
  notionPageId: string;
  notionUrl: string;
  name: string;
  archived: boolean;
  notionProps: PropEntry[];
  extra: Record<string, unknown>;
  affiliations?: string[];
  heldByPageIds?: string[];
}

export interface NotionRow {
  id: string;
  url: string;
  properties: Record<string, unknown>;
}

type P = Record<string, unknown> | undefined;
function prop(row: NotionRow, name: string): P {
  return row.properties[name] as P;
}
function pushIf(list: PropEntry[], label: string, value: string | number | null): void {
  if (value !== null && value !== undefined && String(value).length > 0) {
    list.push({ label, value: String(value) });
  }
}
function pageId(row: NotionRow): string {
  return extractNotionPageId(row.url) ?? row.id.replace(/-/g, "");
}

export function mapFactionRow(row: NotionRow): MappedEntity {
  const props: PropEntry[] = [];
  pushIf(props, "Type", readSelect(prop(row, "Type")));
  pushIf(props, "Alignment", readSelect(prop(row, "Alignment Toward Party")));
  return {
    notionPageId: pageId(row),
    notionUrl: row.url,
    name: readTitle(prop(row, "Name")),
    archived: !readCheckbox(prop(row, "Active")),
    notionProps: props,
    extra: {},
  };
}

export function mapCharacterRow(row: NotionRow): MappedEntity {
  const sheetUrl = readUrl(prop(row, "Character Sheet"));
  const ddbCharacterId = extractDdbId(sheetUrl);

  const props: PropEntry[] = [];
  pushIf(props, "Race", readSelect(prop(row, "Race")));
  pushIf(props, "Class", readMultiSelect(prop(row, "Class")).join(", "));
  pushIf(props, "Level", readNumber(prop(row, "Character Level")));
  pushIf(props, "Disposition", readSelect(prop(row, "Disposition Toward Party")));
  pushIf(props, "Role/Title", readText(prop(row, "Role/Title")));
  if (sheetUrl && !ddbCharacterId) pushIf(props, "Character Sheet", sheetUrl);

  return {
    notionPageId: pageId(row),
    notionUrl: row.url,
    name: readTitle(prop(row, "Name")),
    archived: !readCheckbox(prop(row, "Active")),
    notionProps: props,
    extra: { type: readSelect(prop(row, "Type")) === "Player" ? "pc" : "npc", ddbCharacterId },
    affiliations: readMultiSelect(prop(row, "Affiliations")),
  };
}

export function mapItemRow(row: NotionRow): MappedEntity {
  const props: PropEntry[] = [];
  pushIf(props, "Type", readSelect(prop(row, "Type")));
  pushIf(props, "Rarity", readSelect(prop(row, "Rarity")));
  return {
    notionPageId: pageId(row),
    notionUrl: row.url,
    name: readTitle(prop(row, "Name")),
    archived: false, // Items & Loot has no Active property
    notionProps: props,
    extra: { description: readText(prop(row, "Description")) || null },
    heldByPageIds: readRelationIds(prop(row, "Held By")),
  };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test lib/notion/map.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/notion/map.ts lib/notion/map.test.ts
git commit -m "feat: notion row mappers for factions, characters, items"
```

---

## Task 6: Pure reconcile logic

**Files:**
- Create: `lib/notion/reconcile.ts`
- Test: `lib/notion/reconcile.test.ts`

- [ ] **Step 1: Write failing tests (fake in-memory repo)**

`lib/notion/reconcile.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { reconcileEntity, type EntityRepo, type EntityRow } from "./reconcile";
import type { MappedEntity } from "./map";

// Minimal in-memory repo mirroring the real drizzle repo contract.
function fakeRepo(): EntityRepo & { rows: EntityRow[] } {
  const rows: EntityRow[] = [];
  let n = 0;
  return {
    rows,
    findByPageId: (pid) => rows.find((r) => r.notionPageId === pid),
    findByNameUnlinked: (name) =>
      rows.find((r) => r.name.toLowerCase() === name.toLowerCase() && !r.notionPageId),
    insert: (m) => {
      const id = `id${++n}`;
      rows.push({ id, name: m.name, notionPageId: m.notionPageId, archived: m.archived });
      return id;
    },
    update: (id, m) => {
      const row = rows.find((r) => r.id === id)!;
      const changed = row.name !== m.name || row.archived !== m.archived || !row.notionPageId;
      row.name = m.name;
      row.notionPageId = m.notionPageId;
      row.archived = m.archived;
      return changed;
    },
  };
}

const mapped = (name: string, pid: string, archived = false): MappedEntity => ({
  notionPageId: pid, notionUrl: `u/${pid}`, name, archived, notionProps: [], extra: {},
});

describe("reconcileEntity", () => {
  let repo: ReturnType<typeof fakeRepo>;
  beforeEach(() => { repo = fakeRepo(); });

  it("creates a new entity", () => {
    expect(reconcileEntity(repo, mapped("Veldros", "p1")).action).toBe("created");
    expect(repo.rows).toHaveLength(1);
  });

  it("adopts an existing unlinked entity by name", () => {
    repo.rows.push({ id: "old", name: "Veldros", notionPageId: null, archived: false });
    const r = reconcileEntity(repo, mapped("Veldros", "p1"));
    expect(r.action).toBe("adopted");
    expect(repo.rows.find((x) => x.id === "old")!.notionPageId).toBe("p1");
    expect(repo.rows).toHaveLength(1); // no duplicate
  });

  it("updates a linked entity when a field changed", () => {
    reconcileEntity(repo, mapped("Veldros", "p1"));
    expect(reconcileEntity(repo, mapped("Veldros the Honest", "p1")).action).toBe("updated");
  });

  it("reports unchanged on an identical re-sync", () => {
    reconcileEntity(repo, mapped("Veldros", "p1"));
    expect(reconcileEntity(repo, mapped("Veldros", "p1")).action).toBe("unchanged");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test lib/notion/reconcile.test.ts`
Expected: FAIL — cannot find module `./reconcile`.

- [ ] **Step 3: Implement**

`lib/notion/reconcile.ts`:

```typescript
import type { MappedEntity } from "./map";

export interface EntityRow {
  id: string;
  name: string;
  notionPageId: string | null;
  archived: boolean;
}

export interface EntityRepo {
  findByPageId(pageId: string): EntityRow | undefined;
  findByNameUnlinked(name: string): EntityRow | undefined;
  insert(m: MappedEntity): string;             // returns new id
  update(id: string, m: MappedEntity): boolean; // returns whether a synced field changed
}

export type ReconcileAction = "created" | "adopted" | "updated" | "unchanged";

export interface ReconcileResult {
  action: ReconcileAction;
  id: string;
  warning?: string;
}

export function reconcileEntity(repo: EntityRepo, m: MappedEntity): ReconcileResult {
  const linked = repo.findByPageId(m.notionPageId);
  if (linked) {
    const changed = repo.update(linked.id, m);
    return { action: changed ? "updated" : "unchanged", id: linked.id };
  }

  const adoptable = repo.findByNameUnlinked(m.name);
  if (adoptable) {
    repo.update(adoptable.id, m); // stamps the page id + syncs fields
    return { action: "adopted", id: adoptable.id };
  }

  return { action: "created", id: repo.insert(m) };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test lib/notion/reconcile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/notion/reconcile.ts lib/notion/reconcile.test.ts
git commit -m "feat: pure reconcile logic (create/adopt/update/unchanged)"
```

---

## Task 7: Drizzle-backed repos + link helpers

**Files:**
- Create: `lib/notion/repos.ts`
- Test: `lib/notion/repos.test.ts`

- [ ] **Step 1: Write failing tests (real temp DB)**

`lib/notion/repos.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "./test-helpers";
import { makeEntityRepo, linkCharacterFactionsByName, linkCharacterItemsByPageId } from "./repos";
import { reconcileEntity } from "./reconcile";
import { characters, factions, items, characterFactions, characterItems } from "@/lib/db/schema";
import type { MappedEntity } from "./map";

const m = (over: Partial<MappedEntity> & { name: string; notionPageId: string }): MappedEntity => ({
  notionUrl: `u/${over.notionPageId}`, archived: false, notionProps: [], extra: {}, ...over,
});

describe("makeEntityRepo", () => {
  it("inserts, finds by page id, and updates factions", () => {
    const { db, campaignId } = createTestDb();
    const repo = makeEntityRepo(db, factions, campaignId);

    const r1 = reconcileEntity(repo, m({ name: "Children of Malice", notionPageId: "f1", notionProps: [{ label: "Type", value: "Criminal" }] }));
    expect(r1.action).toBe("created");

    const row = db.select().from(factions).where(eq(factions.id, r1.id)).get()!;
    expect(row.name).toBe("Children of Malice");
    expect(JSON.parse(row.notionProps!)).toEqual([{ label: "Type", value: "Criminal" }]);
    expect(Boolean(row.archived)).toBe(false);

    // idempotent
    expect(reconcileEntity(repo, m({ name: "Children of Malice", notionPageId: "f1", notionProps: [{ label: "Type", value: "Criminal" }] })).action).toBe("unchanged");
  });

  it("writes character type + ddb id from extra, leaves description untouched", () => {
    const { db, campaignId } = createTestDb();
    const repo = makeEntityRepo(db, characters, campaignId);
    const r = reconcileEntity(repo, m({ name: "Shale", notionPageId: "c1", extra: { type: "pc", ddbCharacterId: "145821922" } }));
    const row = db.select().from(characters).where(eq(characters.id, r.id)).get()!;
    expect(row.type).toBe("pc");
    expect(row.ddbCharacterId).toBe("145821922");
    expect(row.description).toBeNull();
  });

  it("writes item description from extra (synced)", () => {
    const { db, campaignId } = createTestDb();
    const repo = makeEntityRepo(db, items, campaignId);
    const r = reconcileEntity(repo, m({ name: "Fragment", notionPageId: "i1", extra: { description: "A shard." } }));
    const row = db.select().from(items).where(eq(items.id, r.id)).get()!;
    expect(row.description).toBe("A shard.");
  });
});

describe("link helpers (additive)", () => {
  it("links a character to factions by name and never duplicates", () => {
    const { db, campaignId } = createTestDb();
    const fRepo = makeEntityRepo(db, factions, campaignId);
    const cRepo = makeEntityRepo(db, characters, campaignId);
    const fac = reconcileEntity(fRepo, m({ name: "Children of Malice", notionPageId: "f1" }));
    const chr = reconcileEntity(cRepo, m({ name: "Shale", notionPageId: "c1", extra: { type: "pc" } }));

    linkCharacterFactionsByName(db, campaignId, chr.id, ["children of malice", "Nonexistent"]);
    linkCharacterFactionsByName(db, campaignId, chr.id, ["Children of Malice"]); // re-run

    const links = db.select().from(characterFactions).where(eq(characterFactions.characterId, chr.id)).all();
    expect(links).toHaveLength(1);
    expect(links[0].factionId).toBe(fac.id);
  });

  it("links an item to characters by notion page id", () => {
    const { db, campaignId } = createTestDb();
    const cRepo = makeEntityRepo(db, characters, campaignId);
    const iRepo = makeEntityRepo(db, items, campaignId);
    const chr = reconcileEntity(cRepo, m({ name: "Bartlebee", notionPageId: "cPAGE", extra: { type: "pc" } }));
    const itm = reconcileEntity(iRepo, m({ name: "Fragment", notionPageId: "i1" }));

    linkCharacterItemsByPageId(db, itm.id, ["cPAGE", "unknownPage"]);
    const links = db.select().from(characterItems).where(and(eq(characterItems.itemId, itm.id), eq(characterItems.characterId, chr.id))).all();
    expect(links).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test lib/notion/repos.test.ts`
Expected: FAIL — cannot find module `./repos`.

- [ ] **Step 3: Implement**

`lib/notion/repos.ts`:

```typescript
import crypto from "crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  characters, items, factions, characterFactions, characterItems,
} from "@/lib/db/schema";
import type { EntityRepo, EntityRow } from "./reconcile";
import type { MappedEntity } from "./map";

type Db = BetterSQLite3Database<Record<string, unknown>>;
type SyncTable = typeof characters | typeof items | typeof factions;

/** Columns every synced entity table shares plus the table-specific `extra`. */
function baseValues(m: MappedEntity, now: Date) {
  return {
    name: m.name,
    notionUrl: m.notionUrl,
    notionPageId: m.notionPageId,
    notionProps: JSON.stringify(m.notionProps),
    archived: m.archived,
    notionSyncedAt: now,
    updatedAt: now,
    ...m.extra, // type/ddbCharacterId (characters) or description (items)
  };
}

/** True if any synced column differs from the current row. */
function differs(row: Record<string, unknown>, m: MappedEntity): boolean {
  if (row.name !== m.name) return true;
  if (row.notionUrl !== m.notionUrl) return true;
  if (Boolean(row.archived) !== m.archived) return true;
  if ((row.notionProps ?? null) !== JSON.stringify(m.notionProps)) return true;
  for (const [k, v] of Object.entries(m.extra)) {
    if ((row[k] ?? null) !== (v ?? null)) return true;
  }
  return false;
}

export function makeEntityRepo(db: Db, table: SyncTable, campaignId: string): EntityRepo {
  const t = table as unknown as typeof characters; // shared columns; safe for base ops

  return {
    findByPageId(pageId: string): EntityRow | undefined {
      const r = db.select().from(t).where(and(eq(t.campaignId, campaignId), eq(t.notionPageId, pageId))).get();
      return r ? { id: r.id, name: r.name, notionPageId: r.notionPageId, archived: Boolean(r.archived) } : undefined;
    },
    findByNameUnlinked(name: string): EntityRow | undefined {
      const r = db.select().from(t)
        .where(and(eq(t.campaignId, campaignId), isNull(t.notionPageId), sql`lower(${t.name}) = lower(${name})`))
        .get();
      return r ? { id: r.id, name: r.name, notionPageId: r.notionPageId, archived: Boolean(r.archived) } : undefined;
    },
    insert(m: MappedEntity): string {
      const id = crypto.randomUUID();
      const now = new Date();
      db.insert(t).values({ id, campaignId, createdAt: now, ...baseValues(m, now) }).run();
      return id;
    },
    update(id: string, m: MappedEntity): boolean {
      const current = db.select().from(t).where(eq(t.id, id)).get()!;
      const changed = !current.notionPageId || differs(current as Record<string, unknown>, m);
      // Always stamp notionSyncedAt; only bump updatedAt when something changed.
      const now = new Date();
      const values = baseValues(m, now);
      if (!changed) values.updatedAt = current.updatedAt as Date;
      db.update(t).set(values).where(eq(t.id, id)).run();
      return changed;
    },
  };
}

/** Additive: add character↔faction links matched by faction name; never removes. */
export function linkCharacterFactionsByName(
  db: Db, campaignId: string, characterId: string, factionNames: string[],
): void {
  for (const name of factionNames) {
    const fac = db.select().from(factions)
      .where(and(eq(factions.campaignId, campaignId), sql`lower(${factions.name}) = lower(${name})`))
      .get();
    if (!fac) continue;
    db.insert(characterFactions).values({ characterId, factionId: fac.id }).onConflictDoNothing().run();
  }
}

/** Additive: add character↔item links, resolving characters by notion page id. */
export function linkCharacterItemsByPageId(
  db: Db, itemId: string, characterPageIds: string[],
): void {
  for (const pid of characterPageIds) {
    const chr = db.select().from(characters).where(eq(characters.notionPageId, pid)).get();
    if (!chr) continue;
    db.insert(characterItems).values({ characterId: chr.id, itemId }).onConflictDoNothing().run();
  }
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test lib/notion/repos.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/notion/repos.ts lib/notion/repos.test.ts
git commit -m "feat: drizzle-backed sync repos + additive link helpers"
```

---

## Task 8: Notion client — data-source resolution + query

**Files:**
- Modify: `lib/notion/client.ts`

- [ ] **Step 1: Write failing test for the URL parser**

Append to a new test file `lib/notion/client.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { extractNotionDatabaseId } from "./client";

describe("extractNotionDatabaseId", () => {
  it("pulls the 32-hex id from a database url", () => {
    expect(extractNotionDatabaseId("https://app.notion.com/p/06ab5086a1cf422ebb944a789a3bed2b?pvs=1"))
      .toBe("06ab5086a1cf422ebb944a789a3bed2b");
  });
  it("returns null when there is no id", () => {
    expect(extractNotionDatabaseId("https://example.com")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test lib/notion/client.test.ts`
Expected: FAIL — `extractNotionDatabaseId` is not exported.

- [ ] **Step 3: Implement the additions**

In `lib/notion/client.ts`, add below `extractNotionPageId`:

```typescript
// Database and page ids share the same 32-hex shape; reuse the existing pattern.
export function extractNotionDatabaseId(url: string): string | null {
  return extractNotionPageId(url);
}

export interface NotionRow {
  id: string;
  url: string;
  properties: Record<string, unknown>;
}

// v5 API (2025-09-03): a database has one or more data sources. Resolve the
// pasted database URL to its first data source id, then query that.
export async function resolveDataSourceId(databaseId: string, token: string): Promise<string> {
  const notion = new Client({ auth: token });
  const db = (await notion.databases.retrieve({ database_id: databaseId })) as unknown as {
    data_sources?: Array<{ id: string }>;
  };
  const first = db.data_sources?.[0]?.id;
  if (!first) throw new Error("That database has no data source");
  return first;
}

export async function queryDataSource(dataSourceId: string, token: string): Promise<NotionRow[]> {
  const notion = new Client({ auth: token });
  const rows: NotionRow[] = [];
  let cursor: string | undefined;

  do {
    const res = (await notion.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: cursor,
      page_size: 100,
    })) as unknown as {
      results: Array<{ id: string; url: string; properties: Record<string, unknown> }>;
      has_more: boolean;
      next_cursor: string | null;
    };
    for (const p of res.results) {
      rows.push({ id: p.id, url: p.url, properties: p.properties });
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return rows;
}
```

- [ ] **Step 4: Verify the v5 method names against the installed SDK**

Run: `node -e "const {Client}=require('@notionhq/client'); const c=new Client({auth:'x'}); console.log('dataSources.query', typeof c.dataSources.query, '| databases.retrieve', typeof c.databases.retrieve);"`
Expected: `dataSources.query function | databases.retrieve function`. If either is `undefined`, read `node_modules/@notionhq/client/build/src/Client.d.ts` for the correct v5 method path and adjust before continuing.

- [ ] **Step 5: Run the parser test + build**

Run: `npm test lib/notion/client.test.ts && npm run build`
Expected: test PASS; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add lib/notion/client.ts lib/notion/client.test.ts
git commit -m "feat: notion data-source resolution + paginated query"
```

---

## Task 9: Sync orchestration + summary

**Files:**
- Create: `lib/notion/sync.ts`
- Test: `lib/notion/sync.test.ts`

- [ ] **Step 1: Write failing integration test (fake queryRows)**

`lib/notion/sync.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-helpers";
import { syncCampaign, type SourceConfig } from "./sync";
import { characters, factions, items, characterFactions } from "@/lib/db/schema";
import type { NotionRow } from "./client";

const page = (id: string, properties: Record<string, unknown>): NotionRow => ({
  id, url: `https://www.notion.so/${id}`, properties,
});
const title = (t: string) => ({ type: "title", title: [{ plain_text: t }] });
const sel = (n: string) => ({ type: "select", select: { name: n } });
const chk = (b: boolean) => ({ type: "checkbox", checkbox: b });

function fixtures(): Record<string, NotionRow[]> {
  return {
    fac: [page("fac1", { Name: title("Children of Malice"), Active: chk(true), Type: sel("Criminal") })],
    chr: [page("chr1", {
      Name: title("Shale"), Type: sel("Player"), Active: chk(true),
      Affiliations: { type: "multi_select", multi_select: [{ name: "Children of Malice" }] },
    })],
    itm: [page("itm1", { Name: title("Fragment"), Description: { type: "rich_text", rich_text: [{ plain_text: "A shard." }] } })],
  };
}

function sources(f: Record<string, NotionRow[]>): { config: SourceConfig[]; queryRows: (id: string) => Promise<NotionRow[]> } {
  const map: Record<string, NotionRow[]> = { dsF: f.fac, dsC: f.chr, dsI: f.itm };
  return {
    config: [
      { entityType: "factions", dataSourceId: "dsF" },
      { entityType: "characters", dataSourceId: "dsC" },
      { entityType: "items", dataSourceId: "dsI" },
    ],
    queryRows: async (id) => map[id] ?? [],
  };
}

describe("syncCampaign", () => {
  it("creates entities and links across sources in dependency order", async () => {
    const { db, campaignId } = createTestDb();
    const { config, queryRows } = sources(fixtures());
    const summary = await syncCampaign({ db, campaignId, sources: config, queryRows });

    expect(summary.factions.created).toBe(1);
    expect(summary.characters.created).toBe(1);
    expect(summary.items.created).toBe(1);

    const chr = db.select().from(characters).where(eq(characters.campaignId, campaignId)).get()!;
    const links = db.select().from(characterFactions).where(eq(characterFactions.characterId, chr.id)).all();
    expect(links).toHaveLength(1); // Shale ↔ Children of Malice
    expect(db.select().from(items).where(eq(items.campaignId, campaignId)).get()!.description).toBe("A shard.");
  });

  it("is idempotent — a second run changes nothing", async () => {
    const { db, campaignId } = createTestDb();
    const { config, queryRows } = sources(fixtures());
    await syncCampaign({ db, campaignId, sources: config, queryRows });
    const second = await syncCampaign({ db, campaignId, sources: config, queryRows });
    expect(second.characters).toMatchObject({ created: 0, updated: 0, adopted: 0, unchanged: 1 });
  });

  it("archives an entity whose row disappears, never deletes it", async () => {
    const { db, campaignId } = createTestDb();
    const f = fixtures();
    const first = sources(f);
    await syncCampaign({ db, campaignId, sources: first.config, queryRows: first.queryRows });

    const empty = sources({ fac: [], chr: [], itm: [] });
    const summary = await syncCampaign({ db, campaignId, sources: empty.config, queryRows: empty.queryRows });

    expect(summary.factions.archived).toBe(1);
    const fac = db.select().from(factions).where(eq(factions.campaignId, campaignId)).get()!;
    expect(Boolean(fac.archived)).toBe(true); // archived, still present
  });

  it("records a per-source error without aborting the others", async () => {
    const { db, campaignId } = createTestDb();
    const { config } = sources(fixtures());
    const summary = await syncCampaign({
      db, campaignId, sources: config,
      queryRows: async (id) => { if (id === "dsC") throw new Error("not shared"); return id === "dsF" ? fixtures().fac : []; },
    });
    expect(summary.characters.error).toContain("not shared");
    expect(summary.factions.created).toBe(1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test lib/notion/sync.test.ts`
Expected: FAIL — cannot find module `./sync`.

- [ ] **Step 3: Implement**

`lib/notion/sync.ts`:

```typescript
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { characters, items, factions } from "@/lib/db/schema";
import type { NotionRow } from "./client";
import { mapFactionRow, mapCharacterRow, mapItemRow, type MappedEntity } from "./map";
import { reconcileEntity, type ReconcileAction } from "./reconcile";
import { makeEntityRepo, linkCharacterFactionsByName, linkCharacterItemsByPageId } from "./repos";

type Db = BetterSQLite3Database<Record<string, unknown>>;
export type EntityType = "characters" | "items" | "factions";

export interface SourceConfig {
  entityType: EntityType;
  dataSourceId: string;
}

export interface SourceSummary {
  created: number; adopted: number; updated: number; unchanged: number; archived: number;
  warnings: string[]; error?: string;
}
export type SyncSummary = Record<EntityType, SourceSummary>;

const TABLES = { characters, items, factions } as const;
const MAPPERS: Record<EntityType, (row: NotionRow) => MappedEntity> = {
  factions: mapFactionRow, characters: mapCharacterRow, items: mapItemRow,
};
// Dependency order: link targets (factions, characters) before linkers.
const ORDER: EntityType[] = ["factions", "characters", "items"];

function emptySummary(): SourceSummary {
  return { created: 0, adopted: 0, updated: 0, unchanged: 0, archived: 0, warnings: [] };
}

export async function syncCampaign(opts: {
  db: Db;
  campaignId: string;
  sources: SourceConfig[];
  queryRows: (dataSourceId: string) => Promise<NotionRow[]>;
}): Promise<SyncSummary> {
  const { db, campaignId, sources, queryRows } = opts;
  const summary: SyncSummary = { characters: emptySummary(), items: emptySummary(), factions: emptySummary() };

  for (const type of ORDER) {
    const source = sources.find((s) => s.entityType === type);
    if (!source) continue;
    const s = summary[type];
    const table = TABLES[type];
    const repo = makeEntityRepo(db, table, campaignId);

    let rows: NotionRow[];
    try {
      rows = await queryRows(source.dataSourceId);
    } catch (err) {
      s.error = err instanceof Error ? err.message : "Failed to query Notion";
      continue;
    }

    const seenPageIds: string[] = [];
    for (const row of rows) {
      const mapped = MAPPERS[type](row);
      if (!mapped.name) { s.warnings.push(`Skipped a row with no name (${row.id})`); continue; }
      seenPageIds.push(mapped.notionPageId);

      const result = reconcileEntity(repo, mapped);
      s[result.action] += 1;

      if (type === "characters" && mapped.affiliations?.length) {
        linkCharacterFactionsByName(db, campaignId, result.id, mapped.affiliations);
      }
      if (type === "items" && mapped.heldByPageIds?.length) {
        linkCharacterItemsByPageId(db, result.id, mapped.heldByPageIds);
      }
    }

    // Active-gating: archive linked rows that Notion no longer returned.
    s.archived += archiveUnseen(db, table, campaignId, seenPageIds);
  }

  return summary;
}

/** Archive (never delete) rows that have a notionPageId but weren't in this sync. */
function archiveUnseen(db: Db, table: typeof characters | typeof items | typeof factions, campaignId: string, seenPageIds: string[]): number {
  const t = table as unknown as typeof characters;
  const now = new Date();
  const conditions = [
    eq(t.campaignId, campaignId),
    sql`${t.notionPageId} IS NOT NULL`,
    eq(t.archived, false),
  ];
  if (seenPageIds.length) conditions.push(notInArray(t.notionPageId, seenPageIds));
  const stale = db.select().from(t).where(and(...conditions)).all();
  if (stale.length === 0) return 0;
  db.update(t).set({ archived: true, updatedAt: now })
    .where(inArray(t.id, stale.map((r) => r.id))).run();
  return stale.length;
}
```

Note on the reconcile counter: `s[result.action] += 1` increments `created`/`adopted`/`updated`/`unchanged`, which are the exact `ReconcileAction` values — the four summary counters share those names by design.

- [ ] **Step 4: Run to confirm pass**

Run: `npm test lib/notion/sync.test.ts`
Expected: PASS — all four cases green.

- [ ] **Step 5: Run the whole suite + build**

Run: `npm test && npm run build`
Expected: all tests PASS; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add lib/notion/sync.ts lib/notion/sync.test.ts
git commit -m "feat: syncCampaign orchestration with per-source summary + archival"
```

---

## Task 10: Sources config API

**Files:**
- Create: `app/api/notion/sources/route.ts`

- [ ] **Step 1: Read an existing route for conventions**

Read `app/api/notion/page/route.ts` and `app/api/settings/route.ts` to match this repo's `NextResponse` + `db` usage and Next 16 route-handler style.

- [ ] **Step 2: Implement the route**

`app/api/notion/sources/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notionSources } from "@/lib/db/schema";
import { extractNotionDatabaseId } from "@/lib/notion/client";

const TYPES = ["characters", "items", "factions"] as const;
type EntityType = (typeof TYPES)[number];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });

  const rows = await db.select().from(notionSources).where(eq(notionSources.campaignId, campaignId));
  const byType: Record<string, unknown> = {};
  for (const r of rows) {
    byType[r.entityType] = { databaseUrl: r.databaseUrl, lastSyncedAt: r.lastSyncedAt, lastStatus: r.lastStatus };
  }
  return NextResponse.json({ sources: byType });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as { campaignId?: string; entityType?: string; databaseUrl?: string };
  const { campaignId, entityType, databaseUrl } = body;
  if (!campaignId || !entityType || !TYPES.includes(entityType as EntityType)) {
    return NextResponse.json({ error: "campaignId and a valid entityType are required" }, { status: 400 });
  }
  const url = (databaseUrl ?? "").trim();

  // Empty url clears the source.
  if (!url) {
    await db.delete(notionSources).where(and(
      eq(notionSources.campaignId, campaignId),
      eq(notionSources.entityType, entityType as EntityType),
    ));
    return NextResponse.json({ ok: true });
  }

  if (!extractNotionDatabaseId(url)) {
    return NextResponse.json({ error: "That doesn't look like a Notion database URL" }, { status: 400 });
  }

  await db.insert(notionSources)
    .values({ campaignId, entityType: entityType as EntityType, databaseUrl: url })
    .onConflictDoUpdate({
      target: [notionSources.campaignId, notionSources.entityType],
      set: { databaseUrl: url },
    });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds (route compiles).

- [ ] **Step 4: Commit**

```bash
git add app/api/notion/sources/route.ts
git commit -m "feat: per-campaign notion sources config API"
```

---

## Task 11: Sync-run API

**Files:**
- Create: `app/api/notion/sync/route.ts`

- [ ] **Step 1: Implement the route**

`app/api/notion/sync/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notionSources, settings } from "@/lib/db/schema";
import { resolveDataSourceId, queryDataSource, extractNotionDatabaseId } from "@/lib/notion/client";
import { syncCampaign, type SourceConfig } from "@/lib/notion/sync";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { campaignId?: string };
  const campaignId = body.campaignId;
  if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });

  const tokenRow = await db.query.settings.findFirst({ where: eq(settings.key, "notion_token") });
  if (!tokenRow?.value) {
    return NextResponse.json({ error: "Add a Notion integration token in Settings first" }, { status: 400 });
  }
  const token = tokenRow.value;

  const rows = await db.select().from(notionSources).where(eq(notionSources.campaignId, campaignId));
  if (rows.length === 0) {
    return NextResponse.json({ error: "No Notion databases configured for this campaign" }, { status: 400 });
  }

  // Resolve each configured database URL to its data source id (cache back to the row).
  const config: SourceConfig[] = [];
  const resolveErrors: Record<string, string> = {};
  for (const row of rows) {
    try {
      const dbId = extractNotionDatabaseId(row.databaseUrl);
      if (!dbId) throw new Error("Invalid database URL");
      const dataSourceId = row.dataSourceId ?? (await resolveDataSourceId(dbId, token));
      if (dataSourceId !== row.dataSourceId) {
        await db.update(notionSources).set({ dataSourceId })
          .where(eq(notionSources.campaignId, campaignId) && eq(notionSources.entityType, row.entityType));
      }
      config.push({ entityType: row.entityType, dataSourceId });
    } catch (err) {
      resolveErrors[row.entityType] = friendlyNotionError(err);
    }
  }

  const summary = await syncCampaign({
    db: db as never,
    campaignId,
    sources: config,
    queryRows: (dataSourceId) => queryDataSource(dataSourceId, token),
  });

  // Fold resolution errors into the summary.
  for (const [type, error] of Object.entries(resolveErrors)) {
    (summary as Record<string, { error?: string }>)[type].error = error;
  }

  const now = new Date();
  for (const row of rows) {
    await db.update(notionSources)
      .set({ lastSyncedAt: now, lastStatus: JSON.stringify(summary[row.entityType]) })
      .where(eq(notionSources.campaignId, campaignId) && eq(notionSources.entityType, row.entityType));
  }

  return NextResponse.json({ summary });
}

function friendlyNotionError(err: unknown): string {
  const msg = err instanceof Error ? err.message : "Sync failed";
  return /could not find|restricted|unauthorized|not shared/i.test(msg)
    ? "This database isn't shared with the integration (or doesn't exist)"
    : msg;
}
```

Note: the two `db.update(...).where(a && b)` calls must use Drizzle's `and(...)`. Import `and` from `drizzle-orm` and replace `eq(...) && eq(...)` with `and(eq(...), eq(...))` in both places (the `&&` is a placeholder to fix during implementation — do not ship it).

- [ ] **Step 2: Fix the `where` clauses**

Change the import to `import { and, eq } from "drizzle-orm";` and replace both `.where(eq(notionSources.campaignId, campaignId) && eq(notionSources.entityType, row.entityType))` with `.where(and(eq(notionSources.campaignId, campaignId), eq(notionSources.entityType, row.entityType)))`.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/api/notion/sync/route.ts
git commit -m "feat: notion sync run API (resolve sources, run, persist status)"
```

---

## Task 12: notionProps in entity detail APIs + meta-table component

**Files:**
- Modify: `app/api/characters/[id]/route.ts`, `app/api/items/[id]/route.ts`, `app/api/factions/[id]/route.ts`
- Create: `components/glossary/NotionPropsTable.tsx`

- [ ] **Step 1: Add `notionProps` to each detail API response**

In each of the three `GET` handlers, find where the entity is serialized to JSON and add a parsed `notionProps` field. Read the file first; the entity row has a `notionProps` string column. Add:

```typescript
// where the response object is built:
notionProps: entity.notionProps ? (JSON.parse(entity.notionProps) as Array<{ label: string; value: string }>) : [],
```

(Use whatever the local variable for the fetched row is named — `entity`, `row`, etc. Keep every other field already returned.)

- [ ] **Step 2: Create the meta-table component**

`components/glossary/NotionPropsTable.tsx`:

```typescript
import React from "react";

export type NotionProp = { label: string; value: string };

export function NotionPropsTable({ props }: { props: NotionProp[] }) {
  if (!props || props.length === 0) return null;
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
      {props.map((p) => (
        <React.Fragment key={p.label}>
          <dt className="text-muted-foreground">{p.label}</dt>
          <dd className="text-foreground/90">{p.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/api/characters/[id]/route.ts app/api/items/[id]/route.ts app/api/factions/[id]/route.ts components/glossary/NotionPropsTable.tsx
git commit -m "feat: expose notionProps in detail APIs + meta-table component"
```

---

## Task 13: Render the meta-table on detail pages

**Files:**
- Modify: `components/glossary/SimpleEntityDetail.tsx`
- Modify: `app/characters/[id]/page.tsx`

- [ ] **Step 1: Show the meta-table in SimpleEntityDetail (items + factions)**

In `components/glossary/SimpleEntityDetail.tsx`:
- Add `notionProps?: { label: string; value: string }[];` to the `SimpleEntityDetailData` interface.
- Import: `import { NotionPropsTable } from "@/components/glossary/NotionPropsTable";`
- In the `overview` `TabsContent`, directly under the `entity.description` block, add:

```tsx
{entity.notionProps && entity.notionProps.length > 0 && (
  <div className="space-y-2">
    <h3 className="font-display text-lg">Notion properties</h3>
    <NotionPropsTable props={entity.notionProps} />
  </div>
)}
```

- [ ] **Step 2: Show the meta-table on the character detail page**

Read `app/characters/[id]/page.tsx` to find its entity type + where overview content renders. Add `notionProps` to its data type, import `NotionPropsTable`, and render the same block (heading "Notion properties" + `<NotionPropsTable props={...} />`) in the overview/summary area near the description.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/glossary/SimpleEntityDetail.tsx app/characters/[id]/page.tsx
git commit -m "feat: render Notion properties meta-table on detail pages"
```

---

## Task 14: Hide archived entities in list APIs + pages

**Files:**
- Modify: `app/api/characters/route.ts`, `app/api/items/route.ts`, `app/api/factions/route.ts`
- Modify: the three list pages (`app/characters/page.tsx` or equivalent list components — locate them first)

- [ ] **Step 1: Filter archived out of list APIs by default**

In each list `GET` handler, read the file first, then add archived filtering. Where the query filters by `campaignId`, combine with an archived check unless `?includeArchived=1`:

```typescript
import { and, eq } from "drizzle-orm";
// ...
const includeArchived = new URL(req.url).searchParams.get("includeArchived") === "1";
const where = includeArchived
  ? eq(TABLE.campaignId, campaignId)
  : and(eq(TABLE.campaignId, campaignId), eq(TABLE.archived, false));
// use `where` in the .where(...) call; also return the count of archived rows:
```

Also return an `archivedCount` so the UI can label the toggle:

```typescript
const archivedCount = (await db.select().from(TABLE)
  .where(and(eq(TABLE.campaignId, campaignId), eq(TABLE.archived, true)))).length;
// include archivedCount in the JSON response alongside the list
```

(Replace `TABLE` with the actual imported table — `characters` / `items` / `factions`.)

- [ ] **Step 2: Add a "Show archived" toggle to each list page**

Locate the list page/component for each entity type (search: `grep -rln "api/factions\"\|/api/factions?" app components`). In each, add a boolean state `showArchived`, append `?includeArchived=1` to the fetch when true, and render a small toggle button that reads `Show archived (N)` using the `archivedCount` from the response. Match the existing list header styling (see the maps list header for the pattern). Only show the toggle when `archivedCount > 0`.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/api/characters/route.ts app/api/items/route.ts app/api/factions/route.ts app components
git commit -m "feat: hide archived entities from lists with a show-archived toggle"
```

---

## Task 15: Notion Sync settings panel

**Files:**
- Create: `components/settings/NotionSyncPanel.tsx`
- Modify: `app/settings/page.tsx`

- [ ] **Step 1: Build the panel**

`components/settings/NotionSyncPanel.tsx`:

```tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/components/ui/toast";

const SOURCES = [
  { type: "characters", label: "Characters" },
  { type: "items", label: "Items & Loot" },
  { type: "factions", label: "Factions & Organizations" },
] as const;

interface SourceState { databaseUrl?: string; lastSyncedAt?: number | null }

export function NotionSyncPanel({ campaignId }: { campaignId: string | null }) {
  const toast = useToast();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [meta, setMeta] = useState<Record<string, SourceState>>({});
  const [syncing, setSyncing] = useState(false);
  const [savingType, setSavingType] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!campaignId) return;
    const r = await fetch(`/api/notion/sources?campaignId=${campaignId}`);
    const data = await r.json();
    const m: Record<string, SourceState> = data.sources ?? {};
    setMeta(m);
    setUrls(Object.fromEntries(SOURCES.map((s) => [s.type, m[s.type]?.databaseUrl ?? ""])));
  }, [campaignId]);

  useEffect(() => { load(); }, [load]);

  async function saveSource(type: string) {
    if (!campaignId) return;
    setSavingType(type);
    try {
      const res = await fetch("/api/notion/sources", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, entityType: type, databaseUrl: urls[type] ?? "" }),
      });
      const data = await res.json();
      if (!res.ok) toast({ title: data.error ?? "Could not save", variant: "destructive" });
      else await load();
    } finally { setSavingType(null); }
  }

  async function syncNow() {
    if (!campaignId) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/notion/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error ?? "Sync failed", variant: "destructive" }); return; }
      const s = data.summary as Record<string, { created: number; updated: number; adopted: number; archived: number; error?: string }>;
      const parts = Object.entries(s).map(([t, v]) =>
        v.error ? `${t}: ${v.error}` : `${t}: +${v.created} ~${v.updated + v.adopted} archived ${v.archived}`);
      toast({ title: "Sync complete", description: parts.join(" · ") });
      await load();
    } finally { setSyncing(false); }
  }

  if (!campaignId) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl">Notion Sync</h2>
        <Button onClick={syncNow} disabled={syncing} className="gap-1.5">
          {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Sync now
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Paste each database&apos;s Notion URL. Share each database with your integration first.
      </p>
      {SOURCES.map((s) => (
        <div key={s.type} className="space-y-1.5">
          <label className="text-sm font-medium">{s.label}</label>
          <div className="flex gap-2">
            <Input
              value={urls[s.type] ?? ""}
              placeholder="https://www.notion.so/…"
              onChange={(e) => setUrls((u) => ({ ...u, [s.type]: e.target.value }))}
            />
            <Button variant="outline" onClick={() => saveSource(s.type)} disabled={savingType === s.type}>
              {savingType === s.type ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
            </Button>
          </div>
          {meta[s.type]?.lastSyncedAt && (
            <p className="text-xs text-muted-foreground">
              Last synced {new Date(Number(meta[s.type]!.lastSyncedAt) * 1000).toLocaleString()}
            </p>
          )}
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 2: Verify the toast API shape**

Read `components/ui/toast.tsx` and confirm the hook name (`useToast`) and call signature (`toast({ title, description, variant })`). Adjust the panel's calls to match the real API if they differ.

- [ ] **Step 3: Mount the panel in Settings**

In `app/settings/page.tsx`, import `NotionSyncPanel` and render `<NotionSyncPanel campaignId={activeCampaignId} />` in the settings layout, below the existing Notion token section. (`activeCampaignId` is already read from `useCampaignStore` in this file.)

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add components/settings/NotionSyncPanel.tsx app/settings/page.tsx
git commit -m "feat: Notion Sync settings panel (configure sources + sync now)"
```

---

## Task 16: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite + build + lint**

Run: `npm test && npm run build && npm run lint`
Expected: all tests PASS, build succeeds, lint clean.

- [ ] **Step 2: Browser smoke test**

Start the dev server (via the Browser preview tooling, not raw `npm run dev`) and, against a real campaign with a valid `notion_token` set in Settings:
1. Open Settings → Notion Sync. Paste the three database URLs (Characters, Items & Loot, Factions & Organizations) and Save each.
2. Click **Sync now**. Confirm the toast reports created counts and no errors.
3. Open a synced NPC's detail page → the **Notion properties** meta-table shows Race/Class/Level/Disposition, and its faction links appear.
4. Open a synced item → description + Type/Rarity meta-table present; a held-by character shows the item under linked items (if that relation surfaces on the character page).
5. In Notion, uncheck `Active` on one faction (or trust an already-inactive row), Sync now again → that faction leaves the list; toggle **Show archived (N)** → it reappears.
6. Click Sync now a second time with no Notion changes → toast shows `+0 ~0` everywhere (idempotent).
7. Check the browser console + server logs for errors.

- [ ] **Step 3: Commit any fixes found during smoke testing**

```bash
git add -A
git commit -m "fix: address issues found in notion sync smoke test"
```

(Skip if nothing needed fixing.)

---

## Self-review notes

- **Spec coverage:** connection config (Task 10, 15) · hybrid snapshot with live body untouched (no change to `/api/notion/page`) · per-DB mapping for all three types (Task 5) · additive + Active-gated reconcile incl. archive-on-removal (Tasks 6, 9) · Notion-wins on synced columns only, description hub-only for char/faction & synced for items (Task 7) · additive links (Task 7) · `notionProps` meta-table (Tasks 12–13) · manual Sync-now trigger + per-source status (Tasks 11, 15) · hide-archived + toggle (Task 14) · pagination + per-source error isolation + friendly not-shared message (Tasks 8, 9, 11) · vitest test strategy across mappers/reconcile/integration (Tasks 4–9).
- **Deferred per spec (no task, intentional):** Locations sync, Character↔Location / Item↔Found-In / Faction↔Headquarters / Faction↔Key-Members links, block-rendering fidelity, scheduled sync, write-back.
- **Guardrails:** Task 8 Step 4 verifies the v5 `dataSources`/`databases.retrieve` method names against the installed SDK before relying on them; route tasks read a sibling route first for Next 16 conventions.
