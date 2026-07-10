import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import os from "os";
import path from "path";
import crypto from "crypto";
import * as schema from "@/lib/db/schema";
import { runMigrations } from "@/lib/db/migrate";

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/** Fresh migrated SQLite file + drizzle instance for a single test. */
export function createTestDb(): { db: TestDb; campaignId: string } {
  const file = path.join(os.tmpdir(), `notion-sync-${crypto.randomUUID()}.db`);
  process.env.DB_PATH = file; // runMigrations() reads DB_PATH at call time
  runMigrations();

  const sqlite = new Database(file);
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });

  const campaignId = crypto.randomUUID();
  sqlite
    .prepare("INSERT INTO campaigns (id, name, created_at) VALUES (?, ?, ?)")
    .run(campaignId, "Test Campaign", Math.floor(Date.now() / 1000));

  return { db, campaignId };
}
