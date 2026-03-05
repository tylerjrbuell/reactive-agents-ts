# Composable Kernel Architecture — Design

**Date:** 2026-03-04
**Status:** Approved
**Scope:** Phase 1 — KernelState + ReAct kernel + reactive.ts collapse + bug fixes

---

## Problem

The reasoning layer has three copies of the ReAct loop (reactive.ts, react-kernel.ts, and fragments in reflexion.ts), ~800 lines of duplication. Bug fixes must be applied to multiple files — we've hit this 3 times in the current session. EventBus/observability/metrics wiring is scattered across 20+ call sites with inconsistent patterns. State is mutable locals that can't be serialized, inspected, or replayed.

This blocks:
- **Dynamic reasoning control** — new thought algorithms require copying 500+ lines
- **Collective learning** — state isn't serializable
- **Model-adaptive dispatch** — no clean way to pick different inner loops per model tier
- **Safe experimentation** — kernels can't be tested in isolation from strategies

## Solution

Separate **what happens each step** (the kernel) from **when to stop and what to do between passes** (the strategy) and **how to observe it** (the runner + hooks).

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Strategy       │     │   KernelRunner    │     │  ThoughtKernel  │
│   (policy loop)  │────▶│   (universal)     │────▶│  (algorithm)    │
│                  │     │                   │     │                 │
│ reactive         │     │ • loop guard      │     │ reactKernel     │
│ reflexion        │     │ • hooks wiring    │     │ directToolKernel│
│ adaptive         │     │ • kill switch     │     │ (future custom) │
│ plan-execute     │     │ • embedded tool   │     │                 │
│ tree-of-thought  │     │   call guard      │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
         │                       │                        │
         │              ┌───────┴────────┐                │
         │              │  KernelHooks   │                │
         │              │  (EventBus,    │                │
         │              │   Observability│                │
         │              │   Metrics)     │                │
         │              └────────────────┘                │
         │                                                │
         └──────── KernelState (immutable, serializable) ─┘
```

---

## Core Types

### KernelState — Universal Reasoning State

```typescript
interface KernelState {
  // Identity
  readonly taskId: string;
  readonly strategy: string;
  readonly kernelType: string;

  // Accumulation (immutable — new instances each transition)
  readonly steps: readonly ReasoningStep[];
  readonly toolsUsed: ReadonlySet<string>;
  readonly scratchpad: ReadonlyMap<string, string>;

  // Metrics
  readonly iteration: number;
  readonly tokens: number;
  readonly cost: number;

  // Control
  readonly status: "thinking" | "acting" | "observing" | "done" | "failed";
  readonly output: string | null;
  readonly error: string | null;

  // Strategy-specific context (opaque to kernel)
  readonly meta: Readonly<Record<string, unknown>>;
}
```

- **Immutable**: every transition returns a new state object
- **Serializable**: ReadonlySet/ReadonlyMap serialize via helpers for collective learning
- **`meta` bag**: strategies store domain-specific data (blockedTools, previousCritiques) without polluting the core interface

### ThoughtKernel — Swappable Algorithm

```typescript
type ThoughtKernel = (
  state: KernelState,
  context: KernelContext,
) => Effect.Effect<KernelState, never, LLMService>;
```

A kernel implements **one step transition**: given current state, produce next state. It does NOT:
- Loop (the runner does that)
- Fire events (hooks do that)
- Check iteration limits (the runner does that)
- Handle kill switch (the runner does that)

### KernelContext — Injected Dependencies

```typescript
interface KernelContext {
  readonly input: KernelInput;
  readonly profile: ContextProfile;
  readonly compression: ResultCompressionConfig;
  readonly toolService: MaybeService<ToolServiceInstance>;
  readonly eventBus: MaybeService<EventBusInstance>;
  readonly hooks: KernelHooks;
}
```

Frozen at execution start. Kernels receive services, they don't look them up.

### KernelHooks — Lifecycle Integration

```typescript
interface KernelHooks {
  readonly onThought: (state: KernelState, thought: string) => Effect.Effect<void>;
  readonly onAction: (state: KernelState, tool: string, input: string) => Effect.Effect<void>;
  readonly onObservation: (state: KernelState, result: string) => Effect.Effect<void>;
  readonly onDone: (state: KernelState, output: string) => Effect.Effect<void>;
  readonly onError: (state: KernelState, error: string) => Effect.Effect<void>;
}
```

Wired by the runner to:

| Hook | EventBus | Observability | Metrics |
|------|----------|---------------|---------|
| onThought | ReasoningStepCompleted (thought) | `[thought]` structured log | — |
| onAction | ReasoningStepCompleted (action) + ToolCallStarted | `[action]` structured log | tool call recorded |
| onObservation | ReasoningStepCompleted (observation) + ToolCallCompleted | `[obs]` structured log | tool duration recorded |
| onDone | FinalAnswerProduced | `[complete]` structured log | — |
| onError | — | `[error]` structured log | — |

Kernels call `hooks.onThought()` etc. They never import EventBus.

---

## KernelRunner — Universal Execution Loop

```typescript
function runKernel(
  kernel: ThoughtKernel,
  input: KernelInput,
  options: KernelRunOptions,
): Effect.Effect<KernelState, ExecutionError | IterationLimitError, LLMService>
```

Responsibilities:
1. Create `KernelState.initial(input)`
2. Build `KernelContext` with hooks wired to EventBus/observability
3. Loop: `while (state.status !== "done" && state.status !== "failed" && state.iteration < max)`
4. Call `kernel(state, context)` each iteration
5. Fire hooks after each transition
6. **Embedded tool call guard**: after `status: "done"`, check `parseBareToolCall(state.output)` — if match, set status back to "acting" and re-enter for one execution cycle
7. **Clean output**: after embedded tool execution, the observation result becomes the output (fixes raw tool call in output bug)
8. Return final state

### KernelRunOptions

```typescript
interface KernelRunOptions {
  readonly maxIterations: number;
  readonly strategy: string;
  readonly kernelType: string;
  readonly taskId?: string;
  readonly meta?: Record<string, unknown>;
}
```

---

## Strategy Simplification

### reactive.ts — Before vs After

**Before:** ~500 lines with full ReAct loop, tool execution, context compaction, EventBus wiring, thinking extraction, early termination, embedded tool call guards.

**After:** ~50 lines:

```typescript
export const executeReactive: StrategyFn = (input) =>
  Effect.gen(function* () {
    const state = yield* runKernel(reactKernel, toKernelInput(input), {
      maxIterations: input.config.maxIterations,
      strategy: "reactive",
      kernelType: "react",
      taskId: input.taskId,
    });
    return buildResultFromState(state);
  });
```

### reflexion.ts — Uses runKernel for passes

```typescript
// Generate pass
const genState = yield* runKernel(reactKernel, kernelInput, {
  maxIterations, strategy: "reflexion", kernelType: "react",
  meta: { pass: "generate" },
});

// Improvement passes
while (attempt < maxRetries && !satisfied) {
  const critique = yield* llm.complete(critiquePrompt);
  const improveState = yield* runKernel(reactKernel, kernelInput, {
    maxIterations, strategy: "reflexion", kernelType: "react",
    meta: { pass: "improve", blockedTools, previousCritiques },
  });
  // ... accumulate side effects, check satisfaction
}
```

### Future: custom kernel registration

```typescript
// User registers a custom kernel
const agent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("qwen3.5")
  .withKernel("chain-of-draft", chainOfDraftKernel)  // custom ThoughtKernel
  .withReasoning({ defaultStrategy: "reactive", defaultKernel: "chain-of-draft" })
  .build();
```

---

## Shared Tool Execution

Extract `runToolObservation()` from reactive.ts and react-kernel.ts into `shared/tool-execution.ts`:

```typescript
export function executeToolCall(
  toolService: MaybeService<ToolServiceInstance>,
  tool: string,
  input: string,
  config: {
    profile: ContextProfile;
    compression: ResultCompressionConfig;
    scratchpad: ReadonlyMap<string, string>;
    transform?: string;
  },
): Effect.Effect<ToolExecutionResult, never>
```

Single implementation, ~130 lines. Both the ReAct kernel and future kernels use it.

---

## Bug Fixes

### Fix 1: Output contains raw tool call text

**Location:** `kernel-runner.ts` post-completion guard

After kernel returns `status: "done"`:
1. `parseBareToolCall(state.output)` — check for embedded tool call
2. If match: execute the tool via `executeToolCall()`, set output to observation result
3. Fire `hooks.onAction()` + `hooks.onObservation()` for the extra execution

### Fix 2: Double tool metrics

**Root cause:** Both strategies AND execution engine independently count `ToolCallCompleted` events.

**Fix:** Only `hooks.onAction()`/`hooks.onObservation()` in the runner fire `ToolCallCompleted`. Strategies don't publish tool events directly. Execution engine reads `state.toolsUsed` from the final KernelState for the `[act]` summary line.

---

## File Changes

| File | Change | Lines |
|------|--------|-------|
| `shared/kernel-state.ts` | **NEW** — KernelState, KernelContext, KernelHooks, ThoughtKernel, KernelState.initial() | ~120 |
| `shared/kernel-runner.ts` | **NEW** — runKernel(), buildKernelHooks(), embedded tool guard, clean output | ~200 |
| `shared/tool-execution.ts` | **NEW** — extracted from reactive.ts + react-kernel.ts (~130 lines each → 1 shared) | ~150 |
| `shared/react-kernel.ts` | **REWRITE** — becomes ThoughtKernel impl, single step, no loop | ~200 |
| `reactive.ts` | **REWRITE** — thin wrapper around runKernel() | ~50 |
| `reflexion.ts` | **UPDATE** — generate/improve passes use runKernel() | ~moderate |
| `strategy-registry.ts` | **UPDATE** — add registerKernel() for custom kernels | ~20 |
| `execution-engine.ts` | **UPDATE** — fix double metrics, read toolsUsed from state | ~10 |
| Tests | Update existing + new kernel-state, kernel-runner, tool-execution tests | ~200 |

## Verification

1. `bun run build` — all packages compile
2. `bun test` — all 1296+ tests pass
3. `bun test.ts` — adaptive → reactive path: clean output, single tool metric count, Signal message delivered
4. Verify EventBus events fire identically to current behavior
5. Verify observability logs unchanged at all verbosity levels

---

## Phase 2 (Future)

- Migrate tree-of-thought to use runKernel() for Phase 2 execution
- Migrate plan-execute step dispatch to use runKernel()
- Implement `directToolKernel` — skip Think/Act/Observe ceremony for simple single-tool tasks
- Implement `structuredPlanKernel` — JSON plan output for structured planning
- Builder API: `.withKernel(name, fn)` for user-registered kernels
- Collective learning: serialize KernelState to episodic memory, share via seeding network
- Model-adaptive kernel selection: adaptive classifier picks kernel based on model tier
