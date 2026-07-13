import Database from "better-sqlite3";
import path from "path";
import { loadVec } from "@/lib/db/load-vec";
import { runMigrations } from "@/lib/db/migrate";
import { ingestSource } from "@/lib/reference/ingest";

async function main() {
  const [file, ...rest] = process.argv.slice(2);
  const flag = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  const collection = flag("--collection") ?? path.basename(file ?? "");
  const notes = rest.includes("--notes") ? (flag("--notes") ?? null) : undefined;
  const dryRun = rest.includes("--dry-run");
  if (!file) { console.error('usage: tsx scripts/reference/ingest.ts <file> --collection "<name>" [--notes "<context>"] [--dry-run]'); process.exit(1); }

  runMigrations();
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "encounter-tracker.db");
  const sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");
  if (!loadVec(sqlite)) { console.error("sqlite-vec failed to load"); process.exit(1); }

  if (dryRun) {
    console.log(`Dry run: would ingest "${file}" into collection "${collection}".`);
    return;
  }
  const res = await ingestSource(sqlite, { filePath: file, collection, notes, onProgress: (d, t) => console.log(`  embedded ${d}/${t}`) });
  console.log(`Ingested "${collection}" — ${res.chunkCount} chunks.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
