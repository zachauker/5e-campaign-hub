# Deployment

encounter-tracker deploys to a self-hosted Unraid server via a GitHub Actions
pipeline that builds a Docker image and pushes it to GHCR, then triggers a
webhook on the Unraid box to pull and restart the container. There is no
scheduled/polling update check — deploys only happen in response to a push
to `main`.

## How it works

```
push to main
  -> GitHub Actions: build image, push to ghcr.io/zachauker/5e-campaign-hub:latest
  -> GitHub Actions: POST to the deploy webhook (signed with a shared secret)
  -> Unraid: webhook container runs scripts/update.sh
       -> git pull (keeps docker-compose.yml etc. in sync)
       -> docker compose pull (fetches the new image)
       -> docker compose down (stops the old container - see note below)
       -> docker compose up -d --remove-orphans (recreates the container)
       -> docker image prune -f (cleans up the old image layer)
```

Database migrations run automatically on container startup
(`instrumentation.ts` calls `runMigrations()`, an idempotent
`CREATE TABLE IF NOT EXISTS`-based script) — no manual migration step is
ever needed.

## Components

| Piece | Where it lives | What it does |
|---|---|---|
| `.github/workflows/docker.yml` | this repo | Builds + pushes the image on every push to `main`, then calls the deploy webhook and verifies it actually fired |
| `scripts/update.sh` | this repo, deployed to Unraid | The actual pull-and-restart logic |
| `docker-compose.yml` | this repo, deployed to Unraid | Defines the `encounter-tracker` app container |
| `docker/webhook/` | this repo, deployed to Unraid | A small [`adnanh/webhook`](https://github.com/adnanh/webhook) listener (built from source, not a pulled image) that verifies the request and runs `scripts/update.sh` |

The webhook container is intentionally narrow in scope: it does exactly one
thing (verify a shared secret, run one fixed script) rather than being a
general-purpose auto-updater. It's built from `adnanh/webhook`'s actual
GitHub source in `docker/webhook/Dockerfile`, not a pre-built third-party
image, so what's running is fully auditable — this matters because the
container has Docker socket access.

**Important, non-obvious requirement:** the webhook must be reachable from
the public internet, not just your LAN. GitHub Actions runners are cloud
VMs — they can't resolve a hostname that only exists in a local/LAN-only DNS
server (e.g. Pi-hole), and they can't reach a host that's only exposed on
your local network. This is different from the app itself, which only ever
needs to be reached by your own browser on your own LAN. Route the webhook
through a real public-DNS path (this setup uses Cloudflare Tunnel, the same
mechanism already used for this server's other public-facing services) —
not the local reverse-proxy-only setup used for LAN-only apps.

## One-time setup on the Unraid host

### 1. Pick the canonical deploy directory

Decide on **one** absolute path that will hold this repo's checkout,
`docker-compose.yml`, and the real `./data` volume (your live database) —
e.g. `/mnt/user/appdata/encounter-tracker`. This exact path is used in
several places below and must match everywhere. Using the wrong path
anywhere in this chain risks pointing a deploy at an empty `./data` instead
of your real one.

```bash
git clone git@github.com:zachauker/5e-campaign-hub.git /mnt/user/appdata/encounter-tracker
cd /mnt/user/appdata/encounter-tracker
docker compose up -d
```

This clone needs to succeed over SSH as whatever user runs these commands
(typically `root` on Unraid) — the webhook container later reuses these same
credentials (see step 2), so confirm `git pull` works cleanly here first.

### 2. Stand up the webhook listener

```bash
cd /mnt/user/appdata/encounter-tracker/docker/webhook
cp .env.example .env
```

Edit `.env`:
- `WEBHOOK_SECRET` — generate one with `openssl rand -hex 32`
- `DEPLOY_PATH` — the same path from step 1

```bash
docker compose up -d --build
```

`docker/webhook/docker-compose.yml` also mounts `/root/.ssh` into the
container read-only, so `scripts/update.sh`'s `git pull` step can
authenticate using the same SSH credentials you just used in step 1 —
no separate deploy key needed. (You may see a harmless
`update_known_hosts: ... Read-only file system` warning in the logs when it
runs — that's SSH trying to write a routine `known_hosts` update and being
correctly blocked by the read-only mount; `git pull` still succeeds.)

**When you change anything in `docker/webhook/`** (the `Dockerfile`,
`hooks.json`, or `.env`), `docker compose up -d --build` alone is not always
reliable about actually recreating the container — Compose can decide
nothing changed and leave the old process running. Force it explicitly:

```bash
docker compose down
docker compose up -d --build
```

Then confirm with `docker logs encounter-tracker-webhook 2>&1 | head -10`
that the `version 2.8.3 starting` timestamp is actually new before assuming
a fix took effect.

### 3. Expose it publicly (not just via local reverse proxy)

Add a public hostname for the webhook through your existing Cloudflare
Tunnel (the same one used for your other internet-facing services) pointing
at `encounter-tracker-webhook:9000`. The actual hook endpoint is
`/hooks/deploy` (adnanh/webhook's convention: the `id` field in
`hooks.json`, prefixed with `/hooks/`) — so the full URL GitHub will call is
something like `https://5ewebhook.yourdomain.com/hooks/deploy`.

**Cloudflare Bot Fight Mode will block this.** If it's enabled for your
zone, it treats automated non-browser POST requests (exactly what GitHub
Actions' `curl` looks like) as bot traffic and returns a 403 before the
request ever reaches your server — you'll see nothing at all in the webhook
container's logs when this happens, which is the tell. Check
**Security -> Bots** in the Cloudflare dashboard; on the Free plan there's
generally no way to except a single path from it, so the practical fix is
turning it off for the zone. **Security -> Events** in the Cloudflare
dashboard will show you definitively whether a request was blocked here and
by what.

### 4. Configure GitHub

In the repo on GitHub: **Settings -> Secrets and variables -> Actions** —
note Secrets and Variables are two separate tabs; it's easy to only fill in
one.

- **Secrets tab -> New repository secret**: `DEPLOY_WEBHOOK_SECRET` = the
  same value as `WEBHOOK_SECRET` from step 2.
- **Variables tab -> New repository variable**: `DEPLOY_WEBHOOK_URL` = the
  full URL from step 3 (e.g. `https://5ewebhook.yourdomain.com/hooks/deploy`).

### 5. Verify

Push a small commit to `main` and watch the Actions run — the `build-push`
job should succeed, then `deploy` should run, POST to the webhook, and check
that the response body is literally `Deploy triggered` (the workflow fails
loudly if it isn't, rather than reporting a false success — `adnanh/webhook`
returns HTTP 200 even when its trigger rule doesn't match, just with a
different body, so status-code-only checking isn't enough here). Check
`docker logs encounter-tracker-webhook` on Unraid to confirm the hook fired
and ran `scripts/update.sh` end to end, and `docker logs encounter-tracker`
to confirm the app container restarted on the new image.

## The Obsidian vault

The hub reads campaign notes from an Obsidian vault mounted into the container.
Before the first sync, work through the [first-sync pre-flight](#first-sync-pre-flight-do-this-before-the-first-sync).
`docker-compose.yml` declares the mount and `VAULT_PATH`:

```yaml
    volumes:
      - ${VAULT_HOST_PATH:-./vault}:/vault:ro
    environment:
      - VAULT_PATH=/vault
```

Set `VAULT_HOST_PATH` in a `.env` file next to `docker-compose.yml` on the Unraid
host (for example `VAULT_HOST_PATH=/mnt/user/<path-to-vault>`). If it is unset the
mount falls back to an empty `./vault` directory and the container still starts.
The campaign folder won't exist inside it, so every sync fails with a `503` and
"the vault folder isn't reachable from the server" (see the third bullet below).

- **`VAULT_PATH` is the root the campaign path is relative to, not the campaign
  folder.** The campaign's own folder is a vault-relative path (for example
  `D&D/Explorers of Exandria`) set per campaign in **Settings → Obsidian Vault**;
  an absolute path or one containing `..` is refused. It does **not** have to be
  the folder holding `.obsidian/` — nothing in the hub reads `.obsidian/`, and the
  recommended layout below deliberately mirrors only a subtree of the real vault.
  What it must do is keep the same prefix the campaign path uses, because
  `source_path` is stored relative to this root and `obsidian://` links are built
  from it: mirror `D&D/` *into* the mounted directory, not *as* it.
- **The mount is `:ro` deliberately.** The hub never writes to the vault, and a
  read-only mount makes that a property of the deployment rather than a promise
  about the code. Do not remove it to "fix" a permissions problem.
- **A missing or dropped mount is loud, not silent.** The sync route answers `503`
  and Settings shows "the vault folder isn't reachable from the server", recorded
  as the last sync status so a background pass that failed unattended is still
  visible. Nothing is archived or deleted when the folder can't be read: a sync
  that cannot see the vault never concludes that your notes are gone.
- **Getting the vault onto the server: Obsidian Sync, one way.** The vault is
  edited on the Mac (`~/Documents/Willowbrook-Remote/`). It is not a git repository
  and carries no sync journal, so something has to deliver the files. The
  `vault-sync` service does it with Obsidian's own headless client. See
  **Mirroring the vault onto the server** below. Development and tests run against
  the local vault via `VAULT_PATH` in `.env.local` and need none of this.

## Mirroring the vault onto the server

The `vault-sync` service in `docker-compose.yml` mirrors the vault with
[`obsidian-headless`](https://www.npmjs.com/package/obsidian-headless) — Obsidian's
own headless client, published by Obsidian's lead developer — against the Obsidian
Sync subscription the vault already uses. Nothing extra runs on the Mac, and there
is no separate share to keep in step with the vault's real contents.

> **The one rule that matters: `ob` treats its working directory as the vault
> replica, and deletes everything in it that the vault does not contain.** Point it
> only at a directory that holds nothing else. On 2026-11-27 an `ob sync` run whose
> working directory was the deploy directory deleted the repo checkout *and* the
> live database, surviving only because the running container still held the file
> open. Check `working_dir` before starting the container, and never run `ob` by
> hand from a project directory.

**One way, enforced by the client.** `ob sync-config --mode mirror-remote` makes the
server a receive-only replica: it pulls the remote vault and never pushes. That is
the Obsidian Sync equivalent of Syncthing's Receive Only, and it matters here because
`vault-sync` mounts the directory **read-write** — it has to, in order to write the
files — while the hub's own mount of the same directory stays `:ro`. Left on the
default bidirectional mode, a partial or damaged copy on the server could propagate
deletions back into the real vault. Set the mode before the first full sync, not
after.

**Exclude what does not belong on a server.** Obsidian Sync carries the whole vault,
and the vault root also holds `Personal`, `House Stuff`, `Day Planner` and
`Software Projects`. This matters beyond tidiness: the attachment route resolves an
embedded image by **basename anywhere under `VAULT_PATH`** (image extensions only —
notes and configs are never reachable), so an image under `Personal/` on the server
would be servable by anyone who could reach the hub and guess its file name. Keep
those folders off the server rather than relying on nobody guessing.

Hidden folders are not synced by default, which also leaves the pre-migration
backups behind (`.backup-*`, `.notion-import`, `.migration`, `.inbox`) — roughly two
thirds of `D&D/` by size, about 133 MB of 198 MB against a real payload near 66 MB.
The hub ignores dot-directories too, so nothing wants them here.

**The layout the hub needs.** The client writes the whole vault into the mounted
directory, so the mounted directory *is* the vault root and `D&D/` sits inside it:

```
/mnt/user/appdata/5ehub-vault/        <- VAULT_HOST_PATH, mounted at /vault
├── D&D/
│   ├── Explorers of Exandria/
│   └── Planescape/
└── (Personal, House Stuff, … excluded)
```

Then `VAULT_HOST_PATH=/mnt/user/appdata/5ehub-vault`, and the campaign folder in
**Settings → Obsidian Vault** stays `D&D/Explorers of Exandria` — unchanged. Do not
rearrange this so that `Explorers of Exandria` sits at the root: it would sync and
scan correctly and break every **Open in Obsidian** link, because `source_path` is
stored relative to `VAULT_PATH`, the `D&D/` prefix would vanish from it, and Obsidian
resolves `file=` against the real vault root, where `Explorers of Exandria/...` does
not exist. Keep the prefix.

**Setup.** Steps 1-5 can run now; **step 6 comes after the pre-flight in the next
section**, because leaving `VAULT_HOST_PATH` unset is exactly how that checklist holds
the background sync off. The files can be mirrored into place meanwhile — nothing
reads them until the mount exists.

1. Start the container, **by name** — `docker compose up -d` would start it too, and
   it must not run before step 4 sets the mode. The `/root` volume persists the login
   and sync config, so steps 2-4 are one-time.

   ```bash
   docker compose up -d vault-sync
   ```

2. Sign in to the Obsidian account that owns the Sync vault.

   ```bash
   docker exec -it vault-sync ob login
   ```

3. Point it at the remote vault, by the name Obsidian Sync knows it by.

   ```bash
   docker exec -it vault-sync ob sync-setup --vault "<vault name>"
   ```

4. Make it receive-only and drop the folders that stay on the Mac. Check
   `ob sync-config --help` against the installed version first — this is a young
   package and the flags may have moved — and confirm images are among the synced
   file types, or embedded character art will not come down.

   ```bash
   docker exec -it vault-sync ob sync-config --mode mirror-remote \
     --excluded-folders "Personal,House Stuff,Day Planner,Software Projects"
   ```

5. Let the first full sync finish, then confirm what landed:

   ```bash
   ls "/mnt/user/appdata/5ehub-vault/D&D/Explorers of Exandria" | head
   ```

6. Set `VAULT_HOST_PATH` in the `.env` beside `docker-compose.yml` — but **not
   until the pre-flight below passes.** Leaving it unset is how you hold the
   background sync off, and the next section depends on that. Then confirm the
   hub's container sees it the way the hub does:

   ```bash
   docker exec encounter-tracker ls "/vault/D&D/Explorers of Exandria" | head
   ```

**Cadence.** `ob sync --continuous` follows the remote vault as it changes, and the
hub's own automatic sync runs every 15 minutes, so a note saved on the Mac reaches
the hub within one hub sync cycle.

**One way means one way.** With `mirror-remote` set, an edit made on the server side
is reverted on the next pass. That is the intended behaviour: the Mac is the source
of truth, exactly as the hub's read-only mount assumes.

## First-sync pre-flight (do this before the first sync)

**Do not press Sync, and do not let the background sync run, until this checklist
is done.** A note with no id is keyed on its file name, and where a hub row for it
already exists keyed on a Notion id, the first sync archives that row and creates a
blank replacement. An archived row takes its map pins, thread links and briefing
with it; the replacement has none of them. The app cannot undo this, and the vault
is mounted read-only, so the fix is a one-time edit **in Obsidian, on the Mac**.

**Hold the background sync off before you start.** Automatic sync is **on by
default** — `lib/vault/scheduler.ts` treats it as enabled unless the setting is
literally the string `"false"` — and runs every 15 minutes, with
`FIRST_TICK_DELAY_MS = 30_000` putting the first pass 30 seconds after the server
starts. Thirty seconds is not enough time to open Settings, so "do not let it run"
needs a mechanism rather than good intentions. Use **both** of these, before step 1:

- **Leave `VAULT_HOST_PATH` unset until step 4 passes.** The vault mount falls back
  to the empty `./vault` directory, the campaign folder does not exist inside it,
  and every sync, background or manual, answers `503` and archives nothing. Set it
  in step 5.
- **Write the kill switch straight into the database**, with the container stopped
  so nothing is contending for the file. `settings` is `(key PRIMARY KEY, value NOT
  NULL)`, so it is a plain upsert:

  ```bash
  sqlite3 /mnt/user/appdata/<deploy-dir>/data/encounter-tracker.db "INSERT INTO settings (key, value) VALUES ('vault_auto_sync_enabled','false') ON CONFLICT(key) DO UPDATE SET value='false';"
  ```

  Then confirm it took, rather than assuming:

  ```bash
  sqlite3 /mnt/user/appdata/<deploy-dir>/data/encounter-tracker.db "SELECT key, value FROM settings WHERE key LIKE '%auto_sync%';"
  ```

  This is what makes a *deliberate* first sync possible: with the row set you can
  mount the vault, start the hub, and still choose when the first pass runs — which
  the `VAULT_HOST_PATH` interlock alone cannot give you, because lifting it is what
  starts the clock. The **Settings → Obsidian Vault → Automatic background sync**
  toggle writes this same row, so it will show as off and you turn it back on there
  in step 5. It starts as SQL because on a fresh deploy the scheduler reaches the
  vault before you can reach the panel.

**Why this happens.** A note with neither `hub_id` nor `notion_id` is keyed on its
file name. The first deploy backfills `source_key` from `notion_page_id` on every
existing row, so the old row is keyed on its Notion id, the basename matches
nothing, and name-based adoption (which only claims rows whose `source_key` is
empty) never gets a look. The row's `name` matching the file name exactly, as
`Shale Telenna (Hill)` does, makes no difference: adoption is gated on the empty
`source_key`, not on the name.

Checked against the live vault and the production database on 2026-11-27 — four
notes were id-less, no note carried a `hub_id`, and only one of the four is at risk:

| Note (under `D&D/Explorers of Exandria/`) | Hub table | What the first sync would do |
|---|---|---|
| `Characters/PCs/Shale Telenna (Hill).md` | `characters` | **archive the real row** (its `source_key` is `213e996be66d800b939cd7cbf634caad`) and create a blank replacement — this is the one that needs step 3 |
| `Arcs/Dangerous Designs Pt 1.md` | `session_notes` | create it; no hub row of that name exists, so there is nothing to lose |
| `Sessions/Session 31.md`, `Sessions/Session 32.md` | `session_notes` | create or adopt by name; both postdate the Notion backfill, so no row for them carries a `source_key` |

The last two rows are safe for a structural reason, not a lucky one:
`archiveUnseen` filters on `source_key IS NOT NULL`, so a row that never came from
Notion is never the vault's to archive, and `findByNameUnlinked` will happily adopt
one. Re-run steps 1 and 2 before relying on any of this.

- [ ] **1. Confirm which mirrored notes have no id.** On the Mac, from the vault root:

  ```bash
  cd "D&D/Explorers of Exandria" && \
    find . -name "*.md" -not -path "*/_Templates/*" -not -path "*/.*" -print0 \
    | xargs -0 grep -lE "^type: *[\"']?(npc|pc|location|item|faction|session|arc|encounter|scene)[\"']?[[:space:]]*$" \
    | while IFS= read -r f; do grep -qE "^(hub_id|notion_id):" "$f" || echo "NO ID: $f"; done
  ```

  Expected: the two notes above, or fewer. Any other path is a mirrored note that
  needs the same treatment. The `find` skips `_Templates` at any depth and every
  dot-directory or dot-file, the same exclusions the sync applies, so it reports
  only notes the sync would actually read.

- [ ] **2. Read the matching ids from the production database.** On the Unraid
  host (the live database is `./data/encounter-tracker.db` under the deploy
  directory). Run this **before** the first sync of the new build, or any time
  while those rows are still unarchived:

  ```bash
  sqlite3 /mnt/user/appdata/<deploy-dir>/data/encounter-tracker.db "SELECT 'characters' AS tbl, id, name, notion_page_id, source_key FROM characters WHERE name LIKE 'Shale%'; SELECT 'session_notes' AS tbl, id, name, notion_page_id, source_key FROM session_notes WHERE name LIKE 'Dangerous Designs%';"
  ```

  **Use the absolute path, and check the file first.** `sqlite3` creates a database
  when it opens a path that does not exist, so a mistyped or relative path yields an
  empty one and `no such table: characters` — which reads exactly like "the rows are
  gone". `ls -la` the file before you trust a query against it; the live database is
  roughly 12 MB. A 0-byte `.db` beside `.fuse_hidden*` files whose link count is `0`
  means it was deleted while the container still held it open: copy those to
  `<name>.db` and `<name>.db-wal` **before** stopping the container, and see the
  warning under "Mirroring the vault onto the server".

  `notion_page_id` is the value to copy. If a query returns more than one row,
  pick the one whose `archived` is 0 and that actually carries the pins and
  briefing.

  No `sqlite3` on the host: run the same two queries inside the container, where
  the database is at `/data/encounter-tracker.db` (the `./data` host directory
  mounted at `/data`; do not use the host path here). This opens it read-only:

  ```bash
  docker exec -i encounter-tracker node -e '
    const Database = require("better-sqlite3");
    const db = new Database("/data/encounter-tracker.db", { readonly: true });
    console.table(db.prepare("SELECT ? AS tbl, id, name, notion_page_id, source_key, archived FROM characters WHERE name LIKE ?").all("characters", "Shale%"));
    console.table(db.prepare("SELECT ? AS tbl, id, name, notion_page_id, source_key, archived FROM session_notes WHERE name LIKE ?").all("session_notes", "Dangerous Designs%"));
  '
  ```

  Or copy the `.db` file off the host and query the copy.

- [ ] **3. Put that id in the note's frontmatter** as `notion_id:`:

  ```yaml
  notion_id: 0123456789abcdef0123456789abcdef
  ```

  Dashes in the id are fine; the hub strips them before comparing. Do not try to
  fix this by renaming the note to match the hub row's `name`: the backfill has
  already keyed that row on its Notion id, and a name match only adopts a row whose
  `source_key` is empty, so the rename would still create a duplicate.

- [ ] **4. Verify.** Re-run the command from step 1. **It must print nothing.**
  Every mirrored note now resolves as `hub_id` or `notion_id`, never the file name.

- [ ] **5. Let the vault reach the server** (see the open prerequisite above): set
  `VAULT_HOST_PATH` in `.env` and recreate the container (`docker compose up -d`),
  and turn automatic sync back on if you turned it off. Then run the first sync by
  hand. Afterwards open **Settings → Obsidian Vault** and read the
  warnings. A sync that archived anything lists the rows by name. If it also says
  a note "was created from the file name in the same pass" that archived an entry,
  an identity did not carry over: put the archived entry's key on that note
  (`notion_id:` for a row that has a `notion_page_id`; otherwise `hub_id:` set to the
  row's old file name, see "A name changed and now there are two entries" in
  `docs/user-guide/vault-sync.md`), and the next sync re-adopts the row and
  un-archives it.

## Manual deploy (fallback)

If the webhook is ever down or you just want to force a redeploy without
pushing a commit:

```bash
cd /mnt/user/appdata/encounter-tracker   # your DEPLOY_PATH
./scripts/update.sh
```

## Rotating the webhook secret

1. Generate a new secret: `openssl rand -hex 32`
2. Update `WEBHOOK_SECRET` in `docker/webhook/.env`, then
   `docker compose down && docker compose up -d --build` in
   `docker/webhook/` to pick it up.
3. Update the `DEPLOY_WEBHOOK_SECRET` GitHub Actions secret to match.

## Troubleshooting notes from getting this working the first time

These were the real issues hit standing this up, kept here since they're
easy to re-trip if this ever needs to be rebuilt from scratch:

- **DNS resolves locally but GitHub Actions can't reach it.** A hostname
  added only to a LAN-only DNS server (Pi-hole, a router's local DNS, etc.)
  is invisible to anything outside your network, including GitHub's cloud
  runners. The webhook specifically needs a real public DNS path (step 3
  above); the app itself does not.
- **Browser says "server not found" even after fixing DNS.** Client-side
  DNS caches (especially macOS's `mDNSResponder`) can hold a stale negative
  result. `nslookup`/`dig` often bypass this cache and show the correct
  answer while the browser (and `curl`, and everything else using the
  normal system resolver) still doesn't — if `nslookup` says one thing and
  everything else disagrees, suspect the resolver cache, not the DNS
  record. On macOS: `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`.
- **A 403 with nothing in the webhook container's logs at all.** The
  request never reached the container — check Cloudflare's Bot Fight Mode
  (see step 3) before assuming it's an NPM or container problem.
- **`hooks.json` fails to load with a `template:` parse error.** In
  `-template` mode, `webhook` processes the file as a Go template *before*
  parsing it as JSON. Quotes inside a `{{ }}` template action must be plain
  (`{{ getenv "VAR" }}`), not JSON-escaped (`{{ getenv \"VAR\" }}`) — the
  latter is valid JSON but invalid Go template syntax and breaks loading
  entirely (0 hooks registered, every request 404s).
- **`git pull` fails with `cannot run ssh: No such file or directory`.**
  The webhook container's base image doesn't include an SSH client by
  default; `openssh-client` has to be installed explicitly, and the
  container needs actual credentials mounted in (see step 2).
- **The deploy reports success and the webhook logs show `Pulled` and
  `Recreated`/`Running`, but the live app is still serving old code.**
  Check the exact wording in the webhook logs: `docker compose up -d`
  sometimes logs `Container encounter-tracker Running` instead of
  `Recreate`/`Recreated` even after a genuinely new image was just pulled —
  Compose's own change-detection isn't fully reliable here, and it silently
  leaves the old container running. `scripts/update.sh` now does an
  explicit `docker compose down` before `up -d` specifically to make this
  impossible, but if you're troubleshooting a deploy from before that
  change, or something similar recurs, verify with:
  ```bash
  docker inspect encounter-tracker --format '{{.Image}}'
  docker image inspect ghcr.io/zachauker/5e-campaign-hub:latest --format '{{.Id}}'
  ```
  If those two image IDs don't match, force it: `docker compose down && docker compose up -d`.
- **The deploy pipeline runs green end to end (git pull, image pull,
  container recreate all succeed) but the app never actually changes, no
  matter what's in the commit.** Check whether `docker-compose.yml`'s
  `image:` and the GHCR image the CI workflow actually pushed to are the
  *same* package name. `IMAGE_NAME: ${{ github.repository }}` in
  `.github/workflows/docker.yml` resolves to whatever the repo is named
  *right now* — if the repo gets renamed on GitHub, CI silently starts
  pushing to a brand new GHCR package under the new name, while
  `docker-compose.yml` keeps pulling the old, now-frozen one. This is easy
  to miss because `git pull`/`git clone`/`gh` calls using the old repo URL
  keep working fine — GitHub transparently redirects those — but GHCR
  package names do **not** follow a rename the same way, so this failure
  produces zero errors anywhere in the pipeline: git pull succeeds, `docker
  compose pull` succeeds (it just keeps re-pulling the same stale tag),
  and the container recreates cleanly. The only tell is the deployed image's
  ID never changing across multiple genuinely different commits. Confirm by
  checking the tag the "Build and push" step in the Actions log actually
  used, and make sure `docker-compose.yml`'s `image:` matches it exactly.
