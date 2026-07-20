# True Background Subagents + Unified Logging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-07-11
**Status:** RATIFIED (RE-SCOPED) 2026-07-20 — owner sign-off, debt-burndown Wave 2 B8.

> **RE-SCOPE (2026-07-20, owner-ratified).** Only **Tasks 1–5** are in scope for B8 (the debt-repair
> core: the `RunContext` correlation spine + the detached-fiber boundary fix + live nesting). They
> close the real, shipped-today defects — subagents invisible/uncancellable/unattributable, teams
> structurally flat (dead recursion cap). Value-verified 2026-07-20: the boundary at
> `sub-agent-executor.ts:317` (`await Effect.runPromise(... createLightRuntime)`) is intact and
> `agent-tool-adapter.ts:188` still passes `depth: number = 0`.
>
> **Already done — SKIP:** Task 7 (route kernel `Effect.log*` — `execution-engine.ts:1534`
> `effectLoggerBridgeLayer`, commit `311bce38`).
> **Moved to Wave 3 — SKIP here:** Task 16 worker-pool delete (Wave 3 deletes all of
> `packages/orchestration`).
> **DEFERRED (new capability, not debt — separate bench-gated track):** Phase 3 (Tasks 11–12, true
> background subagents), Phase 4 (Tasks 13–14, typed hand-off + per-worker budgets), Phase 5
> (Task 15, the M8 bench). Rationale: mock numbers are marginal (~2.3% token save, **+41% latency**),
> the M8 bench that would justify any default has never run, and async-handle management on low-tier
> models is unproven. These need a product/bench decision, not a debt sweep.
> **Logging Tasks 6, 8, 9, 10 (unified writer, `console.*` ban, config collision, llm re-key):**
> DEFERRED to a later cleanup pass — real tidiness, medium value, not a lie misleading a user today.
**Supersedes/extends:** `wiki/Research/Audit-Reports-2026-06-17/subagent-system-audit.md` (G1–G10), `wiki/Architecture/Design-Specs/2026-06-17-agentic-orchestration-strategies.md` (substrate contracts), `wiki/Decisions/2026-06-24-high-leverage-roadmap-ranking.md` (sequencing: item **A** = observable substrate, ranked prerequisite)

**Goal:** Make sub-agents first-class, independently observable, cancellable, nestable, and genuinely background — and make every log line in the framework attributable to the run (and sub-run) that produced it.

**Architecture:** Both problems have **one root cause**: the sub-agent dispatch boundary builds a *fresh service stack on a detached root fiber* and blocks on it (`Effect.runPromise(subEffect.pipe(Effect.provide(subRuntime)))`). That boundary drops the parent's EventBus/TraceRecorder/Logger singletons, drops every FiberRef (so no correlation and no cancellation), and collapses the child into an awaited promise inside the parent's tool call. The fix is to replace that boundary with a **child fiber in the parent's fiber tree running on an overlay layer** (parent services shared; only genuinely per-child services overridden), carrying an explicit **`RunContext`** value. Once the boundary is fixed, observable workers, cancellation, nesting, background handles, and log attribution all fall out of the same spine rather than needing five separate mechanisms.

**Tech Stack:** Effect-TS (Layer, Fiber, FiberRef, Scope), Bun test, TypeScript strict (no `any`).

---

## Global Constraints

- **Bun pinned to 1.3.10.** Do not bump. 1.3.14 has a FiberRef-inheritance regression that breaks streaming (`feedback_bun_version_pin`).
- **FiberRef is a FALLBACK, never the authority** for correlation. Stream consumption can hop fibers. The explicit value threaded through the request/task is primary. This mirrors the existing precedent documented at `packages/core/src/streaming.ts:44-47`.
- **No new package.** Route through existing seams (`createSubAgentExecutor`, `ToolService`, EventBus, `packages/trace`). Ratified constraint from the orchestration spec.
- **No new builder method** for the core fix. `.withDynamicSubAgents()` / `.withAgentTool()` / `.withRemoteAgent()` stay as the public surface. New *options* on existing methods are fine.
- **Deterministic failure ownership.** Any parent-side handling of a failed child is an FSM over the structured report. Never a parent-side LLM re-verify (that recreates the killed M3 verify-retry loop).
- **Strict TypeScript. No `any` casts.** Use `unknown` + guards (`feedback_clean_types`). Note the existing `as Effect.Effect<TaskResult, any, never>` at `sub-agent-executor.ts:305` is one of the casts this plan deletes.
- **Nothing goes default-on without the lift rule:** ≥2 model tiers, ≥3pp lift, ≤15% token overhead. The real-LLM **M8 bench (GH #42) has never been run** — it gates Phase 5, not Phases 0–4 (those are correctness/observability fixes, not behavior changes).
- **Wire it AND pin it.** A mechanism is not done until cutting the wiring fails a test. Reading a trace/receipt is not proof the consumer changed behavior (`feedback_wire_and_verify_end_to_end`).
- Test command: `bun test <path> --timeout 15000`. Build: `bunx turbo run build`. Workspace packages run from `src/` under Bun — no rebuild needed for tests.

---

## Current State (code-verified 2026-07-11)

### The boundary — one wall, five symptoms

`packages/runtime/src/builder/build-effect/sub-agent-executor.ts:296-312`:

```ts
return yield* subEngine.execute(taskObj);
}) as Effect.Effect<TaskResult, any, never>;
const result: TaskResult = await Effect.runPromise(
  subEffect.pipe(Effect.provide(subRuntime as unknown as Layer.Layer<never>)),
);
```

`subRuntime` comes from `createLightRuntime` (`packages/runtime/src/runtime.ts:1124`), whose own doc comment (`runtime.ts:1112-1116`) says it **skips** MetricsCollector, LifecycleHookRegistry, and "all optional layers: Identity, Interaction, Prompts, Orchestration, Gateway, A2A, Health, ReactiveIntelligence, Telemetry, **Logging**, KillSwitch, BehavioralContracts."

That single line produces every symptom below:

| # | Symptom | Why the boundary causes it |
|---|---|---|
| G1 | Child events never reach the parent bus; sub-agents are invisible in Cortex | Child builds a **fresh EventBus**. Emitting works — it just goes to a bus nobody is listening to. |
| — | No cancellation. Interrupting the parent orphans in-flight children | `Effect.runPromise` starts a **fresh root fiber**. `RunControllerRef` (`streaming.ts:90`) does not cross. `Fiber.interrupt` on the parent cannot reach it. |
| — | Logs from children are unattributable | Logging layer is **not in the child stack** at all, and no correlation id crosses the wall. |
| G7 | Teams are flat; recursion cap is dead code | `depth` is passed as literal `0` at every call site (`agent-tool-adapter.ts:188,563` are the only `depth:` sites — both defaults). Cap never trips; nesting never happens. |
| — | Not actually background | The tool handler is `Effect.tryPromise` around an `await`. Parent's kernel blocks for the child's entire run. "Parallel" (`spawn-handlers.ts:163`) is a concurrency-capped `Effect.all` **still awaited as a unit** — no handle, nothing to poll, join, or cancel. |

Other confirmed gaps, from the 2026-06-17 audit, that this plan closes as a consequence:
- **G2** per-worker model/provider override dropped on the dynamic path.
- **G3** no per-worker budget/timeout (only the declarative tool `timeoutMs`: 120s single / 300s batch).
- **G4** string-only hand-off. `SubAgentResult` (`agent-tool-adapter.ts:136-146`) is a summary blob.
- **G8** no per-worker error policy.
- **G10** parent context is a **2000-char text prefix** (`MAX_PARENT_CONTEXT_CHARS`, `agent-tool-adapter.ts:34`), not data.

Partial credit where due: the dispatch path is otherwise well-built — MCP tools are **proxied** back to the parent's `ToolService` rather than re-spawning Docker containers (`sub-agent-executor.ts:265-294`), tool sets are auto-scoped by relevance (`:199-225`), failures are contained and do not cascade (pinned at `packages/tools/tests/m8-sub-agent-delegation.test.ts:428`), and `subagent-telemetry.ts` + `run-observer.ts:15-48` already count invocations. Keep all of it.

### Dead theater to remove

`packages/orchestration/src/multi-agent/worker-pool.ts` — `spawn()` (line 15) creates a **plain struct in a `Ref`**. No agent, no LLM, no execution. `assignTask` flips a status flag. Nothing ever runs. It has no callers outside its own package's `dist/`. The `WorkflowEngine` in the same package is likewise unwired into the builder (audit G9).

### Logging — four vocabularies, zero tests

No single logger. Four non-interoperable record types with no shared base and nothing correlating them:

| Vocabulary | Defined | Consumed by |
|---|---|---|
| `LogEntry` | `observability/src/types.ts:10-23` | `structured-logger.ts` (in-memory `Ref` buffer) |
| `LogEvent` | `observability/src/types.ts:95-240` | `observable-logger.ts` (event stream) |
| `TraceEvent` | `trace/src/events.ts` (~30 variants) | `trace/src/recorder.ts` (JSONL per run) — **the richest channel, and it has no log channel at all** |
| `AgentEvent` | `core/src/services/event-bus.ts` | `runtime.ts:854-884` EventBus→LoggerService tap |

Confirmed defects:

1. **Correlation ids are declared but never written.** `LogEntry` has `traceId`/`spanId`/`agentId`/`sessionId` (`types.ts:16-19`). `makeStructuredLogger` sets only `timestamp/level/message/metadata` (`structured-logger.ts:90-95`). So `getLogs({agentId})` filters on a field that is always undefined — **a dead filter**. `file-exporter.ts:120-121` emits `traceId`/`spanId` "if present." They never are.
2. **Kernel `Effect.log*` calls are silently DROPPED, not routed.** `packages/runtime/src/execution-engine.ts:1399` is `Effect.provide(Logger.replace(Logger.defaultLogger, Logger.none))`. Every `Effect.logDebug`/`Effect.logWarning` in the kernel (`iterate-pass.ts` ×5, `think.ts:816,839`, `error-swallowed.ts:172`, `runner.ts`…) goes to `Logger.none`. The `core/src/errors/index.ts:115-150` policy tells authors to *prefer* `Effect.logWarning` — into a black hole.
3. **`console.*` bypasses every logger.** Framework `src/` (excluding CLIs/exporters/templates, which are legitimate): `runtime/src/reactive-agent.ts` ×17, `engine/finalize/run-finalize.ts` ×6, `core/src/services/event-bus.ts` ×5, `runtime/src/debrief.ts` ×4, plus `tool-service.ts`, `mcp-client.ts`, `fallback-chain.ts`, and three kernel sites. Sub-agent progress is `process.stdout.write` ANSI banners (`sub-agent-executor.ts:159-161`) — not events.
4. **Config-shape collision on one name.** `.withLogging(cfg)` (`builder.ts:1574`) sets `_loggingConfig` in the `{level, format, output, filePath, maxFileSizeBytes, maxFiles}` shape. The runtime `AgentConfig.logging` field (`runtime/src/types.ts:664-685`) is a **different** schema — `{live, mode: "stream"|"status", minLevel}` — read at `execution-engine.ts:1343-1354`. Two schemas, one name, two wiring sites.
5. **Level filtering hand-rolled 5×** (separate `LOG_LEVEL_ORDER` maps), and `LogLevel` is redeclared in 4 places (`core/src/types/config.ts:5`, `observability/src/types.ts:5`, `observable-logger.ts:76`, plus `logger-service.ts:19`).
6. **Zero tests.** No test file references `makeStructuredLogger`, `makeObservableLogger`, `makeLoggerService`, or `StructuredLogger`. Level filtering, rotation, redaction, and the live writer are all completely unpinned.
7. **Logs reach neither receipts nor traces.** Receipts explicitly exclude them (`builder/types.ts:422`); the trace recorder has no log event.

### What we must NOT rebuild

Per the 2026-06-04 tool-call-observability spec's own scope correction and the 2026-07-10 measurement-layer teardown:
- `LLMExchangeEvent` in `trace/src/events.ts` **already carries** `toolSchemaNames` (offered) and `response.toolCalls`. Do not add duplicate events. Its problem is that `observable-llm.ts` emits with placeholder `taskId:"llm-direct"`/`iteration:0`, so exchanges land detached in a global `llm-direct.jsonl`. **The fix is to re-key it from `RunContext` — which Task 1 provides.**
- `TraceEventBase` (`runId`, `timestamp`, `iter`, `seq`) and JSONL-per-run are the established shape. Extend, don't replace.
- **"The trace is the single writer"** is the ratified principle (2026-04-18 plan). Logs join the trace; they do not get a fifth parallel channel.

---

## File Structure

**Create:**
- `packages/core/src/run-context.ts` — the `RunContext` value, its FiberRef fallback, and derive/child helpers. Lives in `core` because `trace`, `observability`, `reasoning`, and `runtime` all need it and none may depend on each other.
- `packages/runtime/src/subagent/child-layer.ts` — builds the child's **overlay** layer (parent services shared, per-child services overridden). Replaces the `createLightRuntime` call inside the delegation path.
- `packages/runtime/src/subagent/registry.ts` — `SubAgentRegistry`: live child handles, keyed by `childRunId`. Enables await/poll/cancel.
- `packages/runtime/src/subagent/upward-report.ts` — `UpwardReport` (typed superset of `SubAgentResult`) + the deterministic failure FSM.
- `packages/observability/src/logging/unified-logger.ts` — the one writer. Every other logger becomes a facade over it.
- `packages/observability/src/logging/effect-logger-bridge.ts` — the `Logger` implementation that routes `Effect.log*` into the unified writer (replacing `Logger.none`).

**Modify:**
- `packages/trace/src/events.ts` — add the `log` TraceEvent variant + `parentRunId`/`depth` on `TraceEventBase`.
- `packages/runtime/src/builder/build-effect/sub-agent-executor.ts:296-312` — the boundary.
- `packages/runtime/src/builder/build-effect/local-agent-tools.ts:141,157` — the boundary (fixed-agent path).
- `packages/runtime/src/builder/build-effect/spawn-handlers.ts:140,163` — fan-out + the new async handlers.
- `packages/tools/src/adapters/agent-tool-adapter.ts` — `depth` threading; new `spawn-agent-async` / `await-agents` tool defs.
- `packages/runtime/src/execution-engine.ts:1399` — stop silencing Effect logs.
- `packages/observability/src/logging/{logger-service,structured-logger,observable-logger}.ts` — become facades.

**Delete:**
- `packages/orchestration/src/multi-agent/worker-pool.ts` (+ its export and `WorkerPoolError`).

**Test (create):**
- `packages/core/tests/run-context.test.ts`
- `packages/runtime/tests/subagent/child-observability.test.ts` ← **the G1 pin**
- `packages/runtime/tests/subagent/cancellation.test.ts`
- `packages/runtime/tests/subagent/nesting-depth.test.ts`
- `packages/runtime/tests/subagent/background-handles.test.ts`
- `packages/observability/tests/logging/unified-logger.test.ts`
- `packages/observability/tests/logging/effect-logger-bridge.test.ts`

---

## Phase 0 — The correlation spine

### Task 1: `RunContext` — the explicit correlation value

**Files:**
- Create: `packages/core/src/run-context.ts`
- Modify: `packages/core/src/index.ts` (export it)
- Test: `packages/core/tests/run-context.test.ts`

**Interfaces:**
- Produces: `RunContext` type; `CurrentRunContextRef` (FiberRef fallback); `rootContext(runId, agentId)`; `childContext(parent, childAgentId, spawnToolCallId)`; `contextOrFallback(explicit)`.
- Consumed by: every later task in this plan.

**Design note — why an explicit value and not just a FiberRef.** `packages/core/src/streaming.ts:44-47` documents the rule: FiberRef inheritance is not trustworthy across fiber hops (the bun 1.3.14 regression), so trace correlation deliberately avoided it. We honor that. `RunContext` is threaded **explicitly** through `Task.metadata.context` and `LLMRequest.traceContext`; the FiberRef exists only so that emitters which were never given the value can degrade to *run-scoped* attribution instead of *no* attribution. Worst case on a hop is today's behavior (placeholder), never a **wrong** attribution.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/tests/run-context.test.ts
import { describe, expect, it } from "bun:test";
import { childContext, rootContext } from "../src/run-context.js";

describe("RunContext", () => {
  it("root context is its own root and has depth 0", () => {
    const root = rootContext("run-1", "agent-a");
    expect(root.runId).toBe("run-1");
    expect(root.rootRunId).toBe("run-1");
    expect(root.parentRunId).toBeUndefined();
    expect(root.depth).toBe(0);
  });

  it("child increments depth, keeps rootRunId, and links to parent", () => {
    const root = rootContext("run-1", "agent-a");
    const child = childContext(root, "researcher", "call-7");
    expect(child.depth).toBe(1);
    expect(child.rootRunId).toBe("run-1");
    expect(child.parentRunId).toBe("run-1");
    expect(child.parentAgentId).toBe("agent-a");
    expect(child.runId).not.toBe("run-1");
    expect(child.spawnToolCallId).toBe("call-7");
  });

  it("grandchild keeps the ORIGINAL rootRunId and reaches depth 2", () => {
    const root = rootContext("run-1", "agent-a");
    const child = childContext(root, "researcher", "call-7");
    const grandchild = childContext(child, "sub-researcher", "call-9");
    expect(grandchild.depth).toBe(2);
    expect(grandchild.rootRunId).toBe("run-1");
    expect(grandchild.parentRunId).toBe(child.runId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/tests/run-context.test.ts --timeout 15000`
Expected: FAIL — `Cannot find module '../src/run-context.js'`

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/run-context.ts
import { FiberRef } from "effect";

/**
 * Ambient correlation for one agent run (or sub-run).
 *
 * THE AUTHORITY IS THE EXPLICIT VALUE. This is threaded through
 * `Task.metadata.context` and `LLMRequest.traceContext`. `CurrentRunContextRef`
 * below is a FALLBACK only — stream consumption can hop fibers, and FiberRef
 * inheritance is not trustworthy across that hop (see streaming.ts:44-47). A
 * fallback read yields run-scoped attribution; a miss yields today's
 * placeholder. Neither yields a WRONG attribution.
 */
export interface RunContext {
  /** The top-most run in this delegation tree. Stable across all descendants. */
  readonly rootRunId: string;
  /** This run. Unique per agent execution, including each sub-agent. */
  readonly runId: string;
  /** The agent executing this run. */
  readonly agentId: string;
  /** The run that spawned this one. Undefined at the root. */
  readonly parentRunId?: string;
  /** The agent that spawned this one. Undefined at the root. */
  readonly parentAgentId?: string;
  /** Delegation depth. 0 at the root. Enforced against maxRecursionDepth. */
  readonly depth: number;
  /** The parent's tool-call id that caused this spawn. Undefined at the root. */
  readonly spawnToolCallId?: string;
}

export const rootContext = (runId: string, agentId: string): RunContext => ({
  rootRunId: runId,
  runId,
  agentId,
  depth: 0,
});

export const childContext = (
  parent: RunContext,
  childAgentId: string,
  spawnToolCallId?: string,
): RunContext => ({
  rootRunId: parent.rootRunId,
  runId: `${parent.runId}.${childAgentId}-${crypto.randomUUID().slice(0, 8)}`,
  agentId: childAgentId,
  parentRunId: parent.runId,
  parentAgentId: parent.agentId,
  depth: parent.depth + 1,
  spawnToolCallId,
});

/** FALLBACK ONLY. Prefer the explicitly-threaded value. See the doc above. */
export const CurrentRunContextRef = FiberRef.unsafeMake<RunContext | null>(null);

/** Resolve the explicit value if given, else the ambient fallback, else null. */
export const contextOrFallback = (
  explicit: RunContext | undefined,
  ambient: RunContext | null,
): RunContext | null => explicit ?? ambient;
```

- [ ] **Step 4: Export it**

Add to `packages/core/src/index.ts`:

```ts
export * from "./run-context.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/core/tests/run-context.test.ts --timeout 15000`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/run-context.ts packages/core/src/index.ts packages/core/tests/run-context.test.ts
git commit -m "feat(core): RunContext — the explicit correlation spine for runs and sub-runs"
```

---

### Task 2: Carry `RunContext` on every trace event

**Files:**
- Modify: `packages/trace/src/events.ts` (`TraceEventBase`)
- Modify: `packages/trace/src/recorder.ts` (stamp the fields)
- Test: `packages/trace/tests/run-context-correlation.test.ts` (create)

**Interfaces:**
- Consumes: `RunContext` from Task 1.
- Produces: `TraceEventBase` gains `rootRunId`, `parentRunId?`, `depth`. Every emitted event is now attributable to a node in the delegation tree.

**Why:** `TraceEventBase` already has `runId`. A sub-agent's events will now have a *different* `runId` than the parent's — which is correct, but useless without `rootRunId` to group the tree and `parentRunId`/`depth` to reconstruct it. This is what makes "show me this run and everything it spawned" a single JSONL filter.

- [ ] **Step 1: Write the failing test**

```ts
// packages/trace/tests/run-context-correlation.test.ts
import { describe, expect, it } from "bun:test";
import { childContext, rootContext } from "@reactive-agents/core";
import { traceBaseFrom } from "../src/events.js";

describe("trace correlation", () => {
  it("stamps the delegation tree onto the event base", () => {
    const root = rootContext("run-1", "agent-a");
    const child = childContext(root, "researcher", "call-7");

    const base = traceBaseFrom(child, 3, 12);

    expect(base.runId).toBe(child.runId);
    expect(base.rootRunId).toBe("run-1");
    expect(base.parentRunId).toBe("run-1");
    expect(base.depth).toBe(1);
    expect(base.iter).toBe(3);
    expect(base.seq).toBe(12);
  });

  it("a root run's base has depth 0 and no parent", () => {
    const base = traceBaseFrom(rootContext("run-1", "agent-a"), 0, 0);
    expect(base.depth).toBe(0);
    expect(base.parentRunId).toBeUndefined();
    expect(base.rootRunId).toBe("run-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/trace/tests/run-context-correlation.test.ts --timeout 15000`
Expected: FAIL — `traceBaseFrom` is not exported from `../src/events.js`

- [ ] **Step 3: Extend `TraceEventBase` and add the constructor**

In `packages/trace/src/events.ts`, add the three fields to `TraceEventBase` (`rootRunId: string`, `parentRunId?: string`, `depth: number`) and add:

```ts
import type { RunContext } from "@reactive-agents/core";

/** Single constructor for the correlated base of every trace event. */
export const traceBaseFrom = (
  ctx: RunContext,
  iter: number,
  seq: number,
): TraceEventBase => ({
  runId: ctx.runId,
  rootRunId: ctx.rootRunId,
  parentRunId: ctx.parentRunId,
  depth: ctx.depth,
  timestamp: new Date().toISOString(),
  iter,
  seq,
});
```

Make `depth` default to `0` when decoding older traces so existing JSONL files still load (`Schema.optionalWith(Schema.Number, { default: () => 0 })`).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/trace/tests/run-context-correlation.test.ts --timeout 15000`
Expected: PASS (2 tests)

- [ ] **Step 5: Verify existing traces still load (back-compat)**

Run: `bun test packages/trace --timeout 15000`
Expected: PASS — all existing trace tests green. If a decode test fails on a missing `depth`, the default in Step 3 is wrong; fix it there, not in the test.

- [ ] **Step 6: Commit**

```bash
git add packages/trace/src/events.ts packages/trace/src/recorder.ts packages/trace/tests/run-context-correlation.test.ts
git commit -m "feat(trace): correlate every event to its node in the delegation tree"
```

---

## Phase 1 — Break the wall (this is G1)

### Task 3: The child overlay layer — share the parent's singletons

**Files:**
- Create: `packages/runtime/src/subagent/child-layer.ts`
- Test: `packages/runtime/tests/subagent/child-observability.test.ts`

**Interfaces:**
- Consumes: `RunContext` (Task 1).
- Produces: `makeChildLayer(overrides: ChildOverrides): Layer.Layer<ChildServices, never, ParentServices>` — a layer that **requires the parent's context** and overrides only what must differ per child.

**This is the load-bearing task of the plan.** Everything downstream depends on the child sharing the parent's EventBus, TraceRecorder, and Logger *instances*.

**What must be shared (parent's instance, never rebuilt):**
`EventBus`, `TraceRecorderService`, the unified logger, `CostTracker`, `ToolService` (already proxied — keep), `MetricsCollector`.

**What must be overridden per child:**
`LLMService` config (model/provider/temperature — this is **G2**, per-worker overrides, which the dynamic path currently drops), the reasoning config (`maxIterations`, strategy, tool scope), the system prompt, and `RunContext`.

**What stays off for children:** memory, debrief, lifecycle hooks (matches today's `createLightRuntime` defaults — do not change behavior here, only plumbing).

- [ ] **Step 1: Write the failing test — the G1 pin**

This test is the whole point. It must fail if anyone reintroduces a fresh EventBus for children.

```ts
// packages/runtime/tests/subagent/child-observability.test.ts
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgentBuilder } from "../../src/builder.js";

describe("sub-agent observability (G1)", () => {
  it("child agent events arrive on the PARENT's event bus, tagged with parentAgentId", async () => {
    const events: Array<{ agentId: string; parentAgentId?: string }> = [];

    const parent = await ReactiveAgentBuilder.create({ provider: "test" })
      .withDynamicSubAgents()
      .onEvent((e) => {
        events.push({ agentId: e.agentId, parentAgentId: e.parentAgentId });
      })
      .build();

    await parent.run("Delegate a research task to a sub-agent.");

    const childEvents = events.filter((e) => e.parentAgentId !== undefined);
    expect(childEvents.length).toBeGreaterThan(0);
    expect(childEvents[0]!.parentAgentId).toBe(parent.agentId);
  });

  it("child trace events share the parent's rootRunId and have depth 1", async () => {
    const parent = await ReactiveAgentBuilder.create({ provider: "test" })
      .withDynamicSubAgents()
      .withTracing({ dir: "/tmp/ra-test-traces" })
      .build();

    const result = await parent.run("Delegate a research task to a sub-agent.");
    const events = await loadTraceEvents(result.runId); // helper: read the JSONL

    const childEvents = events.filter((e) => e.depth === 1);
    expect(childEvents.length).toBeGreaterThan(0);
    for (const e of childEvents) {
      expect(e.rootRunId).toBe(result.runId);
      expect(e.runId).not.toBe(result.runId);
    }
  });
});
```

Use the deterministic `test` provider — CI has **no API keys and no Ollama** (`feedback_ci_parity_no_keys_no_ollama`). Script the `test` provider to emit a `spawn-agent` tool call on turn 1 and a final answer on turn 2.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/tests/subagent/child-observability.test.ts --timeout 15000`
Expected: FAIL — `childEvents.length` is `0`. **This is the bug, reproduced.** The child emits to its own EventBus; the parent's subscriber never sees it.

- [ ] **Step 3: Write the child layer**

```ts
// packages/runtime/src/subagent/child-layer.ts
import { Layer } from "effect";
import type { RunContext } from "@reactive-agents/core";

export interface ChildOverrides {
  readonly ctx: RunContext;
  readonly provider?: string;
  readonly model?: string;
  readonly temperature?: number;
  readonly maxIterations: number;
  readonly systemPrompt: string;
  readonly allowedTools?: readonly string[];
  readonly maxTokens?: number;
}

/**
 * The child's service stack, expressed as an OVERLAY on the parent's.
 *
 * The parent's EventBus, TraceRecorder, logger, CostTracker, MetricsCollector
 * and ToolService are REQUIRED (not built) — so the child emits into the same
 * singletons the parent's subscribers are attached to. That is what makes a
 * sub-agent observable (audit G1) and its costs additive.
 *
 * Only genuinely per-child services are overridden: the LLM config (G2 —
 * per-worker model/provider, which the old dynamic path silently dropped) and
 * the reasoning config.
 *
 * DO NOT swap this for a fresh `createLightRuntime`. That is precisely the bug
 * this replaces, and `child-observability.test.ts` will fail if you do.
 */
export const makeChildLayer = (overrides: ChildOverrides) =>
  Layer.mergeAll(
    childLlmLayer(overrides),      // overridden
    childReasoningLayer(overrides), // overridden
    childRunContextLayer(overrides.ctx),
  );
```

Implement `childLlmLayer` / `childReasoningLayer` by lifting the corresponding config-construction blocks out of `createLightRuntime` (`runtime.ts:1124-1180`) — they already compute exactly this. **Do not delete `createLightRuntime`**; it may still have non-subagent callers. Only the delegation path stops using it.

- [ ] **Step 4: Rewire the boundary in `sub-agent-executor.ts`**

Replace lines 296-312. The child now runs as a **forked fiber in the parent's fiber tree**, on the parent's context:

```ts
// packages/runtime/src/builder/build-effect/sub-agent-executor.ts
const childEffect = Effect.gen(function* () {
  const subEngine = yield* ExecutionEngine;
  return yield* subEngine.execute(taskObj);
}).pipe(
  Effect.provide(makeChildLayer({ ctx: childCtx, ...overrides })),
  Effect.locally(CurrentRunContextRef, childCtx), // fallback only; taskObj carries the authority
);

// Forked into the PARENT's fiber tree: parent interruption reaches the child,
// and the child inherits the parent's services rather than building its own.
const fiber = yield* Effect.forkScoped(childEffect);
const result: TaskResult = yield* Fiber.join(fiber);
```

Note the deleted `as Effect.Effect<TaskResult, any, never>` cast (old line 305) — with the layer requirement expressed honestly, the type checks without it.

The enclosing tool handler changes from `Effect.tryPromise(async () => …)` to a plain `Effect.gen`. This removes the `Effect.runPromise` at `sub-agent-executor.ts:179` and `:283` too (the tool-list and proxy-execute calls) — both are now `yield*` in the same fiber.

Set `parentAgentId` on the child's task metadata for **both** paths (the fixed path already does it at `local-agent-tools.ts:153`; the dynamic path does not):

```ts
metadata: { context: { parentAgentId: parentCtx.agentId, runContext: childCtx } },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test packages/runtime/tests/subagent/child-observability.test.ts --timeout 15000`
Expected: PASS (2 tests). Child events now land on the parent's bus with `parentAgentId` set, and child trace events share `rootRunId` with `depth: 1`.

- [ ] **Step 6: Verify the wiring is load-bearing (the anti-write-only check)**

Temporarily revert Step 4 to the old `Effect.runPromise(… Effect.provide(subRuntime))`. Re-run the test. It **must** fail. If it still passes, the test is not pinning what it claims and must be fixed before proceeding (`feedback_wire_and_verify_end_to_end`). Restore Step 4.

- [ ] **Step 7: Verify no regressions in the existing subagent suite**

Run: `bun test packages/tools/tests/sub-agent.test.ts packages/tools/tests/sub-agent-fixes.test.ts packages/tools/tests/m8-sub-agent-delegation.test.ts packages/runtime/tests/spawn-agents.test.ts packages/runtime/tests/subagent-persona.test.ts --timeout 15000`
Expected: PASS. In particular `m8-sub-agent-delegation.test.ts:428` ("sub-agent failures do not cascade") must stay green — forking must not turn a contained child failure into a parent failure. `Fiber.join` on a failed child surfaces the failure to the handler's existing try/catch → `SubAgentResult{success:false}`. If it cascades, the `catch` is in the wrong place.

- [ ] **Step 8: Commit**

```bash
git add packages/runtime/src/subagent/child-layer.ts packages/runtime/src/builder/build-effect/sub-agent-executor.ts packages/runtime/tests/subagent/child-observability.test.ts
git commit -m "fix(runtime): sub-agents run in the parent's fiber tree on a shared service stack (G1)

The delegation boundary built a fresh service stack on a detached root fiber
and blocked on it. The child therefore emitted to its own EventBus, which
nobody was subscribed to, and no FiberRef or interrupt could cross.

Children now fork into the parent's fiber tree on an overlay layer that shares
the parent's EventBus, TraceRecorder, logger and cost tracker. Sub-agent events
are observable for the first time, correlated by RunContext."
```

---

### Task 4: Cancellation propagates to children

**Files:**
- Test: `packages/runtime/tests/subagent/cancellation.test.ts` (create)
- Modify: `packages/runtime/src/builder/build-effect/local-agent-tools.ts:141,157` (same boundary fix as Task 3, fixed-agent path)

**Interfaces:**
- Consumes: `makeChildLayer` (Task 3).

**Why it now works:** `Effect.forkScoped` puts the child in the parent's fiber tree, so `Fiber.interrupt(parentFiber)` — already used at `reactive-agent.ts:1991,2057` — reaches it structurally. No new mechanism. This task **pins** that, and applies the same boundary fix to the `.withAgentTool` path, which Task 3 did not touch.

- [ ] **Step 1: Write the failing test**

```ts
// packages/runtime/tests/subagent/cancellation.test.ts
it("stopping the parent interrupts in-flight sub-agents (no orphans)", async () => {
  let childStarted = false;
  let childCompleted = false;

  const agent = await ReactiveAgentBuilder.create({ provider: "test" })
    .withDynamicSubAgents()
    .onEvent((e) => {
      if (e.parentAgentId && e.type === "AgentStarted") childStarted = true;
      if (e.parentAgentId && e.type === "AgentCompleted") childCompleted = true;
    })
    .build();

  const handle = agent.runStream("Delegate a long task to a sub-agent.");
  await waitFor(() => childStarted);
  await handle.stop();
  await sleep(500);

  expect(childStarted).toBe(true);
  expect(childCompleted).toBe(false); // interrupted, never completed
});
```

Script the `test` provider's sub-agent turn to be slow (a delay long enough to still be in flight at `stop()`).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/tests/subagent/cancellation.test.ts --timeout 15000`
Expected: On the **pre-Task-3** code: FAIL — `childCompleted` is `true`; the orphaned child ran to completion on its detached fiber after the parent stopped. On post-Task-3 code this may already pass, which is the point — Task 3 fixed it structurally. Still land the test: it is what stops a regression.

- [ ] **Step 3: Apply the same boundary fix to `local-agent-tools.ts`**

Replace the two `Effect.runPromise` calls (lines 141, 157) with `Effect.forkScoped` + `Fiber.join` on `makeChildLayer`, exactly as in Task 3 Step 4. This path already sets `parentAgentId` (line 153) — keep it, and add `runContext`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/runtime/tests/subagent/cancellation.test.ts --timeout 15000`
Expected: PASS

- [ ] **Step 5: Replace the ANSI-banner progress writes with events**

Delete the `process.stdout.write` banners at `sub-agent-executor.ts:159-161,366-368` and `local-agent-tools.ts:108-110,166-168`. They were the only sub-agent progress signal, and they wrote to stdout because there was no bus to write to. There is one now — emit a structured event instead. The terminal renderer subscribes and prints the same banner, so the human-visible output is unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/builder/build-effect/local-agent-tools.ts packages/runtime/tests/subagent/cancellation.test.ts
git commit -m "fix(runtime): parent interruption reaches in-flight sub-agents; drop stdout banners for events"
```

---

### Task 5: Nesting — make the recursion cap live

**Files:**
- Modify: `packages/tools/src/adapters/agent-tool-adapter.ts` (thread `depth` from `RunContext`; the `depth: number = 0` defaults at lines 188 and 563 are the bug)
- Test: `packages/runtime/tests/subagent/nesting-depth.test.ts` (create)

**Interfaces:**
- Consumes: `RunContext.depth` (Task 1), `makeChildLayer` (Task 3).

**Why:** the audit's **G7** — teams are flat. `resolveMaxRecursionDepth()` defaults to 3 and is checked at `agent-tool-adapter.ts:204`, but `depth` is literal `0` at every call site, so the check is `0 >= 3` — always false. **Dead code guarding a capability that was never enabled.** With `RunContext.depth` threaded, the guard becomes real *and* sub-delegation becomes possible for the first time.

- [ ] **Step 1: Write the failing test**

```ts
// packages/runtime/tests/subagent/nesting-depth.test.ts
it("a sub-agent can itself delegate (depth 2)", async () => {
  const depths: number[] = [];
  const agent = await ReactiveAgentBuilder.create({ provider: "test" })
    .withDynamicSubAgents()
    .withTracing({ dir: "/tmp/ra-test-traces" })
    .build();

  const result = await agent.run("Delegate; the sub-agent must delegate again.");
  const events = await loadTraceEvents(result.runId);
  for (const e of events) depths.push(e.depth);

  expect(Math.max(...depths)).toBe(2);
});

it("delegation is refused past maxRecursionDepth", async () => {
  const agent = await ReactiveAgentBuilder.create({ provider: "test" })
    .withDynamicSubAgents({ maxRecursionDepth: 1 })
    .build();

  const result = await agent.run("Delegate; each sub-agent delegates again forever.");
  const events = await loadTraceEvents(result.runId);

  expect(Math.max(...events.map((e) => e.depth))).toBe(1);
  // The refusal is an observation the model can see and route around, not a crash.
  expect(result.output).not.toContain("RangeError");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/tests/subagent/nesting-depth.test.ts --timeout 15000`
Expected: FAIL — max depth is `1`, not `2`. Children have no spawn tools and no depth.

- [ ] **Step 3: Thread depth and register spawn tools on children**

Two changes. First, `createSubAgentExecutor` takes the child's `RunContext` and reads `ctx.depth` instead of the `depth: number = 0` parameter. The guard at line 204 becomes `if (ctx.depth >= maxRecursionDepth) return refusal(...)`.

Second — and this is why nesting never worked — `makeChildLayer` must register the spawn tools on the child's `ToolService` when `ctx.depth < maxRecursionDepth`. Today the child gets a tool set with no `spawn-agent` in it at all, so even a live guard would be unreachable.

The refusal is a **tool-result observation** (`"Delegation refused: maximum depth N reached. Complete this task directly."`), never a thrown error. The model sees it and adapts — consistent with how the framework surfaces every other gate.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/runtime/tests/subagent/nesting-depth.test.ts --timeout 15000`
Expected: PASS (2 tests)

- [ ] **Step 5: Verify the existing depth-cap test still pins the cap**

Run: `bun test packages/tools/tests/sub-agent.test.ts --timeout 15000`
Expected: PASS. `sub-agent.test.ts` has a `MAX_RECURSION_DEPTH` enforcement test that passed *vacuously* before (it asserted a guard that could never fire on a real call path). It must now pass for the right reason. Read it — if it asserts against the old `depth` parameter, port it to `RunContext`.

- [ ] **Step 6: Commit**

```bash
git add packages/tools/src/adapters/agent-tool-adapter.ts packages/runtime/tests/subagent/nesting-depth.test.ts
git commit -m "feat(tools): sub-agents can sub-delegate; the recursion cap is live for the first time (G7)

depth was passed as literal 0 at every call site, so the depth>=max guard never
fired — and children were never given spawn tools, so it was unreachable anyway.
Depth now comes from RunContext and children get spawn tools below the cap."
```

---

## Phase 2 — One log, one writer

### Task 6: The unified logger

**Files:**
- Create: `packages/observability/src/logging/unified-logger.ts`
- Modify: `packages/trace/src/events.ts` (add the `log` variant)
- Test: `packages/observability/tests/logging/unified-logger.test.ts` (create — **the package currently has zero logging tests**)

**Interfaces:**
- Consumes: `RunContext` (Task 1), `traceBaseFrom` (Task 2).
- Produces: `emitLog(level, message, fields?): Effect<void>` — the single write path. `LogRecord` = `TraceEventBase & {kind: "log", level, message, fields}`.

**Design:** the trace is the single writer (ratified 2026-04-18). A log line is a **trace event**, not a fifth parallel channel. `LoggerService`, `StructuredLogger`, and `ObservableLogger` keep their public shapes but become **facades** over `emitLog` — so the four vocabularies collapse to one record without breaking any caller. Sinks (console / file / JSONL / OTLP) attach to the trace stream, where they already live.

This also fixes the dead correlation filter: `getLogs({agentId})` works now, because `emitLog` stamps `agentId` from `RunContext` — the field the schema has declared since day one and nobody ever wrote.

- [ ] **Step 1: Write the failing test**

```ts
// packages/observability/tests/logging/unified-logger.test.ts
describe("unified logger", () => {
  it("stamps every log with the run correlation", async () => {
    const ctx = rootContext("run-1", "agent-a");
    const sink = collectingSink();
    await runWithLogger(sink, ctx, emitLog("info", "hello", { k: 1 }));

    expect(sink.records[0]).toMatchObject({
      kind: "log", level: "info", message: "hello",
      runId: "run-1", rootRunId: "run-1", agentId: "agent-a", depth: 0,
      fields: { k: 1 },
    });
  });

  it("a child's log carries parentAgentId and depth 1", async () => {
    const child = childContext(rootContext("run-1", "agent-a"), "researcher", "call-7");
    const sink = collectingSink();
    await runWithLogger(sink, child, emitLog("warn", "child says"));

    expect(sink.records[0]).toMatchObject({
      rootRunId: "run-1", parentAgentId: "agent-a", agentId: "researcher", depth: 1,
    });
  });

  it("filters below minLevel", async () => {
    const sink = collectingSink();
    await runWithLogger(sink, rootContext("r", "a"), emitLog("debug", "noise"), { minLevel: "info" });
    expect(sink.records).toHaveLength(0);
  });

  it("redacts secret-shaped field values", async () => {
    const sink = collectingSink();
    await runWithLogger(sink, rootContext("r", "a"),
      emitLog("info", "cfg", { apiKey: "sk-ant-abc123" }));
    expect(JSON.stringify(sink.records[0])).not.toContain("sk-ant-abc123");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/observability/tests/logging/unified-logger.test.ts --timeout 15000`
Expected: FAIL — `Cannot find module '../../src/logging/unified-logger.js'`

- [ ] **Step 3: Implement `emitLog` + the `log` trace variant**

Add one `LogLevel` (`"debug"|"info"|"warn"|"error"`) and **one** `LOG_LEVEL_ORDER` in `packages/core/src/types/config.ts`; delete the four redundant declarations (`observability/src/types.ts:5`, `observable-logger.ts:76`, `logger-service.ts:19`, `structured-logger.ts:16`) and re-export from core. Reuse the existing redaction helper from `structured-logger.ts` — do not write a second one.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/observability/tests/logging/unified-logger.test.ts --timeout 15000`
Expected: PASS (4 tests)

- [ ] **Step 5: Make the three loggers facades**

Rewrite `logger-service.ts`, `structured-logger.ts`, `observable-logger.ts` to delegate to `emitLog`, keeping their exported signatures byte-identical. The full observability suite (23 files) must stay green.

Run: `bun test packages/observability --timeout 15000`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/observability/src/logging/unified-logger.ts packages/observability/tests/logging/unified-logger.test.ts packages/trace/src/events.ts packages/core/src/types/config.ts
git commit -m "feat(observability): one log writer, correlated to the run — logs become trace events

Four parallel vocabularies (LogEntry, LogEvent, TraceEvent, AgentEvent) collapse
to one correlated record. LogEntry has declared traceId/spanId/agentId since day
one and nothing ever wrote them, so getLogs({agentId}) was a dead filter. It
works now."
```

---

### Task 7: Stop dropping kernel logs on the floor

**Files:**
- Create: `packages/observability/src/logging/effect-logger-bridge.ts`
- Modify: `packages/runtime/src/execution-engine.ts:1399`
- Test: `packages/observability/tests/logging/effect-logger-bridge.test.ts` (create)

**Interfaces:**
- Consumes: `emitLog` (Task 6).
- Produces: `traceLogger: Logger.Logger<unknown, void>` — routes `Effect.log*` into `emitLog`.

**The bug:** `execution-engine.ts:1399` is `Effect.provide(Logger.replace(Logger.defaultLogger, Logger.none))`. Every `Effect.logDebug`/`Effect.logWarning` in the kernel — `iterate-pass.ts` ×5, `think.ts:816,839`, `error-swallowed.ts:172`, `runner.ts` — is **discarded**. Meanwhile `core/src/errors/index.ts:115-150` instructs authors to *prefer* `Effect.logWarning` over `console.*`. The codebase's own logging policy points into a black hole. `Logger.none` was presumably chosen to stop Effect's default logger spamming stdout in status mode — the right fix is to *redirect*, not silence.

- [ ] **Step 1: Write the failing test**

```ts
// packages/observability/tests/logging/effect-logger-bridge.test.ts
it("Effect.logWarning inside a run reaches the unified sink, not /dev/null", async () => {
  const sink = collectingSink();
  await runWithLogger(sink, rootContext("run-1", "agent-a"),
    Effect.logWarning("kernel says something is off"));

  expect(sink.records).toHaveLength(1);
  expect(sink.records[0]).toMatchObject({
    kind: "log", level: "warn",
    message: "kernel says something is off",
    runId: "run-1", agentId: "agent-a",
  });
});

it("status mode still keeps Effect logs off stdout", async () => {
  const stdout = captureStdout();
  const sink = collectingSink();
  await runWithLogger(sink, rootContext("r", "a"), Effect.logInfo("x"), { mode: "status" });

  expect(stdout.text()).toBe("");        // stdout stays clean...
  expect(sink.records).toHaveLength(1);  // ...but the record is NOT lost
});
```

The second test is the one that matters — it pins the actual requirement (`Logger.none` was there for a reason) while proving the record survives.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/observability/tests/logging/effect-logger-bridge.test.ts --timeout 15000`
Expected: FAIL — `sink.records` is empty. Reproduces the drop.

- [ ] **Step 3: Implement the bridge and swap the silencer**

```ts
// packages/observability/src/logging/effect-logger-bridge.ts
import { Logger, LogLevel } from "effect";

/**
 * Routes Effect's own logging (Effect.log / logDebug / logWarning / logError)
 * into the unified writer.
 *
 * Replaces `Logger.replace(Logger.defaultLogger, Logger.none)`, which DISCARDED
 * every kernel log line. Silencing stdout was the goal; discarding the record
 * was collateral damage. This keeps stdout clean and keeps the record.
 */
export const traceLogger = Logger.make(({ logLevel, message, annotations }) =>
  emitLogSync(toLogLevel(logLevel), String(message), annotationsToFields(annotations)),
);
```

Then at `execution-engine.ts:1399`: `Effect.provide(Logger.replace(Logger.defaultLogger, traceLogger))`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/observability/tests/logging/effect-logger-bridge.test.ts --timeout 15000`
Expected: PASS (2 tests)

- [ ] **Step 5: Confirm stdout did not regress**

Run: `bun test packages/runtime --timeout 15000`
Expected: PASS. Watch specifically for the TTY/status-mode tests — memory flags a known flake there (`project_tty_status_mode_test_flake`). If status mode starts printing Effect logs, `traceLogger` is writing to console instead of the sink.

- [ ] **Step 6: Commit**

```bash
git add packages/observability/src/logging/effect-logger-bridge.ts packages/runtime/src/execution-engine.ts packages/observability/tests/logging/effect-logger-bridge.test.ts
git commit -m "fix(runtime): route Effect logs into the trace instead of Logger.none

Logger.none discarded every Effect.logDebug/logWarning in the kernel, while
core/errors told authors to prefer exactly those calls. stdout stays clean;
the records now survive."
```

---

### Task 8: Ban `console.*` in framework source

**Files:**
- Modify: `eslint.config.js` (or the repo's lint config) — `no-console` as an **error** for `packages/*/src/**`, with an allowlist for `packages/observability/src/exporters/console-exporter.ts`, CLIs, templates, and benchmarks.
- Modify: the ~40 offending call sites.

**Order matters:** land this **after** Tasks 6–7. Banning `console.*` before there is a working logger to migrate to would just force people to delete useful output.

- [ ] **Step 1: Add the lint rule and watch it fail**

Run: `bunx eslint packages/*/src --rule 'no-console: error'`
Expected: FAIL — roughly 40 errors, concentrated in `runtime/src/reactive-agent.ts` (17), `engine/finalize/run-finalize.ts` (6), `core/src/services/event-bus.ts` (5), `runtime/src/debrief.ts` (4).

- [ ] **Step 2: Migrate each site to `emitLog`**

Mechanical. `console.error(msg)` → `yield* emitLog("error", msg, {...fields})`. Where the site is not in an Effect context, use the sync facade. **Do not** migrate `console-exporter.ts` (its entire job is writing to the console) or anything under `apps/`, `**/cli/**`, `**/templates/**`, `**/benchmarks/**`.

- [ ] **Step 3: Verify clean**

Run: `bunx eslint packages/*/src`
Expected: 0 errors.

- [ ] **Step 4: Full suite**

Run: `bun test --timeout 15000`
Expected: PASS (~7190 tests, per the last release).

- [ ] **Step 5: Commit**

```bash
git add eslint.config.js packages
git commit -m "refactor: framework source logs through the logger, not console.*"
```

---

### Task 9: Resolve the `.withLogging` config collision

**Files:**
- Modify: `packages/runtime/src/builder.ts:1574-1584`, `packages/runtime/src/types.ts:664-685`, `packages/runtime/src/execution-engine.ts:1343-1354`, `packages/runtime/src/runtime.ts:854-884`
- Test: `packages/runtime/tests/config-serialization-drift.test.ts` (extend — it exists and is already modified on this branch)

**The collision:** `.withLogging({level, format, output, filePath, ...})` (the `LoggerService` shape) and the runtime `AgentConfig.logging` field `{live, mode, minLevel}` (the `ObservableLogger` shape) are **different schemas under one name**, wired at two different sites. `.withObservability({logging})` sets the first; `execution-engine.ts:1343` reads the second.

**Resolution:** one `LoggingConfig` = `{minLevel, mode: "stream"|"status"|"silent", live, format: "text"|"json", sinks: Array<ConsoleSink|FileSink|JsonlSink>}`. `.withLogging(cfg)` is the single setter; `.withObservability({logging})` delegates to it. Follow the developer-first API rule (`feedback_developer_first_api_design`): keep both spellings working, one implementation. This is **additive** — do not `@deprecate` a working documented method (`feedback_no_metric_gaming_refactor`).

- [ ] **Step 1: Write the failing round-trip test**

```ts
it("logging config round-trips through serialize/deserialize without drift", () => {
  const cfg = { minLevel: "warn", mode: "status", live: false, format: "json",
                sinks: [{ kind: "file", path: "/tmp/x.jsonl" }] } as const;
  const agent = ReactiveAgentBuilder.create({ provider: "test" }).withLogging(cfg);
  expect(deserialize(serialize(agent.toConfig())).logging).toEqual(cfg);
});

it("withObservability({logging}) and withLogging() reach the same field", () => {
  const a = ReactiveAgentBuilder.create({ provider: "test" }).withLogging({ minLevel: "warn" });
  const b = ReactiveAgentBuilder.create({ provider: "test" }).withObservability({ logging: { minLevel: "warn" } });
  expect(a.toConfig().logging).toEqual(b.toConfig().logging);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/runtime/tests/config-serialization-drift.test.ts --timeout 15000`
Expected: FAIL — the two setters produce different shapes.

- [ ] **Step 3: Unify the schema and both wiring sites**

- [ ] **Step 4: Run to verify it passes**

Run: `bun test packages/runtime/tests/config-serialization-drift.test.ts --timeout 15000`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/builder.ts packages/runtime/src/types.ts packages/runtime/src/execution-engine.ts packages/runtime/src/runtime.ts packages/runtime/tests/config-serialization-drift.test.ts
git commit -m "fix(runtime): one LoggingConfig — .withLogging and .withObservability({logging}) agree"
```

---

### Task 10: Re-key the detached LLM exchange stream

**Files:**
- Modify: `packages/llm-provider/src/observable-llm.ts`

**The bug** (from the 2026-06-04 spec's own scope correction, still open per the 2026-07-10 teardown): `LLMExchangeEvent` **already carries** `toolSchemaNames` and `response.toolCalls` — everything needed to answer "why was the right tool never called." But `observable-llm.ts` emits with placeholder `taskId: "llm-direct"` and `iteration: 0`, so every exchange in the process lands in one global `llm-direct.jsonl`, detached from any run. **Do not add new events.** Re-key from `RunContext`.

Related, from the teardown: `run-completed.output` is left `undefined` by the recorder (so `diffTraces` is output-blind), and `emitCuratorDecision`/`emitAlternativesConsidered` have **zero emitters**. Fix the first; delete the second pair or wire them — do not leave dead emitters.

- [ ] **Step 1: Write the failing test**

```ts
it("llm exchanges are keyed to the run that made them, not 'llm-direct'", async () => {
  const agent = await ReactiveAgentBuilder.create({ provider: "test" })
    .withTracing({ dir: "/tmp/ra-test-traces" }).build();
  const result = await agent.run("hello");
  const events = await loadTraceEvents(result.runId);

  const exchanges = events.filter((e) => e.kind === "llm-exchange");
  expect(exchanges.length).toBeGreaterThan(0);
  for (const e of exchanges) {
    expect(e.runId).toBe(result.runId);
    expect(e.runId).not.toBe("llm-direct");
  }
});

it("a sub-agent's exchanges are keyed to the CHILD run", async () => {
  // ...spawn a sub-agent; assert its exchanges carry the child runId and depth 1
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/llm-provider/tests/observable-llm.test.ts --timeout 15000`
Expected: FAIL — exchanges carry `llm-direct`.

- [ ] **Step 3: Read `RunContext` (explicit first, FiberRef fallback) when emitting**

- [ ] **Step 4: Also populate `run-completed.output`**

- [ ] **Step 5: Run to verify it passes**

Run: `bun test packages/llm-provider --timeout 15000`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/llm-provider/src/observable-llm.ts packages/trace/src/recorder.ts
git commit -m "fix(llm-provider): key llm-exchange events to their run; populate run-completed.output"
```

---

## Phase 3 — True background subagents

**This phase is what the request actually asks for.** Phases 0–2 make it *possible*: a child that shares the parent's bus, lives in the parent's fiber tree, and is individually addressable by `RunContext.runId` can be detached and rejoined. Before Phase 1, "background" was unimplementable — there was no handle to hold.

### Task 11: `SubAgentRegistry` — handles for live children

**Files:**
- Create: `packages/runtime/src/subagent/registry.ts`
- Test: `packages/runtime/tests/subagent/background-handles.test.ts` (create)

**Interfaces:**
- Produces: `SubAgentRegistry` service — `register(ctx, fiber)`, `get(childRunId): SubAgentHandle | undefined`, `list(rootRunId): SubAgentHandle[]`, `cancel(childRunId)`. `SubAgentHandle = {ctx, status: "running"|"done"|"failed"|"cancelled", join(): Effect<UpwardReport>, inspect(): Effect<Snapshot>}`.
- Consumes: `RunContext` (Task 1).

Mirror `RunHandle` (Arc 1) rather than inventing a second shape — a sub-run is a run.

- [ ] Steps: TDD per the pattern above — register a forked child, assert `list(rootRunId)` returns it as `running`; assert `join()` yields its `UpwardReport`; assert `cancel()` interrupts it and the status becomes `cancelled`; commit.

### Task 12: `spawn-agent-async` + `await-agents` — the background surface

**Files:**
- Modify: `packages/tools/src/adapters/agent-tool-adapter.ts` (two new tool defs)
- Modify: `packages/runtime/src/builder/build-effect/spawn-handlers.ts` (their handlers)

**The surface:**
- `spawn-agent-async(task, …)` → returns `{childRunId}` **immediately**. The parent keeps reasoning while the child runs. This is the true-background primitive.
- `await-agents(childRunIds[], timeoutMs?)` → blocks until they finish (or the timeout), returns `UpwardReport[]`.
- `check-agents(childRunIds[])` → non-blocking status poll, so the parent can interleave.

Existing `spawn-agent` / `spawn-agents` keep **exactly** their current blocking semantics — they are documented, tested, and shipped. Async is **additive** and **opt-in** via `.withDynamicSubAgents({ background: true })`. Do not flip the default; the M8 bench (Task 15) decides that.

- [ ] **Step 1: Write the failing test**

```ts
it("spawn-agent-async returns before the child finishes; the parent keeps working", async () => {
  const order: string[] = [];
  // test provider: turn 1 calls spawn-agent-async, turn 2 does local work,
  // turn 3 calls await-agents.
  const agent = await ReactiveAgentBuilder.create({ provider: "test" })
    .withDynamicSubAgents({ background: true })
    .onEvent((e) => { if (e.parentAgentId) order.push(`child:${e.type}`); else order.push(`parent:${e.type}`); })
    .build();

  await agent.run("Spawn a slow research agent, do other work, then collect it.");

  const spawnIdx = order.indexOf("child:AgentStarted");
  const childDone = order.indexOf("child:AgentCompleted");
  const parentWork = order.lastIndexOf("parent:ToolCallCompleted");
  expect(spawnIdx).toBeLessThan(parentWork);
  expect(parentWork).toBeLessThan(childDone); // parent worked WHILE the child ran
});
```

That last assertion is the whole feature: parent progress strictly between child start and child completion. It cannot pass on a blocking spawn.

- [ ] **Step 2:** Run it; expect FAIL (parent work happens strictly after child completion).
- [ ] **Step 3:** Implement the three tools over `SubAgentRegistry`.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Add an orphan guard — at run finalization, any still-`running` child is either awaited (if `background.onFinish: "await"`, the default) or cancelled (`"cancel"`). A background subagent must never outlive its root run. Pin it with a test.
- [ ] **Step 6:** Commit.

---

## Phase 4 — Typed contracts (audit G2/G3/G4/G8)

### Task 13: `UpwardReport` — the typed hand-off

**Files:**
- Create: `packages/runtime/src/subagent/upward-report.ts`

`UpwardReport` is a **superset of `SubAgentResult`** (so every existing consumer keeps working) mirroring A2A's `TaskState`, per the ratified spec: `{status: "completed"|"failed"|"refused"|"cancelled"|"denied-by-authority", summary, output?: unknown (schema-validated when the child has .withOutputSchema), tokensUsed, costUsd, stepsCompleted, toolsUsed, confidence?, abstained?, failure?: {kind, message, retryable}}`.

`ownFailure(report): "accept"|"retry"|"reassign"|"escalate"` is a **deterministic FSM over the struct**. Never an LLM re-verify — that is the killed M3 loop, and it is a hard constraint of the ratified spec.

This closes **G4** (string-only hand-off) and **G8** (no error policy), and kills **G10** (the 2000-char text prefix) by letting `output` be data.

### Task 14: Per-worker overrides and budgets (G2, G3)

`.withDynamicSubAgents({ perWorker: { model?, provider?, maxTokens?, budgetUsd?, timeoutMs? } })` and per-task overrides in the `spawn-agent` args. G2 is *already fixed structurally* by `makeChildLayer` (Task 3) — this task exposes it on the surface and pins that a child on a cheaper model actually bills to that model. Budget enforcement rides the parent's `CostTracker`, which the child now shares.

---

## Phase 5 — Prove it, then decide defaults

### Task 15: Run the M8 bench (GH #42) — the gate

**The M8 mechanism has only ever been validated on mock LLMs.** The 2026-05-04 debrief says delegation wins ~+20pp accuracy on complexity-≥3 tasks, loses on simple ones (spawn overhead), saves only ~2.3% tokens on average, and costs +41% latency. Those numbers are **from mocks** and cannot justify any default.

Every prior plan gates on this bench. It has never run. Run it.

- [ ] Real LLMs, ≥2 model tiers (a local Ollama tier and a cloud tier — note **CI has neither keys nor Ollama**, so this runs locally and its output is committed as a receipt).
- [ ] Enough runs for the claim. Per-run accuracy is Bernoulli: 5 tasks × n≤5 has ~13pp standard error, so **gaps under 26pp are noise** (`feedback_bench_bernoulli_underpowered`). Pass `--output` or nothing persists.
- [ ] Apply the project lift rule: ≥3pp lift AND ≤15% token overhead → default-on; else opt-in; else remove. `ablation-warden` holds the veto.
- [ ] Background (`spawn-agent-async`) is measured **separately** from delegation-vs-inline. They are different claims: delegation is about *accuracy*, background is about *latency*. Do not let one carry the other.

### Task 16: Delete the theater

- [ ] Delete `packages/orchestration/src/multi-agent/worker-pool.ts` + `WorkerPoolError` + the export. `spawn()` builds a struct in a `Ref` and nothing ever runs. It has no callers. It is not a foundation for anything in this plan — `SubAgentRegistry` (Task 11) is the real version.
- [ ] Decide the `WorkflowEngine` (audit G9, unwired since it was written): wire it to `SubAgentRegistry` or delete it. **Do not leave a third unwired orchestrator.** Recommendation: delete. The orchestration-strategy catalog (the ratified A2 spec) is the sanctioned path, and it builds on the substrate this plan lays down, not on `WorkflowEngine`.
- [ ] `git grep` for callers before each delete. Note the standing lesson: public exports with no internal callers are **not** automatically dead (the `apps/advocate` case). Check `apps/` and the published `dist/` surface, and if either is real, deprecate across a release instead of deleting.

---

## Self-Review

**Spec coverage.** Every audit gap maps to a task: G1→3, G2→3+14, G3→14, G4→13, G5 (aggregation) → **deferred**, belongs to the orchestration-strategy catalog, not here, G6 (durable/HITL children) → **deferred**, unblocked by Task 3 (a child on the parent's stack *can* be durable now) but not implemented, G7→5, G8→13, G9→16, G10→13. Logging defects 1–7 map to Tasks 6, 7, 8, 9, 10. Deferred items are named, not silently dropped.

**Sequencing check.** The 2026-06-24 ranking says item **A** (observable substrate) ships first and is a prerequisite for the rest. This plan honors that, with one correction the ranking could not have known: **G1 is not fixable as an emitter change.** You cannot propagate events from a child that constructed its own EventBus. The boundary fix (Task 3) *is* G1, and it is also, for free, cancellation, nesting, log attribution, and the precondition for background. That is why one plan covers both subsystems: they are one defect.

**Known risk.** Task 3 changes the concurrency shape of a shipped, tested path. The specific hazard is failure containment: `m8-sub-agent-delegation.test.ts:428` pins "sub-agent failures do not cascade," and moving a child into the parent's fiber tree is exactly how you'd *accidentally* make a child failure kill the parent. Task 3 Step 7 makes that test a required gate, and Step 6 verifies the new wiring is actually load-bearing rather than incidentally passing.

**Open question for the owner.** `spawn-agent-async` gives the model a genuinely concurrent primitive. Small local models handle blocking `spawn-agent` well; whether a 4B model can *manage* an async handle (spawn, remember the id, do other work, collect) is unproven and is a real risk of confusion. Task 15 must measure it per tier, and background should likely stay opt-in on low tiers regardless of the aggregate number.
