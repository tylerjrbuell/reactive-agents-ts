# Durable Execution Phase B — RunStore + `.withDurableRuns()` + checkpoint writes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Persist live run state to a SQLite `RunStore` at checkpoint boundaries when the user opts in via `.withDurableRuns()` — the write half of crash-resume (resume is Phase C).

**Architecture:** Phase A shipped the codec (`serializeKernelState`/`deserializeKernelState`) and an `onCheckpoint` observer seam in the kernel loop. Phase B (1) refines that seam so the kernel hands the observer a **lossless serialized snapshot string** (not the lossy `KernelStateLike`), (2) adds a `RunStoreService` (SQLite via `@reactive-agents/runtime-shim`, mirroring `SessionStoreService`), and (3) adds `.withDurableRuns({ dir?, checkpointEvery? })` which wires an `onCheckpoint` implementation that writes every N iterations. Zero cost when not opted in.

**Tech Stack:** TypeScript, Effect-TS, SQLite (`@reactive-agents/runtime-shim` `Database`), Bun test.

**Source spec:** `wiki/Architecture/Design-Specs/2026-06-10-durable-execution.md` (Phase B row). Branch: `feat/durable-execution` (rebased onto main 2026-06-11; Phase A intact, build green, 12/12 durable tests).

**Ownership (warden pilot until 2026-06-15):** Task B1 (kernel seam) → **kernel-warden**. Tasks B2–B4 (RunStore, builder, wiring) → **runtime-warden**.

**Verified Phase A anchors:**
- `serializeKernelState(state: KernelState): string` / `deserializeKernelState(json: string): KernelState` — `reasoning/src/kernel/state/kernel-codec.ts:186,199`. `KERNEL_CODEC_VERSION = 1`.
- Seam call site: `reasoning/src/kernel/loop/iterate-pass.ts:369-377` — `if (_runCtl.onCheckpoint) { try { _runCtl.onCheckpoint(asKernelStateLike(state), state.iteration); } catch ... warn }`.
- Seam type: `core/src/streaming.ts:47` — `onCheckpoint?(state: Readonly<KernelStateLike>, iteration: number): void` on `RunControllerLike`.
- `RunController` impl: `runtime/src/run-controller.ts:39`.
- Mirror for RunStore: `memory/src/services/session-store.ts` — `SessionStoreService` (Context.Tag) + `SessionStoreLive` (Layer) + `CREATE TABLE IF NOT EXISTS` pattern; SQLite via `Database` from `@reactive-agents/runtime-shim` (export at `runtime-shim/src/index.ts:13`, types `DatabaseLike`/`DatabaseConstructor`).
- Builder cross-cutting threading pattern: follow `budgetLimits`/`grounding` (just-shipped) — private field → wither → `runtime-construction.ts` → runtime options.

---

## File Structure

| File | Responsibility | Phase |
|---|---|---|
| `packages/core/src/streaming.ts` | MODIFY. Change `onCheckpoint` signature to carry the serialized snapshot string. | B1 |
| `packages/reasoning/src/kernel/loop/iterate-pass.ts` | MODIFY. Serialize full state via `serializeKernelState(state)` and pass the string to `onCheckpoint`. | B1 |
| `packages/reasoning/tests/kernel/loop/durable-checkpoint-seam.test.ts` | MODIFY. Assert the observer receives a lossless serialized string that `deserializeKernelState` round-trips. | B1 |
| `packages/runtime/src/services/run-store.ts` | **NEW.** `RunStoreService` (Context.Tag) + `RunStoreLive` (Layer) — SQLite `runs` + `run_checkpoints` tables, CRUD. | B2 |
| `packages/runtime/tests/services/run-store.test.ts` | **NEW.** Store CRUD + checkpoint upsert + latest-checkpoint query. | B2 |
| `packages/runtime/src/builder/types.ts` | MODIFY. `DurableRunsOptions` type. | B3 |
| `packages/runtime/src/builder.ts` | MODIFY. `.withDurableRuns(options?)` wither + private field. | B3 |
| `packages/runtime/src/builder/withers/_state.ts` + `build-effect/runtime-construction.ts` | MODIFY. Thread `_durableRuns` through to runtime options (mirror `_budgetLimits`). | B3 |
| `packages/runtime/src/run-controller.ts` (or a new durable controller) | MODIFY/NEW. Provide an `onCheckpoint` impl that writes to RunStore every `checkpointEvery` iterations. | B4 |
| `packages/runtime/src/runtime.ts` + `runtime-types.ts` | MODIFY. Wire the durable controller's `onCheckpoint` when `durableRuns` enabled; register `RunStoreLive`. | B4 |
| `packages/runtime/tests/durable-runs-write.test.ts` | **NEW.** Integration: opt-in run of N iterations writes `run_checkpoints` rows; disabled run writes nothing (zero-overhead). | B4 |

**Out of scope (Phase C+):** `resume(runId)`, `listRuns`, config-hash guard, crash e2e, durable HITL (approve/deny), Cortex UI. Phase B is the WRITE side only.

---

## Task B1: Refine the checkpoint seam to carry a lossless snapshot

**Files:**
- Modify: `packages/core/src/streaming.ts:47`
- Modify: `packages/reasoning/src/kernel/loop/iterate-pass.ts:369-377`
- Test: `packages/reasoning/tests/kernel/loop/durable-checkpoint-seam.test.ts`

**Why:** `asKernelStateLike(state)` is the narrow diagnostics shape — lossy for resume (the codec needs the full `KernelState`). The kernel owns both the full state and the codec, so it serializes there and hands the observer a string; core stays decoupled (no `KernelState` import).

- [ ] **Step 1: Update the failing seam test**

Change the existing seam test to assert the observer receives a serialized string that round-trips:
```ts
it("onCheckpoint receives a lossless serialized snapshot", async () => {
  const seen: { serialized: string; iteration: number }[] = [];
  const ctl: RunControllerLike = {
    checkpoint: async () => undefined,
    onCheckpoint: (serialized, iteration) => { seen.push({ serialized, iteration }); },
  };
  // ... run >=1 iteration with ctl installed (reuse the existing harness in this file) ...
  expect(seen.length).toBeGreaterThanOrEqual(1);
  const restored = deserializeKernelState(seen[0]!.serialized);
  expect(restored.iteration).toBe(seen[0]!.iteration);
  expect(Array.isArray(restored.steps)).toBe(true);
});
```
Import `deserializeKernelState` from `../../../src/kernel/state/kernel-codec.js`.

- [ ] **Step 2: Run — verify it fails**

Run: `cd packages/reasoning && bun test tests/kernel/loop/durable-checkpoint-seam.test.ts --timeout 20000`
Expected: FAIL — observer currently receives a `KernelStateLike` object, not a string.

- [ ] **Step 3: Change the core signature**

In `core/src/streaming.ts`, change the `RunControllerLike.onCheckpoint` signature + doc:
```ts
  /**
   * Optional durable-checkpoint observer. The kernel invokes it at each
   * iteration boundary with a LOSSLESS serialized snapshot of kernel state
   * (produced by the kernel's codec) plus the iteration number. The string is
   * opaque to core; a durable controller persists it and Phase C's resume()
   * rehydrates it. Must not throw / must not block — persistence is the impl's
   * concern. Absent on the default in-process controller (zero cost).
   */
  onCheckpoint?(serializedState: string, iteration: number): void;
```

- [ ] **Step 4: Serialize in the kernel seam**

In `iterate-pass.ts`, add the codec import (top of file, beside the other kernel-state imports):
```ts
import { serializeKernelState } from "../state/kernel-codec.js";
```
Replace the seam body (`:369-377`):
```ts
        if (_runCtl.onCheckpoint) {
          try {
            _runCtl.onCheckpoint(serializeKernelState(state), state.iteration);
          } catch (err) {
            const msg = `[durable-checkpoint] onCheckpoint observer threw at iteration ${state.iteration}: ${err instanceof Error ? err.message : String(err)}`;
            console.warn(msg);
            yield* Effect.logWarning(msg);
          }
        }
```
(`asKernelStateLike` may now be unused in this file — remove its import only if no other call site uses it; grep first.)

- [ ] **Step 5: Run — verify it passes + full suite**

Run: `cd packages/reasoning && bun test tests/kernel/loop/durable-checkpoint-seam.test.ts --timeout 20000` → PASS
Run: `cd packages/reasoning && bun test --timeout 60000` → baseline green (1651 + any new).
Run: `bunx turbo run build --filter=@reactive-agents/core --filter=@reactive-agents/reasoning` → green.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/streaming.ts packages/reasoning/src/kernel/loop/iterate-pass.ts packages/reasoning/tests/kernel/loop/durable-checkpoint-seam.test.ts
git commit -m "feat(kernel): durable checkpoint seam carries lossless serialized snapshot"
```

---

## Task B2: RunStoreService (SQLite)

**Files:**
- Create: `packages/runtime/src/services/run-store.ts`
- Test: `packages/runtime/tests/services/run-store.test.ts`

Mirror `memory/src/services/session-store.ts` (Context.Tag service + Live Layer + `CREATE TABLE IF NOT EXISTS`, `Database` from `@reactive-agents/runtime-shim`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { RunStoreService, RunStoreLive } from "../../src/services/run-store.js";

const inMem = RunStoreLive(":memory:");

describe("RunStoreService", () => {
  it("creates a run, writes checkpoints, reads the latest", async () => {
    const prog = Effect.gen(function* () {
      const store = yield* RunStoreService;
      yield* store.createRun({ runId: "r1", agentId: "a", task: "t", configHash: "h" });
      yield* store.putCheckpoint("r1", 2, '{"v":1,"iteration":2}');
      yield* store.putCheckpoint("r1", 4, '{"v":1,"iteration":4}');
      const latest = yield* store.latestCheckpoint("r1");
      const run = yield* store.getRun("r1");
      return { latest, run };
    });
    const { latest, run } = await Effect.runPromise(prog.pipe(Effect.provide(inMem)));
    expect(latest?.iteration).toBe(4);
    expect(latest?.stateJson).toContain('"iteration":4');
    expect(run?.status).toBe("running");
  });

  it("returns undefined for unknown run", async () => {
    const r = await Effect.runPromise(
      Effect.gen(function* () { return yield* (yield* RunStoreService).latestCheckpoint("nope"); })
        .pipe(Effect.provide(inMem)),
    );
    expect(r).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd packages/runtime && bun test tests/services/run-store.test.ts --timeout 15000`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement RunStoreService**

```ts
/**
 * run-store.ts — Durable run persistence (v0.12.0 track 1, Phase B).
 * SQLite-backed store for live run state + per-iteration checkpoints.
 * Mirrors SessionStoreService (memory pkg). Opt-in via .withDurableRuns().
 */
import { Context, Effect, Layer } from "effect";
import { Database } from "@reactive-agents/runtime-shim";

export type RunStatus = "running" | "paused" | "awaiting-approval" | "completed" | "failed";

export interface RunRecord {
  readonly runId: string;
  readonly agentId: string;
  readonly task: string;
  readonly status: RunStatus;
  readonly configHash: string;
  readonly updatedAt: number;
}

export interface CheckpointRecord {
  readonly iteration: number;
  readonly stateJson: string;
  readonly createdAt: number;
}

export interface RunStore {
  readonly createRun: (r: { runId: string; agentId: string; task: string; configHash: string }) => Effect.Effect<void, never>;
  readonly setStatus: (runId: string, status: RunStatus) => Effect.Effect<void, never>;
  readonly putCheckpoint: (runId: string, iteration: number, stateJson: string) => Effect.Effect<void, never>;
  readonly latestCheckpoint: (runId: string) => Effect.Effect<CheckpointRecord | undefined, never>;
  readonly getRun: (runId: string) => Effect.Effect<RunRecord | undefined, never>;
}

export class RunStoreService extends Context.Tag("RunStoreService")<RunStoreService, RunStore>() {}

export function RunStoreLive(dbPath: string): Layer.Layer<RunStoreService> {
  return Layer.sync(RunStoreService, () => {
    const db = new Database(dbPath);
    db.run(`CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY, agent_id TEXT, task TEXT, status TEXT,
      config_hash TEXT, created_at INTEGER, updated_at INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS run_checkpoints (
      run_id TEXT, iteration INTEGER, state_json TEXT, created_at INTEGER,
      PRIMARY KEY(run_id, iteration))`);

    const now = () => Date.now();
    return {
      createRun: ({ runId, agentId, task, configHash }) =>
        Effect.sync(() => {
          db.run(
            `INSERT OR REPLACE INTO runs (run_id, agent_id, task, status, config_hash, created_at, updated_at)
             VALUES (?, ?, ?, 'running', ?, ?, ?)`,
            [runId, agentId, task, configHash, now(), now()],
          );
        }),
      setStatus: (runId, status) =>
        Effect.sync(() => { db.run(`UPDATE runs SET status = ?, updated_at = ? WHERE run_id = ?`, [status, now(), runId]); }),
      putCheckpoint: (runId, iteration, stateJson) =>
        Effect.sync(() => {
          db.run(
            `INSERT OR REPLACE INTO run_checkpoints (run_id, iteration, state_json, created_at) VALUES (?, ?, ?, ?)`,
            [runId, iteration, stateJson, now()],
          );
          db.run(`UPDATE runs SET updated_at = ? WHERE run_id = ?`, [now(), runId]);
        }),
      latestCheckpoint: (runId) =>
        Effect.sync(() => {
          const row = db.query(`SELECT iteration, state_json, created_at FROM run_checkpoints
                                 WHERE run_id = ? ORDER BY iteration DESC LIMIT 1`).get(runId) as
            { iteration: number; state_json: string; created_at: number } | undefined;
          return row ? { iteration: row.iteration, stateJson: row.state_json, createdAt: row.created_at } : undefined;
        }),
      getRun: (runId) =>
        Effect.sync(() => {
          const row = db.query(`SELECT run_id, agent_id, task, status, config_hash, updated_at FROM runs WHERE run_id = ?`).get(runId) as
            { run_id: string; agent_id: string; task: string; status: string; config_hash: string; updated_at: number } | undefined;
          return row ? { runId: row.run_id, agentId: row.agent_id, task: row.task, status: row.status as RunStatus, configHash: row.config_hash, updatedAt: row.updated_at } : undefined;
        }),
    };
  });
}
```
> **Verify the `Database` API shape** against `session-store.ts` — if `DatabaseLike` uses `.prepare(...).run()/.get()` instead of `.run(sql, params)`/`.query(sql).get()`, mirror that exact API (the runtime-shim wrapper may differ from raw bun:sqlite). Copy the call style from `session-store.ts` verbatim; do not assume.

- [ ] **Step 4: Run — verify it passes**

Run: `cd packages/runtime && bun test tests/services/run-store.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/services/run-store.ts packages/runtime/tests/services/run-store.test.ts
git commit -m "feat(runtime): RunStoreService — SQLite durable run + checkpoint persistence"
```

---

## Task B3: `.withDurableRuns()` builder API

**Files:**
- Modify: `packages/runtime/src/builder/types.ts`, `builder.ts`, `builder/withers/_state.ts`, `builder/build-effect/runtime-construction.ts`, `runtime-types.ts`

Mirror the `budgetLimits` / `grounding` threading (grep `budgetLimits`, add a sibling `_durableRuns`).

- [ ] **Step 1: Write the failing builder test**

```ts
// packages/runtime/tests/builder/durable-runs.test.ts
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../../src/index.js";
describe(".withDurableRuns", () => {
  it("builds with durable runs enabled", async () => {
    const agent = await ReactiveAgents.create()
      .withName("d").withProvider("test").withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withDurableRuns({ checkpointEvery: 2 })
      .build();
    expect(agent).toBeDefined();
  });
  it("builds without durable runs by default", async () => {
    const agent = await ReactiveAgents.create()
      .withName("d2").withProvider("test").withTestScenario([{ text: "FINAL ANSWER: ok" }]).build();
    expect(agent).toBeDefined();
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd packages/runtime && bun test tests/builder/durable-runs.test.ts --timeout 15000`
Expected: FAIL — `.withDurableRuns` is not a function.

- [ ] **Step 3: Add the type + wither + threading**

`builder/types.ts`:
```ts
/** Options for `.withDurableRuns()` — opt-in durable run persistence. */
export interface DurableRunsOptions {
  /** SQLite directory. Default `~/.reactive-agents/<agentId>/`. */
  readonly dir?: string;
  /** Checkpoint every N iterations. Default 1. */
  readonly checkpointEvery?: number;
}
```
`builder.ts` (private field beside `_budgetLimits`; wither beside `withVerification`):
```ts
    private _durableRuns?: DurableRunsOptions;
    /**
     * Opt-in durable run persistence (off by default). Serializes kernel state
     * to a SQLite RunStore every `checkpointEvery` iterations so a crashed run
     * can be resumed (Phase C `resume()`). Folds in `withProgressCheckpoint`
     * semantics. Zero cost when not called.
     */
    withDurableRuns(options?: DurableRunsOptions): this {
        this._durableRuns = options ?? {};
        return this;
    }
```
`builder/withers/_state.ts`: add `_durableRuns: DurableRunsOptions | undefined;`.
`runtime-construction.ts`: add the readonly `_durableRuns` mirror + `durableRuns: state._durableRuns` in the options assembly (beside `budgetLimits`).
`runtime-types.ts`: add `durableRuns?: DurableRunsOptions` to `RuntimeOptions`.

- [ ] **Step 4: Run — verify it passes + build**

Run: `cd packages/runtime && bun test tests/builder/durable-runs.test.ts --timeout 15000` → PASS
Run: `bunx turbo run build --filter=@reactive-agents/runtime` → green.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/builder/types.ts packages/runtime/src/builder.ts packages/runtime/src/builder/withers/_state.ts packages/runtime/src/builder/build-effect/runtime-construction.ts packages/runtime/src/runtime-types.ts packages/runtime/tests/builder/durable-runs.test.ts
git commit -m "feat(runtime): .withDurableRuns() opt-in builder API"
```

---

## Task B4: Wire checkpoint writes through the controller

**Files:**
- Modify: `packages/runtime/src/run-controller.ts` (add `onCheckpoint` when durable) + `runtime.ts` (register `RunStoreLive`, pass `durableRuns` config, generate `runId`)
- Test: `packages/runtime/tests/durable-runs-write.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// Run a multi-iteration test-provider task with .withDurableRuns({ checkpointEvery: 1 }),
// then assert run_checkpoints has >=1 row for the run; and a run WITHOUT durable writes none.
// Model the agent-run harness on an existing runtime integration test (rg -l "agent.run" packages/runtime/tests).
it("writes checkpoints when durable runs enabled", async () => {
  // build agent with .withDurableRuns({ dir: tmpDir, checkpointEvery: 1 }); run a 2+ tool task
  // open the RunStore at tmpDir; assert latestCheckpoint(runId) is defined and deserializes
});
it("writes nothing when durable runs disabled (zero-overhead)", async () => {
  // build without .withDurableRuns(); run; assert no runs.db created at the default path under tmp
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd packages/runtime && bun test tests/durable-runs-write.test.ts --timeout 30000`
Expected: FAIL — no checkpoint writes wired.

- [ ] **Step 3: Wire the durable onCheckpoint**

When `durableRuns` is set, the runtime: (a) resolves `RunStoreLive(dbPath)` into the layer; (b) generates a `runId` (ulid) + `configHash` (hash of the serializable builder config — reuse `toConfig()` + `@reactive-agents/runtime-shim` `hash`); (c) calls `store.createRun(...)` at run start; (d) installs an `onCheckpoint(serialized, iteration)` on the `RunController` that, when `iteration % checkpointEvery === 0`, calls `store.putCheckpoint(runId, iteration, serialized)` via `Effect.runFork` (fire-and-forget, non-blocking — matches the seam's "must not block" contract); (e) sets status `completed`/`failed` at run end.

Keep the controller's `onCheckpoint` undefined when `durableRuns` is absent (zero cost — the kernel seam already no-ops on absent `onCheckpoint`).

> **Effect boundary note:** `onCheckpoint` is a plain (non-Effect) callback per the core contract. Inside it, run the store write with `Effect.runFork(putCheckpoint(...).pipe(Effect.provide(runStoreLayer)))` — do NOT block. Swallow/`emitErrorSwallowed` write failures (persistence must never break the run; non-silent per R11 — log a warning).

- [ ] **Step 4: Run — verify it passes**

Run: `cd packages/runtime && bun test tests/durable-runs-write.test.ts --timeout 30000`
Expected: PASS (enabled writes ≥1 checkpoint that deserializes; disabled writes nothing).

- [ ] **Step 5: Full runtime suite + build**

Run: `cd packages/runtime && bun test --timeout 60000` (note: the pre-existing `as-unknown-as-ceiling` test fails on main too — unrelated; confirm no NEW failures).
Run: `bunx turbo run build --filter=@reactive-agents/runtime` → green.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/run-controller.ts packages/runtime/src/runtime.ts packages/runtime/tests/durable-runs-write.test.ts
git commit -m "feat(runtime): wire durable checkpoint writes via RunStore (Phase B complete)"
```

> **End of Phase B.** Write side complete: opt-in runs persist serialized state every N iterations. **Phase C next:** `resume(runId)` reconstruction + config-hash guard + the hard-kill crash-resume e2e gate (the marketable story).

---

## Self-Review

**Spec coverage (Phase B row + §2.1/2.2/2.5):** RunStore tables (B2 — `runs` + `run_checkpoints` match §2.1 schema), `.withDurableRuns()` folding `withProgressCheckpoint` (B3 — note: the old method's deprecation-delegation is a Phase C/cleanup item, flagged not done here), checkpoint writes every N (B4), serialized lossless state (B1 — the codec-string seam, resolving the spec's "state_json = codec-serialized KernelState core"). Opt-in/zero-overhead (B3 default-absent + B4 disabled-writes-nothing test). ✓

**Deliberate scope cut:** `withProgressCheckpoint` delegation/deprecation deferred — B ships the new method; rewiring the old one is low-risk follow-up, avoids touching its existing (unwired) call path this phase.

**Placeholder scan:** B2 step 3 flags the one real unknown — the exact `Database` call API (`.run(sql,params)` vs `.prepare().run()`) — with a concrete instruction to copy `session-store.ts` verbatim, not guess. B4's harness defers to "nearest existing agent.run test" with a grep recipe. No invented signatures: codec (`serializeKernelState`/`deserializeKernelState`), seam (`onCheckpoint(serialized, iteration)`), and the budgetLimits threading pattern are all verified against current code.

**Type consistency:** `onCheckpoint(serializedState: string, iteration: number)` identical in core (B1) + controller wiring (B4). `RunStore` method names (`createRun`/`putCheckpoint`/`latestCheckpoint`/`getRun`/`setStatus`) consistent B2↔B4. `DurableRunsOptions {dir?, checkpointEvery?}` consistent B3↔B4. `checkpointEvery` default 1 stated in both B3 type doc and B4 logic.
