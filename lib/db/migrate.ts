import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "encounter-tracker.db");

export function runMigrations() {
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
  `);

  // Additive migrations (idempotent ALTER TABLE)
  const addColumnIfMissing = (table: string, column: string, definition: string) => {
    const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };
  addColumnIfMissing("combatants", "ddb_character_data", "TEXT");

  sqlite.close();
}
