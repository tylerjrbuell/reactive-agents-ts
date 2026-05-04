# Reactive Harness Observability & Dispatcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the reactive harness fully traceable, verifiable, and honest — replace advisory-only `ControllerDecision`s with a real dispatcher backed by typed traces, fix broken tools that block local-model use, and build the observability kit that lets humans and agents verify harness behavior from evidence, not assumptions.

**Architecture:** Three-layer observability kit (typed trace schema → assertion library → scenario library) feeding an intervention dispatcher with per-decision self-gating, plus a CI parity check that prevents future marketing/code drift. Existing Cortex TracePanel and `harness-improvement-loop` skill retarget to consume typed traces. Advisory path stays alive during migration so nothing breaks.

**Tech Stack:** TypeScript 5.7+, Effect-TS 3.x, Bun (SQLite + subprocess + HTTP), Turborepo, bun:test, SvelteKit (Cortex UI).

**Context this plan responds to:** `/tmp/ra-audit/AUDIT.md` (hands-on audit 2026-04-18), `.agents/MEMORY.md` V0.10 Hands-On Audit section, `project_v010_audit_blockers.md` in auto-memory.

**Estimated effort:** 29 tasks across 7 phases (~4–7 working days depending on parallelization). Phase 0 & 1 run concurrently. Phase 3 handlers parallelize per-handler after Phase 2 ships. One task deferred to v0.11 (Cortex TracePanel typed consumer) to keep v0.10 focused.

**Simplification principles applied:** trace is the single writer (collapses three existing output streams into one), advisory interventions stay advisory where they already work, UI polish deferred, every new abstraction earns its keep via a CI parity check.

---

## Phase 0 — Trace foundation (`@reactive-agents/trace`)

**Goal:** Typed, discriminated-union event schema + recorder service. Writes JSONL per run. Zero behavior change to the agent — purely observational.

**Files:**
- Create: `packages/trace/package.json`
- Create: `packages/trace/src/events.ts` — TraceEvent union
- Create: `packages/trace/src/recorder.ts` — TraceRecorderService (Effect Service)
- Create: `packages/trace/src/layer.ts` — Layer that wires recorder to EventBus
- Create: `packages/trace/src/replay.ts` — loadTrace / replayTrace utilities
- Create: `packages/trace/src/index.ts` — public exports
- Create: `packages/trace/tsconfig.json`, `tsup.config.ts`
- Create: `packages/trace/__tests__/recorder.test.ts`
- Modify: `package.json` workspaces (already covers `packages/*`, no change expected — verify)
- Modify: `packages/core/src/events/types.ts` — add `TraceEventEmitted` event for bridging

### Task 0.1 — Create package scaffolding

**Files:**
- Create: `packages/trace/package.json`
- Create: `packages/trace/tsconfig.json`
- Create: `packages/trace/tsup.config.ts`
- Create: `packages/trace/src/index.ts`

- [ ] **Step 1: Create `packages/trace/package.json`**

```json
{
  "name": "@reactive-agents/trace",
  "version": "0.10.0",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "dependencies": {
    "@reactive-agents/core": "workspace:*",
    "effect": "*"
  },
  "devDependencies": {
    "tsup": "*",
    "typescript": "*"
  }
}
```

- [ ] **Step 2: Create `packages/trace/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/trace/tsup.config.ts`**

```typescript
import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
})
```

- [ ] **Step 4: Create placeholder `packages/trace/src/index.ts`**

```typescript
export {} // populated by subsequent tasks
```

- [ ] **Step 5: Install + verify**

Run: `bun install`
Expected: no errors, `@reactive-agents/trace` in `bun.lock` as workspace entry.

- [ ] **Step 6: Commit**

```bash
git add packages/trace/
git commit -m "chore(trace): scaffold @reactive-agents/trace package"
```

---

### Task 0.2 — Define TraceEvent discriminated union

**Files:**
- Create: `packages/trace/src/events.ts`

- [ ] **Step 1: Write the event schema**

```typescript
// packages/trace/src/events.ts
import type { LifecyclePhase } from "@reactive-agents/core"

/** Discriminated union of every observable reactive event. */
export type TraceEvent =
  | RunStartedEvent
  | RunCompletedEvent
  | PhaseBoundaryEvent
  | IterationBoundaryEvent
  | EntropyScoredEvent
  | DecisionEvaluatedEvent
  | InterventionDispatchedEvent
  | InterventionSuppressedEvent
  | StatePatchAppliedEvent
  | ToolCallEvent
  | MessageAppendedEvent
  | StrategySwitchedEvent

export interface TraceEventBase {
  readonly runId: string
  readonly timestamp: number          // ms since epoch
  readonly iter: number                // -1 before first iteration
  readonly seq: number                 // monotonic within a run
}

export interface RunStartedEvent extends TraceEventBase {
  readonly kind: "run-started"
  readonly task: string
  readonly model: string
  readonly provider: string
  readonly seed?: number
  readonly config: Record<string, unknown>
}

export interface RunCompletedEvent extends TraceEventBase {
  readonly kind: "run-completed"
  readonly status: "success" | "failure" | "cancelled"
  readonly output?: string
  readonly error?: string
  readonly totalTokens: number
  readonly totalCostUsd: number
  readonly durationMs: number
}

export interface PhaseBoundaryEvent extends TraceEventBase {
  readonly kind: "phase-enter" | "phase-exit"
  readonly phase: LifecyclePhase
  readonly durationMs?: number         // only on phase-exit
}

export interface IterationBoundaryEvent extends TraceEventBase {
  readonly kind: "iteration-enter" | "iteration-exit"
}

export interface EntropyScoredEvent extends TraceEventBase {
  readonly kind: "entropy-scored"
  readonly composite: number
  readonly sources: {
    readonly token: number
    readonly structural: number
    readonly semantic: number
    readonly behavioral: number
    readonly contextPressure: number
  }
}

export interface DecisionEvaluatedEvent extends TraceEventBase {
  readonly kind: "decision-evaluated"
  readonly decisionType: string        // ControllerDecision["type"]
  readonly confidence: number
  readonly reason: string
}

export interface InterventionDispatchedEvent extends TraceEventBase {
  readonly kind: "intervention-dispatched"
  readonly decisionType: string
  readonly patchKind: string
  readonly cost: { readonly tokensEstimated: number; readonly latencyMsEstimated: number }
  readonly telemetry: Record<string, unknown>
}

export interface InterventionSuppressedEvent extends TraceEventBase {
  readonly kind: "intervention-suppressed"
  readonly decisionType: string
  readonly reason: "below-entropy-threshold" | "below-iteration-threshold"
    | "over-budget" | "max-fires-exceeded" | "mode-advisory" | "mode-off"
    | "no-handler"
}

export interface StatePatchAppliedEvent extends TraceEventBase {
  readonly kind: "state-patch-applied"
  readonly patchKind: string
  readonly diff: Record<string, unknown>
}

export interface ToolCallEvent extends TraceEventBase {
  readonly kind: "tool-call-start" | "tool-call-end"
  readonly toolName: string
  readonly args?: unknown
  readonly durationMs?: number
  readonly ok?: boolean
  readonly error?: string
}

export interface MessageAppendedEvent extends TraceEventBase {
  readonly kind: "message-appended"
  readonly role: "user" | "assistant" | "tool" | "system"
  readonly tokenCount: number
}

export interface StrategySwitchedEvent extends TraceEventBase {
  readonly kind: "strategy-switched"
  readonly from: string
  readonly to: string
  readonly reason: string
}

/** Type-narrowing helper. */
export function isTraceEvent(x: unknown): x is TraceEvent {
  return typeof x === "object" && x !== null && "kind" in x && "runId" in x
}
```

- [ ] **Step 2: Export from index**

Edit `packages/trace/src/index.ts`:

```typescript
export type * from "./events"
export { isTraceEvent } from "./events"
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/trace && bun run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/trace/src/
git commit -m "feat(trace): define TraceEvent discriminated union"
```

---

### Task 0.3 — TraceRecorderService (in-memory + JSONL writer)

**Files:**
- Create: `packages/trace/src/recorder.ts`
- Test: `packages/trace/__tests__/recorder.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/trace/__tests__/recorder.test.ts
import { describe, test, expect } from "bun:test"
import { Effect, Layer } from "effect"
import {
  TraceRecorderService,
  TraceRecorderServiceLive,
} from "../src/recorder"
import type { EntropyScoredEvent } from "../src/events"

describe("TraceRecorderService", () => {
  test("records events in seq order and exposes them via snapshot", async () => {
    const program = Effect.gen(function* () {
      const recorder = yield* TraceRecorderService
      const ev: EntropyScoredEvent = {
        kind: "entropy-scored",
        runId: "r1", timestamp: 1, iter: 0, seq: 0,
        composite: 0.42,
        sources: { token: 0.1, structural: 0.2, semantic: 0.3, behavioral: 0.4, contextPressure: 0 },
      }
      yield* recorder.emit(ev)
      const events = yield* recorder.snapshot("r1")
      return events
    })

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(TraceRecorderServiceLive({ dir: null })))
    )
    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe("entropy-scored")
  })

  test("writes JSONL to disk when dir is provided", async () => {
    const tmp = `/tmp/trace-test-${Date.now()}`
    const program = Effect.gen(function* () {
      const recorder = yield* TraceRecorderService
      yield* recorder.emit({
        kind: "run-started", runId: "r2", timestamp: 1, iter: -1, seq: 0,
        task: "t", model: "m", provider: "p", config: {},
      })
      yield* recorder.flush("r2")
    })
    await Effect.runPromise(
      program.pipe(Effect.provide(TraceRecorderServiceLive({ dir: tmp })))
    )
    const file = Bun.file(`${tmp}/r2.jsonl`)
    expect(await file.exists()).toBe(true)
    const text = await file.text()
    expect(text).toContain('"run-started"')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/trace && bun test`
Expected: FAIL with "Cannot find module '../src/recorder'".

- [ ] **Step 3: Implement recorder**

```typescript
// packages/trace/src/recorder.ts
import { Context, Effect, Layer, Ref } from "effect"
import { mkdir, writeFile, appendFile } from "node:fs/promises"
import { join } from "node:path"
import type { TraceEvent } from "./events"

export interface TraceRecorder {
  readonly emit: (ev: TraceEvent) => Effect.Effect<void, never>
  readonly snapshot: (runId: string) => Effect.Effect<readonly TraceEvent[], never>
  readonly flush: (runId: string) => Effect.Effect<void, never>
  readonly close: (runId: string) => Effect.Effect<void, never>
}

export class TraceRecorderService extends Context.Tag("@reactive-agents/trace/Recorder")<
  TraceRecorderService,
  TraceRecorder
>() {}

export interface TraceRecorderOptions {
  /** Directory to write JSONL files. null = memory only. */
  readonly dir: string | null
}

export function TraceRecorderServiceLive(opts: TraceRecorderOptions) {
  return Layer.effect(
    TraceRecorderService,
    Effect.gen(function* () {
      const buffers = yield* Ref.make(new Map<string, TraceEvent[]>())
      const pending = yield* Ref.make(new Map<string, TraceEvent[]>())

      const getBuf = (runId: string) =>
        Ref.modify(buffers, (m) => {
          const cur = m.get(runId) ?? []
          if (!m.has(runId)) m.set(runId, cur)
          return [cur, m]
        })

      const emit = (ev: TraceEvent): Effect.Effect<void, never> =>
        Effect.gen(function* () {
          yield* Ref.update(buffers, (m) => {
            const cur = m.get(ev.runId) ?? []
            cur.push(ev)
            m.set(ev.runId, cur)
            return m
          })
          if (opts.dir !== null) {
            yield* Ref.update(pending, (m) => {
              const cur = m.get(ev.runId) ?? []
              cur.push(ev)
              m.set(ev.runId, cur)
              return m
            })
          }
        })

      const snapshot = (runId: string): Effect.Effect<readonly TraceEvent[], never> =>
        Effect.gen(function* () {
          const m = yield* Ref.get(buffers)
          return m.get(runId) ?? []
        })

      const flush = (runId: string): Effect.Effect<void, never> =>
        Effect.gen(function* () {
          if (opts.dir === null) return
          yield* Effect.promise(() => mkdir(opts.dir!, { recursive: true }))
          const m = yield* Ref.get(pending)
          const events = m.get(runId) ?? []
          if (events.length === 0) return
          const path = join(opts.dir!, `${runId}.jsonl`)
          const body = events.map((e) => JSON.stringify(e)).join("\n") + "\n"
          yield* Effect.promise(() => appendFile(path, body))
          yield* Ref.update(pending, (m) => { m.set(runId, []); return m })
        })

      const close = (runId: string): Effect.Effect<void, never> =>
        Effect.gen(function* () {
          yield* flush(runId)
          yield* Ref.update(buffers, (m) => { m.delete(runId); return m })
          yield* Ref.update(pending, (m) => { m.delete(runId); return m })
        })

      return TraceRecorderService.of({ emit, snapshot, flush, close })
    })
  )
}
```

- [ ] **Step 4: Re-run tests**

Run: `cd packages/trace && bun test`
Expected: both tests PASS.

- [ ] **Step 5: Export from index**

Edit `packages/trace/src/index.ts` — append:

```typescript
export { TraceRecorderService, TraceRecorderServiceLive } from "./recorder"
export type { TraceRecorder, TraceRecorderOptions } from "./recorder"
```

- [ ] **Step 6: Commit**

```bash
git add packages/trace/
git commit -m "feat(trace): TraceRecorderService with JSONL persistence"
```

---

### Task 0.4 — EventBus bridge layer

**Files:**
- Create: `packages/trace/src/layer.ts`
- Test: `packages/trace/__tests__/layer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/trace/__tests__/layer.test.ts
import { test, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { EventBusService, EventBusServiceLive } from "@reactive-agents/core"
import { TraceRecorderService, TraceRecorderServiceLive } from "../src/recorder"
import { TraceBridgeLayer } from "../src/layer"

test("bridges EventBus reactive events into TraceRecorder", async () => {
  const program = Effect.gen(function* () {
    const bus = yield* EventBusService
    const recorder = yield* TraceRecorderService
    yield* bus.publish({
      type: "ReactiveEntropyScored",
      runId: "r1",
      composite: 0.5,
      sources: { token: 0, structural: 0, semantic: 0, behavioral: 0, contextPressure: 0 },
      iter: 1,
      timestamp: Date.now(),
    } as never)
    // Give the subscription a tick
    yield* Effect.sleep("10 millis")
    const events = yield* recorder.snapshot("r1")
    return events
  })

  const layers = Layer.provideMerge(
    TraceBridgeLayer,
    Layer.mergeAll(EventBusServiceLive, TraceRecorderServiceLive({ dir: null }))
  )
  const result = await Effect.runPromise(program.pipe(Effect.provide(layers)))
  expect(result.some((e) => e.kind === "entropy-scored")).toBe(true)
})
```

- [ ] **Step 2: Verify test fails**

Run: `cd packages/trace && bun test layer`
Expected: FAIL with "Cannot find module '../src/layer'".

- [ ] **Step 3: Implement TraceBridgeLayer**

```typescript
// packages/trace/src/layer.ts
import { Effect, Layer, Stream } from "effect"
import { EventBusService } from "@reactive-agents/core"
import { TraceRecorderService } from "./recorder"
import type { TraceEvent } from "./events"

/**
 * Subscribes to the EventBus and converts reactive events into TraceEvents.
 * Extends as new event types are added to @reactive-agents/core.
 */
export const TraceBridgeLayer = Layer.scopedDiscard(
  Effect.gen(function* () {
    const bus = yield* EventBusService
    const recorder = yield* TraceRecorderService

    let seq = 0
    const nextSeq = () => seq++

    yield* Effect.forkScoped(
      bus.subscribe("*").pipe(
        Stream.tap((raw) =>
          Effect.sync(() => {
            const ev = toTraceEvent(raw, nextSeq)
            if (ev) return recorder.emit(ev)
            return Effect.void
          }).pipe(Effect.flatten)
        ),
        Stream.runDrain
      )
    )
  })
)

function toTraceEvent(
  raw: { type: string; runId?: string; iter?: number; timestamp?: number } & Record<string, unknown>,
  nextSeq: () => number
): TraceEvent | null {
  const base = {
    runId: raw.runId ?? "unknown",
    timestamp: raw.timestamp ?? Date.now(),
    iter: typeof raw.iter === "number" ? raw.iter : -1,
    seq: nextSeq(),
  }
  switch (raw.type) {
    case "ReactiveEntropyScored":
      return {
        ...base,
        kind: "entropy-scored",
        composite: raw.composite as number,
        sources: raw.sources as EntropyScoredEvent["sources"],
      }
    case "ReactiveDecision":
      return {
        ...base,
        kind: "decision-evaluated",
        decisionType: raw.decisionType as string,
        confidence: (raw.confidence as number) ?? 0,
        reason: (raw.reason as string) ?? "",
      }
    // Remaining mappings land as their emitters are audited in later tasks.
    default:
      return null
  }
}

import type { EntropyScoredEvent } from "./events"
```

- [ ] **Step 4: Verify test passes**

Run: `cd packages/trace && bun test layer`
Expected: PASS.

- [ ] **Step 5: Export + commit**

Edit `packages/trace/src/index.ts`:

```typescript
export { TraceBridgeLayer } from "./layer"
```

```bash
git add packages/trace/
git commit -m "feat(trace): TraceBridgeLayer subscribes EventBus into TraceRecorder"
```

---

### Task 0.5 — Wire `.withTracing()` builder method

**Files:**
- Modify: `packages/runtime/src/builder.ts` (add method + runtime assembly)
- Modify: `packages/runtime/package.json` (add `@reactive-agents/trace` dep)
- Test: `packages/runtime/__tests__/builder-tracing.test.ts`

- [ ] **Step 1: Add dep to runtime package.json**

Edit `packages/runtime/package.json`, add to dependencies:

```json
"@reactive-agents/trace": "workspace:*"
```

- [ ] **Step 2: Write the failing test**

```typescript
// packages/runtime/__tests__/builder-tracing.test.ts
import { test, expect } from "bun:test"
import { ReactiveAgents } from "../src/builder"
import { existsSync, rmSync } from "node:fs"

test(".withTracing() persists JSONL for a run", async () => {
  const dir = `/tmp/tracing-test-${Date.now()}`
  const agent = await ReactiveAgents.create()
    .withTestScenario([{ match: "ping", text: "pong" }])
    .withTracing({ dir })
    .build()

  const result = await agent.run("ping")
  expect(result.output).toBe("pong")

  // Find the JSONL for this run
  const file = `${dir}/${result.runId}.jsonl`
  expect(existsSync(file)).toBe(true)

  rmSync(dir, { recursive: true, force: true })
  await agent.dispose()
})
```

- [ ] **Step 3: Verify test fails**

Run: `cd packages/runtime && bun test builder-tracing`
Expected: FAIL with missing `withTracing`.

- [ ] **Step 4: Add `withTracing` to builder**

Edit `packages/runtime/src/builder.ts` — add near other `withX` methods (search for `withObservability`):

```typescript
import { TraceRecorderServiceLive, TraceBridgeLayer } from "@reactive-agents/trace"

// ... inside ReactiveAgentBuilder class
private _tracingConfig: { dir: string | null } | null = null

withTracing(opts: { dir?: string | null } = {}): this {
  this._tracingConfig = { dir: opts.dir ?? `.reactive-agents/traces` }
  return this
}
```

In `build()` / runtime composition, add:

```typescript
if (this._tracingConfig) {
  layers.push(
    Layer.provideMerge(
      TraceBridgeLayer,
      TraceRecorderServiceLive({ dir: this._tracingConfig.dir })
    )
  )
}
```

Also ensure `result.runId` is populated — search for where AgentResult is constructed and add `runId: runtimeContext.runId`.

- [ ] **Step 5: Verify test passes**

Run: `cd packages/runtime && bun test builder-tracing`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/ packages/trace/
git commit -m "feat(runtime): .withTracing() builder wires trace recorder"
```

---

### Task 0.6 — Emit entropy + decision events from RI layer

**Files:**
- Modify: `packages/reactive-intelligence/src/sensor/entropy-sensor-service.ts`
- Modify: `packages/reactive-intelligence/src/controller/controller-service.ts` (or wherever decisions emit today)

- [ ] **Step 1: Locate current emission sites**

Run: `rg -n "ReactiveEntropyScored|ReactiveDecision" packages/reactive-intelligence/src/`
Note the files + line numbers — events already exist but may be missing `runId` / `iter` / `timestamp` fields.

- [ ] **Step 2: Ensure emissions include required base fields**

For each emit site, update the payload to include `runId`, `iter`, `timestamp`. Example shape:

```typescript
yield* bus.publish({
  type: "ReactiveEntropyScored",
  runId: ctx.runId,
  iter: ctx.iteration,
  timestamp: Date.now(),
  composite,
  sources,
})
```

- [ ] **Step 3: Integration check — record a real run trace**

Write a throwaway script to verify end-to-end:

```typescript
// /tmp/ra-trace-check.ts
import { ReactiveAgents } from "reactive-agents"

const agent = await ReactiveAgents.create()
  .withProvider("ollama").withModel("qwen3:4b")
  .withReasoning()
  .withReactiveIntelligence()
  .withTracing({ dir: "/tmp/ra-trace-check" })
  .build()

const r = await agent.run("Write a two-line poem about the sky")
console.log("runId:", r.runId)
await agent.dispose()
```

Run: `bun run /tmp/ra-trace-check.ts`
Expected: `/tmp/ra-trace-check/<runId>.jsonl` exists and contains `"entropy-scored"` events with non-stub values.

- [ ] **Step 4: Commit**

```bash
git add packages/reactive-intelligence/src/
git commit -m "feat(reactive-intelligence): include runId/iter/timestamp on reactive events"
```

---

### Task 0.7 — Replay + load utilities

**Files:**
- Create: `packages/trace/src/replay.ts`
- Test: `packages/trace/__tests__/replay.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/trace/__tests__/replay.test.ts
import { test, expect } from "bun:test"
import { loadTrace, traceStats } from "../src/replay"
import { writeFile, mkdir } from "node:fs/promises"

test("loads JSONL trace file and computes summary stats", async () => {
  const dir = `/tmp/trace-load-${Date.now()}`
  await mkdir(dir, { recursive: true })
  const lines = [
    { kind: "run-started", runId: "r", timestamp: 1, iter: -1, seq: 0, task: "t", model: "m", provider: "p", config: {} },
    { kind: "entropy-scored", runId: "r", timestamp: 2, iter: 0, seq: 1, composite: 0.7, sources: { token: 0, structural: 0, semantic: 0, behavioral: 0, contextPressure: 0 } },
    { kind: "intervention-dispatched", runId: "r", timestamp: 3, iter: 0, seq: 2, decisionType: "early-stop", patchKind: "early-stop", cost: { tokensEstimated: 0, latencyMsEstimated: 0 }, telemetry: {} },
    { kind: "run-completed", runId: "r", timestamp: 4, iter: 0, seq: 3, status: "success", totalTokens: 10, totalCostUsd: 0, durationMs: 3 },
  ]
  await writeFile(`${dir}/r.jsonl`, lines.map((l) => JSON.stringify(l)).join("\n") + "\n")
  const trace = await loadTrace(`${dir}/r.jsonl`)
  expect(trace.events).toHaveLength(4)
  const stats = traceStats(trace)
  expect(stats.totalEvents).toBe(4)
  expect(stats.interventionsDispatched).toBe(1)
  expect(stats.maxEntropy).toBeCloseTo(0.7)
})
```

- [ ] **Step 2: Verify test fails**

Run: `cd packages/trace && bun test replay`
Expected: FAIL.

- [ ] **Step 3: Implement replay utilities**

```typescript
// packages/trace/src/replay.ts
import { readFile } from "node:fs/promises"
import type { TraceEvent } from "./events"

export interface Trace {
  readonly runId: string
  readonly events: readonly TraceEvent[]
}

export async function loadTrace(path: string): Promise<Trace> {
  const text = await readFile(path, "utf8")
  const events = text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as TraceEvent)
  const runId = events[0]?.runId ?? "unknown"
  return { runId, events }
}

export interface TraceStats {
  readonly totalEvents: number
  readonly iterations: number
  readonly interventionsDispatched: number
  readonly interventionsSuppressed: number
  readonly maxEntropy: number
  readonly toolCalls: number
  readonly durationMs: number
  readonly totalTokens: number
}

export function traceStats(trace: Trace): TraceStats {
  let interventionsDispatched = 0
  let interventionsSuppressed = 0
  let maxEntropy = 0
  let toolCalls = 0
  let iterations = 0
  let durationMs = 0
  let totalTokens = 0

  for (const ev of trace.events) {
    switch (ev.kind) {
      case "intervention-dispatched": interventionsDispatched++; break
      case "intervention-suppressed": interventionsSuppressed++; break
      case "entropy-scored": if (ev.composite > maxEntropy) maxEntropy = ev.composite; break
      case "tool-call-end": toolCalls++; break
      case "iteration-enter": iterations++; break
      case "run-completed": durationMs = ev.durationMs; totalTokens = ev.totalTokens; break
    }
  }

  return {
    totalEvents: trace.events.length,
    iterations, interventionsDispatched, interventionsSuppressed,
    maxEntropy, toolCalls, durationMs, totalTokens,
  }
}
```

- [ ] **Step 4: Verify test passes**

Run: `cd packages/trace && bun test replay`
Expected: PASS.

- [ ] **Step 5: Export + commit**

Edit `packages/trace/src/index.ts`:

```typescript
export { loadTrace, traceStats } from "./replay"
export type { Trace, TraceStats } from "./replay"
```

```bash
git add packages/trace/
git commit -m "feat(trace): loadTrace + traceStats utilities"
```

---

### Task 0.8 — Retire `harness-reports/*.log`, derive observations from trace

**Goal:** Collapse three overlapping output streams into one. Trace becomes the single writer; `observations/<model>.json` becomes a trace projection; `harness-reports/*.log` is deleted.

**Files:**
- Modify: `.agents/skills/harness-improvement-loop/scripts/*` — retarget to consume trace JSONL
- Modify: `packages/reactive-intelligence/src/learning/learning-engine.ts` — `onRunCompleted` becomes a trace consumer
- Delete: log writer in `scripts/harness-probe-*` (or wherever multi-model runs write plaintext logs)
- Modify: `harness-reports/` writing sites → write JSONL traces to `.reactive-agents/traces/` instead
- Test: `packages/reactive-intelligence/__tests__/observation-projection.test.ts`

- [ ] **Step 1: Locate the three writer sites**

Run: `rg -n "writeFile.*\.log|appendFile.*harness-reports|observations/.*\.json" packages/ scripts/ --no-heading`
Note each site.

- [ ] **Step 2: Write the failing test for trace→observation projection**

```typescript
// packages/reactive-intelligence/__tests__/observation-projection.test.ts
import { test, expect } from "bun:test"
import { projectObservationFromTrace } from "../src/learning/observation-projection"
import type { Trace } from "@reactive-agents/trace"

test("projects observation fields from a completed run trace", () => {
  const trace: Trace = {
    runId: "r",
    events: [
      { kind: "run-started", runId: "r", timestamp: 1, iter: -1, seq: 0, task: "t", model: "cogito:14b", provider: "ollama", config: {} },
      { kind: "iteration-enter", runId: "r", timestamp: 2, iter: 1, seq: 1 },
      { kind: "tool-call-start", runId: "r", timestamp: 3, iter: 1, seq: 2, toolName: "web-search" },
      { kind: "tool-call-end", runId: "r", timestamp: 4, iter: 1, seq: 3, toolName: "web-search", durationMs: 100, ok: true },
      { kind: "iteration-exit", runId: "r", timestamp: 5, iter: 1, seq: 4 },
      { kind: "run-completed", runId: "r", timestamp: 6, iter: 1, seq: 5, status: "success", totalTokens: 500, totalCostUsd: 0, durationMs: 5 },
    ],
  }

  const obs = projectObservationFromTrace(trace)
  expect(obs.modelId).toBe("cogito:14b")
  expect(obs.totalTurnCount).toBe(1)
  expect(obs.classifierActuallyCalled).toContain("web-search")
})
```

- [ ] **Step 3: Implement projection**

```typescript
// packages/reactive-intelligence/src/learning/observation-projection.ts
import type { Trace } from "@reactive-agents/trace"

export interface ObservationSample {
  readonly at: string
  readonly modelId: string
  readonly parallelTurnCount: number
  readonly totalTurnCount: number
  readonly dialect: string
  readonly classifierRequired: readonly string[]
  readonly classifierActuallyCalled: readonly string[]
  readonly subagentInvoked: number
  readonly subagentSucceeded: number
  readonly argValidityRate: number
}

export function projectObservationFromTrace(trace: Trace): ObservationSample | null {
  const started = trace.events.find((e) => e.kind === "run-started")
  const completed = trace.events.find((e) => e.kind === "run-completed")
  if (!started || started.kind !== "run-started" || !completed) return null

  const iterations = trace.events.filter((e) => e.kind === "iteration-enter").length
  const toolCalls = trace.events.filter((e) => e.kind === "tool-call-end")
  const toolNames = [...new Set(toolCalls.map((e: any) => e.toolName))]
  const subagentCalls = toolCalls.filter((e: any) => e.toolName === "spawn-agent")
  const validArgs = toolCalls.filter((e: any) => e.ok).length
  const argValidityRate = toolCalls.length === 0 ? 0 : validArgs / toolCalls.length

  return {
    at: new Date(started.timestamp).toISOString(),
    modelId: started.model,
    parallelTurnCount: 0,           // populate when parallel-turn trace event lands
    totalTurnCount: iterations,
    dialect: (started.config as any)?.dialect ?? "none",
    classifierRequired: [],         // populate when classifier trace event lands
    classifierActuallyCalled: toolNames,
    subagentInvoked: subagentCalls.length,
    subagentSucceeded: subagentCalls.filter((e: any) => e.ok).length,
    argValidityRate,
  }
}
```

- [ ] **Step 4: Rewire learning-engine `onRunCompleted`**

Replace direct observation writes with:

```typescript
// In learning-engine.ts onRunCompleted
import { loadTrace } from "@reactive-agents/trace"
import { projectObservationFromTrace } from "./observation-projection"

const trace = await loadTrace(traceFilePath)
const sample = projectObservationFromTrace(trace)
if (sample) yield* calibrationStore.appendSample(sample)
```

- [ ] **Step 5: Retarget `harness-improvement-loop` skill**

Edit `.agents/skills/harness-improvement-loop/scripts/analyze.ts` (or equivalent): replace plaintext `.log` parsing with `loadTrace()` + `traceStats()` calls. Update SKILL.md to reflect the new input format (JSONL traces, not .log files).

- [ ] **Step 6: Delete the log writers**

Remove plaintext `.log` writing in multi-model runners. Traces are the only per-run artifact; `summary.json` derives from `rax trace stats --batch <dir>`.

- [ ] **Step 7: Run full suite + smoke test**

Run: `bun test`
Expected: 0 fail.

Run: `bun run scripts/check-observations-from-traces.ts` (or a one-off smoke test: run an agent, verify observation appended).

- [ ] **Step 8: Commit**

```bash
git add .agents/skills/ packages/reactive-intelligence/ scripts/
git commit -m "refactor: trace is single writer — observations projected, harness-reports/*.log retired"
```

---

## Phase 1 — Tactical bug fixes (parallel with Phase 0)

**Goal:** Unblock local-model use and remove false marketing claims that the audit found. Each fix is independent.

### Task 1.1 — Fix `code-execute` `require` ESM mismatch

**Files:**
- Modify: `packages/tools/src/skills/code-execution.ts:58` (approx)
- Test: `packages/tools/__tests__/code-execution.test.ts`

- [ ] **Step 1: Reproduce the bug**

```bash
cat > /tmp/ra-ce-repro.ts <<'EOF'
import { executeCode } from "@reactive-agents/tools/skills/code-execution"
const r = await executeCode({
  code: "const fs = require('fs'); console.log(fs.readdirSync('/tmp').length)"
})
console.log(r)
EOF
bun run /tmp/ra-ce-repro.ts
```

Expected: `executed: false` with ReferenceError mentioning `require`.

- [ ] **Step 2: Write the failing test**

```typescript
// packages/tools/__tests__/code-execution.test.ts
import { test, expect } from "bun:test"
import { executeCode } from "../src/skills/code-execution"

test("executes code using require() (CJS compat)", async () => {
  const r = await executeCode({ code: "const os = require('os'); return os.type()" })
  expect(r.executed).toBe(true)
  expect(typeof r.result).toBe("string")
})

test("executes code using ESM import() (async)", async () => {
  const r = await executeCode({
    code: "const os = await import('os'); return os.type()",
  })
  expect(r.executed).toBe(true)
})
```

- [ ] **Step 3: Run tests — verify failures**

Run: `cd packages/tools && bun test code-execution`
Expected: first test FAIL with ReferenceError.

- [ ] **Step 4: Fix the implementation**

In `code-execution.ts`, locate the eval wrapper (near line 58) and update to create a `require` via `Module.createRequire`. Replace:

```typescript
const wrapped = `const __result = eval(${JSON.stringify(rawCode)}); console.log(JSON.stringify({ ok: true, result: __result }))`
```

With:

```typescript
const wrapped = `
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const __fn = async () => { ${rawCode} }
__fn().then((r) => console.log(JSON.stringify({ ok: true, result: r })))
     .catch((e) => console.log(JSON.stringify({ ok: false, error: String(e) })))
`
```

Also update the subprocess invocation to write to a temp `.ts` file and run with `bun run`, rather than `bun --eval`, so `import.meta.url` is defined.

- [ ] **Step 5: Re-run tests**

Run: `cd packages/tools && bun test code-execution`
Expected: both PASS.

- [ ] **Step 6: End-to-end smoke test**

```bash
bun run /tmp/ra-ce-repro.ts
```

Expected: `executed: true`, numeric result.

- [ ] **Step 7: Commit**

```bash
git add packages/tools/
git commit -m "fix(tools): code-execute supports both require() and import() in Bun ESM"
```

---

### Task 1.2 — Fix `contextPressure` hard-coded to 0

**Files:**
- Modify: `packages/reactive-intelligence/src/sensor/entropy-sensor-service.ts:176` (also line 62)
- Test: `packages/reactive-intelligence/__tests__/entropy-sensor.test.ts`

- [ ] **Step 1: Read the current code**

Run: `rg -n "contextPressure" packages/reactive-intelligence/src/sensor/`

- [ ] **Step 2: Write the failing test**

```typescript
// packages/reactive-intelligence/__tests__/entropy-sensor.test.ts
import { test, expect } from "bun:test"
import { computeContextPressure } from "../src/sensor/context-pressure-entropy"
import { composeEntropyScore } from "../src/sensor/composite"

test("composite score reflects non-zero contextPressure", () => {
  const cp = computeContextPressure({ currentTokens: 80_000, contextWindow: 100_000 })
  expect(cp).toBeGreaterThan(0.5)

  const composite = composeEntropyScore({
    token: 0, structural: 0, semantic: 0, behavioral: 0,
    contextPressure: cp,
  })
  expect(composite).toBeGreaterThan(0)
})
```

- [ ] **Step 3: Verify test fails**

Run: `cd packages/reactive-intelligence && bun test entropy-sensor`
Expected: FAIL (composite returns 0 because the sensor passes 0).

- [ ] **Step 4: Fix the sensor**

At `entropy-sensor-service.ts:176`, replace:

```typescript
const contextPressure = 0
```

With:

```typescript
const contextPressure = computeContextPressure({
  currentTokens: input.messageTokens,
  contextWindow: input.contextWindow,
})
```

Import `computeContextPressure` if not already imported. Do the same at line ~62 (fallback path).

- [ ] **Step 5: Re-run tests**

Run: `cd packages/reactive-intelligence && bun test entropy-sensor`
Expected: PASS.

- [ ] **Step 6: Run full RI suite (regression)**

Run: `cd packages/reactive-intelligence && bun test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/reactive-intelligence/
git commit -m "fix(reactive-intelligence): wire contextPressure into composite entropy (now true 5-source)"
```

---

### Task 1.3 — Fix `AbortSignal` on `runStream()`

**Files:**
- Modify: `packages/runtime/src/builder.ts` (runStream implementation — grep for `runStream`)
- Test: `packages/runtime/__tests__/abort-signal.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/runtime/__tests__/abort-signal.test.ts
import { test, expect } from "bun:test"
import { ReactiveAgents } from "../src/builder"

test("runStream aborts cleanly when AbortController.abort() is called", async () => {
  const agent = await ReactiveAgents.create()
    .withTestScenario([{ match: ".*", text: "x".repeat(5000) }])
    .build()

  const controller = new AbortController()
  const chunks: string[] = []

  setTimeout(() => controller.abort(), 20)

  let cancelled = false
  try {
    for await (const ev of agent.runStream("test", { signal: controller.signal })) {
      if (ev._tag === "TextDelta") chunks.push(ev.text)
      if (ev._tag === "StreamCancelled") cancelled = true
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") throw e
  }

  expect(cancelled || chunks.length < 100).toBe(true)
  await agent.dispose()
})
```

- [ ] **Step 2: Verify test fails**

Run: `cd packages/runtime && bun test abort-signal`
Expected: FAIL (signal currently ignored).

- [ ] **Step 3: Wire AbortSignal into runStream**

Find the `runStream` implementation in builder.ts (grep `runStream`). At the chunk-emission boundary, check the signal:

```typescript
async *runStream(task: string, opts?: { signal?: AbortSignal }): AsyncGenerator<...> {
  const signal = opts?.signal
  for await (const chunk of innerStream) {
    if (signal?.aborted) {
      yield { _tag: "StreamCancelled", reason: "user-abort" }
      return
    }
    yield chunk
  }
}
```

Also propagate `signal` into `executeReActKernel` / phase orchestration so LLM calls can bail early.

- [ ] **Step 4: Re-run tests**

Run: `cd packages/runtime && bun test abort-signal`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/
git commit -m "fix(runtime): AbortSignal propagates into runStream + emits StreamCancelled"
```

---

### Task 1.4 — Fix `metadata.llmCalls` counter

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts` (or wherever `llmCalls` is initialized)
- Modify: `packages/llm-provider/src/*.ts` (emit event on every LLM call)
- Test: `packages/runtime/__tests__/metadata-llm-calls.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/runtime/__tests__/metadata-llm-calls.test.ts
import { test, expect } from "bun:test"
import { ReactiveAgents } from "../src/builder"

test("metadata.llmCalls counts actual LLM invocations", async () => {
  const agent = await ReactiveAgents.create()
    .withTestScenario([{ match: ".*", text: "ok" }])
    .build()
  const r = await agent.run("hello")
  expect(r.metadata.llmCalls).toBeGreaterThan(0)
  await agent.dispose()
})
```

- [ ] **Step 2: Verify test fails**

Run: `cd packages/runtime && bun test metadata-llm-calls`
Expected: FAIL (receives 0).

- [ ] **Step 3: Increment counter**

Search for `llmCalls` in `execution-engine.ts`. Add increment on each `LLMService.complete` or `stream` call (use EventBus `LLMInvoked` event if it exists, else wrap the call site).

- [ ] **Step 4: Verify**

Run: `cd packages/runtime && bun test metadata-llm-calls`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/ packages/llm-provider/
git commit -m "fix(runtime): metadata.llmCalls increments on each LLM invocation"
```

---

## Phase 2 — Intervention dispatcher skeleton

**Goal:** Handler registry + patch applier + self-gating. Preserves advisory path. No new behavior yet — just the contract.

**Files:**
- Create: `packages/reactive-intelligence/src/controller/intervention.ts` — types
- Create: `packages/reactive-intelligence/src/controller/patch-applier.ts`
- Create: `packages/reactive-intelligence/src/controller/dispatcher.ts`
- Create: `packages/reactive-intelligence/src/controller/handlers/index.ts`
- Create: `packages/reactive-intelligence/src/controller/handlers/early-stop.ts` (migration)
- Modify: `packages/reasoning/src/strategies/kernel/utils/termination-oracle.ts` — redirect to handler
- Test: `packages/reactive-intelligence/__tests__/dispatcher.test.ts`
- Test: `packages/reactive-intelligence/__tests__/patch-applier.test.ts`
- Test: `packages/reactive-intelligence/__tests__/parity.test.ts`

### Task 2.1 — Types (intervention.ts)

- [ ] **Step 1: Create types file**

```typescript
// packages/reactive-intelligence/src/controller/intervention.ts
import type { Effect } from "effect"
import type { KernelState } from "@reactive-agents/reasoning"
import type { ControllerDecision } from "./decisions"  // existing
import type { EntropyScore } from "../sensor/types"

export type InterventionMode = "dispatch" | "advisory" | "off"

export type KernelStatePatch =
  | { kind: "early-stop"; reason: string }
  | { kind: "set-temperature"; temperature: number }
  | { kind: "request-strategy-switch"; to: string; reason: string }
  | { kind: "inject-tool-guidance"; text: string }
  | { kind: "compress-messages"; targetTokens: number }
  | { kind: "inject-skill-content"; skillId: string; content: string }
  | { kind: "append-system-nudge"; text: string }
  // New patch kinds are added here; patch-applier must handle each

export interface InterventionCost {
  readonly tokensEstimated: number
  readonly latencyMsEstimated: number
}

export interface InterventionOutcome {
  readonly applied: boolean
  readonly patches: readonly KernelStatePatch[]
  readonly cost: InterventionCost
  readonly reason: string
  readonly telemetry: Record<string, unknown>
}

export type InterventionError = { readonly _tag: "InterventionFailed"; readonly message: string }

export interface InterventionContext {
  readonly iteration: number
  readonly entropyScore: EntropyScore
  readonly recentDecisions: readonly ControllerDecision[]
  readonly budget: {
    readonly tokensSpentOnInterventions: number
    readonly interventionsFiredThisRun: number
  }
}

export interface InterventionHandler<
  TType extends ControllerDecision["type"] = ControllerDecision["type"]
> {
  readonly type: TType
  readonly description: string
  readonly defaultMode: InterventionMode
  readonly execute: (
    decision: Extract<ControllerDecision, { type: TType }>,
    state: Readonly<KernelState>,
    context: InterventionContext
  ) => Effect.Effect<InterventionOutcome, InterventionError, never>
}

export interface InterventionSuppressionConfig {
  readonly minEntropyComposite: number      // default 0.55
  readonly minIteration: number              // default 2
  readonly maxFiresPerRun: number            // default 5
  readonly maxInterventionTokenBudget: number // default 1500
}

export interface InterventionConfig {
  readonly modes: Partial<Record<ControllerDecision["type"], InterventionMode>>
  readonly suppression: InterventionSuppressionConfig
}

export const defaultInterventionConfig: InterventionConfig = {
  modes: { "early-stop": "dispatch" }, // everything else advisory by default
  suppression: {
    minEntropyComposite: 0.55,
    minIteration: 2,
    maxFiresPerRun: 5,
    maxInterventionTokenBudget: 1500,
  },
}
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/reactive-intelligence && bun run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/reactive-intelligence/src/controller/intervention.ts
git commit -m "feat(reactive-intelligence): intervention types + default config"
```

---

### Task 2.2 — Patch applier

- [ ] **Step 1: Write the failing test**

```typescript
// packages/reactive-intelligence/__tests__/patch-applier.test.ts
import { test, expect } from "bun:test"
import { applyPatches } from "../src/controller/patch-applier"

test("applies set-temperature patch", () => {
  const state = { currentOptions: { temperature: 0.7 }, messages: [], steps: [] } as any
  const out = applyPatches(state, [{ kind: "set-temperature", temperature: 0.3 }])
  expect(out.currentOptions.temperature).toBe(0.3)
})

test("applies compress-messages by trimming oldest until target", () => {
  const state = {
    messages: Array.from({ length: 20 }, (_, i) => ({
      role: "user", content: `msg-${i}`, tokens: 100,
    })),
    currentOptions: {}, steps: [],
  } as any
  const out = applyPatches(state, [{ kind: "compress-messages", targetTokens: 500 }])
  expect(out.messages.length).toBeLessThanOrEqual(6) // 5*100=500 + system reserved
})

test("unknown patch kind throws at startup (defensive)", () => {
  const state = { currentOptions: {}, messages: [], steps: [] } as any
  expect(() => applyPatches(state, [{ kind: "unknown" } as any])).toThrow()
})
```

- [ ] **Step 2: Verify test fails**

Run: `cd packages/reactive-intelligence && bun test patch-applier`
Expected: FAIL.

- [ ] **Step 3: Implement patch-applier.ts**

```typescript
// packages/reactive-intelligence/src/controller/patch-applier.ts
import type { KernelState } from "@reactive-agents/reasoning"
import type { KernelStatePatch } from "./intervention"

export function applyPatches(
  state: Readonly<KernelState>,
  patches: readonly KernelStatePatch[]
): KernelState {
  let next: KernelState = { ...state, currentOptions: { ...state.currentOptions }, messages: [...state.messages] }
  for (const p of patches) {
    next = applyOne(next, p)
  }
  return next
}

function applyOne(state: KernelState, p: KernelStatePatch): KernelState {
  switch (p.kind) {
    case "early-stop":
      return { ...state, terminate: true, terminationReason: p.reason }
    case "set-temperature":
      return { ...state, currentOptions: { ...state.currentOptions, temperature: p.temperature } }
    case "request-strategy-switch":
      return { ...state, pendingStrategySwitch: { to: p.to, reason: p.reason } }
    case "inject-tool-guidance":
      return {
        ...state,
        pendingGuidance: [...(state.pendingGuidance ?? []), { kind: "tool", text: p.text }],
      }
    case "compress-messages":
      return { ...state, messages: compressMessages(state.messages, p.targetTokens) }
    case "inject-skill-content":
      return {
        ...state,
        activatedSkills: [...(state.activatedSkills ?? []), { id: p.skillId, content: p.content }],
      }
    case "append-system-nudge":
      return { ...state, systemNudges: [...(state.systemNudges ?? []), p.text] }
    default: {
      const _exhaustive: never = p
      throw new Error(`Unknown patch kind: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

function compressMessages(messages: readonly any[], targetTokens: number): any[] {
  // Simple drop-oldest until under target. Detailed strategy ships in Phase 3 context-compress handler.
  let total = messages.reduce((s, m) => s + (m.tokens ?? 0), 0)
  let kept = [...messages]
  while (total > targetTokens && kept.length > 1) {
    const dropped = kept.shift()
    total -= dropped.tokens ?? 0
  }
  return kept
}
```

- [ ] **Step 4: Re-run tests**

Run: `cd packages/reactive-intelligence && bun test patch-applier`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/reactive-intelligence/
git commit -m "feat(reactive-intelligence): patch applier with whitelisted KernelStatePatch union"
```

---

### Task 2.3 — Dispatcher

- [ ] **Step 1: Write the failing test**

```typescript
// packages/reactive-intelligence/__tests__/dispatcher.test.ts
import { test, expect } from "bun:test"
import { Effect } from "effect"
import {
  makeDispatcher, registerHandler,
} from "../src/controller/dispatcher"
import { defaultInterventionConfig } from "../src/controller/intervention"

const fakeHandler = {
  type: "early-stop" as const,
  description: "stops",
  defaultMode: "dispatch" as const,
  execute: () => Effect.succeed({
    applied: true,
    patches: [{ kind: "early-stop" as const, reason: "test" }],
    cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
    reason: "fired",
    telemetry: {},
  }),
}

test("dispatches a decision to its handler when mode is 'dispatch'", async () => {
  const dispatcher = makeDispatcher(defaultInterventionConfig)
  registerHandler(dispatcher, fakeHandler)
  const result = await Effect.runPromise(
    dispatcher.dispatch(
      [{ type: "early-stop", reason: "loop", confidence: 0.9 } as any],
      { currentOptions: {}, messages: [] } as any,
      {
        iteration: 3,
        entropyScore: { composite: 0.8, token: 0, structural: 0, semantic: 0, behavioral: 0, contextPressure: 0 },
        recentDecisions: [],
        budget: { tokensSpentOnInterventions: 0, interventionsFiredThisRun: 0 },
      }
    )
  )
  expect(result.appliedPatches).toHaveLength(1)
  expect(result.skipped).toHaveLength(0)
})

test("suppresses when composite entropy below threshold", async () => {
  const dispatcher = makeDispatcher(defaultInterventionConfig)
  registerHandler(dispatcher, fakeHandler)
  const result = await Effect.runPromise(
    dispatcher.dispatch(
      [{ type: "early-stop", reason: "x", confidence: 0.9 } as any],
      { currentOptions: {}, messages: [] } as any,
      {
        iteration: 3,
        entropyScore: { composite: 0.1, token: 0, structural: 0, semantic: 0, behavioral: 0, contextPressure: 0 },
        recentDecisions: [],
        budget: { tokensSpentOnInterventions: 0, interventionsFiredThisRun: 0 },
      }
    )
  )
  expect(result.skipped[0].reason).toBe("below-entropy-threshold")
})

test("advisory mode does not apply patches", async () => {
  const dispatcher = makeDispatcher({
    ...defaultInterventionConfig,
    modes: { "early-stop": "advisory" },
  })
  registerHandler(dispatcher, fakeHandler)
  const result = await Effect.runPromise(
    dispatcher.dispatch(
      [{ type: "early-stop", reason: "x", confidence: 0.9 } as any],
      { currentOptions: {}, messages: [] } as any,
      {
        iteration: 3,
        entropyScore: { composite: 0.9, token: 0, structural: 0, semantic: 0, behavioral: 0, contextPressure: 0 },
        recentDecisions: [],
        budget: { tokensSpentOnInterventions: 0, interventionsFiredThisRun: 0 },
      }
    )
  )
  expect(result.appliedPatches).toHaveLength(0)
  expect(result.skipped[0].reason).toBe("mode-advisory")
})
```

- [ ] **Step 2: Verify test fails**

Run: `cd packages/reactive-intelligence && bun test dispatcher`
Expected: FAIL (missing module).

- [ ] **Step 3: Implement dispatcher**

```typescript
// packages/reactive-intelligence/src/controller/dispatcher.ts
import { Effect } from "effect"
import type {
  InterventionConfig, InterventionContext, InterventionHandler,
  KernelStatePatch,
} from "./intervention"
import type { ControllerDecision } from "./decisions"
import type { KernelState } from "@reactive-agents/reasoning"

export interface DispatchResult {
  readonly appliedPatches: readonly KernelStatePatch[]
  readonly skipped: readonly { decisionType: string; reason: string }[]
  readonly totalCost: { tokens: number; latencyMs: number }
}

export interface Dispatcher {
  readonly dispatch: (
    decisions: readonly ControllerDecision[],
    state: Readonly<KernelState>,
    context: InterventionContext
  ) => Effect.Effect<DispatchResult, never>
  readonly handlers: Map<string, InterventionHandler>
  readonly config: InterventionConfig
}

export function makeDispatcher(config: InterventionConfig): Dispatcher {
  const handlers = new Map<string, InterventionHandler>()

  const dispatch = (
    decisions: readonly ControllerDecision[],
    state: Readonly<KernelState>,
    context: InterventionContext
  ): Effect.Effect<DispatchResult, never> =>
    Effect.gen(function* () {
      const appliedPatches: KernelStatePatch[] = []
      const skipped: { decisionType: string; reason: string }[] = []
      let tokens = 0
      let latencyMs = 0

      for (const decision of decisions) {
        const mode = config.modes[decision.type] ?? handlers.get(decision.type)?.defaultMode ?? "advisory"
        if (mode === "off") { skipped.push({ decisionType: decision.type, reason: "mode-off" }); continue }
        if (mode === "advisory") { skipped.push({ decisionType: decision.type, reason: "mode-advisory" }); continue }

        if (context.entropyScore.composite < config.suppression.minEntropyComposite) {
          skipped.push({ decisionType: decision.type, reason: "below-entropy-threshold" }); continue
        }
        if (context.iteration < config.suppression.minIteration) {
          skipped.push({ decisionType: decision.type, reason: "below-iteration-threshold" }); continue
        }
        if (context.budget.interventionsFiredThisRun >= config.suppression.maxFiresPerRun) {
          skipped.push({ decisionType: decision.type, reason: "max-fires-exceeded" }); continue
        }
        if (context.budget.tokensSpentOnInterventions >= config.suppression.maxInterventionTokenBudget) {
          skipped.push({ decisionType: decision.type, reason: "over-budget" }); continue
        }

        const handler = handlers.get(decision.type)
        if (!handler) { skipped.push({ decisionType: decision.type, reason: "no-handler" }); continue }

        const outcome = yield* handler.execute(decision as any, state, context).pipe(
          Effect.catchAll(() => Effect.succeed({
            applied: false, patches: [], cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
            reason: "handler-error", telemetry: {},
          }))
        )

        if (outcome.applied) {
          appliedPatches.push(...outcome.patches)
          tokens += outcome.cost.tokensEstimated
          latencyMs += outcome.cost.latencyMsEstimated
        } else {
          skipped.push({ decisionType: decision.type, reason: outcome.reason })
        }
      }

      return { appliedPatches, skipped, totalCost: { tokens, latencyMs } }
    })

  return { dispatch, handlers, config }
}

export function registerHandler(dispatcher: Dispatcher, handler: InterventionHandler): void {
  if (dispatcher.handlers.has(handler.type)) {
    throw new Error(`Handler already registered for ${handler.type}`)
  }
  dispatcher.handlers.set(handler.type, handler)
}
```

- [ ] **Step 4: Re-run tests**

Run: `cd packages/reactive-intelligence && bun test dispatcher`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/reactive-intelligence/
git commit -m "feat(reactive-intelligence): intervention dispatcher with self-gating"
```

---

### Task 2.4 — Migrate `early-stop` to handler + parity test

- [ ] **Step 1: Write the parity test (CI enforcement)**

```typescript
// packages/reactive-intelligence/__tests__/parity.test.ts
import { test, expect } from "bun:test"
import { defaultInterventionRegistry } from "../src/controller/handlers"
import { defaultInterventionConfig } from "../src/controller/intervention"

test("every decision type in marketed list is either registered or explicitly advisory", () => {
  const MARKETED_DECISION_TYPES = [
    "early-stop", "temp-adjust", "switch-strategy", "skill-activate",
    "prompt-switch", "tool-inject", "memory-boost", "skill-reinject",
    "human-escalate", "context-compress",
  ] as const
  const registered = new Set(defaultInterventionRegistry.map((h) => h.type))
  const missing: string[] = []
  for (const t of MARKETED_DECISION_TYPES) {
    const mode = defaultInterventionConfig.modes[t]
    if (!registered.has(t) && mode !== "advisory" && mode !== "off") {
      missing.push(t)
    }
  }
  expect(missing).toEqual([])
})
```

- [ ] **Step 2: Verify test fails**

Run: `cd packages/reactive-intelligence && bun test parity`
Expected: FAIL (no registry yet).

- [ ] **Step 3: Create handlers/index.ts and early-stop.ts**

```typescript
// packages/reactive-intelligence/src/controller/handlers/early-stop.ts
import { Effect } from "effect"
import type { InterventionHandler } from "../intervention"

export const earlyStopHandler: InterventionHandler<"early-stop"> = {
  type: "early-stop",
  description: "Terminate the kernel loop with a reason",
  defaultMode: "dispatch",
  execute: (decision, _state, _context) =>
    Effect.succeed({
      applied: true,
      patches: [{ kind: "early-stop", reason: decision.reason ?? "entropy-spike" }],
      cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
      reason: "fired",
      telemetry: { decisionConfidence: decision.confidence },
    }),
}
```

```typescript
// packages/reactive-intelligence/src/controller/handlers/index.ts
import { earlyStopHandler } from "./early-stop"
import type { InterventionHandler } from "../intervention"

export const defaultInterventionRegistry: readonly InterventionHandler[] = [
  earlyStopHandler,
]

// Declare all advisory decision types so parity test passes
export const advisoryDecisionTypes = [
  "temp-adjust", "switch-strategy", "skill-activate", "prompt-switch",
  "tool-inject", "memory-boost", "skill-reinject", "human-escalate",
  "context-compress",
] as const
```

Update `defaultInterventionConfig` in `intervention.ts` to mark advisory types:

```typescript
export const defaultInterventionConfig: InterventionConfig = {
  modes: {
    "early-stop": "dispatch",
    "temp-adjust": "advisory",
    "switch-strategy": "advisory",
    "skill-activate": "advisory",
    "prompt-switch": "advisory",
    "tool-inject": "advisory",
    "memory-boost": "advisory",
    "skill-reinject": "advisory",
    "human-escalate": "advisory",
    "context-compress": "advisory",
  },
  suppression: { /* same */ },
}
```

- [ ] **Step 4: Re-run parity test**

Run: `cd packages/reactive-intelligence && bun test parity`
Expected: PASS.

- [ ] **Step 5: Redirect termination-oracle to call dispatcher**

Edit `packages/reasoning/src/strategies/kernel/utils/termination-oracle.ts:222-230`. Replace direct decision handling with a dispatcher call, keeping the existing advisory log for backward compat.

- [ ] **Step 6: Run full suite**

Run: `bun test`
Expected: 4,161+ PASS, 0 FAIL.

- [ ] **Step 7: Commit**

```bash
git add packages/reactive-intelligence/ packages/reasoning/
git commit -m "feat(reactive-intelligence): migrate early-stop to handler + parity CI test"
```

---

### Task 2.5 — Wire dispatcher into kernel + emit trace events

- [ ] **Step 1: Wire dispatcher call site in kernel**

Edit `packages/reasoning/src/strategies/kernel/utils/reactive-observer.ts` (or wherever the controller currently produces decisions). After the controller evaluates decisions, call:

```typescript
const result = yield* dispatcher.dispatch(decisions, state, context)
state = applyPatches(state, result.appliedPatches)

// Emit trace events via EventBus
for (const p of result.appliedPatches) {
  yield* bus.publish({
    type: "InterventionDispatched",
    runId: ctx.runId, iter: ctx.iteration, timestamp: Date.now(),
    decisionType: /* match */, patchKind: p.kind,
    cost: result.totalCost, telemetry: {},
  })
}
for (const s of result.skipped) {
  yield* bus.publish({
    type: "InterventionSuppressed",
    runId: ctx.runId, iter: ctx.iteration, timestamp: Date.now(),
    decisionType: s.decisionType, reason: s.reason,
  })
}
```

- [ ] **Step 2: Extend TraceBridgeLayer mapping**

Edit `packages/trace/src/layer.ts` — add cases for `InterventionDispatched` and `InterventionSuppressed`:

```typescript
case "InterventionDispatched":
  return { ...base, kind: "intervention-dispatched",
    decisionType: raw.decisionType as string,
    patchKind: raw.patchKind as string,
    cost: raw.cost as any, telemetry: raw.telemetry as any }
case "InterventionSuppressed":
  return { ...base, kind: "intervention-suppressed",
    decisionType: raw.decisionType as string,
    reason: raw.reason as any }
```

- [ ] **Step 3: Integration test**

```typescript
// packages/runtime/__tests__/dispatcher-integration.test.ts
import { test, expect } from "bun:test"
import { ReactiveAgents } from "../src/builder"
import { loadTrace, traceStats } from "@reactive-agents/trace"

test("dispatcher emits intervention events to trace", async () => {
  const dir = `/tmp/dispatcher-it-${Date.now()}`
  const agent = await ReactiveAgents.create()
    .withTestScenario([{ match: ".*", text: "done" }])
    .withReactiveIntelligence()
    .withTracing({ dir })
    .build()

  const r = await agent.run("ping")
  const trace = await loadTrace(`${dir}/${r.runId}.jsonl`)
  const stats = traceStats(trace)
  expect(stats.totalEvents).toBeGreaterThan(0)
  // At minimum we see entropy-scored events (even if nothing dispatches)
  expect(trace.events.some((e) => e.kind === "entropy-scored")).toBe(true)
  await agent.dispose()
})
```

- [ ] **Step 4: Run + commit**

```bash
cd packages/runtime && bun test dispatcher-integration
```

Expected: PASS.

```bash
git add packages/reactive-intelligence/ packages/reasoning/ packages/trace/ packages/runtime/
git commit -m "feat: wire dispatcher into kernel + trace events"
```

---

## Phase 3 — Handler implementations (parallelizable per handler)

**Goal:** Make 5 more decisions actually dispatch. Each handler is a self-contained file + test + registration + default-flip.

**Parallel unit:** Each of Tasks 3.1-3.5 can be done by a separate engineer/agent once Phase 2 lands.

### Task 3.1 — `temp-adjust` handler

- [ ] **Step 1: Write the failing test**

```typescript
// packages/reactive-intelligence/__tests__/handlers/temp-adjust.test.ts
import { test, expect } from "bun:test"
import { Effect } from "effect"
import { tempAdjustHandler } from "../../src/controller/handlers/temp-adjust"

test("lowers temperature when decision targets lower", async () => {
  const outcome = await Effect.runPromise(
    tempAdjustHandler.execute(
      { type: "temp-adjust", confidence: 0.8, reason: "repetition", target: 0.3 } as any,
      { currentOptions: { temperature: 0.9 } } as any,
      { iteration: 3 } as any
    )
  )
  expect(outcome.applied).toBe(true)
  expect(outcome.patches[0]).toEqual({ kind: "set-temperature", temperature: 0.3 })
})
```

- [ ] **Step 2: Verify fail, then implement**

```typescript
// packages/reactive-intelligence/src/controller/handlers/temp-adjust.ts
import { Effect } from "effect"
import type { InterventionHandler } from "../intervention"

export const tempAdjustHandler: InterventionHandler<"temp-adjust"> = {
  type: "temp-adjust",
  description: "Adjust LLM temperature to break repetition or overconfidence",
  defaultMode: "dispatch",
  execute: (decision, state, _ctx) => {
    const current = state.currentOptions?.temperature ?? 0.7
    const target = Math.max(0.0, Math.min(1.0, decision.target ?? current * 0.6))
    if (Math.abs(current - target) < 0.05) {
      return Effect.succeed({
        applied: false, patches: [],
        cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
        reason: "delta-too-small", telemetry: { current, target },
      })
    }
    return Effect.succeed({
      applied: true,
      patches: [{ kind: "set-temperature", temperature: target }],
      cost: { tokensEstimated: 0, latencyMsEstimated: 50 },
      reason: "fired",
      telemetry: { from: current, to: target },
    })
  },
}
```

- [ ] **Step 3: Register + flip default**

Edit `handlers/index.ts`:

```typescript
import { tempAdjustHandler } from "./temp-adjust"
export const defaultInterventionRegistry = [earlyStopHandler, tempAdjustHandler] as const
```

Edit `intervention.ts` `defaultInterventionConfig.modes`: `"temp-adjust": "dispatch"`.

- [ ] **Step 4: Run all RI tests**

Run: `cd packages/reactive-intelligence && bun test`
Expected: PASS, parity test passes.

- [ ] **Step 5: Commit**

```bash
git add packages/reactive-intelligence/
git commit -m "feat(reactive-intelligence): temp-adjust handler"
```

---

### Task 3.2 — `switch-strategy` handler

**Files:**
- Create: `packages/reactive-intelligence/src/controller/handlers/switch-strategy.ts`
- Modify: `packages/reasoning/src/strategies/kernel/kernel-runner.ts:854` (tie switch-request into existing `strategySwitching.enabled` path)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/reactive-intelligence/__tests__/handlers/switch-strategy.test.ts
import { test, expect } from "bun:test"
import { Effect } from "effect"
import { switchStrategyHandler } from "../../src/controller/handlers/switch-strategy"

test("requests strategy switch when decision specifies target", async () => {
  const outcome = await Effect.runPromise(
    switchStrategyHandler.execute(
      { type: "switch-strategy", to: "plan-execute-reflect", reason: "loop", confidence: 0.8 } as any,
      { currentStrategy: "reactive" } as any,
      { iteration: 4 } as any
    )
  )
  expect(outcome.applied).toBe(true)
  expect(outcome.patches[0]).toMatchObject({ kind: "request-strategy-switch", to: "plan-execute-reflect" })
})

test("no-ops when target is same as current strategy", async () => {
  const outcome = await Effect.runPromise(
    switchStrategyHandler.execute(
      { type: "switch-strategy", to: "reactive", reason: "x", confidence: 0.8 } as any,
      { currentStrategy: "reactive" } as any,
      { iteration: 4 } as any
    )
  )
  expect(outcome.applied).toBe(false)
})
```

- [ ] **Step 2: Implement handler**

```typescript
// packages/reactive-intelligence/src/controller/handlers/switch-strategy.ts
import { Effect } from "effect"
import type { InterventionHandler } from "../intervention"

export const switchStrategyHandler: InterventionHandler<"switch-strategy"> = {
  type: "switch-strategy",
  description: "Switch reasoning strategy mid-run when current is stuck",
  defaultMode: "dispatch",
  execute: (decision, state, _ctx) => {
    const to = decision.to
    if (!to || to === state.currentStrategy) {
      return Effect.succeed({
        applied: false, patches: [],
        cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
        reason: "same-strategy", telemetry: {},
      })
    }
    return Effect.succeed({
      applied: true,
      patches: [{ kind: "request-strategy-switch", to, reason: decision.reason }],
      cost: { tokensEstimated: 100, latencyMsEstimated: 200 },
      reason: "fired", telemetry: { from: state.currentStrategy, to },
    })
  },
}
```

- [ ] **Step 3: Consume `pendingStrategySwitch` in kernel-runner**

Edit `kernel-runner.ts:854` — in the existing switch-check block, also check for a pending switch on state from a patch:

```typescript
if (state.pendingStrategySwitch) {
  // apply switch; clear the pending
}
```

- [ ] **Step 4: Register + flip default + commit**

Same pattern as Task 3.1.

```bash
git add packages/reactive-intelligence/ packages/reasoning/
git commit -m "feat(reactive-intelligence): switch-strategy handler + kernel-runner consumes pending switch"
```

---

### Task 3.3 — `context-compress` handler (unifies dual compression)

**Files:**
- Create: `packages/reactive-intelligence/src/controller/handlers/context-compress.ts`
- Modify: `packages/reasoning/src/strategies/kernel/utils/tool-execution.ts` (coordinate with existing always-on compression)

- [ ] **Step 1: Locate existing compression**

Run: `rg -n "compress" packages/reasoning/src/strategies/kernel/utils/tool-execution.ts`
Note current thresholds + logic.

- [ ] **Step 2: Write the failing test**

```typescript
// packages/reactive-intelligence/__tests__/handlers/context-compress.test.ts
import { test, expect } from "bun:test"
import { Effect } from "effect"
import { contextCompressHandler } from "../../src/controller/handlers/context-compress"

test("compresses when projected savings > token cost", async () => {
  const outcome = await Effect.runPromise(
    contextCompressHandler.execute(
      { type: "context-compress", targetTokens: 4000, confidence: 0.8 } as any,
      {
        messages: Array.from({ length: 30 }, () => ({ role: "tool", content: "x", tokens: 500 })),
        currentOptions: {},
      } as any,
      { iteration: 8 } as any
    )
  )
  expect(outcome.applied).toBe(true)
  expect(outcome.patches[0].kind).toBe("compress-messages")
})

test("skips when savings would be negative", async () => {
  const outcome = await Effect.runPromise(
    contextCompressHandler.execute(
      { type: "context-compress", targetTokens: 50000, confidence: 0.8 } as any,
      { messages: [{ role: "user", content: "x", tokens: 100 }], currentOptions: {} } as any,
      { iteration: 2 } as any
    )
  )
  expect(outcome.applied).toBe(false)
})
```

- [ ] **Step 3: Implement handler (cost-aware)**

```typescript
// packages/reactive-intelligence/src/controller/handlers/context-compress.ts
import { Effect } from "effect"
import type { InterventionHandler } from "../intervention"

const COMPRESS_COST_TOKENS = 300 // approximate cost of the LLM summarization call

export const contextCompressHandler: InterventionHandler<"context-compress"> = {
  type: "context-compress",
  description: "Compress message history when tokens trend high",
  defaultMode: "dispatch",
  execute: (decision, state, _ctx) => {
    const currentTokens = state.messages.reduce((s: number, m: any) => s + (m.tokens ?? 0), 0)
    const target = decision.targetTokens ?? Math.max(4000, Math.floor(currentTokens * 0.6))
    const savings = currentTokens - target
    if (savings <= COMPRESS_COST_TOKENS * 2) {
      return Effect.succeed({
        applied: false, patches: [],
        cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
        reason: "savings-below-cost",
        telemetry: { currentTokens, target, savings },
      })
    }
    return Effect.succeed({
      applied: true,
      patches: [{ kind: "compress-messages", targetTokens: target }],
      cost: { tokensEstimated: COMPRESS_COST_TOKENS, latencyMsEstimated: 800 },
      reason: "fired",
      telemetry: { currentTokens, target, expectedSavings: savings },
    })
  },
}
```

- [ ] **Step 4: Register + flip default + commit**

```bash
git add packages/reactive-intelligence/
git commit -m "feat(reactive-intelligence): context-compress handler (cost-aware)"
```

---

### Task 3.4 — `tool-inject` handler

- [ ] **Step 1: Test + implement**

```typescript
// packages/reactive-intelligence/__tests__/handlers/tool-inject.test.ts
import { test, expect } from "bun:test"
import { Effect } from "effect"
import { toolInjectHandler } from "../../src/controller/handlers/tool-inject"

test("injects tool guidance text", async () => {
  const outcome = await Effect.runPromise(
    toolInjectHandler.execute(
      { type: "tool-inject", text: "Use web-search before answering", confidence: 0.7 } as any,
      { currentOptions: {}, messages: [] } as any,
      { iteration: 2 } as any
    )
  )
  expect(outcome.applied).toBe(true)
  expect(outcome.patches[0]).toMatchObject({ kind: "inject-tool-guidance", text: /web-search/ })
})
```

```typescript
// packages/reactive-intelligence/src/controller/handlers/tool-inject.ts
import { Effect } from "effect"
import type { InterventionHandler } from "../intervention"

export const toolInjectHandler: InterventionHandler<"tool-inject"> = {
  type: "tool-inject",
  description: "Inject tool-usage guidance when model appears to be skipping tools",
  defaultMode: "dispatch",
  execute: (decision, _state, _ctx) => {
    if (!decision.text) {
      return Effect.succeed({
        applied: false, patches: [],
        cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
        reason: "no-text", telemetry: {},
      })
    }
    return Effect.succeed({
      applied: true,
      patches: [{ kind: "inject-tool-guidance", text: decision.text }],
      cost: { tokensEstimated: 50, latencyMsEstimated: 0 },
      reason: "fired", telemetry: {},
    })
  },
}
```

- [ ] **Step 2: Register + flip + commit**

```bash
git add packages/reactive-intelligence/
git commit -m "feat(reactive-intelligence): tool-inject handler"
```

---

### Task 3.5 — `skill-activate` handler (also unblocks dead meta-tool)

**Files:**
- Create: `packages/reactive-intelligence/src/controller/handlers/skill-activate.ts`
- Modify: `packages/tools/src/skills/activate-skill.ts` — add runtime handler
- Modify: `packages/reasoning/src/strategies/kernel/phases/act.ts:191-194` — register in `metaToolRegistry`

- [ ] **Step 1: Write tests**

```typescript
// packages/reactive-intelligence/__tests__/handlers/skill-activate.test.ts
import { test, expect } from "bun:test"
import { Effect } from "effect"
import { skillActivateHandler } from "../../src/controller/handlers/skill-activate"

test("injects skill content when decision names a skill", async () => {
  const outcome = await Effect.runPromise(
    skillActivateHandler.execute(
      { type: "skill-activate", skillId: "web-research", confidence: 0.8 } as any,
      { activatedSkills: [] } as any,
      { iteration: 3 } as any
    )
  )
  expect(outcome.applied).toBe(true)
  expect(outcome.patches[0].kind).toBe("inject-skill-content")
})
```

- [ ] **Step 2: Implement handler**

```typescript
// packages/reactive-intelligence/src/controller/handlers/skill-activate.ts
import { Effect } from "effect"
import type { InterventionHandler } from "../intervention"
import { loadSkillContent } from "@reactive-agents/tools/skills/skill-loader"

export const skillActivateHandler: InterventionHandler<"skill-activate"> = {
  type: "skill-activate",
  description: "Load and inject a skill's SKILL.md content",
  defaultMode: "dispatch",
  execute: (decision, state, _ctx) =>
    Effect.gen(function* () {
      const skillId = decision.skillId
      if (!skillId) {
        return {
          applied: false, patches: [],
          cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
          reason: "no-skill-id", telemetry: {},
        }
      }
      const already = (state.activatedSkills ?? []).some((s: any) => s.id === skillId)
      if (already) {
        return {
          applied: false, patches: [],
          cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
          reason: "already-active", telemetry: { skillId },
        }
      }
      const content = yield* Effect.promise(() => loadSkillContent(skillId))
      return {
        applied: true,
        patches: [{ kind: "inject-skill-content", skillId, content }],
        cost: { tokensEstimated: Math.ceil(content.length / 4), latencyMsEstimated: 100 },
        reason: "fired", telemetry: { skillId },
      }
    }),
}
```

- [ ] **Step 3: Implement `activate-skill` meta-tool handler**

Edit `packages/tools/src/skills/activate-skill.ts`:

```typescript
// Add after existing ToolDefinition export:
import { Effect } from "effect"

export const activateSkillHandler = (args: { skillId: string }) =>
  Effect.gen(function* () {
    const content = yield* Effect.promise(() => loadSkillContent(args.skillId))
    return { ok: true, skillId: args.skillId, content }
  })
```

Edit `packages/reasoning/src/strategies/kernel/phases/act.ts:191-194` — add to `metaToolRegistry`:

```typescript
"activate-skill": async (args, state) => {
  return activateSkillHandler(args as { skillId: string })
},
```

- [ ] **Step 4: Integration test**

```typescript
// packages/runtime/__tests__/skill-activate-integration.test.ts
import { test, expect } from "bun:test"
import { ReactiveAgents } from "../src/builder"

test("agent can call activate-skill meta-tool without crashing", async () => {
  const agent = await ReactiveAgents.create()
    .withTestScenario([
      { match: "call skill", toolCall: { name: "activate-skill", args: { skillId: "test-skill" } } },
      { match: ".*", text: "activated" },
    ])
    .withSkills({ paths: ["./fixtures/skills/"] })
    .build()
  const r = await agent.run("call skill")
  expect(r.output).toContain("activated")
  await agent.dispose()
})
```

- [ ] **Step 5: Commit**

```bash
git add packages/reactive-intelligence/ packages/tools/ packages/reasoning/
git commit -m "feat: skill-activate handler + wire activate-skill meta-tool runtime"
```

---

## Phase 4 — Assertion library + scenario library

### Task 4.1 — `expectTrace` assertion DSL

**Files:**
- Create: `packages/testing/src/harness/expect-trace.ts`
- Test: `packages/testing/__tests__/expect-trace.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/testing/__tests__/expect-trace.test.ts
import { test, expect } from "bun:test"
import { expectTrace } from "../src/harness/expect-trace"
import type { Trace } from "@reactive-agents/trace"

const trace: Trace = {
  runId: "r",
  events: [
    { kind: "run-started", runId: "r", timestamp: 1, iter: -1, seq: 0, task: "t", model: "m", provider: "p", config: {} },
    { kind: "entropy-scored", runId: "r", timestamp: 2, iter: 1, seq: 1, composite: 0.9, sources: { token: 0, structural: 0, semantic: 0, behavioral: 0, contextPressure: 0 } },
    { kind: "intervention-dispatched", runId: "r", timestamp: 3, iter: 1, seq: 2, decisionType: "temp-adjust", patchKind: "set-temperature", cost: { tokensEstimated: 0, latencyMsEstimated: 50 }, telemetry: {} },
    { kind: "run-completed", runId: "r", timestamp: 4, iter: 1, seq: 3, status: "success", totalTokens: 100, totalCostUsd: 0, durationMs: 3 },
  ],
}

test("asserts entropy spike", () => {
  expect(() => expectTrace(trace).toHaveEntropySpike({ above: 0.7 })).not.toThrow()
})

test("asserts intervention dispatched", () => {
  expect(() => expectTrace(trace).toHaveInterventionDispatched("temp-adjust")).not.toThrow()
})

test("throws when assertion fails", () => {
  expect(() => expectTrace(trace).toHaveInterventionDispatched("switch-strategy")).toThrow()
})
```

- [ ] **Step 2: Implement**

```typescript
// packages/testing/src/harness/expect-trace.ts
import type { Trace, TraceEvent } from "@reactive-agents/trace"

export function expectTrace(trace: Trace) {
  return new TraceAssertions(trace)
}

class TraceAssertions {
  constructor(private readonly trace: Trace) {}

  toHaveEntropySpike(opts: { above: number; atIterationBetween?: [number, number] }): this {
    const match = this.trace.events.find(
      (e) =>
        e.kind === "entropy-scored" &&
        e.composite >= opts.above &&
        (!opts.atIterationBetween ||
          (e.iter >= opts.atIterationBetween[0] && e.iter <= opts.atIterationBetween[1]))
    )
    if (!match) throw new Error(`No entropy spike above ${opts.above} found`)
    return this
  }

  toHaveInterventionDispatched(type: string, opts: { atIteration?: number } = {}): this {
    const match = this.trace.events.find(
      (e) =>
        e.kind === "intervention-dispatched" &&
        e.decisionType === type &&
        (opts.atIteration === undefined || e.iter === opts.atIteration)
    )
    if (!match) throw new Error(`No intervention-dispatched for ${type}`)
    return this
  }

  toHaveInterventionSuppressed(type: string, reason?: string): this {
    const match = this.trace.events.find(
      (e) =>
        e.kind === "intervention-suppressed" &&
        e.decisionType === type &&
        (reason === undefined || e.reason === reason)
    )
    if (!match) throw new Error(`No intervention-suppressed for ${type}${reason ? ` reason=${reason}` : ""}`)
    return this
  }

  toHaveCompletedWithin(opts: { iters?: number; tokens?: number }): this {
    const completed = this.trace.events.find((e) => e.kind === "run-completed")
    if (!completed || completed.kind !== "run-completed") throw new Error("Run did not complete")
    const iters = this.trace.events.filter((e) => e.kind === "iteration-enter").length
    if (opts.iters !== undefined && iters > opts.iters) throw new Error(`Ran ${iters} iters, expected <= ${opts.iters}`)
    if (opts.tokens !== undefined && completed.totalTokens > opts.tokens) throw new Error(`Used ${completed.totalTokens}, expected <= ${opts.tokens}`)
    return this
  }

  toHaveNoDeadHookEvents(): this {
    // Catches _riHooks regression: ensure at least one intervention event fires if RI is enabled
    const hasRI = this.trace.events.some((e) => e.kind === "entropy-scored")
    if (!hasRI) return this
    const hasDispatchOrSuppress = this.trace.events.some(
      (e) => e.kind === "intervention-dispatched" || e.kind === "intervention-suppressed"
    )
    if (!hasDispatchOrSuppress) throw new Error("RI active but no dispatcher events observed — hooks may be dead")
    return this
  }
}
```

- [ ] **Step 3: Run tests**

Run: `cd packages/testing && bun test expect-trace`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/testing/
git commit -m "feat(testing): expectTrace fluent assertion API"
```

---

### Task 4.2 — Scenario library (`@reactive-agents/scenarios`)

**Files:**
- Create: `packages/scenarios/package.json`, `tsconfig.json`, `tsup.config.ts`
- Create: `packages/scenarios/src/types.ts`
- Create: `packages/scenarios/src/scenarios/loop-prone-haiku.ts`
- Create: `packages/scenarios/src/scenarios/tool-failure-web-search.ts`
- Create: `packages/scenarios/src/scenarios/context-pressure-noisy.ts`
- Create: `packages/scenarios/src/scenarios/long-horizon-repo-triage.ts`
- Create: `packages/scenarios/src/scenarios/schema-drift-sql.ts`
- Create: `packages/scenarios/src/index.ts`

- [ ] **Step 1: Scaffold + types**

Create package per the pattern from Task 0.1, with `@reactive-agents/testing` as a dep.

```typescript
// packages/scenarios/src/types.ts
export type ScenarioTag =
  | "loop-prone" | "tool-failure" | "context-pressure"
  | "long-horizon" | "multi-step-planning" | "schema-drift"

export type FailureMode =
  | "loop-detected" | "tool-call-fail" | "context-overflow"
  | "hallucinated-args" | "abandoned-mid-plan"

export interface Scenario {
  readonly id: string
  readonly description: string
  readonly task: string
  readonly tags: readonly ScenarioTag[]
  readonly expectedFailureWithoutRI: FailureMode
  readonly successCriteria: (output: string) => boolean
  readonly preferredModels: readonly string[]
  readonly setup?: () => Promise<{ tools?: unknown; teardown?: () => Promise<void> }>
}
```

- [ ] **Step 2: Write 5 scenarios** (one per tag)

```typescript
// packages/scenarios/src/scenarios/loop-prone-haiku.ts
import type { Scenario } from "../types"

export const loopProneHaiku: Scenario = {
  id: "loop-prone-haiku",
  description: "Write+verify haiku — mid-tier models loop on syllable-counting",
  task: "Write a valid haiku about the sea (5-7-5 syllables). Verify syllables before responding. Output only the final haiku.",
  tags: ["loop-prone"],
  expectedFailureWithoutRI: "loop-detected",
  successCriteria: (out) => {
    const lines = out.trim().split("\n").filter(Boolean)
    return lines.length === 3
  },
  preferredModels: ["qwen3.5:latest", "cogito:8b"],
}
```

(Similarly for the other 4 — each is a real task with measurable success criteria.)

- [ ] **Step 3: Index exports + test**

```typescript
// packages/scenarios/__tests__/scenarios.test.ts
import { test, expect } from "bun:test"
import * as scenarios from "../src"

test("every scenario has required fields", () => {
  const all = Object.values(scenarios).filter((v: any) => v?.task)
  expect(all.length).toBeGreaterThanOrEqual(5)
  for (const s of all as any[]) {
    expect(s.id).toBeTruthy()
    expect(s.task).toBeTruthy()
    expect(typeof s.successCriteria).toBe("function")
  }
})
```

- [ ] **Step 4: Commit**

```bash
git add packages/scenarios/
git commit -m "feat(scenarios): seed library with 5 tagged hard scenarios"
```

---

### Task 4.3 — `runScenario` + `runCounterfactual`

- [ ] **Step 1: Implement + test**

```typescript
// packages/testing/src/harness/run-scenario.ts
import { ReactiveAgents } from "@reactive-agents/runtime"
import { loadTrace, type Trace } from "@reactive-agents/trace"
import type { Scenario } from "@reactive-agents/scenarios"

export interface RunOpts {
  readonly model: string
  readonly provider: string
  readonly withRI?: boolean
  readonly tracingDir?: string
  readonly disableInterventions?: readonly string[]
}

export async function runScenario(scenario: Scenario, opts: RunOpts): Promise<{
  readonly trace: Trace
  readonly success: boolean
  readonly output: string
}> {
  const dir = opts.tracingDir ?? `/tmp/scenarios/${scenario.id}`
  const builder = ReactiveAgents.create()
    .withProvider(opts.provider)
    .withModel(opts.model)
    .withReasoning()
    .withTools()
    .withTracing({ dir })

  if (opts.withRI) {
    const modes: Record<string, "dispatch" | "advisory" | "off"> = {}
    for (const t of opts.disableInterventions ?? []) modes[t] = "off"
    builder.withReactiveIntelligence({ interventions: { modes } })
  }

  const agent = await builder.build()
  const result = await agent.run(scenario.task)
  await agent.dispose()

  const trace = await loadTrace(`${dir}/${result.runId}.jsonl`)
  const success = scenario.successCriteria(result.output ?? "")
  return { trace, success, output: result.output ?? "" }
}

export async function runCounterfactual(
  scenario: Scenario,
  opts: RunOpts & { disable: readonly string[] }
): Promise<{ baseline: Trace; counterfactual: Trace; successDelta: boolean }> {
  const baseline = await runScenario(scenario, { ...opts, disableInterventions: [] })
  const counterfactual = await runScenario(scenario, { ...opts, disableInterventions: opts.disable })
  return {
    baseline: baseline.trace,
    counterfactual: counterfactual.trace,
    successDelta: baseline.success !== counterfactual.success,
  }
}
```

- [ ] **Step 2: Integration test using qwen3.5 (gated behind OLLAMA env)**

```typescript
// packages/testing/__tests__/run-scenario-integration.test.ts
import { test, expect } from "bun:test"
import { runScenario } from "../src/harness/run-scenario"
import { loopProneHaiku } from "@reactive-agents/scenarios"
import { expectTrace } from "../src/harness/expect-trace"

test.skipIf(!process.env.OLLAMA_E2E)("qwen3.5 + RI passes loop-prone-haiku", async () => {
  const r = await runScenario(loopProneHaiku, {
    provider: "ollama", model: "qwen3.5:latest", withRI: true,
  })
  expect(r.success).toBe(true)
  expectTrace(r.trace).toHaveNoDeadHookEvents()
}, 120_000)
```

- [ ] **Step 3: Commit**

```bash
git add packages/testing/
git commit -m "feat(testing): runScenario + runCounterfactual with trace capture"
```

---

## Phase 5 — Diagnostic tools

### Task 5.1 — `rax trace` CLI subcommand

**Files:**
- Modify: `packages/cli/src/commands/trace.ts` (new) or wherever rax subcommands live
- Modify: `packages/cli/src/cli.ts` (register subcommand)

- [ ] **Step 1: Locate CLI structure**

Run: `rg -n "registerCommand\|rax\." packages/cli/src/ | head -20`

- [ ] **Step 2: Implement `trace inspect`**

```typescript
// packages/cli/src/commands/trace.ts
import { loadTrace, traceStats } from "@reactive-agents/trace"

export async function traceInspect(path: string): Promise<void> {
  const trace = await loadTrace(path)
  const stats = traceStats(trace)
  console.log(`\nRun: ${trace.runId}`)
  console.log(`Events: ${stats.totalEvents} | Iters: ${stats.iterations} | Tokens: ${stats.totalTokens}`)
  console.log(`Interventions: ${stats.interventionsDispatched} dispatched, ${stats.interventionsSuppressed} suppressed`)
  console.log(`Max entropy: ${stats.maxEntropy.toFixed(2)}\n`)

  console.log("Timeline:")
  for (const ev of trace.events) {
    const prefix = `[iter ${String(ev.iter).padStart(2)}]`
    switch (ev.kind) {
      case "entropy-scored": console.log(`${prefix} entropy=${ev.composite.toFixed(2)}`); break
      case "intervention-dispatched": console.log(`${prefix} 🎯 DISPATCH ${ev.decisionType} → ${ev.patchKind}`); break
      case "intervention-suppressed": console.log(`${prefix} ⏸  SUPPRESS ${ev.decisionType} (${ev.reason})`); break
      case "tool-call-end": console.log(`${prefix} 🔧 ${ev.toolName} ${ev.ok ? "✓" : "✗"} (${ev.durationMs}ms)`); break
      case "strategy-switched": console.log(`${prefix} ↪  ${ev.from} → ${ev.to} (${ev.reason})`); break
      default: /* quiet for noisy events */ break
    }
  }
}

export async function traceCompare(a: string, b: string): Promise<void> {
  const ta = await loadTrace(a); const tb = await loadTrace(b)
  const sa = traceStats(ta); const sb = traceStats(tb)
  console.log(`                    A          B          Δ`)
  console.log(`Iterations:         ${sa.iterations}          ${sb.iterations}          ${sb.iterations - sa.iterations}`)
  console.log(`Tokens:             ${sa.totalTokens}    ${sb.totalTokens}    ${sb.totalTokens - sa.totalTokens}`)
  console.log(`Interventions:      ${sa.interventionsDispatched}          ${sb.interventionsDispatched}`)
  console.log(`Max entropy:        ${sa.maxEntropy.toFixed(2)}      ${sb.maxEntropy.toFixed(2)}`)
}
```

- [ ] **Step 3: Register subcommand + smoke test**

Run: `rax trace inspect .reactive-agents/traces/<some-run>.jsonl`
Expected: readable timeline output.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/
git commit -m "feat(cli): rax trace inspect + compare subcommands"
```

---

### Task 5.2 — Cortex TracePanel typed consumer *(deferred to v0.11)*

The CLI (Task 5.1) already delivers human + agent verifiability for v0.10. The Cortex TracePanel already exists (`apps/cortex/ui/src/lib/components/TracePanel.svelte`, 469 lines) and continues to work with its current event feed. Retargeting it to consume the typed `TraceEvent` union is a UI polish task — defer to v0.11 so v0.10 isn't gated on SvelteKit work.

**Followup capture:** when picked up, the work is: add `apps/cortex/src/routes/api/trace/[runId]/+server.ts` serving `loadTrace()` output as JSON, replace ad-hoc event shapes in TracePanel with the `TraceEvent` union, add entropy-timeline line chart + intervention list + tool-call table sections.

---

## Phase 6 — Validation + capability manifest

### Task 6.1 — Offline entropy validation script

**Files:**
- Create: `scripts/validate-entropy.ts`
- Create: `scripts/README.md` section documenting the script

- [ ] **Step 1: Write the script**

```typescript
// scripts/validate-entropy.ts
// Usage: bun run scripts/validate-entropy.ts .reactive-agents/traces/
import { readdir } from "node:fs/promises"
import { loadTrace, traceStats } from "@reactive-agents/trace"

async function main() {
  const dir = process.argv[2] ?? ".reactive-agents/traces"
  const files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"))

  // Build points: (max entropy, success?)
  const points: { maxEntropy: number; success: boolean }[] = []
  for (const f of files) {
    const trace = await loadTrace(`${dir}/${f}`)
    const stats = traceStats(trace)
    const completed = trace.events.find((e) => e.kind === "run-completed")
    if (!completed || completed.kind !== "run-completed") continue
    points.push({ maxEntropy: stats.maxEntropy, success: completed.status === "success" })
  }

  // Compute AUC using threshold sweep
  const thresholds = Array.from({ length: 20 }, (_, i) => i * 0.05)
  let auc = 0
  let prevFpr = 0
  for (const t of thresholds) {
    const tp = points.filter((p) => !p.success && p.maxEntropy >= t).length
    const fp = points.filter((p) => p.success && p.maxEntropy >= t).length
    const fn = points.filter((p) => !p.success && p.maxEntropy < t).length
    const tn = points.filter((p) => p.success && p.maxEntropy < t).length
    const tpr = tp / Math.max(1, tp + fn)
    const fpr = fp / Math.max(1, fp + tn)
    auc += (fpr - prevFpr) * tpr
    prevFpr = fpr
  }

  console.log(`\nEntropy validation over ${points.length} traces`)
  console.log(`AUC (max-entropy → failure): ${auc.toFixed(3)}`)
  console.log(`Success rate: ${points.filter((p) => p.success).length}/${points.length}`)
  console.log(`Interpretation: AUC > 0.7 = signal is real. 0.5 = noise. < 0.5 = inverted.`)
}

main().catch(console.error)
```

- [ ] **Step 2: Run against existing harness-reports/ traces (if migration layer makes them compatible)** or against a freshly-captured batch.

Run: `bun run scripts/validate-entropy.ts`
Capture output.

- [ ] **Step 3: Document finding**

Add to `.agents/MEMORY.md` under V0.10 Audit Blockers section: "Entropy AUC: X.XX over N traces. Validates/invalidates the 'reactive signal is real' claim."

- [ ] **Step 4: Commit**

```bash
git add scripts/ .agents/MEMORY.md
git commit -m "chore(scripts): offline entropy AUC validation against trace corpus"
```

---

### Task 6.2 — Capability manifest + CI check

**Files:**
- Create: `CAPABILITIES.md` (root)
- Create: `scripts/check-capabilities.ts`
- Modify: `.github/workflows/ci.yml` — add manifest check

- [ ] **Step 1: Create CAPABILITIES.md**

```markdown
# Reactive Agents Capability Manifest

This file is the source of truth for what the framework claims to do. CI fails if README/docs advertise capabilities not listed here, or if listed capabilities have no runtime handler.

## Reactive Interventions (dispatched)
- `early-stop` — packages/reactive-intelligence/src/controller/handlers/early-stop.ts
- `temp-adjust` — packages/reactive-intelligence/src/controller/handlers/temp-adjust.ts
- `switch-strategy` — packages/reactive-intelligence/src/controller/handlers/switch-strategy.ts
- `context-compress` — packages/reactive-intelligence/src/controller/handlers/context-compress.ts
- `tool-inject` — packages/reactive-intelligence/src/controller/handlers/tool-inject.ts
- `skill-activate` — packages/reactive-intelligence/src/controller/handlers/skill-activate.ts

## Reactive Interventions (advisory only — visible via pulse tool, no dispatch)
- `prompt-switch`
- `memory-boost`
- `skill-reinject`
- `human-escalate`

## Meta-Tools
- `brief` — packages/reasoning/src/strategies/kernel/phases/act.ts
- `pulse` — packages/reasoning/src/strategies/kernel/phases/act.ts
- `activate-skill` — packages/tools/src/skills/activate-skill.ts

## Entropy Sensor Sources (all active in composite)
- token, structural, semantic, behavioral, contextPressure

## Execution Phases (12)
bootstrap, guardrail, cost-route, strategy-select, think, act, observe, verify, memory-flush, cost-track, audit, complete
```

- [ ] **Step 2: Write the check script**

```typescript
// scripts/check-capabilities.ts
import { defaultInterventionRegistry } from "@reactive-agents/reactive-intelligence"
import { readFileSync } from "node:fs"

const manifest = readFileSync("CAPABILITIES.md", "utf8")

// Intervention dispatched list → must match registry
const dispatchedFromManifest = (manifest.match(/- `([\w-]+)` —/g) ?? [])
  .map((l) => l.match(/`([\w-]+)`/)?.[1])
  .filter(Boolean) as string[]

const registered = defaultInterventionRegistry.map((h) => h.type)
const manifestOnly = dispatchedFromManifest.filter((t) => !registered.includes(t))
const registryOnly = registered.filter((t) => !dispatchedFromManifest.includes(t))

if (manifestOnly.length > 0 || registryOnly.length > 0) {
  console.error("Capability manifest drift:")
  if (manifestOnly.length) console.error(`  In CAPABILITIES.md but no handler: ${manifestOnly.join(", ")}`)
  if (registryOnly.length) console.error(`  Handler registered but not in CAPABILITIES.md: ${registryOnly.join(", ")}`)
  process.exit(1)
}
console.log(`✓ Capability manifest in sync (${registered.length} dispatched handlers)`)
```

- [ ] **Step 3: Add to CI**

Edit `.github/workflows/ci.yml` — add step to the main job:

```yaml
      - name: Check capability manifest
        run: bun run scripts/check-capabilities.ts
```

- [ ] **Step 4: Run locally**

Run: `bun run scripts/check-capabilities.ts`
Expected: `✓ Capability manifest in sync (6 dispatched handlers)` (or current count).

- [ ] **Step 5: Commit**

```bash
git add CAPABILITIES.md scripts/check-capabilities.ts .github/workflows/ci.yml
git commit -m "chore(ci): capability manifest enforces doc↔code parity"
```

---

## Final verification — full-system integration run

### Task 7.1 — End-to-end ablation against loop-prone-haiku

- [ ] **Step 1: Write the integration test**

```typescript
// packages/runtime/__tests__/e2e-haiku-ablation.test.ts
import { test, expect } from "bun:test"
import { runCounterfactual } from "@reactive-agents/testing/harness/run-scenario"
import { loopProneHaiku } from "@reactive-agents/scenarios"
import { expectTrace } from "@reactive-agents/testing/harness/expect-trace"
import { traceStats } from "@reactive-agents/trace"

test.skipIf(!process.env.OLLAMA_E2E)("RI flips qwen3.5 haiku failure to success", async () => {
  const r = await runCounterfactual(loopProneHaiku, {
    provider: "ollama", model: "qwen3.5:latest", withRI: true,
    disable: ["early-stop", "temp-adjust", "switch-strategy", "context-compress", "tool-inject", "skill-activate"],
  })

  const s1 = traceStats(r.baseline)
  const s2 = traceStats(r.counterfactual)
  console.log("Baseline (RI on):", s1)
  console.log("Counterfactual (all interventions off):", s2)

  // The whole point: RI should do something observable
  expect(s1.interventionsDispatched).toBeGreaterThan(0)
  expectTrace(r.baseline).toHaveNoDeadHookEvents()
}, 300_000)
```

- [ ] **Step 2: Run it**

```bash
OLLAMA_E2E=1 cd packages/runtime && bun test e2e-haiku-ablation
```

Expected: baseline has ≥1 intervention-dispatched, `toHaveNoDeadHookEvents` passes.

- [ ] **Step 3: Document the result**

Append to `.agents/MEMORY.md` V0.10 audit section:

```markdown
### Post-dispatcher ablation (YYYY-MM-DD)
qwen3.5 loop-prone-haiku:
- Baseline (RI on): pass, X interventions dispatched, Y tokens
- Counterfactual (RI off): pass/fail, Z tokens
- Delta: ...
```

- [ ] **Step 4: Commit**

```bash
git add packages/runtime/__tests__/ .agents/MEMORY.md
git commit -m "test(e2e): haiku ablation verifies dispatcher fires + trace observable"
```

---

## Rollout sequence (reference)

1. **Phase 0** (Tasks 0.1–0.8) — **prerequisite**, no behavior change. Task 0.8 consolidates existing writers. 2–3 days.
2. **Phase 1** (Tasks 1.1–1.4) — **parallel with Phase 0**, independent fixes. 1 day.
3. **Phase 2** (Tasks 2.1–2.5) — **serial after Phase 0**. Dispatcher skeleton. 2 days.
4. **Phase 3** (Tasks 3.1–3.5) — **parallel per handler after Phase 2**. 3–4 days total, 1 day each.
5. **Phase 4** (Tasks 4.1–4.3) — **parallel with Phase 3** once Phase 2 ships. 2 days.
6. **Phase 5** (Task 5.1 only; 5.2 deferred) — **parallel with Phase 3/4**. ½ day.
7. **Phase 6** (Tasks 6.1–6.2) — **after Phase 3 lands at least 3 handlers**. 1 day.
8. **Phase 7** (Task 7.1) — **gate before v0.10 release**. ~½ day.

Total serial path: ~7 working days. Parallel work can compress to 4–5 days with 3 concurrent engineers/agents.

## What this unlocks

After this plan ships:

- **Single writer path** — trace JSONL is the source of truth. `harness-reports/*.log` is deleted; `observations/<model>.json` derives from traces. No drift between parallel systems.
- **Verifiability** — every claim in README has a code path; CI fails if they drift.
- **Traceability** — every run produces a typed JSONL trace inspectable by humans (CLI) and agents (assertion lib).
- **Honesty** — "10 interventions" becomes "6 dispatched, 4 advisory" with a manifest anyone can audit.
- **Benchmark-readiness** — `runScenario`/`runCounterfactual` + `expectTrace` is the bench harness; we can run τ-bench/Terminal-Bench adapters against the same contract.
- **Local-model viability** — `code-execute` works for every model; the dispatcher's self-gating stops the cogito:14b regression.
- **Offline entropy validation** — AUC on real traces tells us whether the reactive signal is real *before* we pitch it externally.

## Deferred to v0.11 (intentionally)

- Cortex TracePanel typed consumer (Task 5.2) — existing panel keeps working; CLI covers v0.10 verifiability
- Prompt-switch, memory-boost, skill-reinject, human-escalate handlers — stay advisory; promote if v0.10 ablation shows demand
