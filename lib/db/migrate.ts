import Database from "better-sqlite3";
import path from "path";
import { loadVec } from "./load-vec";

export function runMigrations() {
  const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "encounter-tracker.db");
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("foreign_keys = ON");
  loadVec(sqlite);

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

    CREATE TABLE IF NOT EXISTS session_notes (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      notion_url TEXT,
      notion_page_id TEXT,
      notion_props TEXT,
      note_type TEXT,
      status TEXT,
      date TEXT,
      arc TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      notion_synced_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_note_locations (
      session_note_id TEXT NOT NULL REFERENCES session_notes(id) ON DELETE CASCADE,
      location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      PRIMARY KEY (session_note_id, location_id)
    );

    CREATE INDEX IF NOT EXISTS idx_session_notes_campaign ON session_notes(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_session_notes_date ON session_notes(date);

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

    CREATE TABLE IF NOT EXISTS reference_collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
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

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      stakes TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      -- No REFERENCES: deleting the session note that opened/resolved this thread
      -- must not cascade away the thread's history. Ids may dangle.
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
      -- Polymorphic (its table depends on target_kind), so it cannot carry a
      -- single REFERENCES target. No FK by design. Ids may dangle.
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
      -- No REFERENCES: deleting a thread or clock must not cascade away
      -- timeline history. Ids may dangle.
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
  addColumnIfMissing("map_markers", "size", "TEXT");
  addColumnIfMissing("map_markers", "shape", "TEXT");
  addColumnIfMissing("map_markers", "icon", "TEXT");
  addColumnIfMissing("map_markers", "label_size", "TEXT");
  addColumnIfMissing("map_markers", "color", "TEXT");
  addColumnIfMissing("reference_collections", "notes", "TEXT");
  // in_world_day is an absolute integer day number (not a timestamp) rendered
  // by lib/calendar/exandria.ts.
  addColumnIfMissing("campaigns", "in_world_day", "INTEGER");
  addColumnIfMissing("campaigns", "calendar_epoch_label", "TEXT");
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
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_session_marks_run
      ON session_marks (run_session_id, at_ms);
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

  // Vector table for reference search — requires sqlite-vec (loaded above).
  try {
    sqlite.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_reference_chunks USING vec0(
      chunk_id TEXT PRIMARY KEY,
      embedding float[384]
    );`);
  } catch (err) {
    console.warn("[migrate] sqlite-vec unavailable — reference search disabled:", (err as Error).message);
  }

  sqlite.close();
}
