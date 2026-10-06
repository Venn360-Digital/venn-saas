# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# Shared dependency layer
# ---------------------------------------------------------------------------
# One install for both the app and the worker: they share src/lib, Prisma and
# the LLM clients, so splitting the install would download the same tree twice.
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# openssl is required by Prisma's query engine on Debian slim images.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json .npmrc ./
# --legacy-peer-deps mirrors vercel.json: React 19 RCs in the Radix tree still
# declare peers against 18.
RUN npm ci --legacy-peer-deps

# ---------------------------------------------------------------------------
# Production-only dependencies (for the worker runtime)
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --legacy-peer-deps

# ---------------------------------------------------------------------------
# Next.js build
# ---------------------------------------------------------------------------
FROM deps AS app-build
WORKDIR /app

COPY prisma ./prisma
RUN npx prisma generate

COPY . .

# Next needs these at build time for any page that reads them during
# prerendering. They are public values, not secrets.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SUPABASE_DB_SCHEMA
# Cap the compiler's heap. Node sizes its old space from total system memory, so
# on a small host it will happily grow until the machine swaps — building this app
# on a 2 vCPU / 3.9 GB VPS alongside a running Supabase stack took the whole box
# unresponsive, TCP accepting but nothing able to answer. A fixed ceiling makes the
# build fail loudly on its own heap instead of dragging everything else down.
ARG NODE_HEAP_MB=1536

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SUPABASE_DB_SCHEMA=$NEXT_PUBLIC_SUPABASE_DB_SCHEMA \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=$NODE_HEAP_MB

RUN npm run build

# ---------------------------------------------------------------------------
# Next.js runtime
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS app
WORKDIR /app
# HOSTNAME matters: Next's standalone server binds to it, and Docker sets it to the
# container id — leaving the server unreachable on 127.0.0.1 and the HEALTHCHECK
# permanently failing even though Traefik can reach it by container name.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# `output: "standalone"` emits a self-contained server with only the modules it
# actually imports, which keeps this image an order of magnitude smaller than
# copying node_modules.
COPY --from=app-build /app/.next/standalone ./
COPY --from=app-build /app/.next/static ./.next/static
COPY --from=app-build /app/public ./public
# Prisma migrations ship with the image so `migrate deploy` can run from here.
COPY --from=app-build /app/prisma ./prisma
# node_modules/prisma carries the CLI entry point (build/index.js) together with
# the wasm it loads from its own directory. The .bin/prisma shim is deliberately
# not copied: it is a standalone 2 MB bundle that resolves that wasm relative to
# .bin/, so on its own it fails with ENOENT.
COPY --from=app-build /app/node_modules/prisma ./node_modules/prisma
COPY --from=app-build /app/node_modules/@prisma ./node_modules/@prisma
# Next's output tracing does not reliably pick up the generated client's query
# engine binary, so it is copied explicitly.
COPY --from=app-build /app/node_modules/.prisma ./node_modules/.prisma

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]

# ---------------------------------------------------------------------------
# Worker build
# ---------------------------------------------------------------------------
FROM deps AS worker-build
WORKDIR /app

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
COPY workers ./workers

RUN npm run worker:build

# ---------------------------------------------------------------------------
# Worker runtime
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS worker
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# tsup bundles only our own source (resolving the @/* aliases); runtime
# dependencies stay external, so node_modules has to come along — from the
# production-only install, not the build stage.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=worker-build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=worker-build /app/workers/dist ./workers/dist
COPY --from=worker-build /app/prisma ./prisma
COPY package.json ./

USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3001/health || exit 1

CMD ["node", "workers/dist/index.js"]
