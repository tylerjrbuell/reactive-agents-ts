# Composable Kernel Architecture — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace duplicated ReAct loops with a composable ThoughtKernel + KernelRunner architecture — immutable state, centralized hooks, swappable algorithms.

**Architecture:** Three-layer separation: ThoughtKernel (single-step algorithm), KernelRunner (universal loop with hooks), Strategy (policy wrapper). KernelState is immutable and serializable. All EventBus/observability/metrics wiring flows through KernelHooks — kernels never import these systems directly.

**Tech Stack:** Effect-TS, bun:test, TypeScript strict mode

**Design doc:** `docs/plans/2026-03-04-composable-kernel-architecture-design.md`

**Vision alignment:**
- *Composable Over Monolithic* (Principle 6) — strategies compose from kernel + runner + policy
- *Control Over Magic* (Principle 1) — every state transition is explicit and typed
- *Observable Over Opaque* (Principle 5) — hooks centralize all event publishing
- *Efficient Over Wasteful* (Principle 7) — eliminates ~800 lines of duplication
- *Local-First* (Principle 10) — kernel abstraction enables model-tier-adaptive algorithms
- *Testable Over Clever* (Principle 4) — kernels are pure functions, testable without mocking EventBus

---

### Task 1: KernelState types and factory

**Files:**
- Create: `packages/reasoning/src/strategies/shared/kernel-state.ts`
- Modify: `packages/reasoning/src/strategies/shared/index.ts`

**Step 1: Create kernel-state.ts with all core types**

```typescript
// packages/reasoning/src/strategies/shared/kernel-state.ts

import type { Effect } from "effect";
import type { ReasoningStep } from "../../types/index.js";
import type { ContextProfile } from "../../context/context-profile.js";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import type { LLMService } from "@reactive-agents/llm-provider";
import type { ToolSchema } from "./tool-utils.js";

// ── KernelState — immutable, serializable reasoning state ─────────────────

export type KernelStatus = "thinking" | "acting" | "observing" | "done" | "failed";

export interface KernelState {
  readonly taskId: string;
  readonly strategy: string;
  readonly kernelType: string;

  readonly steps: readonly ReasoningStep[];
  readonly toolsUsed: ReadonlySet<string>;
  readonly scratchpad: ReadonlyMap<string, string>;

  readonly iteration: number;
  readonly tokens: number;
  readonly cost: number;

  readonly status: KernelStatus;
  readonly output: string | null;
  readonly error: string | null;

  /** Strategy-specific context (opaque to kernel). */
  readonly meta: Readonly<Record<string, unknown>>;
}

/** Create the initial state for a kernel execution. */
export function initialKernelState(opts: {
  taskId: string;
  strategy: string;
  kernelType: string;
  meta?: Record<string, unknown>;
}): KernelState {
  return {
    taskId: opts.taskId,
    strategy: opts.strategy,
    kernelType: opts.kernelType,
    steps: [],
    toolsUsed: new Set(),
    scratchpad: new Map(),
    iteration: 0,
    tokens: 0,
    cost: 0,
    status: "thinking",
    output: null,
    error: null,
    meta: opts.meta ?? {},
  };
}

/** Immutable state transition — returns a new KernelState with merged fields. */
export function transitionState(
  state: KernelState,
  patch: Partial<Omit<KernelState, "taskId" | "strategy" | "kernelType">>,
): KernelState {
  return { ...state, ...patch };
}

// ── Serialization helpers (for collective learning / replay) ──────────────

export function serializeKernelState(state: KernelState): Record<string, unknown> {
  return {
    ...state,
    toolsUsed: [...state.toolsUsed],
    scratchpad: Object.fromEntries(state.scratchpad),
  };
}

export function deserializeKernelState(raw: Record<string, unknown>): KernelState {
  return {
    ...(raw as unknown as KernelState),
    toolsUsed: new Set(raw.toolsUsed as string[]),
    scratchpad: new Map(Object.entries(raw.scratchpad as Record<string, string>)),
  };
}

// ── KernelInput — frozen at execution start ───────────────────────────────

export interface KernelInput {
  readonly task: string;
  readonly systemPrompt?: string;
  readonly availableToolSchemas?: readonly ToolSchema[];
  readonly priorContext?: string;
  readonly contextProfile?: Partial<ContextProfile>;
  readonly resultCompression?: ResultCompressionConfig;
  readonly temperature?: number;
  readonly agentId?: string;
  readonly sessionId?: string;
  /** Tools that MUST NOT be executed (side-effect guard from reflexion). */
  readonly blockedTools?: readonly string[];
}

// ── MaybeService — structural option type for optional services ───────────

export type MaybeService<T> = { _tag: "Some"; value: T } | { _tag: "None" };

// ── Narrow service types used by kernels ──────────────────────────────────

export type ToolServiceInstance = {
  readonly execute: (input: {
    toolName: string;
    arguments: Record<string, unknown>;
    agentId: string;
    sessionId: string;
  }) => Effect.Effect<{ result: unknown; success?: boolean }, unknown>;
  readonly getTool: (name: string) => Effect.Effect<{
    parameters: Array<{ name: string; type: string; required?: boolean }>;
  }, unknown>;
};

export type EventBusInstance = {
  readonly publish: (event: unknown) => Effect.Effect<void, unknown>;
};

// ── KernelHooks — lifecycle integration (wired by runner) ─────────────────

export interface KernelHooks {
  readonly onThought: (state: KernelState, thought: string, meta?: { thinking?: string; prompt?: { system: string; user: string } }) => Effect.Effect<void>;
  readonly onAction: (state: KernelState, tool: string, input: string) => Effect.Effect<void>;
  readonly onObservation: (state: KernelState, tool: string, result: string, durationMs: number, success: boolean) => Effect.Effect<void>;
  readonly onDone: (state: KernelState, output: string) => Effect.Effect<void>;
  readonly onError: (state: KernelState, error: string) => Effect.Effect<void>;
}

/** No-op hooks for testing or when observability is disabled. */
export const noopHooks: KernelHooks = {
  onThought: () => Effect.void,
  onAction: () => Effect.void,
  onObservation: () => Effect.void,
  onDone: () => Effect.void,
  onError: () => Effect.void,
};
// Note: noopHooks needs the Effect import at runtime — callers must ensure
// Effect is available. The import is type-only at the top of this file,
// so we'll need to make it a value import. See Step 1 implementation.

// ── KernelContext — injected into every kernel call ───────────────────────

export interface KernelContext {
  readonly input: KernelInput;
  readonly profile: ContextProfile;
  readonly compression: ResultCompressionConfig;
  readonly toolService: MaybeService<ToolServiceInstance>;
  readonly hooks: KernelHooks;
}

// ── ThoughtKernel — the swappable algorithm contract ──────────────────────

/**
 * A ThoughtKernel implements one reasoning step transition.
 *
 * Given current state + context, produce the next state.
 * Kernels do NOT:
 * - Loop (the runner does that)
 * - Fire EventBus events (hooks do that)
 * - Check iteration limits (the runner does that)
 * - Handle kill switch (the runner does that)
 */
export type ThoughtKernel = (
  state: KernelState,
  context: KernelContext,
) => Effect.Effect<KernelState, never, LLMService>;

// ── KernelRunOptions — passed to runKernel() ──────────────────────────────

export interface KernelRunOptions {
  readonly maxIterations: number;
  readonly strategy: string;
  readonly kernelType: string;
  readonly taskId?: string;
  readonly kernelPass?: string;
  readonly meta?: Record<string, unknown>;
}
```

**Step 2: Update shared/index.ts to export kernel-state**

Add to `packages/reasoning/src/strategies/shared/index.ts`:
```typescript
export * from "./kernel-state.js";
```

**Step 3: Run build to verify types compile**

```bash
bun run build
```
Expected: All packages compile. No runtime behavior changes.

**Step 4: Commit**

```bash
git add packages/reasoning/src/strategies/shared/kernel-state.ts packages/reasoning/src/strategies/shared/index.ts
git commit -m "feat(reasoning): KernelState types — immutable state, ThoughtKernel contract, KernelHooks"
```

---

### Task 2: Extract shared tool execution

**Files:**
- Create: `packages/reasoning/src/strategies/shared/tool-execution.ts`
- Modify: `packages/reasoning/src/strategies/shared/index.ts`

**Step 1: Create tool-execution.ts**

Extract the duplicated `runToolObservation()` / `runKernelToolObservation()`, `resolveToolArgs()`, `normalizeTripleQuotes()`, `normalizeObservation()`, `truncateForDisplay()`, `makeObservationResult()` from reactive.ts (lines 444-877) and react-kernel.ts (lines 494-812) into a single shared implementation.

Key decisions:
- Function signature: `executeToolCall(toolService, toolRequest, config)` — flat config object replaces the 7 positional params
- `resolveToolArgs` takes the narrow `ToolServiceInstance` type from kernel-state.ts
- `makeObservationResult` becomes a public export (used by runner for blocked/duplicate observations)
- `truncateForDisplay` becomes a public export (used by reactive.ts re-export for backwards compat)
- `normalizeObservation` stays private (internal detail of tool execution)

The implementation is the react-kernel.ts version (lines 657-787 for `runKernelToolObservation`, 594-651 for `resolveKernelToolArgs`, 535-545 for `normalizeTripleQuotes`, 550-588 for `normalizeObservation`, 525-530 for `truncateForDisplay`, 511-520 for `makeObservationResult`) — they are identical to reactive.ts.

**Step 2: Update shared/index.ts**

```typescript
export * from "./tool-execution.js";
```

**Step 3: Write tests for tool-execution.ts**

Create `packages/reasoning/tests/strategies/shared/tool-execution.test.ts`:
- Test `makeObservationResult()` produces correct category/resultKind
- Test `truncateForDisplay()` with short/long strings
- Test `normalizeTripleQuotes()` with triple-quoted input
- Test `executeToolCall()` with mock ToolService — success path
- Test `executeToolCall()` with mock ToolService — error path with schema hint
- Test `executeToolCall()` with scratchpad auto-store
- Test `executeToolCall()` with pipe transform
- Test `executeToolCall()` when ToolService is None

**Step 4: Run tests**

```bash
bun test packages/reasoning/tests/strategies/shared/tool-execution.test.ts
```
Expected: All new tests pass.

**Step 5: Commit**

```bash
git add packages/reasoning/src/strategies/shared/tool-execution.ts packages/reasoning/src/strategies/shared/index.ts packages/reasoning/tests/strategies/shared/tool-execution.test.ts
git commit -m "feat(reasoning): shared tool-execution — extract duplicated runToolObservation into single module"
```

---

### Task 3: Build KernelHooks wiring

**Files:**
- Create: `packages/reasoning/src/strategies/shared/kernel-hooks.ts`
- Modify: `packages/reasoning/src/strategies/shared/index.ts`

**Step 1: Create kernel-hooks.ts**

This module creates `KernelHooks` wired to EventBus + the `publishReasoningStep` helper from service-utils.ts.

```typescript
// packages/reasoning/src/strategies/shared/kernel-hooks.ts

import { Effect } from "effect";
import type { KernelHooks, KernelState, EventBusInstance, MaybeService } from "./kernel-state.js";
import { publishReasoningStep } from "./service-utils.js";

/**
 * Build KernelHooks wired to EventBus.
 *
 * Centralizes the ~20 scattered `if (eb._tag === "Some") yield* eb.publish(...)` calls
 * into 5 hook functions. Kernels call hooks; they never import EventBus.
 */
export function buildKernelHooks(
  eventBus: MaybeService<EventBusInstance>,
): KernelHooks {
  return {
    onThought: (state, thought, meta) =>
      publishReasoningStep(eventBus, {
        _tag: "ReasoningStepCompleted",
        taskId: state.taskId,
        strategy: state.strategy,
        step: state.steps.length + 1,
        totalSteps: 0, // Runner will set this from maxIterations
        thought,
        kernelPass: (state.meta.kernelPass as string) ?? `${state.strategy}:main`,
        ...(meta?.prompt ? { prompt: meta.prompt } : {}),
      }),

    onAction: (state, tool, input) =>
      publishReasoningStep(eventBus, {
        _tag: "ReasoningStepCompleted",
        taskId: state.taskId,
        strategy: state.strategy,
        step: state.steps.length + 1,
        totalSteps: 0,
        action: JSON.stringify({ tool, input }),
        kernelPass: (state.meta.kernelPass as string) ?? `${state.strategy}:main`,
      }),

    onObservation: (state, tool, result, durationMs, success) =>
      Effect.all([
        publishReasoningStep(eventBus, {
          _tag: "ReasoningStepCompleted",
          taskId: state.taskId,
          strategy: state.strategy,
          step: state.steps.length + 1,
          totalSteps: 0,
          observation: result,
          kernelPass: (state.meta.kernelPass as string) ?? `${state.strategy}:main`,
        }),
        // Single source of ToolCallCompleted — fixes double metrics bug
        publishReasoningStep(eventBus, {
          _tag: "ToolCallCompleted",
          taskId: state.taskId,
          toolName: tool,
          callId: state.steps[state.steps.length - 1]?.id ?? "unknown",
          durationMs,
          success,
          kernelPass: (state.meta.kernelPass as string) ?? `${state.strategy}:main`,
        }),
      ]).pipe(Effect.asVoid),

    onDone: (state, output) =>
      publishReasoningStep(eventBus, {
        _tag: "FinalAnswerProduced",
        taskId: state.taskId,
        strategy: state.strategy,
        answer: output,
        iteration: state.iteration,
        totalTokens: state.tokens,
        kernelPass: (state.meta.kernelPass as string) ?? `${state.strategy}:main`,
      }),

    onError: (_state, _error) => Effect.void,
  };
}
```

**Step 2: Update shared/index.ts**

```typescript
export * from "./kernel-hooks.js";
```

**Step 3: Write tests**

Create `packages/reasoning/tests/strategies/shared/kernel-hooks.test.ts`:
- Test hooks fire correct EventBus events with correct shape
- Test hooks are no-op when EventBus is None
- Test onObservation fires both ReasoningStepCompleted AND ToolCallCompleted

**Step 4: Run tests**

```bash
bun test packages/reasoning/tests/strategies/shared/kernel-hooks.test.ts
```

**Step 5: Commit**

```bash
git add packages/reasoning/src/strategies/shared/kernel-hooks.ts packages/reasoning/src/strategies/shared/index.ts packages/reasoning/tests/strategies/shared/kernel-hooks.test.ts
git commit -m "feat(reasoning): KernelHooks — centralized EventBus wiring for all kernels"
```

---

### Task 4: Build KernelRunner

**Files:**
- Create: `packages/reasoning/src/strategies/shared/kernel-runner.ts`
- Modify: `packages/reasoning/src/strategies/shared/index.ts`

**Step 1: Create kernel-runner.ts**

The universal execution loop. This is the core of the refactor.

```typescript
// packages/reasoning/src/strategies/shared/kernel-runner.ts

import { Effect } from "effect";
import type { LLMService } from "@reactive-agents/llm-provider";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import { ExecutionError } from "../../errors/errors.js";
import type { ContextProfile } from "../../context/context-profile.js";
import { CONTEXT_PROFILES } from "../../context/context-profile.js";
import { resolveStrategyServices } from "./service-utils.js";
import { buildKernelHooks } from "./kernel-hooks.js";
import { parseBareToolCall } from "./tool-utils.js";
import { executeToolCall, makeObservationResult } from "./tool-execution.js";
import { makeStep } from "./step-utils.js";
import {
  initialKernelState,
  transitionState,
  type KernelState,
  type KernelContext,
  type KernelInput,
  type KernelRunOptions,
  type ThoughtKernel,
  type MaybeService,
  type ToolServiceInstance,
} from "./kernel-state.js";

/**
 * Run any ThoughtKernel to completion with full observability integration.
 *
 * This is the single execution loop that replaces the duplicated while-loops
 * in reactive.ts (~500 lines) and react-kernel.ts (~490 lines).
 *
 * Responsibilities:
 * 1. Initialize KernelState
 * 2. Build KernelContext with hooks wired to EventBus/observability
 * 3. Loop: call kernel(state, context) until done/failed/max iterations
 * 4. Embedded tool call guard: if output contains a bare tool call, execute it
 * 5. Return final KernelState
 */
export function runKernel(
  kernel: ThoughtKernel,
  input: KernelInput,
  options: KernelRunOptions,
): Effect.Effect<KernelState, ExecutionError, LLMService> {
  return Effect.gen(function* () {
    // Resolve services
    const services = yield* resolveStrategyServices;
    const { toolService, eventBus } = services;

    // Build profile
    const profile: ContextProfile = input.contextProfile
      ? ({ ...CONTEXT_PROFILES["mid"], ...input.contextProfile } as ContextProfile)
      : CONTEXT_PROFILES["mid"];

    const compression: ResultCompressionConfig = input.resultCompression ?? {};

    // Build hooks
    const hooks = buildKernelHooks(eventBus);

    // Build context (frozen for entire execution)
    const context: KernelContext = {
      input,
      profile,
      compression,
      toolService: toolService as MaybeService<ToolServiceInstance>,
      hooks,
    };

    // Initialize state
    let state = initialKernelState({
      taskId: options.taskId ?? options.strategy,
      strategy: options.strategy,
      kernelType: options.kernelType,
      meta: {
        ...options.meta,
        kernelPass: options.kernelPass ?? `${options.strategy}:main`,
      },
    });

    const maxIter = options.maxIterations;

    // ── Main loop ───────────────────────────────────────────────────────
    while (
      state.status !== "done" &&
      state.status !== "failed" &&
      state.iteration < maxIter
    ) {
      state = yield* kernel(state, context);
    }

    // ── Post-completion: embedded tool call guard ────────────────────────
    // If the kernel said "done" but the output looks like a bare tool call
    // (e.g., "signal/send_message({...})"), execute it and use the
    // observation as the real output. Fixes the raw-tool-call-in-output bug.
    if (state.status === "done" && state.output) {
      const embeddedToolCall = parseBareToolCall(state.output);
      if (embeddedToolCall) {
        // Fire action hook
        yield* hooks.onAction(state, embeddedToolCall.tool, embeddedToolCall.input);

        // Execute the tool
        const toolStartMs = Date.now();
        const toolResult = yield* executeToolCall(
          context.toolService,
          embeddedToolCall,
          {
            profile,
            compression,
            scratchpad: state.scratchpad,
            agentId: input.agentId,
            sessionId: input.sessionId,
          },
        );
        const toolDurationMs = Date.now() - toolStartMs;

        // Fire observation hook
        yield* hooks.onObservation(
          state,
          embeddedToolCall.tool,
          toolResult.content,
          toolDurationMs,
          toolResult.observationResult.success,
        );

        // Update state with the tool execution steps and clean output
        const actionStep = makeStep("action", JSON.stringify(embeddedToolCall), {
          toolUsed: embeddedToolCall.tool,
          duration: toolDurationMs,
        });
        const obsStep = makeStep("observation", toolResult.content, {
          observationResult: toolResult.observationResult,
        });

        state = transitionState(state, {
          steps: [...state.steps, actionStep, obsStep],
          toolsUsed: new Set([...state.toolsUsed, embeddedToolCall.tool]),
          output: toolResult.content,
        });
      }
    }

    // Fire done/error hook
    if (state.status === "done" && state.output) {
      yield* hooks.onDone(state, state.output);
    } else if (state.status === "failed" && state.error) {
      yield* hooks.onError(state, state.error);
    }

    return state;
  });
}
```

**Step 2: Update shared/index.ts**

```typescript
export * from "./kernel-runner.js";
```

**Step 3: Write tests for kernel-runner.ts**

Create `packages/reasoning/tests/strategies/shared/kernel-runner.test.ts`:

Tests needed:
- `runKernel` with a trivial kernel that returns done immediately — verify state shape
- `runKernel` with a multi-step kernel — verify iteration counting
- `runKernel` hits max iterations — verify state.status stays "thinking"
- `runKernel` with embedded tool call in output — verify tool executed and output cleaned
- `runKernel` fires hooks in correct order (thought → action → observation → done)
- `runKernel` with failed kernel — verify error hook fires

**Step 4: Run tests**

```bash
bun test packages/reasoning/tests/strategies/shared/kernel-runner.test.ts
```

**Step 5: Commit**

```bash
git add packages/reasoning/src/strategies/shared/kernel-runner.ts packages/reasoning/src/strategies/shared/index.ts packages/reasoning/tests/strategies/shared/kernel-runner.test.ts
git commit -m "feat(reasoning): KernelRunner — universal execution loop with embedded tool call guard"
```

---

### Task 5: Rewrite react-kernel.ts as ThoughtKernel

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts`
- Modify: `packages/reasoning/tests/strategies/shared/react-kernel.test.ts`

**Step 1: Rewrite react-kernel.ts**

Transform the current `executeReActKernel()` (490 lines with loop) into:

1. **`reactKernel: ThoughtKernel`** — a single-step transition function (~200 lines). Given state in "thinking" status, it:
   - Builds context via `buildCompactedContext()`
   - Calls LLM
   - Strips thinking blocks
   - Parses tool requests / final answer
   - Returns new state with status "acting" (if tool found), "done" (if final answer), or stays "thinking"
   - When status is "acting", executes the tool and returns state with status "thinking" (next iteration) or "done" (if post-action FINAL ANSWER)

2. **`executeReActKernel()`** — backwards-compatible wrapper that calls `runKernel(reactKernel, ...)` and maps the result to the existing `ReActKernelResult` shape. This preserves the API for reflexion.ts, tree-of-thought.ts, etc. during Phase 1.

Key: the wrapper translates between the old `ReActKernelInput` → `KernelInput` and `KernelState` → `ReActKernelResult`. Old callers don't change.

**Step 2: Update react-kernel tests**

The existing `packages/reasoning/tests/strategies/shared/react-kernel.test.ts` tests call `executeReActKernel()` — these should continue to pass without changes since the wrapper preserves the API.

Add new tests:
- Test `reactKernel` directly as a ThoughtKernel — verify single-step transitions
- Test thinking extraction within kernel step
- Test tool request parsing within kernel step
- Test final answer detection within kernel step

**Step 3: Build and run all tests**

```bash
bun run build && bun test
```
Expected: All 1296+ tests pass. No behavioral changes.

**Step 4: Commit**

```bash
git add packages/reasoning/src/strategies/shared/react-kernel.ts packages/reasoning/tests/strategies/shared/react-kernel.test.ts
git commit -m "feat(reasoning): reactKernel as ThoughtKernel — single-step transition, backwards-compat wrapper"
```

---

### Task 6: Collapse reactive.ts

**Files:**
- Modify: `packages/reasoning/src/strategies/reactive.ts`

**Step 1: Rewrite reactive.ts as thin wrapper**

Replace the ~905 line file with ~80 lines:

1. `executeReactive` calls `runKernel(reactKernel, toKernelInput(input), options)` then maps `KernelState` to `ReasoningResult` via `buildStrategyResult()`.

2. `toKernelInput()` helper maps `ReactiveInput` → `KernelInput` (field mapping).

3. Re-exports for backwards compatibility:
   - `parseToolRequestWithTransform` — already re-exported from tool-utils
   - `compressToolResult`, `evaluateTransform` — already re-exported from tool-utils
   - `truncateForDisplay` — re-export from tool-execution
   - `CompressResult` type — already re-exported from tool-utils

4. The reactive-specific prompt building (`buildInitialContext`, `buildThoughtPrompt`, `getRulesForComplexity`, `SIMPLIFIED_RULES`, `STANDARD_RULES`, `DETAILED_RULES`, `buildCompletedSummary`) moves into the reactKernel itself (already in react-kernel.ts from Task 5). The reactive.ts file just delegates.

**Step 2: Run all tests**

```bash
bun run build && bun test
```

Expected: All 1296+ tests pass. The following test files import `executeReactive` from reactive.ts and must continue to work:
- `reactive.test.ts`
- `reactive-tool-integration.test.ts`
- `reactive-tool-filtering.test.ts`
- `reactive-context-engineering.test.ts`
- `reactive-events.test.ts`
- `reactive-compression.test.ts` (imports `compressToolResult`, `parseToolRequestWithTransform`, `evaluateTransform`)
- `model-context-verification.test.ts`
- `strategy-threading.test.ts`

**Step 3: Commit**

```bash
git add packages/reasoning/src/strategies/reactive.ts
git commit -m "feat(reasoning): collapse reactive.ts — 905 lines → ~80 lines via runKernel(reactKernel)"
```

---

### Task 7: Update reflexion.ts to use runKernel

**Files:**
- Modify: `packages/reasoning/src/strategies/reflexion.ts`

**Step 1: Replace `executeReActKernel` calls with `runKernel`**

Reflexion currently calls `executeReActKernel()` for generate and improve passes. Replace with `runKernel(reactKernel, ...)`:

```typescript
// Generate pass
const genState = yield* runKernel(reactKernel, toKernelInput(input), {
  maxIterations,
  strategy: "reflexion",
  kernelType: "react",
  kernelPass: "reflexion:generate",
  taskId: input.taskId,
});

// Map to output
let currentResponse = genState.output ?? "";
let lastKernelSteps = [...genState.steps];
let allSideEffectSteps = [...genState.steps];
totalTokens += genState.tokens;
totalCost += genState.cost;
```

For improvement passes, pass `blockedTools` via `KernelInput`:
```typescript
const improveState = yield* runKernel(reactKernel, {
  ...toKernelInput(input),
  blockedTools: extractSuccessfulSideEffectTools(allSideEffectSteps),
  priorContext: improveContext,
}, {
  maxIterations,
  strategy: "reflexion",
  kernelType: "react",
  kernelPass: `reflexion:improve-${attempt}`,
  taskId: input.taskId,
});
```

The side-effect tracking (`allSideEffectSteps`, `isSideEffectTool`, `extractSuccessfulSideEffectTools`, `lastKernelSteps` preservation) stays in reflexion.ts — it's strategy-level policy, not kernel logic.

**Step 2: Run tests**

```bash
bun run build && bun test
```
Expected: All reflexion tests pass.

**Step 3: Commit**

```bash
git add packages/reasoning/src/strategies/reflexion.ts
git commit -m "refactor(reasoning): reflexion uses runKernel for generate/improve passes"
```

---

### Task 8: Update tree-of-thought and adaptive

**Files:**
- Modify: `packages/reasoning/src/strategies/tree-of-thought.ts`
- Modify: `packages/reasoning/src/strategies/adaptive.ts`

**Step 1: Update tree-of-thought Phase 2 execution**

Tree-of-thought currently calls `executeReActKernel()` for Phase 2 (tool execution on best path). Replace with `runKernel(reactKernel, ...)`.

**Step 2: Update adaptive.ts imports**

Adaptive dispatches to `executeReactive()` which is now a thin wrapper — no code change needed, just verify it works. If adaptive imports `executeReActKernel` directly anywhere, update to use the wrapper.

**Step 3: Run tests**

```bash
bun run build && bun test
```
Expected: All ToT and adaptive tests pass.

**Step 4: Commit**

```bash
git add packages/reasoning/src/strategies/tree-of-thought.ts packages/reasoning/src/strategies/adaptive.ts
git commit -m "refactor(reasoning): tree-of-thought and adaptive use kernel architecture"
```

---

### Task 9: Fix double tool metrics in execution engine

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts`

**Step 1: Identify the double-count source**

Current behavior: Both the reasoning strategy (via EventBus `ToolCallCompleted`) AND the execution engine (line ~818, direct `obs.recordToolCall()`) record tool metrics. The kernel hooks now fire `ToolCallCompleted` as the single source of truth.

Fix:
- Remove the manual `obs.recordToolCall()` loop at line ~818 in the reasoning path (the `syntheticToolResults` loop).
- The execution engine's non-reasoning path (direct tool execution, lines ~1223 and ~1268) keeps its `ToolCallCompleted` publish — those aren't duplicated.

**Step 2: Verify the `[act]` summary line still works**

The `[act]` log line (line ~788) reads from `actionSteps.map(s => s.metadata?.toolUsed)`. This comes from the ReasoningResult steps — unaffected by the metrics fix.

**Step 3: Run tests**

```bash
bun run build && bun test
```
Expected: Feature contract tests and all runtime tests pass.

**Step 4: Commit**

```bash
git add packages/runtime/src/execution-engine.ts
git commit -m "fix(runtime): remove double tool metrics — KernelHooks is single source of ToolCallCompleted"
```

---

### Task 10: Integration verification + strategy registry update

**Files:**
- Modify: `packages/reasoning/src/services/strategy-registry.ts`
- Modify: `packages/runtime/tests/feature-contract.test.ts` (if needed)

**Step 1: Add kernel registration to StrategyRegistry**

Add `registerKernel` method to the registry for custom kernels:

```typescript
// In StrategyRegistry service interface:
readonly registerKernel: (
  name: string,
  kernel: ThoughtKernel,
) => Effect.Effect<void>;

readonly getKernel: (
  name: string,
) => Effect.Effect<ThoughtKernel, StrategyNotFoundError>;
```

In the Live layer, add a second Ref for kernels:
```typescript
const kernelRef = yield* Ref.make<Map<string, ThoughtKernel>>(
  new Map([["react", reactKernel]]),
);
```

**Step 2: Full test suite**

```bash
bun run build && bun test
```
Expected: All 1296+ tests pass.

**Step 3: Integration test with real model**

```bash
bun test.ts
```
Expected:
- Adaptive selects reactive
- Tool calls execute (github/list_commits, signal/send_message_to_user)
- Output is CLEAN (not raw tool call text)
- Tool metrics show correct count (no doubles)
- Signal message delivered
- Observability logs unchanged

**Step 4: Commit**

```bash
git add packages/reasoning/src/services/strategy-registry.ts
git commit -m "feat(reasoning): StrategyRegistry supports custom kernel registration"
```

---

### Task 11: Documentation updates

**Files:**
- Modify: `CLAUDE.md` — update Strategy SDK Refactor section, add Composable Kernel Architecture section
- Modify: `CHANGELOG.md` — add entry for kernel architecture
- Modify: `spec/docs/03-layer-reasoning.md` — if it describes strategy internals

**Step 1: Update CLAUDE.md**

Add to Project Status:
```
- Composable Kernel Architecture: ThoughtKernel abstraction — swappable reasoning algorithms, immutable KernelState, universal KernelRunner with centralized hooks, reactive.ts collapsed from 905→~80 lines, shared tool-execution module, embedded tool call guard, double metrics fix (XXXX tests, YYY files)
```

**Step 2: Update CHANGELOG.md**

```markdown
## [Unreleased]

### Added
- **Composable Kernel Architecture** — `ThoughtKernel` type for swappable reasoning algorithms
  - `KernelState` — immutable, serializable reasoning state enabling collective learning
  - `KernelRunner` — universal execution loop replacing duplicated while-loops
  - `KernelHooks` — centralized EventBus/observability/metrics wiring (replaces 20+ scattered calls)
  - `reactKernel` — ReAct algorithm as first ThoughtKernel implementation
  - Custom kernel registration via `StrategyRegistry.registerKernel()`
  - Shared `tool-execution.ts` — single implementation replacing ~260 lines of duplication

### Fixed
- **Output containing raw tool call text** — embedded tool call guard in KernelRunner
- **Double tool metrics** — KernelHooks.onObservation is single source of ToolCallCompleted

### Changed
- `reactive.ts` collapsed from ~905 lines to ~80 lines (delegates to KernelRunner)
- `reflexion.ts` uses `runKernel()` for generate/improve passes
- `tree-of-thought.ts` uses `runKernel()` for Phase 2 execution
```

**Step 3: Commit all docs**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: update CLAUDE.md and CHANGELOG for composable kernel architecture"
```

---

### Task 12: Final verification

**Step 1: Full build**

```bash
bun run build
```

**Step 2: Full test suite**

```bash
bun test
```
Expected: All tests pass (1296+ existing + ~30 new kernel tests).

**Step 3: Integration test**

```bash
bun test.ts
```
Expected: Clean output, single tool metrics, Signal message delivered.

**Step 4: Review file changes**

Verify:
- `reactive.ts` is ~80 lines (was 905)
- `react-kernel.ts` exports both `reactKernel` (ThoughtKernel) and `executeReActKernel` (backwards compat)
- `tool-execution.ts` has single implementation of all tool helpers
- `kernel-state.ts` has all types + serialization
- `kernel-runner.ts` has the universal loop
- `kernel-hooks.ts` has centralized EventBus wiring
- No `ToolCallCompleted` published from inside strategies (only from hooks)
- All re-exports from `reactive.ts` preserved for backwards compatibility

---

## Summary

| Task | What | New/Changed Files | Risk |
|------|------|------------------|------|
| 1 | KernelState types | kernel-state.ts (NEW) | None — types only |
| 2 | Shared tool execution | tool-execution.ts (NEW) | Low — pure extraction |
| 3 | KernelHooks wiring | kernel-hooks.ts (NEW) | Low — wraps existing publishReasoningStep |
| 4 | KernelRunner loop | kernel-runner.ts (NEW) | Medium — new code, but well-specified |
| 5 | reactKernel as ThoughtKernel | react-kernel.ts (REWRITE) | Medium — backwards compat wrapper needed |
| 6 | Collapse reactive.ts | reactive.ts (REWRITE) | Medium — most test files import from here |
| 7 | Reflexion uses runKernel | reflexion.ts (UPDATE) | Low — API preserved via wrapper in Task 5 |
| 8 | ToT + adaptive updates | tree-of-thought.ts, adaptive.ts (UPDATE) | Low — minimal changes |
| 9 | Fix double metrics | execution-engine.ts (UPDATE) | Low — remove one code path |
| 10 | Registry + integration | strategy-registry.ts (UPDATE) | Low — additive |
| 11 | Documentation | CLAUDE.md, CHANGELOG.md | None |
| 12 | Final verification | — | None |

**Net effect:** ~800 lines of duplication eliminated. 3 new shared modules. 1 rewritten strategy. 2 bug fixes. Full backwards compatibility. Foundation for swappable reasoning algorithms, collective learning, and model-adaptive dispatch.
