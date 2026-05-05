# Node.js Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all Bun-specific APIs with Node-compatible equivalents so `reactive-agents` runs on Node.js ≥20 without crashes, with both runtimes verified in CI.

**Architecture:** No abstraction layers — use cross-runtime Node APIs directly. Bun supports all `node:*` built-ins natively, so swapping to `node:child_process`, `node:crypto`, `node:fs/promises` makes code work on both without any runtime detection. SQLite is the only exception: replace `bun:sqlite` with `better-sqlite3` (sync API, same shape, runs on both). HTTP servers swap from `Bun.serve` to Hono + `@hono/node-server`. Every change is a leaf-level swap with no interface changes to Effect services or builder API.

**Tech Stack:** `node:child_process`, `node:crypto`, `node:fs/promises`, `better-sqlite3` + `@types/better-sqlite3`, `hono`, `@hono/node-server`, `fast-glob`, `vitest`

**Work in a git worktree** — run `/superpowers:using-git-worktrees` first if not already in one.

---

## File Map

| File | Change |
|---|---|
| `packages/cost/src/caching/semantic-cache.ts` | `Bun.hash` → `node:crypto` |
| `packages/llm-provider/src/embedding-cache.ts` | `Bun.hash` → `node:crypto` |
| `packages/tools/src/skills/code-execution.ts` | `Bun.spawn` → `node:child_process.spawn` |
| `packages/tools/src/execution/docker-sandbox.ts` | `Bun.spawn` → `node:child_process.spawn` |
| `packages/eval/src/services/dataset-service.ts` | `Bun.file`/`Bun.Glob` → `node:fs/promises` + `fast-glob` |
| `packages/memory/src/database.ts` | `bun:sqlite` → `better-sqlite3` |
| `packages/cost/src/budgets/budget-db.ts` | `bun:sqlite` → `better-sqlite3` |
| `packages/reactive-intelligence/src/learning/bandit-store.ts` | `bun:sqlite` → `better-sqlite3` |
| `packages/reactive-intelligence/src/calibration/calibration-store.ts` | `bun:sqlite` → `better-sqlite3` |
| `packages/health/src/service.ts` | `Bun.serve` → Hono + `@hono/node-server` |
| `packages/a2a/src/server/http-server.ts` | `Bun.serve` → Hono + `@hono/node-server` |
| `apps/cli/tsup.config.ts` | shebang `#!/usr/bin/env bun` → runtime-detect |
| `packages/*/tsconfig.json` (25 files) | remove `bun-types` from types array in publishable packages |
| `packages/*/package.json` (affected 6) | add `better-sqlite3`/`hono` deps + `engines` field |
| `vitest.config.ts` (new) | root vitest config for Node test runs |
| `.github/workflows/ci.yml` | add Node 20 + 22 matrix jobs |

---

## Task 1: Add dependencies and engines field

**Files:**
- Modify: `packages/memory/package.json`
- Modify: `packages/cost/package.json`
- Modify: `packages/reactive-intelligence/package.json`
- Modify: `packages/a2a/package.json`
- Modify: `packages/health/package.json`
- Modify: `packages/eval/package.json`

- [ ] **Step 1: Add `better-sqlite3` to memory, cost, and reactive-intelligence packages**

```bash
cd packages/memory && bun add better-sqlite3 && bun add -d @types/better-sqlite3
cd ../cost && bun add better-sqlite3 && bun add -d @types/better-sqlite3
cd ../reactive-intelligence && bun add better-sqlite3 && bun add -d @types/better-sqlite3
```

- [ ] **Step 2: Add `hono` and `@hono/node-server` to a2a and health packages**

```bash
cd packages/a2a && bun add hono @hono/node-server
cd ../health && bun add hono @hono/node-server
```

- [ ] **Step 3: Add `fast-glob` to eval package**

```bash
cd packages/eval && bun add fast-glob
```

- [ ] **Step 4: Add `engines` field to all affected package.json files**

In each of the 6 package.json files above, add after the `"version"` line:

```json
"engines": {
  "bun": ">=1.0.0",
  "node": ">=20.0.0"
},
```

Also add to root `package.json` and `packages/reactive-agents/package.json`.

- [ ] **Step 5: Verify packages install cleanly**

```bash
cd /path/to/worktree && bun install
```

Expected: zero errors, `better-sqlite3` prebuilt downloads without compilation.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/memory/package.json packages/cost/package.json packages/reactive-intelligence/package.json packages/a2a/package.json packages/health/package.json packages/eval/package.json packages/reactive-agents/package.json package.json
rtk git commit -m "chore(deps): add better-sqlite3, hono, @hono/node-server, fast-glob for Node.js support"
```

---

## Task 2: Replace `Bun.hash` with `node:crypto`

**Files:**
- Modify: `packages/cost/src/caching/semantic-cache.ts`
- Modify: `packages/llm-provider/src/embedding-cache.ts`
- Test: `packages/cost/tests/semantic-cache.test.ts` (likely exists — check first)

The `Bun.hash(str)` call returns a fast non-crypto hash used as a cache key. We replace it with a SHA-256 slice — stronger and universally available.

- [ ] **Step 1: Write a test verifying hash determinism**

In `packages/cost/tests/semantic-cache.test.ts` (create if missing), add:

```typescript
import { describe, it, expect } from "bun:test";

describe("hashString (internal)", () => {
  it("produces same output for same input", () => {
    // We test via the cache behavior: same text → cache hit
    // Import the hashString helper if exported, otherwise test via makeSemanticCache
    const { makeSemanticCache } = await import("../src/caching/semantic-cache.js");
    const hits: number[] = [];
    const mockEmbed = (texts: readonly string[]) => {
      hits.push(texts.length);
      return Effect.succeed(texts.map(() => [0.1, 0.2, 0.3] as readonly number[]));
    };
    const cache = makeSemanticCache(mockEmbed as any);
    // First call — miss
    await Effect.runPromise(cache.get("hello world", async (t) => Effect.runPromise(mockEmbed([t]))));
    // Second call — should hit cache, not call embed again
    await Effect.runPromise(cache.get("hello world", async (t) => Effect.runPromise(mockEmbed([t]))));
    expect(hits.length).toBe(1); // only one embed call
  });
});
```

- [ ] **Step 2: Run test to verify it passes on current code**

```bash
cd packages/cost && bun test tests/semantic-cache.test.ts
```

Expected: PASS (baseline — confirms test is valid before we change anything)

- [ ] **Step 3: Replace `Bun.hash` in `semantic-cache.ts`**

In `packages/cost/src/caching/semantic-cache.ts`, replace:

```typescript
// BEFORE (line 16)
function hashString(str: string): string {
  return Bun.hash(str).toString(36);
}
```

with:

```typescript
// AFTER
import { createHash } from "node:crypto";

function hashString(str: string): string {
  return createHash("sha256").update(str).digest("hex").slice(0, 16);
}
```

- [ ] **Step 4: Replace `Bun.hash` in `embedding-cache.ts`**

Read `packages/llm-provider/src/embedding-cache.ts` lines 30-80 to find the Bun.hash usage, then replace with the same pattern:

```typescript
// BEFORE (wherever Bun.hash appears)
const key = Bun.hash(text).toString(16);

// AFTER
import { createHash } from "node:crypto";
const key = createHash("sha256").update(text).digest("hex").slice(0, 16);
```

(Only add the `import` once at the top of the file, not per call site.)

- [ ] **Step 5: Run tests to verify both still pass**

```bash
cd packages/cost && bun test
cd ../llm-provider && bun test
```

Expected: all existing tests PASS

- [ ] **Step 6: Commit**

```bash
rtk git add packages/cost/src/caching/semantic-cache.ts packages/llm-provider/src/embedding-cache.ts
rtk git commit -m "fix(compat): replace Bun.hash with node:crypto — runs on Node and Bun"
```

---

## Task 3: Replace `Bun.spawn` in `code-execution.ts`

**Files:**
- Modify: `packages/tools/src/skills/code-execution.ts`
- Test: `packages/tools/tests/code-execution.test.ts` (verify exists)

Current code at line 88: `Bun.spawn(["bun", "--eval", code], { stdout: "pipe", stderr: "pipe", ... })`. The result uses `proc.stdout` as a `ReadableStream`, `proc.stderr`, and `proc.exited` as a Promise. Node's `child_process.spawn` uses event emitters instead — we collect chunks into Buffers.

- [ ] **Step 1: Run existing code-execution tests to establish baseline**

```bash
cd packages/tools && bun test tests/code-execution.test.ts
```

Expected: PASS. If no test file exists, create one with:

```typescript
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { codeExecuteHandler } from "../src/skills/code-execution.js";

describe("codeExecuteHandler", () => {
  it("executes simple arithmetic", async () => {
    const result = await Effect.runPromise(
      codeExecuteHandler({ code: "console.log(2 + 2)" }) as any
    );
    expect((result as any).executed).toBe(true);
    expect((result as any).output).toBe("4");
  });

  it("captures exit code on error", async () => {
    const result = await Effect.runPromise(
      codeExecuteHandler({ code: "process.exit(1)" }) as any
    );
    expect((result as any).executed).toBe(false);
    expect((result as any).exitCode).toBe(1);
  });

  it("rejects stored-result key as code", async () => {
    const result = await Effect.runPromise(
      codeExecuteHandler({ code: "_tool_result_1" }) as any
    );
    expect((result as any).executed).toBe(false);
    expect((result as any).error).toContain("storage key");
  });
});
```

Run again: PASS.

- [ ] **Step 2: Replace `Bun.spawn` in `code-execution.ts`**

Replace lines 88–115 (the entire spawn + stdout/stderr/exitCode block) with:

```typescript
import { spawn } from "node:child_process";

// Detect available JS runtime — prefer bun for speed, fall back to node
const jsRuntime = typeof (globalThis as any).Bun !== "undefined" ? "bun" : "node";

const proc = spawn(jsRuntime, ["--eval", code], {
  cwd: "/tmp",
  env: {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

const stdoutChunks: Buffer[] = [];
const stderrChunks: Buffer[] = [];
proc.stdout!.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
proc.stderr!.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

// Set up timeout — proc.kill() works identically in node:child_process
const timeoutId = setTimeout(() => {
  try { proc.kill(); } catch { /* already gone */ }
}, timeoutMs);

const exitCode = await new Promise<number>((resolve) =>
  proc.on("close", (code) => resolve(code ?? 1))
);
clearTimeout(timeoutId);

const stdoutText = Buffer.concat(stdoutChunks).toString("utf8");
const stderrText = Buffer.concat(stderrChunks).toString("utf8");
```

Add `import { spawn } from "node:child_process";` at the top of the file. Remove the `Bun.spawn` call entirely.

Note: the `jsRuntime` detection at the top of the handler is computed once per call. Move the constant outside the handler for efficiency:

```typescript
// At module level (top of file, after imports):
const JS_RUNTIME = typeof (globalThis as any).Bun !== "undefined" ? "bun" : "node";
```

Then use `JS_RUNTIME` in the spawn call.

- [ ] **Step 3: Run tests to verify behavior is preserved**

```bash
cd packages/tools && bun test tests/code-execution.test.ts
```

Expected: all PASS

- [ ] **Step 4: Commit**

```bash
rtk git add packages/tools/src/skills/code-execution.ts
rtk git commit -m "fix(compat): replace Bun.spawn in code-execution with node:child_process"
```

---

## Task 4: Replace `Bun.spawn` in `docker-sandbox.ts`

**Files:**
- Modify: `packages/tools/src/execution/docker-sandbox.ts`
- Test: `packages/tools/tests/docker-sandbox.test.ts` (verify exists)

The file has four `Bun.spawn` call sites (lines ~100, 113, 141, 248+). All follow the same pattern: spawn a process, await `proc.exited`, check `proc.exitCode`. None use streaming stdout — they just check exit codes for availability checks. The `execute()` method does capture stdout/stderr for the code output.

- [ ] **Step 1: Run existing docker-sandbox tests to establish baseline**

```bash
cd packages/tools && bun test tests/docker-sandbox.test.ts
```

Expected: PASS (or skip if Docker is not available — check test setup).

- [ ] **Step 2: Add `import { spawn, spawnSync } from "node:child_process"` at top of `docker-sandbox.ts`**

The file already imports from `node:path`, `node:fs`, `node:crypto` — add:

```typescript
import { spawn } from "node:child_process";
```

- [ ] **Step 3: Replace `isDockerAvailable` (lines ~98-109)**

```typescript
// BEFORE
const proc = Bun.spawn(["docker", "info"], { stdout: "pipe", stderr: "pipe" });
await proc.exited;
return proc.exitCode === 0;

// AFTER
const proc = spawn("docker", ["info"], { stdio: ["ignore", "pipe", "pipe"] });
const exitCode = await new Promise<number>((resolve) =>
  proc.on("close", (code) => resolve(code ?? 1))
);
return exitCode === 0;
```

- [ ] **Step 4: Replace `isImageAvailable` (lines ~112-122)**

```typescript
// BEFORE
const proc = Bun.spawn(["docker", "image", "inspect", image], { stdout: "pipe", stderr: "pipe" });
await proc.exited;
return proc.exitCode === 0;

// AFTER
const proc = spawn("docker", ["image", "inspect", image], { stdio: ["ignore", "pipe", "pipe"] });
const exitCode = await new Promise<number>((resolve) =>
  proc.on("close", (code) => resolve(code ?? 1))
);
return exitCode === 0;
```

- [ ] **Step 5: Replace `buildSandboxImage` (lines ~141-149)**

```typescript
// BEFORE
const proc = Bun.spawn(
  ["docker", "build", "-t", SANDBOX_IMAGES[language], "-f", dockerfilePath, dockerfileDir],
  { stdout: "pipe", stderr: "pipe" },
);
await proc.exited;
return proc.exitCode === 0;

// AFTER
const proc = spawn(
  "docker",
  ["build", "-t", SANDBOX_IMAGES[language], "-f", dockerfilePath, dockerfileDir],
  { cwd: dockerfileDir, stdio: ["ignore", "pipe", "pipe"] },
);
const exitCode = await new Promise<number>((resolve) =>
  proc.on("close", (code) => resolve(code ?? 1))
);
return exitCode === 0;
```

- [ ] **Step 6: Replace the `execute()` method's `Bun.spawn` call**

Read `docker-sandbox.ts` lines 160–300 to find the `execute()` implementation's Bun.spawn call, then replace using the same chunk-collection pattern from Task 3:

```typescript
const proc = spawn("docker", dockerArgs, {
  stdio: ["ignore", "pipe", "pipe"],
});

const stdoutChunks: Buffer[] = [];
const stderrChunks: Buffer[] = [];
proc.stdout!.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
proc.stderr!.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

const timeoutId = setTimeout(() => {
  try { proc.kill(); } catch { /* already gone */ }
}, config.timeoutMs);

const exitCode = await new Promise<number>((resolve) =>
  proc.on("close", (code) => resolve(code ?? 1))
);
clearTimeout(timeoutId);

const stdout = Buffer.concat(stdoutChunks).toString("utf8");
const stderr = Buffer.concat(stderrChunks).toString("utf8");
```

- [ ] **Step 7: Run tests**

```bash
cd packages/tools && bun test
```

Expected: all PASS

- [ ] **Step 8: Commit**

```bash
rtk git add packages/tools/src/execution/docker-sandbox.ts
rtk git commit -m "fix(compat): replace Bun.spawn in docker-sandbox with node:child_process"
```

---

## Task 5: Replace `Bun.file`/`Bun.Glob` in eval dataset service

**Files:**
- Modify: `packages/eval/src/services/dataset-service.ts`
- Test: `packages/eval/tests/dataset-service.test.ts` (verify exists)

- [ ] **Step 1: Read dataset-service.ts to map all Bun API usages**

```bash
grep -n "Bun\." packages/eval/src/services/dataset-service.ts
```

Note every line number and which Bun API it uses before proceeding.

- [ ] **Step 2: Run existing eval tests to establish baseline**

```bash
cd packages/eval && bun test
```

Expected: PASS

- [ ] **Step 3: Replace `Bun.Glob` with `fast-glob`**

```typescript
// BEFORE
const glob = new Bun.Glob("**/*.json");
const files = await Array.fromAsync(glob.scan(dir));

// AFTER
import fg from "fast-glob";
const files = await fg("**/*.json", { cwd: dir, absolute: false });
```

- [ ] **Step 4: Replace `Bun.file(path).text()` with `node:fs/promises`**

```typescript
// BEFORE
const content = await Bun.file(filePath).text();

// AFTER
import { readFile } from "node:fs/promises";
const content = await readFile(filePath, "utf8");
```

- [ ] **Step 5: Replace `Bun.write(path, content)` with `node:fs/promises`**

```typescript
// BEFORE
await Bun.write(outputPath, JSON.stringify(data, null, 2));

// AFTER
import { writeFile } from "node:fs/promises";
await writeFile(outputPath, JSON.stringify(data, null, 2), "utf8");
```

Add all `node:fs/promises` imports as a single import at the top.

- [ ] **Step 6: Run tests**

```bash
cd packages/eval && bun test
```

Expected: all PASS

- [ ] **Step 7: Commit**

```bash
rtk git add packages/eval/src/services/dataset-service.ts packages/eval/package.json
rtk git commit -m "fix(compat): replace Bun.file/Bun.Glob in eval with node:fs/fast-glob"
```

---

## Task 6: Replace `bun:sqlite` in memory package

**Files:**
- Modify: `packages/memory/src/database.ts`
- Test: `packages/memory/tests/` (run all)

`database.ts` wraps `bun:sqlite` behind the `MemoryDatabaseService` Effect service — the consuming code never touches SQLite directly. We only change the implementation.

**Key API differences for this migration:**
- `import { Database } from "bun:sqlite"` → `import Database from "better-sqlite3"`
- `new Database(path, { create: true })` → `new Database(path)` (better-sqlite3 creates by default)
- `db.run(sql)` (DDL, no params) → `db.exec(sql)` (same as bun:sqlite's `db.exec`)  
- `db.run(sql, [p1, p2])` (DML with array) → `db.prepare(sql).run(p1, p2)` (spread)
- `db.query(sql).all(...)` → `db.prepare(sql).all(...)` (same call signature ✓)
- `db.query(sql).get(...)` → `db.prepare(sql).get(...)` (same call signature ✓)

- [ ] **Step 1: Run memory tests to establish baseline**

```bash
cd packages/memory && bun test
```

Expected: all PASS. Record the count.

- [ ] **Step 2: Grep for all `bun:sqlite` API calls in database.ts**

```bash
grep -n "db\.run\|db\.query\|db\.exec\|db\.prepare\|new Database" packages/memory/src/database.ts
```

Note every line — you will fix each one.

- [ ] **Step 3: Replace the import and constructor**

```typescript
// BEFORE (line 2)
import { Database } from "bun:sqlite";

// AFTER
import Database from "better-sqlite3";
```

In the constructor (wherever `new Database(path, { create: true })` appears):
```typescript
// BEFORE
const db = new Database(config.dbPath, { create: true });

// AFTER
const db = new Database(config.dbPath); // better-sqlite3 creates by default
```

- [ ] **Step 4: Replace `db.run(sql)` DDL calls**

For every `db.run(sql)` with NO parameters (PRAGMA, CREATE TABLE, etc.):
```typescript
// BEFORE
db.run("PRAGMA journal_mode = WAL;");
db.run("CREATE TABLE IF NOT EXISTS ...");

// AFTER
db.exec("PRAGMA journal_mode = WAL;");
db.exec("CREATE TABLE IF NOT EXISTS ...");
```

Note: `db.exec()` already exists in `bun:sqlite` for multi-statement SQL and has the same meaning in `better-sqlite3`. Only `db.run()` needs changing.

- [ ] **Step 5: Replace `db.run(sql, paramsArray)` DML calls**

For every `db.run(sql, [p1, p2, ...])` with parameters:
```typescript
// BEFORE
db.run("INSERT INTO t VALUES (?, ?)", [val1, val2]);

// AFTER
db.prepare("INSERT INTO t VALUES (?, ?)").run(val1, val2);
```

- [ ] **Step 6: Replace `db.query(sql)` with `db.prepare(sql)`**

```typescript
// BEFORE
const rows = db.query("SELECT * FROM t WHERE id = ?").all(id);
const row  = db.query("SELECT * FROM t WHERE id = ?").get(id);

// AFTER
const rows = db.prepare("SELECT * FROM t WHERE id = ?").all(id);
const row  = db.prepare("SELECT * FROM t WHERE id = ?").get(id) as typeof row;
```

For performance, extract frequently-called prepared statements to module-level constants (as budget-db.ts already does). This is optional for correctness but good practice.

- [ ] **Step 7: Fix TypeScript generics on prepared statements**

`bun:sqlite` allows `db.prepare<Row, Params>(sql)`. `better-sqlite3` puts generics on the call:
```typescript
// BEFORE
const stmt = db.prepare<{ id: string; content: string }, [string]>("SELECT ...");

// AFTER  
const stmt = db.prepare("SELECT ...");
// Then cast at the call site:
const row = stmt.get(id) as { id: string; content: string } | undefined;
const rows = stmt.all(id) as { id: string; content: string }[];
```

- [ ] **Step 8: Run memory tests**

```bash
cd packages/memory && bun test
```

Expected: same count as Step 1, all PASS.

- [ ] **Step 9: Commit**

```bash
rtk git add packages/memory/src/database.ts packages/memory/package.json
rtk git commit -m "fix(compat): replace bun:sqlite with better-sqlite3 in memory package"
```

---

## Task 7: Replace `bun:sqlite` in cost package

**Files:**
- Modify: `packages/cost/src/budgets/budget-db.ts`
- Test: `packages/cost/tests/`

`budget-db.ts` already uses `db.prepare(sql).get()` and `db.prepare(sql).run()` which are identical in both libraries. Only two changes needed: the import and DDL calls.

- [ ] **Step 1: Run cost tests to establish baseline**

```bash
cd packages/cost && bun test
```

Expected: all PASS.

- [ ] **Step 2: Replace import**

```typescript
// BEFORE (line 2)
import { Database } from "bun:sqlite";

// AFTER
import Database from "better-sqlite3";
```

- [ ] **Step 3: Replace constructor options**

```typescript
// BEFORE (line 20)
const db = new Database(dbPath, { create: true });

// AFTER
const db = new Database(dbPath);
```

- [ ] **Step 4: Replace `db.run()` DDL calls (lines 21-29)**

```typescript
// BEFORE
db.run("PRAGMA journal_mode = WAL");
db.run(`CREATE TABLE IF NOT EXISTS budget_spend ...`);

// AFTER
db.exec("PRAGMA journal_mode = WAL");
db.exec(`CREATE TABLE IF NOT EXISTS budget_spend ...`);
```

The `db.prepare().get()` and `db.prepare().run()` calls on lines 31-38 are already compatible — no changes needed there.

- [ ] **Step 5: Run cost tests**

```bash
cd packages/cost && bun test
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/cost/src/budgets/budget-db.ts packages/cost/package.json
rtk git commit -m "fix(compat): replace bun:sqlite with better-sqlite3 in cost package"
```

---

## Task 8: Replace `bun:sqlite` in reactive-intelligence package

**Files:**
- Modify: `packages/reactive-intelligence/src/learning/bandit-store.ts`
- Modify: `packages/reactive-intelligence/src/calibration/calibration-store.ts`
- Modify: `packages/reactive-intelligence/src/calibration/observations-store.ts` (check for bun:sqlite)
- Test: `packages/reactive-intelligence/tests/`

`calibration-store.ts` already uses `db.prepare().run()` and `db.prepare().get()` — it only needs the import and constructor change. `bandit-store.ts` uses `db.run(sql, [array])` which needs the spread fix.

- [ ] **Step 1: Run reactive-intelligence tests to establish baseline**

```bash
cd packages/reactive-intelligence && bun test
```

Expected: all PASS.

- [ ] **Step 2: Check observations-store.ts for bun:sqlite**

```bash
grep -n "bun:sqlite\|Bun\." packages/reactive-intelligence/src/calibration/observations-store.ts
```

Apply the same import + constructor + DDL changes if found.

- [ ] **Step 3: Fix `calibration-store.ts` (import + constructor only)**

```typescript
// BEFORE (line 1)
import { Database } from "bun:sqlite";
// ...
this.db = new Database(dbPath, { create: true });

// AFTER
import Database from "better-sqlite3";
// ...
this.db = new Database(dbPath);
```

The `db.exec()`, `db.prepare().run()`, and `db.prepare().get()` calls are already compatible — no further changes.

- [ ] **Step 4: Fix `bandit-store.ts` — import, constructor, and `db.run()` calls**

```typescript
// BEFORE (line 1)
import { Database } from "bun:sqlite";

// AFTER
import Database from "better-sqlite3";
```

```typescript
// BEFORE (line 15)
this.db = new Database(dbPath, { create: true });

// AFTER
this.db = new Database(dbPath);
```

```typescript
// BEFORE (lines 31-35) — db.run with array params
this.db.run(
  `INSERT OR REPLACE INTO bandit_arms ...`,
  [stats.contextBucket, stats.armId, stats.alpha, stats.beta, stats.pulls],
);

// AFTER — better-sqlite3 uses spread, not array
this.db.prepare(
  `INSERT OR REPLACE INTO bandit_arms (context_bucket, arm_id, alpha, beta, pulls, updated_at)
   VALUES (?, ?, ?, ?, ?, datetime('now'))`
).run(stats.contextBucket, stats.armId, stats.alpha, stats.beta, stats.pulls);
```

```typescript
// BEFORE (lines 39-41) — db.query → db.prepare
const row = this.db.query("SELECT ... WHERE context_bucket = ? AND arm_id = ?")
  .get(contextBucket, armId) as {...} | null;

// AFTER
const row = this.db.prepare("SELECT context_bucket, arm_id, alpha, beta, pulls FROM bandit_arms WHERE context_bucket = ? AND arm_id = ?")
  .get(contextBucket, armId) as { context_bucket: string; arm_id: string; alpha: number; beta: number; pulls: number } | undefined ?? null;
```

```typescript
// BEFORE (lines 52-55) — db.query → db.prepare  
return (this.db.query("SELECT ... WHERE context_bucket = ?")
  .all(contextBucket) as Array<{...}>).map(...);

// AFTER
return (this.db.prepare("SELECT context_bucket, arm_id, alpha, beta, pulls FROM bandit_arms WHERE context_bucket = ?")
  .all(contextBucket) as Array<{ context_bucket: string; arm_id: string; alpha: number; beta: number; pulls: number }>).map(...);
```

- [ ] **Step 5: Run reactive-intelligence tests**

```bash
cd packages/reactive-intelligence && bun test
```

Expected: same count as Step 1, all PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/reactive-intelligence/src/learning/bandit-store.ts packages/reactive-intelligence/src/calibration/calibration-store.ts packages/reactive-intelligence/src/calibration/observations-store.ts packages/reactive-intelligence/package.json
rtk git commit -m "fix(compat): replace bun:sqlite with better-sqlite3 in reactive-intelligence"
```

---

## Task 9: Replace `Bun.serve` in health service

**Files:**
- Modify: `packages/health/src/service.ts`
- Test: `packages/health/tests/`

The health service uses `Bun.serve({ port, fetch })` to handle `/health`, `/ready`, `/metrics` HTTP endpoints. We swap to Hono + `@hono/node-server`.

- [ ] **Step 1: Run health tests to establish baseline**

```bash
cd packages/health && bun test
```

Expected: all PASS (or confirm tests exist and document count).

- [ ] **Step 2: Read the full `service.ts` fetch handler**

```bash
cat -n packages/health/src/service.ts | head -200
```

Map every route the fetch handler serves (`/health`, `/ready`, `/metrics`, etc.) and the response shape for each.

- [ ] **Step 3: Replace `Bun.serve` with Hono**

At the top of `service.ts`, replace any `Bun.serve` usage:

```typescript
// ADD these imports
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { Server } from "node:http";
```

Replace the server variable type and construction:

```typescript
// BEFORE
let server: ReturnType<typeof Bun.serve> | null = null;

// AFTER
let server: Server | null = null;
```

Replace the `Bun.serve({ port, fetch })` call with Hono routes. For each route in the existing fetch handler:

```typescript
// BEFORE (schematic — adapt to the actual routes found in Step 2)
server = Bun.serve({
  port: config.port,
  fetch: async (req: Request) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      const checks = await Effect.runPromise(runChecks());
      return Response.json(buildResponse(checks));
    }
    if (url.pathname === "/ready") {
      const checks = await Effect.runPromise(runChecks());
      const allHealthy = checks.every((c) => c.healthy);
      return new Response(allHealthy ? "OK" : "UNAVAILABLE", {
        status: allHealthy ? 200 : 503,
      });
    }
    return new Response("Not Found", { status: 404 });
  },
});
boundPort = server.port;

// AFTER
const app = new Hono();

app.get("/health", async (c) => {
  const checks = await Effect.runPromise(runChecks());
  return c.json(buildResponse(checks));
});

app.get("/ready", async (c) => {
  const checks = await Effect.runPromise(runChecks());
  const allHealthy = checks.every((ch) => ch.healthy);
  return c.text(allHealthy ? "OK" : "UNAVAILABLE", allHealthy ? 200 : 503);
});

// Add any other routes found in Step 2 (/metrics etc.) following the same pattern

server = serve({ fetch: app.fetch, port: config.port }) as Server;
boundPort = config.port;
```

Replace the `stop()` implementation:

```typescript
// BEFORE
server.stop();

// AFTER
server.close();
```

- [ ] **Step 4: Run health tests**

```bash
cd packages/health && bun test
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/health/src/service.ts packages/health/package.json
rtk git commit -m "fix(compat): replace Bun.serve with Hono in health service"
```

---

## Task 10: Replace `Bun.serve` in A2A HTTP server

**Files:**
- Modify: `packages/a2a/src/server/http-server.ts`
- Test: `packages/a2a/tests/`

The A2A server handles JSON-RPC 2.0 with SSE streaming. Hono has native SSE support via `streamSSE()`.

- [ ] **Step 1: Run a2a tests to establish baseline**

```bash
cd packages/a2a && bun test
```

Expected: all PASS.

- [ ] **Step 2: Read the full `http-server.ts`**

```bash
cat -n packages/a2a/src/server/http-server.ts
```

Map: (a) every route, (b) which routes use SSE streaming, (c) how the Bun server is started/stopped.

- [ ] **Step 3: Add imports**

```typescript
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { streamSSE } from "hono/streaming";
import type { Server } from "node:http";
```

- [ ] **Step 4: Replace server type variable**

```typescript
// BEFORE
let bunServer: { stop: () => void } | null = null;

// AFTER
let honoServer: Server | null = null;
```

- [ ] **Step 5: Replace the `Bun.serve` call with Hono**

The existing fetch handler pattern routes on `url.pathname` and `request.method`. Convert each route to a Hono handler. For non-SSE JSON-RPC routes:

```typescript
const app = new Hono();

app.post("/", async (c) => {
  const body = await c.req.json<JsonRpcRequest>();
  const result = await Effect.runPromise(
    Effect.provide(handleJsonRpc(body), /* layers */)
  );
  return c.json(result);
});
```

For SSE streaming routes (wherever `message/stream` is handled), use Hono's `streamSSE`:

```typescript
app.post("/stream", async (c) => {
  const body = await c.req.json<JsonRpcRequest>();
  return streamSSE(c, async (stream) => {
    // Build events as in the original handler
    for (const event of events) {
      await stream.writeSSE({
        data: JSON.stringify(event.data),
        event: event.type,
      });
    }
  });
});
```

Adapt the route paths and handler logic to exactly match the original routes found in Step 2.

- [ ] **Step 6: Replace start/stop**

```typescript
// BEFORE (in start())
bunServer = Bun.serve({ port, fetch: handleRequest });

// AFTER
honoServer = serve({ fetch: app.fetch, port }) as Server;

// BEFORE (in stop())
bunServer?.stop();

// AFTER
honoServer?.close();
```

- [ ] **Step 7: Run a2a tests**

```bash
cd packages/a2a && bun test
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
rtk git add packages/a2a/src/server/http-server.ts packages/a2a/package.json
rtk git commit -m "fix(compat): replace Bun.serve with Hono in A2A HTTP server"
```

---

## Task 11: Fix CLI shebang + clean `bun-types` from published packages

**Files:**
- Modify: `apps/cli/tsup.config.ts`
- Modify: `packages/*/tsconfig.json` (remove `bun-types` from `compilerOptions.types` in publishable packages)
- Modify: `packages/*/package.json` (move `bun-types` from `dependencies`/`devDependencies` in publishable packages to only `devDependencies`)

- [ ] **Step 1: Fix CLI shebang in `apps/cli/tsup.config.ts`**

The current banner hardcodes `#!/usr/bin/env bun`. Replace with a runtime-detecting shebang:

```typescript
// BEFORE (line 10)
banner: { js: "#!/usr/bin/env bun" }

// AFTER — detect available runtime, prefer bun
banner: {
  js: `#!/usr/bin/env -S node --input-type=module\n// @runtime: prefer bun if available`,
}
```

Actually, the cleanest approach for a CLI that works on both runtimes is to use a thin wrapper script. Replace the banner with no shebang, and add a `bin/rax` wrapper:

Create `apps/cli/bin/rax` (no extension, executable):
```bash
#!/bin/sh
if command -v bun >/dev/null 2>&1; then
  exec bun "$(dirname "$0")/../dist/index.js" "$@"
else
  exec node "$(dirname "$0")/../dist/index.js" "$@"
fi
```

Then in `apps/cli/tsup.config.ts`, remove the banner:
```typescript
// BEFORE
banner: { js: "#!/usr/bin/env bun" }

// AFTER — remove the banner entirely (wrapper handles runtime detection)
// (delete the banner property)
```

Update `apps/cli/package.json` bin field to point to the wrapper:
```json
"bin": {
  "rax": "bin/rax",
  "reactive-agents": "bin/rax"
}
```

Make the wrapper executable: `chmod +x apps/cli/bin/rax`

- [ ] **Step 2: Find publishable packages with `bun-types` in their tsconfig `types` array**

```bash
grep -rl '"bun-types"' packages/*/tsconfig.json
```

- [ ] **Step 3: For each package found, move `bun-types` to only appear in root/dev tsconfig**

In each publishable package's `tsconfig.json`, remove `"bun-types"` from `compilerOptions.types`. The root `tsconfig.json` (workspace root) can keep it.

```json
// BEFORE (in packages/memory/tsconfig.json)
"compilerOptions": {
  "types": ["bun-types"]
}

// AFTER
"compilerOptions": {
  "types": []
}
```

If `types` array would be empty, remove it entirely (TypeScript will auto-discover `@types/*` packages).

- [ ] **Step 4: Verify TypeScript still compiles after removing bun-types**

```bash
cd packages/memory && bun run build 2>&1 | head -20
cd ../cost && bun run build 2>&1 | head -20
```

If any `Bun.*` references remain in source and aren't caught by this task's previous changes, they'll surface here as type errors. Fix any remaining ones.

- [ ] **Step 5: Run the full test suite to catch regressions**

```bash
cd /path/to/worktree && bun test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
rtk git add apps/cli/tsup.config.ts apps/cli/bin/rax apps/cli/package.json
# Stage all tsconfig changes
rtk git add $(git diff --name-only | grep tsconfig.json)
rtk git commit -m "fix(compat): runtime-detect CLI shebang, remove bun-types from published tsconfigs"
```

---

## Task 12: Vitest config + Node.js CI matrix

**Files:**
- Create: `vitest.config.ts`
- Create or modify: `.github/workflows/ci.yml`

This task wires up Node.js as a verified CI target.

- [ ] **Step 1: Create root `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/*/tests/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      // Skip tests that require a live LLM API key in CI
      "**/tests/integration/**",
    ],
    // Run sequentially to avoid SQLite file conflicts between tests
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
```

- [ ] **Step 2: Add vitest to root devDependencies**

```bash
bun add -d vitest
```

- [ ] **Step 3: Add `test:node` script to root `package.json`**

```json
"test:node": "node --experimental-vm-modules node_modules/.bin/vitest run"
```

Or more simply (vitest handles ESM natively in recent versions):
```json
"test:node": "vitest run"
```

- [ ] **Step 4: Smoke-test vitest runs on the current codebase**

```bash
bun run test:node 2>&1 | tail -30
```

Expected: tests run (even if some are skipped for missing providers). Zero crashes from Bun API calls since we've replaced them all.

- [ ] **Step 5: Check current CI workflow**

```bash
cat .github/workflows/ci.yml
```

Find where the existing `bun test` step runs.

- [ ] **Step 6: Add Node.js matrix job to CI**

Add a new job (or extend the matrix) alongside the existing Bun job:

```yaml
test-node:
  name: Test (Node.js ${{ matrix.node-version }})
  runs-on: ubuntu-latest
  strategy:
    matrix:
      node-version: ["20", "22"]
  steps:
    - uses: actions/checkout@v4

    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: ${{ matrix.node-version }}
        cache: "npm"

    - name: Install dependencies
      run: npm install

    - name: Build packages
      run: npm run build

    - name: Run tests (Node.js)
      run: npm run test:node
      env:
        NODE_ENV: test
        # No API keys — only unit tests run in CI
```

- [ ] **Step 7: Commit**

```bash
rtk git add vitest.config.ts .github/workflows/ci.yml package.json
rtk git commit -m "feat(ci): add Node.js 20/22 test matrix with vitest"
```

---

## Task 13: Final verification pass

- [ ] **Step 1: Grep for any remaining `Bun.` references in src files**

```bash
grep -r "Bun\." packages/*/src/ apps/*/src/ --include="*.ts" | grep -v "\.test\." | grep -v node_modules
```

Expected: zero hits (or only comments/docs, not code calls).

- [ ] **Step 2: Grep for remaining `bun:sqlite` imports**

```bash
grep -r "bun:sqlite" packages/ apps/ --include="*.ts"
```

Expected: zero hits.

- [ ] **Step 3: Run full Bun test suite to confirm no regressions**

```bash
bun test 2>&1 | tail -5
```

Expected: same test count as before this feature branch, all passing.

- [ ] **Step 4: Run vitest to confirm Node compatibility**

```bash
bun run test:node 2>&1 | tail -10
```

Expected: all tests pass on Node runtime path.

- [ ] **Step 5: Update `packages/reactive-agents/README.md` install line**

Add to installation section:
```markdown
## Runtime Requirements

Reactive Agents runs on **Bun ≥1.0** (recommended) or **Node.js ≥20**.

```bash
# Bun (recommended — faster SQLite, native spawn)
bun add reactive-agents

# Node.js
npm install reactive-agents
```

- [ ] **Step 6: Final commit and branch push**

```bash
rtk git add packages/reactive-agents/README.md
rtk git commit -m "docs: document Node.js >=20 as supported runtime"
rtk git push -u origin feat/nodejs-support
```

---

## Self-Review

**Spec coverage check:**
- ✅ `Bun.hash` — Tasks 2
- ✅ `Bun.spawn` (code-execution, docker-sandbox) — Tasks 3, 4
- ✅ `Bun.file`/`Bun.write`/`Bun.Glob` — Task 5
- ✅ `bun:sqlite` (memory, cost, reactive-intelligence) — Tasks 6, 7, 8
- ✅ `Bun.serve` (health, a2a) — Tasks 9, 10
- ✅ CLI shebang — Task 11
- ✅ `bun-types` from published packages — Task 11
- ✅ `engines` field — Task 1
- ✅ CI Node matrix — Task 12
- ✅ `better-sqlite3` dep installation — Task 1
- ✅ Hono dep installation — Task 1

**Gaps:**
- `packages/benchmarks/src/run.ts` uses `Bun.file`/`Bun.write` — add to Task 5 or handle in a follow-up. Benchmarks are dev-only (not published), so lower urgency.
- `apps/examples/index.ts` uses `import.meta.main` (Bun-only idiom) — examples are dev-only, not published. Note for follow-up.
- `apps/cli/src/generators/project-generator.ts` generates scaffolds with `bun run` scripts — follow-up task to auto-detect provider from env.

**Type consistency check:**
- `Database` import: consistently `import Database from "better-sqlite3"` (default import, not named) across all 4 packages ✅
- `spawn` import: consistently `import { spawn } from "node:child_process"` ✅
- `createHash` import: consistently `import { createHash } from "node:crypto"` ✅
- Hono: consistently `import { Hono } from "hono"` + `import { serve } from "@hono/node-server"` ✅
