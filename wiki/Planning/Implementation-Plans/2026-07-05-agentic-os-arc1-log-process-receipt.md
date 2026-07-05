# Agentic OS Arc 1 — "The Log & The Process" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v0.14 launch gate: complete LLM I/O capture → exact replay, `RunHandle.inspect()`, `fork()` v1, `rax ps`/`rax attach`, and `result.receipt` v1 — the five demoable items from `wiki/Architecture/Specs/08-AGENTIC-OS-NORTH-STAR.md` §10 (item 5, published bench receipts, is the separate public-competitor-bench thread and is NOT in this plan).

**Architecture:** Wiring program, not new systems. The stream-path LLM exchange accumulator (`observable-llm.ts`) already fires but drops tool-call arguments — we complete it, then build an exact-replay LLM layer over recorded exchanges (mirroring the existing replay tool-table). The process model exposes state the kernel already serializes per-iteration (`onCheckpoint`); fork reuses the durable-resume machinery with a fresh runId. The receipt derives deterministically from `state.steps[]` + verifier verdict at result assembly — heuristic method v1, honest-claims scoped per spec §4.3.

**Tech Stack:** TypeScript + Bun + Effect-TS (existing). No new dependencies. Packages touched: `reasoning`, `replay`, `runtime`, `core`, `apps/cli`.

## Global Constraints

- Honest-claims scoping is BINDING (spec §4.2/§4.3): fork = "counterfactual restart from checkpoint", never "time-travel"; replay determinism = exact-replay only; receipt = graded evidence, signature = provenance not correctness. Copy in code comments/docs must follow.
- Effect-TS patterns per `effect-ts-patterns` skill: no `any` casts (use `unknown` + guards), typed errors, `Effect.serviceOption` for optional services.
- Every test: `bun test <path> --timeout 15000` (agent-tdd skill). Keyless: no test may require an API key or live Ollama (use `test` provider / fixtures).
- Single-owner terminate invariant untouched (`scripts/check-termination-paths.sh` must stay green).
- Additive API only — no breaking changes to `AgentResult`, `RunHandle` consumers (new fields/methods optional).
- Commit per task, conventional commits, no Co-Authored-By lines.

**Evidence anchors (read before implementing):**
- Live-probe report: `wiki/Research/Harness-Reports/2026-07-05-north-star-live-probe-validation.md`
- North star: `wiki/Architecture/Specs/08-AGENTIC-OS-NORTH-STAR.md` §4, §10

---

### Task 1: Capture tool-call arguments in streamed LLM exchanges

The stream accumulator in `observable-llm.ts` records `tool_use_start` (name+id) but ignores `tool_use_delta` events, which carry the JSON argument chunks (`packages/llm-provider/src/types.ts:959-964`). Result: recorded exchanges have `toolCalls: [{name}]` with no arguments (live-probe P4). The `complete()` path already passes arguments through — only the stream path is lossy.

**Files:**
- Modify: `packages/reasoning/src/kernel/observable-llm.ts:199-274` (stream accumulator)
- Test: `packages/reasoning/tests/kernel/observable-llm-args.test.ts` (create)

**Interfaces:**
- Consumes: `StreamEvent` union (`tool_use_start {id,name}`, `tool_use_delta {input}`) from `@reactive-agents/llm-provider`.
- Produces: `LLMExchangeEmitted` events whose `response.toolCalls` entries carry `arguments: unknown` (parsed JSON) — Task 3 replays from this.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/reasoning/tests/kernel/observable-llm-args.test.ts
import { describe, test, expect } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { LLMService, type StreamEvent } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { makeObservableLLM } from "../../src/kernel/observable-llm.js";

const streamedEvents: StreamEvent[] = [
  { type: "tool_use_start", id: "call_1", name: "calculator" },
  { type: "tool_use_delta", input: '{"expres' },
  { type: "tool_use_delta", input: 'sion":"137*89"}' },
  { type: "usage", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 } },
];

const FakeLLM = Layer.succeed(LLMService, {
  complete: () => Effect.die("unused"),
  completeStructured: () => Effect.die("unused"),
  stream: () => Effect.succeed(Stream.fromIterable(streamedEvents)),
  embed: () => Effect.die("unused"),
  countTokens: () => Effect.succeed(0),
  getModelConfig: () => Effect.die("unused"),
  getStructuredOutputCapabilities: () => Effect.die("unused"),
  capabilities: undefined,
} as never);

describe("observable-llm stream argument capture", () => {
  test("accumulates tool_use_delta chunks into parsed arguments", async () => {
    const captured: AgentEvent[] = [];
    const program = Effect.gen(function* () {
      const bus = yield* EventBus;
      yield* bus.subscribe((e) => Effect.sync(() => { captured.push(e); }));
      const llm = yield* LLMService;
      const s = yield* llm.stream({ messages: [{ role: "user", content: "calc" }] } as never);
      yield* Stream.runDrain(s);
    }).pipe(
      Effect.provide(makeObservableLLM().pipe(Layer.provide(FakeLLM))),
      Effect.provide(EventBusLive),
    );
    await Effect.runPromise(program);

    const exchange = captured.find((e) => e._tag === "LLMExchangeEmitted") as
      | { _tag: string; response: { toolCalls?: readonly { name: string; arguments?: unknown }[] } }
      | undefined;
    expect(exchange).toBeDefined();
    expect(exchange!.response.toolCalls).toHaveLength(1);
    expect(exchange!.response.toolCalls![0].name).toBe("calculator");
    expect(exchange!.response.toolCalls![0].arguments).toEqual({ expression: "137*89" });
  });
});
```

Note for implementer: if `EventBusLive`'s subscribe/import shape differs, mirror the pattern used by the existing `packages/reasoning/tests/**/diagnostics*` or trace tests — the assertion (arguments parsed from deltas) is the contract, the bus-wiring boilerplate may be adapted.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/reasoning/tests/kernel/observable-llm-args.test.ts --timeout 15000`
Expected: FAIL — `arguments` is `undefined` (accumulator drops `tool_use_delta`).

- [ ] **Step 3: Extend the accumulator**

In `observable-llm.ts`, change the accumulator record and tap (lines ~202-254):

```typescript
const accum = yield* Ref.make<{
  content: string;
  toolCalls: { name: string; id: string; argsJson: string }[];
  usage?: PartialCompletion["usage"];
  resolvedParams?: PartialCompletion["resolvedParams"];
  stopReason?: StopReason;
}>({ content: "", toolCalls: [] });
```

In the `Stream.tap` switch add/extend cases:

```typescript
case "tool_use_start":
  return {
    ...s,
    toolCalls: [...s.toolCalls, { name: event.name, id: event.id, argsJson: "" }],
    stopReason: "tool_use" as StopReason,
  };
case "tool_use_delta": {
  // Deltas attach to the most recently started call (provider sequencing contract).
  if (s.toolCalls.length === 0) return s;
  const last = s.toolCalls[s.toolCalls.length - 1];
  return {
    ...s,
    toolCalls: [...s.toolCalls.slice(0, -1), { ...last, argsJson: last.argsJson + event.input }],
  };
}
```

In `Stream.ensuring`, parse accumulated JSON per call before emitting:

```typescript
const toolCalls = s.toolCalls.length > 0
  ? s.toolCalls.map((tc) => {
      let args: unknown;
      try { args = tc.argsJson ? JSON.parse(tc.argsJson) : undefined; } catch { args = tc.argsJson; }
      return { name: tc.name, ...(args !== undefined ? { arguments: args } : {}) };
    })
  : undefined;
yield* emitForRequest(request, s.content, Date.now() - start, "stream", {
  stopReason: s.stopReason ?? ("end_turn" as StopReason),
  toolCalls,
  usage: s.usage,
  ...(s.resolvedParams ? { resolvedParams: s.resolvedParams } : {}),
});
```

(Unparseable JSON falls back to the raw string — never throw from the observability path.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/reasoning/tests/kernel/observable-llm-args.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 5: Run the package suite + typecheck**

Run: `bun test packages/reasoning --timeout 15000 && bunx tsc --noEmit -p packages/reasoning`
Expected: green (pre-existing failures only, if any — record them in the commit message).

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/kernel/observable-llm.ts packages/reasoning/tests/kernel/observable-llm-args.test.ts
git commit -m "feat(reasoning): capture tool-call arguments in streamed LLM exchanges"
```

---

### Task 2: Fix the stale capture comment + surface exchanges in trace analysis

`packages/trace/src/analyze.ts:322` claims `LLMExchangeEmitted` "does not fire on the live path" — live-probe P4 proved it does (kernel path). Fix the comment and make `analyzeRun` count exchanges so downstream consumers (receipt, diagnose) can rely on them.

**Files:**
- Modify: `packages/trace/src/analyze.ts` (stale comment ~line 322; add `llmExchangeCount` to run analysis)
- Test: `packages/trace/tests/analyze-exchanges.test.ts` (create)

**Interfaces:**
- Consumes: trace JSONL events with `kind: "llm-exchange"` (existing mapping).
- Produces: `RunAnalysis.llmExchangeCount: number` (additive field) — used by Task 8's receipt evidence and by `rax diagnose`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/trace/tests/analyze-exchanges.test.ts
import { describe, test, expect } from "bun:test";
import { analyzeRun } from "../src/analyze.js";
import type { TraceEvent } from "../src/types.js";

const events = [
  { kind: "run-started", runId: "r1", timestamp: 1, task: "t", model: "m", provider: "p" },
  { kind: "llm-exchange", runId: "r1", timestamp: 2, iter: 0, seq: 1, provider: "p", model: "m",
    requestKind: "stream", messages: [{ role: "user", content: "hi" }],
    response: { content: "", toolCalls: [{ name: "calculator", arguments: { expression: "1+1" } }] } },
  { kind: "run-completed", runId: "r1", timestamp: 3, outcome: "success" },
] as unknown as TraceEvent[];

describe("analyzeRun llm exchanges", () => {
  test("counts llm-exchange events", () => {
    const analysis = analyzeRun(events);
    expect(analysis.llmExchangeCount).toBe(1);
  });
});
```

(Adapt the minimal event shapes to `TraceEvent`'s actual required fields — the compiler will tell you; do NOT weaken the assertion.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/trace/tests/analyze-exchanges.test.ts --timeout 15000`
Expected: FAIL — `llmExchangeCount` undefined.

- [ ] **Step 3: Implement**

In `analyze.ts`: (a) replace the stale sentence in the comment near line 322 with: `// llm-exchange fires on the live kernel path via observable-llm.ts (verified 2026-07-05); response payloads complete as of Arc 1 Task 1.` (b) add to the run-analysis result object: `llmExchangeCount: events.filter((e) => e.kind === "llm-exchange").length,` and the corresponding readonly field on the analysis interface.

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test packages/trace --timeout 15000 && bunx tsc --noEmit -p packages/trace`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trace/src/analyze.ts packages/trace/tests/analyze-exchanges.test.ts
git commit -m "fix(trace): correct stale llm-exchange comment; expose llmExchangeCount"
```

---

### Task 3: Exact-replay LLM layer (`makeReplayLLMLayer`)

Replay currently swaps only `ToolService` (`packages/replay/src/replay-tool-layer.ts`); the LLM stays live, so replays are nondeterministic and cost tokens. Build the LLM twin: dispense recorded exchange responses in recorded order, keyed like the tool table. This is the zero-token-CI engine (exact-replay only — config changes that alter prompts MISS by design and must error clearly, per honest-claims scoping).

**Files:**
- Create: `packages/replay/src/llm-table.ts`
- Create: `packages/replay/src/replay-llm-layer.ts`
- Modify: `packages/replay/src/load.ts` (also build the LLM table from `llm-exchange` events)
- Modify: `packages/replay/src/index.ts` (export new API)
- Test: `packages/replay/tests/replay-llm-layer.test.ts` (create)

**Interfaces:**
- Consumes: `Trace` events `kind:"llm-exchange"` with complete `response.content`/`response.toolCalls[].arguments` (Task 1) — fields per `emitLLMExchange` args (`packages/reasoning/src/kernel/utils/diagnostics.ts:306`).
- Produces:
  - `buildLLMTable(events: readonly TraceEvent[]): LLMTable` — keyed `sha256(stableStringify({systemPrompt, messages}))[:16]`, per-key FIFO cursor (mirror `packages/replay/src/tool-table.ts:13-30` exactly — same hashing util).
  - `makeReplayLLMLayer(table: LLMTable, opts?: { onMiss?: "die" | "lenient" }): Layer.Layer<LLMService>` — `complete()`/`stream()` dispense recorded responses (stream = a single `content_complete` + synthesized `tool_use_start`/`tool_use_delta` events from recorded toolCalls + `usage`); `embed`/`countTokens` pass through cheap stubs; miss → `Effect.die(ReplayLLMMissError)` in strict mode.
  - `RecordedExchange` type: `{ systemPrompt?: string; messages: readonly {role,content}[]; response: { content: string; toolCalls?: readonly {name, arguments?}[]; stopReason?: string } }`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/replay/tests/replay-llm-layer.test.ts
import { describe, test, expect } from "bun:test";
import { Effect, Stream } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { buildLLMTable } from "../src/llm-table.js";
import { makeReplayLLMLayer } from "../src/replay-llm-layer.js";

const exchangeEvent = {
  kind: "llm-exchange", runId: "r1", timestamp: 2, iter: 0, seq: 1,
  provider: "ollama", model: "qwen3:4b", requestKind: "stream",
  systemPrompt: "You are helpful.",
  messages: [{ role: "user", content: "compute 137*89" }],
  response: {
    content: "",
    toolCalls: [{ name: "calculator", arguments: { expression: "137*89" } }],
    stopReason: "tool_use", tokensIn: 10, tokensOut: 5,
  },
};

describe("replay LLM layer", () => {
  test("dispenses the recorded tool call for a matching request", async () => {
    const table = buildLLMTable([exchangeEvent] as never);
    const program = Effect.gen(function* () {
      const llm = yield* LLMService;
      const s = yield* llm.stream({
        systemPrompt: "You are helpful.",
        messages: [{ role: "user", content: "compute 137*89" }],
      } as never);
      const events = yield* Stream.runCollect(s);
      return Array.from(events);
    }).pipe(Effect.provide(makeReplayLLMLayer(table)));
    const events = await Effect.runPromise(program);
    const start = events.find((e) => (e as { type: string }).type === "tool_use_start") as { name: string } | undefined;
    const deltas = events.filter((e) => (e as { type: string }).type === "tool_use_delta") as { input: string }[];
    expect(start?.name).toBe("calculator");
    expect(JSON.parse(deltas.map((d) => d.input).join(""))).toEqual({ expression: "137*89" });
  });

  test("strict mode dies on unrecorded request", async () => {
    const table = buildLLMTable([] as never);
    const program = Effect.gen(function* () {
      const llm = yield* LLMService;
      yield* llm.complete({ messages: [{ role: "user", content: "novel" }] } as never);
    }).pipe(Effect.provide(makeReplayLLMLayer(table)));
    await expect(Effect.runPromise(program)).rejects.toThrow(/no recorded exchange/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/replay/tests/replay-llm-layer.test.ts --timeout 15000`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement `llm-table.ts`**

Mirror `tool-table.ts` structure exactly (same `stableStringify` + sha256 helper — import or extract shared util if tool-table's is private):

```typescript
// packages/replay/src/llm-table.ts
import { createHash } from "node:crypto";

export interface RecordedExchange {
  readonly key: string;
  readonly response: {
    readonly content: string;
    readonly toolCalls?: readonly { readonly name: string; readonly arguments?: unknown }[];
    readonly stopReason?: string;
    readonly tokensIn?: number;
    readonly tokensOut?: number;
  };
}

export interface LLMTable {
  /** FIFO-dispense the next recorded exchange for this request key; undefined when exhausted/missing. */
  next(key: string): RecordedExchange | undefined;
  readonly size: number;
}

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );

export const exchangeKey = (systemPrompt: string | undefined, messages: readonly { role: string; content: string }[]): string =>
  createHash("sha256").update(stable({ systemPrompt: systemPrompt ?? "", messages })).digest("hex").slice(0, 16);

export function buildLLMTable(events: readonly Record<string, unknown>[]): LLMTable {
  const buckets = new Map<string, RecordedExchange[]>();
  for (const e of events) {
    if (e.kind !== "llm-exchange") continue;
    const messages = (e.messages ?? []) as readonly { role: string; content: string }[];
    const key = exchangeKey(e.systemPrompt as string | undefined, messages);
    const rec: RecordedExchange = { key, response: e.response as RecordedExchange["response"] };
    const arr = buckets.get(key) ?? [];
    arr.push(rec);
    buckets.set(key, arr);
  }
  const cursors = new Map<string, number>();
  let total = 0;
  for (const arr of buckets.values()) total += arr.length;
  return {
    size: total,
    next(key) {
      const arr = buckets.get(key);
      if (!arr) return undefined;
      const i = cursors.get(key) ?? 0;
      if (i >= arr.length) return undefined;
      cursors.set(key, i + 1);
      return arr[i];
    },
  };
}
```

- [ ] **Step 4: Implement `replay-llm-layer.ts`**

```typescript
// packages/replay/src/replay-llm-layer.ts
import { Effect, Layer, Stream } from "effect";
import type { Context } from "effect";
import { LLMService, type StreamEvent, type CompletionRequest } from "@reactive-agents/llm-provider";
import { exchangeKey, type LLMTable, type RecordedExchange } from "./llm-table.js";

const contentToString = (c: unknown): string => (typeof c === "string" ? c : JSON.stringify(c));

const requestKey = (req: CompletionRequest): string =>
  exchangeKey(
    req.systemPrompt,
    req.messages.map((m) => ({ role: m.role as string, content: contentToString(m.content) })),
  );

const toStreamEvents = (rec: RecordedExchange): StreamEvent[] => {
  const out: StreamEvent[] = [];
  if (rec.response.content) out.push({ type: "text_delta", text: rec.response.content });
  for (const [i, tc] of (rec.response.toolCalls ?? []).entries()) {
    out.push({ type: "tool_use_start", id: `replay_${i}`, name: tc.name });
    if (tc.arguments !== undefined) out.push({ type: "tool_use_delta", input: JSON.stringify(tc.arguments) });
  }
  out.push({ type: "content_complete", content: rec.response.content });
  out.push({
    type: "usage",
    usage: {
      inputTokens: rec.response.tokensIn ?? 0, outputTokens: rec.response.tokensOut ?? 0,
      totalTokens: (rec.response.tokensIn ?? 0) + (rec.response.tokensOut ?? 0), estimatedCost: 0,
    },
  });
  return out;
};

const miss = (key: string): never => {
  throw new Error(`Replay: no recorded exchange for request key ${key} — exact-replay requires unchanged prompts/config`);
};

export const makeReplayLLMLayer = (table: LLMTable): Layer.Layer<LLMService> =>
  Layer.succeed(LLMService, {
    complete: (req: CompletionRequest) =>
      Effect.sync(() => {
        const rec = table.next(requestKey(req)) ?? miss(requestKey(req));
        return {
          content: rec.response.content,
          toolCalls: rec.response.toolCalls as never,
          stopReason: (rec.response.stopReason ?? "end_turn") as never,
          usage: { inputTokens: rec.response.tokensIn ?? 0, outputTokens: rec.response.tokensOut ?? 0, totalTokens: 0, estimatedCost: 0 },
        } as never;
      }),
    stream: (req: CompletionRequest) =>
      Effect.sync(() => {
        const rec = table.next(requestKey(req)) ?? miss(requestKey(req));
        return Stream.fromIterable(toStreamEvents(rec));
      }),
    completeStructured: () => Effect.die("replay: completeStructured not recorded in v1 — use complete/stream paths"),
    embed: () => Effect.die("replay: embed not supported"),
    countTokens: () => Effect.succeed(0),
    getModelConfig: () => Effect.die("replay: getModelConfig not supported"),
    getStructuredOutputCapabilities: () => Effect.die("replay: not supported"),
    capabilities: undefined,
  } as Context.Tag.Service<LLMService>);
```

(Match the real `LLMService` interface — if it has more/fewer members, stub each with a clear `Effect.die` message. The compiler is the guide; no `as never` where a real type fits.)

- [ ] **Step 5: Wire into `load.ts` + export**

In `load.ts`, alongside the tool table build, add `llmTable: buildLLMTable(traceEvents)` to the returned `RecordedRun` (additive field). Export `makeReplayLLMLayer`, `buildLLMTable`, `exchangeKey` from `index.ts`.

- [ ] **Step 6: Run tests + typecheck**

Run: `bun test packages/replay --timeout 15000 && bunx tsc --noEmit -p packages/replay`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/replay/src packages/replay/tests/replay-llm-layer.test.ts
git commit -m "feat(replay): exact-replay LLM layer — recorded exchanges dispensed deterministically"
```

---

### Task 4: Durable checkpoint hardening + config truthfulness warning

Live-probe P3 findings pulled forward (they gate fork/inspect): (a) checkpoint writes are fire-and-forget (`Effect.runFork`, `run-controller.ts:52`) — a crash right after an iteration loses the checkpoint silently; (b) `.withDurableRuns()` without `.withReasoning()` writes a run row but never checkpoints, with no warning.

**Files:**
- Modify: `packages/runtime/src/run-controller.ts:41-85` (`installDurableCheckpointing`)
- Modify: `packages/runtime/src/builder.ts` (build-time warning; locate the build() validation region — grep `withDurableRuns` config read)
- Test: `packages/runtime/tests/durable-checkpoint-hardening.test.ts` (create)

**Interfaces:**
- Consumes: `RunStoreService.putCheckpoint(runId, iteration, stateJson)`.
- Produces: `installDurableCheckpointing(controller, deps)` now also exposes `flush(): Promise<void>` (awaits in-flight writes); builder emits `console.warn` (once) when durable is configured without the kernel path.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/runtime/tests/durable-checkpoint-hardening.test.ts
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { RunController, installDurableCheckpointing } from "../src/run-controller.js";
import { RunStoreLive, RunStoreService } from "../src/services/run-store.js";

describe("durable checkpoint hardening", () => {
  test("flush() guarantees the last checkpoint is durable before returning", async () => {
    const dbPath = `/tmp/claude-1000/hardening-${Date.now()}.db`;
    const layer = RunStoreLive(dbPath);
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* store.createRun({ runId: "r1", agentId: "a", task: "t", configHash: "h" } as never);
      }).pipe(Effect.provide(layer)),
    );
    const controller = new RunController(new AbortController());
    const { flush } = installDurableCheckpointing(controller, { runId: "r1", runStoreLayer: layer, checkpointEvery: 1 });
    controller.onCheckpoint!("{\"codecVersion\":1,\"state\":{}}", 1);
    await flush();
    const row = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        return yield* store.latestCheckpoint("r1");
      }).pipe(Effect.provide(layer)),
    );
    expect(row?.iteration).toBe(1);
  });
});
```

(Adapt `createRun` arg shape to the real `RunStoreService` signature — read `packages/runtime/src/services/run-store.ts` first.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/tests/durable-checkpoint-hardening.test.ts --timeout 15000`
Expected: FAIL — `flush` does not exist.

- [ ] **Step 3: Implement**

In `installDurableCheckpointing`: track in-flight write promises in a `Set<Promise<void>>`; `runWrite` becomes `Effect.runPromise(...)` stored in the set (still catch-all, still never throws to the loop — the loop does NOT await; only `flush()`/`finish()` do). Return `{ finish, flush }` where `flush = () => Promise.allSettled([...inflight]).then(() => undefined)` and `finish` awaits `flush()` before the status write. Update the one caller of `installDurableCheckpointing` (grep it — execute-stream) to `await flush()` at run end before yielding `StreamCompleted`.

Builder warning: in `build()` where `_durableRuns` is validated, add:

```typescript
if (this._durableRuns && !this._reasoningConfig) {
  console.warn(
    "[reactive-agents] .withDurableRuns() is configured but the run will NOT checkpoint: " +
    "crash-resume checkpoints require the kernel path — add .withReasoning(). " +
    "(The run row and approval rails still work.)",
  );
}
```

(Locate the real reasoning-config field name via grep `withReasoning` in `builder/withers/`; use that field.)

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test packages/runtime/tests/durable-checkpoint-hardening.test.ts --timeout 15000 && bunx tsc --noEmit -p packages/runtime`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/run-controller.ts packages/runtime/src/builder.ts packages/runtime/tests/durable-checkpoint-hardening.test.ts
git commit -m "fix(runtime): awaited checkpoint flush + warn on inert durable config"
```

---

### Task 5: `RunHandle.inspect()` — live state introspection

The kernel already serializes full state to `onCheckpoint` per iteration; the controller just doesn't keep it. Store the latest snapshot on the controller and expose `inspect()` on the handle. Always-on for the kernel path (cheap — the string already exists), independent of durable persistence.

**Files:**
- Modify: `packages/core/src/streaming.ts:49` region (`RunControllerLike` — add optional `noteCheckpoint`)
- Modify: `packages/runtime/src/run-controller.ts` (`RunController` snapshot storage + `inspect()`; `RunHandle` type)
- Modify: kernel checkpoint call site — `packages/reasoning/src/kernel/loop/iterate-pass.ts:375` region (call `noteCheckpoint` ALWAYS, `onCheckpoint` only when durable — read the site first; today `onCheckpoint(serializeKernelState(...))` is called conditionally)
- Modify: `packages/runtime/src/reactive-agent.ts:1682-1720` region (expose `inspect` on the returned handle)
- Test: `packages/runtime/tests/run-inspect.test.ts` (create)

**Interfaces:**
- Consumes: `serializeKernelState` output (codec envelope `{codecVersion, state}` — `engine/kernel-codec.ts`).
- Produces:
  ```typescript
  export interface RunInspection {
    readonly status: RunStatus;
    readonly iteration: number;
    readonly stepsCount: number;
    readonly messagesCount: number;
    readonly lastThought?: string;      // truncated 500 chars
    readonly pendingToolCalls: readonly string[]; // names
    readonly capturedAt: number;        // epoch ms
  }
  // RunHandle gains: inspect(): RunInspection | undefined  (undefined before first iteration or on non-kernel paths)
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// packages/runtime/tests/run-inspect.test.ts
import { describe, test, expect } from "bun:test";
import { RunController } from "../src/run-controller.js";

const SNAPSHOT = JSON.stringify({
  codecVersion: 1,
  state: {
    status: "thinking",
    steps: [{ type: "thought", content: "I should use the calculator to compute the product." }],
    messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "" }],
    meta: { pendingNativeToolCalls: [{ name: "calculator", arguments: { expression: "1+1" } }] },
  },
});

describe("RunController.inspect", () => {
  test("returns parsed snapshot fields", () => {
    const c = new RunController(new AbortController());
    c.noteCheckpoint(SNAPSHOT, 3);
    const i = c.inspect();
    expect(i).toBeDefined();
    expect(i!.iteration).toBe(3);
    expect(i!.stepsCount).toBe(1);
    expect(i!.messagesCount).toBe(2);
    expect(i!.pendingToolCalls).toEqual(["calculator"]);
    expect(i!.lastThought).toContain("calculator");
  });

  test("undefined before any checkpoint", () => {
    const c = new RunController(new AbortController());
    expect(c.inspect()).toBeUndefined();
  });
});
```

(Adjust the fake snapshot's field paths to the REAL codec shape first — deserialize an actual checkpoint from any durable test DB or read `kernel-codec.ts`; the test must mirror real paths, not invented ones.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/tests/run-inspect.test.ts --timeout 15000`
Expected: FAIL — `noteCheckpoint`/`inspect` don't exist.

- [ ] **Step 3: Implement**

`RunController`: add `private _lastSnapshot?: { json: string; iteration: number; at: number }`; `noteCheckpoint(json, iter)` stores it; `inspect()` lazily parses (try/catch → undefined on parse error) and projects the `RunInspection` fields (truncate `lastThought` to 500 chars; guard every path with optional chaining — the codec state shape is versioned).

Kernel site: where `controller.onCheckpoint` is invoked (iterate-pass), call `controller.noteCheckpoint?.(serialized, iteration)` UNCONDITIONALLY before the durable-only `onCheckpoint` branch — the serialization already happens there only when `onCheckpoint` exists; hoist it so serialization occurs when `noteCheckpoint` OR `onCheckpoint` is present. Add `noteCheckpoint?` to `RunControllerLike` (core/streaming.ts).

`reactive-agent.ts` handle assembly: add `inspect: () => controller.inspect()`. Extend the `RunHandle` type in `run-controller.ts` with `inspect(): RunInspection | undefined`.

- [ ] **Step 4: Run tests + typecheck across touched packages**

Run: `bun test packages/runtime/tests/run-inspect.test.ts --timeout 15000 && bunx tsc --noEmit -p packages/runtime -p packages/reasoning -p packages/core`
Expected: PASS.

- [ ] **Step 5: Live smoke (manual, keyless-exempt)**

Run: `bun .probes-live/p2-runhandle.ts` variant with `.withReasoning({strategy:"reactive"})` + a mid-run `console.log(handle.inspect())`.
Expected: inspection object with iteration ≥ 1 while running. (Ollama required — do not turn into a CI test.)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/streaming.ts packages/runtime/src/run-controller.ts packages/runtime/src/reactive-agent.ts packages/reasoning/src/kernel/loop/iterate-pass.ts packages/runtime/tests/run-inspect.test.ts
git commit -m "feat(runtime): RunHandle.inspect() — live kernel-state introspection"
```

---

### Task 6: `agent.fork()` v1 — counterfactual restart from checkpoint

Reuses the durable-resume rails: load a checkpoint (any iteration, not just latest), rewrite identity to a fresh runId with `forkedFrom` provenance, seed the resume refs, run. v1 scope: same agent instance/config, optional `model` override (bypasses the config-hash guard EXPLICITLY — fork is a deliberate counterfactual, unlike crash-resume). Never marketed as time-travel.

**Files:**
- Modify: `packages/runtime/src/services/run-store.ts` (add `checkpointAt(runId, iteration)` — like `latestCheckpoint` with `WHERE iteration <= ?` ORDER BY iteration DESC LIMIT 1)
- Modify: `packages/runtime/src/engine/durable-resume.ts` (add `loadForkPayload` — no config-hash check, returns checkpoint ≤ requested iteration)
- Modify: `packages/runtime/src/reactive-agent.ts` (add `fork(runId, opts)` next to the existing resume method ~line 895)
- Test: `packages/runtime/tests/run-fork.test.ts` (create)

**Interfaces:**
- Consumes: `RunStoreService`, `ResumeStateRef` seeding pattern (see how resume seeds it, `reactive-agent.ts:916` region), `runStream()`.
- Produces:
  ```typescript
  fork(runId: string, opts?: { at?: number; model?: string; task?: string }): RunHandle
  // New run row: runId = `${sourceRunId}-fork-<4random>` …metadata/meta carries { forkedFrom: sourceRunId, forkedAt: iteration }
  ```

- [ ] **Step 1: Write the failing test (store + payload layers only — no live LLM)**

```typescript
// packages/runtime/tests/run-fork.test.ts
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { RunStoreLive, RunStoreService } from "../src/services/run-store.js";
import { loadForkPayload } from "../src/engine/durable-resume.js";

describe("fork payload", () => {
  test("returns the checkpoint at or below the requested iteration, ignoring config hash", async () => {
    const dbPath = `/tmp/claude-1000/fork-${Date.now()}.db`;
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* store.createRun({ runId: "src", agentId: "a", task: "t", configHash: "ORIGINAL" } as never);
        yield* store.putCheckpoint("src", 1, '{"codecVersion":1,"state":{"i":1}}');
        yield* store.putCheckpoint("src", 3, '{"codecVersion":1,"state":{"i":3}}');
        yield* store.putCheckpoint("src", 5, '{"codecVersion":1,"state":{"i":5}}');
      }).pipe(Effect.provide(RunStoreLive(dbPath))),
    );
    const payload = await Effect.runPromise(
      loadForkPayload({ runId: "src", dbPath, at: 4 }),
    );
    expect(JSON.parse(payload.stateJson).state.i).toBe(3); // highest checkpoint ≤ 4
    expect(payload.run.runId).toBe("src");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/tests/run-fork.test.ts --timeout 15000`
Expected: FAIL — `loadForkPayload` doesn't exist.

- [ ] **Step 3: Implement store + payload**

`run-store.ts` add alongside `latestCheckpoint`:

```typescript
checkpointAt: (runId: string, iteration: number) =>
  Effect.sync(() => {
    const row = db
      .query("SELECT run_id, iteration, state_json FROM run_checkpoints WHERE run_id = ? AND iteration <= ? ORDER BY iteration DESC LIMIT 1")
      .get(runId, iteration) as { run_id: string; iteration: number; state_json: string } | null;
    return row ? { runId: row.run_id, iteration: row.iteration, stateJson: row.state_json } : undefined;
  }),
```

(Match the service's existing method style — Effect wrapper, naming, undefined-on-missing like `latestCheckpoint`.)

`durable-resume.ts`:

```typescript
/** Fork payload: like resume but (a) any iteration, (b) NO config-hash guard — a fork is a deliberate counterfactual restart. */
export const loadForkPayload = (params: { readonly runId: string; readonly dbPath: string; readonly at?: number }) =>
  Effect.gen(function* () {
    const store = yield* RunStoreService;
    const run = yield* store.getRun(params.runId);
    if (!run) return yield* Effect.fail(new DurableRunNotFoundError({ runId: params.runId }));
    const checkpoint = params.at === undefined
      ? yield* store.latestCheckpoint(params.runId)
      : yield* store.checkpointAt(params.runId, params.at);
    if (!checkpoint) return yield* Effect.fail(new DurableRunNotFoundError({ runId: params.runId }));
    return { run, stateJson: checkpoint.stateJson };
  }).pipe(Effect.provide(RunStoreLive(params.dbPath)));
```

- [ ] **Step 4: Implement `agent.fork()`**

In `reactive-agent.ts`, next to the existing resume method: read its body first and mirror it — the differences: (a) payload via `loadForkPayload`; (b) fresh `runId = `${sourceRunId}-fork-${crypto.randomUUID().slice(0, 4)}``; (c) `createRun` a NEW row with the fork runId and `configHash` of the CURRENT agent (plus `task` copied from source run unless `opts.task`); (d) when `opts.model` set, apply the same model-override path the builder/routing uses for a per-run model (grep `selectedModel` in engine phases — pass through the run config the way cost-route does); (e) thread `{ forkedFrom, forkedAt }` into the run's metadata/meta so the receipt (Task 8) and `rax ps` can show lineage. Return the `RunHandle` from `runStream` exactly as resume does.

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test packages/runtime/tests/run-fork.test.ts --timeout 15000 && bunx tsc --noEmit -p packages/runtime`
Expected: PASS.

- [ ] **Step 6: Live smoke (manual)**

Script: durable+reasoning agent, run task to completion, then `agent.fork(runId, { at: 1 })` — expect a second completed run with distinct runId and `forkedFrom` in the runs table.

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/services/run-store.ts packages/runtime/src/engine/durable-resume.ts packages/runtime/src/reactive-agent.ts packages/runtime/tests/run-fork.test.ts
git commit -m "feat(runtime): agent.fork() — counterfactual restart from any checkpoint"
```

---

### Task 7: `rax ps` + `rax attach`

Process-model CLI verbs over the durable substrate. `ps` scans RunStore DBs; `attach` watches a run's status/iteration live (v1 = poll the DB; journaled-SSE attach stays the server-endpoint path).

**Files:**
- Create: `apps/cli/src/commands/ps.ts`
- Create: `apps/cli/src/commands/attach.ts`
- Modify: `apps/cli/src/index.ts:69-157` (register `ps`, `attach` in the switch + help text at :20-57)
- Test: `apps/cli/tests/ps.test.ts` (create)

**Interfaces:**
- Consumes: `listDurableRuns({ dbPath })` (`durable-resume.ts`), `RunStoreLive`; default DB discovery = glob `~/.reactive-agents/*/runs.db` (accept `--db <path>` override).
- Produces: `rax ps [--db path] [--all]` (default: non-terminal statuses; `--all` includes completed/failed), `rax attach <runId> [--db path]` (1s poll; exits when terminal).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/cli/tests/ps.test.ts
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { RunStoreLive, RunStoreService } from "@reactive-agents/runtime";
import { collectRuns } from "../src/commands/ps.js";

describe("rax ps", () => {
  test("collects runs across db paths with status filter", async () => {
    const dbPath = `/tmp/claude-1000/ps-${Date.now()}.db`;
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* store.createRun({ runId: "r-live", agentId: "a", task: "long task", configHash: "h" } as never);
        yield* store.createRun({ runId: "r-done", agentId: "a", task: "done task", configHash: "h" } as never);
        yield* store.setStatus("r-done", "completed");
      }).pipe(Effect.provide(RunStoreLive(dbPath))),
    );
    const active = await collectRuns([dbPath], { all: false });
    expect(active.map((r) => r.runId)).toEqual(["r-live"]);
    const all = await collectRuns([dbPath], { all: true });
    expect(all).toHaveLength(2);
  });
});
```

(If `RunStoreLive`/`RunStoreService` aren't exported from the runtime package root, export them — additive — or import via the deep path the CLI already uses for other runtime internals; follow existing CLI import conventions in `apps/cli/src/commands/`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/cli/tests/ps.test.ts --timeout 15000`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `ps.ts`**

```typescript
// apps/cli/src/commands/ps.ts — core testable fn + command wrapper
import { Effect } from "effect";
import { listDurableRuns } from "@reactive-agents/runtime"; // export if needed (additive)
import { globSync } from "node:fs"; // Bun supports; else use readdirSync over ~/.reactive-agents

export interface PsRow { runId: string; agentId: string; status: string; task: string; updatedAt?: string; db: string }

export async function collectRuns(dbPaths: readonly string[], opts: { all: boolean }): Promise<PsRow[]> {
  const rows: PsRow[] = [];
  for (const db of dbPaths) {
    const runs = await Effect.runPromise(listDurableRuns({ dbPath: db }));
    for (const r of runs) {
      const terminal = r.status === "completed" || r.status === "failed";
      if (!opts.all && terminal) continue;
      rows.push({ runId: r.runId, agentId: r.agentId, status: r.status, task: r.task.slice(0, 60), updatedAt: (r as { updatedAt?: string }).updatedAt, db });
    }
  }
  return rows;
}

export async function psCommand(args: string[]): Promise<void> {
  const all = args.includes("--all");
  const dbFlag = args.indexOf("--db");
  const home = process.env.HOME ?? "~";
  const paths = dbFlag >= 0
    ? [args[dbFlag + 1]]
    : globSync(`${home}/.reactive-agents/*/runs.db`);
  const rows = await collectRuns(paths, { all });
  if (rows.length === 0) { console.log("No runs."); return; }
  console.log("RUN ID          STATUS              AGENT           TASK");
  for (const r of rows) console.log(`${r.runId.padEnd(15)} ${r.status.padEnd(19)} ${r.agentId.padEnd(15)} ${r.task}`);
}
```

(Adapt the run-record field names to `RunRecord` — read `run-store.ts`. If `globSync` isn't available in the pinned Bun, use `readdirSync` + `existsSync` per directory.)

`attach.ts`: poll `getRun(runId)` (find its DB by scanning the same paths) every 1s; print status transitions + latest checkpoint iteration (`latestCheckpoint`); exit 0 on terminal status; Ctrl-C safe. Register both in `index.ts` switch and help text.

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test apps/cli/tests/ps.test.ts --timeout 15000 && bunx tsc --noEmit -p apps/cli`
Expected: PASS.

- [ ] **Step 5: Live smoke (manual)**

Terminal A: run a durable+reasoning agent script. Terminal B: `bun apps/cli/src/index.ts ps` → the run appears with `running`; `bun apps/cli/src/index.ts attach <runId>` → status transitions print; exits at `completed`.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/ps.ts apps/cli/src/commands/attach.ts apps/cli/src/index.ts apps/cli/tests/ps.test.ts
git commit -m "feat(cli): rax ps + rax attach — process-model verbs over the durable substrate"
```

---

### Task 8: `result.receipt` v1 — deterministic trust receipt on every run

Graded evidence, heuristic method, computed from in-memory run data at result assembly — NOT from the trace (works without tracing). Fixes live-probe P1's visceral gap: a developer cannot currently tell whether the answer used tools at all.

**Files:**
- Create: `packages/core/src/types/receipt.ts`
- Modify: `packages/core/src/index.ts` (export)
- Modify: `packages/runtime/src/builder/types.ts:831` region (`AgentResult` gains `readonly receipt?: TrustReceipt`)
- Modify: the result-assembly site — locate via `rtk grep -rn "goalAchieved" packages/runtime/src --include="*.ts"` (the file that constructs the final `AgentResult` object; expected in `execution-engine.ts` or `engine/finalize/`) — compute + attach the receipt there
- Test: `packages/core/tests/receipt.test.ts` (create)

**Interfaces:**
- Consumes: run steps (`state.steps[]` projections available at finalize: tool-call steps with name/ok), `terminatedBy`, verifier verdict when present, `goalAchieved`, abstention.
- Produces:

```typescript
// packages/core/src/types/receipt.ts
/**
 * TrustReceipt v1 — graded evidence about HOW an answer was produced.
 * NOT a truth certificate: `verdict` grades the run's evidence trail, not
 * the factual correctness of the output (spec 08 §4.3 honest-claims note).
 */
export interface TrustReceipt {
  /** Evidence grade for the final answer. */
  readonly verdict: "tool-grounded" | "partially-grounded" | "ungrounded" | "abstained" | "failed";
  /** How the verdict was computed. v1 ships heuristic only. */
  readonly method: "heuristic";
  /** 0..1 — confidence in the verdict itself (not in the answer). */
  readonly confidence: number;
  /** Distinct tool names with ≥1 successful substantive call. */
  readonly toolsUsed: readonly string[];
  /** Successful / total tool calls. */
  readonly toolCallStats: { readonly ok: number; readonly failed: number };
  /** Terminal reason (mirrors AgentResult.terminatedBy). */
  readonly terminatedBy?: string;
  /** Verifier verdict when the terminal verifier ran. */
  readonly verifierVerdict?: string;
  /** Fork lineage when this run was forked (Task 6). */
  readonly forkedFrom?: string;
  /** Model + config identity for provenance. */
  readonly modelId: string;
  readonly configHash?: string;
  readonly computedAt: number;
}

export function computeTrustReceipt(input: {
  readonly toolCalls: readonly { readonly name: string; readonly ok: boolean }[];
  readonly terminatedBy?: string;
  readonly verifierVerdict?: string;
  readonly goalAchieved?: boolean | null;
  readonly abstained: boolean;
  readonly success: boolean;
  readonly modelId: string;
  readonly configHash?: string;
  readonly forkedFrom?: string;
  readonly now: number;
}): TrustReceipt;
```

Verdict rules (deterministic, documented in the JSDoc):
1. `abstained` → `"abstained"` (confidence 0.95).
2. `!success` → `"failed"` (0.95).
3. ≥1 ok tool call AND `goalAchieved !== false` → `"tool-grounded"` (0.8; 0.9 when `verifierVerdict === "pass"`).
4. ≥1 tool call but none ok → `"partially-grounded"` (0.6).
5. zero tool calls → `"ungrounded"` (0.8) — the model answered from itself; fine for pure-knowledge tasks, and now VISIBLE.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/tests/receipt.test.ts
import { describe, test, expect } from "bun:test";
import { computeTrustReceipt } from "../src/types/receipt.js";

const base = { terminatedBy: "final_answer_tool", goalAchieved: true, abstained: false, success: true, modelId: "qwen3:4b", now: 1000 };

describe("computeTrustReceipt", () => {
  test("tool-grounded when a substantive call succeeded", () => {
    const r = computeTrustReceipt({ ...base, toolCalls: [{ name: "calculator", ok: true }] });
    expect(r.verdict).toBe("tool-grounded");
    expect(r.toolsUsed).toEqual(["calculator"]);
    expect(r.toolCallStats).toEqual({ ok: 1, failed: 0 });
  });
  test("ungrounded when zero tool calls", () => {
    const r = computeTrustReceipt({ ...base, toolCalls: [] });
    expect(r.verdict).toBe("ungrounded");
  });
  test("partially-grounded when all calls failed", () => {
    const r = computeTrustReceipt({ ...base, toolCalls: [{ name: "web", ok: false }] });
    expect(r.verdict).toBe("partially-grounded");
  });
  test("abstained wins over everything", () => {
    const r = computeTrustReceipt({ ...base, abstained: true, toolCalls: [{ name: "x", ok: true }] });
    expect(r.verdict).toBe("abstained");
  });
  test("verifier pass raises confidence", () => {
    const r = computeTrustReceipt({ ...base, verifierVerdict: "pass", toolCalls: [{ name: "calculator", ok: true }] });
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/tests/receipt.test.ts --timeout 15000`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `receipt.ts`** (pure function per the rules above; dedupe `toolsUsed` preserving order; export type + fn from core index).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/tests/receipt.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 5: Wire at result assembly**

At the located assembly site: derive `toolCalls` from the run's step/tool records already in scope (grep how `metadata.stepsCount`/`toolsUsed`-adjacent data is computed there; the execution path tracks tool executions — map to `{name, ok}`), `abstained = terminatedBy === "abstained"`, `modelId` from the run config, `forkedFrom` from run meta (Task 6). Attach `receipt` to the returned `AgentResult`. IMPORTANT: pass `now: Date.now()` from the caller (pure fn stays testable). Also emit the UI protocol's reserved `TrustEvent` tag on the stream path with `{verdict, confidence}` — additive `_tag: "TrustEvent"` alongside `StreamCompleted` (see `packages/ui-core/src/protocol/events.ts:145-163` reserved block; add the emit in the runtime stream finalization where `StreamCompleted` is built).

Add an integration assertion to an EXISTING runtime result test (grep `goalAchieved` in `packages/runtime/tests`) — extend one test with `expect(result.receipt?.verdict).toBeDefined()` on the test-provider path.

- [ ] **Step 6: Run suites + typecheck**

Run: `bun test packages/core packages/runtime --timeout 15000 && bunx tsc --noEmit -p packages/core -p packages/runtime`
Expected: PASS (pre-existing failures only).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/types/receipt.ts packages/core/src/index.ts packages/core/tests/receipt.test.ts packages/runtime/src
git commit -m "feat(core,runtime): result.receipt v1 — deterministic trust receipt on every run"
```

---

### Task 9: Receipt provenance signature (Ed25519, optional)

Sign the canonical receipt JSON so downstream consumers can verify provenance/integrity. Signature certifies "this receipt, this run, untampered" — NEVER correctness (JSDoc must say this). Dormant `CertificateAuth` Ed25519 code goes live.

**Files:**
- Modify: `packages/core/src/types/receipt.ts` (add `readonly signature?: { readonly alg: "ed25519"; readonly publicKey: string; readonly sig: string }`)
- Create: `packages/runtime/src/receipt-signing.ts` (WebCrypto Ed25519 — mirror `packages/identity/src/auth/certificate-auth.ts:140-209` key handling; runtime-local to avoid an identity-package hard dependency)
- Modify: result-assembly site (sign when a key is configured)
- Test: `packages/runtime/tests/receipt-signing.test.ts` (create)

**Interfaces:**
- Produces: `signReceipt(receipt: TrustReceipt, privateKeyJwk: JsonWebKey): Promise<TrustReceipt>` (returns receipt + signature over `stableStringify` of the receipt minus `signature`), `verifyReceipt(receipt: TrustReceipt): Promise<boolean>`. Key source: builder option `.withReceiptSigning({ privateKeyJwk })` OR env `RA_RECEIPT_KEY` (JWK JSON) — absent → unsigned receipt (normal default).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/runtime/tests/receipt-signing.test.ts
import { describe, test, expect } from "bun:test";
import { computeTrustReceipt } from "@reactive-agents/core";
import { generateReceiptKeyPair, signReceipt, verifyReceipt } from "../src/receipt-signing.js";

describe("receipt signing", () => {
  test("sign → verify roundtrip; tamper breaks", async () => {
    const { privateKeyJwk } = await generateReceiptKeyPair();
    const receipt = computeTrustReceipt({ toolCalls: [{ name: "calc", ok: true }], abstained: false, success: true, modelId: "m", now: 1, goalAchieved: true });
    const signed = await signReceipt(receipt, privateKeyJwk);
    expect(signed.signature?.alg).toBe("ed25519");
    expect(await verifyReceipt(signed)).toBe(true);
    const tampered = { ...signed, verdict: "tool-grounded" as const, toolsUsed: ["fake"] };
    expect(await verifyReceipt(tampered)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `bun test packages/runtime/tests/receipt-signing.test.ts --timeout 15000` → FAIL.

- [ ] **Step 3: Implement** — `crypto.subtle.generateKey({name:"Ed25519"}, true, ["sign","verify"])`, export JWKs; canonical bytes = UTF-8 of stable-stringified receipt without `signature`; base64url sig + embedded public JWK string. Wire into assembly: if key configured (builder option or env), `receipt = await signReceipt(receipt, key)` — the assembly site is already async or wrap with the existing effect machinery there.

- [ ] **Step 4: Run + typecheck** — `bun test packages/runtime --timeout 15000 && bunx tsc --noEmit -p packages/runtime` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types/receipt.ts packages/runtime/src/receipt-signing.ts packages/runtime/tests/receipt-signing.test.ts packages/runtime/src
git commit -m "feat(runtime): optional Ed25519 provenance signature on trust receipts"
```

---

### Task 10: The 90-second demo + docs

The launch-gate demo path, scripted and documented. Everything from Tasks 1-9 composed: run → ps → attach → pause → inspect → fork → receipt.

**Files:**
- Create: `apps/examples/src/advanced/process-model-demo.ts` (registered in examples index per existing pattern)
- Create: `apps/docs/src/content/docs/features/process-model.md` (sidebar-registered in `astro.config.mjs`)
- Modify: `README.md` (short "Agents are processes" section with the demo snippet + receipt snippet; honest-claims wording)
- Test: examples COVERAGE registration only (live-Ollama demo — not CI)

**Interfaces:** consumes everything above; produces the launch demo.

- [ ] **Step 1: Write the demo script** — durable+reasoning agent on Ollama; phase 1 run with deliberate multi-step task; concurrently print `handle.inspect()` twice; complete; print `result.receipt`; then `agent.fork(runId, { at: 1 })`, await, print both outputs + `forkedFrom`. Guard: skip gracefully when Ollama unreachable (exit 0 with notice — matches examples conventions).

- [ ] **Step 2: Run it** — `bun apps/examples/src/advanced/process-model-demo.ts` → full sequence prints; receipt verdict `tool-grounded`; fork completes with lineage.

- [ ] **Step 3: Write the docs page** — sections: The process model (inspect/pause/fork + honest fork scoping "counterfactual restart, not time-travel"), The receipt (verdict table from Task 8 JSDoc, "graded evidence, not a truth certificate"), CLI (`rax ps/attach`), exact-replay (`makeReplayLLMLayer` + zero-token caveat "exact-replay only").

- [ ] **Step 4: README section** — 20 lines max, code-first, links to docs page.

- [ ] **Step 5: Docs build check** — `cd apps/docs && bun run build` → green, links valid.

- [ ] **Step 6: Commit**

```bash
git add apps/examples/src/advanced/process-model-demo.ts apps/docs README.md
git commit -m "docs: process-model demo + receipt/fork/replay documentation"
```

---

## Final gate (whole-plan)

- [ ] `bunx turbo run build` — all packages green (authoritative over tsc, memory: ignoreDeprecations).
- [ ] `bun test` keyless from repo root with `.env` moved aside (`mv .env /tmp/claude-1000/.env.bak && bun test; mv /tmp/claude-1000/.env.bak .env`) — CI-parity check (memory: CI has no keys/Ollama).
- [ ] `scripts/check-termination-paths.sh` — single-owner invariant intact.
- [ ] Live smoke: demo script end-to-end on Ollama.
- [ ] Launch-gate checklist vs spec §10: capture ✓ (T1-3), inspect+ps/attach ✓ (T5,7), fork v1 ✓ (T6), receipt v1 ✓ (T8-9). Item 5 (bench receipts) tracked in the public-competitor-bench thread.
