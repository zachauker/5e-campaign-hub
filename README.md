# Campaign Hub

A self-hosted D&D 5e campaign hub — a combat tracker that grew into the place a
Dungeon Master keeps the whole campaign: characters, locations, items, factions,
maps, session notes, open threads, doom clocks, and a live at-the-table mode for
running the game itself.

It is built for one DM on their own machine or home server. Everything lives in a
single SQLite file; nothing is sent anywhere except the integrations you
explicitly configure.

> **Using the app?** The end-user documentation lives in
> [`docs/user-guide/`](docs/user-guide/README.md) — one guide per section, written
> from the DM's seat rather than the developer's.

---

## What's in it

| Section | What it does |
| --- | --- |
| **Dashboard** (`/`) | Campaign at a glance: live encounter, entity counts, recent fights |
| **Encounters** (`/encounters`) | The initiative tracker — HP, conditions, stat blocks, D&D Beyond PCs |
| **Characters / Locations / Items / Factions** | The campaign glossary: filterable, sortable lists in list/gallery/table views, with detail pages that render the linked vault note |
| **Sessions** (`/sessions`) | Session notes read from your Obsidian vault, linked to locations and pinned to maps |
| **Chronicle** (`/chronicle`) | In-world calendar, open threads, progress clocks, timeline, AI session review |
| **World** (`/world`) | A vector map of Exandria (Wildemount + Tal'Dorei) with campaign markers |
| **Maps** (`/maps`) | Your own uploaded maps — standard or deep-zoom tiled — with nestable sub-maps and fully styleable pins |
| **Run** (`/run`) | At-the-table mode: keyboard-driven lookup, AI briefing cards, one-key moment flagging |
| **Settings** (`/settings`) | D&D Beyond sheets, vault sync, search index, briefing builds, assistant, reference library |
| **Command palette** (`⌘K` / `Ctrl+K`) | Jump to anything, or hand the query to the assistant |

Two AI surfaces sit on top of all of it, both optional and both requiring your own
Anthropic API key:

- **Campaign assistant** — a chat panel that reads your campaign through tools and
  answers grounded questions. Actions are *proposals* you confirm; it never writes
  on its own.
- **Briefings & session review** — six-field "who is this and what do they want"
  cards for Run mode, and an agent that reads a session note and proposes thread,
  clock, and date updates.

A local **reference library** (SRD 5.1 plus any PDFs or notes you add) is embedded
on-device with a bundled sentence-transformer model and searched via `sqlite-vec`,
so rules lookups are grounded in real text and stay offline.

---

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS 4**, Radix primitives, `lucide-react` icons
- **SQLite** via `better-sqlite3` + **Drizzle ORM**; `sqlite-vec` for vector search,
  FTS5 for the at-the-table search index
- **Zustand** for client state, **TanStack Query** where fetching needs caching
- **MapLibre GL** + **PMTiles** for the vector world map; **Leaflet** for tiled
  uploaded maps; `react-zoom-pan-pinch` for standard ones; **sharp** for tiling
- **`@anthropic-ai/sdk`** for the assistant, briefings, and session review
- **`@huggingface/transformers`** for local embeddings, **`pdfjs-dist`** for PDF text
- **Vitest** for tests

> **Note for contributors:** this repo pins a Next.js version whose APIs and
> conventions differ from what you may remember. See [`AGENTS.md`](AGENTS.md) —
> read `node_modules/next/dist/docs/` before writing routing or data-fetching code.

---

## Getting started

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>. Migrations run automatically at startup
(`instrumentation.ts` → `runMigrations()`), so there is no separate migration
step — the database file is created on first boot if it doesn't exist.

### Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm test` | Vitest, single run |
| `npm run test:watch` | Vitest, watch mode |

### First-run checklist

1. Create a campaign from the selector in the top bar.
2. **Settings → Search index → Rebuild search index** (Run mode's search is empty
   until you do).
3. Set the in-world date on **Chronicle** if you want threads, clocks, and the
   timeline.
4. Optionally add your D&D Beyond character URLs, the campaign's folder in your
   Obsidian vault, and an Anthropic API key — each unlocks its own section and none
   is required.

---

## Configuration

All runtime configuration is environment variables; the secret (the
Anthropic key) is entered in **Settings** and stored in the database, not in env.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DB_PATH` | `./encounter-tracker.db` | SQLite database file |
| `REFERENCE_MODEL_DIR` | bundled/downloaded | Embedding model for the reference library |
| `REFERENCE_INBOX_DIR` | — | Directory to drop PDFs/notes into for in-app ingestion |
| `WORLD_DATA_DIR` | `world-data/build` | PMTiles, glyphs, and styles for the world map |
| `VAULT_PATH` | `/vault` | Root of the read-only Obsidian vault. The default is the container mount point; set it to the vault's path when running locally. The campaign's folder inside it is configured per campaign in **Settings** |

### External services

| Service | Used for | Required? |
| --- | --- | --- |
| **D&D Beyond** | Pulling live PC sheets from public share URLs | Optional |
| **Obsidian vault** | Characters, items, factions, locations, and session notes, read from a read-only mount ([vault sync](docs/user-guide/vault-sync.md)) | Optional |
| **Anthropic API** | Assistant, briefings, session review | Optional |
| **Open5e** | Monster stat-block search (results are cached locally) | Optional |

---

## Repository layout

```
app/            Next.js App Router — pages and ~60 API routes
components/     UI by feature: tracker, maps, entities, state, run, sessions, settings
lib/            Server + shared logic
  assistant/      Assistant agent, tool definitions, proposal builders
  calendar/       The Exandrian calendar
  db/             Drizzle schema, migrations, sqlite-vec loader
  ddb/            D&D Beyond character parsing
  maps/           Image storage and tile generation
  reference/      Chunking, embedding, ingestion, retrieval, briefings
  run/            At-the-table search index, briefings, marks, runs
  state/          Threads, clocks, timeline, date advance, session review
  store/          Zustand stores
  vault/          Vault scan, note mapping, reconciliation, sync, scheduler
world-data/     Exandria vector-map build pipeline output
reference-data/  Bundled SRD 5.1 markdown
scripts/        World-map and reference-data build/import scripts
docs/           User guide, plus design specs and implementation plans
```

## Testing

```bash
npm test
```

Tests are colocated with the code they cover (`lib/**/**.test.ts`,
`components/**/*.test.ts`) and concentrate on the pure logic: sync reconciliation,
clock cadence, marker appearance resolution, entity filtering, search indexing,
and briefing assembly.

## Deployment

The app ships as a Docker image and self-hosts on Unraid, deployed by a GitHub
Actions pipeline that builds, pushes to GHCR, and pings a webhook to pull and
restart. Full instructions — including the non-obvious requirement that the
webhook be publicly reachable — are in [`DEPLOYMENT.md`](DEPLOYMENT.md).

```bash
docker compose up -d
```

Data lives on the `./data` volume: the database, the reference model, the
reference inbox, and uploaded map images.

## Further reading

- [`docs/user-guide/`](docs/user-guide/README.md) — how to actually use each feature
- [`PRODUCT.md`](PRODUCT.md) — who this is for and the design principles it's held to
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — self-hosting pipeline
- [`AGENTS.md`](AGENTS.md) — conventions for anyone (human or agent) writing code here
- [`docs/superpowers/`](docs/superpowers/) — the design spec and implementation plan behind every feature
- [`world-data/README.md`](world-data/README.md) — regenerating the Exandria map artifacts
