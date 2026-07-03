#!/bin/sh
# Syncs docker-compose.yml (in case it changed) and pulls the latest
# encounter-tracker image, then does a full stop-and-recreate.
#
# Called two ways:
#   1. By docker/webhook/'s adnanh/webhook listener, right after a push to
#      main builds a new image (see .github/workflows/docker.yml's "deploy"
#      job).
#   2. Optionally on a cron schedule (Unraid User Scripts / crontab) as a
#      fallback, in case the webhook is ever offline.
#
# Must always be run from the one canonical deploy directory on the host —
# the one containing the real ./data volume with the live database. Running
# it from a different checkout would point docker-compose at an empty
# ./data and orphan the real one.
#
# `docker compose down` before `up -d` is deliberate, not `up -d` alone:
# Compose's own change-detection has repeatedly proven unreliable in this
# setup (observed both here and on the separate webhook container) — it can
# decide a freshly-pulled image doesn't warrant recreating the container,
# silently leaving the old one running. The image is pulled first (while
# the old container still serves traffic) so the only actual downtime is
# the brief stop-and-restart itself, not the image download.
set -e
cd "$(dirname "$0")/.."
git pull
docker compose pull
docker compose down
docker compose up -d --remove-orphans
docker image prune -f
