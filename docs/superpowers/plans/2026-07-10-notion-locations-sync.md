# Notion Locations Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `locations` as a 4th Notion sync source, enriching the 198 world-seeded hub locations (and creating new Notion-only ones) without disturbing map markers or the layering `type`.

**Architecture:** Extends the shipped Characters/Items/Factions sync engine. New logic is just `mapLocationRow` + a `linkCharacterLocationsByPageId` helper; everything else is registering the source and flipping already-built surfaces. Reconcile/adopt/archive all reused unchanged.

**Tech Stack:** Next.js 16, TypeScript, Drizzle + better-sqlite3, `@notionhq/client` v5, vitest.

**Spec:** `docs/superpowers/specs/2026-07-10-notion-locations-sync-design.md`

**Notion Locations data source (for manual verification):** `collection://496972df-7c5b-4e84-b561-f263a5f1ecdc`. Props: `Name`, `Description`, `Type` (City/District/…), `Status`, `Region`, `Notable NPCs` (→Characters).

---

## File structure

| File | Change |
|---|---|
| `lib/db/schema.ts` | Add 4 sync columns to `locations`; add `"locations"` to `notion_sources.entityType` enum |
| `lib/db/migrate.ts` | Add `"locations"` to the `addColumnIfMissing` loop |
| `lib/notion/map.ts` | Add `notableNpcPageIds?` to `MappedEntity`; add `mapLocationRow` |
| `lib/notion/repos.ts` | Add `locations` to `SyncTable` union; add `linkCharacterLocationsByPageId` |
| `lib/notion/sync.ts` | Register `locations` (EntityType, ORDER, TABLES, MAPPERS, summary, link branch, archiveUnseen type) |
| `app/api/notion/sources/route.ts` | Add `"locations"` to `TYPES` |
| `components/settings/NotionSyncPanel.tsx` | Add a 4th `locations` entry to `SOURCES` |
| `app/api/locations/[id]/route.ts` | Return parsed `notionProps` |
| `app/api/locations/route.ts` | GET → `{ items, archivedCount }` + archived filtering |
| `components/entities/SimpleEntityManager.tsx` | Flip `SUPPORTS_ARCHIVED.locations` → `true` |
| `app/page.tsx` | Read `l.items.length` for the locations count |
| `components/entities/CharacterFormDialog.tsx` | `setLocations(l.items)` |

`components/maps/MarkerFormDialog.tsx` already reads `Array.isArray(data) ? data : data.items ?? []`, so it needs **no change** — but Task 8 verifies it.

---

## Task 1: Schema + migration

**Files:**
- Modify: `lib/db/schema.ts`
- Modify: `lib/db/migrate.ts`

- [ ] **Step 1: Add the 4 sync columns to the `locations` table**

In `lib/db/schema.ts`, in the `locations = sqliteTable("locations", {...})` definition, add these four lines immediately before the `createdAt` line (mirroring what `characters`/`items`/`factions` already have):

```typescript
  notionPageId: text("notion_page_id"),
  notionProps: text("notion_props"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  notionSyncedAt: integer("notion_synced_at", { mode: "timestamp" }),
```

- [ ] **Step 2: Add `"locations"` to the notion_sources enum**

In `lib/db/schema.ts`, find the `notionSources` table's `entityType` column and add `"locations"`:

```typescript
    entityType: text("entity_type", { enum: ["characters", "items", "factions", "locations"] }).notNull(),
```

- [ ] **Step 3: Extend the migration loop**

In `lib/db/migrate.ts`, find the loop that adds the sync columns and append `"locations"` to its array:

```typescript
  for (const table of ["characters", "items", "factions", "locations"]) {
    addColumnIfMissing(table, "notion_page_id", "TEXT");
    addColumnIfMissing(table, "notion_props", "TEXT");
    addColumnIfMissing(table, "archived", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing(table, "notion_synced_at", "INTEGER");
  }
```

- [ ] **Step 4: Verify the migration adds the columns**

Run: `DB_PATH=/tmp/loc-migrate-check.db npx tsx -e "import {runMigrations} from './lib/db/migrate'; runMigrations(); console.log('ok')"`
Then: `sqlite3 /tmp/loc-migrate-check.db "PRAGMA table_info(locations);" | grep -E "notion_page_id|notion_props|archived|notion_synced_at"`
Expected: all four columns listed. (If `sqlite3` CLI is unavailable, query via a better-sqlite3 tsx one-liner.)

- [ ] **Step 5: Build + commit**

Run: `npm run build`
Expected: succeeds.

```bash
rm -f /tmp/loc-migrate-check.db
git add lib/db/schema.ts lib/db/migrate.ts
git commit -m "feat: locations sync columns + notion_sources locations enum"
```

---

## Task 2: `mapLocationRow`

**Files:**
- Modify: `lib/notion/map.ts`
- Test: `lib/notion/map.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `lib/notion/map.test.ts`:

```typescript
import { mapLocationRow } from "./map";

describe("mapLocationRow", () => {
  const page = (id: string, properties: Record<string, unknown>) => ({
    id, url: `https://www.notion.so/${id.replace(/-/g, "")}`, properties,
  });

  it("maps description (when present), Type/Status/Region props, and Notable NPCs", () => {
    const m = mapLocationRow(page("2855c727-add4-4710-a87b-e0f40879f3a4", {
      Name: { type: "title", title: [{ plain_text: "Druvenlode" }] },
      Description: { type: "rich_text", rich_text: [{ plain_text: "A mining town." }] },
      Type: { type: "select", select: { name: "City" } },
      Status: { type: "select", select: { name: "Explored" } },
      Region: { type: "select", select: { name: "Marrow Valley" } },
      "Notable NPCs": { type: "relation", relation: [{ id: "213e996b-e66d-80d6-a7cd-f142c199b757" }] },
    }));
    expect(m.name).toBe("Druvenlode");
    expect(m.archived).toBe(false);
    expect(m.extra).toEqual({ description: "A mining town." });
    expect(m.notableNpcPageIds).toEqual(["213e996be66d80d6a7cdf142c199b757"]);
    expect(m.notionProps).toEqual([
      { label: "Type", value: "City" },
      { label: "Status", value: "Explored" },
      { label: "Region", value: "Marrow Valley" },
    ]);
    expect("type" in m.extra).toBe(false); // hub type is never written by sync
  });

  it("omits description from extra when the Notion field is empty", () => {
    const m = mapLocationRow(page("loc2", {
      Name: { type: "title", title: [{ plain_text: "Blank" }] },
    }));
    expect(m.extra).toEqual({});
    expect(m.notableNpcPageIds).toEqual([]);
    expect(m.notionProps).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test lib/notion/map.test.ts`
Expected: FAIL — `mapLocationRow` not exported.

- [ ] **Step 3: Implement**

In `lib/notion/map.ts`, add `notableNpcPageIds?: string[];` to the `MappedEntity` interface (next to `heldByPageIds?`), then add at the end of the file:

```typescript
export function mapLocationRow(row: NotionRow): MappedEntity {
  const props: PropEntry[] = [];
  pushIf(props, "Type", readSelect(prop(row, "Type")));
  pushIf(props, "Status", readSelect(prop(row, "Status")));
  pushIf(props, "Region", readSelect(prop(row, "Region")));

  // Notion wins only if non-empty: omit description from `extra` when blank so
  // reconcile never overwrites existing (often world-composed) text with "".
  const description = readText(prop(row, "Description"));
  const extra: Record<string, unknown> = {};
  if (description) extra.description = description;

  return {
    notionPageId: pageId(row),
    notionUrl: row.url,
    name: readTitle(prop(row, "Name")),
    archived: false, // Locations has no Active property; removal drives archival
    notionProps: props,
    extra, // never contains `type` → hub type stays world-authoritative
    notableNpcPageIds: readRelationIds(prop(row, "Notable NPCs")),
  };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test lib/notion/map.test.ts`
Expected: PASS (all map tests, old + new).

- [ ] **Step 5: Commit**

```bash
git add lib/notion/map.ts lib/notion/map.test.ts
git commit -m "feat: mapLocationRow (description-if-nonempty, Type/Status/Region, Notable NPCs)"
```

---

## Task 3: `linkCharacterLocationsByPageId` + SyncTable union

**Files:**
- Modify: `lib/notion/repos.ts`
- Test: `lib/notion/repos.test.ts`

- [ ] **Step 1: Add a failing test**

Append to `lib/notion/repos.test.ts` (it already imports `createTestDb`, `makeEntityRepo`, `reconcileEntity`, and schema tables — add `locations`, `characterLocations`, and `linkCharacterLocationsByPageId` to the existing imports at the top of the file):

```typescript
describe("linkCharacterLocationsByPageId", () => {
  it("links a location to characters by notion page id, additively", () => {
    const { db, campaignId } = createTestDb();
    const cRepo = makeEntityRepo(db, characters, campaignId);
    const lRepo = makeEntityRepo(db, locations, campaignId);
    const chr = reconcileEntity(cRepo, m({ name: "Beilar", notionPageId: "cPAGE", extra: { type: "npc" } }));
    const loc = reconcileEntity(lRepo, m({ name: "Oreland", notionPageId: "l1" }));

    linkCharacterLocationsByPageId(db, loc.id, ["cPAGE", "unknownPage"]);
    linkCharacterLocationsByPageId(db, loc.id, ["cPAGE"]); // re-run: no duplicate

    const links = db.select().from(characterLocations)
      .where(and(eq(characterLocations.locationId, loc.id), eq(characterLocations.characterId, chr.id))).all();
    expect(links).toHaveLength(1);
  });

  it("creates a new location with default type 'other'", () => {
    const { db, campaignId } = createTestDb();
    const lRepo = makeEntityRepo(db, locations, campaignId);
    const loc = reconcileEntity(lRepo, m({ name: "New Place", notionPageId: "l9" }));
    const row = db.select().from(locations).where(eq(locations.id, loc.id)).get()!;
    expect(row.type).toBe("other");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test lib/notion/repos.test.ts`
Expected: FAIL — `linkCharacterLocationsByPageId` / `locations` / `characterLocations` not imported.

- [ ] **Step 3: Implement**

In `lib/notion/repos.ts`:
1. Add `locations` and `characterLocations` to the schema import:
```typescript
import {
  characters, items, factions, locations, characterFactions, characterItems, characterLocations,
} from "@/lib/db/schema";
```
2. Extend the `SyncTable` union:
```typescript
type SyncTable = typeof characters | typeof items | typeof factions | typeof locations;
```
3. Add the helper at the end of the file (mirrors `linkCharacterItemsByPageId`):
```typescript
/** Additive: add character↔location links, resolving characters by notion page id. */
export function linkCharacterLocationsByPageId(
  db: Db, locationId: string, characterPageIds: string[],
): void {
  for (const pid of characterPageIds) {
    const chr = db.select().from(characters).where(eq(characters.notionPageId, pid)).get();
    if (!chr) continue;
    db.insert(characterLocations).values({ characterId: chr.id, locationId }).onConflictDoNothing().run();
  }
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test lib/notion/repos.test.ts`
Expected: PASS. Then `npx tsc --noEmit` → clean (the existing localized casts in `makeEntityRepo` cover `locations`; the new-location insert omits `type`, which SQLite fills with the column's `DEFAULT 'other'`).

- [ ] **Step 5: Commit**

```bash
git add lib/notion/repos.ts lib/notion/repos.test.ts
git commit -m "feat: linkCharacterLocationsByPageId + locations in SyncTable union"
```

---

## Task 4: Wire `locations` into `syncCampaign`

**Files:**
- Modify: `lib/notion/sync.ts`
- Test: `lib/notion/sync.test.ts`

- [ ] **Step 1: Add a failing integration test**

Append to `lib/notion/sync.test.ts` (reuse its existing `page`/`title`/`sel`/`chk` helpers — add this block inside the file, after the existing `describe`):

```typescript
describe("syncCampaign — locations", () => {
  it("adopts a world-seeded location by name without clobbering type, and links Notable NPCs", async () => {
    const { db, campaignId } = createTestDb();
    // Pre-seed a world-style location: type 'city', a world description, NO notionPageId.
    const now = new Date();
    const seededId = "seed-druvenlode";
    db.insert(locations).values({
      id: seededId, campaignId, name: "Druvenlode",
      description: "City · Wildemount", type: "city", createdAt: now, updatedAt: now,
    } as never).run();

    const rows: Record<string, NotionRow[]> = {
      dsC: [page("chrBeilar", { Name: title("Beilar"), Type: sel("NPC"), Active: chk(true) })],
      dsL: [page("locDruv", {
        Name: title("Druvenlode"),
        Description: { type: "rich_text", rich_text: [{ plain_text: "A hard-bitten mining town." }] },
        Type: sel("City"),
        "Notable NPCs": { type: "relation", relation: [{ id: "chrBeilar" }] },
      })],
    };
    const summary = await syncCampaign({
      db, campaignId,
      sources: [
        { entityType: "characters", dataSourceId: "dsC" },
        { entityType: "locations", dataSourceId: "dsL" },
      ],
      queryRows: async (id) => rows[id] ?? [],
    });

    expect(summary.locations.adopted).toBe(1);
    const locs = db.select().from(locations).where(eq(locations.campaignId, campaignId)).all();
    expect(locs).toHaveLength(1);            // no duplicate
    const loc = locs[0];
    expect(loc.id).toBe(seededId);           // adopted in place
    expect(loc.type).toBe("city");           // world type untouched
    expect(loc.description).toBe("A hard-bitten mining town."); // enriched
    expect(loc.notionPageId).toBeTruthy();

    const chr = db.select().from(characters).where(eq(characters.campaignId, campaignId)).get()!;
    const links = db.select().from(characterLocations)
      .where(eq(characterLocations.locationId, loc.id)).all();
    expect(links).toHaveLength(1);
    expect(links[0].characterId).toBe(chr.id);
  });
});
```

Ensure the test file imports `locations` and `characterLocations` from `@/lib/db/schema` (add to the existing import).

- [ ] **Step 2: Run to confirm failure**

Run: `npm test lib/notion/sync.test.ts`
Expected: FAIL — `summary.locations` is undefined / `locations` not a valid `entityType`.

- [ ] **Step 3: Implement the wiring**

In `lib/notion/sync.ts`, make these edits:

1. Imports:
```typescript
import { characters, items, factions, locations } from "@/lib/db/schema";
import { mapFactionRow, mapCharacterRow, mapItemRow, mapLocationRow, type MappedEntity } from "./map";
import { makeEntityRepo, linkCharacterFactionsByName, linkCharacterItemsByPageId, linkCharacterLocationsByPageId } from "./repos";
```

2. Extend the type + tables:
```typescript
export type EntityType = "characters" | "items" | "factions" | "locations";
```
```typescript
const TABLES = { characters, items, factions, locations } as const;
const MAPPERS: Record<EntityType, (row: NotionRow) => MappedEntity> = {
  factions: mapFactionRow, characters: mapCharacterRow, items: mapItemRow, locations: mapLocationRow,
};
// Dependency order: link targets (factions, characters) before linkers; locations
// after characters so Notable-NPC targets exist.
const ORDER: EntityType[] = ["factions", "characters", "locations", "items"];
```

3. Add `locations` to the summary initializer inside `syncCampaign`:
```typescript
  const summary: SyncSummary = {
    characters: emptySummary(), items: emptySummary(), factions: emptySummary(), locations: emptySummary(),
  };
```

4. Add the link branch inside the row loop, next to the items branch:
```typescript
      if (type === "locations" && mapped.notableNpcPageIds?.length) {
        linkCharacterLocationsByPageId(db, result.id, mapped.notableNpcPageIds);
      }
```

5. Widen `archiveUnseen`'s `table` parameter type:
```typescript
function archiveUnseen(db: Db, table: typeof characters | typeof items | typeof factions | typeof locations, campaignId: string, seenPageIds: string[]): number {
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test lib/notion/sync.test.ts`
Expected: PASS. Then `npm test` (full suite) + `npx tsc --noEmit` — all green.

- [ ] **Step 5: Commit**

```bash
git add lib/notion/sync.ts lib/notion/sync.test.ts
git commit -m "feat: wire locations into syncCampaign (order factions→characters→locations→items)"
```

---

## Task 5: Config surfaces (sources API + settings panel)

**Files:**
- Modify: `app/api/notion/sources/route.ts`
- Modify: `components/settings/NotionSyncPanel.tsx`

- [ ] **Step 1: Add `"locations"` to the sources API TYPES**

In `app/api/notion/sources/route.ts`, change:
```typescript
const TYPES = ["characters", "items", "factions", "locations"] as const;
```

- [ ] **Step 2: Add a Locations input to the settings panel**

In `components/settings/NotionSyncPanel.tsx`, add a 4th entry to the `SOURCES` array:
```typescript
const SOURCES = [
  { type: "characters", label: "Characters" },
  { type: "items", label: "Items & Loot" },
  { type: "factions", label: "Factions & Organizations" },
  { type: "locations", label: "Locations" },
] as const;
```

- [ ] **Step 3: Build + commit**

Run: `npm run build`
Expected: succeeds.

```bash
git add app/api/notion/sources/route.ts components/settings/NotionSyncPanel.tsx
git commit -m "feat: locations as a 4th configurable notion sync source"
```

---

## Task 6: Locations detail API returns `notionProps`

**Files:**
- Modify: `app/api/locations/[id]/route.ts`

- [ ] **Step 1: Add parsed `notionProps` to the GET response**

Read `app/api/locations/[id]/route.ts`. It builds a response object that already includes `linkedCharacters` and spreads/selects the location row. Add a parsed `notionProps` field to that returned object (use the actual row variable name in the file — likely `row` or `location`):

```typescript
notionProps: <rowVar>.notionProps ? (JSON.parse(<rowVar>.notionProps) as Array<{ label: string; value: string }>) : [],
```

(`SimpleEntityDetail` already renders the meta-table when `notionProps` is present — no UI change needed.)

- [ ] **Step 2: Build + commit**

Run: `npm run build` — succeeds.

```bash
git add app/api/locations/[id]/route.ts
git commit -m "feat: expose notionProps on the locations detail API"
```

---

## Task 7: Locations list API shape + archived filtering + consumers

**Files:**
- Modify: `app/api/locations/route.ts`
- Modify: `components/entities/SimpleEntityManager.tsx`
- Modify: `app/page.tsx`
- Modify: `components/entities/CharacterFormDialog.tsx`

- [ ] **Step 1: Change the list GET to `{ items, archivedCount }` with archived filtering**

In `app/api/locations/route.ts`, replace the `GET` handler with (keep the `POST` handler and imports; add `and` + `asc` are already imported — add `and` if missing):

```typescript
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  const includeArchived = searchParams.get("includeArchived") === "1";

  const conditions = [];
  if (campaignId) conditions.push(eq(locations.campaignId, campaignId));
  if (!includeArchived) conditions.push(eq(locations.archived, false));

  const rows = await db.query.locations.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [asc(locations.name)],
  });

  const archivedConditions = [eq(locations.archived, true)];
  if (campaignId) archivedConditions.push(eq(locations.campaignId, campaignId));
  const archived = await db.query.locations.findMany({ where: and(...archivedConditions) });

  return NextResponse.json({ items: rows, archivedCount: archived.length });
}
```

Make sure `and` is in the `drizzle-orm` import: `import { eq, asc, and } from "drizzle-orm";`

- [ ] **Step 2: Flip locations into archived support in the manager**

In `components/entities/SimpleEntityManager.tsx`, change the `SUPPORTS_ARCHIVED` map so locations is `true`:

```typescript
const SUPPORTS_ARCHIVED: Record<SimpleEntityManagerProps["resourcePath"], boolean> = {
  locations: true,
  items: true,
  factions: true,
};
```

(The manager already reads `.items` and shows the "Show archived (N)" toggle for supported types — this now applies to locations too.)

- [ ] **Step 3: Update the dashboard locations count**

In `app/page.tsx`, the counts setter reads `l.length` for locations while chars/items/factions read `.items.length`. Change locations to match:

```typescript
setCounts({ characters: c.items.length, locations: l.items.length, items: i.items.length, factions: f.items.length })
```

- [ ] **Step 4: Update the CharacterFormDialog locations read**

In `components/entities/CharacterFormDialog.tsx`, the `Promise.all` reads `setLocations(l)` while factions/items use `.items`. Change to:

```typescript
        setLocations(l.items);
```

- [ ] **Step 5: Build + verify no bare-array consumers remain**

Run: `npm run build` — succeeds.
Run: `grep -rn "api/locations" app components | grep -v "locations/\${" | grep -v "api/locations/\["`
Confirm every remaining hit reads the object shape (`.items`) OR is defensive (`MarkerFormDialog` uses `Array.isArray(data) ? data : data.items`). Report the list.

- [ ] **Step 6: Commit**

```bash
git add app/api/locations/route.ts components/entities/SimpleEntityManager.tsx app/page.tsx components/entities/CharacterFormDialog.tsx
git commit -m "feat: locations list API {items,archivedCount} + archived toggle + consumers"
```

---

## Task 8: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Automated gates**

Run: `npm test && npm run build && npm run lint`
Expected: all tests pass (existing 34 + the new map/repos/sync cases), build succeeds, lint reports no **errors** (pre-existing warnings in `PCSheet`/`StatBlock`/`ddb` are fine).

- [ ] **Step 2: Browser smoke — regression + feature**

Start the dev server via the preview tooling (not raw `npm run dev`). Against the local dev DB:
1. Dashboard `/` renders with a **Locations** count (regression check: the locations list shape change didn't break the count — it should show 198 if the world locations are seeded, else the real number).
2. Open the map marker dialog (`/world` or a map), choose marker type **Location** → the picker still lists locations (confirms `MarkerFormDialog`'s defensive read).
3. `/locations` list renders; if any archived locations exist, the "Show archived (N)" toggle appears and works.
4. Open a location detail page → if it has synced Notion data, the **Notion properties** meta-table (Type/Status/Region) and any linked characters appear.
5. Settings → Notion Sync shows a **4th "Locations"** input.
6. Console + server logs clean.

- [ ] **Step 3: (Optional, needs real Notion) live sync**

If a `notion_token` is configured and the Locations DB is shared with the integration: paste the Locations DB URL, Sync now, and confirm the toast reports locations counts and same-named locations were adopted (not duplicated).

- [ ] **Step 4: Commit any fixes**

```bash
git add -A && git commit -m "fix: address issues found in locations sync smoke test"
```
(Skip if nothing needed fixing.)

---

## Self-review notes

- **Spec coverage:** `mapLocationRow` w/ description-if-nonempty + Type/Status/Region→props + Notable NPCs + no-type-write (Task 2) · archived + full sync columns on locations (Task 1) · adopt-enriches-without-clobber + new→'other' + archival parity (Tasks 3–4, engine reuse) · sync order factions→characters→locations→items + NPC linking (Task 4) · config surfaces (Task 5) · detail meta-table via API notionProps (Task 6, UI free) · list archived parity + all consumers (Task 7) · verification incl. shape-change regressions (Task 8).
- **Shape-change consumers (Task 7):** `app/page.tsx`, `CharacterFormDialog.tsx` updated; `SimpleEntityManager` flipped; `MarkerFormDialog` already defensive; `/api/locations/[id]` (detail) unaffected. Verified by the Step-5 grep.
- **Deferred per spec (no task):** Item→Found-In / Faction→Headquarters (need new join tables); Notion Type/Status→hub columns; char-side Location relation.
