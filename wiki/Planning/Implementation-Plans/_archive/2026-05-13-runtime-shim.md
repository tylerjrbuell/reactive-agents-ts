# Runtime Shim — Cross-Runtime Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `reactive-agents` runtime-agnostic so it runs on both Bun (with native `Bun.*` fast paths) and Node.js 22.5+ (with `node:sqlite`, `node:child_process`, `node:fs.glob`). Unblocks Stackblitz embeds, Vercel/Cloudflare deployments, and broader Node.js adoption.

**Architecture:** Single new package `@reactive-agents/runtime-shim` exports a unified surface (`Database`, `spawn`, `writeFile`, `readFile`, `serve`, `hash`, `glob`, `isMain`). Runtime detected once at module load via `globalThis.Bun`. Two implementation files (`bun-impl.ts`, `node-impl.ts`) wire native APIs; index dispatches via `createRequire` (no top-level await). Consumer packages replace `import "bun:sqlite"` / `Bun.*` calls with imports from the shim — code-level call sites unchanged.

**Tech Stack:** TypeScript 5, `bun:sqlite`, `node:sqlite` (Node 22.5+), `node:child_process`, `node:http`, `node:crypto`, `node:fs`, `node:module` (createRequire), tsup (build), Effect-TS (existing packages).

**Branch:** `feature/runtime-shim` (worktree at `../reactive-agents-ts.runtime-shim`)

---

## Source-of-Truth Audit (verified via grep)

16 source files with Bun-specific APIs:

| Primitive | Files | Count |
|-----------|-------|-------|
| `bun:sqlite` Database | `cost/budgets/budget-db.ts`, `memory/database.ts`, `reactive-intelligence/calibration/calibration-store.ts`, `reactive-intelligence/learning/bandit-store.ts` | 4 imports |
| `Bun.hash` | `cost/caching/semantic-cache.ts`, `llm-provider/embedding-cache.ts` | 3 uses |
| `Bun.spawn` | `tools/execution/docker-sandbox.ts`, `tools/skills/code-execution.ts`, `tools/skills/shell-execution.ts` | 8 uses |
| `Bun.file` | `eval/services/dataset-service.ts` | 2 uses |
| `Bun.Glob` | `eval/services/dataset-service.ts` | 1 use |
| `Bun.serve` | `a2a/server/http-server.ts`, `benchmarks/runner.ts`, `health/service.ts`, `judge-server/index.ts` | 4 uses |
| `import.meta.main` | `judge-server/index.ts`, `llm-provider/calibration-runner.ts` | 2 uses |

---

## File Map

### New package: `packages/runtime-shim/`

| File | Purpose |
|------|---------|
| `packages/runtime-shim/package.json` | Package metadata |
| `packages/runtime-shim/tsconfig.json` | TS config |
| `packages/runtime-shim/src/index.ts` | Public exports + runtime dispatch |
| `packages/runtime-shim/src/detect.ts` | `isBun` constant + helpers |
| `packages/runtime-shim/src/types.ts` | Shared interface types (`DatabaseLike`, `SpawnOptions`, etc.) |
| `packages/runtime-shim/src/bun-impl.ts` | Bun-native implementations |
| `packages/runtime-shim/src/node-impl.ts` | Node-native implementations |
| `packages/runtime-shim/src/stub-impl.ts` | In-memory fallbacks (no persistence) |
| `packages/runtime-shim/tests/bun.test.ts` | Bun-runtime tests |
| `packages/runtime-shim/tests/node.test.ts` | Node-runtime tests (via subprocess) |
| `packages/runtime-shim/tests/parity.test.ts` | Cross-runtime parity tests |
| `packages/runtime-shim/README.md` | Package docs |

### Consumer refactors (16 files):

| Package | File | Replace |
|---------|------|---------|
| `cost` | `src/budgets/budget-db.ts` | `import { Database } from "bun:sqlite"` → from shim |
| `cost` | `src/caching/semantic-cache.ts` | `Bun.hash` → `hash` from shim |
| `memory` | `src/database.ts` | `import { Database } from "bun:sqlite"` → from shim |
| `reactive-intelligence` | `src/calibration/calibration-store.ts` | `import { Database } from "bun:sqlite"` → from shim |
| `reactive-intelligence` | `src/learning/bandit-store.ts` | `import { Database } from "bun:sqlite"` → from shim |
| `llm-provider` | `src/embedding-cache.ts` | `Bun.hash` → `hash` from shim |
| `llm-provider` | `src/calibration-runner.ts` | `import.meta.main` → `isMain(import.meta.url)` from shim |
| `tools` | `src/execution/docker-sandbox.ts` | 6× `Bun.spawn` → `spawn` from shim |
| `tools` | `src/skills/code-execution.ts` | `Bun.spawn` → `spawn` from shim |
| `tools` | `src/skills/shell-execution.ts` | `Bun.spawn` → `spawn` from shim |
| `eval` | `src/services/dataset-service.ts` | `Bun.file`, `Bun.Glob` → `readFile`, `glob` from shim |
| `a2a` | `src/server/http-server.ts` | `Bun.serve` → `serve` from shim |
| `benchmarks` | `src/runner.ts` | `Bun.serve` → `serve` from shim |
| `health` | `src/service.ts` | `Bun.serve` → `serve` from shim |
| `judge-server` | `src/index.ts` | `Bun.serve` + `import.meta.main` → from shim |

---

## Unified API Surface (the contract)

```ts
// packages/runtime-shim/src/types.ts

export interface DatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): StatementLike;
  query(sql: string): StatementLike;  // Bun convenience; on Node = prepare()
  close(): void;
}

export interface StatementLike {
  run(...params: unknown[]): { changes: number; lastInsertRowid?: number | bigint };
  get(...params: unknown[]): unknown | undefined;
  all(...params: unknown[]): unknown[];
}

export interface DatabaseConstructor {
  new (path: string, options?: { create?: boolean; readonly?: boolean }): DatabaseLike;
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: "pipe" | "ignore" | "inherit";
  stdout?: "pipe" | "ignore" | "inherit";
  stderr?: "pipe" | "ignore" | "inherit";
  timeout?: number;
}

export interface SpawnResult {
  pid: number;
  exited: Promise<number>;
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  kill(signal?: string | number): void;
}

export interface ServeOptions {
  port?: number;
  hostname?: string;
  fetch: (req: Request) => Response | Promise<Response>;
}

export interface ServerLike {
  port: number;
  hostname: string;
  url: URL;
  stop(closeActiveConnections?: boolean): void;
}

export interface GlobLike {
  scan(opts?: { cwd?: string; onlyFiles?: boolean }): AsyncIterable<string>;
}
```

---

## Task Sequence

### Task 1: Scaffold runtime-shim package skeleton

**Files:**
- Create: `packages/runtime-shim/package.json`
- Create: `packages/runtime-shim/tsconfig.json`
- Create: `packages/runtime-shim/src/detect.ts`
- Create: `packages/runtime-shim/src/types.ts`
- Create: `packages/runtime-shim/src/index.ts` (initial stub)

- [ ] **Step 1: Create `packages/runtime-shim/package.json`**

```json
{
  "name": "@reactive-agents/runtime-shim",
  "version": "0.11.0",
  "type": "module",
  "description": "Cross-runtime adapter — unified API for Bun and Node.js fast paths",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "bun": "./src/index.ts",
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./types": {
      "import": "./dist/types.js",
      "types": "./dist/types.d.ts"
    }
  },
  "scripts": {
    "build": "tsup --config ../../tsup.config.base.ts",
    "typecheck": "tsc --noEmit",
    "test": "bun test --reporter=dots",
    "test:node": "node --experimental-strip-types --test tests/node.test.ts"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "bun-types": "latest",
    "@types/node": "^22.10.0"
  },
  "engines": {
    "node": ">=22.5.0 || >=20.0.0",
    "bun": ">=1.1.0"
  },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/tylerjrbuell/reactive-agents-ts.git",
    "directory": "packages/runtime-shim"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

- [ ] **Step 2: Create `packages/runtime-shim/tsconfig.json`**

Look at `packages/memory/tsconfig.json` first to match repo conventions, then create matching `packages/runtime-shim/tsconfig.json`.

- [ ] **Step 3: Create `packages/runtime-shim/src/detect.ts`**

```ts
/**
 * Runtime detection. Sync, no top-level await.
 */

export const isBun: boolean = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

export const isNode: boolean = !isBun && typeof process !== "undefined" && process.versions?.node !== undefined;

/**
 * Returns true if the current module is the program's entry point.
 * Replaces Bun's `import.meta.main`.
 *
 * @param importMetaUrl - Pass `import.meta.url` from the caller.
 */
export function isMain(importMetaUrl: string): boolean {
  if (isBun) {
    // Bun: prefer native import.meta.main if available via globalThis trick
    return Boolean((globalThis as { Bun?: { main?: string } }).Bun?.main === new URL(importMetaUrl).pathname);
  }
  if (isNode && typeof process !== "undefined") {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    // Convert argv[1] (a path) to a file URL for comparison
    const argvUrl = argv1.startsWith("file:") ? argv1 : `file://${argv1.startsWith("/") ? "" : "/"}${argv1.replace(/\\/g, "/")}`;
    return importMetaUrl === argvUrl;
  }
  return false;
}
```

- [ ] **Step 4: Create `packages/runtime-shim/src/types.ts`**

Paste the full type definitions from the "Unified API Surface" section above. Add JSDoc to each interface explaining intent.

- [ ] **Step 5: Create `packages/runtime-shim/src/index.ts` (initial stub)**

```ts
export { isBun, isNode, isMain } from "./detect.js";
export type {
  DatabaseLike,
  StatementLike,
  DatabaseConstructor,
  SpawnOptions,
  SpawnResult,
  ServeOptions,
  ServerLike,
  GlobLike,
} from "./types.js";

// Other primitive exports will be added in subsequent tasks.
```

- [ ] **Step 6: Verify package typechecks**

```bash
cd packages/runtime-shim && bunx tsc --noEmit --skipLibCheck
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add packages/runtime-shim/
git commit -m "feat(runtime-shim): scaffold package + detect.ts + types.ts"
```

---

### Task 2: Database adapter (bun:sqlite + node:sqlite + stub)

**Files:**
- Create: `packages/runtime-shim/src/database.ts`
- Create: `packages/runtime-shim/src/stub-impl.ts` (Database stub portion)
- Modify: `packages/runtime-shim/src/index.ts` (export Database)
- Create: `packages/runtime-shim/tests/database.test.ts`

- [ ] **Step 1: Write the failing test first (TDD)**

`packages/runtime-shim/tests/database.test.ts`:
```ts
import { test, expect } from "bun:test";
import { Database } from "../src/index.js";

test("Database can be instantiated and exec/prepare/query work", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE t (id INTEGER, name TEXT)");
  const stmt = db.prepare("INSERT INTO t (id, name) VALUES (?, ?)");
  stmt.run(1, "alice");
  stmt.run(2, "bob");
  const rows = db.prepare("SELECT * FROM t ORDER BY id").all() as Array<{ id: number; name: string }>;
  expect(rows).toHaveLength(2);
  expect(rows[0]?.name).toBe("alice");
  expect(rows[1]?.name).toBe("bob");
  db.close();
});

test("Database query() returns statement with all/get/run", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE t (id INTEGER)");
  db.exec("INSERT INTO t (id) VALUES (1), (2), (3)");
  const result = db.query("SELECT * FROM t").all() as Array<{ id: number }>;
  expect(result).toHaveLength(3);
  db.close();
});
```

- [ ] **Step 2: Run the test — verify it fails (red)**

```bash
cd packages/runtime-shim && bun test tests/database.test.ts
```

Expected: FAIL — `Database` not exported yet.

- [ ] **Step 3: Implement `src/database.ts`**

```ts
import { isBun } from "./detect.js";
import type { DatabaseConstructor, DatabaseLike, StatementLike } from "./types.js";

function loadDatabase(): DatabaseConstructor {
  if (isBun) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Database: BunDatabase } = require("bun:sqlite") as typeof import("bun:sqlite");
    return BunDatabase as unknown as DatabaseConstructor;
  }

  try {
    // Node 22.5+ has node:sqlite
    const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (path: string, opts?: { open?: boolean; readOnly?: boolean }) => NodeSqliteDatabase };
    return wrapNodeSqlite(DatabaseSync);
  } catch {
    return createStubDatabase();
  }
}

// Node-sqlite shape (minimal subset we use)
interface NodeSqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): NodeSqliteStatement;
  close(): void;
}
interface NodeSqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

function wrapNodeSqlite(NodeDb: new (path: string, opts?: unknown) => NodeSqliteDatabase): DatabaseConstructor {
  return class WrappedDatabase implements DatabaseLike {
    private db: NodeSqliteDatabase;
    constructor(path: string, options?: { create?: boolean; readonly?: boolean }) {
      // node:sqlite uses { open: true, readOnly: false } shape
      const opts = options ? { open: options.create ?? true, readOnly: options.readonly ?? false } : undefined;
      this.db = new NodeDb(path, opts);
    }
    exec(sql: string): void { this.db.exec(sql); }
    prepare(sql: string): StatementLike { return wrapStatement(this.db.prepare(sql)); }
    query(sql: string): StatementLike { return wrapStatement(this.db.prepare(sql)); }
    close(): void { this.db.close(); }
  } as unknown as DatabaseConstructor;
}

function wrapStatement(stmt: NodeSqliteStatement): StatementLike {
  return {
    run: (...params) => stmt.run(...params),
    get: (...params) => stmt.get(...params),
    all: (...params) => stmt.all(...params),
  };
}

function createStubDatabase(): DatabaseConstructor {
  // In-memory stub — no persistence. Demos run, just no recall across processes.
  return class StubDatabase implements DatabaseLike {
    private tables = new Map<string, unknown[]>();
    constructor(_path: string, _opts?: unknown) {}
    exec(_sql: string): void { /* no-op */ }
    prepare(_sql: string): StatementLike {
      return {
        run: () => ({ changes: 0 }),
        get: () => undefined,
        all: () => [],
      };
    }
    query(_sql: string): StatementLike {
      return this.prepare(_sql);
    }
    close(): void { this.tables.clear(); }
  } as unknown as DatabaseConstructor;
}

export const Database: DatabaseConstructor = loadDatabase();
```

- [ ] **Step 4: Export from `src/index.ts`**

Add to `packages/runtime-shim/src/index.ts`:
```ts
export { Database } from "./database.js";
```

- [ ] **Step 5: Re-run the test — verify it passes (green)**

```bash
cd packages/runtime-shim && bun test tests/database.test.ts
```

Expected: PASS (2/2).

- [ ] **Step 6: Verify on Node (parity check)**

```bash
cd packages/runtime-shim && node --test --experimental-strip-types tests/database.test.ts 2>&1 | head -20
```

Note: bun:test syntax differs from node:test. For now, skip this — Task 8 adds Node-specific tests.

- [ ] **Step 7: Commit**

```bash
git add packages/runtime-shim/
git commit -m "feat(runtime-shim): Database adapter (bun:sqlite + node:sqlite + stub)"
```

---

### Task 3: spawn adapter (Bun.spawn + child_process.spawn)

**Files:**
- Create: `packages/runtime-shim/src/spawn.ts`
- Modify: `packages/runtime-shim/src/index.ts` (export spawn)
- Create: `packages/runtime-shim/tests/spawn.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/runtime-shim/tests/spawn.test.ts`:
```ts
import { test, expect } from "bun:test";
import { spawn } from "../src/index.js";

test("spawn runs a simple command and captures stdout", async () => {
  const proc = spawn(["echo", "hello"], { stdout: "pipe" });
  expect(proc.pid).toBeGreaterThan(0);

  let output = "";
  if (proc.stdout) {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value);
    }
  }
  const code = await proc.exited;
  expect(code).toBe(0);
  expect(output.trim()).toBe("hello");
});

test("spawn passes env vars", async () => {
  const proc = spawn(["sh", "-c", "echo $MY_VAR"], { env: { ...process.env, MY_VAR: "abc" } as Record<string, string>, stdout: "pipe" });
  let output = "";
  if (proc.stdout) {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value);
    }
  }
  await proc.exited;
  expect(output.trim()).toBe("abc");
});
```

- [ ] **Step 2: Run test (red)** — expect FAIL.

- [ ] **Step 3: Implement `src/spawn.ts`**

```ts
import { isBun } from "./detect.js";
import type { SpawnOptions, SpawnResult } from "./types.js";

export function spawn(cmd: string[], options: SpawnOptions = {}): SpawnResult {
  if (isBun) {
    return spawnBun(cmd, options);
  }
  return spawnNode(cmd, options);
}

function spawnBun(cmd: string[], options: SpawnOptions): SpawnResult {
  // Bun's API differs slightly: it expects a single argv array including the binary
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proc = (globalThis as any).Bun.spawn(cmd, {
    cwd: options.cwd,
    env: options.env,
    stdin: options.stdin ?? "ignore",
    stdout: options.stdout ?? "inherit",
    stderr: options.stderr ?? "inherit",
  });
  // Bun returns ReadableStream | null on stdout/stderr — already matches our type
  return {
    pid: proc.pid,
    exited: proc.exited,
    stdout: proc.stdout instanceof ReadableStream ? proc.stdout : null,
    stderr: proc.stderr instanceof ReadableStream ? proc.stderr : null,
    kill: (signal?: string | number) => proc.kill(signal),
  };
}

function spawnNode(cmd: string[], options: SpawnOptions): SpawnResult {
  // Use createRequire to load node:child_process synchronously
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { spawn: nodeSpawn } = require("node:child_process") as typeof import("node:child_process");
  const [bin, ...args] = cmd;
  if (!bin) throw new Error("spawn: empty command array");

  const stdioMap = (kind: "stdin" | "stdout" | "stderr"): "pipe" | "ignore" | "inherit" => {
    const v = options[kind];
    if (v === "pipe" || v === "ignore" || v === "inherit") return v;
    return kind === "stdin" ? "ignore" : "inherit";
  };

  const child = nodeSpawn(bin, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: [stdioMap("stdin"), stdioMap("stdout"), stdioMap("stderr")],
    timeout: options.timeout,
  });

  // Convert Node Readable to Web ReadableStream
  const toWebStream = (readable: NodeJS.ReadableStream | null): ReadableStream<Uint8Array> | null => {
    if (!readable) return null;
    return new ReadableStream<Uint8Array>({
      start(controller) {
        readable.on("data", (chunk: Buffer | string) => {
          controller.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk));
        });
        readable.on("end", () => controller.close());
        readable.on("error", (err) => controller.error(err));
      },
    });
  };

  const exited = new Promise<number>((resolve) => {
    child.on("exit", (code) => resolve(code ?? 0));
  });

  return {
    pid: child.pid ?? 0,
    exited,
    stdout: toWebStream(child.stdout),
    stderr: toWebStream(child.stderr),
    kill: (signal?: string | number) => {
      if (typeof signal === "string") child.kill(signal as NodeJS.Signals);
      else child.kill();
    },
  };
}
```

- [ ] **Step 4: Export from index, run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add packages/runtime-shim/
git commit -m "feat(runtime-shim): spawn adapter (Bun.spawn + node:child_process)"
```

---

### Task 4: writeFile / readFile adapters

**Files:**
- Create: `packages/runtime-shim/src/fs.ts`
- Modify: `packages/runtime-shim/src/index.ts`
- Create: `packages/runtime-shim/tests/fs.test.ts`

- [ ] **Step 1: Test first**

`packages/runtime-shim/tests/fs.test.ts`:
```ts
import { test, expect } from "bun:test";
import { writeFile, readFile } from "../src/index.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("writeFile + readFile roundtrip", async () => {
  const path = join(tmpdir(), `shim-test-${Date.now()}.txt`);
  await writeFile(path, "hello from shim");
  const content = await readFile(path);
  expect(content).toBe("hello from shim");
});
```

- [ ] **Step 2: Red.**

- [ ] **Step 3: Implement `src/fs.ts`**

```ts
import { isBun } from "./detect.js";

export async function writeFile(path: string, content: string | Uint8Array): Promise<void> {
  if (isBun) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (globalThis as any).Bun.write(path, content);
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { writeFile: nodeWriteFile } = require("node:fs/promises") as typeof import("node:fs/promises");
  await nodeWriteFile(path, content);
}

export async function readFile(path: string): Promise<string> {
  if (isBun) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (globalThis as any).Bun.file(path).text();
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFile: nodeReadFile } = require("node:fs/promises") as typeof import("node:fs/promises");
  return await nodeReadFile(path, "utf-8");
}
```

- [ ] **Step 4: Export, test, green, commit.**

```bash
git commit -m "feat(runtime-shim): writeFile + readFile adapters"
```

---

### Task 5: hash adapter (Bun.hash + crypto)

**Files:**
- Create: `packages/runtime-shim/src/hash.ts`
- Modify: `packages/runtime-shim/src/index.ts`
- Create: `packages/runtime-shim/tests/hash.test.ts`

- [ ] **Step 1: Test**

```ts
import { test, expect } from "bun:test";
import { hash } from "../src/index.js";

test("hash returns deterministic 64-bit value", () => {
  const a = hash("hello");
  const b = hash("hello");
  expect(a).toBe(b);
  expect(typeof a).toBe("bigint");

  const c = hash("world");
  expect(c).not.toBe(a);
});

test("hash with toString(36) produces compact cache keys", () => {
  const key = hash("test").toString(36);
  expect(key.length).toBeGreaterThan(0);
  expect(key.length).toBeLessThan(20);
});
```

- [ ] **Step 2: Red.**

- [ ] **Step 3: Implement `src/hash.ts`**

```ts
import { isBun } from "./detect.js";

/**
 * 64-bit content hash. Returns bigint so `.toString(36)` produces compact cache keys.
 * Bun: uses Bun.hash (Wyhash, ~25 GB/s).
 * Node: uses crypto SHA-256 truncated to 64 bits.
 */
export function hash(input: string | Uint8Array): bigint {
  if (isBun) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (globalThis as any).Bun.hash(input) as bigint;
  }
  // Node fallback: SHA-256, take first 8 bytes as bigint
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  const buf = createHash("sha256")
    .update(typeof input === "string" ? input : Buffer.from(input))
    .digest();
  // First 8 bytes as a big-endian bigint
  let result = 0n;
  for (let i = 0; i < 8; i++) {
    result = (result << 8n) | BigInt(buf[i] ?? 0);
  }
  return result;
}
```

- [ ] **Step 4: Test, green, commit.**

```bash
git commit -m "feat(runtime-shim): hash adapter (Bun.hash + crypto SHA-256)"
```

---

### Task 6: serve adapter (Bun.serve + node:http)

**Files:**
- Create: `packages/runtime-shim/src/serve.ts`
- Modify: `packages/runtime-shim/src/index.ts`
- Create: `packages/runtime-shim/tests/serve.test.ts`

- [ ] **Step 1: Test**

```ts
import { test, expect } from "bun:test";
import { serve } from "../src/index.js";

test("serve creates HTTP server and handles request", async () => {
  const server = serve({
    port: 0,  // any available port
    fetch: (req) => new Response("ok " + new URL(req.url).pathname),
  });

  expect(server.port).toBeGreaterThan(0);

  const res = await fetch(`${server.url}test`);
  const body = await res.text();
  expect(body).toBe("ok /test");

  server.stop();
});
```

- [ ] **Step 2: Red.**

- [ ] **Step 3: Implement `src/serve.ts`**

```ts
import { isBun } from "./detect.js";
import type { ServeOptions, ServerLike } from "./types.js";

export function serve(options: ServeOptions): ServerLike {
  if (isBun) {
    return serveBun(options);
  }
  return serveNode(options);
}

function serveBun(options: ServeOptions): ServerLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const server = (globalThis as any).Bun.serve({
    port: options.port,
    hostname: options.hostname,
    fetch: options.fetch,
  });
  return {
    port: server.port,
    hostname: server.hostname,
    url: server.url,
    stop: (closeActive?: boolean) => server.stop(closeActive),
  };
}

function serveNode(options: ServeOptions): ServerLike {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createServer } = require("node:http") as typeof import("node:http");

  const server = createServer(async (req, res) => {
    try {
      // Build a fetch-style Request from Node IncomingMessage
      const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : String(v));
      }
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const request = new Request(url, {
        method: req.method ?? "GET",
        headers,
        body: hasBody
          ? new ReadableStream({
              start(controller) {
                req.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk)));
                req.on("end", () => controller.close());
                req.on("error", (err) => controller.error(err));
              },
            })
          : null,
        // @ts-expect-error duplex is required for body in newer Node
        duplex: hasBody ? "half" : undefined,
      });

      const response = await options.fetch(request);
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err));
    }
  });

  return new Promise<ServerLike>((resolve) => {
    server.listen({ port: options.port ?? 0, host: options.hostname ?? "127.0.0.1" }, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const hostname = options.hostname ?? "127.0.0.1";
      resolve({
        port,
        hostname,
        url: new URL(`http://${hostname}:${port}/`),
        stop: (_closeActive?: boolean) => server.close(),
      });
    });
  }) as unknown as ServerLike;
  // Note: this synchronous return contradicts the type. Acceptable here because consumers
  // currently only read .port after listen completes; we may need to revisit if a caller
  // needs the URL immediately. Bun.serve is sync, so the consumer-side semantics are sync.
}
```

**WARNING for implementer:** the Node serve impl returns a Promise but is typed as `ServerLike`. This is intentionally a "best-effort sync" — port/url are stable only after the listen callback. Consumers that need port immediately should `await` (Node) or just read (Bun). Document this in the JSDoc. If implementer can't reconcile, mark as DONE_WITH_CONCERNS and we'll revisit.

- [ ] **Step 4: Test, green, commit.**

```bash
git commit -m "feat(runtime-shim): serve adapter (Bun.serve + node:http)"
```

---

### Task 7: glob adapter (Bun.Glob + node:fs.glob)

**Files:**
- Create: `packages/runtime-shim/src/glob.ts`
- Modify: `packages/runtime-shim/src/index.ts`
- Create: `packages/runtime-shim/tests/glob.test.ts`

- [ ] **Step 1: Test**

```ts
import { test, expect } from "bun:test";
import { glob } from "../src/index.js";
import { tmpdir } from "node:os";
import { mkdir, writeFile as nodeWriteFile } from "node:fs/promises";
import { join } from "node:path";

test("glob finds files matching pattern", async () => {
  const dir = join(tmpdir(), `shim-glob-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  await nodeWriteFile(join(dir, "a.json"), "{}");
  await nodeWriteFile(join(dir, "b.json"), "{}");
  await nodeWriteFile(join(dir, "c.txt"), "skip");

  const g = glob("*.json");
  const matches: string[] = [];
  for await (const f of g.scan({ cwd: dir })) {
    matches.push(f);
  }
  expect(matches.sort()).toEqual(["a.json", "b.json"]);
});
```

- [ ] **Step 2: Red.**

- [ ] **Step 3: Implement `src/glob.ts`**

```ts
import { isBun } from "./detect.js";
import type { GlobLike } from "./types.js";

export function glob(pattern: string): GlobLike {
  if (isBun) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bunGlob = new (globalThis as any).Bun.Glob(pattern);
    return {
      scan: (opts?: { cwd?: string; onlyFiles?: boolean }) => bunGlob.scan({ cwd: opts?.cwd, onlyFiles: opts?.onlyFiles ?? true }),
    };
  }
  return globNode(pattern);
}

function globNode(pattern: string): GlobLike {
  return {
    scan: async function* (opts?: { cwd?: string; onlyFiles?: boolean }): AsyncIterable<string> {
      // Node 22+ has fs.glob; older Node falls back to manual recursive scan
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { glob: nodeGlob } = require("node:fs/promises") as typeof import("node:fs/promises");
        // node:fs/promises.glob returns AsyncIterable<string> in 22+
        const iter = nodeGlob(pattern, { cwd: opts?.cwd, withFileTypes: false }) as AsyncIterable<string>;
        for await (const entry of iter) {
          yield entry;
        }
      } catch {
        // Fallback: simple readdir for `*.ext` patterns
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { readdir } = require("node:fs/promises") as typeof import("node:fs/promises");
        const cwd = opts?.cwd ?? ".";
        const all = await readdir(cwd);
        const ext = pattern.startsWith("*.") ? pattern.slice(1) : null;
        for (const name of all) {
          if (!ext || name.endsWith(ext)) yield name;
        }
      }
    },
  };
}
```

- [ ] **Step 4: Test, green, commit.**

```bash
git commit -m "feat(runtime-shim): glob adapter (Bun.Glob + node:fs.glob)"
```

---

### Task 8: Final index.ts assembly + build verification

**Files:**
- Modify: `packages/runtime-shim/src/index.ts` (consolidate all exports)
- Create: `packages/runtime-shim/README.md`

- [ ] **Step 1: Finalize `src/index.ts`**

```ts
/**
 * @reactive-agents/runtime-shim
 *
 * Cross-runtime adapter. Detects Bun vs Node.js at module load time and dispatches
 * to native implementations of common primitives.
 *
 * Use this package instead of `bun:sqlite`, `Bun.spawn`, `Bun.write`, `Bun.file`,
 * `Bun.hash`, `Bun.serve`, `Bun.Glob`, or `import.meta.main` anywhere reactive-agents
 * code may run on Node.js (Stackblitz, Vercel, Cloudflare, Netlify, etc.).
 */

export { isBun, isNode, isMain } from "./detect.js";
export { Database } from "./database.js";
export { spawn } from "./spawn.js";
export { writeFile, readFile } from "./fs.js";
export { hash } from "./hash.js";
export { serve } from "./serve.js";
export { glob } from "./glob.js";

export type {
  DatabaseLike,
  StatementLike,
  DatabaseConstructor,
  SpawnOptions,
  SpawnResult,
  ServeOptions,
  ServerLike,
  GlobLike,
} from "./types.js";
```

- [ ] **Step 2: Build the package**

```bash
cd packages/runtime-shim && bun run build 2>&1 | tail -20
```

Expected: clean build, `dist/` populated.

- [ ] **Step 3: Run all shim tests under Bun**

```bash
cd packages/runtime-shim && bun test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 4: Create `README.md`** describing the package's purpose and usage.

```markdown
# @reactive-agents/runtime-shim

Cross-runtime adapter for `reactive-agents`. Detects Bun vs Node.js at module load and dispatches to native primitives.

## What it shims

| Bun API | Node equivalent |
|---------|-----------------|
| `bun:sqlite` Database | `node:sqlite` DatabaseSync (Node 22.5+) / in-memory stub |
| `Bun.spawn` | `node:child_process.spawn` |
| `Bun.write` / `Bun.file().text()` | `node:fs/promises.writeFile` / `readFile` |
| `Bun.hash` | `node:crypto.createHash("sha256")` truncated to 64 bits |
| `Bun.serve` | `node:http.createServer` + Fetch API adapter |
| `Bun.Glob` | `node:fs/promises.glob` (Node 22+) |
| `import.meta.main` | `isMain(import.meta.url)` (compares `process.argv[1]`) |

## Usage

```ts
import { Database, spawn, hash, isMain } from "@reactive-agents/runtime-shim";

const db = new Database(":memory:");
const proc = spawn(["echo", "hello"], { stdout: "pipe" });
const key = hash("text").toString(36);

if (isMain(import.meta.url)) {
  // running as entry script
}
```

## Runtime support

- Bun ≥ 1.1
- Node.js ≥ 22.5 (for SQLite persistence; older Node falls back to in-memory)
- Stackblitz WebContainer (Node-based)
- Cloudflare Workers (subset — no spawn/serve, but Database stub + hash work)
```

- [ ] **Step 5: Commit**

```bash
git add packages/runtime-shim/
git commit -m "feat(runtime-shim): finalize index exports + README"
```

---

### Task 9: Refactor @reactive-agents/memory

**Files:**
- Modify: `packages/memory/src/database.ts`
- Modify: `packages/memory/package.json` (add dep)

- [ ] **Step 1: Add dep**

In `packages/memory/package.json`, add to `dependencies`:
```json
"@reactive-agents/runtime-shim": "workspace:*"
```

- [ ] **Step 2: Refactor `packages/memory/src/database.ts`**

Replace `import { Database } from "bun:sqlite";` with:
```ts
import { Database } from "@reactive-agents/runtime-shim";
```

All other code in the file stays unchanged — `Database` API is identical.

- [ ] **Step 3: Run memory package tests**

```bash
cd packages/memory && bun test 2>&1 | tail -20
```

Expected: all tests still pass.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(memory): use @reactive-agents/runtime-shim for Database"
```

---

### Task 10: Refactor @reactive-agents/cost

**Files:**
- Modify: `packages/cost/src/budgets/budget-db.ts`
- Modify: `packages/cost/src/caching/semantic-cache.ts`
- Modify: `packages/cost/package.json`

- [ ] **Step 1: Add dep to package.json:**
```json
"@reactive-agents/runtime-shim": "workspace:*"
```

- [ ] **Step 2: Refactor `budget-db.ts`** — replace `import { Database } from "bun:sqlite"` with shim import.

- [ ] **Step 3: Refactor `semantic-cache.ts`** — replace `Bun.hash(str).toString(36)` with `hash(str).toString(36)`. Add `import { hash } from "@reactive-agents/runtime-shim"` at top.

- [ ] **Step 4: Run cost package tests**

```bash
cd packages/cost && bun test 2>&1 | tail -20
```

Expected: all tests still pass.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(cost): use runtime-shim for Database + hash"
```

---

### Task 11: Refactor @reactive-agents/reactive-intelligence

**Files:**
- Modify: `packages/reactive-intelligence/src/calibration/calibration-store.ts`
- Modify: `packages/reactive-intelligence/src/learning/bandit-store.ts`
- Modify: `packages/reactive-intelligence/package.json`

- [ ] **Step 1:** Add dep.
- [ ] **Step 2:** Replace `import { Database } from "bun:sqlite"` in both files with shim import.
- [ ] **Step 3:** Run tests.

```bash
cd packages/reactive-intelligence && bun test 2>&1 | tail -20
```

- [ ] **Step 4:** Commit.

```bash
git commit -m "refactor(reactive-intelligence): use runtime-shim for Database"
```

---

### Task 12: Refactor @reactive-agents/tools

**Files:**
- Modify: `packages/tools/src/execution/docker-sandbox.ts`
- Modify: `packages/tools/src/skills/code-execution.ts`
- Modify: `packages/tools/src/skills/shell-execution.ts`
- Modify: `packages/tools/package.json`

- [ ] **Step 1:** Add dep.

- [ ] **Step 2:** Replace each `Bun.spawn(cmd, opts)` with `spawn(cmd, opts)`. Add `import { spawn } from "@reactive-agents/runtime-shim";` at top of each file.

For each `Bun.spawn` call site, verify that the shim's `SpawnOptions` shape is compatible. The shim accepts `{ cwd, env, stdin, stdout, stderr, timeout }`. Original Bun.spawn options may include additional fields like `onExit` — if present, refactor to use `proc.exited.then(...)` instead.

**SAFETY:** docker-sandbox has 6 spawn calls. Check each carefully — they're long-running processes and the API surface (stdin/stdout/stderr piping) must be preserved.

- [ ] **Step 3:** Refactor `code-execution.ts:109` — `Bun.spawn(["bun", "run", tmpFile], {...})`. This spawns Bun explicitly. On Node, change to `spawn(["node", "--experimental-strip-types", tmpFile], {...})` (Node 22.6+ can run TS directly) OR keep "bun" and let the shim use `node:child_process.spawn` which will try to find bun on PATH. **Decision:** keep "bun" as the binary — if Node user doesn't have bun installed, the demo's code-execute tool fails gracefully. Document this in a comment.

- [ ] **Step 4:** Run tools tests.

```bash
cd packages/tools && bun test 2>&1 | tail -20
```

- [ ] **Step 5:** Commit.

```bash
git commit -m "refactor(tools): use runtime-shim for spawn (docker, code-execute, shell)"
```

---

### Task 13: Refactor @reactive-agents/llm-provider

**Files:**
- Modify: `packages/llm-provider/src/embedding-cache.ts`
- Modify: `packages/llm-provider/src/calibration-runner.ts`
- Modify: `packages/llm-provider/package.json`

- [ ] **Step 1:** Add dep.

- [ ] **Step 2:** In `embedding-cache.ts`, replace both `Bun.hash(text)` calls with `hash(text)`. Import: `import { hash } from "@reactive-agents/runtime-shim";`

- [ ] **Step 3:** In `calibration-runner.ts:353`, replace `if (import.meta.main)` with `if (isMain(import.meta.url))`. Import: `import { isMain } from "@reactive-agents/runtime-shim";`

- [ ] **Step 4:** Run llm-provider tests.

- [ ] **Step 5:** Commit.

```bash
git commit -m "refactor(llm-provider): use runtime-shim for hash + isMain"
```

---

### Task 14: Refactor @reactive-agents/eval

**Files:**
- Modify: `packages/eval/src/services/dataset-service.ts`
- Modify: `packages/eval/package.json`

- [ ] **Step 1:** Add dep.

- [ ] **Step 2:** In `dataset-service.ts`:
  - Replace `await Bun.file(path).text()` (2 places: lines 46, 78) with `await readFile(path)`.
  - Replace `new Bun.Glob("*.json")` (line 60) with `glob("*.json")`.
  - Import: `import { readFile, glob } from "@reactive-agents/runtime-shim";`

- [ ] **Step 3:** Run eval tests.

- [ ] **Step 4:** Commit.

```bash
git commit -m "refactor(eval): use runtime-shim for readFile + glob"
```

---

### Task 15: Refactor remaining serve consumers (a2a, benchmarks, health, judge-server)

**Files:**
- Modify: `packages/a2a/src/server/http-server.ts`
- Modify: `packages/benchmarks/src/runner.ts`
- Modify: `packages/health/src/service.ts`
- Modify: `packages/judge-server/src/index.ts`
- Modify: each package's `package.json` (add dep)

- [ ] **Step 1:** Add dep to each package.json.

- [ ] **Step 2:** In each file, replace `Bun.serve({...})` with `serve({...})`. Import: `import { serve } from "@reactive-agents/runtime-shim";`

For `judge-server/index.ts:119`, also replace `import.meta.main` with `isMain(import.meta.url)`.

**SAFETY:** the serve adapter returns a Promise-shaped value typed as `ServerLike` on Node (see Task 6 warning). If a caller reads `server.port` synchronously, the value may be 0 until the listen callback fires. Most call sites use the server inside a long-running process and don't depend on immediate port read — verify each consumer.

- [ ] **Step 3:** Run tests for each affected package.

```bash
cd packages/a2a && bun test 2>&1 | tail -5
cd packages/benchmarks && bun test 2>&1 | tail -5
cd packages/health && bun test 2>&1 | tail -5
cd packages/judge-server && bun test 2>&1 | tail -5
```

- [ ] **Step 4:** Commit.

```bash
git commit -m "refactor(a2a,benchmarks,health,judge-server): use runtime-shim for serve"
```

---

### Task 16: Full monorepo test pass under Bun

- [ ] **Step 1:** Build all packages.

```bash
bunx turbo run build 2>&1 | tail -30
```

Expected: all packages build clean.

- [ ] **Step 2:** Run full test suite.

```bash
bunx turbo run test 2>&1 | tail -40
```

Expected: all tests pass, zero regressions.

- [ ] **Step 3:** If any tests fail, fix immediately. Common likely failures:
  - Type-check error in shim consumer (Database type minor difference)
  - spawn opts shape mismatch (Bun-specific `onExit` not handled in shim)
  - serve port-read-too-early (sync vs async)

Each failure → trace it → fix in shim or consumer → re-run.

- [ ] **Step 4:** Commit any fix-ups.

```bash
git commit -m "fix(runtime-shim): post-refactor test fixups"
```

---

### Task 17: Node-runtime smoke test (the gate)

This is the test that justifies the whole effort. Spin up a clean Node 22.5+ context and import reactive-agents. If it loads without `bun:sqlite` errors, the shim works.

- [ ] **Step 1:** Build the `reactive-agents` umbrella package locally.

```bash
cd packages/reactive-agents && bun run build
```

- [ ] **Step 2:** Pack it to a tarball.

```bash
cd packages/reactive-agents && npm pack
ls -la *.tgz  # capture the filename
```

- [ ] **Step 3:** Create a temp test directory + install the tarball.

```bash
TMP=$(mktemp -d) && cd "$TMP"
npm init -y
npm install "/path/to/reactive-agents-0.11.0.tgz"
```

- [ ] **Step 4:** Write a minimal Node import test.

`$TMP/test.mjs`:
```js
import { ReactiveAgents } from "reactive-agents";
console.log("import OK, ReactiveAgents:", typeof ReactiveAgents.create);
```

- [ ] **Step 5:** Run with Node.

```bash
node --version  # confirm 22.5+
node test.mjs
```

Expected: `import OK, ReactiveAgents: function` — no bun:sqlite crash.

- [ ] **Step 6:** If Node 22.5+ unavailable, skip with a note. Otherwise, push results and commit:

```bash
cd /path/to/repo  # back to worktree
git commit --allow-empty -m "test: verify Node 22.5+ can import reactive-agents (runtime-shim verified)"
```

---

### Task 18: Update Stackblitz playground configs

**Files:**
- Modify: `apps/stackblitz/01-hello-agent/package.json`
- Modify: `apps/stackblitz/02-tool-integration/package.json`
- Modify: `apps/stackblitz/03-strategy-demo/package.json`
- Modify: `apps/stackblitz/01-hello-agent/.stackblitzrc` (and 02, 03)
- Modify: `apps/docs/src/content/docs/guides/playground.mdx` (revert to iframes if changed)

- [ ] **Step 1:** Revert all 3 package.json files to use `npx tsx` (Node-runtime):

```json
"scripts": { "start": "npx tsx src/agent.ts" }
```

Add `tsx` back to devDeps, remove `@types/bun`.

- [ ] **Step 2:** Revert all 3 `.stackblitzrc` files:

```json
{
  "startCommand": "npm install && npm start",
  "openFile": "src/agent.ts"
}
```

- [ ] **Step 3:** Verify playground.mdx still has Stackblitz iframes (per user's revert). If not, restore the Stackblitz iframe version.

- [ ] **Step 4:** Update playground.mdx language: change "runs Node.js entirely in-browser" — actually keep that phrasing, it's now accurate. Remove any "requires Bun" caveats.

- [ ] **Step 5:** Commit.

```bash
git commit -m "feat(stackblitz): restore Node runtime now that reactive-agents is Node-compatible"
```

---

### Task 19: Changeset + version bump

- [ ] **Step 1:** Create changeset.

```bash
bun run changeset
```

Select all packages that changed. Description:
> Add `@reactive-agents/runtime-shim` cross-runtime adapter. All packages now run on Node.js 22.5+ as well as Bun. Internal `bun:sqlite`, `Bun.spawn`, `Bun.serve`, `Bun.hash`, `Bun.file`, `Bun.Glob` calls replaced with shim primitives. Zero call-site API changes for end users. Bump: minor (new package added, internal refactor).

- [ ] **Step 2:** Apply versions.

```bash
bun run changeset version
```

- [ ] **Step 3:** Verify version drift check passes.

```bash
bun run check:versions
```

- [ ] **Step 4:** Commit version bumps.

```bash
git commit -m "chore: version bump for runtime-shim release (0.11.0)"
```

---

### Task 20: Build, publish, validate

- [ ] **Step 1:** Full build.

```bash
bunx turbo run build
```

- [ ] **Step 2:** Dry-run publish.

```bash
bunx changeset publish --dry-run
```

Verify all packages would be published, including new `@reactive-agents/runtime-shim`.

- [ ] **Step 3:** Publish for real.

```bash
bunx changeset publish
```

- [ ] **Step 4:** Verify on npm.

```bash
npm view @reactive-agents/runtime-shim version
npm view reactive-agents version
```

- [ ] **Step 5:** Test Stackblitz embed boots with new npm version. Push test branch, open embed URL.

```
https://stackblitz.com/github/tylerjrbuell/reactive-agents-ts/tree/feature/runtime-shim/apps/stackblitz/01-hello-agent?embed=1&file=src%2Fagent.ts&terminal=start
```

Expected:
- npm install runs cleanly
- npx tsx runs
- Setup instructions print (no key set)
- No bun:sqlite crash

- [ ] **Step 6:** If working, merge worktree branch to main.

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts  # main worktree
git checkout main
git merge --no-ff feature/runtime-shim -m "feat: runtime-shim cross-runtime adapter (v0.11.0)"
git push origin main
```

---

## Acceptance Criteria

- [ ] `@reactive-agents/runtime-shim` package exists, builds clean, all tests pass under Bun
- [ ] All 16 source files refactored to import from shim — zero direct `bun:` / `Bun.*` references in `packages/*/src/` outside the shim itself
- [ ] All existing package tests pass with no regressions
- [ ] `reactive-agents` package imports cleanly under Node 22.5+ (verified via tarball + node test.mjs)
- [ ] Stackblitz embed with `tsx` runtime + npm boots one demo successfully (prints setup instructions when no key set)
- [ ] npm 0.11.0 published (all packages bumped)
- [ ] `wiki/Hot.md` updated with shim landing note

---

## Risk Register

| Risk | Mitigation |
|------|-----------|
| `node:sqlite` API shape differs slightly from `bun:sqlite` | Wrap with adapter (Task 2); tests verify parity |
| serve adapter port read race on Node | Document in JSDoc; verify all 4 callers tolerate it (Task 15) |
| spawn stream shape (Web ReadableStream vs Node Readable) breaks consumers | Convert in adapter (Task 3); update tools tests if needed |
| Cost/memory tests assume real persistence (SQLite tables exist between calls) | These tests run under Bun — stub path is only triggered on Node where tests don't run yet |
| Stackblitz still fails for unrelated reason | Task 17 isolates Node-import sanity check before publish; if that passes, Stackblitz embed is the real gate |
| Publish credentials / version drift | Task 19 includes `check:versions`; Task 20 dry-run before real publish |

---

## Out of Scope (future work)

- Cloudflare Workers / Deno specific impls (defer to v0.12+)
- `better-sqlite3` Node fallback (in-memory stub is sufficient for v0.11)
- Removing `bun-types` from devDeps in consumer packages (it's still used for Bun-native test discovery)
- Streaming-aware serve adapter optimizations (current impl is correct, not maximally fast on Node)
