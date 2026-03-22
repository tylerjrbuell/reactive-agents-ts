# Platform Adapter Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the framework runtime-agnostic by abstracting all Bun-specific APIs behind adapter interfaces, enabling Node.js support and user-swappable backends (databases, process runners, HTTP servers).

**Architecture:** Three adapter interfaces (`DatabaseAdapter`, `ProcessAdapter`, `ServerAdapter`) defined in `@reactive-agents/core`. A new `@reactive-agents/platform` package provides Bun and Node.js implementations. Auto-detection at startup picks the right adapters. Users override via builder methods. Low-risk APIs (`Bun.file`, `Bun.hash`, `Bun.Glob`) are replaced directly with Node-standard equivalents (`node:fs`, `node:crypto`) that work on both runtimes.

**Tech Stack:** TypeScript, Effect-TS, `bun:sqlite`, `better-sqlite3`, `node:child_process`, `node:http`, `node:fs`, `node:crypto`

---

## Scope

**In scope:**
- Adapter interfaces in `@reactive-agents/core`
- `@reactive-agents/platform` package with Bun + Node adapters
- Migrate all 11 Bun-specific call sites to use adapters or Node-standard APIs
- Auto-detection (Bun vs Node) at startup
- Builder override methods: `.withDatabase()`, `.withProcess()`, `.withServer()`
- `better-sqlite3` as optional peer dependency for Node users

**Not in scope:**
- Third-party database adapters (Turso, PostgreSQL, sql.js) — interfaces enable these but we don't build them
- Browser/edge compatibility
- Deno support

---

## Migration Strategy

| Category | Files | Approach |
|----------|-------|----------|
| **SQLite** (4 files) | memory/database.ts, cost/budget-db.ts, RI/calibration-store.ts, RI/bandit-store.ts | `DatabaseAdapter` interface |
| **Process** (3 files) | tools/mcp-client.ts, tools/code-execution.ts, tools/docker-sandbox.ts | `ProcessAdapter` interface |
| **HTTP Server** (2 core files) | health/service.ts, a2a/http-server.ts | `ServerAdapter` interface |
| **File I/O** (3 files) | benchmarks/run.ts, eval/dataset-service.ts, cli/bench.ts | Replace with `node:fs` (works on both) |
| **Hashing** (2 files) | cost/semantic-cache.ts, llm-provider/embedding-cache.ts | Replace with `node:crypto` (works on both) |
| **Glob** (1 file) | eval/dataset-service.ts | Replace with `node:fs` + filter (works on both) |

---

## File Structure

### New Package: `packages/platform/`

| File | Responsibility |
|------|---------------|
| `packages/platform/package.json` | Package manifest — peerDeps: `better-sqlite3` (optional) |
| `packages/platform/tsconfig.json` | TypeScript config |
| `packages/platform/tsup.config.ts` | Build config |
| `packages/platform/src/index.ts` | Public exports |
| `packages/platform/src/types.ts` | `DatabaseAdapter`, `StatementAdapter`, `ProcessAdapter`, `ProcessResult`, `ServerAdapter`, `ServerHandle` |
| `packages/platform/src/detect.ts` | `detectRuntime()` → `"bun" \| "node"`, `getPlatform()` factory |
| `packages/platform/src/adapters/bun-database.ts` | `bun:sqlite` → `DatabaseAdapter` |
| `packages/platform/src/adapters/bun-process.ts` | `Bun.spawn` → `ProcessAdapter` |
| `packages/platform/src/adapters/bun-server.ts` | `Bun.serve` → `ServerAdapter` |
| `packages/platform/src/adapters/node-database.ts` | `better-sqlite3` → `DatabaseAdapter` |
| `packages/platform/src/adapters/node-process.ts` | `child_process.spawn` → `ProcessAdapter` |
| `packages/platform/src/adapters/node-server.ts` | `http.createServer` → `ServerAdapter` |
| `packages/platform/tests/database-adapter.test.ts` | Tests both adapters produce same results |
| `packages/platform/tests/process-adapter.test.ts` | Tests process execution on current runtime |
| `packages/platform/tests/detect.test.ts` | Tests auto-detection |

### Modified Files

| File | What Changes |
|------|-------------|
| `packages/memory/src/database.ts` | Replace `import { Database } from "bun:sqlite"` with `DatabaseAdapter` |
| `packages/memory/package.json` | Add `@reactive-agents/platform` dependency |
| `packages/cost/src/budgets/budget-db.ts` | Replace `import { Database } from "bun:sqlite"` with `DatabaseAdapter` |
| `packages/cost/package.json` | Add `@reactive-agents/platform` dependency |
| `packages/cost/src/caching/semantic-cache.ts` | Replace `Bun.hash()` with `node:crypto` |
| `packages/reactive-intelligence/src/calibration/calibration-store.ts` | Replace `bun:sqlite` with `DatabaseAdapter` |
| `packages/reactive-intelligence/src/learning/bandit-store.ts` | Replace `bun:sqlite` with `DatabaseAdapter` |
| `packages/reactive-intelligence/package.json` | Add `@reactive-agents/platform` dependency |
| `packages/tools/src/mcp/mcp-client.ts` | Replace `Bun.spawn` with `ProcessAdapter` |
| `packages/tools/src/skills/code-execution.ts` | Replace `Bun.spawn` with `ProcessAdapter` |
| `packages/tools/src/execution/docker-sandbox.ts` | Replace `Bun.spawn` with `ProcessAdapter` |
| `packages/tools/package.json` | Add `@reactive-agents/platform` dependency |
| `packages/health/src/service.ts` | Replace `Bun.serve` with `ServerAdapter` |
| `packages/health/package.json` | Add `@reactive-agents/platform`, fix bun-types to devDeps |
| `packages/a2a/src/server/http-server.ts` | Replace `Bun.serve` with `ServerAdapter` |
| `packages/a2a/package.json` | Add `@reactive-agents/platform` dependency |
| `packages/llm-provider/src/embedding-cache.ts` | Replace `Bun.hash()` with `node:crypto` |
| `packages/benchmarks/src/run.ts` | Replace `Bun.file`/`Bun.write` with `node:fs` |
| `packages/eval/src/services/dataset-service.ts` | Replace `Bun.file`/`Bun.Glob` with `node:fs` |
| `packages/runtime/src/builder.ts` | Add `.withDatabase()`, `.withProcess()`, `.withServer()` |
| `packages/runtime/src/runtime.ts` | Thread adapters through layer composition |
| `packages/eval/src/services/eval-store.ts` | Replace `require("bun:sqlite")` with `DatabaseAdapter` (5th SQLite consumer) |
| `packages/eval/package.json` | Add `@reactive-agents/platform` dependency |
| `apps/cli/src/commands/bench.ts` | Replace `Bun.file`/`Bun.write` with `node:fs` |
| `apps/cli/src/commands/serve.ts` | Replace `Bun.serve` with `ServerAdapter` |
| `package.json` (root) | Add platform workspace |

---

## Task 1: Package Scaffold + Adapter Interfaces

**Files:**
- Create: `packages/platform/package.json`
- Create: `packages/platform/tsconfig.json`
- Create: `packages/platform/tsup.config.ts`
- Create: `packages/platform/src/types.ts`
- Create: `packages/platform/src/index.ts`

- [ ] **Step 1: Create package.json**

Follow existing package pattern. Dependencies: `effect`. PeerDependencies: `better-sqlite3` (optional). No dependency on any `@reactive-agents/*` package — platform is a leaf package.

- [ ] **Step 2: Create tsconfig.json and tsup.config.ts**

Copy from `packages/gateway/` and adapt.

- [ ] **Step 3: Define adapter interfaces in types.ts**

```typescript
// ── Database Adapter ──────────────────────────────────────────────────────

export interface StatementAdapter {
  run(...params: unknown[]): void;
  get<T = unknown>(...params: unknown[]): T | undefined;
  all<T = unknown>(...params: unknown[]): T[];
  finalize?(): void;
}

export interface DatabaseAdapter {
  /** Prepare a parameterized SQL statement. */
  prepare(sql: string): StatementAdapter;
  /** Execute raw SQL (DDL, PRAGMA, multi-statement). No return value. */
  exec(sql: string): void;
  /** Execute a single statement with params (shorthand for prepare+run). */
  run(sql: string, ...params: unknown[]): void;
  /** Execute SQL and return all rows (convenience for prepare+all). */
  queryAll<T = unknown>(sql: string, ...params: unknown[]): T[];
  /** Execute SQL and return first row (convenience for prepare+get). */
  queryOne<T = unknown>(sql: string, ...params: unknown[]): T | undefined;
  /** Close the database connection. */
  close(): void;
  /** Whether the database is open. */
  readonly isOpen: boolean;
}

/**
 * NOTE: bun:sqlite supports `prepare<TRow, TParams>(sql)` generics.
 * better-sqlite3 does not. The StatementAdapter does NOT use generics —
 * all consumers must strip generic type parameters from prepare() calls
 * during migration and cast results manually.
 */

/** Factory function to create a database connection. */
export type DatabaseFactory = (path: string, options?: { create?: boolean; readonly?: boolean }) => DatabaseAdapter;

// ── Process Adapter ───────────────────────────────────────────────────────

export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface SpawnedProcess {
  readonly stdin: WritableStream | NodeJS.WritableStream | null;
  readonly stdout: ReadableStream | NodeJS.ReadableStream | null;
  readonly stderr: ReadableStream | NodeJS.ReadableStream | null;
  readonly pid: number | undefined;
  readonly exited: Promise<number>;
  /** Write data to stdin — abstracts Bun FileSink vs Node Writable differences. */
  writeStdin(data: Uint8Array): Promise<void>;
  /** Flush stdin (no-op on Node where writes auto-flush). */
  flushStdin(): Promise<void>;
  kill(signal?: number): void;
}

export interface ProcessAdapter {
  /** Spawn a long-running process (e.g., MCP server). Returns handle with streams. */
  spawn(cmd: string[], options?: {
    cwd?: string;
    env?: Record<string, string>;
    stdin?: "pipe" | "inherit" | "ignore";
    stdout?: "pipe" | "inherit" | "ignore";
    stderr?: "pipe" | "inherit" | "ignore";
  }): SpawnedProcess;

  /** Execute a command and wait for completion. Returns stdout/stderr/exitCode. */
  exec(cmd: string[], options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
  }): Promise<ProcessResult>;
}

// ── Server Adapter ────────────────────────────────────────────────────────

export interface ServerHandle {
  readonly port: number;
  readonly hostname: string;
  stop(): Promise<void>;
}

export interface ServerAdapter {
  /** Start an HTTP server with a Fetch API-compatible handler. */
  serve(options: {
    port: number;
    hostname?: string;
    fetch: (request: Request) => Response | Promise<Response>;
  }): Promise<ServerHandle>;
}

// ── Platform Bundle ───────────────────────────────────────────────────────

export interface PlatformAdapters {
  readonly runtime: "bun" | "node";
  readonly database: DatabaseFactory;
  readonly process: ProcessAdapter;
  readonly server: ServerAdapter;
}
```

- [ ] **Step 4: Create index.ts with exports**

- [ ] **Step 5: Add to root package.json workspaces and run `bun install`**

- [ ] **Step 6: Commit**

```
git add packages/platform/ package.json
git commit -m "feat(platform): scaffold package with DatabaseAdapter, ProcessAdapter, ServerAdapter interfaces"
```

---

## Task 2: Auto-Detection + Bun Adapters

**Files:**
- Create: `packages/platform/src/detect.ts`
- Create: `packages/platform/src/adapters/bun-database.ts`
- Create: `packages/platform/src/adapters/bun-process.ts`
- Create: `packages/platform/src/adapters/bun-server.ts`
- Create: `packages/platform/tests/detect.test.ts`

- [ ] **Step 1: Implement detect.ts**

```typescript
import type { PlatformAdapters } from "./types.js";

export function detectRuntime(): "bun" | "node" {
  return typeof globalThis.Bun !== "undefined" ? "bun" : "node";
}

let _platform: PlatformAdapters | null = null;

export async function getPlatform(): Promise<PlatformAdapters> {
  if (_platform) return _platform;
  const runtime = detectRuntime();
  if (runtime === "bun") {
    const { createBunDatabase } = await import("./adapters/bun-database.js");
    const { createBunProcess } = await import("./adapters/bun-process.js");
    const { createBunServer } = await import("./adapters/bun-server.js");
    _platform = { runtime, database: createBunDatabase, process: createBunProcess(), server: createBunServer() };
  } else {
    const { createNodeDatabase } = await import("./adapters/node-database.js");
    const { createNodeProcess } = await import("./adapters/node-process.js");
    const { createNodeServer } = await import("./adapters/node-server.js");
    _platform = { runtime, database: createNodeDatabase, process: createNodeProcess(), server: createNodeServer() };
  }
  return _platform;
}

/** Override the detected platform (for testing or explicit configuration). */
export function setPlatform(platform: PlatformAdapters): void {
  _platform = platform;
}

/**
 * Synchronous platform access — for constructors that can't be async.
 * Uses cached result if getPlatform() was already called, otherwise
 * performs synchronous detection (typeof Bun + require()).
 */
export function getPlatformSync(): PlatformAdapters {
  if (_platform) return _platform;
  const runtime = detectRuntime();
  if (runtime === "bun") {
    const { createBunDatabase } = require("./adapters/bun-database.js");
    const { createBunProcess } = require("./adapters/bun-process.js");
    const { createBunServer } = require("./adapters/bun-server.js");
    _platform = { runtime, database: createBunDatabase, process: createBunProcess(), server: createBunServer() };
  } else {
    const { createNodeDatabase } = require("./adapters/node-database.js");
    const { createNodeProcess } = require("./adapters/node-process.js");
    const { createNodeServer } = require("./adapters/node-server.js");
    _platform = { runtime, database: createNodeDatabase, process: createNodeProcess(), server: createNodeServer() };
  }
  return _platform;
}
```

- [ ] **Step 2: Implement bun-database.ts**

Wraps `bun:sqlite` Database in the `DatabaseAdapter` interface. The APIs are nearly identical — this is a thin wrapper.

```typescript
export function createBunDatabase(path: string, options?: { create?: boolean }): DatabaseAdapter {
  const { Database } = require("bun:sqlite");
  const db = new Database(path, { create: options?.create ?? true });
  return {
    prepare: (sql) => db.prepare(sql),  // bun:sqlite Statement already matches StatementAdapter
    exec: (sql) => db.exec(sql),
    query: (sql, ...params) => db.prepare(sql).all(...params),
    close: () => db.close(),
    get isOpen() { /* check internal state */ return true; },
  };
}
```

**IMPORTANT:** Read the actual `bun:sqlite` API carefully. The `Statement` class has `.run()`, `.get()`, `.all()` which should match `StatementAdapter`. Verify parameter passing works (positional vs named).

- [ ] **Step 3: Implement bun-process.ts**

Wraps `Bun.spawn` in the `ProcessAdapter` interface.

- [ ] **Step 4: Implement bun-server.ts**

Wraps `Bun.serve` in the `ServerAdapter` interface. `Bun.serve` already uses a `fetch` handler — the mapping is direct.

- [ ] **Step 5: Write detect.test.ts**

Test `detectRuntime()` returns `"bun"` when running under Bun. Test `getPlatform()` returns a valid `PlatformAdapters` bundle.

- [ ] **Step 6: Update index.ts exports**

- [ ] **Step 7: Commit**

```
git add packages/platform/
git commit -m "feat(platform): implement Bun adapters and auto-detection"
```

---

## Task 3: Node.js Adapters

**Files:**
- Create: `packages/platform/src/adapters/node-database.ts`
- Create: `packages/platform/src/adapters/node-process.ts`
- Create: `packages/platform/src/adapters/node-server.ts`
- Create: `packages/platform/tests/database-adapter.test.ts`

- [ ] **Step 1: Implement node-database.ts**

Wraps `better-sqlite3` in the `DatabaseAdapter` interface. The API is nearly identical to `bun:sqlite`.

```typescript
export function createNodeDatabase(path: string, options?: { create?: boolean }): DatabaseAdapter {
  let BetterSqlite3: any;
  try {
    BetterSqlite3 = require("better-sqlite3");
  } catch {
    throw new Error(
      "SQLite support on Node.js requires better-sqlite3. Install it:\n" +
      "  npm install better-sqlite3\n" +
      "  # or: yarn add better-sqlite3"
    );
  }
  const db = new BetterSqlite3(path);
  // better-sqlite3 Statement also has .run(), .get(), .all() — matches StatementAdapter
  return {
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => db.exec(sql),
    query: (sql, ...params) => db.prepare(sql).all(...params),
    close: () => db.close(),
    get isOpen() { return db.open; },
  };
}
```

- [ ] **Step 2: Implement node-process.ts**

Wraps `child_process.spawn` in the `ProcessAdapter` interface. Key differences from Bun:
- Bun returns Web `ReadableStream`; Node returns `Readable` stream
- The `SpawnedProcess` interface accepts both via union type
- `exec()` collects stdout/stderr into strings and waits for exit

- [ ] **Step 3: Implement node-server.ts**

Wraps `http.createServer` with a Fetch API adapter. Converts Node's `IncomingMessage` → `Request` and `Response` → Node's `ServerResponse`.

**NOTE:** The health server is simple request/response, but the A2A server uses SSE streaming (`text/event-stream` with chunked body). The Node adapter must bridge `Response` body (`ReadableStream`) to `ServerResponse.write()` by piping chunks. Consider using `@hono/node-server` as a lightweight dependency (~5KB) instead of building from scratch, or implement a minimal `Response.body` → `res.write()` pipe.

- [ ] **Step 4: Write database adapter tests**

Test that both Bun and Node database adapters produce identical results for the same SQL operations. Use `:memory:` databases. Test: create table, insert, select, prepare statements, transactions.

Since tests run under Bun, test the Bun adapter directly. For the Node adapter, test it as a unit (import `better-sqlite3` directly — it works under Bun too since it's a native addon).

- [ ] **Step 5: Commit**

```
git add packages/platform/
git commit -m "feat(platform): implement Node.js adapters (better-sqlite3, child_process, http)"
```

---

## Task 4: Replace Direct Bun API Calls (Low-Risk)

**Files:**
- Modify: `packages/cost/src/caching/semantic-cache.ts`
- Modify: `packages/llm-provider/src/embedding-cache.ts`
- Modify: `packages/benchmarks/src/run.ts`
- Modify: `packages/eval/src/services/dataset-service.ts`
- Modify: `apps/cli/src/commands/bench.ts`

These don't need the adapter layer — just replace with Node-standard APIs that work on both runtimes.

- [ ] **Step 1: Replace Bun.hash() with node:crypto**

In `semantic-cache.ts` and `embedding-cache.ts`:

```typescript
// Before
const hash = Bun.hash(content);

// After
import { createHash } from "node:crypto";
const hash = createHash("sha256").update(content).digest("hex");
```

- [ ] **Step 2: Replace Bun.file/Bun.write with node:fs**

In `benchmarks/run.ts` and `eval/dataset-service.ts`:

```typescript
// Before
const text = await Bun.file(path).text();
await Bun.write(path, JSON.stringify(data));

// After
import { readFileSync, writeFileSync } from "node:fs";
const text = readFileSync(path, "utf-8");
writeFileSync(path, JSON.stringify(data));
```

- [ ] **Step 3: Replace Bun.Glob with node:fs**

In `eval/dataset-service.ts`:

```typescript
// Before
const glob = new Bun.Glob("*.json");
for await (const file of glob.scan(dir)) { ... }

// After
import { readdirSync } from "node:fs";
const files = readdirSync(dir).filter(f => f.endsWith(".json"));
```

- [ ] **Step 4: Run tests**

Run: `bun test`

- [ ] **Step 5: Commit**

```
git add packages/cost/ packages/llm-provider/ packages/benchmarks/ packages/eval/
git commit -m "refactor: replace Bun.hash/file/write/Glob with node:fs and node:crypto"
```

---

## Task 5: Migrate SQLite Consumers to DatabaseAdapter

**Files:**
- Modify: `packages/memory/src/database.ts`
- Modify: `packages/memory/package.json`
- Modify: `packages/cost/src/budgets/budget-db.ts`
- Modify: `packages/cost/package.json`
- Modify: `packages/reactive-intelligence/src/calibration/calibration-store.ts`
- Modify: `packages/reactive-intelligence/src/learning/bandit-store.ts`
- Modify: `packages/reactive-intelligence/package.json`
- Modify: `packages/eval/src/services/eval-store.ts`
- Modify: `packages/eval/package.json`

- [ ] **Step 1: Migrate memory/database.ts**

This is the most complex consumer — it has a `MemoryDatabaseService` Effect service that wraps SQLite.

```typescript
// Before
import { Database } from "bun:sqlite";
// ...
const db = new Database(dbPath, { create: true });

// After
import { getPlatform, type DatabaseAdapter } from "@reactive-agents/platform";
// ...
const platform = await getPlatform();
const db = platform.database(dbPath, { create: true });
```

The `MemoryDatabaseService` wraps `db.prepare().all()` etc. — these already match the adapter interface. The migration is changing the import and construction, not the usage.

**IMPORTANT:** `getPlatform()` is async (dynamic import). The database construction needs to happen in an async context. Read the existing `MemoryDatabaseLive` layer to understand where the Database is created and ensure the async call fits.

If the Layer construction is synchronous, change it to `Layer.unwrapEffect(Effect.promise(async () => { ... }))`.

- [ ] **Step 2: Migrate cost/budget-db.ts**

Similar pattern — replace `new Database(dbPath)` with `platform.database(dbPath)`.

- [ ] **Step 3: Migrate calibration-store.ts and bandit-store.ts**

These are plain classes (not Effect services). Their constructors call `new Database()` synchronously. Options:
- Make constructors accept a `DatabaseAdapter` parameter (dependency injection)
- Use a sync `getPlatformSync()` fallback that throws if async detection is needed

The cleanest approach: accept `DatabaseAdapter` in the constructor, let the caller provide it.

```typescript
// Before
export class CalibrationStore {
  private db: Database;
  constructor(dbPath = ":memory:") {
    this.db = new Database(dbPath, { create: true });

// After
export class CalibrationStore {
  private db: DatabaseAdapter;
  constructor(db?: DatabaseAdapter) {
    this.db = db ?? getPlatformSync().database(":memory:");
```

- [ ] **Step 4: Update package.json files — add @reactive-agents/platform dependency**

- [ ] **Step 5: Run tests**

Run: `bun test`

- [ ] **Step 6: Commit**

```
git add packages/memory/ packages/cost/ packages/reactive-intelligence/
git commit -m "refactor: migrate SQLite consumers to DatabaseAdapter"
```

---

## Task 6: Migrate Process Consumers to ProcessAdapter

**Files:**
- Modify: `packages/tools/src/mcp/mcp-client.ts`
- Modify: `packages/tools/src/skills/code-execution.ts`
- Modify: `packages/tools/src/execution/docker-sandbox.ts`
- Modify: `packages/tools/package.json`

- [ ] **Step 1: Migrate mcp-client.ts**

The MCP client uses `Bun.spawn` for stdio transport. It needs a long-running process with stdin/stdout streams.

```typescript
// Before
const proc = Bun.spawn(["docker", "run", "-i", ...], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });

// After
const platform = await getPlatform();
const proc = platform.process.spawn(["docker", "run", "-i", ...], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
```

**IMPORTANT:** The MCP client reads from `proc.stdout` as a `ReadableStream` (Web API). The `SpawnedProcess` interface's `stdout` is typed as `ReadableStream | NodeJS.ReadableStream`. The consuming code may need to handle both — check if the MCP client uses `.getReader()` (Web) or `.on("data")` (Node) and adapt if necessary.

- [ ] **Step 2: Migrate code-execution.ts**

Uses `Bun.spawn(["bun", "--eval", code])`. On Node, this should use `["node", "--eval", code]` instead.

```typescript
// Before
const proc = Bun.spawn(["bun", "--eval", code], { stdout: "pipe", stderr: "pipe", cwd: "/tmp" });

// After
const platform = await getPlatform();
const runtime = platform.runtime === "bun" ? "bun" : "node";
const result = await platform.process.exec([runtime, "--eval", code], { cwd: "/tmp", timeoutMs: 30_000 });
```

- [ ] **Step 3: Migrate docker-sandbox.ts**

Uses `Bun.spawn` for Docker commands. Same pattern as MCP client.

- [ ] **Step 4: Update package.json**

- [ ] **Step 5: Run tests**

Run: `bun test`

- [ ] **Step 6: Commit**

```
git add packages/tools/
git commit -m "refactor: migrate process consumers to ProcessAdapter"
```

---

## Task 7: Migrate Server Consumers to ServerAdapter

**Files:**
- Modify: `packages/health/src/service.ts`
- Modify: `packages/health/package.json`
- Modify: `packages/a2a/src/server/http-server.ts`
- Modify: `packages/a2a/package.json`
- Modify: `apps/cli/src/commands/serve.ts`

- [ ] **Step 1: Migrate health/service.ts**

```typescript
// Before
server = Bun.serve({ port: config.port, fetch: handleRequest });

// After
const platform = await getPlatform();
const handle = await platform.server.serve({ port: config.port, fetch: handleRequest });
```

The health service already uses a Fetch API-compatible handler (`(req: Request) => Response`). The adapter wraps this for Node.

- [ ] **Step 2: Fix health/package.json**

Move `bun-types` from dependencies to devDependencies. Add `@reactive-agents/platform`.

- [ ] **Step 3: Migrate a2a/http-server.ts**

Same pattern. The A2A server is more complex (SSE streaming), but the Fetch handler pattern is the same.

- [ ] **Step 4: Run tests**

Run: `bun test`

- [ ] **Step 5: Commit**

```
git add packages/health/ packages/a2a/
git commit -m "refactor: migrate HTTP servers to ServerAdapter"
```

---

## Task 8: Builder Override Methods

**Files:**
- Modify: `packages/runtime/src/builder.ts`
- Modify: `packages/runtime/src/runtime.ts`
- Modify: `packages/runtime/package.json`

- [ ] **Step 1: Add builder methods**

```typescript
withDatabase(factory: DatabaseFactory): this {
  this._databaseFactory = factory;
  return this;
}

withProcess(adapter: ProcessAdapter): this {
  this._processAdapter = adapter;
  return this;
}

withServer(adapter: ServerAdapter): this {
  this._serverAdapter = adapter;
  return this;
}
```

- [ ] **Step 2: Thread adapters through runtime composition**

In `createRuntime()`, pass the adapters to services that need them. The memory layer gets the `DatabaseFactory`, the tools layer gets the `ProcessAdapter`, etc.

When no override is provided, use `getPlatform()` auto-detection.

- [ ] **Step 3: Run full test suite**

Run: `bun test`

- [ ] **Step 4: Commit**

```
git add packages/runtime/
git commit -m "feat(runtime): add .withDatabase(), .withProcess(), .withServer() builder methods"
```

---

## Task 9: Integration Verification

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: All 2,699+ tests pass.

- [ ] **Step 2: Run build**

Run: `bun run build`
Expected: All packages build (including new platform package).

- [ ] **Step 3: Verify no remaining Bun-specific imports in shipped code**

Run: `grep -r "from \"bun:sqlite\"" packages/*/src/ --include="*.ts" | grep -v platform/`
Expected: No matches (only the platform package should import bun:sqlite).

Run: `grep -r "Bun\.\(spawn\|serve\|file\|write\|hash\|Glob\)" packages/*/src/ --include="*.ts" | grep -v platform/ | grep -v "typeof.*Bun"`
Expected: No matches.

- [ ] **Step 4: Commit any fixes**

```
git add <specific files>
git commit -m "fix: integration fixes for platform adapter migration"
```

---

## Task 10: Documentation

- [ ] **Step 1: Update CLAUDE.md**

- Update test count
- Add `@reactive-agents/platform` to package map
- Add note about Node.js support in environment section
- Add `better-sqlite3` to environment variables / prerequisites

- [ ] **Step 2: Commit**

```
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with platform adapter info and Node.js support"
```
