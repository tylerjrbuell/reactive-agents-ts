# raxd — Reactive Agents Daemon (monorepo)
# Agent: advocate (Community Growth Agent)
# Build context: workspace root (../../)

# ── Stage 1: Install + build workspace packages ─────────────────────────────
# Pinned to 1.3.10: bun 1.3.14 regresses streaming via FiberRef inheritance.
FROM oven/bun:1.3.10-alpine AS build

WORKDIR /app

# Root manifests + lockfile + turbo config first (cache-friendly layer).
COPY package.json bun.lock turbo.json tsup.config.base.ts tsconfig.json ./

# All workspace members must be present for `bun install --frozen-lockfile`:
# the root `workspaces` array lists `packages/*`, `apps/*`, and the explicit
# `apps/cortex/ui` — a missing explicit member is a hard error. The whole
# `apps/` tree is copied into this build stage (only manifests survive for the
# excluded apps via .dockerignore); the runtime stage below stays lean.
COPY packages/ packages/
COPY apps/ apps/

RUN bun install --frozen-lockfile
RUN bun run build:packages
# Strip non-source cruft before the runtime stage copies /app/packages:
#  - .reactive-agents/: agent memory (SQLite + memory.md) is runtime-generated
#    state, not package source. If any leaks into the workspace tree it balloons
#    the image by GBs; the agent recreates its own under /app at run time.
#  - per-package node_modules: bun's isolated linker leaves copies that runtime
#    resolution doesn't need (deps resolve via the hoisted root /app/node_modules).
RUN find /app/packages \( -name .reactive-agents -o -name node_modules \) -type d -prune -exec rm -rf {} + \
 && find /app/apps/advocate -name .reactive-agents -type d -prune -exec rm -rf {} +

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM oven/bun:1.3.10-alpine

# Hardening: non-root user.
RUN addgroup -g 1001 -S raxd && \
    adduser -S raxd -u 1001 -G raxd && \
    mkdir -p /app/data /app/apps/advocate/drafts && chown -R raxd:raxd /app

WORKDIR /app

# Copy only what the advocate agent needs at runtime — cortex and other apps
# are not carried into the final image.
COPY --from=build --chown=raxd:raxd /app/node_modules ./node_modules
COPY --from=build --chown=raxd:raxd /app/packages/ ./packages/
COPY --from=build --chown=raxd:raxd /app/apps/advocate/ ./apps/advocate/
COPY --from=build --chown=raxd:raxd /app/package.json ./package.json

USER raxd

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

STOPSIGNAL SIGTERM
EXPOSE 3000

ENTRYPOINT ["bun", "run", "apps/advocate/src/index.ts"]
