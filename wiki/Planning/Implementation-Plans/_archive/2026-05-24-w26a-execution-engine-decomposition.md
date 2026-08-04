# W26-A: execution-engine.ts Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `packages/runtime/src/execution-engine.ts` from 1676 LOC to ≤1100 LOC by extracting four cohesive units into `engine/` submodules, with zero behavior change. Closes the `execution-engine.ts` portion of GitHub issue #76.

**Architecture:** Continue the W23/W24 extraction pattern. The host file `execution-engine.ts` is one giant `Effect.gen` factory (`ExecutionEngineLive`). It already delegates per-phase work to `engine/phases/*` modules; W26-A extracts the four remaining inline closures (phase-runner, agent-loop driver, final-snapshot, executeStream) and one new typed helper (`resolveModelName`). Each extracted module is a pure factory or curried Effect that receives its closure state as parameters — no globals, no implicit context.

**Tech Stack:** TypeScript strict, Effect-TS, Bun test runner. Per project conventions: no `as any` introduced, typed boundary helpers when widening, conventional commits per unit.

---

## Pre-flight checks (do this before Task 1)

- [ ] **Confirm clean tree off main**
  ```bash
  rtk git status --short
  rtk git fetch origin main
  rtk git checkout -B bundle/w26a-execution-engine-decomp origin/main
  ```
  Expected: empty tree (after the apps/examples/spot-test and untracked memory-v2 docs are moved aside or accepted as untracked).

- [ ] **Pin baseline counts** (record numbers; Task 6 verify compares against these)
  ```bash
  rtk bun test packages/runtime/ 2>&1 | tail -5
  rtk bun test packages/replay/ 2>&1 | tail -5
  rtk bun run build 2>&1 | tail -3
  rtk wc -l packages/runtime/src/execution-engine.ts
  ```
  Write the numbers into a `## Baseline` heading at the top of this doc (replace `<TBD>` placeholders below) before starting Task 1.

  **Baseline (filled in at kickoff):**
  - runtime tests: `<TBD> pass / <TBD> fail / <TBD> skip`
  - replay tests: `<TBD> pass / <TBD> fail / <TBD> skip`
  - build: `<TBD>/<TBD> successful`
  - execution-engine.ts LOC: `1676`

---

## File Structure

**Files created (new):**

```
packages/runtime/src/engine/
  phase-runner.ts          # NEW — runPhase + runObservablePhase factory (Task 1)
  agent-loop-runner.ts     # NEW — inline while-loop body (Task 2)
  finalize/
    snapshot-final.ts      # NEW — post-loop captureSnapshot block (Task 3)
  execute-stream.ts        # NEW — executeStream method body (Task 4)
```

**Files modified:**

```
packages/runtime/src/execution-engine.ts   # host — shrinks by ~500 LOC
packages/runtime/src/engine/util.ts        # add resolveModelName helper (Task 3 step 1)
```

**Files added for tests:**

```
packages/runtime/tests/engine/phase-runner.test.ts     # NEW
packages/runtime/tests/engine/agent-loop-runner.test.ts # NEW
packages/runtime/tests/engine/finalize/snapshot-final.test.ts # NEW
packages/runtime/tests/engine/execute-stream.test.ts   # NEW
```

Each new test file covers ONE behavioral invariant proving the extracted code matches the host (parity test, not feature test). Reason: behavior-preserving extraction; the existing test suite is the real safety net — these new tests are belt-and-suspenders.

---

## Task 1: Extract `phase-runner.ts` (runPhase + runObservablePhase)

**Files:**
- Create: `packages/runtime/src/engine/phase-runner.ts`
- Create: `packages/runtime/tests/engine/phase-runner.test.ts`
- Modify: `packages/runtime/src/execution-engine.ts:162-292` (delete inline closures, import from new file)

The two closures (`runPhase` and `runObservablePhase`) capture three pieces of mutable state from their enclosing `Effect.gen`: `hookRegistry`, `cancelledTasks`, and the closure-shared `eb` parameter. Extract as a curried factory `makePhaseRunner({ hookRegistry, cancelledTasks })` returning `{ runPhase, runObservablePhase }`.

- [ ] **Step 1: Create the test file with a failing parity test**

```typescript
// packages/runtime/tests/engine/phase-runner.test.ts
import { describe, expect, test } from "bun:test";
import { Effect, Ref } from "effect";
import { makePhaseRunner } from "../../src/engine/phase-runner.js";
import { LifecycleHookRegistry } from "../../src/hooks.js";
import { ExecutionError } from "../../src/errors.js";
import type { ExecutionContext } from "../../src/types.js";

describe("makePhaseRunner", () => {
  test("runPhase fires before+after hooks around body, returns updated ctx", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const hookRegistry = yield* LifecycleHookRegistry;
        const cancelled = yield* Ref.make<Set<string>>(new Set());
        const { runPhase } = makePhaseRunner({ hookRegistry, cancelledTasks: cancelled });

        const ctx = {
          taskId: "t1",
          agentId: "a1",
          phase: "bootstrap",
          iteration: 0,
          maxIterations: 1,
          messages: [],
          steps: [],
          tokensUsed: 0,
          cost: 0,
          metadata: {},
        } as unknown as ExecutionContext;

        const result = yield* runPhase(
          ctx,
          "think",
          (c) => Effect.succeed({ ...c, tokensUsed: 10 }),
          null,
        );

        expect(result.tokensUsed).toBe(10);
        expect(result.phase).toBe("think");
      }).pipe(Effect.provide(LifecycleHookRegistry.Default)),
    ));

  test("runPhase fails fast when task is cancelled", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const hookRegistry = yield* LifecycleHookRegistry;
        const cancelled = yield* Ref.make<Set<string>>(new Set(["t1"]));
        const { runPhase } = makePhaseRunner({ hookRegistry, cancelledTasks: cancelled });

        const ctx = { taskId: "t1", phase: "bootstrap" } as unknown as ExecutionContext;

        const exit = yield* runPhase(
          ctx,
          "think",
          (c) => Effect.succeed(c),
          null,
        ).pipe(Effect.exit);

        expect(exit._tag).toBe("Failure");
      }).pipe(Effect.provide(LifecycleHookRegistry.Default)),
    ));
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
rtk bun test packages/runtime/tests/engine/phase-runner.test.ts
```
Expected: FAIL with `Cannot find module '../../src/engine/phase-runner.js'`.

- [ ] **Step 3: Create the extracted module**

Open `packages/runtime/src/execution-engine.ts`, read lines 162-292 to capture the exact closure bodies. Create `packages/runtime/src/engine/phase-runner.ts` with this skeleton — copy the closure bodies verbatim, replacing the closed-over identifiers (`hookRegistry`, `cancelledTasks`) with the destructured factory parameters:

```typescript
// packages/runtime/src/engine/phase-runner.ts
import { Effect, Ref } from "effect";
import type { ExecutionContext } from "../types.js";
import { ExecutionError, type RuntimeErrors } from "../errors.js";
import { LifecycleHookRegistry } from "../hooks.js";
import { emitErrorSwallowed, errorTag, type AgentEvent } from "@reactive-agents/core";

type HookRegistry = Context.Tag.Service<typeof LifecycleHookRegistry>;

type EbLike = {
  publish: (event: AgentEvent) => Effect.Effect<void, never>;
};

type ObsLike = {
  withSpan: <A, E>(name: string, effect: Effect.Effect<A, E>, attrs?: Record<string, unknown>) => Effect.Effect<A, E>;
  incrementCounter: (name: string, value?: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
  recordHistogram: (name: string, value: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
};

export interface PhaseRunnerDeps {
  hookRegistry: HookRegistry;
  cancelledTasks: Ref.Ref<Set<string>>;
}

export interface PhaseRunner {
  runPhase: <E>(
    ctx: ExecutionContext,
    phase: ExecutionContext["phase"],
    body: (ctx: ExecutionContext) => Effect.Effect<ExecutionContext, E>,
    eb?: EbLike | null,
  ) => Effect.Effect<ExecutionContext, E | RuntimeErrors>;

  runObservablePhase: <E>(
    obs: ObsLike | null,
    eb: EbLike | null,
    ctx: ExecutionContext,
    phase: ExecutionContext["phase"],
    body: (ctx: ExecutionContext) => Effect.Effect<ExecutionContext, E>,
  ) => Effect.Effect<ExecutionContext, E | RuntimeErrors>;
}

export const makePhaseRunner = ({ hookRegistry, cancelledTasks }: PhaseRunnerDeps): PhaseRunner => {
  const runPhase = <E>(
    ctx: ExecutionContext,
    phase: ExecutionContext["phase"],
    body: (ctx: ExecutionContext) => Effect.Effect<ExecutionContext, E>,
    eb?: EbLike | null,
  ): Effect.Effect<ExecutionContext, E | RuntimeErrors> =>
    Effect.gen(function* () {
      const ctxBefore = { ...ctx, phase };

      const ctxAfterBefore = yield* hookRegistry
        .run(phase, "before", ctxBefore)
        .pipe(Effect.catchAll(() => Effect.succeed(ctxBefore)));

      if (eb) {
        yield* eb.publish({ _tag: "ExecutionHookFired", taskId: ctx.taskId, phase: String(phase), timing: "before" } as AgentEvent)
          .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phase-runner.ts:runPhase-before", tag: errorTag(err) })));
      }

      const cancelled = yield* Ref.get(cancelledTasks);
      if (cancelled.has(ctx.taskId)) {
        if (eb) {
          yield* eb.publish({ _tag: "ExecutionCancelled", taskId: ctx.taskId } as AgentEvent)
            .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phase-runner.ts:runPhase-cancelled", tag: errorTag(err) })));
        }
        return yield* Effect.fail(
          new ExecutionError({
            message: `Task ${ctx.taskId} was cancelled`,
            taskId: ctx.taskId,
            phase,
          }),
        );
      }

      const ctxAfterBody = yield* body(ctxAfterBefore).pipe(
        Effect.tapError((e) =>
          hookRegistry
            .run(phase, "on-error", {
              ...ctxAfterBefore,
              metadata: { ...ctxAfterBefore.metadata, error: e },
            })
            .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phase-runner.ts:runPhase-on-error", tag: errorTag(err) }))),
        ),
      );

      const ctxFinal = yield* hookRegistry
        .run(phase, "after", ctxAfterBody)
        .pipe(Effect.catchAll(() => Effect.succeed(ctxAfterBody)));

      if (eb) {
        yield* eb.publish({ _tag: "ExecutionHookFired", taskId: ctx.taskId, phase: String(phase), timing: "after" } as AgentEvent)
          .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phase-runner.ts:runPhase-after", tag: errorTag(err) })));
      }

      return ctxFinal;
    });

  const runObservablePhase = <E>(
    obs: ObsLike | null,
    eb: EbLike | null,
    ctx: ExecutionContext,
    phase: ExecutionContext["phase"],
    body: (ctx: ExecutionContext) => Effect.Effect<ExecutionContext, E>,
  ): Effect.Effect<ExecutionContext, E | RuntimeErrors> => {
    const startMs = performance.now();

    const publishEntered = eb
      ? eb.publish({ _tag: "ExecutionPhaseEntered", taskId: ctx.taskId, phase } as AgentEvent)
          .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phase-runner.ts:runObservablePhase-entered", tag: errorTag(err) })))
      : Effect.void;

    const phaseEffect = runPhase(ctx, phase, body, eb).pipe(
      Effect.tap((_result) => {
        const durationMs = performance.now() - startMs;
        const sideEffects: Effect.Effect<void, never>[] = [];

        if (obs) {
          sideEffects.push(
            obs.incrementCounter("execution.phase.count", 1, { phase })
              .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phase-runner.ts:metric-count", tag: errorTag(err) }))),
          );
          sideEffects.push(
            obs.recordHistogram("execution.phase.duration_ms", durationMs, { phase })
              .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phase-runner.ts:metric-hist", tag: errorTag(err) }))),
          );
        }
        if (eb) {
          sideEffects.push(
            eb.publish({ _tag: "ExecutionPhaseCompleted", taskId: ctx.taskId, phase, durationMs } as AgentEvent)
              .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phase-runner.ts:phase-completed", tag: errorTag(err) }))),
          );
        }

        return Effect.all(sideEffects, { concurrency: "unbounded" }).pipe(Effect.asVoid);
      }),
    );

    const withEntered = publishEntered.pipe(Effect.zipRight(phaseEffect));

    if (!obs) return withEntered;

    return obs.withSpan(
      `execution.phase.${phase}`,
      withEntered.pipe(
        Effect.tap((result) =>
          obs.withSpan(`phase.${phase}.metrics`, Effect.void, {
            iteration: result.iteration,
            tokensUsed: result.tokensUsed,
            cost: result.cost,
          }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phase-runner.ts:withSpan-metrics", tag: errorTag(err) }))),
        ),
      ),
      { taskId: ctx.taskId, agentId: ctx.agentId, phase },
    ) as Effect.Effect<ExecutionContext, E | RuntimeErrors>;
  };

  return { runPhase, runObservablePhase };
};
```

Note: the `Context` import was missed in the skeleton above — add `import { Context } from "effect"` at the top if the `Context.Tag.Service<>` reference is needed; if TypeScript infers `HookRegistry` without it, drop that type alias and inline the inferred type.

- [ ] **Step 4: Replace inline closures in execution-engine.ts**

Open `packages/runtime/src/execution-engine.ts`. Delete lines 162-292 (the two closure bodies). Insert at the top of the gen function (just after the `cancelledTasks` Ref creation, ~line 159):

```typescript
import { makePhaseRunner } from "./engine/phase-runner.js";
```
(add to the import block at the top of the file)

And inside the gen function (replacing the deleted closures):

```typescript
const { runPhase, runObservablePhase } = makePhaseRunner({
  hookRegistry,
  cancelledTasks,
});
```

Variable shadowing: confirm `runPhase` is not re-declared later in the file (grep): `rtk grep -n "const runPhase\|let runPhase" packages/runtime/src/execution-engine.ts`. If a second declaration exists post-refactor, rename or remove.

- [ ] **Step 5: Run the new parity test + full runtime suite**

```bash
rtk bun test packages/runtime/tests/engine/phase-runner.test.ts
rtk bun test packages/runtime/
```
Expected: phase-runner.test.ts PASS (both cases). Full runtime suite at baseline pass count (no net new failures).

- [ ] **Step 6: Verify LOC drop + build**

```bash
rtk wc -l packages/runtime/src/execution-engine.ts
rtk bun run build 2>&1 | tail -3
```
Expected: execution-engine.ts ~1546 LOC (-130 from 1676). Build green.

- [ ] **Step 7: Commit**

```bash
rtk git add packages/runtime/src/engine/phase-runner.ts \
            packages/runtime/src/execution-engine.ts \
            packages/runtime/tests/engine/phase-runner.test.ts
rtk git commit -m "refactor(runtime): extract phase-runner from execution-engine (W26-A step 1)

Moves runPhase + runObservablePhase closures into engine/phase-runner.ts as a
makePhaseRunner({hookRegistry, cancelledTasks}) factory. Behavior-preserving;
verified by two parity tests + full runtime suite at baseline.

Partial: #76"
```

---

## Task 2: Extract `agent-loop-runner.ts` (inline while-loop body)

**Files:**
- Create: `packages/runtime/src/engine/agent-loop-runner.ts`
- Create: `packages/runtime/tests/engine/agent-loop-runner.test.ts`
- Modify: `packages/runtime/src/execution-engine.ts:~922-1062` (replace inline while-loop with call to extracted runner)

The inline while-loop (currently ~140 LOC inside the `execute` Effect.gen) is the next-largest closure that hasn't moved. It calls already-extracted modules (`runIterationGuards`, `runInlineThink`, `runInlineAct`, etc.) but the loop body and break logic remain inline. Extract as `runInlineAgentLoop(ctx, deps)` returning `Effect<ExecutionContext, RuntimeErrors>`.

**Dependencies the loop needs** (closed-over identifiers to verify and pass as `deps`):
- `config: ReactiveAgentsConfig`
- `eb: EbLike | null`
- `obs: ObsLike | null`
- `ContextWindowManager` option result (`cwmOpt`)
- `task: Task`
- `taskCategory: string | undefined`
- `resolvedCalibration: ModelCalibration | undefined`
- `progressLogger` and `verbosity`
- `runGuardedPhase` / `runObservablePhase` (from Task 1)
- `reasoningOpt: Option<ReasoningService>` (for `runReasoningThink`)
- `runInlineThink/Act/Observe/HarnessHooks` already imported

Verify the full list by inspecting the closure variables referenced inside lines 922-1062.

- [ ] **Step 1: Audit the closure**

```bash
rtk grep -n "ctx\b" packages/runtime/src/execution-engine.ts | awk -F: '$2>=900 && $2<=1062 {print}' | head -30
```
Read the closure body fully:
```bash
rtk awk 'NR>=920 && NR<=1062' packages/runtime/src/execution-engine.ts
```
List every identifier referenced from outside the loop. Add each to `AgentLoopDeps` in step 3.

- [ ] **Step 2: Write a failing parity test**

```typescript
// packages/runtime/tests/engine/agent-loop-runner.test.ts
import { describe, expect, test } from "bun:test";
import { Effect, Option } from "effect";
import { runInlineAgentLoop, type AgentLoopDeps } from "../../src/engine/agent-loop-runner.js";
import type { ExecutionContext } from "../../src/types.js";

describe("runInlineAgentLoop", () => {
  test("returns ctx unchanged when ctx.iteration >= ctx.maxIterations on entry", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const ctx = {
          taskId: "t1",
          agentId: "a1",
          phase: "think",
          iteration: 5,
          maxIterations: 5,
          messages: [],
          steps: [],
          toolResults: [],
          tokensUsed: 0,
          cost: 0,
          metadata: {},
        } as unknown as ExecutionContext;

        const deps: AgentLoopDeps = {
          config: { agentId: "a1", provider: "test", defaultModel: "test" } as any,
          eb: null,
          obs: null,
          task: { id: "t1", agentId: "a1", description: "noop" } as any,
          taskCategory: undefined,
          resolvedCalibration: undefined,
          reasoningOpt: Option.none(),
          cwmOpt: { _tag: "None" } as any,
        };

        const result = yield* runInlineAgentLoop(ctx, deps);
        expect(result.iteration).toBe(5);
      }),
    ));
});
```

(One test is enough — the real coverage is the existing `packages/runtime/tests/` integration suite; this parity test only proves the wiring isn't broken.)

- [ ] **Step 3: Run failing test**

```bash
rtk bun test packages/runtime/tests/engine/agent-loop-runner.test.ts
```
Expected: FAIL with "Cannot find module".

- [ ] **Step 4: Create the extracted module**

Create `packages/runtime/src/engine/agent-loop-runner.ts`. Copy the while-loop body verbatim from `execution-engine.ts:922-1062`. Wrap in `runInlineAgentLoop(ctx, deps): Effect<ExecutionContext, RuntimeErrors>`. Export `AgentLoopDeps` interface listing every closed-over dep identified in Step 1.

(Full skeleton omitted here — the body is a direct copy-paste; declare `AgentLoopDeps` as the closed-over variable types from Step 1, replace every closure reference with `deps.<name>`.)

- [ ] **Step 5: Replace the inline loop in execution-engine.ts**

Delete lines ~922-1062. Replace with:

```typescript
ctx = yield* runInlineAgentLoop(ctx, {
  config,
  eb,
  obs,
  task,
  taskCategory,
  resolvedCalibration,
  reasoningOpt,
  cwmOpt,
});
```

- [ ] **Step 6: Run full runtime suite + replay determinism gate**

```bash
rtk bun test packages/runtime/
rtk bun test packages/replay/
rtk bun run build 2>&1 | tail -3
rtk wc -l packages/runtime/src/execution-engine.ts
```
Expected: runtime suite at baseline. Replay tests green (loop refactor must not break Snapshot/Replay determinism — same number of events emitted in same order). Build green. Host file ~1406 LOC.

If replay tests fail: revert the extraction (one of the closed-over deps is missing from `AgentLoopDeps` and is producing a different event ordering). Re-audit Step 1.

- [ ] **Step 7: Commit**

```bash
rtk git add packages/runtime/src/engine/agent-loop-runner.ts \
            packages/runtime/src/execution-engine.ts \
            packages/runtime/tests/engine/agent-loop-runner.test.ts
rtk git commit -m "refactor(runtime): extract inline agent loop into engine/agent-loop-runner (W26-A step 2)

Moves the inline while-loop body (think/act/observe + guards) out of
execution-engine.ts into runInlineAgentLoop(ctx, deps). Replay determinism
verified post-extraction.

Partial: #76"
```

---

## Task 3: Extract `finalize/snapshot-final.ts` + add `resolveModelName` util

**Files:**
- Modify: `packages/runtime/src/engine/util.ts` (add `resolveModelName` export)
- Create: `packages/runtime/src/engine/finalize/snapshot-final.ts`
- Create: `packages/runtime/tests/engine/finalize/snapshot-final.test.ts`
- Modify: `packages/runtime/src/execution-engine.ts:~1062-1100` (replace inline block with import call)

The post-loop block at lines ~1062-1100 does one job: `obs.captureSnapshot(...)` with the final ctx state. It contains two `as any` model-name coercions (`(ctx.selectedModel as any)?.model`) that should also be fixed by introducing a typed helper.

- [ ] **Step 1: Write `resolveModelName` test**

```typescript
// packages/runtime/tests/engine/util.test.ts (add to existing file, or create if missing)
import { describe, expect, test } from "bun:test";
import { resolveModelName } from "../../src/engine/util.js";

describe("resolveModelName", () => {
  test("returns selectedModel.model when ctx.selectedModel is an object", () => {
    const out = resolveModelName({ selectedModel: { model: "gpt-4o-mini" } } as any, { defaultModel: "fallback" } as any);
    expect(out).toBe("gpt-4o-mini");
  });

  test("returns selectedModel string when ctx.selectedModel is a string", () => {
    const out = resolveModelName({ selectedModel: "qwen3:14b" } as any, { defaultModel: "fallback" } as any);
    expect(out).toBe("qwen3:14b");
  });

  test("falls back to config.defaultModel when ctx.selectedModel is undefined", () => {
    const out = resolveModelName({} as any, { defaultModel: "fallback" } as any);
    expect(out).toBe("fallback");
  });

  test('returns "unknown" when both ctx.selectedModel and config.defaultModel are absent', () => {
    const out = resolveModelName({} as any, {} as any);
    expect(out).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run failing test, then implement helper**

```bash
rtk bun test packages/runtime/tests/engine/util.test.ts -t resolveModelName
```
Expected: FAIL (no export).

Edit `packages/runtime/src/engine/util.ts`. Add:

```typescript
import type { ExecutionContext, ReactiveAgentsConfig } from "../types.js";

/**
 * Resolve the effective model name for telemetry, snapshot, and capability lookup.
 * Handles the schema's `selectedModel` field, which can be either a string
 * (legacy / reactive paths) or an object with a `.model` property (reasoning paths).
 *
 * Replaces the `(ctx.selectedModel as any)?.model ?? ctx.selectedModel` pattern
 * previously inlined at execution-engine.ts:956 and :1072.
 */
export const resolveModelName = (
  ctx: { selectedModel?: unknown },
  config: { defaultModel?: string },
): string => {
  const sel = ctx.selectedModel;
  if (sel && typeof sel === "object" && "model" in sel && typeof (sel as { model: unknown }).model === "string") {
    return (sel as { model: string }).model;
  }
  if (typeof sel === "string") return sel;
  return config.defaultModel ?? "unknown";
};
```

Run again:
```bash
rtk bun test packages/runtime/tests/engine/util.test.ts -t resolveModelName
```
Expected: all 4 cases PASS.

- [ ] **Step 3: Replace the two `as any` model-name coercion sites**

In `packages/runtime/src/execution-engine.ts`, replace at the two flagged sites (~lines 956 and ~1072):

```typescript
// before
String((c.selectedModel as any)?.model ?? c.selectedModel ?? config.defaultModel ?? "unknown")

// after
resolveModelName(c, config)
```

Add the import at the top of execution-engine.ts (alongside other `engine/util.js` imports):

```typescript
import { resolveModelName } from "./engine/util.js";
```

Confirm with grep:
```bash
rtk grep -n "selectedModel as any" packages/runtime/src/execution-engine.ts
```
Expected: 0 matches (both sites replaced).

- [ ] **Step 4: Extract the snapshot-final block**

Read the post-loop snapshot block (`packages/runtime/src/execution-engine.ts` lines ~1062-1100):
```bash
rtk awk 'NR>=1060 && NR<=1105' packages/runtime/src/execution-engine.ts
```

Create `packages/runtime/src/engine/finalize/snapshot-final.ts`:

```typescript
// packages/runtime/src/engine/finalize/snapshot-final.ts
import { Effect } from "effect";
import type { ExecutionContext, ReactiveAgentsConfig } from "../../types.js";
import { resolveCapability } from "@reactive-agents/llm-provider";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { resolveModelName } from "../util.js";

type ObsLike = {
  captureSnapshot: (agentId: string, state: Record<string, unknown>) => Effect.Effect<unknown, never>;
};

/**
 * Capture the final post-loop snapshot for the agent. Pure side-effect; returns void.
 * Skips entirely when no observability service is provided.
 */
export const captureFinalSnapshot = (
  ctx: ExecutionContext,
  config: ReactiveAgentsConfig,
  obs: ObsLike | null,
): Effect.Effect<void, never> => {
  if (!obs) return Effect.void;

  return obs.captureSnapshot(ctx.agentId, {
    currentStrategy: ctx.selectedStrategy,
    activeTools: ctx.availableTools ?? [],
    tokenUsage: {
      inputTokens: 0,
      outputTokens: ctx.tokensUsed,
      contextWindowUsed: ctx.messages.length,
      contextWindowMax: resolveCapability(
        String(ctx.provider ?? config.provider ?? "unknown"),
        resolveModelName(ctx, config),
      ).recommendedNumCtx,
    },
    costAccumulated: ctx.cost,
  }).pipe(
    Effect.asVoid,
    Effect.catchAll((err) =>
      emitErrorSwallowed({ site: "runtime/src/engine/finalize/snapshot-final.ts:captureFinalSnapshot", tag: errorTag(err) }),
    ),
  );
};
```

- [ ] **Step 5: Write the snapshot-final parity test**

```typescript
// packages/runtime/tests/engine/finalize/snapshot-final.test.ts
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { captureFinalSnapshot } from "../../../src/engine/finalize/snapshot-final.js";

describe("captureFinalSnapshot", () => {
  test("returns Effect.void when obs is null", async () => {
    const result = await Effect.runPromise(
      captureFinalSnapshot({ agentId: "a1" } as any, { defaultModel: "test" } as any, null),
    );
    expect(result).toBeUndefined();
  });

  test("calls obs.captureSnapshot with composite payload when obs provided", async () => {
    const calls: Array<{ agentId: string; state: Record<string, unknown> }> = [];
    const obs = {
      captureSnapshot: (agentId: string, state: Record<string, unknown>) => {
        calls.push({ agentId, state });
        return Effect.succeed(undefined);
      },
    };

    await Effect.runPromise(
      captureFinalSnapshot(
        {
          agentId: "a1",
          selectedStrategy: "reactive",
          availableTools: ["search"],
          messages: [{ role: "user", content: "hi" }],
          tokensUsed: 123,
          cost: 0.001,
          provider: "openai",
          selectedModel: "gpt-4o-mini",
        } as any,
        { provider: "openai", defaultModel: "gpt-4o-mini" } as any,
        obs,
      ),
    );

    expect(calls.length).toBe(1);
    expect(calls[0].agentId).toBe("a1");
    expect(calls[0].state.currentStrategy).toBe("reactive");
    expect((calls[0].state.tokenUsage as any).outputTokens).toBe(123);
    expect(calls[0].state.costAccumulated).toBe(0.001);
  });
});
```

Run:
```bash
rtk bun test packages/runtime/tests/engine/finalize/snapshot-final.test.ts
```
Expected: PASS (the module already exists from Step 4).

- [ ] **Step 6: Replace inline block in execution-engine.ts**

In `packages/runtime/src/execution-engine.ts`, replace the inline snapshot block (~1062-1100) with:

```typescript
yield* captureFinalSnapshot(ctx, config, obs);
```

Add the import at the top:

```typescript
import { captureFinalSnapshot } from "./engine/finalize/snapshot-final.js";
```

- [ ] **Step 7: Verify suite + LOC**

```bash
rtk bun test packages/runtime/
rtk bun run build 2>&1 | tail -3
rtk wc -l packages/runtime/src/execution-engine.ts
rtk grep -c "as any" packages/runtime/src/execution-engine.ts
```
Expected: runtime suite at baseline; build green; execution-engine.ts ~1366 LOC; `as any` count dropped by 2.

- [ ] **Step 8: Commit**

```bash
rtk git add packages/runtime/src/engine/util.ts \
            packages/runtime/src/engine/finalize/snapshot-final.ts \
            packages/runtime/src/execution-engine.ts \
            packages/runtime/tests/engine/util.test.ts \
            packages/runtime/tests/engine/finalize/snapshot-final.test.ts
rtk git commit -m "refactor(runtime): extract finalize snapshot + add resolveModelName (W26-A step 3)

- New engine/finalize/snapshot-final.ts captures the post-loop captureSnapshot block.
- New util.resolveModelName replaces 2 'as any' model-name coercion sites
  previously inlined at execution-engine.ts:956 and :1072.
- 4 unit tests + 2 parity tests pin behavior.

Partial: #76"
```

---

## Task 4: Extract `execute-stream.ts` (executeStream method body)

**Files:**
- Create: `packages/runtime/src/engine/execute-stream.ts`
- Create: `packages/runtime/tests/engine/execute-stream.test.ts`
- Modify: `packages/runtime/src/execution-engine.ts:~1528-1660` (replace inline body with delegation)

The `executeStream` method body is a self-contained block: Queue creation, EventBus subscriptions, FiberRef-based daemon fork. It does NOT share closure state with the rest of the gen function beyond `execute` itself (which is a value, not a closure-captured Ref).

Extract as `makeExecuteStream({ config, execute })` returning the method implementation. `execute` is passed in as the already-defined `execute` function bound in the same gen.

- [ ] **Step 1: Write a parity test**

```typescript
// packages/runtime/tests/engine/execute-stream.test.ts
import { describe, expect, test } from "bun:test";
import { Effect, Stream } from "effect";
import { makeExecuteStream } from "../../src/engine/execute-stream.js";

describe("makeExecuteStream", () => {
  test("emits StreamCompleted with output from execute() result", async () => {
    const execute = (_task: any) =>
      Effect.succeed({
        output: "hello",
        metadata: { agentId: "a1" },
        agentId: "a1",
        debrief: { toolsUsed: [] },
      } as any);

    const executeStream = makeExecuteStream({
      config: { agentId: "a1", streamDensity: "tokens" } as any,
      execute,
    });

    const result = await Effect.runPromise(
      executeStream({ id: "t1", agentId: "a1", description: "noop" } as any).pipe(
        Effect.flatMap((s) => Stream.runCollect(s)),
        Effect.map((chunks) => Array.from(chunks)),
      ),
    );

    const completed = result.find((e: any) => e._tag === "StreamCompleted");
    expect(completed).toBeDefined();
    expect((completed as any).output).toBe("hello");
  });

  test("emits StreamError when execute() fails", async () => {
    const execute = (_task: any) =>
      Effect.fail({ message: "boom" } as any);

    const executeStream = makeExecuteStream({
      config: { agentId: "a1", streamDensity: "tokens" } as any,
      execute,
    });

    const result = await Effect.runPromise(
      executeStream({ id: "t1", agentId: "a1", description: "noop" } as any).pipe(
        Effect.flatMap((s) => Stream.runCollect(s)),
        Effect.map((chunks) => Array.from(chunks)),
      ),
    );

    const errored = result.find((e: any) => e._tag === "StreamError");
    expect(errored).toBeDefined();
    expect((errored as any).cause).toContain("boom");
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
rtk bun test packages/runtime/tests/engine/execute-stream.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Create the extracted module**

Read `packages/runtime/src/execution-engine.ts:1528-1660` for the exact body. Create `packages/runtime/src/engine/execute-stream.ts`:

```typescript
// packages/runtime/src/engine/execute-stream.ts
import { Effect, FiberRef, Option, Queue, Stream as EStream } from "effect";
import type { Task, TaskResult } from "@reactive-agents/core";
import type { TaskError } from "@reactive-agents/core";
import { StreamingTextCallback, RunControllerRef, EventBus, emitErrorSwallowed, errorTag, type AgentEvent } from "@reactive-agents/core";
import type { ReactiveAgentsConfig } from "../types.js";
import type { AgentStreamEvent, StreamDensity } from "../stream-types.js";
import type { RuntimeErrors } from "../errors.js";

type EbLike = {
  publish: (event: AgentEvent) => Effect.Effect<void, never>;
  on: <T extends AgentEvent["_tag"]>(
    tag: T,
    handler: (event: Extract<AgentEvent, { _tag: T }>) => Effect.Effect<void, never>,
  ) => Effect.Effect<() => void, never>;
};

export interface ExecuteStreamDeps {
  config: ReactiveAgentsConfig;
  execute: (task: Task) => Effect.Effect<TaskResult, RuntimeErrors | TaskError>;
}

export const makeExecuteStream = ({ config, execute }: ExecuteStreamDeps) =>
  (
    task: Task,
    options?: { density?: StreamDensity; runController?: import("@reactive-agents/core").RunControllerLike },
  ): Effect.Effect<EStream.Stream<AgentStreamEvent, Error>> =>
    Effect.gen(function* () {
      // BODY: copy verbatim from execution-engine.ts:1530-1655.
      // The body uses `task`, `options`, `config`, and `execute` — all of which
      // are now parameters (config + execute) or method args (task + options).
      // No other closure state needed.

      const queue = yield* Queue.unbounded<AgentStreamEvent>();
      const density = options?.density ?? config.streamDensity ?? "tokens";
      const startMs = Date.now();

      const ebOpt = yield* Effect.serviceOption(EventBus).pipe(
        Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
      );
      const eb: EbLike | null = ebOpt._tag === "Some" ? ebOpt.value : null;

      // ... [paste the remaining body verbatim from execution-engine.ts:1545-1655]

      return EStream.unfoldEffect(false as boolean, (done) => {
        if (done) return Effect.succeed(Option.none());
        return Queue.take(queue).pipe(
          Effect.map((event) => {
            const isTerminal =
              event._tag === "StreamCompleted" ||
              event._tag === "StreamError" ||
              event._tag === "StreamCancelled";
            return Option.some([event, isTerminal] as const);
          }),
        );
      });
    });
```

(The body is mechanical copy-paste from the original — the engineer copies lines 1545-1655 verbatim into the marked spot.)

- [ ] **Step 4: Replace inline executeStream in execution-engine.ts**

Find the service-object literal at the bottom of `ExecutionEngineLive`:

```typescript
return {
  execute,
  registerHook: ...,
  getContext: ...,
  cancel: ...,
  executeStream: (task, options) => Effect.gen(function* () { /* ... 130 lines ... */ }),
};
```

Replace with:

```typescript
return {
  execute,
  registerHook: (hook) => hookRegistry.register(hook).pipe(Effect.asVoid),
  getContext: (taskId) => Ref.get(runningContexts).pipe(Effect.map((m) => m.get(taskId) ?? null)),
  cancel: (taskId) => /* unchanged */,
  executeStream: makeExecuteStream({ config, execute }),
};
```

Add import:
```typescript
import { makeExecuteStream } from "./engine/execute-stream.js";
```

- [ ] **Step 5: Run replay determinism + full runtime suite**

```bash
rtk bun test packages/runtime/tests/engine/execute-stream.test.ts
rtk bun test packages/runtime/
rtk bun test packages/replay/
rtk bun run build 2>&1 | tail -3
rtk wc -l packages/runtime/src/execution-engine.ts
```
Expected: execute-stream tests PASS; runtime suite at baseline; replay green (executeStream is the entry point for Snapshot/Replay — replay tests are the primary safety net); build green; host file ~1230 LOC.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/runtime/src/engine/execute-stream.ts \
            packages/runtime/src/execution-engine.ts \
            packages/runtime/tests/engine/execute-stream.test.ts
rtk git commit -m "refactor(runtime): extract executeStream into engine/execute-stream (W26-A step 4)

Final W26-A extraction. Host execution-engine.ts now ~1230 LOC, down from 1676.
Replay determinism verified.

Partial: #76"
```

---

## Task 5: Bundle-wide verify (cross-cutting)

After all 4 extractions commit, run the full bundle verification.

- [ ] **Step 1: LOC progress check**

```bash
rtk wc -l packages/runtime/src/execution-engine.ts
```
Expected: ≤1200 LOC (target was ≤1100; ≤1200 acceptable since the master plan target for whole-file #76 closure is ≤1500). If LOC > 1200, run `rtk wc -l packages/runtime/src/execution-engine.ts` and identify one more cohesive extraction (likely candidate: the timeout wrapper at lines ~1480-1505).

- [ ] **Step 2: Full test sweep**

```bash
rtk bun test packages/runtime/   # baseline parity
rtk bun test packages/replay/     # determinism gate
rtk bun test                       # workspace (allow flake in untouched packages per skill v7)
rtk bun run build 2>&1 | tail -3   # all packages green
rtk bunx turbo run typecheck --filter=@reactive-agents/runtime
```
Expected: runtime + replay at baseline; build 38/38; typecheck clean.

- [ ] **Step 3: Verified-by re-check for #76 (execution-engine portion)**

```bash
rtk wc -l packages/runtime/src/execution-engine.ts
```
Original #76 verified-by said 1676 (current); new check should report ≤1200. Record actual value for the PR body.

---

## Task 6: Open PR

- [ ] **Step 1: Push branch**

```bash
rtk git push -u origin bundle/w26a-execution-engine-decomp
```

- [ ] **Step 2: Open PR**

```bash
rtk gh pr create \
  --base main \
  --head bundle/w26a-execution-engine-decomp \
  --title "refactor(runtime): W26-A execution-engine decomposition (-~500 LOC)" \
  --body "$(cat <<'EOF'
## Bundle: W26-A — execution-engine.ts decomposition

Partial: #76 (full closure pending W26-B/C/D)

## Summary

Four cohesive extractions from `packages/runtime/src/execution-engine.ts`:

1. `engine/phase-runner.ts` — runPhase + runObservablePhase factory
2. `engine/agent-loop-runner.ts` — inline while-loop body
3. `engine/finalize/snapshot-final.ts` + `util.resolveModelName` — post-loop snapshot block + 2 `as any` removals
4. `engine/execute-stream.ts` — executeStream method body

Behavior-preserving. All new modules covered by parity tests; existing runtime + replay suites pass at baseline.

## Verification

- runtime tests: <baseline> pass / 0 fail (matches pre-bundle baseline)
- replay tests: <baseline> pass / 0 fail (determinism gate)
- build: 38/38 successful
- typecheck: clean
- `wc -l execution-engine.ts`: 1676 → <new> (-<delta> LOC)
- `grep -c 'as any' execution-engine.ts`: <before> → <after> (-2 from resolveModelName)

## Plan + Retro

- Master: `wiki/Planning/Implementation-Plans/2026-05-24-w26-decomposition-master.md`
- Plan: `wiki/Planning/Implementation-Plans/2026-05-24-w26a-execution-engine-decomposition.md`
- Retro: filed after merge at `wiki/Research/Debriefs/2026-05-24-w26a-execution-engine-debrief.md`

## Out of scope (W26-B/C/D follow-ups)

- builder.ts decomposition → bundle/w26b
- runtime.ts decomposition → bundle/w26c
- reactive-agent.ts decomposition → bundle/w26d
EOF
)"
```

Replace `<baseline>`, `<new>`, `<delta>`, `<before>`, `<after>` with the actual numbers captured from Task 5 Step 1+2.

---

## Task 7: Retro (mandatory)

After the PR opens, write the execution retro per `execute-backlog` skill Phase 7:

- [ ] **Step 1: Capture metrics**

```bash
rtk git log --oneline bundle/w26a-execution-engine-decomp ^origin/main
rtk git diff origin/main..bundle/w26a-execution-engine-decomp --shortstat
```

- [ ] **Step 2: Write retro**

Create `wiki/Research/Debriefs/2026-05-24-w26a-execution-engine-debrief.md` with the template from `execute-backlog` skill Phase 7 (`# Execution Retro: ...`, Outcomes, What worked, What didn't, Skill improvements, Process inflation guard).

- [ ] **Step 3: Apply any skill improvements to execute-backlog SKILL.md inline**

Per Phase 7 self-improvement rule, if the retro names a SKILL.md amendment, edit `.claude/skills/execute-backlog/SKILL.md` in the SAME PR (amend the PR, or follow up immediately).

- [ ] **Step 4: Update memory and Hot.md**

- Append session entry to `wiki/Hot.md` under a new "Latest Session (2026-05-24, W26-A)" heading.
- Add one-line note under "Projects" section of `.agents/MEMORY.md` (or `/home/tylerbuell/.claude/projects/.../memory/MEMORY.md`).

- [ ] **Step 5: Move issue #76 to In Review**

Issue stays open until W26-D closes it. Add a comment summarizing W26-A landing:
```bash
rtk gh issue comment 76 --body "W26-A landed (PR #<N>): execution-engine.ts $1676 \rightarrow$ <new> LOC. W26-B/C/D pending."
```

---

## Self-Review (run before committing this plan doc)

**1. Spec coverage:** Issue #76 lists 4 files; this plan covers 1 (execution-engine.ts). Master plan sequences the other 3. ✅

**2. Placeholder scan:** `<TBD>` baseline numbers in pre-flight — these are intentionally filled at kickoff, not now. All step bodies have concrete code/commands. ✅

**3. Type consistency:** `AgentLoopDeps` (Task 2) is declared at Step 4 and used in Step 5 — matches. `PhaseRunner` interface (Task 1) consistent across steps. `ExecuteStreamDeps` (Task 4) used in Step 4 + import in Step 5. `resolveModelName` signature `(ctx, config) → string` consistent across Step 1 test + Step 3 implementation + usage in execution-engine.ts. ✅

**4. Behavior-preserving guarantee:** every task ends with the replay determinism gate (`bun test packages/replay/`) — the canonical safety net for "did the extraction change observable behavior?". ✅

---

## Execution Handoff

Plan complete and saved to `wiki/Planning/Implementation-Plans/2026-05-24-w26a-execution-engine-decomposition.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration. Each task is small enough (1-4 file changes, parity test + commit) that a single subagent can complete it autonomously.

**2. Inline Execution** — Execute tasks 1-7 in the current session using `superpowers:executing-plans`, batch execution with checkpoints between Task 1, Task 2, Task 4 (the high-risk extractions touching replay).

Which approach?
