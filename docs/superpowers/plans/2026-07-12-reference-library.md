# Reference Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Campaign Assistant a local, citable reference library — ingest the SRD / owned rulebook PDFs / DM notes offline (parse → chunk → embed locally → store in `sqlite-vec`), and add a `search_reference` agent tool that returns cited passages for rules/lore questions.

**Architecture:** Everything local. `sqlite-vec` (a loadable SQLite extension) stores 384-dim embeddings in the existing `/data` DB alongside `reference_collections` + `reference_chunks`. Embeddings come from a local transformers.js model (`bge-small-en-v1.5`). A CLI script ingests sources; the existing Tool Runner gains one `search_reference` tool that embeds the query, runs KNN over enabled collections, and returns passages with citations. A Settings panel manages collections; the chat renders source chips.

**Tech Stack:** Next.js 16 (custom fork), TypeScript, Drizzle + better-sqlite3, `sqlite-vec`, `@huggingface/transformers` (transformers.js), `pdfjs-dist`, vitest. Builds on sub-project #12 (the assistant).

**Read before coding:** Spec `docs/superpowers/specs/2026-07-12-reference-library-design.md`. Custom Next.js fork — read `node_modules/next/dist/docs/` before route work. Assistant plan `docs/superpowers/plans/2026-07-12-campaign-assistant.md` for the tool/agent patterns.

**Shared conventions (from the assistant work):**
- DB type: `import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"`; `type AppDb = BetterSQLite3Database<typeof schema>`.
- Tests use `createTestDb()` from `lib/notion/test-helpers.ts` (returns `{ db, campaignId }` on a fresh migrated temp DB). **This plan modifies that harness to also load `sqlite-vec`.**
- Scripts under `scripts/` are CommonJS + direct `better-sqlite3` (match `scripts/world/*.js`). IDs via `crypto.randomUUID()`; timestamps `Math.floor(Date.now()/1000)` (Unix seconds) in scripts, `new Date()` for drizzle `timestamp` columns.
- Run tests: `npm test`. Build: `npm run build`.

**External-API verification note:** `sqlite-vec`, `@huggingface/transformers`, and `pdfjs-dist` are new deps. The code below reflects their stable APIs, but each external-lib task says to verify the exact call shape against the installed package before finalizing (the structure holds; only exact names may shift).

---

### Task 1: Install deps + load `sqlite-vec` into DB init, migrations, and the test harness

**Files:**
- Modify: `package.json` (deps)
- Modify: `lib/db/index.ts`
- Modify: `lib/db/migrate.ts:1-8` (the sqlite instance setup)
- Modify: `lib/notion/test-helpers.ts`
- Create: `lib/db/load-vec.ts`

- [ ] **Step 1: Install deps**

Run: `npm install sqlite-vec @huggingface/transformers pdfjs-dist`
Expected: all three appear under `dependencies`; exits 0.

- [ ] **Step 2: Create a single vec-loader helper**

Create `lib/db/load-vec.ts`:

```typescript
import type DatabaseType from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

/**
 * Load the sqlite-vec extension into a better-sqlite3 Database.
 * Returns true on success, false if unavailable (prod must degrade, not crash).
 */
export function loadVec(sqlite: DatabaseType.Database): boolean {
  try {
    sqliteVec.load(sqlite);
    return true;
  } catch {
    return false;
  }
}
```

Verify against the installed package: confirm `sqlite-vec` exposes `load(db)` (check `node_modules/sqlite-vec/*.d.ts`). If the export is named differently (e.g. a default export or `getLoadablePath()` + `db.loadExtension(path)`), adapt `loadVec` accordingly but keep the `(sqlite) => boolean` signature.

- [ ] **Step 3: Load vec in the runtime singleton**

In `lib/db/index.ts`, after the pragmas and before `drizzle(...)`, add the load. Import at top: `import { loadVec } from "./load-vec";`

```typescript
    sqlite.pragma("foreign_keys = ON");
    loadVec(sqlite); // reference-library vector search; degrades gracefully if unavailable
    _db = drizzle(sqlite, { schema });
```

- [ ] **Step 4: Load vec in migrate.ts and the test harness**

In `lib/db/migrate.ts`, after `sqlite.pragma("foreign_keys = ON");`, add:
```typescript
  loadVec(sqlite);
```
with `import { loadVec } from "./load-vec";` at the top.

In `lib/notion/test-helpers.ts`, in `createTestDb()`, after `sqlite.pragma("foreign_keys = ON");`, add `loadVec(sqlite);` (import it). This lets retrieval tests use the vec virtual table.

- [ ] **Step 5: Verify vec loads**

Create a throwaway check: `node -e "const D=require('better-sqlite3');const v=require('sqlite-vec');const db=new D(':memory:');v.load(db);console.log(db.prepare('select vec_version() as v').get())"`
Expected: prints a version object (e.g. `{ v: 'v0.1.x' }`). If this fails, resolve the sqlite-vec load approach before proceeding — everything else depends on it.

- [ ] **Step 6: Confirm build + existing tests still pass**

Run: `npm test` → 59 pass (nothing regressed). `npm run build` → clean.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/db/load-vec.ts lib/db/index.ts lib/db/migrate.ts lib/notion/test-helpers.ts
git commit -m "feat: add reference-library deps + load sqlite-vec into db init/migrate/tests"
```

---

### Task 2: Schema + migration for reference tables

**Files:**
- Modify: `lib/db/schema.ts` (append tables + types)
- Modify: `lib/db/migrate.ts` (append CREATE statements)

- [ ] **Step 1: Add Drizzle tables**

Append to `lib/db/schema.ts` (before the type exports block):

```typescript
export const referenceCollections = sqliteTable("reference_collections", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  sourceType: text("source_type", { enum: ["srd", "pdf", "text"] }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  chunkCount: integer("chunk_count").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const referenceChunks = sqliteTable("reference_chunks", {
  id: text("id").primaryKey(),
  collectionId: text("collection_id").notNull().references(() => referenceCollections.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  sourceRef: text("source_ref").notNull(),
  ordinal: integer("ordinal").notNull(),
  tokenCount: integer("token_count").notNull(),
});
```

Add to the type-exports block:
```typescript
export type ReferenceCollection = typeof referenceCollections.$inferSelect;
export type NewReferenceCollection = typeof referenceCollections.$inferInsert;
export type ReferenceChunk = typeof referenceChunks.$inferSelect;
export type NewReferenceChunk = typeof referenceChunks.$inferInsert;
```

- [ ] **Step 2: Add migration SQL**

In `lib/db/migrate.ts`, inside the existing `sqlite.exec(\`...\`)` block (append near the other CREATE TABLE statements), add the two ordinary tables:

```sql
    CREATE TABLE IF NOT EXISTS reference_collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reference_chunks (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL REFERENCES reference_collections(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      token_count INTEGER NOT NULL
    );
```

- [ ] **Step 3: Add the vec virtual table (separate exec, after loadVec)**

The `vec0` virtual table requires the extension loaded (done in Task 1). AFTER the main `sqlite.exec(...)` block in `migrate.ts`, add a guarded creation so a missing extension doesn't abort all migrations:

```typescript
  // Vector table for reference search — requires sqlite-vec (loaded above).
  try {
    sqlite.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_reference_chunks USING vec0(
      chunk_id TEXT PRIMARY KEY,
      embedding float[384]
    );`);
  } catch (err) {
    console.warn("[migrate] sqlite-vec unavailable — reference search disabled:", (err as Error).message);
  }
```

Verify the `vec0` column syntax against the installed sqlite-vec docs (`node_modules/sqlite-vec/README*`). Confirm it supports a `TEXT PRIMARY KEY` auxiliary column alongside the `float[384]` vector; if this version requires an integer `rowid` mapping instead of a `chunk_id TEXT` key, use `embedding float[384]` keyed by `rowid` and store the `chunk_id ↔ rowid` mapping in `reference_chunks` (add a `vec_rowid INTEGER` column) — note the adaptation. Keep 384 dims.

- [ ] **Step 4: Verify migration runs clean on a fresh DB**

Run: `DB_PATH=/tmp/ref-test.db node -e "require('ts-node/register'); require('./lib/db/migrate').runMigrations()"` — OR simpler, rely on the test harness: run `npm test` (createTestDb runs migrations). Expected: no errors; a quick check that the tables exist.

Add a tiny sanity test is optional; the real coverage comes in Task 4. At minimum confirm `npm test` still green and `npm run build` clean.

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts lib/db/migrate.ts
git commit -m "feat: reference_collections + reference_chunks + vec_reference_chunks schema"
```

---

### Task 3: Chunker (pure, TDD)

**Files:**
- Create: `lib/reference/chunk.ts`
- Test: `lib/reference/chunk.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/reference/chunk.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { chunkText, estimateTokens } from "./chunk";

describe("estimateTokens", () => {
  it("approximates ~4 chars/token", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("chunkText", () => {
  it("splits on headings and carries the heading as the citation label", () => {
    const md = `# Grappling\nWhen you want to grab a creature, you can use the Attack action.\n\n# Shoving\nUsing the Attack action, you can make a shove.`;
    const chunks = chunkText(md, { sourceLabel: "SRD", maxTokens: 500, overlapTokens: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].sourceRef).toBe("SRD: Grappling");
    expect(chunks[0].content).toContain("grab a creature");
    expect(chunks.find((c) => c.sourceRef === "SRD: Shoving")).toBeTruthy();
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });

  it("packs long sections into multiple chunks with overlap", () => {
    const body = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} about rules.`).join(" ");
    const md = `# Long Section\n${body}`;
    const chunks = chunkText(md, { sourceLabel: "SRD", maxTokens: 120, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    // overlap: end of chunk N reappears at start of chunk N+1
    const tail = chunks[0].content.split(" ").slice(-3).join(" ");
    expect(chunks[1].content).toContain(tail.split(" ")[2]);
    for (const c of chunks) expect(c.tokenCount).toBeLessThanOrEqual(120 + 20);
  });

  it("uses a page label when given pageOf()", () => {
    const chunks = chunkText("Some body text without headings.", {
      sourceLabel: "EGtW",
      maxTokens: 500,
      overlapTokens: 0,
      pageOf: () => 142,
    });
    expect(chunks[0].sourceRef).toBe("EGtW p.142");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- reference/chunk`
Expected: FAIL — `Cannot find module './chunk'`.

- [ ] **Step 3: Implement `lib/reference/chunk.ts`**

```typescript
export interface Chunk { content: string; sourceRef: string; ordinal: number; tokenCount: number }

export interface ChunkOptions {
  sourceLabel: string;               // e.g. "SRD", "EGtW"
  maxTokens?: number;                // default 600
  overlapTokens?: number;            // default 80
  pageOf?: (charIndex: number) => number | null; // for PDFs: char offset -> page number
}

/** ~4 chars per token heuristic (good enough for chunk sizing; real tokenization not needed). */
export function estimateTokens(s: string): number {
  return Math.round(s.length / 4);
}

interface Section { heading: string | null; text: string; startIndex: number }

function splitSections(text: string): Section[] {
  const lines = text.split(/\r?\n/);
  const sections: Section[] = [];
  let heading: string | null = null;
  let buf: string[] = [];
  let idx = 0;
  let sectionStart = 0;
  const flush = () => {
    const body = buf.join("\n").trim();
    if (body) sections.push({ heading, text: body, startIndex: sectionStart });
    buf = [];
  };
  for (const line of lines) {
    const m = /^#{1,6}\s+(.*)$/.exec(line.trim());
    if (m) { flush(); heading = m[1].trim(); sectionStart = idx; }
    else buf.push(line);
    idx += line.length + 1;
  }
  flush();
  if (sections.length === 0) sections.push({ heading: null, text: text.trim(), startIndex: 0 });
  return sections;
}

function packWords(text: string, maxTokens: number, overlapTokens: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const maxWords = Math.max(1, Math.round(maxTokens * 4 / 5)); // ~0.8 words/token inverse; ~4 chars/word
  const overlapWords = Math.max(0, Math.round(overlapTokens * 4 / 5));
  if (words.length <= maxWords) return [text.trim()];
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    const slice = words.slice(i, i + maxWords);
    out.push(slice.join(" "));
    if (i + maxWords >= words.length) break;
    i += maxWords - overlapWords;
  }
  return out;
}

export function chunkText(text: string, opts: ChunkOptions): Chunk[] {
  const maxTokens = opts.maxTokens ?? 600;
  const overlapTokens = opts.overlapTokens ?? 80;
  const out: Chunk[] = [];
  let ordinal = 0;
  for (const section of splitSections(text)) {
    const label = section.heading
      ? `${opts.sourceLabel}: ${section.heading}`
      : opts.pageOf
        ? (() => { const p = opts.pageOf!(section.startIndex); return p != null ? `${opts.sourceLabel} p.${p}` : opts.sourceLabel; })()
        : opts.sourceLabel;
    for (const piece of packWords(section.text, maxTokens, overlapTokens)) {
      out.push({ content: piece, sourceRef: label, ordinal: ordinal++, tokenCount: estimateTokens(piece) });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- reference/chunk`
Expected: PASS. If the overlap assertion is brittle, adjust the test to check word-count overlap rather than a specific token — but keep an assertion that overlap > 0 produces shared words between consecutive chunks.

- [ ] **Step 5: Commit**

```bash
git add lib/reference/chunk.ts lib/reference/chunk.test.ts
git commit -m "feat: structure-aware reference chunker with citation labels"
```

---

### Task 4: Retrieval module (TDD with a stub embedder + seeded sqlite-vec)

**Files:**
- Create: `lib/reference/retrieve.ts`
- Test: `lib/reference/retrieve.test.ts`

The embedder is an injected function so tests never load the real model.

- [ ] **Step 1: Write the failing test**

Create `lib/reference/retrieve.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/lib/notion/test-helpers";
import { referenceCollections, referenceChunks } from "@/lib/db/schema";
import { searchReference, type Embedder } from "./retrieve";

// Deterministic stub embedder. The vec table is float[384], so pad 3 signal axes
// (grapple/fireball/dragon) with zeros to 384 dims — nearest stays predictable.
const DIMS = 384;
const pad = (signal: number[]): number[] => [...signal, ...Array(DIMS - signal.length).fill(0)];
const stub: Embedder = async (texts) =>
  texts.map((t) => {
    const s = t.toLowerCase();
    return pad([s.includes("grapple") ? 1 : 0, s.includes("fireball") ? 1 : 0, s.includes("dragon") ? 1 : 0]);
  });

function seed(db: ReturnType<typeof createTestDb>["db"]) {
  const now = new Date();
  db.insert(referenceCollections).values([
    { id: "srd", name: "SRD 5.1", sourceType: "srd", enabled: true, chunkCount: 2, createdAt: now },
    { id: "off", name: "Disabled", sourceType: "text", enabled: false, chunkCount: 1, createdAt: now },
  ]).run();
  db.insert(referenceChunks).values([
    { id: "c1", collectionId: "srd", content: "Rules for grapple checks.", sourceRef: "SRD: Grappling", ordinal: 0, tokenCount: 5 },
    { id: "c2", collectionId: "srd", content: "Fireball deals 8d6 fire damage.", sourceRef: "SRD: Fireball", ordinal: 1, tokenCount: 6 },
    { id: "c3", collectionId: "off", content: "Grapple lore from a disabled book.", sourceRef: "Off: x", ordinal: 0, tokenCount: 6 },
  ]).run();
  return db;
}

describe("searchReference", () => {
  it("returns the nearest enabled chunk with its citation", async () => {
    const { db } = createTestDb();
    seed(db);
    // Insert the stub vectors into vec table for the enabled chunks (Task 4 helper does this in ingest;
    // here we call the exported upsertVectors helper directly to seed).
    const { upsertVectors } = await import("./retrieve");
    await upsertVectors(db, [
      { chunkId: "c1", embedding: (await stub(["grapple"]))[0] },
      { chunkId: "c2", embedding: (await stub(["fireball"]))[0] },
    ], DIMS);

    const hits = await searchReference(db, { query: "how do I grapple?", embed: stub, k: 1, dims: DIMS });
    expect(hits[0]).toMatchObject({ sourceRef: "SRD: Grappling", collection: "SRD 5.1" });
  });

  it("excludes disabled collections", async () => {
    const { db } = createTestDb();
    seed(db);
    const { upsertVectors } = await import("./retrieve");
    await upsertVectors(db, [{ chunkId: "c3", embedding: (await stub(["grapple"]))[0] }], DIMS);
    const hits = await searchReference(db, { query: "grapple", embed: stub, k: 5, dims: DIMS });
    expect(hits.find((h) => h.collection === "Disabled")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- reference/retrieve`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/reference/retrieve.ts`**

```typescript
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import type * as schema from "@/lib/db/schema";

type AppDb = BetterSQLite3Database<typeof schema>;
export type Embedder = (texts: string[]) => Promise<number[][]>;

export interface RefHit { content: string; sourceRef: string; collection: string; distance: number }

/** Insert/replace embeddings into the vec table. embedding length must equal `dims`. */
export async function upsertVectors(db: AppDb, rows: { chunkId: string; embedding: number[] }[], dims: number): Promise<void> {
  for (const r of rows) {
    if (r.embedding.length !== dims) throw new Error(`embedding dim ${r.embedding.length} != ${dims}`);
    const json = JSON.stringify(r.embedding);
    db.run(sql`INSERT INTO vec_reference_chunks(chunk_id, embedding) VALUES (${r.chunkId}, ${json})
               ON CONFLICT(chunk_id) DO UPDATE SET embedding = excluded.embedding`);
  }
}

export async function searchReference(
  db: AppDb,
  opts: { query: string; embed: Embedder; collection?: string; k?: number; dims?: number },
): Promise<RefHit[]> {
  const k = opts.k ?? 6;
  const [queryVec] = await opts.embed([opts.query]);
  const json = JSON.stringify(queryVec);
  // KNN over the vec table, joined to chunks + collections, enabled-only.
  const rows = db.all(sql`
    SELECT rc.content AS content, rc.source_ref AS sourceRef, col.name AS collection, v.distance AS distance
    FROM vec_reference_chunks v
    JOIN reference_chunks rc ON rc.id = v.chunk_id
    JOIN reference_collections col ON col.id = rc.collection_id
    WHERE v.embedding MATCH ${json} AND k = ${k}
      AND col.enabled = 1
      ${opts.collection ? sql`AND col.name = ${opts.collection}` : sql``}
    ORDER BY v.distance
  `) as RefHit[];
  return rows;
}
```

Verify the KNN query shape against installed sqlite-vec docs: some versions use `WHERE embedding MATCH ? AND k = ?`, others `ORDER BY distance LIMIT ?` with a `MATCH`. Adjust the `WHERE`/`LIMIT` clause to the installed syntax; keep the enabled-filter join and the returned shape identical. Confirm `db.all(sql\`...\`)` returns plain rows for this drizzle version (it does for better-sqlite3); if not, use the underlying `db.$client`/prepared statement.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- reference/retrieve`
Expected: PASS. If the vec `MATCH`+enabled-join in one query is rejected by this sqlite-vec version (some versions disallow extra WHERE predicates alongside `MATCH`), fall back to a two-step query: KNN to get candidate `chunk_id`s + distances, then a second SQL to join+filter enabled — implement whichever the installed version accepts, keeping the test assertions valid.

- [ ] **Step 5: Commit**

```bash
git add lib/reference/retrieve.ts lib/reference/retrieve.test.ts
git commit -m "feat: sqlite-vec reference retrieval (injected embedder, enabled-scoped KNN)"
```

---

### Task 5: Local embedder module

**Files:**
- Create: `lib/reference/embed.ts`

No unit test (loading the real model is heavy and covered by manual smoke; all logic that consumes embeddings is tested via the stub). Keep this module thin.

- [ ] **Step 1: Implement `lib/reference/embed.ts`**

```typescript
import { pipeline, env } from "@huggingface/transformers";
import path from "path";

export const EMBED_DIMS = 384;
const MODEL = "Xenova/bge-small-en-v1.5";

// Prefer a baked local model dir if present (prod); allow download in dev.
const localDir = process.env.REFERENCE_MODEL_DIR || path.join(process.cwd(), "reference-data", "models");
env.localModelPath = localDir;
env.allowRemoteModels = process.env.NODE_ENV !== "production";

let _extractor: Awaited<ReturnType<typeof pipeline>> | null = null;
async function getExtractor() {
  if (!_extractor) _extractor = await pipeline("feature-extraction", MODEL);
  return _extractor;
}

/** Embed texts → 384-dim mean-pooled, L2-normalized vectors. */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  // transformers.js returns a Tensor; .tolist() → number[][]
  const list = (output as unknown as { tolist: () => number[][] }).tolist();
  return list;
}
```

Verify against installed `@huggingface/transformers`: confirm `pipeline`, `env.localModelPath`/`env.allowRemoteModels`, and the `{ pooling: "mean", normalize: true }` option + `.tolist()` on the returned tensor. transformers.js v3 uses `@huggingface/transformers`; if the installed version is v2 (`@xenova/transformers`), adjust the import and the model id prefix accordingly. Confirm the output dim is 384 (log `embed(["test"]).then(v => v[0].length)` once in a scratch script).

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit` (0 errors) and `npm run build` (clean). Do NOT add a test that loads the model.

- [ ] **Step 3: Commit**

```bash
git add lib/reference/embed.ts
git commit -m "feat: local transformers.js embedder (bge-small, 384-dim)"
```

---

### Task 6: Ingestion scripts + SRD corpus scaffold

**Files:**
- Create: `scripts/reference/ingest.js`
- Create: `scripts/reference/import-srd.js`
- Create: `reference-data/srd/README.md` (sourcing + license note; no copyrighted text committed by this task)
- Create: `reference-data/.gitignore` (ignore `models/` weights + any dropped PDFs, keep `srd/*.md`)

- [ ] **Step 1: Write `scripts/reference/ingest.js`**

CommonJS, direct better-sqlite3, matches `scripts/world/*`. It must load sqlite-vec, parse the file, chunk (reuse the TS chunker's logic — but scripts can't import TS; reimplement a minimal chunk call by requiring a compiled helper OR duplicate the small chunk logic). **Approach:** to avoid TS-import pain, have `ingest.js` shell the chunking by requiring a tiny compiled JS. Simplest robust path: write the chunker consumption in the script by calling into the embed + retrieve modules via a small Node ESM entry. Given the repo's scripts are plain CJS and the libs are TS, implement ingestion as a **`tsx`-run script** instead: name it `scripts/reference/ingest.ts` and run with `npx tsx scripts/reference/ingest.ts <file> --collection "<name>"`, so it can `import` the TS `chunk.ts` / `embed.ts` / `upsertVectors` directly. Add `tsx` as a devDependency.

Create `scripts/reference/ingest.ts`:

```typescript
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import * as schema from "@/lib/db/schema";
import { referenceCollections, referenceChunks } from "@/lib/db/schema";
import { loadVec } from "@/lib/db/load-vec";
import { runMigrations } from "@/lib/db/migrate";
import { chunkText, type Chunk } from "@/lib/reference/chunk";
import { embed, EMBED_DIMS } from "@/lib/reference/embed";
import { upsertVectors } from "@/lib/reference/retrieve";
import { eq } from "drizzle-orm";

async function extract(file: string): Promise<{ text: string; pageOf?: (i: number) => number | null; sourceLabel: string }> {
  const ext = path.extname(file).toLowerCase();
  const label = path.basename(file, ext);
  if (ext === ".pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(fs.readFileSync(file));
    const doc = await pdfjs.getDocument({ data }).promise;
    let text = "";
    const pageBoundaries: { index: number; page: number }[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      pageBoundaries.push({ index: text.length, page: p });
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      text += content.items.map((it: { str?: string }) => it.str ?? "").join(" ") + "\n";
    }
    const pageOf = (i: number) => {
      let cur = 1;
      for (const b of pageBoundaries) if (b.index <= i) cur = b.page; else break;
      return cur;
    };
    return { text, pageOf, sourceLabel: label };
  }
  return { text: fs.readFileSync(file, "utf8"), sourceLabel: label };
}

async function main() {
  const [file, ...rest] = process.argv.slice(2);
  const collFlag = rest.indexOf("--collection");
  const name = collFlag >= 0 ? rest[collFlag + 1] : path.basename(file);
  const replace = rest.includes("--replace");
  const dryRun = rest.includes("--dry-run");
  const sourceType = path.extname(file).toLowerCase() === ".pdf" ? "pdf" : "text";
  if (!file) { console.error("usage: tsx scripts/reference/ingest.ts <file> --collection \"<name>\" [--replace] [--dry-run]"); process.exit(1); }

  runMigrations();
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "encounter-tracker.db");
  const sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");
  if (!loadVec(sqlite)) { console.error("sqlite-vec failed to load"); process.exit(1); }
  const db = drizzle(sqlite, { schema });

  const existing = db.select().from(referenceCollections).where(eq(referenceCollections.name, name)).get();
  if (existing && !replace) { console.error(`Collection "${name}" exists. Pass --replace to overwrite.`); process.exit(1); }

  const { text, pageOf, sourceLabel } = await extract(file);
  const chunks: Chunk[] = chunkText(text, { sourceLabel, pageOf });
  if (chunks.length === 0) { console.error("No text extracted — nothing to ingest."); process.exit(1); }
  console.log(`Parsed ${chunks.length} chunks from ${file}. Embedding…`);
  if (dryRun) { console.log(chunks.slice(0, 3)); return; }

  // Embed in batches to bound memory.
  const embeddings: number[][] = [];
  const BATCH = 32;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const vecs = await embed(chunks.slice(i, i + BATCH).map((c) => c.content));
    embeddings.push(...vecs);
    console.log(`  embedded ${Math.min(i + BATCH, chunks.length)}/${chunks.length}`);
  }

  const collId = existing?.id ?? crypto.randomUUID();
  const tx = sqlite.transaction(() => {
    if (existing) {
      // cascade deletes chunks; also clear their vectors
      const oldIds = db.select({ id: referenceChunks.id }).from(referenceChunks).where(eq(referenceChunks.collectionId, existing.id)).all();
      for (const { id } of oldIds) sqlite.prepare("DELETE FROM vec_reference_chunks WHERE chunk_id = ?").run(id);
      db.delete(referenceCollections).where(eq(referenceCollections.id, existing.id)).run();
    }
    db.insert(referenceCollections).values({ id: collId, name, sourceType, enabled: true, chunkCount: chunks.length, createdAt: new Date() }).run();
    const chunkRows = chunks.map((c) => ({ id: crypto.randomUUID(), collectionId: collId, content: c.content, sourceRef: c.sourceRef, ordinal: c.ordinal, tokenCount: c.tokenCount }));
    for (const row of chunkRows) db.insert(referenceChunks).values(row).run();
    return chunkRows;
  });
  const chunkRows = tx();
  await upsertVectors(db, chunkRows.map((r, i) => ({ chunkId: r.id, embedding: embeddings[i] })), EMBED_DIMS);
  console.log(`✓ Ingested "${name}" — ${chunks.length} chunks.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Note: `upsertVectors` runs outside the drizzle transaction because it uses `db.run(sql\`\`)`; that's acceptable (vectors written after chunks commit). If you prefer full atomicity, move the vec inserts inside the `sqlite.transaction` using raw `sqlite.prepare`. Verify `@/` path alias works under `tsx` (it should via tsconfig paths + tsx; if not, use relative imports).

- [ ] **Step 2: Write `scripts/reference/import-srd.ts`**

```typescript
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

// Ingests every .md file under reference-data/srd/ into one "SRD 5.1" collection
// by concatenating them, then delegating to ingest.ts. The DM places the openly-
// licensed SRD markdown there (see reference-data/srd/README.md).
const dir = path.join(process.cwd(), "reference-data", "srd");
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md")) : [];
if (files.length === 0) {
  console.error("No SRD markdown found in reference-data/srd/. See reference-data/srd/README.md.");
  process.exit(1);
}
const combined = files.map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n\n");
const tmp = path.join(dir, ".srd-combined.md");
fs.writeFileSync(tmp, combined);
try {
  execFileSync("npx", ["tsx", "scripts/reference/ingest.ts", tmp, "--collection", "SRD 5.1", "--replace"], { stdio: "inherit" });
} finally {
  fs.unlinkSync(tmp);
}
```

- [ ] **Step 3: Scaffold the SRD dir + gitignore**

Create `reference-data/srd/README.md`:
```markdown
# SRD corpus

Place the openly-licensed D&D System Reference Document markdown here (one or more
`.md` files). The SRD is released by Wizards of the Coast under the OGL 1.0a (5.1)
or CC-BY-4.0 (5.2) — obtain it from the official release. Committed `.md` files here
are ingested by `scripts/reference/import-srd.ts` into the "SRD 5.1" collection.

Do NOT place copyrighted, non-SRD book text here. Owned books are ingested directly
with `scripts/reference/ingest.ts <file>` and are never committed.

Include the SRD's required attribution/license text alongside the corpus.
```

Create `reference-data/.gitignore`:
```
models/
*.pdf
srd/.srd-combined.md
```

- [ ] **Step 4: Add `tsx` devDep + verify the script parses (dry-run on a tiny md)**

Run: `npm install -D tsx`
Create a scratch file `/tmp/tiny.md` with `# Test\nHello rules world.` and run:
`npx tsx scripts/reference/ingest.ts /tmp/tiny.md --collection "Scratch" --dry-run`
Expected: prints "Parsed N chunks" + a sample; no DB writes. (This exercises parse+chunk without loading the model.) A non-dry run will download the model on first use in dev — optional to run now.

- [ ] **Step 5: Commit**

```bash
git add scripts/reference/ reference-data/srd/README.md reference-data/.gitignore package.json package-lock.json
git commit -m "feat: reference ingestion scripts (ingest.ts + import-srd.ts) + srd scaffold"
```

---

### Task 7: `search_reference` agent tool + system prompt

**Files:**
- Modify: `lib/assistant/tools.ts`
- Modify: `lib/assistant/agent.ts` (system prompt line)
- Test: `lib/assistant/tools.test.ts` (extend the name list)

- [ ] **Step 1: Extend the tool-count test**

In `lib/assistant/tools.test.ts`, update the expected sorted names array to include `"search_reference"` (11 names now). Run `npm test -- tools` → FAILS (count mismatch) until Step 2.

- [ ] **Step 2: Add the tool in `lib/assistant/tools.ts`**

Add imports at top:
```typescript
import { searchReference } from "@/lib/reference/retrieve";
import { embed } from "@/lib/reference/embed";
```
Add this tool to the returned array (after `get_map_context`, before the propose_* tools):
```typescript
    betaZodTool({
      name: "search_reference",
      description: "Search indexed rulebooks and setting sourcebooks (SRD rules, loaded campaign-setting books, the DM's homebrew notes) for rules, mechanics, or published-setting lore. Call this for ANY rules/mechanics question or published-setting question, and cite the returned sources in your answer. Prefer this over answering rules from memory. Returns passages with a `sourceRef` citation each.",
      inputSchema: z.object({ query: z.string(), collection: z.string().optional() }),
      run: async ({ query, collection }) => j(await searchReference(db, { query, embed, collection })),
    }),
```
Note: `search_reference` is NOT campaign-scoped (the library is global) — it takes `db` but not `campaignId`.

- [ ] **Step 3: Add the system-prompt line in `lib/assistant/agent.ts`**

Append to the `SYSTEM` string:
```
For any D&D rules/mechanics question or published-setting lore question, call search_reference and cite the sourceRef of the passages you used. If search_reference returns nothing relevant, say you have no indexed source for it rather than inventing a citation or answering rules from memory.
```

- [ ] **Step 4: Run tests + build**

Run: `npm test -- tools` → the 11-name assertion passes. `npm test` full → green. `npm run build` → clean.

- [ ] **Step 5: Commit**

```bash
git add lib/assistant/tools.ts lib/assistant/agent.ts lib/assistant/tools.test.ts
git commit -m "feat: search_reference agent tool + cite-your-sources system prompt"
```

---

### Task 8: Reference collections API + Settings panel

**Files:**
- Create: `app/api/reference/collections/route.ts` (GET list)
- Create: `app/api/reference/collections/[id]/route.ts` (PATCH enabled, DELETE)
- Create: `components/settings/ReferenceLibraryPanel.tsx`
- Modify: the settings page (`app/settings/page.tsx`) to render the panel

- [ ] **Step 1: GET list route**

Create `app/api/reference/collections/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { referenceCollections } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const rows = await db.select().from(referenceCollections).orderBy(desc(referenceCollections.createdAt));
  return NextResponse.json({ items: rows });
}
```

- [ ] **Step 2: PATCH/DELETE route**

Create `app/api/reference/collections/[id]/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { referenceCollections, referenceChunks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { enabled?: boolean };
  if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled (boolean) required" }, { status: 400 });
  const [row] = await db.update(referenceCollections).set({ enabled: body.enabled }).where(eq(referenceCollections.id, id)).returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Clear vectors for this collection's chunks, then cascade-delete the collection.
  const chunkIds = await db.select({ id: referenceChunks.id }).from(referenceChunks).where(eq(referenceChunks.collectionId, id));
  const { getDbSqlite } = await import("@/lib/db/raw");
  const sqlite = getDbSqlite();
  const del = sqlite.prepare("DELETE FROM vec_reference_chunks WHERE chunk_id = ?");
  const tx = sqlite.transaction((ids: string[]) => { for (const cid of ids) del.run(cid); });
  tx(chunkIds.map((c) => c.id));
  await db.delete(referenceCollections).where(eq(referenceCollections.id, id));
  return NextResponse.json({ ok: true });
}
```

This needs a raw-sqlite accessor. Create `lib/db/raw.ts`:
```typescript
import Database from "better-sqlite3";
import path from "path";
import { loadVec } from "./load-vec";

let _sqlite: Database.Database | null = null;
/** Raw better-sqlite3 handle (vec loaded) for statements Drizzle can't express (vec table ops). */
export function getDbSqlite(): Database.Database {
  if (!_sqlite) {
    _sqlite = new Database(process.env.DB_PATH || path.join(process.cwd(), "encounter-tracker.db"));
    _sqlite.pragma("foreign_keys = ON");
    loadVec(_sqlite);
  }
  return _sqlite;
}
```

Note: opening a second better-sqlite3 handle to the same WAL DB is fine for these small ops. Verify the vec `DELETE` runs; if `vec0` tables don't support `DELETE ... WHERE chunk_id`, delete by the vec table's key column name confirmed in Task 2.

- [ ] **Step 3: Settings panel**

Create `components/settings/ReferenceLibraryPanel.tsx` (mirror `AssistantPanel`/`NotionSyncPanel` styling + guarded load effect):
```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface Collection { id: string; name: string; sourceType: string; enabled: boolean; chunkCount: number }

export function ReferenceLibraryPanel() {
  const [items, setItems] = useState<Collection[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reference/collections").then((r) => r.json())
      .then((d: { items: Collection[] }) => { if (!cancelled) setItems(d.items ?? []); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);

  async function toggle(c: Collection) {
    const res = await fetch(`/api/reference/collections/${c.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: !c.enabled }) });
    if (res.ok) setItems((list) => list.map((x) => x.id === c.id ? { ...x, enabled: !x.enabled } : x));
  }
  async function remove(c: Collection) {
    const res = await fetch(`/api/reference/collections/${c.id}`, { method: "DELETE" });
    if (res.ok) setItems((list) => list.filter((x) => x.id !== c.id));
  }

  return (
    <section className="rounded-xl border border-border bg-card p-6 space-y-4">
      <div>
        <h2 className="font-display text-xl">Reference Library</h2>
        <p className="text-sm text-muted-foreground">Indexed rulebooks and lore the assistant can cite. Add sources with <code>scripts/reference/ingest.ts</code>.</p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sources indexed yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((c) => (
            <li key={c.id} className="flex items-center gap-3 text-sm">
              <span className="flex-1">{c.name} <span className="text-muted-foreground">· {c.sourceType} · {c.chunkCount} chunks</span></span>
              <Button size="sm" variant={c.enabled ? "default" : "ghost"} onClick={() => toggle(c)}>{c.enabled ? "Enabled" : "Disabled"}</Button>
              <Button size="sm" variant="ghost" onClick={() => remove(c)}>Delete</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```
Adapt Button variants to the repo's actual API (confirmed `default`/`ghost`/`sm` exist from the assistant work).

- [ ] **Step 4: Mount on the settings page**

Add `import { ReferenceLibraryPanel } from "@/components/settings/ReferenceLibraryPanel";` and render `<ReferenceLibraryPanel />` next to `<AssistantPanel />`.

- [ ] **Step 5: Build + typecheck + lint**

Run: `npm run build` (clean), `npx tsc --noEmit` (0 errors), `npx eslint app/api/reference components/settings/ReferenceLibraryPanel.tsx lib/db/raw.ts` (no new errors — watch the guarded effect).

- [ ] **Step 6: Commit**

```bash
git add app/api/reference components/settings/ReferenceLibraryPanel.tsx app/settings/page.tsx lib/db/raw.ts
git commit -m "feat: reference collections API + Settings Reference Library panel"
```

---

### Task 9: Citation chips in ChatPanel

**Files:**
- Modify: `lib/assistant/agent.ts` (emit reference citations as a distinct event)
- Modify: `components/assistant/ChatPanel.tsx` (render chips)

The agent already runs tools; surface the `search_reference` results as citations so the panel can chip them. Simplest: in `withProposalCapture`-style decoration, also capture `search_reference` outputs.

- [ ] **Step 1: Capture reference citations in `agent.ts`**

Extend the `AssistantEvent` type: add `"citations"` to the `type` union and a `citations?: { sourceRef: string; collection: string }[]` field.

Add a capture sink alongside proposals. In the tool decoration (reuse the existing `withProposalCapture` mechanism or add a parallel one), when a tool named `search_reference` returns, parse its JSON (an array of `{content, sourceRef, collection, distance}`), dedupe by `sourceRef`, and push `{ sourceRef, collection }` into a `citations` array. After the run loop, emit `onEvent({ type: "citations", citations })` if non-empty (before `done`).

Concretely, generalize the decorator to take the tool and inspect by name:
```typescript
function withCapture(tools: AgentTool[], proposals: unknown[], citations: { sourceRef: string; collection: string }[]): AgentTool[] {
  return tools.map((tool) => {
    const originalRun = tool.run as (a: unknown, c?: unknown) => unknown;
    const run = async (a: unknown, c?: unknown) => {
      const result = await originalRun(a, c);
      if (typeof result === "string") {
        try {
          const parsed = JSON.parse(result);
          if (parsed && typeof parsed === "object" && "proposal" in parsed && parsed.proposal) proposals.push(parsed.proposal);
          else if (tool.name === "search_reference" && Array.isArray(parsed)) {
            for (const hit of parsed as { sourceRef?: string; collection?: string }[]) {
              if (hit.sourceRef && !citations.some((x) => x.sourceRef === hit.sourceRef)) {
                citations.push({ sourceRef: hit.sourceRef, collection: hit.collection ?? "" });
              }
            }
          }
        } catch { /* ignore */ }
      }
      return result;
    };
    return { ...tool, run } as AgentTool;
  });
}
```
Wire it: `const citations: {sourceRef:string;collection:string}[] = [];` create tools via `withCapture(buildTools(...), proposals, citations)`; after the loop emit `if (citations.length) onEvent({ type: "citations", citations });` before proposals/done.

- [ ] **Step 2: Render chips in `ChatPanel.tsx`**

Add `const [citations, setCitations] = useState<{ sourceRef: string; collection: string }[]>([]);`. Clear it at the start of `ask()` (alongside `setProposals([])`). In the SSE parse switch, handle `evt.type === "citations"` → `setCitations(evt.citations ?? [])`. Render below the messages (and above proposals) when non-empty:
```tsx
{citations.length > 0 && (
  <div className="flex flex-wrap gap-1">
    {citations.map((c, i) => (
      <span key={i} className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" title={c.collection}>{c.sourceRef}</span>
    ))}
  </div>
)}
```
Extend the local `evt` type in the parser to include `citations?: { sourceRef: string; collection: string }[]`.

- [ ] **Step 3: Build + typecheck + lint**

Run: `npm run build`, `npx tsc --noEmit`, `npx eslint lib/assistant/agent.ts components/assistant/ChatPanel.tsx` — all clean. `npm test` still green.

- [ ] **Step 4: Commit**

```bash
git add lib/assistant/agent.ts components/assistant/ChatPanel.tsx
git commit -m "feat: render reference citation chips in the assistant chat"
```

---

### Task 10: Docker model bake + deploy docs

**Files:**
- Create: `scripts/reference/fetch-model.ts` (populate reference-data/models/ for baking)
- Modify: `Dockerfile` (COPY the model + SRD corpus into the runtime image)
- Modify: `reference-data/.gitignore` (allow committing the specific baked model files)

- [ ] **Step 1: Model-fetch helper**

Create `scripts/reference/fetch-model.ts` that triggers a one-time embed to populate the local model cache under `reference-data/models/`, so the weights can be committed for baking:
```typescript
import { embed } from "@/lib/reference/embed";
(async () => { const v = await embed(["warm up the model to populate the local cache"]); console.log("model ready, dim:", v[0].length); })();
```
Run with `REFERENCE_MODEL_DIR=reference-data/models npx tsx scripts/reference/fetch-model.ts` on a dev machine (needs network once). This writes the ONNX weights under `reference-data/models/`.

- [ ] **Step 2: Dockerfile bake**

In the builder→runtime COPY section of `Dockerfile` (mirror the existing `world-data/build` bake), add:
```dockerfile
COPY --from=builder /app/reference-data/models ./reference-data/models
COPY --from=builder /app/reference-data/srd ./reference-data/srd
```
And ensure `REFERENCE_MODEL_DIR` defaults correctly (the app already resolves `reference-data/models` from cwd; no env needed if the path is baked at that location). Add a builder-stage guard like the world one so a missing model fails the build fast:
```dockerfile
RUN test -d reference-data/models || (echo "reference-data/models missing — run scripts/reference/fetch-model.ts and commit" && exit 1)
```

- [ ] **Step 3: gitignore the weights appropriately**

Decide: committing ~130MB weights to git (like the world artifacts) OR keeping them out and baking from a build step. Per the approved spec, **bake by committing**. Update `reference-data/.gitignore` to STOP ignoring the model dir once populated:
```
*.pdf
srd/.srd-combined.md
```
(remove the `models/` ignore line) and `git add reference-data/models` after running fetch-model. NOTE: this is the ~130MB repo bump the DM approved.

- [ ] **Step 4: Document the deploy runbook**

Append a short "Reference Library" section to the repo's deploy notes (or create `reference-data/DEPLOY.md`) covering: run `fetch-model.ts` + commit weights once; after each deploy, on the server run `import-srd.ts` and `ingest.ts <book>` per source; the Settings panel confirms what loaded; vectors live on the `/data` volume (survive redeploys, regenerate by re-ingesting).

- [ ] **Step 5: Verify the image builds (if buildable in this environment)**

If Docker is available: `docker build .` should pass the model-present guard once weights are committed. If not buildable here, at minimum `npm run build` clean and note the Docker step as DM-verified on deploy.

- [ ] **Step 6: Commit**

```bash
git add scripts/reference/fetch-model.ts Dockerfile reference-data/.gitignore reference-data/DEPLOY.md
# (weights committed separately by the DM after running fetch-model)
git commit -m "feat: bake embedding model + SRD into the runtime image; deploy runbook"
```

---

## Final verification

- [ ] `npm test` — all green (existing 59 + new chunk/retrieve/tools tests).
- [ ] `npm run build` + `npx tsc --noEmit` — clean.
- [ ] `npx eslint lib/reference lib/assistant components/settings/ReferenceLibraryPanel.tsx app/api/reference` — no new errors.
- [ ] **Manual smoke (DM, needs the model + a source):** place SRD markdown in `reference-data/srd/`, run `import-srd.ts`, set the Anthropic key, ⌘K → "how does grappling work?" → verify a cited SRD answer with a source chip. Then `ingest.ts` a small owned PDF → a setting question → correct page chip. Toggle the collection off in Settings → confirm it stops being cited.

---

## Notes for the implementer

- **External-lib drift:** verify `sqlite-vec` (load fn + vec0 syntax + KNN query shape), `@huggingface/transformers` (pipeline + pooling + `.tolist()` + v2-vs-v3 package name), and `pdfjs-dist` (legacy build import + `getTextContent`) against the INSTALLED versions before finalizing each task. The structure holds; adapt exact call shapes and note deviations.
- **Tests never load the real model** — the embedder is injected; retrieval/tool tests use a deterministic stub. Only manual smoke + `fetch-model.ts` touch the real model.
- **384 dims everywhere** — the vec table (`float[384]` from migrate), `EMBED_DIMS`, the stub, and the real model must all agree. The Task 4 test already pads its 3 signal axes to 384 dims to match the migrated table; keep any new retrieval tests 384-dim too. If you change the model to one with different dims, update the vec table DDL, `EMBED_DIMS`, and every stub together.
- **Vector atomicity:** chunk deletes must also clear `vec_reference_chunks` rows (ingest `--replace`, collection DELETE) — the vec table isn't FK-cascaded. Both paths handle this explicitly; don't forget it.
- **Custom Next.js fork** — read `node_modules/next/dist/docs/` before the reference API routes.
