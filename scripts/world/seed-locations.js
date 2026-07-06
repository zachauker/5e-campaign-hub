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

// Coarse locations.type category from a source feature.
function deriveType(category, props) {
  if (category === "region") return "region";
  if (category === "poi") return "poi";
  const t = String(props.Type || "").toLowerCase();
  if (t === "metropolis" || t === "city") return "city";
  if (t === "ruins") return "poi";
  return "town";
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
        type: deriveType(layer.category, ft.properties || {}),
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
      type: r.type,
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
    "INSERT INTO locations (id, campaign_id, name, notion_url, description, type, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)"
  );
  const backfillType = db.prepare(
    "UPDATE locations SET type = ?, updated_at = ? WHERE id = ? AND (type IS NULL OR type = 'other')"
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
  let typeBackfilled = 0;

  const run = db.transaction((recs) => {
    for (const r of recs) {
      const existingLoc = findLoc.get(campaignId, r.key);
      let locId;
      if (existingLoc) {
        locId = existingLoc.id;
        locSkipped++;
        if (backfillType.run(r.type, nowSec(), locId).changes > 0) typeBackfilled++;
      } else {
        locId = crypto.randomUUID();
        const t = nowSec();
        insLoc.run(locId, campaignId, r.name, null, r.description, r.type, t, t);
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
  console.log(`Types:     ${typeBackfilled} backfilled on existing rows.`);
}

module.exports = { readableRegionKind, composeDescription, loadRecords, dedupe };

if (require.main === module) main();
