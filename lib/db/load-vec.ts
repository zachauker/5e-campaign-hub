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
