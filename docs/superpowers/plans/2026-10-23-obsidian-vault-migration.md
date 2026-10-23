# Obsidian Vault Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hub's Notion ingestion with a read-only Obsidian vault mount, render the DM's markdown and callout taxonomy, and delete Notion from the codebase.

**Architecture:** `lib/notion/` becomes `lib/vault/`. The back half of the existing sync pipeline — reconcile, link relations, archive unseen, push to the search index — is already source-agnostic and ports with only its key column renamed. The front half (query a Notion data source, map rows) is replaced by a directory scan that parses frontmatter and routes on `type:`. Schema changes are additive only; the `notion_*` columns are left in place, unread. Note bodies are hashed and stripped to text for staleness and search, but rendered from the file at request time.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, drizzle-orm + better-sqlite3, `gray-matter`, `remark` + `remark-gfm`, `sharp`, Tailwind 4, vitest.

**Spec:** `docs/superpowers/specs/2026-10-23-obsidian-vault-migration-design.md`

---

## Conventions you must follow

Read these before Task 1. Every task assumes them.

**Migrations are hand-written SQL.** There are no drizzle migration files. `lib/db/migrate.ts` runs `CREATE TABLE IF NOT EXISTS` statements plus an `addColumnIfMissing` helper. Add new tables and columns there; `lib/db/schema.ts` is the drizzle mirror used for typed queries.

**Tests live in `lib/`.** `vitest.config.ts` only includes `lib/**/*.test.ts` and `components/**/*.test.ts`, environment `node`. There is no React test runner — `.tsx` files are never tested. Keep logic in `lib/` so it is testable, and keep components thin. Where a task's deliverable is a `.tsx` component or an API route, its verification step is `npx tsc --noEmit` plus `npm run lint`, not a test.

**Test databases come from `createTestDb()`**, which Task 1 moves to `lib/db/test-helpers.ts`. It writes a temp DB file, runs `runMigrations()`, and returns `{ db, campaignId }`.

**Test vaults come from `createTestVault()`** in `lib/vault/test-helpers.ts` (Task 3). It writes a temp directory of real `.md` files and returns its path. The scan is always tested against real files on disk, never a mocked filesystem.

**Unit tests use fake repos.** See `lib/notion/reconcile.test.ts` for the pattern: an in-memory object implementing the repo contract, so reconcile logic is tested without a database.

**Tests are `describe` / `it` / `expect` from `vitest`.**

**Run tests with:**

```bash
npm test
```

**Run one file with:**

```bash
npx vitest run lib/vault/scan.test.ts
```

---

## Global Constraints

Every task's requirements implicitly include these. Values are copied verbatim from the spec.

- **The mount is read-only.** The hub never writes a note and never writes an id into one.
- **Schema changes are additive only.** Use `addColumnIfMissing`. Never rename or drop a column. The `notion_*` columns stay in place, unread, like the dead `maps` column already does.
- **`vault_sources.root_path` is vault-relative** (e.g. `D&D/Explorers of Exandria`), never absolute, so one database file works on the Mac and in the container.
- **`VAULT_PATH` points at the Obsidian vault root**, not the campaign folder. Defaults to `/vault`.
- **The scan excludes `_Templates/` and every dot-directory.**
- **`[!dm]` callout content never enters `source_text`** and therefore never enters the search index.
- **Relation linking is additive.** Links are added, never removed.
- **`locations.type` stays world-authoritative.** Never written from the vault.
- **`description` is written only when non-empty**, so a blank frontmatter field cannot overwrite world-composed text.
- **`archived` comes from `active: false` on characters and factions only.** Locations, items and session notes archive by disappearing from the vault.
- **Recognised-but-skipped types (`thread`, `player-note`, `reference`, `campaign`) emit no warning.** Only an unknown or absent `type:` warns.

## Review Focus

Five conditions the spec implies that no task's happy path exercises, most likely to bite first. Each has a test assigned to the task owning the code.

1. **Non-ASCII basenames.** 15 notes carry em dashes, curly apostrophes or `&` (`Cobalt Soul Reunion — Beilar & Elbera.md`). `source_path` must round-trip through `/api/vault/page?path=` and `obsidian://open?...&file=` without corruption or truncation at the `&`. → Task 13.
2. **A note's `type:` changing across hub tables.** Editing `type: npc` to `type: location` must archive the row in `characters` rather than leave a stale duplicate alongside the new `locations` row. → Task 8.
3. **Symlink escape in the attachment guard.** The containment check must compare resolved real paths, not string prefixes, or a symlink inside the vault serves files from outside the mount. → Task 12.
4. **Duplicate basenames across folders.** None exist today, so the tie-break is unexercised in practice, but both wikilink resolution and tier-3 `source_key` must be deterministic and must not flap between ticks. → Tasks 4 and 7.
5. **A note with frontmatter and an empty body.** `source_hash` and `source_text` must be stable and empty rather than throwing, and the briefing must mark itself `partial`. → Task 5.

---

### Task 1: Move the shared test helper out of `lib/notion`

`createTestDb()` lives in `lib/notion/test-helpers.ts` and is imported by 18 test files across `lib/run`, `lib/state`, `lib/assistant` and `lib/reference`. Task 17 deletes `lib/notion/`, so this must move first or the whole suite breaks.

**Files:**
- Create: `lib/db/test-helpers.ts`
- Delete: `lib/notion/test-helpers.ts`, `lib/notion/test-helpers.test.ts`
- Modify: the 18 test files importing `@/lib/notion/test-helpers`
- Test: `lib/db/test-helpers.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `createTestDb(): { db: TestDb; campaignId: string }` and `type TestDb` from `@/lib/db/test-helpers` — every later task's database tests import this

- [ ] **Step 1: Move the file unchanged, then update its temp-file prefix**

```bash
git mv lib/notion/test-helpers.ts lib/db/test-helpers.ts
git mv lib/notion/test-helpers.test.ts lib/db/test-helpers.test.ts
```

Change the temp filename prefix inside it from `notion-sync-` to `hub-test-`. Nothing else changes.

- [ ] **Step 2: Rewrite the 18 imports**

```bash
grep -rl "@/lib/notion/test-helpers" --include="*.ts" lib \
  | xargs sed -i '' 's|@/lib/notion/test-helpers|@/lib/db/test-helpers|g'
```

- [ ] **Step 3: Verify no stale imports remain**

Run: `grep -rn "notion/test-helpers" --include="*.ts" lib`
Expected: no output.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, with the same test count as before the move.

- [ ] **Step 5: Commit**

```bash
git add -A lib
git commit -m "refactor: move createTestDb out of lib/notion"
```

---

### Task 2: Schema, migration and the `source_key` backfill

**Files:**
- Modify: `lib/db/migrate.ts` (the `addColumnIfMissing` block, ~line 303)
- Modify: `lib/db/schema.ts`
- Test: `lib/vault/schema.test.ts`

**Interfaces:**
- Consumes: `createTestDb` (Task 1)
- Produces: `vaultSources` drizzle table and the six `source*` columns on `characters`, `locations`, `items`, `factions`, `sessionNotes`; `locations.parentLocationId`. Column names in SQL are snake_case (`source_key`, `source_path`, `source_props`, `source_synced_at`, `source_hash`, `source_text`, `parent_location_id`); drizzle properties are camelCase.

- [ ] **Step 1: Write the failing tests**

```ts
describe("vault schema", () => {
  it("adds the six source columns to every mirrored table", () => {
    const { db } = createTestDb();
    for (const table of ["characters", "locations", "items", "factions", "session_notes"]) {
      const cols = columnNames(db, table);
      expect(cols).toEqual(expect.arrayContaining([
        "source_key", "source_path", "source_props",
        "source_synced_at", "source_hash", "source_text",
      ]));
    }
  });

  it("adds parent_location_id to locations only", () => {
    const { db } = createTestDb();
    expect(columnNames(db, "locations")).toContain("parent_location_id");
    expect(columnNames(db, "characters")).not.toContain("parent_location_id");
  });

  it("keeps the notion columns in place", () => {
    const { db } = createTestDb();
    expect(columnNames(db, "characters")).toContain("notion_page_id");
  });

  it("creates vault_sources keyed by campaign alone", () => {
    const { db } = createTestDb();
    expect(columnNames(db, "vault_sources")).toEqual(expect.arrayContaining([
      "campaign_id", "root_path", "last_synced_at", "last_status",
    ]));
  });

  it("backfills source_key from notion_page_id", () => {
    // Insert a character with only notion_page_id set, re-run runMigrations(),
    // and assert source_key now equals that page id.
  });

  it("leaves an existing source_key alone when backfilling", () => {
    // A row with both set keeps its source_key.
  });
});
```

`columnNames` is a local helper over `PRAGMA table_info`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/vault/schema.test.ts`
Expected: FAIL — `source_key` missing.

- [ ] **Step 3: Add the columns, the table and the backfill in `lib/db/migrate.ts`**

Extend the existing `for (const table of [...])` loop with the six `source*` columns, add `parent_location_id` to `locations`, add a `CREATE TABLE IF NOT EXISTS vault_sources` with `campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE`, and run the backfill once per mirrored table:

```sql
UPDATE <table> SET source_key = notion_page_id
WHERE source_key IS NULL AND notion_page_id IS NOT NULL
```

The backfill is idempotent by its own `WHERE` clause, so it is safe on every boot. Mirror all of it in `lib/db/schema.ts`, and comment `parent_location_id` as carrying no `.references()` because ids may dangle — the `thread_links` precedent at `lib/db/schema.ts:269`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/vault/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db/migrate.ts lib/db/schema.ts lib/vault/schema.test.ts
git commit -m "feat(vault): add source columns, vault_sources, and the source_key backfill"
```

---

### Task 3: Vault config, frontmatter and the directory scan

**Files:**
- Create: `lib/vault/config.ts`, `lib/vault/frontmatter.ts`, `lib/vault/scan.ts`, `lib/vault/test-helpers.ts`
- Modify: `package.json` (add `gray-matter`)
- Test: `lib/vault/scan.test.ts`, `lib/vault/frontmatter.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `resolveCampaignFolder(rootPath: string): string` — joins `VAULT_PATH` (default `/vault`) with a vault-relative `rootPath`; throws `VaultUnreadableError` if the result is not a readable directory
  - `class VaultUnreadableError extends Error`
  - `parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string }` — throws `FrontmatterError` on malformed YAML
  - `class FrontmatterError extends Error`
  - `interface VaultNote { path: string; basename: string; data: Record<string, unknown>; body: string }` where `path` is **vault-relative**
  - `scanVault(folder: string): { notes: VaultNote[]; warnings: string[] }`
  - `createTestVault(files: Record<string, string>): string` — writes a temp vault, keys are vault-relative paths, returns the vault root

- [ ] **Step 1: Write the failing tests**

```ts
describe("parseFrontmatter", () => {
  it("splits the --- block from the body", () => { /* data.type === "npc", body starts with "# Manner" */ });
  it("returns an empty body when the note is frontmatter only", () => { /* body === "" */ });
  it("returns empty data when there is no --- block", () => { /* data === {} */ });
  it("throws FrontmatterError on malformed YAML", () => { /* expect(() => ...).toThrow(FrontmatterError) */ });
});

describe("scanVault", () => {
  it("returns one note per markdown file with a vault-relative path", () => {
    // path === "camp/Locations/Blackvein Quarry.md", basename === "Blackvein Quarry"
  });
  it("excludes _Templates", () => { /* no note from camp/_Templates/Character.md */ });
  it("excludes dot-directories", () => { /* no note from camp/.backup-2026/Old.md */ });
  it("ignores non-markdown files", () => { /* _Attachments/art.png absent */ });
  it("skips a note with malformed YAML and warns naming its path", () => {
    expect(result.notes).toHaveLength(1);
    expect(result.warnings[0]).toContain("Broken.md");
  });
  it("preserves non-ASCII basenames exactly", () => {
    // "Cobalt Soul Reunion — Beilar & Elbera" survives unchanged
  });
});

describe("resolveCampaignFolder", () => {
  it("joins VAULT_PATH with the relative root path", () => {});
  it("throws VaultUnreadableError for a missing directory", () => {});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/vault/scan.test.ts lib/vault/frontmatter.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Install `gray-matter` and implement the three modules plus `createTestVault`**

```bash
npm install gray-matter
```

`scanVault` walks recursively with `fs.readdirSync(..., { withFileTypes: true })`, skipping any directory whose name is `_Templates` or starts with `.`, and reading only `.md`. A `FrontmatterError` on one file becomes a warning and the walk continues — per-note isolation, per the spec.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/vault/scan.test.ts lib/vault/frontmatter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json lib/vault
git commit -m "feat(vault): scan a campaign folder into parsed notes"
```

---

### Task 4: Wikilink parsing and resolution

**Files:**
- Create: `lib/vault/links.ts`
- Test: `lib/vault/links.test.ts`

**Interfaces:**
- Consumes: `VaultNote` (Task 3)
- Produces:
  - `parseWikilink(raw: string): { target: string; label: string | null; heading: string | null } | null` — accepts `[[Name]]`, `[[Name|label]]`, `[[Name#heading]]`, and a bare `Name`; returns `null` for empty input
  - `parseWikilinkList(value: unknown): string[]` — frontmatter values are a string, an array of strings, or absent; returns the link targets
  - `buildLinkIndex(notes: VaultNote[]): LinkIndex` — maps lowercased basename and every `aliases:` entry to its note; on a collision the sorted-first `path` wins
  - `interface LinkIndex { resolve(target: string): VaultNote | undefined }`

- [ ] **Step 1: Write the failing test**

```ts
describe("parseWikilink", () => {
  it("reads a plain link", () => { expect(parseWikilink("[[Rexxentrum]]").target).toBe("Rexxentrum"); });
  it("reads a labelled link", () => { /* target "Rexxentrum", label "the capital" */ });
  it("reads a heading link", () => { /* target "Related", heading "NPCs here" */ });
  it("accepts a bare name", () => { /* frontmatter sometimes omits the brackets */ });
  it("keeps non-ASCII targets intact", () => {
    expect(parseWikilink("[[Caught in the Web — Children of Malice]]").target)
      .toBe("Caught in the Web — Children of Malice");
  });
});

describe("parseWikilinkList", () => {
  it("handles a single string, an array, and undefined", () => {});
});

describe("buildLinkIndex", () => {
  it("resolves by basename, case-insensitively", () => {});
  it("resolves by alias", () => { /* aliases: [Bartlebee] finds Bartlebee Aldermane */ });
  it("returns undefined for an unknown target", () => {});
  it("breaks a duplicate-basename tie by sorted path, deterministically", () => {
    // Two notes named "The Bone Pit" in different folders; build the index twice
    // from both input orders and assert resolve() returns the same note.
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/vault/links.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/vault/links.ts`**

The tie-break must sort candidates by `path` before picking, not rely on scan order, so the winner cannot change between ticks.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/vault/links.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/vault/links.ts lib/vault/links.test.ts
git commit -m "feat(vault): parse and resolve wikilinks with alias support"
```

---

### Task 5: Body hash, plain text, and `[!dm]` stripping

**Files:**
- Create: `lib/vault/body.ts`
- Test: `lib/vault/body.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `digestBody(markdown: string): { hash: string; text: string }` — `hash` is a sha256 hex digest of the raw markdown; `text` is the markdown stripped to plain text with **all `[!dm]` callout content removed**

- [ ] **Step 1: Write the failing test**

```ts
describe("digestBody", () => {
  it("returns a stable hash for identical input", () => {});
  it("returns different hashes for different input", () => {});
  it("returns an empty hash-stable result for an empty body", () => {
    const r = digestBody("");
    expect(r.text).toBe("");
    expect(r.hash).toBe(digestBody("").hash);
  });
  it("strips a [!dm] callout entirely", () => {
    const text = digestBody("> [!dm] Tactics\n> She targets Bartlebee.\n\nThe room is cold.").text;
    expect(text).not.toContain("Bartlebee");
    expect(text).toContain("The room is cold");
  });
  it("strips a collapsed [!dm]- callout", () => {});
  it("keeps every other callout's content", () => {
    const text = digestBody("> [!read-aloud]\n> Morning in the common room.").text;
    expect(text).toContain("Morning in the common room");
  });
  it("drops markdown syntax from the text", () => {
    // "# Manner" -> "Manner"; "**bold**" -> "bold"; wikilinks -> their label or target
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/vault/body.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `digestBody` in `lib/vault/body.ts`**

Hash the raw markdown before stripping, so the hash reflects the file and the text reflects what is safe to index. A `[!dm]` callout is a blockquote whose first line matches `/^>\s*\[!dm\]-?/i`; drop that block and every subsequent `>`-prefixed line.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/vault/body.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/vault/body.ts lib/vault/body.test.ts
git commit -m "feat(vault): hash note bodies and strip DM-only content from indexed text"
```

---

### Task 6: Identity resolution and the per-type mappers

**Files:**
- Create: `lib/vault/map.ts`
- Test: `lib/vault/map.test.ts`

**Interfaces:**
- Consumes: `VaultNote` (Task 3), `parseWikilinkList` (Task 4), `digestBody` (Task 5). Note it does **not** consume `LinkIndex`: `mapNote` returns unresolved link *targets*, and Task 7's repos resolve them to hub ids.
- Produces:
  - `resolveSourceKey(note: VaultNote): { key: string; tier: 1 | 2 | 3 }` — `hub_id` → `notion_id` → basename
  - `candidateKeys(note: VaultNote): string[]` — every key the note could have had, highest tier first; Task 7 uses this for promotion
  - `type VaultEntityTable = "characters" | "locations" | "items" | "factions" | "sessionNotes"`
  - `tableForType(type: string | undefined): VaultEntityTable | "skip" | "unknown"`
  - `interface MappedEntity { sourceKey: string; sourcePath: string; name: string; archived: boolean; sourceProps: PropEntry[]; sourceHash: string; sourceText: string; extra: Record<string, unknown>; factionTargets?: string[]; locationTargets?: string[]; heldByTargets?: string[]; parentTarget?: string; settingNames?: string[] }`
  - `mapNote(note: VaultNote, table: VaultEntityTable): MappedEntity`

- [ ] **Step 1: Write the failing test**

```ts
describe("resolveSourceKey", () => {
  it("prefers hub_id", () => { /* tier 1 */ });
  it("falls back to notion_id", () => { /* tier 2 */ });
  it("falls back to the basename", () => { /* tier 3 */ });
});

describe("tableForType", () => {
  it.each([
    ["npc", "characters"], ["pc", "characters"], ["location", "locations"],
    ["item", "items"], ["faction", "factions"], ["session", "sessionNotes"],
    ["arc", "sessionNotes"], ["encounter", "sessionNotes"], ["scene", "sessionNotes"],
  ])("routes %s to %s", (type, table) => { expect(tableForType(type)).toBe(table); });

  it.each(["thread", "player-note", "reference", "campaign"])("skips %s", (type) => {
    expect(tableForType(type)).toBe("skip");
  });

  it("reports an unrecognised type as unknown", () => { expect(tableForType("widget")).toBe("unknown"); });
  it("reports a missing type as unknown", () => { expect(tableForType(undefined)).toBe("unknown"); });
});

describe("mapNote", () => {
  it("takes the entity name from the basename", () => {});

  // characters
  it("sets type pc or npc from the vault type", () => {});
  it("extracts the D&D Beyond id from sheet", () => {});
  it("shows the sheet url as a property only when no ddb id was extracted", () => {});
  it("archives a character with active: false", () => {});
  it("does not archive a character with no active field", () => {});
  it("collects faction and location wikilink targets", () => {});

  // locations
  it("maps location_type to the Type property", () => {});
  it("never writes the hub type column", () => { expect(mapped.extra).not.toHaveProperty("type"); });
  it("omits description from extra when the frontmatter field is blank", () => {});
  it("collects the parent wikilink target", () => {});

  // factions
  it("maps faction_type and stance, and archives on active: false", () => {});

  // session notes
  it.each([
    ["session", undefined, "Session Notes"],
    ["arc", undefined, "Story Outline"],
    ["encounter", "combat", "Combat Encounter"],
    ["encounter", "social", "RP Encounter"],
    ["encounter", "exploration", "Exploration Encounter"],
    ["scene", "social", "Character Event"],
    ["scene", undefined, "Character Event"],
  ])("maps type %s / encounter_type %s to note_type %s", (type, cat, expected) => {});
  it("stores the arc wikilink's display name, not its brackets", () => {
    expect(mapped.extra.arc).toBe("Caught in the Web — Children of Malice");
  });
  it("shows encounter_type as the Category property", () => {});
  it("collects location wikilink targets and falls back to settings strings", () => {});

  // suppression
  it("never shows type, tags, cssclasses, hub_id, notion_id or aliases as properties", () => {});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/vault/map.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/vault/map.ts`**

Reuse `extractDdbId` from `lib/notion/props.ts` by copying it into this module — it is the only Notion-era prop reader that survives, and Task 17 deletes the file it came from. One `mapNote` with a per-table switch, following the shape of `lib/notion/map.ts`. `scene` maps to `Character Event` regardless of `encounter_type`, because the spotlight axis is what the old Notion label captured.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/vault/map.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/vault/map.ts lib/vault/map.test.ts
git commit -m "feat(vault): resolve note identity and map frontmatter to entities"
```

---

### Task 7: Reconcile with key promotion, and the repos

**Files:**
- Create: `lib/vault/reconcile.ts`, `lib/vault/repos.ts`
- Test: `lib/vault/reconcile.test.ts`, `lib/vault/repos.test.ts`

**Interfaces:**
- Consumes: `MappedEntity` + `candidateKeys` (Task 6), `createTestDb` (Task 1)
- Produces:
  - `interface EntityRow { id: string; name: string; sourceKey: string | null; archived: boolean }`
  - `interface EntityRepo { findByKey(key: string): EntityRow | undefined; findByNameUnlinked(name: string): EntityRow | undefined; insert(m: MappedEntity): string; update(id: string, m: MappedEntity): boolean }`
  - `reconcileEntity(repo: EntityRepo, m: MappedEntity, candidates: string[]): { action: "created" | "adopted" | "updated" | "unchanged"; id: string }`
  - `makeEntityRepo(db, table, campaignId): EntityRepo`
  - `linkCharacterFactions`, `linkCharacterLocations`, `linkCharacterItems`, `linkSessionNoteLocations`, `setLocationParent` — all additive, all resolving targets to hub ids via a key lookup

- [ ] **Step 1: Write the failing test**

```ts
describe("reconcileEntity", () => {
  it("creates a row for an unseen key", () => {});
  it("updates a row whose key matches and whose fields changed", () => {});
  it("reports unchanged when nothing differs", () => {});
  it("adopts an unlinked row with the same name", () => {});

  it("promotes a key: adopts the row keyed on the old basename and rewrites it", () => {
    // Row exists with sourceKey "Blackvein Quarry". The note now has hub_id "abc".
    // candidates = ["abc", "Blackvein Quarry"]. Expect adopted, and the row's
    // sourceKey afterwards is "abc".
  });

  it("prefers an exact key match over a lower-tier candidate", () => {});

  it("is deterministic when two notes resolve to the same key", () => {
    // Reconcile both orderings; the surviving row is the same either way.
  });
});

describe("repos", () => {
  it("writes every source column on insert", () => {});
  it("leaves updatedAt alone when nothing changed", () => {});
  it("adds a character-faction link without removing existing links", () => {});
  it("resolves a session note's locations by source key", () => {});
  it("returns setting names that matched no location", () => {});
  it("sets parent_location_id from a resolved parent target", () => {});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/vault/reconcile.test.ts lib/vault/repos.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement both modules**

Port `lib/notion/reconcile.ts` and `lib/notion/repos.ts`, renaming `notionPageId` → `sourceKey` throughout, and add the promotion branch: after `findByKey(m.sourceKey)` misses, try each remaining entry of `candidates` against `findByKey`; a hit adopts that row and `update` rewrites its `sourceKey` to `m.sourceKey`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/vault/reconcile.test.ts lib/vault/repos.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/vault/reconcile.ts lib/vault/repos.ts lib/vault/*.test.ts
git commit -m "feat(vault): reconcile notes to entities with key promotion"
```

---

### Task 8: Sync orchestration and the abort guards

**Files:**
- Create: `lib/vault/sync.ts`
- Test: `lib/vault/sync.test.ts`

**Interfaces:**
- Consumes: Tasks 3-7
- Produces:
  - `interface SourceSummary { created: number; adopted: number; updated: number; unchanged: number; archived: number; skipped: number; warnings: string[]; error?: string }`
  - `type SyncSummary = Record<VaultEntityTable, SourceSummary>`
  - `syncCampaign(opts: { db; campaignId: string; folder: string }): Promise<SyncSummary>`

- [ ] **Step 1: Write the failing test**

```ts
describe("syncCampaign", () => {
  it("creates rows for all nine mirrored types", () => {});

  it("links relations after their targets exist", () => {
    // factions -> characters -> locations -> items -> sessionNotes ordering
  });

  it("skips recognised non-mirrored types without warning", () => {
    // A thread and a player-note in the vault; warnings stay empty.
  });

  it("warns once for a note with an unknown type", () => {});

  it("archives a row whose note disappeared", () => {});

  it("archives a row whose note changed to a type in another table", () => {
    // Sync an npc, then re-sync with the same note's type changed to "location".
    // The characters row is archived; a locations row exists; no stale duplicate.
  });

  it("does not archive anything when the folder has no markdown at all", () => {
    expect(summary.characters.archived).toBe(0);
    expect(summary.characters.warnings.join(" ")).toMatch(/no/i);
  });

  it("throws VaultUnreadableError before touching any row when the folder is missing", () => {
    // Pre-seed a row, expect the call to reject, and assert the row is untouched.
  });

  it("writes source_hash and source_text from the body", () => {});

  it("keeps syncing after one note fails to parse", () => {});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/vault/sync.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `syncCampaign` in `lib/vault/sync.ts`**

Port the loop from `lib/notion/sync.ts`. Differences: one scan feeds all five tables instead of one query per table, so notes are grouped by `tableForType` first and then processed in the dependency order `factions, characters, locations, items, sessionNotes`. The archive step is per table and compares against the keys seen **for that table**, which is what makes the cross-table type change archive correctly. Keep the existing mass-wipe guard and add the unreadable-folder abort ahead of it. `sessionNotes` is still excluded from the search index; the other four still call `syncEntityToIndex` inside a try/catch that warns rather than failing the sync.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/vault/sync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/vault/sync.ts lib/vault/sync.test.ts
git commit -m "feat(vault): orchestrate a campaign sync with mass-wipe and mount guards"
```

---

### Task 9: Run-sync, scheduler, lock, and the sync API routes

**Files:**
- Create: `lib/vault/run-sync.ts`, `lib/vault/scheduler.ts`, `lib/vault/sync-lock.ts`
- Create: `app/api/vault/source/route.ts`, `app/api/vault/sync/route.ts`
- Modify: `instrumentation.ts`
- Test: `lib/vault/run-sync.test.ts`, `lib/vault/scheduler.test.ts`, `lib/vault/sync-lock.test.ts`

**Interfaces:**
- Consumes: `syncCampaign` (Task 8), `resolveCampaignFolder` + `VaultUnreadableError` (Task 3)
- Produces:
  - `class NoVaultSourceError extends Error` — message `"No vault folder configured for this campaign"`
  - `runCampaignSync(campaignId: string, opts?: { db? }): Promise<SyncSummary>` — loads the `vault_sources` row, resolves the folder, syncs, writes back `last_synced_at` / `last_status`
  - `listCampaignsWithSources(db?): Promise<string[]>`
  - `readAutoSyncConfig(db?): Promise<{ enabled: boolean; intervalMinutes: number }>`
  - `runAutoSyncTick(deps?): Promise<{ synced: string[]; skipped: string[]; failed: string[] }>`
  - `runTickAndComputeDelay(deps?): Promise<number>`
  - `startVaultSync(): void`
  - `tryAcquireSync`, `releaseSync`, `isSyncing` — `lib/notion/sync-lock.ts` moved verbatim
  - Settings keys `vault_auto_sync_enabled`, `vault_auto_sync_interval_minutes`, `VAULT_AUTO_SYNC_ENABLED_KEY`, `VAULT_AUTO_SYNC_INTERVAL_KEY`, `DEFAULT_INTERVAL_MINUTES = 15`, `FIRST_TICK_DELAY_MS = 30_000`

- [ ] **Step 1: Write the failing tests**

```ts
describe("runCampaignSync", () => {
  it("throws NoVaultSourceError when the campaign has no vault_sources row", () => {});
  it("writes last_synced_at and last_status after a successful pass", () => {});
  it("records the mount failure in last_status instead of throwing out", () => {
    // VaultUnreadableError is caught here, surfaced as last_status, and rethrown
    // to the caller so the route can answer 503 — assert both.
  });
});

describe("readAutoSyncConfig", () => {
  it("defaults to enabled at 15 minutes", () => {});
  it("reads the vault_auto_sync keys", () => {});
  it("falls back to the legacy notion_auto_sync keys when the vault keys are unset", () => {
    // Seed notion_auto_sync_interval_minutes = "5"; expect intervalMinutes 5.
  });
  it("prefers the vault keys when both are set", () => {});
  it("ignores a garbage interval", () => {});
});

describe("runAutoSyncTick", () => {
  it("syncs every campaign with a source", () => {});
  it("skips a campaign whose lock is held", () => {});
  it("isolates a failing campaign and releases its lock", () => {});
});

describe("runTickAndComputeDelay", () => {
  it("returns the configured interval in ms", () => {});
  it("returns the default interval when the tick throws", () => {});
  it("does not run the tick when disabled", () => {});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/vault/run-sync.test.ts lib/vault/scheduler.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Port the three modules and write the two routes**

```bash
git mv lib/notion/sync-lock.ts lib/vault/sync-lock.ts
git mv lib/notion/sync-lock.test.ts lib/vault/sync-lock.test.ts
```

`run-sync.ts` loses the token lookup and the per-type data-source resolution entirely — one `vault_sources` row replaces five. `scheduler.ts` ports otherwise unchanged; the only new behavior is the legacy-key read-through in `readAutoSyncConfig`, which exists so the DM's current interval survives the rename.

`PUT /api/vault/source` takes `{ campaignId, rootPath }`, rejects an absolute path or one containing `..`, and upserts; an empty `rootPath` deletes the row. `GET` returns the row. `POST /api/vault/sync` mirrors the Notion route: 409 when the lock is held, 400 for `NoVaultSourceError`, **503 for `VaultUnreadableError`**, and releases the lock in `finally`. Point `instrumentation.ts` at `startVaultSync`.

- [ ] **Step 4: Point local dev at the real vault**

Add `VAULT_PATH` to `.env.local` (gitignored) pointing at the Obsidian vault root
on this machine, and document it in `README.md` beside the other env vars. The
default of `/vault` is the container's path and is wrong for local dev, so
without this the scan aborts with `VaultUnreadableError` on every tick.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run lib/vault/` then `npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/vault app/api/vault instrumentation.ts README.md
git commit -m "feat(vault): wire run-sync, the background scheduler, and the sync routes"
```

---

### Task 10: Markdown to the block model

**Files:**
- Create: `lib/vault/markdown.ts`
- Modify: `package.json` (add `remark`, `remark-gfm`)
- Test: `lib/vault/markdown.test.ts`

**Interfaces:**
- Consumes: `parseWikilink` (Task 4)
- Produces:
  - `interface MdInline { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string | null; link?: { target: string; kind: "wikilink" } }`
  - `interface MdBlock { id: string; type: "paragraph" | "heading" | "list_item" | "quote" | "callout" | "divider" | "image" | "table" | "embed" | "unsupported"; depth?: number; ordered?: boolean; inlines?: MdInline[]; calloutType?: string; calloutTitle?: string; collapsed?: boolean; children?: MdBlock[]; imageTarget?: string; embedTarget?: string; embedHeading?: string | null; rows?: MdInline[][][] }`
  - `parseMarkdown(markdown: string): MdBlock[]`

- [ ] **Step 1: Write the failing test**

```ts
describe("parseMarkdown", () => {
  it("maps headings with their depth", () => {});
  it("maps paragraphs with bold, italic, code and links as inlines", () => {});
  it("maps bulleted and numbered list items, marking ordered", () => {});
  it("maps a divider", () => {});
  it("maps a GFM table to rows of cells", () => {});

  it("maps a plain blockquote to a quote, not a callout", () => {});

  it("maps a callout with its type and title", () => {
    const [b] = parseMarkdown("> [!describe] At the Table\n> Tall and spare.");
    expect(b.type).toBe("callout");
    expect(b.calloutType).toBe("describe");
    expect(b.calloutTitle).toBe("At the Table");
    expect(b.collapsed).toBe(false);
  });

  it("marks a collapsed callout", () => {
    expect(parseMarkdown("> [!dm]- Secret\n> Hidden.")[0].collapsed).toBe(true);
  });

  it("lowercases the callout type", () => { /* [!DM] -> "dm" */ });
  it("preserves callout body blocks as children", () => {});
  it("keeps an unknown callout type rather than dropping the block", () => { /* [!widget] */ });

  it("maps an image embed to its target", () => {
    expect(parseMarkdown("![[Bartlebee_GeneratedArt.png]]")[0]).toMatchObject({
      type: "image", imageTarget: "Bartlebee_GeneratedArt.png",
    });
  });

  it("maps a base embed to an embed block with its heading", () => {
    expect(parseMarkdown("![[Related.base#NPCs here]]")[0]).toMatchObject({
      type: "embed", embedTarget: "Related.base", embedHeading: "NPCs here",
    });
  });

  it("maps an inline wikilink to a link inline", () => {
    // "[[Rexxentrum|the capital]]" -> text "the capital", link.target "Rexxentrum"
  });

  it("keeps non-ASCII link targets intact", () => {});
  it("returns an empty array for an empty body", () => {});
  it("gives every block a stable id across two parses of the same input", () => {});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/vault/markdown.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Install remark and implement `parseMarkdown`**

```bash
npm install remark remark-gfm
```

Parse to mdast with `remark().use(remarkGfm)`, then walk it. Two post-passes mdast does not do natively: a `blockquote` whose first paragraph begins `[!type]` or `[!type]-` becomes a `callout` (type lowercased, remainder of that line the title, following blocks the children), and `![[...]]` / `[[...]]` in text nodes become `image` / `embed` blocks and `link` inlines via `parseWikilink`. An `.base` target becomes `embed`; an image extension becomes `image`. Block ids are the index-based path through the tree, so they are stable for identical input.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/vault/markdown.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json lib/vault/markdown.ts lib/vault/markdown.test.ts
git commit -m "feat(vault): parse markdown into a renderable block model"
```

---

### Task 11: Resolve base embeds to hub relations

**Files:**
- Create: `lib/vault/embeds.ts`
- Test: `lib/vault/embeds.test.ts`

**Interfaces:**
- Consumes: `createTestDb` (Task 1), the link tables from Task 7
- Produces:
  - `type EmbedView = "npcs-here" | "members" | "items-held" | "sessions-here" | "content-here" | "places-within"`
  - `embedViewFor(heading: string): EmbedView | null` — `null` for the four views pointing at non-mirrored types
  - `interface EmbedResult { title: string; items: Array<{ kind: string; id: string; name: string }> }`
  - `resolveEmbed(db, campaignId: string, view: EmbedView, hostKind: string, hostId: string): EmbedResult`

- [ ] **Step 1: Write the failing test**

```ts
describe("embedViewFor", () => {
  it.each([
    ["NPCs here", "npcs-here"], ["Members", "members"], ["Items held", "items-held"],
    ["Sessions here", "sessions-here"], ["Content here", "content-here"],
    ["Places within", "places-within"],
  ])("maps %s", (heading, view) => { expect(embedViewFor(heading)).toBe(view); });

  it.each(["Threads", "Threads advanced", "Scenes featuring", "Player notes", "Items found"])(
    "returns null for %s", (h) => { expect(embedViewFor(h)).toBeNull(); }
  );

  it("is case-insensitive and tolerates surrounding whitespace", () => {});
  it("returns null for an unknown heading", () => {});
});

describe("resolveEmbed", () => {
  it("lists NPCs linked to a location", () => {});
  it("excludes archived rows", () => {});
  it("lists faction members", () => {});
  it("lists items held by a character", () => {});
  it("lists sessions linked to a location, newest first", () => {});
  it("lists only encounter and scene note types for content-here", () => {
    // A session note and an encounter both linked to the location; only the
    // encounter and scene appear.
  });
  it("lists child locations for places-within", () => {});
  it("returns an empty items array rather than throwing when nothing matches", () => {});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/vault/embeds.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/vault/embeds.ts`**

`content-here` and `sessions-here` both read `session_note_locations`; they differ only in whether they keep `note_type = 'Session Notes'` or exclude it.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/vault/embeds.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/vault/embeds.ts lib/vault/embeds.test.ts
git commit -m "feat(vault): answer Related.base embeds from hub relations"
```

---

### Task 12: Attachments — resolver, containment guard, and route

**Files:**
- Create: `lib/vault/attachments.ts`, `app/api/vault/attachment/route.ts`
- Test: `lib/vault/attachments.test.ts`

**Interfaces:**
- Consumes: `resolveCampaignFolder` (Task 3)
- Produces:
  - `const ALLOWED_IMAGE_EXT: readonly string[]` — `.png .jpg .jpeg .webp .gif .svg`
  - `resolveAttachment(vaultRoot: string, target: string): string | null` — finds a file whose basename matches `target` anywhere under `vaultRoot`, returns its absolute real path, or `null`
  - `assertInsideVault(vaultRoot: string, absPath: string): void` — throws `AttachmentPathError` unless the **resolved real path** of `absPath` is inside the resolved real path of `vaultRoot`
  - `class AttachmentPathError extends Error`

- [ ] **Step 1: Write the failing test**

```ts
describe("resolveAttachment", () => {
  it("finds an attachment by basename", () => {});
  it("finds one nested under _Attachments", () => {});
  it("returns null for a missing file", () => {});
  it("returns null for a disallowed extension", () => { /* notes.md, script.sh */ });
  it("handles a non-ASCII basename", () => { /* "Shale (Lins).png" */ });
});

describe("assertInsideVault", () => {
  it("accepts a path inside the vault", () => {});
  it("rejects a parent-traversal path", () => {
    expect(() => assertInsideVault(root, path.join(root, "../secret.png"))).toThrow(AttachmentPathError);
  });
  it("rejects a symlink pointing outside the vault", () => {
    // Write a real file outside the vault, symlink it to <root>/_Attachments/evil.png,
    // and assert the guard throws — a string-prefix check would pass this.
  });
  it("rejects an absolute path elsewhere on disk", () => {});
  it("accepts a vault root that is itself reached through a symlink", () => {
    // Both sides are realpath'd, so this must not be a false rejection.
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/vault/attachments.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module and the route**

`assertInsideVault` uses `fs.realpathSync` on both sides and compares with `path.relative`, rejecting a result that is empty, starts with `..`, or is absolute. The route takes `?target=`, resolves, guards, then streams through `sharp` with a `?w=` width cap and `Cache-Control: public, max-age=31536000, immutable`. SVG is served as-is rather than through `sharp`. A missing attachment is a 404.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run lib/vault/attachments.test.ts` then `npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/vault/attachments.ts lib/vault/attachments.test.ts app/api/vault/attachment
git commit -m "feat(vault): serve vault attachments behind a realpath containment guard"
```

---

### Task 13: Paths, the page route, and the rendering components

**Files:**
- Create: `lib/vault/paths.ts`, `app/api/vault/page/route.ts`
- Create: `components/glossary/MarkdownBlocks.tsx`, `components/glossary/PropsTable.tsx`
- Delete: `components/glossary/NotionBlocks.tsx`, `components/glossary/NotionPropsTable.tsx`
- Modify: `app/characters/[id]/page.tsx`, `components/entities/EntityQuickView.tsx`, `components/glossary/SimpleEntityDetail.tsx`, `components/sessions/SessionNoteDetail.tsx`, `components/run/BriefingCard.tsx`, `components/maps/EventNoteBody.tsx`
- Test: `lib/vault/paths.test.ts`

**Interfaces:**
- Consumes: `parseMarkdown` (Task 10), `resolveEmbed` + `embedViewFor` (Task 11)
- Produces:
  - `obsidianUri(vaultName: string, sourcePath: string): string`
  - `assertVaultRelative(sourcePath: string): void` — throws `VaultPathError` for an absolute path or one containing a `..` segment
  - `class VaultPathError extends Error`
  - `GET /api/vault/page?path=<vault-relative>` returns `{ blocks: MdBlock[], embeds: Record<string, EmbedResult> }`

- [ ] **Step 1: Write the failing test**

This is Review Focus item 1. 15 real notes carry em dashes, curly apostrophes or `&`, and `&` is the character that silently truncates a query string.

```ts
describe("obsidianUri", () => {
  it("builds a vault-and-file uri", () => {
    expect(obsidianUri("Willowbrook-Remote", "D&D/Sessions/Session 29.md"))
      .toBe("obsidian://open?vault=Willowbrook-Remote&file=D%26D%2FSessions%2FSession%2029.md");
  });

  it("encodes an ampersand in the path so the uri cannot be truncated", () => {
    expect(obsidianUri("V", "Scenes/Cobalt Soul Reunion — Beilar & Elbera.md"))
      .toContain("%26");
  });

  it("encodes an em dash and a curly apostrophe", () => {
    const uri = obsidianUri("V", "Encounters/The Bone Pit — Tubi's First Bout.md");
    expect(uri).toContain("%E2%80%94");
    expect(uri).toContain("%E2%80%99");
  });

  it("round-trips: decoding the file param yields the original path", () => {
    const p = "Scenes/Cobalt Soul Reunion — Beilar & Elbera.md";
    const file = new URL(obsidianUri("V", p)).searchParams.get("file");
    expect(file).toBe(p);
  });

  it("encodes the vault name too", () => {});
});

describe("assertVaultRelative", () => {
  it("accepts a normal relative path", () => {});
  it("rejects an absolute path", () => {});
  it("rejects a path with a .. segment", () => {});
  it("accepts a path whose filename merely contains dots", () => { /* "A.B. Notes.md" */ });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/vault/paths.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `paths.ts`, the page route, and the two components**

`obsidianUri` builds with `URLSearchParams` so encoding is not hand-rolled. The page route calls `assertVaultRelative`, reads the file under `VAULT_PATH`, parses it, and resolves every `embed` block whose `embedViewFor` is non-null into the `embeds` map keyed by block id.

`MarkdownBlocks` renders `MdBlock[]`, reusing the Tailwind classes already in `NotionBlocks.tsx` for the shared block types. New cases: `callout` renders an icon and colour chosen from `calloutType` with a `<details>` wrapper when `collapsed`; `embed` renders its `EmbedResult` as a list of internal hub links, or **nothing at all** when the id is absent from the `embeds` map; `image` points at `/api/vault/attachment?target=`; `table` renders a `<table>`. `unsupported` renders nothing. `PropsTable` is `NotionPropsTable` renamed with its `NotionProp` type renamed to `PropEntry`.

Update the six consumers to read `sourcePath` / `sourceProps` and to fetch `/api/vault/page`. In `EventNoteBody`, "View in Notion" becomes "Open in Obsidian" using `obsidianUri`, and the empty state becomes "No vault note linked."

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `npx vitest run lib/vault/paths.test.ts` then `npx tsc --noEmit` then `npm run lint`
Expected: PASS, no type errors, no lint errors.

- [ ] **Step 5: Commit**

```bash
git add lib/vault/paths.ts lib/vault/paths.test.ts app/api/vault/page components app/characters
git commit -m "feat(vault): render note markdown, callouts and live relation embeds"
```

---

### Task 14: Vault sync panel and settings

**Files:**
- Create: `components/settings/VaultSyncPanel.tsx`
- Delete: `components/settings/NotionSyncPanel.tsx`
- Modify: `app/settings/page.tsx`, `app/api/settings/route.ts`
- Test: none — `.tsx` is not tested in this repo

**Interfaces:**
- Consumes: `/api/vault/source`, `/api/vault/sync` (Task 9)
- Produces: the `vault_name` setting key

- [ ] **Step 1: Build `VaultSyncPanel`**

One root-path field instead of five database URLs. It shows the resolved folder, whether it is readable, the per-table counts and warnings from `last_status`, and a **Sync now** button. A 503 from the sync route renders as "The vault folder isn't reachable from the server" rather than a generic failure, since that is the expected symptom of a dropped mount.

- [ ] **Step 2: Replace the Notion section in `app/settings/page.tsx`**

Remove the token field, `notionToken` / `notionConfigured` state and `saveNotionToken`. Add a `vault_name` text field next to the root path, since `obsidianUri` needs it. Drop `notion_token` from the settings route's allowed keys and add `vault_name`.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` then `npm run lint`
Expected: no type errors, no lint errors.

- [ ] **Step 4: Confirm in the browser**

Start the dev server, open `/settings`, set the root path, press **Sync now**, and confirm the counts appear and the Notion token field is gone.

- [ ] **Step 5: Commit**

```bash
git add components/settings app/settings app/api/settings
git commit -m "feat(vault): replace the Notion sync panel with vault settings"
```

---

### Task 15: Session review reads the note file

**Files:**
- Modify: `app/api/campaigns/[id]/state/review/route.ts`
- Create: `lib/vault/note-text.ts`
- Test: `lib/vault/note-text.test.ts`

**Interfaces:**
- Consumes: `digestBody` (Task 5), `assertVaultRelative` (Task 13)
- Produces: `readNoteText(sourcePath: string): Promise<string>` — reads the note under `VAULT_PATH` and returns its `[!dm]`-stripped plain text; throws `VaultUnreadableError` if the file is missing

- [ ] **Step 1: Write the failing test**

```ts
describe("readNoteText", () => {
  it("returns the note's stripped plain text", () => {});
  it("excludes [!dm] content, as the search index does", () => {});
  it("throws VaultUnreadableError for a missing file", () => {});
  it("rejects a path that escapes the vault", () => {});
  it("returns an empty string for a frontmatter-only note", () => {});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/vault/note-text.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `readNoteText` and rewrite the route's source step**

The route currently refuses when `note.notionPageId` is null and answers 502 when Notion is unreachable. It now refuses when `source_path` is null with `"This session note has no linked vault note to review"`, and answers **503** via `VaultUnreadableError` when the file cannot be read. The existing "no readable text" 400 stays.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run lib/vault/note-text.test.ts` then `npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/vault/note-text.ts lib/vault/note-text.test.ts "app/api/campaigns/[id]/state/review/route.ts"
git commit -m "feat(vault): review a session from its vault note instead of Notion"
```

---

### Task 16: Pre-flight vault edits

This task edits the Obsidian vault, not the repo. It must be done **before the first sync against the production database**, or two mirrored notes will orphan their existing hub rows. Nothing here is code, and nothing here is reversible by the app, since the mount is read-only.

**Files:** (all in the vault, not this repo)
- Modify: `D&D/Explorers of Exandria/Arcs/Dangerous Designs Pt 1.md`
- Modify: `D&D/Explorers of Exandria/Characters/PCs/Shale Telenna (Hill).md`
- Modify: `_Templates/{Character,Location,Session,Encounter,Arc,Plot Thread}.md`
- Create: `_Templates/Item.md`, `_Templates/Faction.md`

- [ ] **Step 1: Confirm the two notes still lack an id**

```bash
cd "$VAULT/D&D/Explorers of Exandria" && \
  find . -name "*.md" -not -path "./_Templates/*" -print0 \
  | xargs -0 grep -L "^notion_id:"
```
Expected: exactly those two paths, or fewer.

- [ ] **Step 2: Give each one the `notion_page_id` its hub row already holds**

For each of the two, read the id from the live database and paste it into the note's frontmatter as `notion_id:`. For `Shale Telenna (Hill)`, also confirm whether the hub row's name matches the basename — if the row is named `Shale Telenna`, the id is what prevents a duplicate, since the basename will not match.

```sql
SELECT id, name, notion_page_id, source_key FROM characters WHERE name LIKE 'Shale%';
SELECT id, name, notion_page_id, source_key FROM session_notes WHERE name LIKE 'Dangerous Designs Pt 1%';
```

- [ ] **Step 3: Add `hub_id` to the six existing templates and author the two missing ones**

Each template's frontmatter gains `hub_id: <% tp.date.now("YYYYMMDDHHmmss") %>-<% tp.file.cursor() %>` or any Templater expression producing a unique value — the only requirement is that it is unique and stable once written. `Item.md` gets `type: item`, `item_type`, `rarity`, `held_by`, `found_in`; `Faction.md` gets `type: faction`, `faction_type`, `stance`, `active`, `headquarters`. Both carry the standard `tags` and `cssclasses: [dnd]`.

- [ ] **Step 4: Verify every mirrored note now resolves above tier 3**

```bash
cd "$VAULT/D&D/Explorers of Exandria" && \
  find . -name "*.md" -not -path "./_Templates/*" -print0 \
  | xargs -0 grep -l "^type: \(npc\|pc\|location\|item\|faction\|session\|arc\|encounter\|scene\)" \
  | while read -r f; do grep -q "^\(hub_id\|notion_id\):" "$f" || echo "NO ID: $f"; done
```
Expected: no output.

- [ ] **Step 5: Note the completion in the plan**

Nothing to commit in this repo. Tick this task's boxes and record in the PR description that the pre-flight ran, so a later reader knows the ids were not invented by the app.

---

### Task 17: Delete Notion and verify the whole branch

**Files:**
- Delete: `lib/notion/` (20 files, 1,896 lines), `app/api/notion/`
- Modify: `package.json` (remove `@notionhq/client`)
- Modify: `lib/run/briefing-build.ts`, `lib/run/briefing-inputs.ts`
- Modify: `lib/assistant/tools.ts`, `lib/assistant/read-tools.ts`, `lib/assistant/proposals.ts`
- Modify: `components/maps/marker-meta.ts`
- Modify: `docs/user-guide/notion-sync.md` → `vault-sync.md`, plus `README.md`, `docs/user-guide/README.md`, `sessions.md`, `entities.md`
- Test: `lib/run/briefing-build.test.ts`, `lib/run/briefing-inputs.test.ts`, `lib/assistant/tools.test.ts`

**Interfaces:**
- Consumes: everything above
- Produces: `buildVaultSyncProposal(campaignId: string)`; `propose_vault_sync` assistant tool; `BriefingInputs` with `sourceProps` / `sourcePath` / `sourceHash` and no `notionBody`

- [ ] **Step 1: Update the failing briefing and assistant tests**

```ts
describe("briefing inputs", () => {
  it("reads sourceProps and sourcePath", () => {});
  it("includes source_hash in the staleness hash", () => {
    // Build a briefing, change only the note's source_hash, and assert
    // isBriefingStale() now returns true. Under Notion this was impossible.
  });
  it("marks a briefing partial when the note has no readable text", () => {});
});

describe("assistant tools", () => {
  it("exposes propose_vault_sync", () => {});
  it("does not expose propose_notion_sync", () => {});
  it("returns sourceProps from get_entity", () => {});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run lib/run/briefing-inputs.test.ts lib/assistant/tools.test.ts`
Expected: FAIL.

- [ ] **Step 3: Make the changes**

```bash
git rm -r lib/notion app/api/notion
npm uninstall @notionhq/client
git mv docs/user-guide/notion-sync.md docs/user-guide/vault-sync.md
```

`briefing-build.ts` loses `FetchNotionBodyFn` and its `fetchNotionBody` option; the body no longer needs fetching at build time because `source_hash` is already a column, so `hashInputs` includes it directly and the `notionBody: null` exclusion comment goes with it. `briefing-inputs.ts` selects `source_props`, `source_path` and `source_hash`. `marker-meta.ts` gains the `Exploration Encounter` entry and its comment stops saying "Notion". Rewrite `vault-sync.md` for the vault workflow — the root-path setting, what a sync pass does, what the warnings mean, and the read-only mount — and fix the links in the four other docs.

- [ ] **Step 4: Verify nothing references Notion**

Run: `grep -rn -i "notion" --include="*.ts" --include="*.tsx" --include="*.json" lib app components scripts package.json`
Expected: only `notion_id` / `notion_page_id` / `notionSources`-era identifiers that the spec says stay — the `notion_*` columns in `schema.ts` and `migrate.ts`, and the tier-2 `notion_id` frontmatter read in `lib/vault/map.ts`. No imports, no `@notionhq`, no routes, no token.

- [ ] **Step 5: Add the mount and the env var to the deployment**

`docker-compose.yml` gains the read-only volume and the env var:

```yaml
    volumes:
      - /mnt/user/<path-to-vault>:/vault:ro
    environment:
      - VAULT_PATH=/vault
```

Update `DEPLOYMENT.md` with a section on the mount: that the path must be the
Obsidian **vault root** rather than the campaign folder, that it is mounted `ro`
on purpose, and that a missing mount shows up as a 503 from the sync route and a
"not reachable" message in Settings rather than as silent data loss. Record there
that **what syncs the vault onto the server is still unresolved** — this is the
spec's one open prerequisite, and the container cannot sync until it is answered.

- [ ] **Step 6: Full verification**

Run each and confirm:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Then start the dev server and walk the app: an entity detail page renders its markdown, callouts and a relation embed; a session note opens; an image loads; **Open in Obsidian** resolves; `/settings` syncs; `/run` finds an entity by a phrase that appears only in a note body — which is the capability this migration adds.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: remove the Notion integration"
```
