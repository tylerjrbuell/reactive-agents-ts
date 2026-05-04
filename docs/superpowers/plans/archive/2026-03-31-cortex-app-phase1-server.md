# Cortex App — Phase 1: Server Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** `2026-03-31-cortex-framework-prerequisites.md` must be complete before this phase.

**Goal:** Stand up the Cortex server — a Bun + Elysia + Effect-TS application that accepts agent events via WebSocket, persists them to SQLite, and fans them out to UI subscribers.

**Architecture:** `apps/cortex/server/` contains all server code. Five Effect-TS services follow CODING_STANDARDS.md exactly: `CortexIngestService` (receive + persist events), `CortexEventBridge` (fan-out to UI WS clients), `CortexStoreService` (read framework SQLite stores), `CortexRunnerService` (launch agents from UI), `CortexGatewayService` (persistent agent CRUD). Two WebSocket channels: `/ws/ingest` (agents → server) and `/ws/live/:agentId` (server → UI). REST API for CRUD operations.

**Tech Stack:** Bun, Elysia, Effect-TS, bun:sqlite, bun:test.

**Design mockup reference:** `docs/superpowers/specs/cortex-design-export.html`
> ⚠️ The mockup is a starting point only. The fully-built version must exceed it in accuracy, polish, and responsiveness. Use it for color tokens, component shape references, and layout proportions — not as a pixel-perfect spec.

---

## File Map

```
apps/cortex/
  server/
    index.ts                    # Elysia app entry — mounts all routes + WS handlers
    types.ts                    # Shared server types (CortexConfig, RunId, RunContext, etc.)
    errors.ts                   # CortexError, CortexNotFoundError tagged errors
    runtime.ts                  # createCortexLayer() factory
    db/
      schema.ts                 # SQLite table creation + migration
      queries.ts                # Typed query helpers
    api/
      runs.ts                   # GET /api/runs, GET /api/runs/:id
      agents.ts                 # GET/POST/PATCH/DELETE /api/agents
      tools.ts                  # GET /api/tools, POST /api/tools/:name/test
      skills.ts                 # GET /api/skills
      configs.ts                # GET/POST /api/configs
    ws/
      ingest.ts                 # /ws/ingest — agent event receiver handler
      live.ts                   # /ws/live/:agentId — UI subscriber handler
    services/
      ingest-service.ts         # CortexIngestService
      event-bridge.ts           # CortexEventBridge
      store-service.ts          # CortexStoreService
      runner-service.ts         # CortexRunnerService
      gateway-service.ts        # CortexGatewayService
  package.json
  tsconfig.json
```

**Test files:**
```
apps/cortex/server/tests/
  ingest-service.test.ts
  event-bridge.test.ts
  store-service.test.ts
  api-runs.test.ts
```

---

## Task 1: Package Scaffold

**Files:**
- Create: `apps/cortex/package.json`
- Create: `apps/cortex/tsconfig.json`
- Create: `apps/cortex/server/types.ts`
- Create: `apps/cortex/server/errors.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@reactive-agents/cortex",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "bun run server/index.ts",
    "build:ui": "cd ui && bun run build",
    "test": "bun test server/tests"
  },
  "dependencies": {
    "elysia": "^1.1.0",
    "effect": "*",
    "@reactive-agents/core": "workspace:*",
    "@reactive-agents/memory": "workspace:*",
    "@reactive-agents/runtime": "workspace:*",
    "@reactive-agents/observability": "workspace:*",
    "@reactive-agents/gateway": "workspace:*",
    "@reactive-agents/llm-provider": "workspace:*",
    "@reactive-agents/tools": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/bun": "latest"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "lib": ["ESNext"],
    "types": ["bun-types"],
    "paths": {}
  },
  "include": ["server/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create server/types.ts**

```typescript
// apps/cortex/server/types.ts
import type { AgentEvent } from "@reactive-agents/core";
import type { AgentDebrief } from "@reactive-agents/runtime";

// ─── Branded IDs ────────────────────────────────────────────────────────────

export type RunId = string & { readonly _brand: "RunId" };
export const makeRunId = (): RunId => crypto.randomUUID() as RunId;

export type AgentId = string & { readonly _brand: "AgentId" };

// ─── Config ──────────────────────────────────────────────────────────────────

export interface CortexConfig {
  readonly port: number;
  readonly dbPath: string;
  readonly staticAssetsPath?: string;
  readonly openBrowser: boolean;
}

export const defaultCortexConfig: CortexConfig = {
  port: 4321,
  dbPath: ".cortex/cortex.db",
  openBrowser: true,
};

// ─── WebSocket Protocol ───────────────────────────────────────────────────────

/** Message sent by agents to /ws/ingest */
export interface CortexIngestMessage {
  readonly v: 1;
  readonly agentId: string;
  readonly runId: string;
  readonly sessionId?: string;
  readonly event: AgentEvent;
}

/** Message sent by server to UI clients on /ws/live/:agentId */
export interface CortexLiveMessage {
  readonly v: 1;
  readonly ts: number;
  readonly agentId: string;
  readonly runId: string;
  readonly source: "eventbus" | "stream";
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

// ─── Run Context ──────────────────────────────────────────────────────────────

export interface RunContext {
  readonly runId: RunId;
  readonly agentId: AgentId;
  readonly startedAt: number;
  readonly abortController: AbortController;
}

// ─── REST API shapes ──────────────────────────────────────────────────────────

export interface RunSummary {
  readonly runId: string;
  readonly agentId: string;
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly status: "live" | "completed" | "failed";
  readonly iterationCount: number;
  readonly tokensUsed: number;
  readonly cost: number;
  readonly hasDebrief: boolean;
}

export interface AgentSummary {
  readonly agentId: string;
  readonly name: string;
  readonly status: "active" | "paused" | "stopped" | "error";
  readonly runCount: number;
  readonly lastRunAt?: number;
  readonly schedule?: string;
}
```

- [ ] **Step 4: Create server/errors.ts**

```typescript
// apps/cortex/server/errors.ts
import { Data } from "effect";

export class CortexError extends Data.TaggedError("CortexError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class CortexNotFoundError extends Data.TaggedError("CortexNotFoundError")<{
  readonly id: string;
  readonly resource: string;
}> {}

export type CortexErrors = CortexError | CortexNotFoundError;
```

- [ ] **Step 5: Install dependencies**

```bash
cd apps/cortex && bun install
```
Expected: packages resolve from workspace.

- [ ] **Step 6: Commit**

```bash
git add apps/cortex/package.json apps/cortex/tsconfig.json apps/cortex/server/types.ts apps/cortex/server/errors.ts
git commit -m "feat(cortex): scaffold server package — types, errors, config"
```

---

## Task 2: SQLite Schema

**Files:**
- Create: `apps/cortex/server/db/schema.ts`
- Create: `apps/cortex/server/db/queries.ts`

- [ ] **Step 1: Create db/schema.ts**

```typescript
// apps/cortex/server/db/schema.ts
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export function openDatabase(dbPath: string): Database {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  applySchema(db);
  return db;
}

export function applySchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cortex_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id    TEXT    NOT NULL,
      run_id      TEXT    NOT NULL,
      session_id  TEXT,
      seq         INTEGER NOT NULL DEFAULT 0,
      ts          INTEGER NOT NULL,
      source      TEXT    NOT NULL DEFAULT 'eventbus',
      type        TEXT    NOT NULL,
      payload     TEXT    NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_events_agent_run
      ON cortex_events(agent_id, run_id, seq);

    CREATE TABLE IF NOT EXISTS cortex_runs (
      run_id          TEXT PRIMARY KEY,
      agent_id        TEXT    NOT NULL,
      started_at      INTEGER NOT NULL,
      completed_at    INTEGER,
      status          TEXT    NOT NULL DEFAULT 'live',
      iteration_count INTEGER NOT NULL DEFAULT 0,
      tokens_used     INTEGER NOT NULL DEFAULT 0,
      cost_usd        REAL    NOT NULL DEFAULT 0,
      debrief         TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_runs_agent
      ON cortex_runs(agent_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS cortex_agents (
      agent_id    TEXT PRIMARY KEY,
      name        TEXT    NOT NULL,
      config      TEXT    NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'active',
      run_count   INTEGER NOT NULL DEFAULT 0,
      last_run_at INTEGER,
      schedule    TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
    );
  `);
}

/** Enforce retention: keep only the 50 most recent runs per agent. */
export function enforceRetention(db: Database, agentId: string): void {
  db.exec(`
    DELETE FROM cortex_events
    WHERE run_id IN (
      SELECT run_id FROM cortex_runs
      WHERE agent_id = '${agentId}'
      ORDER BY started_at DESC
      LIMIT -1 OFFSET 50
    )
  `);
  db.exec(`
    DELETE FROM cortex_runs
    WHERE agent_id = '${agentId}'
    AND run_id NOT IN (
      SELECT run_id FROM cortex_runs
      WHERE agent_id = '${agentId}'
      ORDER BY started_at DESC
      LIMIT 50
    )
  `);
}
```

- [ ] **Step 2: Create db/queries.ts**

```typescript
// apps/cortex/server/db/queries.ts
import type { Database } from "bun:sqlite";
import type { CortexIngestMessage, CortexLiveMessage, RunSummary } from "../types.js";

export function insertEvent(
  db: Database,
  msg: CortexIngestMessage,
  seq: number,
): void {
  const payload = msg.event as Record<string, unknown>;
  db.prepare(`
    INSERT INTO cortex_events (agent_id, run_id, session_id, seq, ts, type, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    msg.agentId,
    msg.runId,
    msg.sessionId ?? null,
    seq,
    Date.now(),
    msg.event._tag,
    JSON.stringify(payload),
  );
}

export function upsertRun(db: Database, agentId: string, runId: string): void {
  db.prepare(`
    INSERT INTO cortex_runs (run_id, agent_id, started_at)
    VALUES (?, ?, ?)
    ON CONFLICT(run_id) DO NOTHING
  `).run(runId, agentId, Date.now());
}

export function updateRunStats(
  db: Database,
  runId: string,
  patch: { iterationCount?: number; tokensUsed?: number; cost?: number; status?: string; debrief?: string; completedAt?: number },
): void {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (patch.iterationCount !== undefined) { sets.push("iteration_count = ?"); values.push(patch.iterationCount); }
  if (patch.tokensUsed !== undefined) { sets.push("tokens_used = ?"); values.push(patch.tokensUsed); }
  if (patch.cost !== undefined) { sets.push("cost_usd = ?"); values.push(patch.cost); }
  if (patch.status !== undefined) { sets.push("status = ?"); values.push(patch.status); }
  if (patch.debrief !== undefined) { sets.push("debrief = ?"); values.push(patch.debrief); }
  if (patch.completedAt !== undefined) { sets.push("completed_at = ?"); values.push(patch.completedAt); }

  if (sets.length === 0) return;
  values.push(runId);
  db.prepare(`UPDATE cortex_runs SET ${sets.join(", ")} WHERE run_id = ?`).run(...values);
}

export function getRecentRuns(db: Database, limit = 50): RunSummary[] {
  return db.prepare(`
    SELECT run_id, agent_id, started_at, completed_at, status,
           iteration_count, tokens_used, cost_usd,
           debrief IS NOT NULL as has_debrief
    FROM cortex_runs
    ORDER BY started_at DESC
    LIMIT ?
  `).all(limit) as RunSummary[];
}

export function getRunEvents(
  db: Database,
  runId: string,
): Array<{ ts: number; type: string; payload: string }> {
  return db.prepare(`
    SELECT ts, type, payload
    FROM cortex_events
    WHERE run_id = ?
    ORDER BY seq ASC
  `).all(runId) as Array<{ ts: number; type: string; payload: string }>;
}

export function getNextSeq(db: Database, runId: string): number {
  const row = db.prepare(`
    SELECT COALESCE(MAX(seq), -1) + 1 as next_seq
    FROM cortex_events WHERE run_id = ?
  `).get(runId) as { next_seq: number } | null;
  return row?.next_seq ?? 0;
}
```

- [ ] **Step 3: Write a test for schema and queries**

Create `apps/cortex/server/tests/db.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";
import { insertEvent, upsertRun, getRecentRuns, getNextSeq } from "../db/queries.js";

describe("CortexDB schema + queries", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
  });

  it("should create all required tables", () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain("cortex_events");
    expect(names).toContain("cortex_runs");
    expect(names).toContain("cortex_agents");
  });

  it("should insert and retrieve events", () => {
    upsertRun(db, "agent-1", "run-1");
    insertEvent(db, {
      v: 1,
      agentId: "agent-1",
      runId: "run-1",
      event: { _tag: "AgentStarted", taskId: "t1", agentId: "agent-1", provider: "anthropic", model: "test", timestamp: Date.now() } as any,
    }, 0);

    const events = db.prepare("SELECT * FROM cortex_events WHERE run_id = 'run-1'").all();
    expect(events).toHaveLength(1);
  });

  it("should auto-increment sequence numbers", () => {
    upsertRun(db, "agent-1", "run-1");
    const seq0 = getNextSeq(db, "run-1");
    expect(seq0).toBe(0);

    insertEvent(db, { v: 1, agentId: "agent-1", runId: "run-1", event: { _tag: "TaskCreated", taskId: "t1" } as any }, seq0);
    const seq1 = getNextSeq(db, "run-1");
    expect(seq1).toBe(1);
  });
});
```

- [ ] **Step 4: Run test**

```bash
cd apps/cortex && bun test server/tests/db.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/server/db/
git commit -m "feat(cortex): SQLite schema + typed query helpers"
```

---

## Task 3: CortexIngestService + CortexEventBridge

**Files:**
- Create: `apps/cortex/server/services/ingest-service.ts`
- Create: `apps/cortex/server/services/event-bridge.ts`
- Create: `apps/cortex/server/tests/ingest-service.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/cortex/server/tests/ingest-service.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { CortexIngestService, CortexIngestServiceLive } from "../services/ingest-service.js";
import { CortexEventBridge, CortexEventBridgeLive } from "../services/event-bridge.js";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";

const makeTestDb = () => {
  const db = new Database(":memory:");
  applySchema(db);
  return db;
};

const makeTestLayer = (db: Database) =>
  CortexIngestServiceLive(db).pipe(
    Layer.provide(CortexEventBridgeLive),
  );

describe("CortexIngestService", () => {
  it("should persist an event to SQLite", async () => {
    const db = makeTestDb();

    const program = Effect.gen(function* () {
      const svc = yield* CortexIngestService;
      yield* svc.handleEvent("agent-1", "run-1", {
        v: 1,
        agentId: "agent-1",
        runId: "run-1",
        event: { _tag: "TaskCreated", taskId: "t1" } as any,
      });
    });

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayer(db))));

    const rows = db.prepare("SELECT * FROM cortex_events WHERE run_id = 'run-1'").all();
    expect(rows).toHaveLength(1);
  });

  it("should report 0 subscribers for unknown agent", async () => {
    const db = makeTestDb();

    const program = Effect.gen(function* () {
      const svc = yield* CortexIngestService;
      const count = yield* svc.getSubscriberCount("unknown-agent");
      expect(count).toBe(0);
    });

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayer(db))));
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd apps/cortex && bun test server/tests/ingest-service.test.ts 2>&1 | tail -5
```
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement CortexEventBridge**

Create `apps/cortex/server/services/event-bridge.ts`:

```typescript
// apps/cortex/server/services/event-bridge.ts
import { Effect, Context, Layer, Ref } from "effect";
import type { ServerWebSocket } from "bun";
import type { CortexLiveMessage } from "../types.js";
import { CortexError } from "../errors.js";

type SubscriberSet = Set<ServerWebSocket<unknown>>;

export class CortexEventBridge extends Context.Tag("CortexEventBridge")<
  CortexEventBridge,
  {
    readonly subscribe: (agentId: string, ws: ServerWebSocket<unknown>) => Effect.Effect<void, never>;
    readonly unsubscribe: (agentId: string, ws: ServerWebSocket<unknown>) => Effect.Effect<void, never>;
    readonly broadcast: (agentId: string, msg: CortexLiveMessage) => Effect.Effect<void, never>;
    readonly subscriberCount: (agentId: string) => Effect.Effect<number, never>;
    readonly replayTo: (agentId: string, runId: string, ws: ServerWebSocket<unknown>, events: Array<{ ts: number; type: string; payload: string }>) => Effect.Effect<void, CortexError>;
  }
>() {}

export const CortexEventBridgeLive = Layer.effect(
  CortexEventBridge,
  Effect.gen(function* () {
    const subscribersRef = yield* Ref.make(new Map<string, SubscriberSet>());

    const getOrCreate = (agentId: string, map: Map<string, SubscriberSet>): SubscriberSet => {
      if (!map.has(agentId)) map.set(agentId, new Set());
      return map.get(agentId)!;
    };

    return {
      subscribe: (agentId, ws) =>
        Ref.update(subscribersRef, (map) => {
          const copy = new Map(map);
          const set = new Set(getOrCreate(agentId, copy));
          set.add(ws);
          copy.set(agentId, set);
          return copy;
        }),

      unsubscribe: (agentId, ws) =>
        Ref.update(subscribersRef, (map) => {
          const copy = new Map(map);
          const set = new Set(getOrCreate(agentId, copy));
          set.delete(ws);
          copy.set(agentId, set);
          return copy;
        }),

      broadcast: (agentId, msg) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(subscribersRef);
          const subscribers = map.get(agentId) ?? new Set();
          const json = JSON.stringify(msg);
          for (const ws of subscribers) {
            yield* Effect.sync(() => {
              try { ws.send(json); } catch { /* client disconnected */ }
            });
          }
        }),

      subscriberCount: (agentId) =>
        Ref.get(subscribersRef).pipe(
          Effect.map((map) => map.get(agentId)?.size ?? 0),
        ),

      replayTo: (agentId, runId, ws, events) =>
        Effect.gen(function* () {
          for (const row of events) {
            const msg: CortexLiveMessage = {
              v: 1,
              ts: row.ts,
              agentId,
              runId,
              source: "eventbus",
              type: row.type,
              payload: JSON.parse(row.payload) as Record<string, unknown>,
            };
            yield* Effect.sync(() => {
              try { ws.send(JSON.stringify(msg)); } catch { /* ok */ }
            });
          }
        }),
    };
  }),
);
```

- [ ] **Step 4: Implement CortexIngestService**

Create `apps/cortex/server/services/ingest-service.ts`:

```typescript
// apps/cortex/server/services/ingest-service.ts
import { Effect, Context, Layer } from "effect";
import type { Database } from "bun:sqlite";
import type { AgentEvent } from "@reactive-agents/core";
import { insertEvent, upsertRun, updateRunStats, getNextSeq, enforceRetention } from "../db/queries.js";
import { CortexEventBridge } from "./event-bridge.js";
import type { CortexIngestMessage, CortexLiveMessage } from "../types.js";
import { CortexError } from "../errors.js";

export class CortexIngestService extends Context.Tag("CortexIngestService")<
  CortexIngestService,
  {
    readonly handleEvent: (agentId: string, runId: string, msg: CortexIngestMessage) => Effect.Effect<void, CortexError>;
    readonly getSubscriberCount: (agentId: string) => Effect.Effect<number, never>;
  }
>() {}

export const CortexIngestServiceLive = (db: Database) =>
  Layer.effect(
    CortexIngestService,
    Effect.gen(function* () {
      const bridge = yield* CortexEventBridge;

      const deriveRunStats = (event: AgentEvent): Partial<{ iterationCount: number; tokensUsed: number; cost: number; status: string; completedAt: number; debrief: string }> => {
        if (event._tag === "LLMRequestCompleted") {
          const e = event as any;
          return { tokensUsed: e.tokensUsed?.total ?? 0, cost: e.estimatedCost ?? 0 };
        }
        if (event._tag === "ReasoningStepCompleted") return { iterationCount: (event as any).iteration ?? 0 };
        if (event._tag === "AgentCompleted") return { status: (event as any).success ? "completed" : "failed", completedAt: Date.now() };
        if (event._tag === "TaskFailed") return { status: "failed", completedAt: Date.now() };
        if (event._tag === "DebriefCompleted") return { debrief: JSON.stringify((event as any).debrief) };
        return {};
      };

      return {
        handleEvent: (agentId, runId, msg) =>
          Effect.gen(function* () {
            // Persist
            yield* Effect.sync(() => {
              upsertRun(db, agentId, runId);
              const seq = getNextSeq(db, runId);
              insertEvent(db, msg, seq);
              const patch = deriveRunStats(msg.event);
              if (Object.keys(patch).length > 0) updateRunStats(db, runId, patch);
            });

            // Fan-out to UI subscribers
            const liveMsg: CortexLiveMessage = {
              v: 1,
              ts: Date.now(),
              agentId,
              runId,
              source: "eventbus",
              type: msg.event._tag,
              payload: msg.event as unknown as Record<string, unknown>,
            };
            yield* bridge.broadcast(agentId, liveMsg);

            // Enforce retention every 100 events (heuristic)
            yield* Effect.sync(() => {
              const count = db.prepare("SELECT COUNT(*) as c FROM cortex_events WHERE agent_id = ?").get(agentId) as { c: number } | null;
              if ((count?.c ?? 0) % 100 === 0) enforceRetention(db, agentId);
            });
          }).pipe(
            Effect.catchAll((e) => Effect.fail(new CortexError({ message: String(e), cause: e }))),
          ),

        getSubscriberCount: (agentId) => bridge.subscriberCount(agentId),
      };
    }),
  );
```

- [ ] **Step 5: Run tests**

```bash
cd apps/cortex && bun test server/tests/ingest-service.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/cortex/server/services/
git commit -m "feat(cortex): CortexIngestService + CortexEventBridge — event persistence and WS fan-out"
```

---

## Task 4: CortexStoreService

**Files:**
- Create: `apps/cortex/server/services/store-service.ts`
- Create: `apps/cortex/server/tests/store-service.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/cortex/server/tests/store-service.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";
import { upsertRun } from "../db/queries.js";
import { CortexStoreService, CortexStoreServiceLive } from "../services/store-service.js";

const makeLayer = (db: Database) => CortexStoreServiceLive(db);

describe("CortexStoreService", () => {
  it("should return empty array when no runs exist", async () => {
    const db = new Database(":memory:");
    applySchema(db);

    const program = Effect.gen(function* () {
      const svc = yield* CortexStoreService;
      const runs = yield* svc.getRecentRuns(10);
      expect(runs).toHaveLength(0);
    });

    await Effect.runPromise(program.pipe(Effect.provide(makeLayer(db))));
  });

  it("should return runs in descending order", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    upsertRun(db, "a1", "run-1");
    upsertRun(db, "a1", "run-2");

    const program = Effect.gen(function* () {
      const svc = yield* CortexStoreService;
      const runs = yield* svc.getRecentRuns(10);
      expect(runs.length).toBeGreaterThanOrEqual(2);
    });

    await Effect.runPromise(program.pipe(Effect.provide(makeLayer(db))));
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd apps/cortex && bun test server/tests/store-service.test.ts 2>&1 | tail -3
```
Expected: FAIL.

- [ ] **Step 3: Implement CortexStoreService**

Create `apps/cortex/server/services/store-service.ts`:

```typescript
// apps/cortex/server/services/store-service.ts
import { Effect, Context, Layer, Option } from "effect";
import type { Database } from "bun:sqlite";
import { getRecentRuns, getRunEvents } from "../db/queries.js";
import { CortexError, CortexNotFoundError } from "../errors.js";
import type { RunSummary } from "../types.js";

export class CortexStoreService extends Context.Tag("CortexStoreService")<
  CortexStoreService,
  {
    readonly getRecentRuns: (limit: number) => Effect.Effect<RunSummary[], CortexError>;
    readonly getRunEvents: (runId: string) => Effect.Effect<Array<{ ts: number; type: string; payload: string }>, CortexError>;
    readonly getRun: (runId: string) => Effect.Effect<Option.Option<RunSummary>, CortexError>;
    readonly getSkills: () => Effect.Effect<unknown[], CortexError>;
    readonly getTools: () => Effect.Effect<unknown[], CortexError>;
  }
>() {}

export const CortexStoreServiceLive = (db: Database) =>
  Layer.succeed(CortexStoreService, {
    getRecentRuns: (limit) =>
      Effect.sync(() => getRecentRuns(db, limit)).pipe(
        Effect.catchAll((e) => Effect.fail(new CortexError({ message: String(e), cause: e }))),
      ),

    getRunEvents: (runId) =>
      Effect.sync(() => getRunEvents(db, runId)).pipe(
        Effect.catchAll((e) => Effect.fail(new CortexError({ message: String(e), cause: e }))),
      ),

    getRun: (runId) =>
      Effect.sync(() => {
        const row = db.prepare(
          "SELECT * FROM cortex_runs WHERE run_id = ?"
        ).get(runId) as RunSummary | null;
        return row ? Option.some(row) : Option.none();
      }).pipe(
        Effect.catchAll((e) => Effect.fail(new CortexError({ message: String(e), cause: e }))),
      ),

    getSkills: () =>
      Effect.sync(() => {
        // Read from framework SkillStore SQLite — table is in the main app DB
        // Return empty array if table doesn't exist (framework memory not enabled)
        try {
          return db.prepare("SELECT * FROM skills ORDER BY created_at DESC LIMIT 100").all();
        } catch {
          return [];
        }
      }),

    getTools: () =>
      Effect.sync(() => {
        try {
          return db.prepare("SELECT * FROM tools ORDER BY name ASC").all();
        } catch {
          return [];
        }
      }),
  });
```

- [ ] **Step 4: Run tests**

```bash
cd apps/cortex && bun test server/tests/store-service.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/server/services/store-service.ts apps/cortex/server/tests/store-service.test.ts
git commit -m "feat(cortex): CortexStoreService — read-only access to run history and framework stores"
```

---

## Task 5: REST API Routes

**Files:**
- Create: `apps/cortex/server/api/runs.ts`
- Create: `apps/cortex/server/api/agents.ts`
- Create: `apps/cortex/server/api/tools.ts`
- Create: `apps/cortex/server/api/skills.ts`
- Create: `apps/cortex/server/tests/api-runs.test.ts`

- [ ] **Step 1: Write failing test for runs API**

Create `apps/cortex/server/tests/api-runs.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { Effect, Layer } from "effect";
import { Database } from "bun:sqlite";
import { applySchema, upsertRun } from "../db/schema.js";
import { CortexStoreService, CortexStoreServiceLive } from "../services/store-service.js";
import { runsRouter } from "../api/runs.js";

describe("GET /api/runs", () => {
  it("should return empty array when no runs", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const storeLayer = CortexStoreServiceLive(db);

    const app = new Elysia().use(runsRouter(storeLayer));
    const res = await app.handle(new Request("http://localhost/api/runs"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd apps/cortex && bun test server/tests/api-runs.test.ts 2>&1 | tail -3
```
Expected: FAIL.

- [ ] **Step 3: Implement runs API**

Create `apps/cortex/server/api/runs.ts`:

```typescript
// apps/cortex/server/api/runs.ts
import { Elysia, t } from "elysia";
import { Effect, Layer } from "effect";
import { CortexStoreService } from "../services/store-service.js";
import { CortexEventBridge } from "../services/event-bridge.js";

export const runsRouter = (storeLayer: Layer.Layer<CortexStoreService>) =>
  new Elysia({ prefix: "/api/runs" })
    .get("/", async () => {
      const program = Effect.gen(function* () {
        const store = yield* CortexStoreService;
        return yield* store.getRecentRuns(50);
      });
      return Effect.runPromise(program.pipe(Effect.provide(storeLayer)));
    })
    .get("/:runId", async ({ params, set }) => {
      const program = Effect.gen(function* () {
        const store = yield* CortexStoreService;
        const run = yield* store.getRun(params.runId);
        if (run._tag === "None") { set.status = 404; return { error: "Run not found" }; }
        return run.value;
      });
      return Effect.runPromise(program.pipe(Effect.provide(storeLayer)));
    })
    .get("/:runId/events", async ({ params }) => {
      const program = Effect.gen(function* () {
        const store = yield* CortexStoreService;
        return yield* store.getRunEvents(params.runId);
      });
      return Effect.runPromise(program.pipe(Effect.provide(storeLayer)));
    });
```

Create `apps/cortex/server/api/agents.ts`:

```typescript
// apps/cortex/server/api/agents.ts
import { Elysia, t } from "elysia";
import { Effect, Layer } from "effect";
import { CortexStoreService } from "../services/store-service.js";

export const agentsRouter = (storeLayer: Layer.Layer<CortexStoreService>) =>
  new Elysia({ prefix: "/api/agents" })
    .get("/", async () => {
      return []; // Gateway agents — expanded in Phase 2 when CortexGatewayService is added
    });
```

Create `apps/cortex/server/api/tools.ts`:

```typescript
// apps/cortex/server/api/tools.ts
import { Elysia } from "elysia";
import { Effect, Layer } from "effect";
import { CortexStoreService } from "../services/store-service.js";

export const toolsRouter = (storeLayer: Layer.Layer<CortexStoreService>) =>
  new Elysia({ prefix: "/api/tools" })
    .get("/", async () => {
      const program = Effect.gen(function* () {
        const store = yield* CortexStoreService;
        return yield* store.getTools();
      });
      return Effect.runPromise(program.pipe(Effect.provide(storeLayer)));
    });
```

Create `apps/cortex/server/api/skills.ts`:

```typescript
// apps/cortex/server/api/skills.ts
import { Elysia } from "elysia";
import { Effect, Layer } from "effect";
import { CortexStoreService } from "../services/store-service.js";

export const skillsRouter = (storeLayer: Layer.Layer<CortexStoreService>) =>
  new Elysia({ prefix: "/api/skills" })
    .get("/", async () => {
      const program = Effect.gen(function* () {
        const store = yield* CortexStoreService;
        return yield* store.getSkills();
      });
      return Effect.runPromise(program.pipe(Effect.provide(storeLayer)));
    });
```

- [ ] **Step 4: Run API tests**

```bash
cd apps/cortex && bun test server/tests/api-runs.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/server/api/
git commit -m "feat(cortex): REST API routes — runs, agents, tools, skills"
```

---

## Task 6: WebSocket Handlers

**Files:**
- Create: `apps/cortex/server/ws/ingest.ts`
- Create: `apps/cortex/server/ws/live.ts`

- [ ] **Step 1: Create ingest WS handler**

Create `apps/cortex/server/ws/ingest.ts`:

```typescript
// apps/cortex/server/ws/ingest.ts
// Handles /ws/ingest — agents connect here to stream AgentEvent objects
import type { ServerWebSocket } from "bun";
import type { CortexIngestMessage } from "../types.js";
import { Effect, Layer } from "effect";
import { CortexIngestService } from "../services/ingest-service.js";

export function handleIngestMessage(
  ws: ServerWebSocket<unknown>,
  raw: string | Buffer,
  ingestLayer: Layer.Layer<CortexIngestService>,
): void {
  let msg: CortexIngestMessage;
  try {
    msg = JSON.parse(typeof raw === "string" ? raw : raw.toString()) as CortexIngestMessage;
  } catch {
    return; // malformed — silently ignore
  }

  if (msg.v !== 1 || !msg.agentId || !msg.runId || !msg.event) return;

  const program = Effect.gen(function* () {
    const svc = yield* CortexIngestService;
    yield* svc.handleEvent(msg.agentId, msg.runId, msg);
  });

  Effect.runFork(program.pipe(Effect.provide(ingestLayer), Effect.ignoreLogged));
}
```

Create `apps/cortex/server/ws/live.ts`:

```typescript
// apps/cortex/server/ws/live.ts
// Handles /ws/live/:agentId — UI clients subscribe here
import type { ServerWebSocket } from "bun";
import { Effect, Layer } from "effect";
import { CortexEventBridge } from "../services/event-bridge.js";
import { CortexStoreService } from "../services/store-service.js";

export function handleLiveOpen(
  ws: ServerWebSocket<{ agentId: string; runId?: string }>,
  bridge: CortexEventBridge["Service"],
): void {
  const { agentId } = ws.data;
  Effect.runFork(bridge.subscribe(agentId, ws));
}

export function handleLiveClose(
  ws: ServerWebSocket<{ agentId: string }>,
  bridge: CortexEventBridge["Service"],
): void {
  Effect.runFork(bridge.unsubscribe(ws.data.agentId, ws));
}

export async function replayRunEvents(
  ws: ServerWebSocket<{ agentId: string; runId?: string }>,
  storeLayer: Layer.Layer<CortexStoreService>,
  bridgeLayer: Layer.Layer<CortexEventBridge>,
): Promise<void> {
  const { agentId, runId } = ws.data;
  if (!runId) return;

  const program = Effect.gen(function* () {
    const store = yield* CortexStoreService;
    const bridge = yield* CortexEventBridge;
    const events = yield* store.getRunEvents(runId);
    yield* bridge.replayTo(agentId, runId, ws, events);
  });

  await Effect.runPromise(
    program.pipe(Effect.provide(Layer.merge(storeLayer, bridgeLayer)), Effect.ignoreLogged),
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
cd apps/cortex && bun run --bun tsc --noEmit -p tsconfig.json 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/cortex/server/ws/
git commit -m "feat(cortex): WebSocket handlers — ingest (agent→server) and live (server→UI)"
```

---

## Task 7: Elysia Server Entry Point

**Files:**
- Create: `apps/cortex/server/index.ts`
- Create: `apps/cortex/server/runtime.ts`

- [ ] **Step 1: Create runtime.ts**

```typescript
// apps/cortex/server/runtime.ts
import { Layer } from "effect";
import { Database } from "bun:sqlite";
import { openDatabase } from "./db/schema.js";
import { CortexIngestServiceLive } from "./services/ingest-service.js";
import { CortexEventBridgeLive } from "./services/event-bridge.js";
import { CortexStoreServiceLive } from "./services/store-service.js";
import type { CortexConfig } from "./types.js";

export interface CortexRuntime {
  readonly db: Database;
  readonly ingestLayer: ReturnType<typeof CortexIngestServiceLive>;
  readonly bridgeLayer: typeof CortexEventBridgeLive;
  readonly storeLayer: ReturnType<typeof CortexStoreServiceLive>;
}

export function createCortexRuntime(config: CortexConfig): CortexRuntime {
  const db = openDatabase(config.dbPath);
  const bridgeLayer = CortexEventBridgeLive;
  const ingestLayer = CortexIngestServiceLive(db).pipe(Layer.provide(bridgeLayer));
  const storeLayer = CortexStoreServiceLive(db);

  return { db, ingestLayer, bridgeLayer, storeLayer };
}
```

- [ ] **Step 2: Create server/index.ts**

```typescript
// apps/cortex/server/index.ts
import { Elysia } from "elysia";
import { Effect } from "effect";
import { createCortexRuntime } from "./runtime.js";
import { runsRouter } from "./api/runs.js";
import { agentsRouter } from "./api/agents.js";
import { toolsRouter } from "./api/tools.js";
import { skillsRouter } from "./api/skills.js";
import { handleIngestMessage } from "./ws/ingest.js";
import { handleLiveOpen, handleLiveClose, replayRunEvents } from "./ws/live.js";
import { CortexIngestService } from "./services/ingest-service.js";
import { CortexEventBridge } from "./services/event-bridge.js";
import type { CortexConfig } from "./types.js";
import { defaultCortexConfig } from "./types.js";

export async function startCortexServer(config: CortexConfig = defaultCortexConfig): Promise<void> {
  const runtime = createCortexRuntime(config);

  // Extract live service instances for WS handlers
  const ingestSvc = await Effect.runPromise(
    CortexIngestService.pipe(Effect.provide(runtime.ingestLayer)),
  );
  const bridgeSvc = await Effect.runPromise(
    CortexEventBridge.pipe(Effect.provide(runtime.bridgeLayer)),
  );

  const app = new Elysia()
    .use(runsRouter(runtime.storeLayer))
    .use(agentsRouter(runtime.storeLayer))
    .use(toolsRouter(runtime.storeLayer))
    .use(skillsRouter(runtime.storeLayer))

    // Agent ingest WebSocket
    .ws("/ws/ingest", {
      message(ws, raw) {
        handleIngestMessage(ws, raw as string, runtime.ingestLayer);
      },
    })

    // UI live WebSocket
    .ws("/ws/live/:agentId", {
      open(ws) {
        handleLiveOpen(ws as any, bridgeSvc);
        // Replay missed events if runId is provided in query params
        const url = new URL(ws.data.request?.url ?? "", "http://localhost");
        const runId = url.searchParams.get("runId") ?? undefined;
        if (runId) {
          (ws.data as any).runId = runId;
          replayRunEvents(ws as any, runtime.storeLayer, runtime.bridgeLayer);
        }
      },
      close(ws) {
        handleLiveClose(ws as any, bridgeSvc);
      },
    })

    // Serve static UI assets
    .get("/*", ({ set }) => {
      if (config.staticAssetsPath) {
        return Bun.file(`${config.staticAssetsPath}/index.html`);
      }
      set.status = 404;
      return "Cortex UI not built. Run: cd apps/cortex/ui && bun run build";
    });

  app.listen(config.port, () => {
    console.log(`\n◈ CORTEX running at http://localhost:${config.port}\n`);
  });

  if (config.openBrowser) {
    const { exec } = await import("node:child_process");
    const platform = process.platform;
    const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
    exec(`${cmd} http://localhost:${config.port}`);
  }
}

// Entry point when run directly
if (import.meta.main) {
  startCortexServer({
    ...defaultCortexConfig,
    port: parseInt(process.env.CORTEX_PORT ?? "4321"),
    openBrowser: process.env.CORTEX_NO_OPEN !== "1",
    staticAssetsPath: new URL("../ui/build", import.meta.url).pathname,
  });
}
```

- [ ] **Step 3: Verify the server starts**

```bash
cd apps/cortex && timeout 3 bun run server/index.ts 2>&1 | head -5
```
Expected: `◈ CORTEX running at http://localhost:4321` (then process exits from timeout — that's fine).

- [ ] **Step 4: Commit**

```bash
git add apps/cortex/server/runtime.ts apps/cortex/server/index.ts
git commit -m "feat(cortex): Elysia server entry point — mounts all routes and WS handlers"
```

---

## Task 8: Full Server Test Pass

- [ ] **Step 1: Run all cortex server tests**

```bash
cd apps/cortex && bun test server/tests/
```
Expected: all pass.

- [ ] **Step 2: Run full monorepo tests to confirm no regressions**

```bash
bun test
```
Expected: ≥3,036 tests pass.

- [ ] **Step 3: Final Phase 1 commit**

```bash
git add -A
git commit -m "feat(cortex): Phase 1 complete — server foundation with ingest, event bridge, REST API, WS handlers"
```

---

## Phase 1 Complete

The Cortex server is now running. Agents with `.withCortex()` can connect and stream events to it. The REST API serves run history. UI clients can subscribe to live event streams.

**Next:** `2026-03-31-cortex-app-phase2-ui-foundation.md` — SvelteKit scaffold, design tokens, WS client stores, layout.
