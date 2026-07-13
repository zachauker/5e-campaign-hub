import type DatabaseType from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { referenceCollections, referenceChunks } from "@/lib/db/schema";
import { chunkText, type Chunk } from "@/lib/reference/chunk";
import { embed as realEmbed, EMBED_DIMS } from "@/lib/reference/embed";
import type { Embedder } from "@/lib/reference/retrieve";

export type { Embedder };

interface TextItemLike { str?: string }

/** Extract text (+ per-page citation for PDFs) from a file. */
async function extractFile(file: string): Promise<{ text: string; pageOf?: (i: number) => number | null; sourceLabel: string }> {
  const ext = path.extname(file).toLowerCase();
  const label = path.basename(file, ext);
  if (ext === ".pdf") {
    const { createRequire } = await import("module");
    const requireFn = createRequire(import.meta.url);
    const pdfjsDir = path.resolve(path.dirname(requireFn.resolve("pdfjs-dist/legacy/build/pdf.mjs")), "..", "..");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(fs.readFileSync(file));
    const doc = await pdfjs.getDocument({
      data,
      standardFontDataUrl: path.join(pdfjsDir, "standard_fonts") + path.sep,
      cMapUrl: path.join(pdfjsDir, "cmaps") + path.sep,
      cMapPacked: true,
      useSystemFonts: false,
      verbosity: 0,
    }).promise;
    let text = "";
    const pageBoundaries: { index: number; page: number }[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      pageBoundaries.push({ index: text.length, page: p });
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      text += content.items.map((it) => (it as TextItemLike).str ?? "").join(" ") + "\n";
    }
    const pageOf = (i: number) => { let cur = 1; for (const b of pageBoundaries) if (b.index <= i) cur = b.page; else break; return cur; };
    return { text, pageOf, sourceLabel: label };
  }
  return { text: fs.readFileSync(file, "utf8"), sourceLabel: label };
}

export interface IngestOptions {
  collection: string;
  notes?: string | null;
  embed?: Embedder;
  onProgress?: (done: number, total: number) => void;
  // Provide exactly one source: a file path, or pre-supplied text + a citation label.
  filePath?: string;
  text?: string;
  sourceLabel?: string;
}

export interface IngestResult { collectionId: string; chunkCount: number }

/** parse/use text -> chunk -> embed -> atomic store. `sqlite` must have vec loaded. */
export async function ingestSource(sqlite: DatabaseType.Database, opts: IngestOptions): Promise<IngestResult> {
  const embed = opts.embed ?? realEmbed;
  const db = drizzle(sqlite, { schema });

  let text: string, pageOf: ((i: number) => number | null) | undefined, sourceLabel: string, sourceType: "pdf" | "text";
  if (opts.filePath) {
    const ex = await extractFile(opts.filePath);
    text = ex.text; pageOf = ex.pageOf;
    sourceLabel = ex.sourceLabel;
    sourceType = path.extname(opts.filePath).toLowerCase() === ".pdf" ? "pdf" : "text";
  } else {
    text = opts.text ?? "";
    sourceLabel = opts.sourceLabel ?? opts.collection;
    sourceType = "text";
  }

  const chunks: Chunk[] = chunkText(text, { sourceLabel, pageOf });
  if (chunks.length === 0) throw new Error("No text extracted — nothing to ingest.");

  const embeddings: number[][] = [];
  const BATCH = 32;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const vecs = await embed(chunks.slice(i, i + BATCH).map((c) => c.content));
    embeddings.push(...vecs);
    opts.onProgress?.(Math.min(i + BATCH, chunks.length), chunks.length);
  }

  const existing = db.select().from(referenceCollections).where(eq(referenceCollections.name, opts.collection)).get();
  const collId = existing?.id ?? crypto.randomUUID();
  const tx = sqlite.transaction(() => {
    if (existing) {
      const oldIds = db.select({ id: referenceChunks.id }).from(referenceChunks).where(eq(referenceChunks.collectionId, existing.id)).all();
      for (const { id } of oldIds) sqlite.prepare("DELETE FROM vec_reference_chunks WHERE chunk_id = ?").run(id);
      db.delete(referenceCollections).where(eq(referenceCollections.id, existing.id)).run();
    }
    const notesToStore = opts.notes !== undefined ? opts.notes : (existing?.notes ?? null);
    db.insert(referenceCollections).values({ id: collId, name: opts.collection, sourceType, enabled: true, chunkCount: chunks.length, notes: notesToStore, createdAt: new Date() }).run();
    const chunkRows = chunks.map((c) => ({ id: crypto.randomUUID(), collectionId: collId, content: c.content, sourceRef: c.sourceRef, ordinal: c.ordinal, tokenCount: c.tokenCount }));
    for (const row of chunkRows) db.insert(referenceChunks).values(row).run();
    for (let i = 0; i < chunkRows.length; i++) {
      const emb = embeddings[i];
      if (emb.length !== EMBED_DIMS) throw new Error(`embedding dim ${emb.length} != ${EMBED_DIMS}`);
      sqlite.prepare("INSERT OR REPLACE INTO vec_reference_chunks(chunk_id, embedding) VALUES (?, ?)").run(chunkRows[i].id, JSON.stringify(emb));
    }
  });
  tx();
  return { collectionId: collId, chunkCount: chunks.length };
}

/** Ingest the baked SRD markdown (reference-data/srd/*.md, excluding README) as "SRD 5.1". */
export async function ingestSrd(sqlite: DatabaseType.Database, opts: { embed?: Embedder; onProgress?: (d: number, t: number) => void } = {}): Promise<IngestResult> {
  const dir = path.join(process.cwd(), "reference-data", "srd");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md") : [];
  if (files.length === 0) throw new Error("No SRD markdown found in reference-data/srd/.");
  const text = files.map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n\n");
  return ingestSource(sqlite, { collection: "SRD 5.1", text, sourceLabel: "SRD", embed: opts.embed, onProgress: opts.onProgress });
}
