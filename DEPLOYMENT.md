# Deployment

encounter-tracker deploys to a self-hosted Unraid server via a GitHub Actions
pipeline that builds a Docker image and pushes it to GHCR, then triggers a
webhook on the Unraid box to pull and restart the container. There is no
scheduled/polling update check — deploys only happen in response to a push
to `main`.

## How it works

```
push to main
  -> GitHub Actions: build image, push to ghcr.io/zachauker/5e-encounter-tracker:latest
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
git clone git@github.com:zachauker/5e-encounter-tracker.git /mnt/user/appdata/encounter-tracker
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
  docker image inspect ghcr.io/zachauker/5e-encounter-tracker:latest --format '{{.Id}}'
  ```
  If those two image IDs don't match, force it: `docker compose down && docker compose up -d`.
