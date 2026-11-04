# Player companion app — kickoff brief

**Status: not a spec and not an approved design.** This is the starting context for a
brainstorming conversation about sub-project #21. It records what the DM has already
decided, the constraints the hub imposes, and the questions still open. Brainstorm from
it; do not implement from it.

---

## What this is for

Players write their characters' backstories. That writing is **collaborative and
develops over months** — not a form submitted once. The DM and the player both edit the
same material over time.

The DM's words on the core need:

> "The main thing I am trying to handle is player notes on their characters backstory
> and that is something that develops over time and is collaborative so it needs to be
> able to be edited real time by both PC's and myself. We used google docs initially but
> I hate the google suite so I am exploring alternative solutions that better fit my
> workflow."

**Editing pattern, established:** roughly 90% asynchronous — a player writes, the DM
comes along days later and builds on it. Occasional genuine co-editing sessions are
possible. So true simultaneous multiplayer editing (Google-Docs-style live cursors) is
**not** a hard requirement. Not clobbering each other's work, and making the occasional
shared session tolerable, **is**.

## The two-layer requirement — the load-bearing detail

The player's backstory and the DM's version of it are **not the same document.**

> "Pulled into my prep that is not shared with the player that way I can extrapolate
> things that they aren't aware of."

So there is a shared layer the player authors and can see, and a private layer where the
DM extrapolates things the player must never read. Any design that collapses these, or
that risks leaking the private layer into a player-visible surface, has failed the
central requirement.

The hub already has the mechanism for the private layer: `[!dm]` callouts in vault notes
(see **Constraints** below). The missing half is a shared layer players can write to.

## Decided

**1. A separate player-facing companion app — not a migration of 5ehub.**
The DM weighed moving 5ehub to Vercel so players could sign in directly. That is ruled
out for the hub itself; see **Constraints**. The player surface is its own deployment,
with its own uptime and trust profile: the hub holds campaign secrets and runs heavy
local machinery on the DM's own hardware, while the player surface must be reachable
from a phone on a Tuesday night. Those do not want to be the same process.

Vercel may well be right for the *companion app* — it is the hub that cannot move.

**2. Substantially built out, not minimal.** An initial pitch for something deliberately
tiny (one page per player, an editor, a save button, per-player signed links instead of
accounts) was **rejected by the DM**, for two stated reasons:

> "One it enables further integration down the line and makes it less of a burden.
> Secondly I think it would be very useful right now if there was some behind the scenes
> coupling of my DM app and the player facing app. Having the ability to share
> information between the two when desired is positive in my mind."

So: build for growth, and design deliberate coupling between the DM app and the player
app, with **selective** sharing in both directions — the DM chooses what crosses over.
Treat "what crosses, in which direction, chosen how" as a primary design question, not
an afterthought.

## Constraints (facts about the hub — verify, but these were established by building it)

5ehub is self-hosted and **cannot move to a serverless platform** without being rewritten:

- Docker on an Unraid server ("Willowbrook"); GitHub Actions → GHCR → webhook →
  `scripts/update.sh`.
- **SQLite** via `better-sqlite3` on a Docker volume, with **FTS5** search.
- The **`vec0`** extension is loaded from a filesystem path, and a local **bge-small**
  embedding model is read off that same volume.
- It reads the DM's Obsidian vault through a **read-only bind mount** at `VAULT_PATH`.
  `lib/vault/scan.ts` walks real directories; attachments are served off disk.

Taken together: a serverless host has no filesystem to mount, so the vault integration,
the vector search, the reference library, and the database layer would all have to be
rebuilt. That is the whole application rebuilt to serve its smallest feature.

Further invariants that bind any design here:

- **The hub must never write to the vault.** The vault is the DM's source of truth and
  the mount is read-only by design (sub-project #20).
- **`[!dm]` is a security boundary.** Content inside a `[!dm]` callout is stripped from
  `source_text`, the search index, and session review, but is passed to the briefing
  agent so it can write `entity_briefings.secret`. A player-facing surface must never
  render or return it. See `lib/vault/body.ts` and `lib/vault/note-text.ts`.
- Stack: Next.js 16 (App Router), React 19, TypeScript, drizzle-orm, Tailwind 4, vitest.
- **`AGENTS.md`: this Next.js has breaking changes versus training data. Read the
  relevant guide in `node_modules/next/dist/docs/` before writing any code.**
- Database migrations in this project are **additive only** (`addColumnIfMissing`);
  never rename or drop a column.

## Open — for the brainstorm to settle

1. **Where the canonical backstory text lives.** The vault, the hub's database, the
   companion app's own store, or a git repo. This is the keystone decision; everything
   else follows from it. Note the hub already ingests anything that appears in the
   vault, and that the hub cannot write to the vault itself.
2. **How a player-facing app reaches a hub behind a home network.** Does the hub expose
   an API, does the companion app push to it, do both meet at a shared store, or does
   the DM's machine mediate? This is the hard part of the coupling requirement.
3. **What "selective sharing" means concretely**, in each direction, and how the DM
   chooses — per field, per document, per character, by an explicit publish action?
4. **Auth.** Accounts versus long-lived signed per-player links. The DM rejected
   *minimal* scope, which may or may not extend to rejecting link-based access; ask.
5. **Scope beyond backstory.** The original request named "player notes, backstory and
   feedback." Only backstory has been explored. Session feedback and general notes are
   unexamined, and may belong here or may be separate.
6. **Unanswered:** how many players, and what the least technical one will tolerate
   before they give up and text the DM instead. (The vault holds eight PC sheets, so
   eight is the working guess — confirm it.)

## Also outstanding on the hub side (context, not scope)

Sub-project #20 is merged to local `main` but **not yet pushed or deployed**, and its
first production sync has not run. Two prerequisites remain: a manual vault pre-flight
(`DEPLOYMENT.md`), and an unresolved question of what actually syncs the vault onto
Willowbrook. If a design here proposes git as the vault transport, it may solve that
second problem too — worth noticing, not worth forcing.
