# Debian (glibc) base, NOT Alpine (musl): onnxruntime-node (pulled in by
# @huggingface/transformers for the reference-library embeddings) ships glibc-only
# prebuilt binaries and fails to load on musl (__vsnprintf_chk: symbol not found).
# better-sqlite3, sqlite-vec, and sharp all have first-class glibc builds too.
FROM node:22-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package*.json ./
RUN npm install --prefer-offline

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The world-map artifacts (world-data/build) are git-ignored but baked into the
# runtime image below, so they must be present in the build context. Fail fast
# with instructions rather than shipping an image whose /world 404s at runtime.
RUN test -f world-data/build/styles/themes.json || \
  (echo "ERROR: world-data/build artifacts missing from the build context. Generate them before 'docker build': scripts/world/fetch-geojson.sh && scripts/world/build-tiles.sh && node scripts/world/build-glyphs.js && node scripts/world/build-themes.js" && exit 1)
# The reference-library embedding model is NOT baked — its weights (~130MB) exceed
# GitHub's 100MB file limit, so they can't be committed. It is mounted from the /data
# volume at runtime via REFERENCE_MODEL_DIR (see docker-compose.yml + reference-data/DEPLOY.md).
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runner
WORKDIR /app
LABEL net.unraid.docker.icon="https://game-icons.net/icons/d4af37/000000/1x1/delapouite/dice-twenty-faces-twenty.png"
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update && apt-get install -y --no-install-recommends gosu \
  && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 1001 nodejs
RUN useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Next.js's standalone output file-tracing only follows static JS requires, so it
# misses libvips' shared library (e.g. libvips-cpp.*.so) that sharp's native
# binding loads dynamically at runtime — without this, sharp's module loads fine
# but operations like .tile() (dzsave) fail with "VipsOperation: class ... not
# found". Overlaying the complete, untraced packages from the builder stage
# fixes this.
COPY --from=builder /app/node_modules/sharp ./node_modules/sharp
COPY --from=builder /app/node_modules/@img ./node_modules/@img
# Same standalone-tracing gap for the reference-library native runtimes: @huggingface/transformers
# loads onnxruntime-node's libonnxruntime.so dynamically, and sqlite-vec loads its platform
# extension (sqlite-vec-linux-x64) via an optionalDependency — both missed by static tracing.
# Overlay the full packages so query embeddings + vector search work at runtime.
COPY --from=builder /app/node_modules/@huggingface/transformers ./node_modules/@huggingface/transformers
COPY --from=builder /app/node_modules/onnxruntime-node ./node_modules/onnxruntime-node
COPY --from=builder /app/node_modules/onnxruntime-common ./node_modules/onnxruntime-common
COPY --from=builder /app/node_modules/sqlite-vec ./node_modules/sqlite-vec
COPY --from=builder /app/node_modules/sqlite-vec-linux-x64 ./node_modules/sqlite-vec-linux-x64
# Bake the world-map artifacts (pmtiles + glyphs + styles, ~17MB) into the image
# so /api/world serves them from the default WORLD_DIR (cwd/world-data/build) with
# no volume mount or WORLD_DATA_DIR needed. Set WORLD_DATA_DIR to override with a
# mounted volume instead.
COPY --from=builder /app/world-data/build ./world-data/build
# The embedding model is mounted from the /data volume at runtime (REFERENCE_MODEL_DIR),
# not baked — see docker-compose.yml + reference-data/DEPLOY.md. Only the small, committed
# SRD corpus is baked (used by the ingestion scripts).
COPY --from=builder /app/reference-data/srd ./reference-data/srd
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /data
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV DB_PATH=/data/encounter-tracker.db

ENTRYPOINT ["docker-entrypoint.sh"]
