---
title: Composable Kernel Architecture
description: ThoughtKernel abstraction, KernelRunner universal loop, and custom kernel registration via StrategyRegistry.
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

**After:** `reactive.ts` is 128 lines. All strategies call `runKernel(reactKernel, ...)`. Tool handling lives once in `tool-execution.ts`.

## ThoughtKernel

A `ThoughtKernel` is the contract for a single reasoning step:

```typescript
type ThoughtKernel = (
  state: KernelState,
  context: KernelContext,
) => Effect.Effect<KernelState, never, LLMService>;
```

The kernel receives immutable state and a frozen context, performs one reasoning step (think, act, or observe), and returns the next state. The runner calls it in a loop until `state.status` is `"done"` or `"failed"`.

`KernelState` is **immutable** — each step produces a new state via `transitionState()`. This makes reasoning chains replayable and serializable for collective learning.

### KernelState

```typescript
interface KernelState {
  // Identity
  readonly taskId: string;
  readonly strategy: string;
  readonly kernelType: string;

  // Accumulation
  readonly steps: readonly ReasoningStep[];
  readonly toolsUsed: ReadonlySet<string>;
  readonly scratchpad: ReadonlyMap<string, string>;

  // Metrics
  readonly iteration: number;
  readonly tokens: number;
  readonly cost: number;

  // Control
  readonly status: KernelStatus;   // "thinking" | "acting" | "observing" | "done" | "failed"
  readonly output: string | null;
  readonly error: string | null;

  // Strategy-specific extension point
  readonly meta: Readonly<Record<string, unknown>>;
}
```

### State Transitions

Use the provided factory functions — never mutate state directly:

```typescript
// Create initial state
const state = initialKernelState({
  maxIterations: 10,
  strategy: "reactive",
  kernelType: "react",
  taskId: "task-abc",
});

// Produce the next state (returns a new object — does not mutate)
const nextState = transitionState(state, {
  status: "acting",
  iteration: state.iteration + 1,
  meta: { ...state.meta, pendingToolRequest: toolReq },
});
```

### Serialization

`KernelState` uses `ReadonlySet` and `ReadonlyMap` which are not JSON-safe. Use the provided helpers for persistence:

```typescript
// KernelState → JSON-safe object (Set → sorted array, Map → plain object)
const serialized: SerializedKernelState = serializeKernelState(state);

// JSON-safe object → KernelState (array → Set, object → Map)
const restored: KernelState = deserializeKernelState(serialized);
```

### KernelContext

The context is assembled once by `runKernel()` and passed unchanged to every kernel step:

```typescript
interface KernelContext {
  readonly input: KernelInput;              // frozen task inputs
  readonly profile: ContextProfile;         // model-adaptive thresholds
  readonly compression: ResultCompressionConfig;
  readonly toolService: MaybeService<ToolServiceInstance>;
  readonly hooks: KernelHooks;              // EventBus lifecycle callbacks
}
```

## KernelRunner

`runKernel()` is the universal execution loop. Every reasoning strategy delegates to this function instead of implementing its own while-loop.

```typescript
function runKernel(
  kernel: ThoughtKernel,
  input: KernelInput,
  options: KernelRunOptions,
): Effect.Effect<KernelState, never, LLMService>
```

`KernelRunOptions` controls iteration limits and tagging:

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

The runner handles nine steps internally:

1. **Service resolution** — resolves LLM, ToolService, and EventBus via `Effect.serviceOption`
2. **Profile merging** — merges `input.contextProfile` over the `"mid"` baseline profile
3. **KernelHooks construction** — builds EventBus-wired hooks via `buildKernelHooks()`
4. **KernelContext assembly** — freezes a single context object for the entire execution
5. **Initial state creation** — calls `initialKernelState(options)` with `status: "thinking"`
6. **Main loop** — calls `kernel(state, context)` until `done`, `failed`, or `maxIterations` reached
7. **Embedded tool call guard** — if the final output contains a bare tool call (e.g. `web-search({"query":"test"})`), the runner executes it and replaces the output. This guards against models that embed tool calls inside `FINAL ANSWER` text.
8. **Terminal hooks** — fires `onDone` or `onError`
9. **Return** — returns the final `KernelState`

### Using the built-in ReAct kernel

The built-in `reactKernel` implements the Think → Act → Observe loop and is the default kernel used by all five strategies:

```typescript
import { runKernel } from "./strategies/shared/kernel-runner.js";
import { reactKernel } from "./strategies/shared/react-kernel.js";

const finalState = yield* runKernel(
  reactKernel,
  {
    task: "Summarize the latest release notes",
    availableToolSchemas: schemas,
    taskId: "task-123",
  },
  {
    maxIterations: 10,
    strategy: "reactive",
    kernelType: "react",
  },
);
```

For backwards compatibility, a wrapped form is also available:

```typescript
import { executeReActKernel } from "./strategies/shared/react-kernel.js";

const result: ReActKernelResult = yield* executeReActKernel({
  task: "Summarize the latest release notes",
  availableToolSchemas: schemas,
  maxIterations: 10,
  parentStrategy: "reactive",
  kernelPass: "reactive:main",
  taskId: "task-123",
});
// result.output, result.steps, result.totalTokens, result.toolsUsed, result.iterations
```

## KernelHooks

`KernelHooks` is the **single source of truth** for kernel lifecycle events. It is the only place `ToolCallCompleted` is published, which prevents the double-counting in `MetricsCollector` that occurred before this architecture.

```typescript
interface KernelHooks {
  readonly onThought:     (state: KernelState, thought: string) => Effect.Effect<void, never>;
  readonly onAction:      (state: KernelState, tool: string, input: string) => Effect.Effect<void, never>;
  readonly onObservation: (state: KernelState, result: string) => Effect.Effect<void, never>;
  readonly onDone:        (state: KernelState) => Effect.Effect<void, never>;
  readonly onError:       (state: KernelState, error: string) => Effect.Effect<void, never>;
}
```

Events emitted per hook:

| Hook | EventBus events published |
|---|---|
| `onThought` | `ReasoningStepCompleted` (with `thought` field) |
| `onAction` | `ReasoningStepCompleted` (with `action` field) |
| `onObservation` | `ReasoningStepCompleted` (with `observation` field) + `ToolCallCompleted` |
| `onDone` | `FinalAnswerProduced` |
| `onError` | _(no-op — no event emitted)_ |

When no EventBus is present, `buildKernelHooks()` returns hooks that silently no-op — kernels do not need to guard against a missing EventBus.

For tests and simple runs, `noopHooks` is exported from `kernel-state.ts`:

```typescript
import { noopHooks } from "./strategies/shared/kernel-state.js";
// All five hook methods are Effect.void — safe, no EventBus required
```

## Registering a Custom Kernel

`StrategyRegistry` holds a second registry for `ThoughtKernel` instances alongside the strategy registry. Use it to register your own kernel and retrieve it by name at runtime.

### StrategyRegistry kernel API

```typescript
class StrategyRegistry extends Context.Tag("StrategyRegistry")<
  StrategyRegistry,
  {
    // ... strategy methods ...

    /** Register a custom ThoughtKernel by name. */
    readonly registerKernel: (
      name: string,
      kernel: ThoughtKernel,
    ) => Effect.Effect<void>;

    /** Retrieve a registered ThoughtKernel by name. Fails with StrategyNotFoundError if absent. */
    readonly getKernel: (
      name: string,
    ) => Effect.Effect<ThoughtKernel, StrategyNotFoundError>;

    /** List all registered kernel names. */
    readonly listKernels: () => Effect.Effect<readonly string[]>;
  }
>() {}
```

The built-in kernel `"react"` is pre-registered in `StrategyRegistryLive`. Custom kernels are additive — registering one does not affect built-in kernels or strategies.

### Writing and registering a custom kernel

```typescript
import type { ThoughtKernel, KernelState, KernelContext } from "@reactive-agents/reasoning";
import { transitionState } from "@reactive-agents/reasoning";
import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";

// A minimal single-shot kernel: one LLM call, then done
const oneShotKernel: ThoughtKernel = (
  state: KernelState,
  context: KernelContext,
): Effect.Effect<KernelState, never, LLMService> =>
  Effect.gen(function* () {
    const llm = yield* LLMService;
    const response = yield* llm.complete({
      messages: [{ role: "user", content: context.input.task }],
      maxTokens: 512,
    }).pipe(Effect.orDie);

    yield* context.hooks.onThought(state, response.content);

    return transitionState(state, {
      status: "done",
      output: response.content,
      tokens: state.tokens + response.usage.totalTokens,
      iteration: state.iteration + 1,
    });
  });

// Register in your app setup
const program = Effect.gen(function* () {
  const registry = yield* StrategyRegistry;
  yield* registry.registerKernel("one-shot", oneShotKernel);

  // Retrieve and run later
  const kernel = yield* registry.getKernel("one-shot");
  const finalState = yield* runKernel(kernel, { task: "Hello" }, {
    maxIterations: 1,
    strategy: "one-shot",
    kernelType: "one-shot",
  });
});
```

## Why This Matters

| Before | After |
|---|---|
| `reactive.ts` — 905 lines | `reactive.ts` — 128 lines |
| Tool execution duplicated ×5 | `tool-execution.ts` — shared once |
| EventBus wiring scattered across 5 strategy files | `kernel-hooks.ts` — single source |
| Double `ToolCallCompleted` metrics in MetricsCollector | Fixed — `KernelHooks.onObservation` is the only publisher |
| Hard to add a new strategy | Implement one `ThoughtKernel` step function, call `runKernel()` |
| `KernelState` was mutable | Immutable — `transitionState()` returns a new object each time |
| No bare tool call guard | `runKernel()` detects and executes embedded tool calls post-loop |
