# Seed Exandria Locations From World Data — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A re-runnable Node seed script that turns the ~198 named point features in the Exandria world data into `locations` entities plus entity-linked `/world` markers for a chosen campaign.

**Architecture:** One self-contained CommonJS script, `scripts/world/seed-locations.js`, following the existing `scripts/world/*.js` convention (plain `node`, `require`, no TypeScript imports). It opens the app's SQLite DB directly with `better-sqlite3` (honoring `DB_PATH`), reads the six point-geometry GeoJSON files, normalizes + dedupes them into location records, and idempotently upserts `locations` rows + `map_markers` pins keyed on `(campaign, lower(name))`.

**Tech Stack:** Node (CommonJS), `better-sqlite3` (already a dependency), the open-source-exandria GeoJSON under `world-data/src/`. No test framework exists — "tests" are inline `node -e` assertions plus run-and-verify against the DB and browser.

---

## Context every task needs

- **Run all commands from the worktree root:** `/Users/zacharyauker/Development/encounter-tracker/.claude/worktrees/vigorous-hypatia-e1eb00`.
- **No test framework** (established convention). Verify with `node -e` assertions, SQL queries, and the browser preview.
- **Ground-truth facts already established** (don't re-derive):
  - Existing world scripts are **CommonJS**: `const fs = require("fs")`, run via `node scripts/world/<name>.js`. Match that style.
  - `generateId()` in the app is just `crypto.randomUUID()` — the script uses `require("node:crypto").randomUUID()`.
  - The DB path is `process.env.DB_PATH || path.join(process.cwd(), "encounter-tracker.db")` (mirror `lib/db/index.ts`). The file `encounter-tracker.db` exists in the worktree.
  - Integer timestamp columns store **Unix seconds** (verified: `1783286039` → 2026-07-05). Write `Math.floor(Date.now()/1000)`, NOT milliseconds.
  - Table columns:
    - `locations`: `id, campaign_id, name, notion_url, description, created_at, updated_at`
    - `maps`: `id, campaign_id, name, image_path, parent_map_id, render_mode, created_at, updated_at` (+ width/height/max_zoom nullable, + orphan `is_world_map`)
    - `map_markers`: `id, map_id, x, y, type, entity_id, target_map_id, title, note, created_at, updated_at, min_zoom`
  - World-map record per campaign = a `maps` row with `render_mode = 'world'`; created lazily as `{ name: "Exandria", image_path: "world", parent_map_id: null }` (mirrors `app/api/world/route.ts`).
  - Test campaign present: `My Campaign` = `0ab354d6-dd08-41a3-9987-fe876f768b51`.
  - Source files (all `Point` geometry, EPSG:4326 lng/lat) under `world-data/src/`: `{wildemount,taldorei}_cities.geojson` (75 total), `{wildemount,taldorei}_pois.geojson` (40), `{wildemount,taldorei}_label_points.geojson` (106 points → 83 distinct names; 15 names are multi-point).
  - Property shapes: cities `{Name, Type, Population, Info, Organizations?}`; pois `{Name, Type, Info}`; label_points `{Name|name, type}` where `type` is a style code (`big_ocean`, `sm_mountain`, `landscape_big`, …).
  - Expected post-dedupe total: **198 locations** (75 cities + 40 pois + 83 regions).

---

## File structure

- **Create:** `scripts/world/seed-locations.js` — the entire deliverable. One file, three responsibilities kept as separate functions: (1) pure normalization helpers (`readableRegionKind`, `composeDescription`, `loadRecords`, `dedupe`), (2) DB upsert (`seed`), (3) CLI entrypoint (`main`, guarded by `require.main === module` so the helpers are unit-testable via `require`).
- **Modify:** `world-data/README.md` — add a short "Seeding locations" note (Task 3).

No app/runtime code changes; no schema changes; no new dependencies.

---

## Task 1: Pure normalization + CLI scaffold (dry-run)

Build everything except the DB writes: argument parsing, source-file guard, feature loading, description composition, region-kind mapping, name dedupe with centroid, campaign existence check, and a `--dry-run` that prints counts and exits without writing.

**Files:**
- Create: `scripts/world/seed-locations.js`

- [ ] **Step 1: Write the script (pure logic + dry-run scaffold)**

Create `scripts/world/seed-locations.js` with exactly:

```js
#!/usr/bin/env node
/* Seeds a campaign's `locations` table (and entity-linked /world markers) from the
   open-source-exandria point GeoJSON in world-data/src/. Idempotent: keyed on
   (campaign, lower(name)), safe to re-run. Usage:
     node scripts/world/seed-locations.js <campaignId> [--dry-run]
   Honors DB_PATH (default ./encounter-tracker.db), matching lib/db/index.ts. */
const fs = require("fs");
const path = require("path");
const crypto = require("node:crypto");
const Database = require("better-sqlite3");

const SRC = path.join("world-data", "src");

// Source point layers, both continents.
const LAYERS = [
  { file: "wildemount_cities.geojson", category: "city", continent: "Wildemount" },
  { file: "taldorei_cities.geojson", category: "city", continent: "Tal'Dorei" },
  { file: "wildemount_pois.geojson", category: "poi", continent: "Wildemount" },
  { file: "taldorei_pois.geojson", category: "poi", continent: "Tal'Dorei" },
  { file: "wildemount_label_points.geojson", category: "region", continent: "Wildemount" },
  { file: "taldorei_label_points.geojson", category: "region", continent: "Tal'Dorei" },
];

// Marker reveal zoom per category (mirrors the base style: POIs appear at z>=7).
// null = always visible.
const MIN_ZOOM = { city: null, poi: 7, region: 5 };

// city > poi > region when the same name appears in more than one layer.
const CAT_RANK = { city: 0, poi: 1, region: 2 };

// Map a raw label-point style code to a human-readable region kind.
function readableRegionKind(type) {
  const t = String(type || "").toLowerCase();
  if (/ocean|water|reef/.test(t)) return "Waters";
  if (/mountain/.test(t)) return "Mountains";
  if (/forest|vermaloc/.test(t)) return "Forest";
  if (/swamp/.test(t)) return "Swamp";
  if (/snow/.test(t)) return "Snowlands";
  if (/ash/.test(t)) return "Ashlands";
  if (/landscape/.test(t)) return "Landmark";
  return "Region";
}

// Build the freetext description that folds category/population/lore into one field.
function composeDescription(category, continent, props) {
  if (category === "city") {
    const bits = [props.Type || "Settlement", continent];
    if (props.Population) bits.push(`Population ${props.Population}`);
    let d = bits.join(" · ");
    if (props.Info) d += `\n\n${props.Info}`;
    if (props.Organizations) d += `\n\nOrganizations: ${props.Organizations}`;
    return d;
  }
  if (category === "poi") {
    let d = `Point of Interest (${props.Type || "Landmark"}) · ${continent}`;
    if (props.Info) d += `\n\n${props.Info}`;
    return d;
  }
  return `Region — ${readableRegionKind(props.type)} · ${continent}`;
}

function featureName(props) {
  const n = props.Name || props.name;
  return typeof n === "string" && n.trim() ? n.trim() : null;
}

// Read every layer into flat records. Skips non-Point / unnamed features.
function loadRecords() {
  const raw = [];
  for (const layer of LAYERS) {
    const gj = JSON.parse(fs.readFileSync(path.join(SRC, layer.file), "utf8"));
    for (const ft of gj.features || []) {
      if (!ft.geometry || ft.geometry.type !== "Point") continue;
      const name = featureName(ft.properties || {});
      if (!name) continue;
      raw.push({
        name,
        key: name.toLowerCase(),
        lng: ft.geometry.coordinates[0],
        lat: ft.geometry.coordinates[1],
        category: layer.category,
        continent: layer.continent,
        description: composeDescription(layer.category, layer.continent, ft.properties || {}),
        minZoom: MIN_ZOOM[layer.category],
      });
    }
  }
  return raw;
}

// Collapse duplicate names. Higher-priority category wins metadata + position;
// same-category duplicates (multi-point region labels) average to a centroid.
function dedupe(raw) {
  const byKey = new Map();
  for (const r of raw) {
    const cur = byKey.get(r.key);
    if (!cur) {
      byKey.set(r.key, { ...r, _pts: [[r.lng, r.lat]] });
      continue;
    }
    const rank = CAT_RANK[r.category];
    const curRank = CAT_RANK[cur.category];
    if (rank < curRank) {
      byKey.set(r.key, { ...r, _pts: [[r.lng, r.lat]] });
    } else if (rank === curRank) {
      cur._pts.push([r.lng, r.lat]);
    }
    // lower priority: ignore
  }
  const out = [];
  for (const r of byKey.values()) {
    const n = r._pts.length;
    const lng = r._pts.reduce((s, p) => s + p[0], 0) / n;
    const lat = r._pts.reduce((s, p) => s + p[1], 0) / n;
    out.push({
      name: r.name,
      key: r.key,
      lng,
      lat,
      category: r.category,
      continent: r.continent,
      description: r.description,
      minZoom: r.minZoom,
    });
  }
  return out;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function openDb() {
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "encounter-tracker.db");
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  return db;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const campaignId = args.find((a) => !a.startsWith("--"));
  if (!campaignId) {
    console.error("Usage: node scripts/world/seed-locations.js <campaignId> [--dry-run]");
    process.exit(1);
  }

  const missing = LAYERS.map((l) => path.join(SRC, l.file)).filter((p) => !fs.existsSync(p));
  if (missing.length) {
    console.error("Missing source GeoJSON (run scripts/world/fetch-geojson.sh first):");
    for (const p of missing) console.error("  " + p);
    process.exit(1);
  }

  const records = dedupe(loadRecords());
  const counts = records.reduce((m, r) => ((m[r.category] = (m[r.category] || 0) + 1), m), {});
  console.log(
    `Loaded ${records.length} locations (cities ${counts.city || 0}, pois ${counts.poi || 0}, regions ${counts.region || 0}).`
  );

  const db = openDb();
  const campaign = db.prepare("SELECT id FROM campaigns WHERE id = ?").get(campaignId);
  if (!campaign) {
    const all = db.prepare("SELECT id, name FROM campaigns").all();
    console.error(`Unknown campaign "${campaignId}". Available:`);
    if (all.length === 0) console.error("  (none)");
    for (const c of all) console.error(`  ${c.id}  ${c.name}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log("--dry-run: no changes written.");
    db.close();
    return;
  }

  seed(db, campaignId, records);
  db.close();
}

// Placeholder until Task 2 fills it in; keeps main() runnable in dry-run.
function seed() {
  throw new Error("seed() not implemented yet");
}

module.exports = { readableRegionKind, composeDescription, loadRecords, dedupe };

if (require.main === module) main();
```

- [ ] **Step 2: Verify the pure helpers with inline assertions**

Run:
```bash
node -e '
const s = require("./scripts/world/seed-locations.js");
const assert = require("assert");
assert.strictEqual(s.readableRegionKind("big_mountain"), "Mountains");
assert.strictEqual(s.readableRegionKind("sm_water"), "Waters");
assert.strictEqual(s.readableRegionKind("big_reef"), "Waters");
assert.strictEqual(s.readableRegionKind("big_vermaloc"), "Forest");
assert.strictEqual(s.readableRegionKind("landscape_big"), "Landmark");
assert.strictEqual(s.readableRegionKind("weird_unknown"), "Region");
assert.strictEqual(s.composeDescription("city","Wildemount",{Type:"City",Population:"15,110",Info:"A port."}), "City · Wildemount · Population 15,110\n\nA port.");
assert.strictEqual(s.composeDescription("region","Tal'Dorei",{type:"big_snow"}), "Region — Snowlands · Tal'Dorei");
// dedupe: two region points with the same name average to their centroid
const d = s.dedupe([
  {name:"Lake",key:"lake",lng:0,lat:0,category:"region",continent:"Wildemount",description:"x",minZoom:5},
  {name:"Lake",key:"lake",lng:2,lat:4,category:"region",continent:"Wildemount",description:"x",minZoom:5},
]);
assert.strictEqual(d.length, 1);
assert.strictEqual(d[0].lng, 1); assert.strictEqual(d[0].lat, 2);
// city beats region for the same name, and takes the city position
const d2 = s.dedupe([
  {name:"Zed",key:"zed",lng:9,lat:9,category:"region",continent:"Wildemount",description:"r",minZoom:5},
  {name:"Zed",key:"zed",lng:1,lat:1,category:"city",continent:"Wildemount",description:"c",minZoom:null},
]);
assert.strictEqual(d2[0].category,"city"); assert.strictEqual(d2[0].lng,1); assert.strictEqual(d2[0].description,"c");
// full load+dedupe yields the expected census
const all = s.dedupe(s.loadRecords());
const c = all.reduce((m,r)=>((m[r.category]=(m[r.category]||0)+1),m),{});
assert.strictEqual(c.city,75); assert.strictEqual(c.poi,40); assert.strictEqual(c.region,83);
assert.strictEqual(all.length,198);
console.log("OK: helpers + census (198 =", c, ")");
'
```
Expected: prints `OK: helpers + census (198 = { city: 75, region: 83, poi: 40 })` (key order may vary), no assertion error.

- [ ] **Step 3: Verify dry-run + campaign guard**

Run: `node scripts/world/seed-locations.js 0ab354d6-dd08-41a3-9987-fe876f768b51 --dry-run`
Expected: prints `Loaded 198 locations (cities 75, pois 40, regions 83).` then `--dry-run: no changes written.`

Run: `node scripts/world/seed-locations.js not-a-real-campaign --dry-run; echo "exit=$?"`
Expected: prints `Unknown campaign "not-a-real-campaign". Available:` followed by the `My Campaign` line, and `exit=1`.

- [ ] **Step 4: Commit**

```bash
git add scripts/world/seed-locations.js
git commit -m "feat: seed-locations script — load, normalize, dedupe (dry-run)"
```

---

## Task 2: DB upsert (get-or-create world map + idempotent locations & markers)

Replace the placeholder `seed()` with the real write logic: get-or-create the campaign's world map, then upsert one `locations` row and one entity-linked `map_markers` pin per record, skipping anything that already exists.

**Files:**
- Modify: `scripts/world/seed-locations.js`

- [ ] **Step 1: Replace the placeholder `seed()`**

In `scripts/world/seed-locations.js`, replace this exact block:

```js
// Placeholder until Task 2 fills it in; keeps main() runnable in dry-run.
function seed() {
  throw new Error("seed() not implemented yet");
}
```

with:

```js
// Upsert locations + entity-linked world markers. Idempotent on (campaign, lower(name))
// for locations and on (worldMapId, entity_id) for markers.
function seed(db, campaignId, records) {
  let world = db
    .prepare("SELECT id FROM maps WHERE campaign_id = ? AND render_mode = 'world'")
    .get(campaignId);
  if (!world) {
    const id = crypto.randomUUID();
    const t = nowSec();
    db.prepare(
      "INSERT INTO maps (id, campaign_id, name, image_path, parent_map_id, render_mode, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)"
    ).run(id, campaignId, "Exandria", "world", null, "world", t, t);
    world = { id };
    console.log(`Created world map ${id}.`);
  }
  const worldMapId = world.id;

  const findLoc = db.prepare("SELECT id FROM locations WHERE campaign_id = ? AND lower(name) = ?");
  const insLoc = db.prepare(
    "INSERT INTO locations (id, campaign_id, name, notion_url, description, created_at, updated_at) VALUES (?,?,?,?,?,?,?)"
  );
  const findMarker = db.prepare(
    "SELECT id FROM map_markers WHERE map_id = ? AND type = 'location' AND entity_id = ?"
  );
  const insMarker = db.prepare(
    "INSERT INTO map_markers (id, map_id, x, y, type, entity_id, target_map_id, title, note, min_zoom, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
  );

  let locCreated = 0;
  let locSkipped = 0;
  let mkCreated = 0;
  let mkSkipped = 0;

  const run = db.transaction((recs) => {
    for (const r of recs) {
      const existingLoc = findLoc.get(campaignId, r.key);
      let locId;
      if (existingLoc) {
        locId = existingLoc.id;
        locSkipped++;
      } else {
        locId = crypto.randomUUID();
        const t = nowSec();
        insLoc.run(locId, campaignId, r.name, null, r.description, t, t);
        locCreated++;
      }
      if (findMarker.get(worldMapId, locId)) {
        mkSkipped++;
      } else {
        const t = nowSec();
        insMarker.run(
          crypto.randomUUID(),
          worldMapId,
          r.lng,
          r.lat,
          "location",
          locId,
          null,
          r.name,
          null,
          r.minZoom,
          t,
          t
        );
        mkCreated++;
      }
    }
  });
  run(records);

  console.log(`Locations: ${locCreated} created, ${locSkipped} existing.`);
  console.log(`Markers:   ${mkCreated} created, ${mkSkipped} existing.`);
}
```

- [ ] **Step 2: Run the seed for real against the test campaign**

Run: `node scripts/world/seed-locations.js 0ab354d6-dd08-41a3-9987-fe876f768b51`
Expected output (world map may already exist from earlier manual testing, so the "Created world map" line is optional):
```
Loaded 198 locations (cities 75, pois 40, regions 83).
Locations: 198 created, 0 existing.
Markers:   198 created, 0 existing.
```
(If some locations pre-existed from manual testing, the created/existing split differs but `created + existing` must equal 198.)

- [ ] **Step 3: Verify the writes with SQL**

Run:
```bash
node -e '
const D=require("better-sqlite3");const db=new D("encounter-tracker.db",{readonly:true});
const cid="0ab354d6-dd08-41a3-9987-fe876f768b51";
const world=db.prepare("SELECT id FROM maps WHERE campaign_id=? AND render_mode='world'").get(cid);
const locs=db.prepare("SELECT COUNT(*) n FROM locations WHERE campaign_id=?").get(cid).n;
const mks=db.prepare("SELECT COUNT(*) n FROM map_markers WHERE map_id=? AND type='location' AND entity_id IS NOT NULL").get(world.id).n;
const linked=db.prepare("SELECT COUNT(*) n FROM map_markers mk JOIN locations l ON l.id=mk.entity_id WHERE mk.map_id=?").get(world.id).n;
const zoomTiers=db.prepare("SELECT min_zoom, COUNT(*) n FROM map_markers WHERE map_id=? GROUP BY min_zoom ORDER BY min_zoom").all(world.id);
const sample=db.prepare("SELECT name, substr(description,1,40) d FROM locations WHERE campaign_id=? AND name IN ('Rexxentrum','Emon') ").all(cid);
console.log("locations:",locs," location-markers:",mks," markers->location join:",linked);
console.log("min_zoom tiers:",JSON.stringify(zoomTiers));
console.log("samples:",JSON.stringify(sample));
'
```
Expected: `locations: 198`, `location-markers: 198`, the join count equals 198 (every marker resolves to a real location), the `min_zoom tiers` show three buckets (`null` = 75 cities, `5` = 83 regions, `7` = 40 pois), and the samples show Rexxentrum/Emon with a composed description beginning with their type.

- [ ] **Step 4: Commit**

```bash
git add scripts/world/seed-locations.js
git commit -m "feat: seed-locations DB upsert — world map, locations, linked markers"
```

---

## Task 3: Idempotency + end-to-end verification + docs

Prove re-running is a no-op, verify the round-trip in the browser (pins + the sub-project-7 back-link), and document the script.

**Files:**
- Modify: `world-data/README.md`

- [ ] **Step 1: Re-run and confirm idempotency**

Run: `node scripts/world/seed-locations.js 0ab354d6-dd08-41a3-9987-fe876f768b51`
Expected:
```
Loaded 198 locations (cities 75, pois 40, regions 83).
Locations: 0 created, 198 existing.
Markers:   0 created, 198 existing.
```
Then re-check the counts (locations still 198, markers still 198 — no duplicates):
```bash
node -e '
const D=require("better-sqlite3");const db=new D("encounter-tracker.db",{readonly:true});
const cid="0ab354d6-dd08-41a3-9987-fe876f768b51";
console.log("locations:",db.prepare("SELECT COUNT(*) n FROM locations WHERE campaign_id=?").get(cid).n);
const w=db.prepare("SELECT id FROM maps WHERE campaign_id=? AND render_mode='world'").get(cid);
console.log("markers:",db.prepare("SELECT COUNT(*) n FROM map_markers WHERE map_id=? AND type='location'").get(w.id).n);
'
```
Expected: `locations: 198`, `markers: 198` (unchanged from Task 2).

- [ ] **Step 2: Browser round-trip check**

Ensure the dev server is running (preview tooling), then:
1. Load `/locations` — confirm the list now contains canonical Exandria places (e.g. Rexxentrum, Emon, Zadash). Open one city — its detail page shows the composed description (type · continent · population · lore).
2. Load `/world` — confirm entity pins render on the map (cities at overview; zoom to ~7 to see POI pins appear). Click a pin — its info card opens.
3. From a city's detail page, click its "View on Map" / "On the Map" link — confirm it navigates to `/world#marker-<id>` and the pin is auto-selected on arrival (this exercises the sub-project-7 back-link fix end-to-end).

Report what you observe; if any step fails, diagnose before proceeding.

- [ ] **Step 3: Document the script in the world-data README**

In `world-data/README.md`, add this section immediately before the `## Reproducibility` heading:

```markdown
## Seeding location entities (optional)

`scripts/world/seed-locations.js` turns the named point features (cities, POIs,
region labels) into `locations` rows for a campaign, each with an entity-linked
pin on that campaign's `/world` map. Run per campaign:

    node scripts/world/seed-locations.js <campaignId>

It is idempotent (keyed on campaign + lower(name)), so re-running never
duplicates. Requires the source GeoJSON (`scripts/world/fetch-geojson.sh`) and
honors `DB_PATH` (default `./encounter-tracker.db`). Category and population are
folded into each location's `description` (the `locations` table has no `type`
column). Add `--dry-run` to preview counts without writing.
```

- [ ] **Step 4: Commit**

```bash
git add world-data/README.md
git commit -m "docs: document seed-locations script in world-data README"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** Import 75 cities + 40 pois + 83 regions → Task 1 (load/dedupe, census asserts 198) + Task 2 (upsert). Entity-linked pins with minZoom tiers → Task 2 `seed()` + Task 2 Step 3 zoom-tier check. Idempotent one-time script keyed on (campaign, name) → Task 2 `findLoc`/`findMarker` + Task 3 Step 1. Get-or-create world map → Task 2 `seed()`. Field mapping into `description` (no schema change) → `composeDescription` (Task 1). Dedupe multi-point regions to centroid → `dedupe` (Task 1) + assertion. Campaign/source-file guards → `main` (Task 1) + Task 1 Step 3. Verification (counts, /world, back-link, re-run) → Task 2 Step 3 + Task 3. All spec sections covered.
- **Placeholder scan:** The literal `function seed() { throw ... }` in Task 1 is an intentional, runnable stub (dry-run never calls it) that Task 2 replaces via an exact find/replace — not a plan placeholder. Every code step is complete; no "TBD"/"add error handling"/"similar to Task N".
- **Type/name consistency:** `readableRegionKind`, `composeDescription`, `loadRecords`, `dedupe`, `seed`, `openDb`, `nowSec`, `MIN_ZOOM`, `CAT_RANK`, `LAYERS`, `SRC` are defined once and referenced consistently. Record shape `{name, key, lng, lat, category, continent, description, minZoom}` is identical across `loadRecords`, `dedupe`, and `seed`. Column lists in the INSERTs match the verified table schemas (seconds timestamps, `min_zoom` last on markers). `module.exports` matches the names asserted in Task 1 Step 2.
