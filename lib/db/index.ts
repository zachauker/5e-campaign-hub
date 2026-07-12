import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";
import * as schema from "./schema";
import { loadVec } from "./load-vec";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "encounter-tracker.db");

let _db: ReturnType<typeof drizzle> | null = null;

function getDB() {
  if (!_db) {
    const sqlite = new Database(DB_PATH);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("synchronous = NORMAL");
    sqlite.pragma("foreign_keys = ON");
    loadVec(sqlite);
    _db = drizzle(sqlite, { schema });
  }
  return _db;
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    return (getDB() as unknown as Record<string, unknown>)[prop as string];
  },
});

export { schema };
