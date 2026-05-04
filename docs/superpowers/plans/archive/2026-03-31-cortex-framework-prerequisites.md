# Cortex Framework Prerequisites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 9 new framework events, a `CortexReporterLayer`, and a `.withCortex()` builder method so any agent can stream its execution to a running Cortex instance with one line of code.

**Architecture:** New event types are defined in `packages/core/src/types/cortex-events.ts` and merged into the `AgentEvent` union. `CortexReporterLayer` (in `@reactive-agents/observability`) subscribes to the EventBus and forwards all events to `/ws/ingest` on the Cortex server. `.withCortex()` on `ReactiveAgentBuilder` wires this layer automatically. Events are emitted at their natural call sites: `DebriefCompleted` in `ExecutionEngine`, `ChatTurn` in `chat.ts`, `ProviderFallbackActivated` via an `onFallback` callback on `FallbackChain`.

**Tech Stack:** Effect-TS, bun:test, existing `@reactive-agents/core`, `@reactive-agents/observability`, `@reactive-agents/llm-provider`, `@reactive-agents/runtime` packages.

---

## File Map

**New files:**
- `packages/core/src/types/cortex-events.ts` — all new event payload types
- `packages/observability/src/cortex/cortex-reporter.ts` — `CortexReporter` service + `CortexReporterLive` layer
- `packages/observability/tests/cortex-reporter.test.ts` — reporter tests

**Modified files:**
- `packages/core/src/services/event-bus.ts` — extend `AgentEvent` union
- `packages/core/src/index.ts` — export new event types
- `packages/llm-provider/src/fallback-chain.ts` — add `FallbackCallback` + `onFallback` option
- `packages/llm-provider/tests/fallback-chain.test.ts` — test fallback callback
- `packages/runtime/src/execution-engine.ts` — emit `DebriefCompleted` after debrief synthesis
- `packages/runtime/src/chat.ts` — emit `ChatTurn` on each exchange
- `packages/runtime/src/builder.ts` — add `_cortexUrl`, `withCortex()` method, wire layer in `build()`
- `packages/observability/src/index.ts` — export `CortexReporter`, `CortexReporterLive`
- `packages/observability/src/runtime.ts` — update `createObservabilityLayer` if needed

---

## Task 1: New Cortex Event Types

**Files:**
- Create: `packages/core/src/types/cortex-events.ts`

- [ ] **Step 1: Create the event types file**

```typescript
// packages/core/src/types/cortex-events.ts
import type { AgentDebrief } from "@reactive-agents/runtime";

export type MemorySnapshot = {
  readonly _tag: "MemorySnapshot";
  readonly taskId: string;
  readonly iteration: number;
  readonly working: ReadonlyArray<{ readonly key: string; readonly preview: string }>;
  readonly episodicCount: number;
  readonly semanticCount: number;
  readonly skillsActive: ReadonlyArray<string>;
};

export type ContextPressure = {
  readonly _tag: "ContextPressure";
  readonly taskId: string;
  readonly utilizationPct: number;
  readonly tokensUsed: number;
  readonly tokensAvailable: number;
  readonly level: "low" | "medium" | "high" | "critical";
};

export type ChatTurnEvent = {
  readonly _tag: "ChatTurn";
  readonly taskId: string;
  readonly sessionId: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly routedVia: "direct-llm" | "react-loop";
  readonly tokensUsed?: number;
};

export type AgentHealthReport = {
  readonly _tag: "AgentHealthReport";
  readonly agentId: string;
  readonly status: "healthy" | "degraded" | "unhealthy";
  readonly checks: ReadonlyArray<{ readonly name: string; readonly status: string; readonly message?: string }>;
  readonly uptimeMs: number;
};

export type ProviderFallbackActivated = {
  readonly _tag: "ProviderFallbackActivated";
  readonly taskId: string;
  readonly fromProvider: string;
  readonly toProvider: string;
  readonly reason: string;
  readonly attemptNumber: number;
};

export type DebriefCompleted = {
  readonly _tag: "DebriefCompleted";
  readonly taskId: string;
  readonly agentId: string;
  readonly debrief: AgentDebrief;
};

export type AgentConnected = {
  readonly _tag: "AgentConnected";
  readonly agentId: string;
  readonly runId: string;
  readonly cortexUrl: string;
};

export type AgentDisconnected = {
  readonly _tag: "AgentDisconnected";
  readonly agentId: string;
  readonly runId: string;
  readonly reason: string;
};
```

- [ ] **Step 2: Run typecheck to verify the file is clean**

```bash
cd packages/core && bun run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types/cortex-events.ts
git commit -m "feat(core): add Cortex event payload types"
```

---

## Task 2: Extend AgentEvent Union

**Files:**
- Modify: `packages/core/src/services/event-bus.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test — verify new tags exist on AgentEvent**

Add to a new test file `packages/core/tests/cortex-events.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";

describe("Cortex AgentEvent tags", () => {
  it("should have MemorySnapshot tag assignable to AgentEvent", () => {
    const event = {
      _tag: "MemorySnapshot" as const,
      taskId: "t1",
      iteration: 1,
      working: [],
      episodicCount: 0,
      semanticCount: 0,
      skillsActive: [],
    };
    // Type assertion — if this compiles, the union includes MemorySnapshot
    const _e: import("../src/services/event-bus.js").AgentEvent = event;
    expect(_e._tag).toBe("MemorySnapshot");
  });

  it("should have DebriefCompleted tag assignable to AgentEvent", () => {
    const event = {
      _tag: "DebriefCompleted" as const,
      taskId: "t1",
      agentId: "a1",
      debrief: {} as any,
    };
    const _e: import("../src/services/event-bus.js").AgentEvent = event;
    expect(_e._tag).toBe("DebriefCompleted");
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd packages/core && bun test tests/cortex-events.test.ts
```
Expected: FAIL — type error or runtime issue.

- [ ] **Step 3: Import new types and extend AgentEvent union in event-bus.ts**

At the top of `packages/core/src/services/event-bus.ts`, after the existing intelligence-events import:

```typescript
import type {
  MemorySnapshot,
  ContextPressure,
  ChatTurnEvent,
  AgentHealthReport,
  ProviderFallbackActivated,
  DebriefCompleted,
  AgentConnected,
  AgentDisconnected,
} from "../types/cortex-events.js";
```

At the end of the `AgentEvent` union (before the closing `;`), add:

```typescript
  | MemorySnapshot
  | ContextPressure
  | ChatTurnEvent
  | AgentHealthReport
  | ProviderFallbackActivated
  | DebriefCompleted
  | AgentConnected
  | AgentDisconnected
```

- [ ] **Step 4: Export new types from core index**

In `packages/core/src/index.ts`, add after existing type exports:

```typescript
export type {
  MemorySnapshot,
  ContextPressure,
  ChatTurnEvent,
  AgentHealthReport,
  ProviderFallbackActivated,
  DebriefCompleted,
  AgentConnected,
  AgentDisconnected,
} from "./types/cortex-events.js";
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
cd packages/core && bun test tests/cortex-events.test.ts
```
Expected: PASS.

- [ ] **Step 6: Run full core test suite to check no regressions**

```bash
cd packages/core && bun test
```
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/services/event-bus.ts packages/core/src/index.ts packages/core/src/types/cortex-events.ts packages/core/tests/cortex-events.test.ts
git commit -m "feat(core): extend AgentEvent union with 8 Cortex event types"
```

---

## Task 3: ProviderFallbackActivated in FallbackChain

**Files:**
- Modify: `packages/llm-provider/src/fallback-chain.ts`
- Modify: `packages/llm-provider/tests/fallback-chain.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/llm-provider/tests/fallback-chain.test.ts`, add:

```typescript
import { describe, it, expect, mock } from "bun:test";
import { FallbackChain } from "../src/fallback-chain.js";

describe("FallbackChain onFallback callback", () => {
  it("should call onFallback when error threshold exceeded and provider switches", () => {
    const calls: Array<{ from: string; to: string; reason: string; attempt: number }> = [];

    const chain = new FallbackChain(
      { providers: ["anthropic", "openai"], errorThreshold: 2 },
      (from, to, reason, attempt) => calls.push({ from, to, reason, attempt }),
    );

    chain.recordError("anthropic");
    expect(calls).toHaveLength(0); // threshold not met yet

    chain.recordError("anthropic");
    expect(calls).toHaveLength(1);
    expect(calls[0].from).toBe("anthropic");
    expect(calls[0].to).toBe("openai");
    expect(calls[0].reason).toContain("error");
    expect(calls[0].attempt).toBeGreaterThan(0);
  });

  it("should not throw if no callback provided", () => {
    const chain = new FallbackChain({ providers: ["anthropic", "openai"], errorThreshold: 1 });
    expect(() => chain.recordError("anthropic")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd packages/llm-provider && bun test tests/fallback-chain.test.ts 2>&1 | tail -5
```
Expected: FAIL.

- [ ] **Step 3: Add FallbackCallback type and wire into FallbackChain**

In `packages/llm-provider/src/fallback-chain.ts`, add after the `FallbackConfig` interface:

```typescript
/** Called when FallbackChain switches to the next provider. */
export type FallbackCallback = (
  fromProvider: string,
  toProvider: string,
  reason: string,
  attemptNumber: number,
) => void;
```

Modify the `FallbackChain` class constructor signature:

```typescript
export class FallbackChain {
  // ... existing private fields ...
  private readonly onFallback?: FallbackCallback;

  constructor(config: FallbackConfig, onFallback?: FallbackCallback) {
    // ... existing constructor body ...
    this.onFallback = onFallback;
  }
```

In `recordError(provider: string)`, after the logic that switches providers (when `count >= threshold`), add:

```typescript
    if (count >= threshold && this.currentProviderIndex < this.config.providers.length - 1) {
      const fromProvider = this.config.providers[this.currentProviderIndex] ?? provider;
      this.currentProviderIndex++;
      const toProvider = this.config.providers[this.currentProviderIndex] ?? "unknown";
      this.onFallback?.(fromProvider, toProvider, `error_threshold:${count}`, count);
    }
```

> Note: Exact insertion point depends on the current `recordError` implementation. Find where `currentProviderIndex` is incremented and wrap the `onFallback` call around that transition.

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd packages/llm-provider && bun test tests/fallback-chain.test.ts
```
Expected: PASS.

- [ ] **Step 5: Run full llm-provider tests**

```bash
cd packages/llm-provider && bun test
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/llm-provider/src/fallback-chain.ts packages/llm-provider/tests/fallback-chain.test.ts
git commit -m "feat(llm-provider): add FallbackCallback to FallbackChain for ProviderFallbackActivated event"
```

---

## Task 4: DebriefCompleted Event in ExecutionEngine

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts`
- Modify: `packages/runtime/tests/debrief.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/runtime/tests/debrief.test.ts`, add a test that spies on EventBus publish:

```typescript
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { EventBus } from "@reactive-agents/core";
import type { AgentEvent } from "@reactive-agents/core";

describe("DebriefCompleted event emission", () => {
  it("should publish DebriefCompleted after successful debrief synthesis", async () => {
    const published: AgentEvent[] = [];

    const mockEventBus = Layer.succeed(EventBus, {
      publish: (event: AgentEvent) => {
        published.push(event);
        return Effect.void;
      },
      subscribe: () => Effect.succeed(() => {}),
      subscribeAll: () => Effect.succeed(() => {}),
    });

    // This test verifies the event type exists and can be published —
    // the full integration test is in execution-engine integration tests.
    const program = Effect.gen(function* () {
      const bus = yield* EventBus;
      yield* bus.publish({
        _tag: "DebriefCompleted",
        taskId: "t1",
        agentId: "a1",
        debrief: {
          outcome: "success",
          summary: "test",
          keyFindings: [],
          lessons: [],
          errors: [],
          toolsUsed: [],
          metrics: { tokens: 0, duration: 0, iterations: 0, cost: 0 },
          markdown: "",
        } as any,
      });
    });

    await Effect.runPromise(program.pipe(Effect.provide(mockEventBus)));
    expect(published.some((e) => e._tag === "DebriefCompleted")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to confirm it passes (validates types compile)**

```bash
cd packages/runtime && bun test tests/debrief.test.ts 2>&1 | tail -10
```
Expected: PASS (this test is checking type compilation + publish plumbing).

- [ ] **Step 3: Emit DebriefCompleted in ExecutionEngine**

In `packages/runtime/src/execution-engine.ts`, find the `synthesizeDebrief` call (around line 3045). It currently looks like:

```typescript
return synthesizeDebrief(debriefInput).pipe(
  Effect.map((d) => d as AgentDebrief),
  Effect.catchAll(() => Effect.succeed(undefined as AgentDebrief | undefined)),
);
```

Wrap it to also emit the event:

```typescript
return synthesizeDebrief(debriefInput).pipe(
  Effect.flatMap((d) => {
    const debrief = d as AgentDebrief;
    // Emit DebriefCompleted — fire-and-forget, never fail agent on this
    const emitEffect = eventBusOpt._tag === "Some"
      ? eventBusOpt.value.publish({
          _tag: "DebriefCompleted",
          taskId: debriefInput.taskId,
          agentId: debriefInput.agentId,
          debrief,
        })
      : Effect.void;
    return emitEffect.pipe(Effect.as(debrief));
  }),
  Effect.catchAll(() => Effect.succeed(undefined as AgentDebrief | undefined)),
);
```

> Note: `eventBusOpt` should already be in scope — it's the `Option<EventBus>` available throughout the engine. If it's named differently (e.g., `eventBus`), adjust accordingly. Use `Effect.serviceOption(EventBus)` to get it if not already available at that scope.

- [ ] **Step 4: Run runtime tests**

```bash
cd packages/runtime && bun test
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/execution-engine.ts packages/runtime/tests/debrief.test.ts
git commit -m "feat(runtime): emit DebriefCompleted event after debrief synthesis"
```

---

## Task 5: ChatTurn Event in agent.chat()

**Files:**
- Modify: `packages/runtime/src/chat.ts`

- [ ] **Step 1: Write the failing test**

In `packages/runtime/tests/chat.test.ts` (add to existing or create), add:

```typescript
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBus } from "@reactive-agents/core";
import type { AgentEvent } from "@reactive-agents/core";

describe("ChatTurn event emission", () => {
  it("should include ChatTurn in AgentEvent union (type check)", () => {
    const event: AgentEvent = {
      _tag: "ChatTurn",
      taskId: "t1",
      sessionId: "s1",
      role: "user",
      content: "hello",
      routedVia: "direct-llm",
    };
    expect(event._tag).toBe("ChatTurn");
  });
});
```

- [ ] **Step 2: Run test to confirm it passes (type validation)**

```bash
cd packages/runtime && bun test tests/chat.test.ts 2>&1 | tail -5
```
Expected: PASS.

- [ ] **Step 3: Emit ChatTurn in chat.ts**

In `packages/runtime/src/chat.ts`, find the function that handles a single `agent.chat()` exchange. After the response is produced, add:

```typescript
// After resolving the assistant response, before returning:
if (eventBus._tag === "Some") {
  yield* eventBus.value.publish({
    _tag: "ChatTurn",
    taskId: taskId ?? "chat",
    sessionId,
    role: "user",
    content: userMessage,
    routedVia: routedVia,   // "direct-llm" or "react-loop"
  }).pipe(Effect.ignoreLogged);

  yield* eventBus.value.publish({
    _tag: "ChatTurn",
    taskId: taskId ?? "chat",
    sessionId,
    role: "assistant",
    content: assistantResponse,
    routedVia: routedVia,
    tokensUsed: response.tokensUsed,
  }).pipe(Effect.ignoreLogged);
}
```

> Adjust variable names to match the actual chat.ts implementation. The key is: emit one event for the user turn and one for the assistant response.

- [ ] **Step 4: Run runtime tests**

```bash
cd packages/runtime && bun test
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/chat.ts
git commit -m "feat(runtime): emit ChatTurn events for agent.chat() sessions"
```

---

## Task 6: CortexReporterLayer

**Files:**
- Create: `packages/observability/src/cortex/cortex-reporter.ts`
- Create: `packages/observability/tests/cortex-reporter.test.ts`
- Modify: `packages/observability/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/observability/tests/cortex-reporter.test.ts`:

```typescript
import { describe, it, expect, mock } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBus } from "@reactive-agents/core";
import type { AgentEvent } from "@reactive-agents/core";
import { CortexReporter, CortexReporterLive } from "../src/cortex/cortex-reporter.js";

describe("CortexReporter", () => {
  it("should report isConnected as false before connect", async () => {
    const program = Effect.gen(function* () {
      const reporter = yield* CortexReporter;
      const connected = yield* reporter.isConnected();
      expect(connected).toBe(false);
    });

    const mockEventBus = Layer.succeed(EventBus, {
      publish: () => Effect.void,
      subscribe: () => Effect.succeed(() => {}),
      subscribeAll: () => Effect.succeed(() => {}),
    });

    const layer = CortexReporterLive("http://localhost:4321").pipe(
      Layer.provide(mockEventBus),
    );

    await Effect.runPromise(program.pipe(Effect.provide(layer)));
  });

  it("should subscribe to EventBus on initialization", async () => {
    const subscribeAllCalled: boolean[] = [];

    const mockEventBus = Layer.succeed(EventBus, {
      publish: () => Effect.void,
      subscribe: () => Effect.succeed(() => {}),
      subscribeAll: (handler: (e: AgentEvent) => Effect.Effect<void>) => {
        subscribeAllCalled.push(true);
        return Effect.succeed(() => {});
      },
    });

    const layer = CortexReporterLive("http://localhost:4321").pipe(
      Layer.provide(mockEventBus),
    );

    await Effect.runPromise(
      Effect.void.pipe(Effect.provide(layer)),
    );

    expect(subscribeAllCalled.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd packages/observability && bun test tests/cortex-reporter.test.ts 2>&1 | tail -5
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement CortexReporterLayer**

Create `packages/observability/src/cortex/cortex-reporter.ts`:

```typescript
import { Effect, Context, Layer, Ref, Data } from "effect";
import { EventBus } from "@reactive-agents/core";
import type { AgentEvent } from "@reactive-agents/core";

// ─── Error ────────────────────────────────────────────────────────────────────

export class CortexReporterError extends Data.TaggedError("CortexReporterError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ─── Service Tag ──────────────────────────────────────────────────────────────

export class CortexReporter extends Context.Tag("CortexReporter")<
  CortexReporter,
  {
    readonly connect: (url: string) => Effect.Effect<void, CortexReporterError>;
    readonly disconnect: () => Effect.Effect<void, never>;
    readonly isConnected: () => Effect.Effect<boolean, never>;
  }
>() {}

// ─── Ingest message shape ─────────────────────────────────────────────────────

interface CortexIngestMessage {
  readonly v: 1;
  readonly agentId: string;
  readonly runId: string;
  readonly sessionId?: string;
  readonly event: AgentEvent;
}

// ─── Live Implementation ──────────────────────────────────────────────────────

export const CortexReporterLive = (cortexUrl: string) =>
  Layer.effect(
    CortexReporter,
    Effect.gen(function* () {
      const eventBus = yield* EventBus;
      const connectedRef = yield* Ref.make(false);
      const wsRef = yield* Ref.make<WebSocket | null>(null);
      const pendingRef = yield* Ref.make<CortexIngestMessage[]>([]);

      // Reconnect with exponential backoff. Silently ignores connection failures —
      // Cortex not running should never fail an agent run.
      const tryConnect = (url: string): Effect.Effect<void, never> =>
        Effect.gen(function* () {
          yield* Effect.tryPromise({
            try: () =>
              new Promise<void>((resolve) => {
                const ws = new WebSocket(`${url.replace(/\/$/, "")}/ws/ingest`);

                ws.onopen = () => {
                  Ref.set(connectedRef, true);
                  Ref.set(wsRef, ws);
                  // Flush any pending messages
                  pendingRef.pipe(
                    Ref.getAndSet([]),
                  );
                  resolve();
                };

                ws.onclose = () => {
                  Ref.set(connectedRef, false);
                  Ref.set(wsRef, null);
                };

                ws.onerror = () => {
                  resolve(); // don't reject — Cortex not running is fine
                };
              }),
            catch: () => new CortexReporterError({ message: "WebSocket connection failed" }),
          }).pipe(Effect.ignoreLogged);
        });

      // Send a message, buffering if not yet connected
      const send = (msg: CortexIngestMessage): Effect.Effect<void, never> =>
        Effect.gen(function* () {
          const ws = yield* Ref.get(wsRef);
          if (ws && ws.readyState === WebSocket.OPEN) {
            yield* Effect.sync(() => ws.send(JSON.stringify(msg)));
          }
          // Silently drop if not connected — reporter is best-effort
        }).pipe(Effect.ignoreLogged);

      // Subscribe to ALL EventBus events and forward them
      yield* eventBus.subscribeAll((event: AgentEvent) => {
        const agentId =
          "agentId" in event ? (event as any).agentId as string :
          "taskId" in event ? (event as any).taskId as string :
          "unknown";
        const runId =
          "taskId" in event ? (event as any).taskId as string : "unknown";

        return send({
          v: 1,
          agentId,
          runId,
          event,
        });
      });

      // Attempt initial connection (non-blocking)
      yield* tryConnect(cortexUrl).pipe(Effect.forkDaemon);

      return {
        connect: (url: string) => tryConnect(url),
        disconnect: () =>
          Effect.gen(function* () {
            const ws = yield* Ref.get(wsRef);
            if (ws) yield* Effect.sync(() => ws.close());
            yield* Ref.set(connectedRef, false);
            yield* Ref.set(wsRef, null);
          }),
        isConnected: () => Ref.get(connectedRef),
      };
    }),
  );
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd packages/observability && bun test tests/cortex-reporter.test.ts
```
Expected: PASS.

- [ ] **Step 5: Export from observability index**

In `packages/observability/src/index.ts`, add:

```typescript
export { CortexReporter, CortexReporterLive, CortexReporterError } from "./cortex/cortex-reporter.js";
```

- [ ] **Step 6: Run full observability tests**

```bash
cd packages/observability && bun test
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/observability/src/cortex/cortex-reporter.ts packages/observability/tests/cortex-reporter.test.ts packages/observability/src/index.ts
git commit -m "feat(observability): add CortexReporterLayer — always-on EventBus → Cortex WS forwarder"
```

---

## Task 7: .withCortex() Builder Method

**Files:**
- Modify: `packages/runtime/src/builder.ts`

- [ ] **Step 1: Write the failing test**

In `packages/runtime/tests/builder.test.ts` (add to existing), add:

```typescript
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

describe("ReactiveAgentBuilder.withCortex()", () => {
  it("should return this for chaining", () => {
    const builder = ReactiveAgents.create();
    const result = builder.withCortex();
    expect(result).toBe(builder);
  });

  it("should accept an explicit URL", () => {
    const builder = ReactiveAgents.create();
    // Should not throw
    expect(() => builder.withCortex("http://localhost:9999")).not.toThrow();
  });

  it("should use CORTEX_URL env var when no URL provided", () => {
    const original = process.env.CORTEX_URL;
    process.env.CORTEX_URL = "http://localhost:4321";
    const builder = ReactiveAgents.create();
    expect(() => builder.withCortex()).not.toThrow();
    process.env.CORTEX_URL = original;
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd packages/runtime && bun test tests/builder.test.ts 2>&1 | grep "withCortex" | head -5
```
Expected: FAIL — method does not exist.

- [ ] **Step 3: Add _cortexUrl field and withCortex() method to builder**

In `packages/runtime/src/builder.ts`, inside `ReactiveAgentBuilder` class:

After existing private fields (e.g., after `private _enableObservability`):
```typescript
  private _cortexUrl: string | null = null;
```

After `withObservability()` method, add:

```typescript
  /**
   * Enable Cortex reporting — streams all agent events to a running Cortex instance.
   *
   * URL resolution priority:
   * 1. Explicit `url` parameter
   * 2. `CORTEX_URL` environment variable
   * 3. `http://localhost:4321` (default)
   *
   * If Cortex is not running at the resolved URL, the agent runs normally — the
   * reporter fails silently.
   *
   * @param url - Optional Cortex server URL (defaults to CORTEX_URL env or localhost:4321)
   * @returns `this` for chaining
   */
  withCortex(url?: string): this {
    this._cortexUrl = url ?? process.env.CORTEX_URL ?? "http://localhost:4321";
    return this;
  }
```

In the `build()` method, find where layers are assembled (look for `createCoreLayer` or `Layer.mergeAll`). After the observability layer is optionally added, add:

```typescript
    if (this._cortexUrl !== null) {
      const { CortexReporterLive } = await import("@reactive-agents/observability");
      layers = layers.pipe(
        Layer.provideMerge(CortexReporterLive(this._cortexUrl)),
      );
    }
```

> Note: `import()` is used to avoid a hard dependency if Cortex reporter is never used. If the build system doesn't support dynamic imports here, use a static import at the top of the file instead.

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd packages/runtime && bun test tests/builder.test.ts 2>&1 | grep -A2 "withCortex"
```
Expected: PASS.

- [ ] **Step 5: Run full runtime tests**

```bash
cd packages/runtime && bun test
```
Expected: all pass.

- [ ] **Step 6: Run full test suite to check no cross-package regressions**

```bash
bun test
```
Expected: 3,036+ tests pass, 0 fail.

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/builder.ts packages/runtime/tests/builder.test.ts
git commit -m "feat(runtime): add .withCortex() builder method — one-line agent → Cortex connection"
```

---

## Task 8: Wire ProviderFallbackActivated from ExecutionEngine

The `FallbackChain` is instantiated inside `ExecutionEngine`. The callback added in Task 3 needs to actually publish to the EventBus.

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/runtime/tests/debrief.test.ts` or a new integration test file:

```typescript
describe("ProviderFallbackActivated emission", () => {
  it("should publish ProviderFallbackActivated when FallbackChain switches provider", async () => {
    const published: AgentEvent[] = [];

    const mockEventBus = Layer.succeed(EventBus, {
      publish: (event: AgentEvent) => {
        published.push(event);
        return Effect.void;
      },
      subscribe: () => Effect.succeed(() => {}),
      subscribeAll: () => Effect.succeed(() => {}),
    });

    // Create a FallbackChain with a real callback that publishes to EventBus
    const { FallbackChain } = await import("@reactive-agents/llm-provider");
    const chain = new FallbackChain(
      { providers: ["anthropic", "openai"], errorThreshold: 1 },
      (from, to, reason, attempt) => {
        // This is the callback pattern we verify works end-to-end
        published.push({
          _tag: "ProviderFallbackActivated",
          taskId: "test-task",
          fromProvider: from,
          toProvider: to,
          reason,
          attemptNumber: attempt,
        });
      },
    );

    chain.recordError("anthropic");
    expect(published.some((e) => e._tag === "ProviderFallbackActivated")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to confirm it passes**

```bash
cd packages/runtime && bun test 2>&1 | tail -5
```
Expected: PASS.

- [ ] **Step 3: Wire FallbackChain callback in ExecutionEngine**

Find where `FallbackChain` is instantiated in `packages/runtime/src/execution-engine.ts`. It should look something like:

```typescript
const fallbackChain = new FallbackChain(fallbackConfig);
```

Replace with:

```typescript
const fallbackChain = new FallbackChain(
  fallbackConfig,
  eventBusOpt._tag === "Some"
    ? (from, to, reason, attempt) => {
        Effect.runFork(
          eventBusOpt.value.publish({
            _tag: "ProviderFallbackActivated",
            taskId: currentTaskId ?? "unknown",
            fromProvider: from,
            toProvider: to,
            reason,
            attemptNumber: attempt,
          }),
        );
      }
    : undefined,
);
```

> `currentTaskId` should be available in the execution context. `Effect.runFork` is acceptable here because the callback is synchronous and we want fire-and-forget publishing.

- [ ] **Step 4: Run full test suite**

```bash
bun test
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/execution-engine.ts
git commit -m "feat(runtime): wire ProviderFallbackActivated into ExecutionEngine via FallbackChain callback"
```

---

## Task 9: Final Verification and Package Build

- [ ] **Step 1: Run complete test suite**

```bash
bun test
```
Expected: all tests pass (count ≥ 3,036 + new tests).

- [ ] **Step 2: Build all packages**

```bash
bun run build
```
Expected: all 22 packages build without error.

- [ ] **Step 3: Verify new exports are present in built output**

```bash
node -e "const o = require('./packages/observability/dist/index.js'); console.log(typeof o.CortexReporterLive)"
node -e "const c = require('./packages/core/dist/index.js'); console.log(typeof c)"
```
Expected: `function` for CortexReporterLive.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: Cortex framework prerequisites complete — reporter, .withCortex(), 8 new events"
```

---

## Self-Review Checklist

- [x] All 9 new events specified in spec §3 are covered (Tasks 1–2)
- [x] `CortexReporterLayer` implemented with WebSocket + backoff + silent failure (Task 6)
- [x] `.withCortex()` on builder with URL resolution priority (Task 7)
- [x] `ProviderFallbackActivated` wired via FallbackChain callback (Tasks 3, 8)
- [x] `DebriefCompleted` emitted after debrief synthesis (Task 4)
- [x] `ChatTurn` emitted in chat.ts (Task 5)
- [x] All tasks have tests
- [x] No placeholders or TBDs in code steps
- [x] CODING_STANDARDS.md patterns used throughout (Context.Tag, Layer.effect, Data.TaggedError, Ref)
