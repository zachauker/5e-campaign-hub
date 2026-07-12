# Reference Library — Design Spec

**Date:** 2026-07-12
**Status:** Approved for planning
**Sub-project:** #13 of the campaign hub expansion (extends #12, the Campaign Assistant)

## Summary

A vetted, citable reference library the Campaign Assistant can consult for rules
and setting-lore questions. Source material (the open SRD, owned rulebook PDFs,
and the DM's own notes/homebrew) is ingested offline — parsed, chunked, and
embedded **locally** — into the existing SQLite DB via `sqlite-vec`. At chat
time the assistant calls a new `search_reference` tool that runs a local vector
search and returns top-K passages **with citations**, so answers stay grounded,
accurate, and sourced.

This makes the assistant able to answer "how does grappling work?" (from the SRD)
or "what's the deal with the Kryn Dynasty?" (from a loaded Wildemount source)
with a cited passage, instead of relying on the model's ungrounded parametric
knowledge.

## Goals

- Let the assistant answer rules/lore questions from **indexed sources with citations**.
- Keep everything **local**: parsing, embedding, and vector search run on the DM's
  server; owned/copyrighted book text never leaves the box.
- Reuse the existing assistant architecture — retrieval is one new agent tool.
- Add no new external service or API (no embeddings API, no separate vector DB).
- Support three source lanes: open SRD (bundled), owned PDFs (DM-supplied), and
  the DM's own notes/homebrew (PDF/Markdown/text).

## Non-goals (v1)

- In-app upload UI for ingestion (deferred; CLI script + SRD importer for v1).
- Web search (explicitly declined by the DM).
- Per-campaign scoping of the library (rules/lore are global; the app is single-DM).
- Hosted embeddings / cloud vector DB.
- Automatic re-ingestion or change detection — re-ingest is a manual `--replace`.

## Legal / sourcing posture

- **SRD 5.1 / 5.2** is openly licensed (OGL 1.0a / CC-BY-4.0). It ships in the repo
  as a committed, regenerable asset (`reference-data/srd/`) with its required
  attribution/license file alongside, and is ingested by `import-srd.js`. This is
  the only source bundled directly.
- **Owned copyrighted books** (PHB, Explorer's Guide to Wildemount, etc.) are
  **never committed or fetched** by this project. The DM drops their own files on
  their own server and runs the ingest script. This is a private, self-hosted,
  personal-use posture. Answers cite the DM's loaded copy (collection + page)
  rather than reproducing long passages.
- **DM's own material** — fully owned, no concern.

## Retrieval approach (decided)

**Agentic tool.** `search_reference(query, collection?)` is added to the existing
Tool Runner. The agent calls it only when it judges a question needs rules/lore;
it never fires for pure campaign questions. Rejected alternatives: always-retrieve
(wasteful, pollutes context on campaign questions) and a separate query router
(redundant — the model's tool-choice already routes).

## Architecture

```
INGEST (offline, on the server)
  scripts/reference/ingest.js <file> --collection "<name>" [--replace]
    parse (PDF via pdfjs-dist / md / txt) → chunk (~600 tok, heading-aware, ~80 overlap)
    → embed locally (transformers.js, Xenova/bge-small-en-v1.5, 384-dim)
    → store: reference_collections + reference_chunks + sqlite-vec, one transaction
  scripts/reference/import-srd.js → ingests committed reference-data/srd/ into "SRD 5.1"

QUERY (chat time)
  Agent decides a question needs rules/lore
    → search_reference(query, collection?)
        → embed query locally → KNN over ENABLED collections (sqlite-vec)
        → return top-K { content, sourceRef, collection, distance }
    → model answers, citing sourceRef

MANAGE
  Settings → "Reference Library": list collections, enable/disable, delete
```

### Principles

- **Fully local / private.** No text leaves the server; no new API key or service.
- **Retrieval only when relevant.** Campaign questions never touch the library.
- **Global, not campaign-scoped.** Collections have an `enabled` toggle instead.
- **Composable.** One answer can cite both campaign data and a rulebook.

## Storage schema

Two ordinary tables + one `sqlite-vec` virtual table, in the existing `/data` DB.

```
reference_collections
  id            text PK
  name          text UNIQUE        -- "SRD 5.1", "Wildemount", "My Homebrew"
  source_type   text               -- 'srd' | 'pdf' | 'text'
  enabled       integer(bool) default 1
  chunk_count   integer
  created_at    integer(timestamp)

reference_chunks
  id            text PK
  collection_id text FK -> reference_collections.id (ON DELETE CASCADE)
  content       text
  source_ref    text               -- citation label: "SRD: Grappling", "EGtW p.142"
  ordinal       integer            -- order within the source
  token_count   integer

vec_reference_chunks               -- sqlite-vec vec0 virtual table
  rowid ↔ reference_chunks (mapping), embedding float[384]
```

Retrieval: KNN on `vec_reference_chunks` → join to `reference_chunks` (content +
`source_ref`) → filter to `enabled` collections. Collection delete cascades chunks;
the vec rows are removed in the same transaction as their chunks.

## Components

- **`reference-data/srd/`** — committed SRD markdown corpus + `LICENSE`/attribution.
- **`reference-data/models/`** — committed local embedding model weights (ONNX, ~130MB), baked into the image.
- **`scripts/reference/ingest.js`** — parse → chunk → embed → store; `--collection`, `--replace`, `--dry-run`. CommonJS + direct `better-sqlite3` (matches `scripts/world/*`).
- **`scripts/reference/import-srd.js`** — ingests the bundled SRD corpus.
- **`lib/reference/chunk.ts`** — pure, structure-aware chunker; deterministic boundaries + citation labels. Unit-tested.
- **`lib/reference/embed.ts`** — wraps the transformers.js feature-extraction pipeline behind `embed(texts: string[]) => Promise<number[][]>`. Dependency-injectable for tests (stub embedder, no model load).
- **`lib/reference/retrieve.ts`** — `searchReference(db, { query, collection?, k })` → embed query, KNN over enabled collections, return cited passages.
- **`lib/db` init** — load the `sqlite-vec` extension (platform-correct binary) at singleton init.
- **`lib/assistant/tools.ts`** — add `search_reference` (11th tool).
- **`lib/assistant/agent.ts`** — one system-prompt line: consult `search_reference` for rules/lore and cite `sourceRef`; never invent a citation.
- **`app/api/reference/collections/route.ts`** (+ `[id]`) — GET list, PATCH enabled, DELETE collection.
- **`components/settings/ReferenceLibraryPanel.tsx`** — list collections (name, type, chunk_count), enable/disable toggle, delete.
- **`components/assistant/ChatPanel.tsx`** — render reference tool results as citation chips under the answer.

## Embedding model

`Xenova/bge-small-en-v1.5` via transformers.js (`@huggingface/transformers`),
mean-pooled + L2-normalized, 384-dim. Runs in Node on the ONNX runtime. Weights
baked into the image (`allowRemoteModels: false`, `localModelPath` →
`reference-data/models/`). Chosen for quality/size balance and 384-dim vectors.

## Chunking

Structure-aware recursive chunking: split on headings/paragraphs, pack to ~600
tokens with ~80-token overlap so a rule spanning a boundary stays retrievable.
Each chunk carries a citation label — PDF page number (from pdfjs-dist), or the
nearest markdown heading for md/txt/SRD.

## Citation UX

`search_reference` results carry `{ content, sourceRef, collection }`. The
assistant cites `sourceRef` inline, and ChatPanel renders the retrieved sources as
small chips beneath the answer (e.g. `SRD: Grappling · EGtW p.142`) — the DM sees
exactly what grounded the answer.

## Docker / deploy considerations

- **Model weights baked into the image** (committed `reference-data/models/`,
  copied in the Dockerfile), mirroring the world-data fix — no runtime fetch,
  works offline. Env override available.
- **`sqlite-vec` binary** loaded via `better-sqlite3` `loadExtension()` at DB init;
  the linux prebuilt goes in the image, macOS build for local dev — guard the load
  by platform. A missing/failed load must degrade gracefully (see error handling),
  not crash DB init.
- **Vectors are runtime data on the `/data` volume, not baked.** Prod bring-up
  mirrors the "import locations" step: after deploy, run `import-srd.js` once and
  `ingest.js` per owned book on the server. The Reference panel confirms what loaded.
- **Footprint:** committed `reference-data/` (SRD markdown + model) adds ~130–150MB
  to repo/image — the bulk of this feature's footprint; acceptable as a
  rarely-changing static asset (cf. the 17MB world artifacts).

## Error handling

- **Ingest:** corrupt/unreadable PDF → clear script error, nothing committed
  (transaction). Empty extraction → warn + skip. Name collision without
  `--replace` → refuse with a hint.
- **Query:** model not loaded or extension missing → `search_reference` returns a
  structured "reference library unavailable" result; the agent degrades (answers
  from campaign data or says it can't source it) rather than crashing the stream.
- **No enabled collections** → tool returns empty; the agent says it has no indexed
  sources instead of inventing citations.

## Testing

- **Unit (vitest, no model load):**
  - `lib/reference/chunk.ts` — deterministic chunk boundaries; correct citation
    labels for PDF pages vs markdown headings; overlap behavior.
  - `lib/reference/retrieve.ts` — with a **stub embedder** + seeded `sqlite-vec`
    rows: KNN returns the nearest chunk; respects the `enabled` filter and the
    optional `collection` filter.
- **Tool-level:** `search_reference` returns citations in the expected shape;
  disabled collections excluded.
- **Manual smoke:** `import-srd.js` → "how does grappling work?" → cited SRD
  answer; ingest a small owned PDF → a setting question → correct page chip.

## Open questions / future work

- In-app upload UI + background ingest job (deferred v2).
- Re-ingest on file change / incremental updates.
- Cross-encoder re-ranking of KNN results for higher precision.
- Per-collection query scoping exposed to the DM in chat ("only search SRD").
- Hybrid keyword + vector retrieval if pure semantic misses exact-term lookups.

## Dependencies & notes

- New deps: `sqlite-vec`, `@huggingface/transformers` (transformers.js), `pdfjs-dist`.
- Builds directly on sub-project #12 (the assistant / Tool Runner) — see
  `docs/superpowers/specs/2026-07-12-campaign-assistant-design.md`.
- Reuses: the `settings`-panel pattern, the `scripts/world/*` script conventions,
  the world-data "bake the artifact into the image" deploy pattern, the vitest runner.
- Custom Next.js fork — read `node_modules/next/dist/docs/` before route work.
