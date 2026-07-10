import Database from "better-sqlite3";
import path from "path";

export function runMigrations() {
  const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "encounter-tracker.db");
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("foreign_keys = ON");

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS encounters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      round INTEGER NOT NULL DEFAULT 1,
      current_combatant_id TEXT,
      notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS combatants (
      id TEXT PRIMARY KEY,
      encounter_id TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      initiative REAL,
      initiative_bonus INTEGER NOT NULL DEFAULT 0,
      hp_current INTEGER NOT NULL DEFAULT 0,
      hp_max INTEGER NOT NULL DEFAULT 0,
      hp_temp INTEGER NOT NULL DEFAULT 0,
      ac INTEGER NOT NULL DEFAULT 10,
      speed INTEGER NOT NULL DEFAULT 30,
      conditions TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      is_concentrating INTEGER NOT NULL DEFAULT 0,
      is_visible INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      ddb_character_id TEXT,
      monster_slug TEXT,
      stat_block TEXT,
      avatar_url TEXT,
      player_name TEXT,
      color TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS monster_cache (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      cached_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS character_library (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_character_library_name ON character_library(name);
    CREATE INDEX IF NOT EXISTS idx_combatants_encounter ON combatants(encounter_id);
    CREATE INDEX IF NOT EXISTS idx_combatants_sort ON combatants(encounter_id, sort_order);

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      ddb_character_id TEXT,
      notion_url TEXT,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      notion_url TEXT,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      notion_url TEXT,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS factions (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      notion_url TEXT,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS character_factions (
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      faction_id TEXT NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
      PRIMARY KEY (character_id, faction_id)
    );

    CREATE TABLE IF NOT EXISTS character_locations (
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      PRIMARY KEY (character_id, location_id)
    );

    CREATE TABLE IF NOT EXISTS character_items (
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      PRIMARY KEY (character_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS notion_sources (
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      database_url TEXT NOT NULL,
      data_source_id TEXT,
      last_synced_at INTEGER,
      last_status TEXT,
      PRIMARY KEY (campaign_id, entity_type)
    );

    CREATE INDEX IF NOT EXISTS idx_characters_campaign ON characters(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_locations_campaign ON locations(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_items_campaign ON items(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_factions_campaign ON factions(campaign_id);

    CREATE TABLE IF NOT EXISTS maps (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      image_path TEXT NOT NULL,
      parent_map_id TEXT REFERENCES maps(id),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS map_markers (
      id TEXT PRIMARY KEY,
      map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
      x REAL NOT NULL,
      y REAL NOT NULL,
      type TEXT NOT NULL,
      entity_id TEXT,
      target_map_id TEXT REFERENCES maps(id),
      title TEXT,
      note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_maps_campaign ON maps(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_maps_parent ON maps(parent_map_id);
    CREATE INDEX IF NOT EXISTS idx_map_markers_map ON map_markers(map_id);
  `);

  // Additive migrations (idempotent ALTER TABLE)
  const addColumnIfMissing = (table: string, column: string, definition: string) => {
    const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };
  addColumnIfMissing("combatants", "ddb_character_data", "TEXT");
  addColumnIfMissing("combatants", "character_id", "TEXT");
  addColumnIfMissing("encounters", "campaign_id", "TEXT REFERENCES campaigns(id)");
  addColumnIfMissing("maps", "render_mode", "TEXT NOT NULL DEFAULT 'static'");
  addColumnIfMissing("maps", "width", "INTEGER");
  addColumnIfMissing("maps", "height", "INTEGER");
  addColumnIfMissing("maps", "max_zoom", "INTEGER");
  addColumnIfMissing("map_markers", "min_zoom", "INTEGER");
  addColumnIfMissing("locations", "type", "TEXT NOT NULL DEFAULT 'other'");
  for (const table of ["characters", "items", "factions", "locations"]) {
    addColumnIfMissing(table, "notion_page_id", "TEXT");
    addColumnIfMissing(table, "notion_props", "TEXT");
    addColumnIfMissing(table, "archived", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing(table, "notion_synced_at", "INTEGER");
  }

  // Sub-project 6 retired: drop the abandoned map_features table if a prior
  // version created it. The orphaned legacy world-map flag column on maps is
  // left in place (harmless; unread) because SQLite DROP COLUMN support is
  // version-dependent.
  sqlite.exec("DROP TABLE IF EXISTS map_features");

  // Ensure a default campaign exists and every encounter references one.
  const existingCampaign = sqlite.prepare("SELECT id FROM campaigns LIMIT 1").get() as
    | { id: string }
    | undefined;
  let defaultCampaignId = existingCampaign?.id;
  if (!defaultCampaignId) {
    const campaignNameRow = sqlite
      .prepare("SELECT value FROM settings WHERE key = 'campaign_name'")
      .get() as { value: string } | undefined;
    defaultCampaignId = crypto.randomUUID();
    sqlite
      .prepare("INSERT INTO campaigns (id, name, created_at) VALUES (?, ?, ?)")
      .run(
        defaultCampaignId,
        campaignNameRow?.value?.trim() || "My Campaign",
        Math.floor(Date.now() / 1000),
      );
  }
  sqlite
    .prepare("UPDATE encounters SET campaign_id = ? WHERE campaign_id IS NULL")
    .run(defaultCampaignId);

  sqlite.close();
}
