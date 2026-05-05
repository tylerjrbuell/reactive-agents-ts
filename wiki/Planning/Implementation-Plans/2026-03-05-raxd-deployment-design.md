# rax.d — Reactive Agents Daemon: Design Document

> **One framework. Any topology. Push-button deploy.**

**Status:** Approved
**Date:** 2026-03-05
**Author:** Tyler Buell + Claude

---

## Vision

`rax.d` turns any reactive agent into a production-ready container service — single instance or multi-agent cluster — with one command and no infrastructure expertise required.

The core insight: reactive-agents already uses Effect-TS Layers for service composition. **The deployment topology is just another Layer.** Swapping SQLite for Postgres, adding a health endpoint, enabling leader election — none of these change agent code. They change which Layers are composed at runtime. `rax.d` makes that composition automatic.

---

## Problems Solved

1. **The 3am problem** — Gateway agents die when terminals close. Docker + `restart: unless-stopped` makes them proper daemons.
2. **State loss on restart** — Memory (SQLite), drafts, seen-thread history live on local filesystem. Volumes + Postgres make state durable.
3. **"It works on my machine"** — Dockerfile is a reproducible environment. `rax deploy` generates it automatically.
4. **No path from dev to production** — Dev uses test LLM + SQLite. Production needs real keys, Postgres, health checks. `rax deploy` bridges that gap.
5. **Multi-agent coordination has no deployment primitive** — Building multi-agent is possible; deploying it requires manual orchestration. Topology-aware compose solves this.
6. **Security stops at code** — Guardrails and kill switches don't matter if the process runs as root with no resource limits. Docker hardening extends the trust model.

---

## Research Foundation

Based on Google/MIT's "Scaling Principles for Agentic Architectures" (March 2026):

- **Tool-Coordination Trade-off**: Tool-heavy tasks perform worse with multi-agent overhead
- **Capability Saturation**: Adding agents yields diminishing returns past a threshold
- **Topology-Dependent Error Amplification**: Centralized orchestration reduces error propagation
- **Task-Dependent Optimization**: Different domains benefit from distinct coordination strategies

These findings directly inform the three supported topologies.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     rax deploy                              │
│          (topology-aware scaffold generator)                │
└────────────┬────────────┬────────────┬──────────────────────┘
             │            │            │
     ┌───────▼──┐  ┌──────▼──┐  ┌─────▼──────┐
     │  single  │  │ central │  │ decentral  │
     │          │  │  -ized  │  │   -ized    │
     └───────┬──┘  └──────┬──┘  └─────┬──────┘
             │            │            │
             ▼            ▼            ▼
┌─────────────────────────────────────────────────────────────┐
│              raxd base image (ghcr.io)                      │
│  ┌──────────────────────────────────────────────────┐       │
│  │  Bun Alpine · non-root · health endpoints        │       │
│  │  reactive-agents runtime · graceful shutdown      │       │
│  └──────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
             │
     ┌───────┴─────────────────────┐
     │   Pluggable Service Layers  │
     ├─────────────────────────────┤
     │ Storage:  SQLite │ Postgres │
     │ Coord:    None │ Pg Lock │ Redis │
     │ Observe:  Console │ OTLP    │
     │ Memory:   Local │ Shared   │
     └─────────────────────────────┘
```

---

## Three Topologies

### Topology 1: Single (Independent)

One agent, one container, one purpose. Maps to Google paper's "Independent" coordination.

- Postgres advisory lock for leader election (2 replicas → instant failover)
- SQLite with volume mount for dev/small deployments
- **Default for `rax deploy init`**

### Topology 2: Centralized (Orchestrator + Workers)

Orchestrator runs the gateway loop, decomposes tasks, delegates to specialist workers via Postgres-backed task queue.

- Workers are stateless, horizontally scalable
- Communication through shared Postgres memory (not direct A2A)
- Maps to Google paper's finding: centralized reduces error propagation for complex tool-heavy tasks

### Topology 3: Decentralized (A2A Peer Mesh)

N peer agents communicate directly via A2A protocol on Docker internal network.

- Each agent has its own domain expertise and gateway schedule
- Shared Postgres for collective memory (vision doc's "Reactive Seeding" concept)
- Maps to Google paper's finding: decentralized excels for diverse exploration tasks

### Hybrid

Compose file that mixes centralized and decentralized. Not a separate topology — natural composition of the above.

---

## Pluggable Service Layers

Effect-TS `Context.Tag` services with swappable Layer implementations:

| Service | Dev Layer (default) | Production Layer | Purpose |
|---|---|---|---|
| **Storage** (`MemoryDatabase`) | `SQLiteLive` (bun:sqlite) | `PostgresLive` (pg pool) | Horizontal scaling, shared state |
| **Coordination** (new) | `NoneLive` (no-op) | `PgAdvisoryLockLive` / `RedisLockLive` | Leader election, distributed mutex |
| **Health** (new) | `NoneLive` (no-op) | `HealthServerLive` (Bun.serve) | `/health`, `/ready`, `/metrics` |
| **Observability export** | `ConsoleLive` (stdout) | `OTLPLive` (OpenTelemetry) | Structured telemetry |

### Storage: Postgres Adapter

`@reactive-agents/storage-postgres` implements the exact same `MemoryDatabaseService` interface:

```typescript
export interface MemoryDatabaseService {
  readonly query: <T>(sql: string, params?: readonly unknown[]) => Effect.Effect<T[], DatabaseError>;
  readonly exec: (sql: string, params?: readonly unknown[]) => Effect.Effect<number, DatabaseError>;
  readonly transaction: <T>(fn: (db: MemoryDatabaseService) => Effect.Effect<T, DatabaseError>) => Effect.Effect<T, DatabaseError>;
  readonly close: () => Effect.Effect<void, never>;
}
```

Every existing memory operation (semantic, episodic, procedural, FTS5 search) works on Postgres. SQLite-specific syntax (FTS5, sqlite-vec) gets adapter shims.

### Coordination Service (new)

```typescript
export interface CoordinationService {
  readonly acquireLock: (key: string, ttlMs: number) => Effect.Effect<boolean, CoordinationError>;
  readonly releaseLock: (key: string) => Effect.Effect<void, CoordinationError>;
  readonly isLeader: () => Effect.Effect<boolean, never>;
  readonly enqueueTask: (task: QueuedTask) => Effect.Effect<void, CoordinationError>;
  readonly dequeueTask: () => Effect.Effect<QueuedTask | null, CoordinationError>;
}
```

Implementations:
- `NoneLive` — always leader, no queue (single-process dev)
- `PgAdvisoryLockLive` — Postgres `pg_advisory_lock` for leader election
- `RedisLive` — Redis for high-throughput task queue + pub/sub

### Health Service (new)

```typescript
export interface HealthService {
  readonly start: () => Effect.Effect<void, never>;
  readonly stop: () => Effect.Effect<void, never>;
  readonly registerCheck: (name: string, check: () => Effect.Effect<boolean>) => Effect.Effect<void>;
}
```

Endpoints:
- `GET /health` — liveness: `{ status: "healthy", uptime, agent, heartbeats }`
- `GET /ready` — readiness: checks DB connection + agent loop running
- `GET /metrics` — Prometheus-format metrics from existing `MetricsCollector`

---

## New Packages

| Package | Purpose | Dependencies |
|---|---|---|
| `@reactive-agents/storage-postgres` | Postgres `MemoryDatabaseService` Layer + connection pool | `postgres` (or `pg`) |
| `@reactive-agents/coordination` | Leader election, distributed lock, task queue | `postgres`, optionally `ioredis` |
| `@reactive-agents/health` | HTTP health/readiness/metrics endpoint | None (uses `Bun.serve`) |

All optional. Core `reactive-agents` unchanged. Users who don't deploy to containers never see them.

---

## rax deploy CLI Command

```bash
rax deploy init --topology <single|centralized|decentralized>
```

### Generated Files

**Single topology:**
```
Dockerfile
docker-compose.yml
raxd.config.ts
.dockerignore
.env.production.example
```

**Centralized topology (adds):**
```
docker-compose.yml     # orchestrator + N worker services + postgres + redis
agents/orchestrator.ts # if not present
agents/worker.ts       # if not present
```

**Decentralized topology (adds):**
```
docker-compose.yml     # N peer services + postgres + A2A network
```

### raxd.config.ts

```typescript
import type { RaxdConfig } from "reactive-agents/deploy";

export default {
  topology: "single",
  storage: {
    backend: process.env.DATABASE_URL ? "postgres" : "sqlite",
    postgres: { url: process.env.DATABASE_URL },
    sqlite: { path: "./data/memory.db" },
  },
  coordination: {
    backend: process.env.DATABASE_URL ? "pg-advisory-lock" : "none",
  },
  health: {
    enabled: true,
    port: parseInt(process.env.HEALTH_PORT ?? "3000"),
  },
  observability: {
    exporter: process.env.OTEL_ENDPOINT ? "otlp" : "console",
    otlp: { endpoint: process.env.OTEL_ENDPOINT },
  },
} satisfies RaxdConfig;
```

---

## Base Image

**`ghcr.io/tylerjrbuell/reactive-agents-raxd`**

```dockerfile
FROM oven/bun:1-alpine AS runtime

RUN addgroup -g 1001 -S raxd && \
    adduser -S raxd -u 1001 -G raxd && \
    mkdir -p /app/data && chown -R raxd:raxd /app

WORKDIR /app
USER raxd

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

STOPSIGNAL SIGTERM
EXPOSE 3000

ENTRYPOINT ["bun", "run", "dist/index.js"]
```

Hardening:
- `oven/bun:1-alpine` — ~50MB base
- Non-root user (`raxd:1001`)
- 3-stage build in user's Dockerfile (deps → build → runtime)
- `cap_drop: ALL` + `no-new-privileges` in compose
- Memory limits (512MB default)
- Built-in HEALTHCHECK
- SIGTERM graceful shutdown

---

## User Workflow

```bash
# 1. Build your agent (existing)
rax create agent my-agent --recipe basic

# 2. Scaffold deployment (new)
rax deploy init --topology single

# 3. Configure
cp .env.production.example .env.production
# Set: ANTHROPIC_API_KEY, TAVILY_API_KEY

# 4. Deploy
docker compose up -d

# 5. Verify
curl http://localhost:3000/health
# {"status":"healthy","agent":"my-agent","uptime":3600}

# 6. Scale (when ready)
# Set DATABASE_URL in .env.production
# Uncomment postgres in docker-compose.yml
docker compose up -d
```

---

## Graceful Lifecycle

```
Container start
  → Load raxd.config.ts
  → Compose Effect-TS Layers based on config
  → Start health server (immediate liveness)
  → Connect storage backend
  → Readiness check passes
  → Start agent gateway loop
  → ...running...

SIGTERM received (or docker stop)
  → Stop accepting new heartbeat/cron events
  → Drain in-progress agent runs (30s grace)
  → Flush memory to storage backend
  → Close storage connection
  → Health endpoint returns unhealthy
  → Exit 0
```

---

## Alignment with Vision (spec/docs/00-VISION.md)

| Vision Principle | rax.d Implementation |
|---|---|
| Composition Over Configuration | Topology = Layer composition, not code changes |
| Control Over Magic | `raxd.config.ts` is explicit, user-editable |
| Observable Over Opaque | `/health`, `/ready`, `/metrics` built-in |
| Scalable (1000+ agents) | Centralized topology + Postgres + worker replicas |
| Secure Over Convenient | Non-root, cap_drop, resource limits, read-only where possible |
| Production-First | Health checks, graceful shutdown, leader election |
| Local-First | SQLite default, Postgres opt-in — works without Docker too |
| Collective Intelligence | Shared Postgres memory = foundation for Reactive Seeding Network |

---

## Implementation Phases

### Phase 1: Foundation (ship the meta-agent in Docker)
- `@reactive-agents/health` package (tiny: Bun.serve health endpoints)
- Base Dockerfile template + `rax deploy init --topology single`
- Meta-agent Dockerfile + docker-compose.yml
- Graceful SIGTERM handling in runtime
- SQLite volume mount (existing storage, no new deps)

### Phase 2: Production Storage
- `@reactive-agents/storage-postgres` package (MemoryDatabaseService over Postgres)
- SQL dialect shims for FTS5 → Postgres full-text search, sqlite-vec → pgvector
- `raxd.config.ts` storage backend switching
- Postgres service in compose templates

### Phase 3: Coordination + Multi-Agent Topologies
- `@reactive-agents/coordination` package (leader election, task queue)
- `rax deploy init --topology centralized` (orchestrator + workers)
- `rax deploy init --topology decentralized` (A2A peer mesh)
- Redis for high-throughput task queue (optional)

### Phase 4: Observability + Polish
- OTLP exporter integration (Prometheus metrics, Jaeger traces)
- `rax deploy status` — query running containers
- `rax deploy logs` — tail agent logs
- Published base image to ghcr.io

---

## Success Metrics

- Meta-agent running 24/7 with real uptime counter
- `rax deploy init && docker compose up -d` works in under 2 minutes
- Zero agent code changes between dev and production deployment
- Health endpoint compatible with Docker, ECS, K8s, Railway, Fly.io
- Postgres adapter passes all existing memory layer tests
