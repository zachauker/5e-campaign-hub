import Database from "better-sqlite3";
import path from "path";
import { loadVec } from "@/lib/db/load-vec";
import { runMigrations } from "@/lib/db/migrate";
import { ingestSrd } from "@/lib/reference/ingest";

async function main() {
  runMigrations();
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "encounter-tracker.db");
  const sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");
  if (!loadVec(sqlite)) { console.error("sqlite-vec failed to load"); process.exit(1); }
  const res = await ingestSrd(sqlite, { onProgress: (d, t) => console.log(`  embedded ${d}/${t}`) });
  console.log(`Ingested SRD 5.1 — ${res.chunkCount} chunks.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
