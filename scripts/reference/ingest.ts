import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import * as schema from "@/lib/db/schema";
import { referenceCollections, referenceChunks } from "@/lib/db/schema";
import { loadVec } from "@/lib/db/load-vec";
import { runMigrations } from "@/lib/db/migrate";
import { chunkText, type Chunk } from "@/lib/reference/chunk";
import { embed, EMBED_DIMS } from "@/lib/reference/embed";
import { eq } from "drizzle-orm";

interface TextItemLike { str?: string }

async function extract(file: string): Promise<{ text: string; pageOf?: (i: number) => number | null; sourceLabel: string }> {
  const ext = path.extname(file).toLowerCase();
  const label = path.basename(file, ext);
  if (ext === ".pdf") {
    const { createRequire } = await import("module");
    const requireFn = createRequire(import.meta.url);
    // pdfjs bundles the standard 14 PDF fonts + CMaps as files it loads on demand.
    // Without pointing it at them it warns once per glyph ("standardFontDataUrl ...")
    // and extracts degraded text. Resolve them relative to the installed package.
    const pdfjsDir = path.resolve(path.dirname(requireFn.resolve("pdfjs-dist/legacy/build/pdf.mjs")), "..", "..");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(fs.readFileSync(file));
    const doc = await pdfjs.getDocument({
      data,
      standardFontDataUrl: path.join(pdfjsDir, "standard_fonts") + path.sep,
      cMapUrl: path.join(pdfjsDir, "cmaps") + path.sep,
      cMapPacked: true,
      useSystemFonts: false,
      verbosity: 0, // errors only — silence the per-glyph font warnings
    }).promise;
    let text = "";
    const pageBoundaries: { index: number; page: number }[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      pageBoundaries.push({ index: text.length, page: p });
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      text += content.items.map((it) => (it as TextItemLike).str ?? "").join(" ") + "\n";
    }
    const pageOf = (i: number) => {
      let cur = 1;
      for (const b of pageBoundaries) if (b.index <= i) cur = b.page; else break;
      return cur;
    };
    return { text, pageOf, sourceLabel: label };
  }
  return { text: fs.readFileSync(file, "utf8"), sourceLabel: label };
}

async function main() {
  const [file, ...rest] = process.argv.slice(2);
  const collFlag = rest.indexOf("--collection");
  const name = collFlag >= 0 ? rest[collFlag + 1] : path.basename(file ?? "");
  const labelFlag = rest.indexOf("--label");
  const labelOverride = labelFlag >= 0 ? rest[labelFlag + 1] : undefined;
  const notesFlag = rest.indexOf("--notes");
  const notes = notesFlag >= 0 ? rest[notesFlag + 1] ?? null : null;
  const replace = rest.includes("--replace");
  const dryRun = rest.includes("--dry-run");
  if (!file) { console.error("usage: tsx scripts/reference/ingest.ts <file> --collection \"<name>\" [--label \"<citation label>\"] [--notes \"<context for the assistant>\"] [--replace] [--dry-run]"); process.exit(1); }
  const sourceType = path.extname(file).toLowerCase() === ".pdf" ? "pdf" : "text";

  runMigrations();
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "encounter-tracker.db");
  const sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");
  if (!loadVec(sqlite)) { console.error("sqlite-vec failed to load"); process.exit(1); }
  const db = drizzle(sqlite, { schema });

  const existing = db.select().from(referenceCollections).where(eq(referenceCollections.name, name)).get();
  if (existing && !replace) { console.error(`Collection "${name}" exists. Pass --replace to overwrite.`); process.exit(1); }

  const { text, pageOf, sourceLabel: derivedLabel } = await extract(file);
  // --label overrides the filename-derived citation label (e.g. import-srd feeds a
  // temp ".srd-combined.md", which would otherwise cite as ".srd-combined: …").
  const sourceLabel = labelOverride ?? derivedLabel;
  const chunks: Chunk[] = chunkText(text, { sourceLabel, pageOf });
  if (chunks.length === 0) { console.error("No text extracted — nothing to ingest."); process.exit(1); }
  console.log(`Parsed ${chunks.length} chunks from ${file}.`);
  if (dryRun) { console.log(chunks.slice(0, 3)); return; }
  console.log("Embedding…");

  // Embed in batches to bound memory.
  const embeddings: number[][] = [];
  const BATCH = 32;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const vecs = await embed(chunks.slice(i, i + BATCH).map((c) => c.content));
    embeddings.push(...vecs);
    console.log(`  embedded ${Math.min(i + BATCH, chunks.length)}/${chunks.length}`);
  }

  const collId = existing?.id ?? crypto.randomUUID();
  // Chunks AND their vectors must be written atomically: a crash between them
  // would leave a populated-looking collection with missing/partial vectors.
  // Embeddings are already computed, and the vec INSERTs are synchronous, so
  // they run inside the same synchronous transaction as the chunk rows.
  const tx = sqlite.transaction(() => {
    if (existing) {
      // cascade deletes chunks; also clear their vectors
      const oldIds = db.select({ id: referenceChunks.id }).from(referenceChunks).where(eq(referenceChunks.collectionId, existing.id)).all();
      for (const { id } of oldIds) sqlite.prepare("DELETE FROM vec_reference_chunks WHERE chunk_id = ?").run(id);
      db.delete(referenceCollections).where(eq(referenceCollections.id, existing.id)).run();
    }
    // On --replace without a new --notes, preserve the collection's existing note.
    const notesToStore = notes ?? existing?.notes ?? null;
    db.insert(referenceCollections).values({ id: collId, name, sourceType, enabled: true, chunkCount: chunks.length, notes: notesToStore, createdAt: new Date() }).run();
    const chunkRows = chunks.map((c) => ({ id: crypto.randomUUID(), collectionId: collId, content: c.content, sourceRef: c.sourceRef, ordinal: c.ordinal, tokenCount: c.tokenCount }));
    for (const row of chunkRows) db.insert(referenceChunks).values(row).run();
    for (let i = 0; i < chunkRows.length; i++) {
      const emb = embeddings[i];
      if (emb.length !== EMBED_DIMS) throw new Error(`embedding dim ${emb.length} != ${EMBED_DIMS}`);
      // vec0 virtual tables reject ON CONFLICT upsert; INSERT OR REPLACE works.
      sqlite.prepare("INSERT OR REPLACE INTO vec_reference_chunks(chunk_id, embedding) VALUES (?, ?)").run(chunkRows[i].id, JSON.stringify(emb));
    }
  });
  tx();
  console.log(`Ingested "${name}" — ${chunks.length} chunks.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
