---
title: Composable Kernel Architecture
description: >-
  ThoughtKernel abstraction, KernelRunner universal loop, and custom kernel
  registration via StrategyRegistry.
sidebar:
  order: 5
---

The Composable Kernel Architecture separates *how a reasoning step works* (the kernel) from *when and how many times it runs* (the strategy). This makes reasoning algorithms swappable, testable in isolation, and extensible without touching core framework code.

## The Three-Layer Model

```
Strategy (policy: when to run, how many times, what config)
    └── KernelRunner (universal loop: tool guard, EventBus wiring, state transitions)
            └── ThoughtKernel (algorithm: one step — thought → action → observation)
```

**Before this architecture:** Each strategy owned its own execution loop. `reactive.ts` was 905 lines. Tool call handling, EventBus wiring, and observation formatting were duplicated across 5 files.

**After:** All strategies call the internal `runKernel(reactKernel, ...)`. Tool handling lives once in `tool-execution.ts`. `reactive.ts` dropped to 266 lines at the refactor and is 384 today — it has grown since with strategy features, far from the 905-line duplicated-loop era.

## ThoughtKernel

A `ThoughtKernel` is the contract for a single reasoning step. It is exported from `@reactive-agents/reasoning` — so is `Phase`, `KernelContext`, `Guard`, `MetaToolHandler`, and `makeKernel` — which means every extension point on this page compiles against the published package:

```typescript
import { Effect } from "effect";
import type { LLMService } from "@reactive-agents/llm-provider";
import type {
  KernelContext,
  KernelState,
  ThoughtKernel,
} from "@reactive-agents/reasoning";

// The published contract, shown verbatim. The pin assignment below only
// compiles if this shape matches the real exported type.
declare const kernel: ThoughtKernel;
const contract: (
  state: KernelState,
  context: KernelContext,
) => Effect.Effect<KernelState, never, LLMService> = kernel;
```

The kernel receives immutable state and a frozen context, performs one reasoning step (think, act, or observe), and returns the next state. The runner calls it in a loop until `state.status` is `"done"` or `"failed"`.

`KernelState` is **immutable** — each step produces a new state. This makes reasoning chains replayable and serializable for collective learning.

### KernelState

The state's field inventory (framework type `kernel-state.ts`):

```typescript
import type { KernelState } from "@reactive-agents/reasoning";

// Published shape. Pick pins the field inventory — renaming or removing any
// field below makes this stop compiling.
type StateShape = Pick<
  KernelState,
  // Identity
  | "taskId" | "strategy" | "kernelType"
  // Accumulation
  | "steps" | "ledger" | "toolsUsed" | "scratchpad" | "messages"
  | "controllerDecisionLog"
  // Metrics
  | "iteration" | "tokens" | "inputTokens" | "outputTokens" | "cost" | "llmCalls"
  // Control
  | "status" | "output" | "error"
  // Strategy-specific extension point
  | "meta"
>;
```

- `steps` is the observability record (`ReasoningStep[]`); `messages` is the LLM conversation thread (assistant turns + tool results), compacted with a sliding window.
- `ledger` is the append-only event store the meta-loop projects from; `steps` stays authoritative for now, with the ledger as a queryable mirror.
- `status` is a closed union: `"thinking" | "acting" | "observing" | "done" | "failed" | "evaluating"` (plus harness-set values).

`KernelState` also carries `scratchpad: ReadonlyMap<string, string>`, used internally to sync compressed tool-result storage with the **`recall`** meta-tool. Application docs treat **`recall`** as the user-facing working-memory API — not that map.

### State Transitions

State fields are `readonly` — never mutate. Inside the framework, `initialKernelState()` and `transitionState()` (`kernel-state.ts`) are the sanctioned factories and are guarded by a mutation-discipline test; they are **framework-internal** and not on the published package surface. Extension authors produce the next state the same structural way:

```typescript
import type { KernelState } from "@reactive-agents/reasoning";

declare const current: KernelState;

// Produce the next state (returns a new object — does not mutate).
const next: KernelState = {
  ...current,
  status: "acting",
  iteration: current.iteration + 1,
};
```

### Serialization

`KernelState` uses `ReadonlySet`/`ReadonlyMap` which are not JSON-safe. The published codec helpers round-trip it through a JSON **string** (Set → sorted array, Map → plain object), and crash-resume persists exactly that string onto `KernelInput.resumeState`:

```typescript
import { Effect } from "effect";
import {
  deserializeKernelState,
  serializeKernelState,
  type KernelState,
} from "@reactive-agents/reasoning";

declare const running: KernelState;

// KernelState → JSON-safe string, and back.
const snapshot: string = serializeKernelState(running);
const restored: KernelState = deserializeKernelState(snapshot);
```

### KernelContext

The context is assembled once by the runner and passed unchanged to every kernel step:

```typescript
import type { KernelContext } from "@reactive-agents/reasoning";

// Published shape (kernel-state.ts). Pick pins the field inventory:
type ContextShape = Pick<
  KernelContext,
  | "input"             // frozen task inputs (KernelInput)
  | "profile"           // model-adaptive thresholds (ContextProfile)
  | "compression"       // tool-result compression config
  | "toolService"       // Option — None when no ToolService is registered
  | "hooks"             // EventBus lifecycle callbacks (KernelHooks)
  | "toolCallingDriver" // native-FC vs text-parse driver (from calibration)
  | "memoryService"     // Option — semantic store for successful tool results
>;
```

## KernelRunner

`runKernel()` is the universal execution loop. Every reasoning strategy delegates to this function instead of implementing its own while-loop. It is **framework-internal** (`kernel/loop/runner.ts`) — application code drives runs through the strategy layer or `executeReActKernel` (shown below):

```text
function runKernel(
  kernel: ThoughtKernel,
  input: KernelInput,
  options: KernelRunOptions,
): Effect.Effect<KernelState, never, LLMService>
```

`KernelRunOptions` controls iteration limits and tagging (core fields — it also carries loop-detection and strategy-switching config):

```typescript
interface KernelRunOptions {
  readonly maxIterations: number;
  readonly strategy: string;
  readonly kernelType: string;
  readonly taskId?: string;
  readonly kernelPass?: string;   // descriptive label, e.g. "reflexion:generate"
  readonly meta?: Record<string, unknown>;
}
```

The runner handles these steps internally:

1. **Service resolution** — resolves LLM, ToolService, and EventBus via `resolveStrategyServices`
2. **Cross-cutting cascade merge** — the run-wide `RunEnvelope` fields (harness pipeline, budgets, calibration, …) merge at this single universal entry, so every strategy receives them
3. **Profile merging** — merges `input.contextProfile` over the `"mid"` baseline profile
4. **KernelHooks construction** — builds EventBus-wired hooks via `buildKernelHooks()`
5. **KernelContext assembly** — freezes a single context object for the entire execution
6. **Initial state creation** — calls `initialKernelState(options)` with `status: "thinking"`
7. **Main loop** — calls `kernel(state, context)` until `done`, `failed`, or `maxIterations` reached
8. **Guards** — required-tools availability (pre-loop), loop detection, fabrication/contract terminal checks
9. **Terminal hooks + return** — fires `onDone` or `onError`, returns the final `KernelState`

### Using the built-in ReAct kernel

The built-in `reactKernel` implements the Think → Act → Observe step contract and is the default kernel used by all strategies. Both it and the phase-level assembler are public:

```typescript
import {
  makeKernel,
  reactKernel,
  type ThoughtKernel,
} from "@reactive-agents/reasoning";

// The built-in single-step ReAct kernel (equivalent to makeKernel()):
const builtin: ThoughtKernel = reactKernel;

// Or assemble one yourself from a Phase pipeline — pass your own think/act
// phases, or take the defaults:
const assembled: ThoughtKernel = makeKernel();
```

For backwards compatibility, a wrapped form is also available:

```typescript
import { Effect } from "effect";
import { executeReActKernel } from "@reactive-agents/reasoning";

// Drives the full ReAct loop and returns the run result, not step state.
// The input is a KernelInput; only `task` is required.
const run = () =>
  Effect.gen(function* () {
    const result = yield* executeReActKernel({
      task: "Summarize the latest release notes",
      availableToolSchemas: [],
      maxIterations: 10,
      parentStrategy: "reactive",
      kernelPass: "reactive:main",
      taskId: "task-123",
    });
    // result.output, result.steps, result.totalTokens, result.toolsUsed,
    // result.iterations, result.terminatedBy
    return result;
  });
```

## KernelHooks

`KernelHooks` is the **single source of truth** for kernel lifecycle events. It is the only place `ToolCallCompleted` is published, which prevents the double-counting in `MetricsCollector` that occurred before this architecture. The interface is not a named package export — reach it through `KernelContext["hooks"]`:

```typescript
import { Effect } from "effect";
import type {
  KernelContext,
  KernelState,
} from "@reactive-agents/reasoning";

type KernelHooks = KernelContext["hooks"];

// The core five, shown verbatim. The pin only compiles while these
// signatures match the real ones.
interface DisplayedHooks {
  readonly onThought: (
    state: KernelState,
    thought: string,
    prompt?: {
      system: string;
      user: string;
      messages?: readonly { readonly role: string; readonly content: string }[];
      rawResponse?: string;
    },
  ) => Effect.Effect<void, never>;
  readonly onAction: (
    state: KernelState,
    tool: string,
    input: string,
    opts?: {
      readonly callId?: string;
      readonly rationale?: import("@reactive-agents/core").Rationale;
    },
  ) => Effect.Effect<void, never>;
  readonly onObservation: (
    state: KernelState,
    result: string,
    success: boolean,
  ) => Effect.Effect<void, never>;
  readonly onDone: (state: KernelState) => Effect.Effect<void, never>;
  readonly onError: (
    state: KernelState,
    error: string,
  ) => Effect.Effect<void, never>;
}

declare const hooks: KernelHooks;
const pinned: DisplayedHooks = hooks;
```

The full interface has five more hooks since this page was first written: `onIterationProgress`, `onStrategySwitched`, `onStrategySwitchEvaluated`, `onContextSynthesized`, and `onLedgerAppend` (the runner's live ledger tap).

Events emitted per hook (with an EventBus registered):

| Hook | EventBus events published |
|---|---|
| `onThought` | `ReasoningStepCompleted` (with `thought` field) |
| `onAction` | `ReasoningStepCompleted` (with `action` field) |
| `onObservation` | `ReasoningStepCompleted` (with `observation` field) + `ToolCallCompleted` |
| `onDone` | `FinalAnswerProduced` |
| `onError` | `ReasoningFailed` |

When no EventBus is present, `buildKernelHooks()` returns hooks that silently no-op — kernels do not need to guard against a missing EventBus. For tests and simple runs, the framework-internal `noopHooks` constant (`kernel-state.ts`, not on the published surface) provides the same all-`Effect.void` defaults.

## Registering a Custom Kernel

`StrategyRegistry` holds a second registry for `ThoughtKernel` instances alongside the strategy registry. Use it to register your own kernel and retrieve it by name at runtime.

### StrategyRegistry kernel API

```typescript
import { Effect } from "effect";
import { reactKernel, StrategyRegistry } from "@reactive-agents/reasoning";

// The three kernel-registry methods, as published on the StrategyRegistry
// service interface:
const use = Effect.gen(function* () {
  const registry = yield* StrategyRegistry;
  yield* registry.registerKernel("react-alias", reactKernel);
  const kernel = yield* registry.getKernel("react-alias"); // ThoughtKernel
  yield* registry.registerKernel("unused", kernel);
  return yield* registry.listKernels();
});
```

`getKernel` fails with `StrategyNotFoundError` when the name is absent. The built-in kernel `"react"` is pre-registered in `StrategyRegistryLive`. Custom kernels are additive — registering one does not affect built-in kernels or strategies.

### Writing and registering a custom kernel

`ThoughtKernel`, `KernelState`, `KernelContext`, `Phase`, and `makeKernel` are published exports of `@reactive-agents/reasoning`. The one piece that remains framework-internal is `transitionState()` — custom phases build the next state by spreading, which is exactly what it does internally:

```typescript
import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import {
  makeKernel,
  StrategyRegistry,
  type KernelContext,
  type KernelState,
  type Phase,
} from "@reactive-agents/reasoning";

// A minimal single-shot think phase: one LLM call, then done.
const oneShotThink: Phase = (state: KernelState, context: KernelContext) =>
  Effect.gen(function* () {
    const llm = yield* LLMService;
    const response = yield* llm.complete({
      messages: [{ role: "user", content: context.input.task }],
      maxTokens: 512,
    }).pipe(Effect.orDie);

    yield* context.hooks.onThought(state, response.content);

    return {
      ...state,
      status: "done" as const,
      output: response.content,
      tokens: state.tokens + response.usage.totalTokens,
      iteration: state.iteration + 1,
    };
  });

// Assemble a ThoughtKernel from phases. The default pipeline is
// [think, act]; here the one-shot replaces the think phase and a no-op
// act phase finishes the tuple.
const act: Phase = (state) => Effect.succeed(state);
const oneShotKernel = makeKernel({ phases: [oneShotThink, act] });

// Register in your app setup; retrieve and run via your own strategy layer.
const setup = Effect.gen(function* () {
  const registry = yield* StrategyRegistry;
  yield* registry.registerKernel("one-shot", oneShotKernel);
  return yield* registry.getKernel("one-shot");
});
```

## Why This Matters

| Before | After |
|---|---|
| `reactive.ts` — 905 lines | `reactive.ts` — 266 at refactor (384 today, feature growth) |
| Tool execution duplicated ×5 | `tool-execution.ts` — shared once |
| EventBus wiring scattered across 5 strategy files | `kernel-hooks.ts` — single source |
| Double `ToolCallCompleted` metrics in MetricsCollector | Fixed — `KernelHooks.onObservation` is the only publisher |
| Hard to add a new strategy | Implement a `Phase` / `ThoughtKernel`, `makeKernel({ phases })`, register via `StrategyRegistry` |
| `KernelState` was mutable | Immutable — spread produces each new state (`transitionState()` wraps this internally) |
| No terminal-truth enforcement | Contract-driven terminal gates (required-tools, fabrication guard) reject ungrounded final answers |
