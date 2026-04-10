---
name: kernel-extension
description: Add new behavior to the composable kernel — new Phase, Guard, MetaTool, or custom kernel variant. Use when extending agent reasoning, adding tool call filtering, or building a custom kernel for a new strategy.
user-invocable: false
---

# Kernel Extension — Composable Phase Architecture

## Decision Tree: What Are You Adding?

```
Does it need to READ the LLM response and TRANSFORM kernel state per-turn?
  YES → Phase

Does it need to BLOCK or MODIFY a specific tool call before execution?
  YES → Guard

Does it need to INTERCEPT a specific named tool call and return a synthetic result?
  YES → MetaTool entry in metaToolRegistry

Do you need a completely DIFFERENT phase pipeline for a new strategy?
  YES → Custom Kernel via makeKernel({ phases: [...] })
```

When in doubt: Guards are simpler than Phases. Phases are simpler than custom kernels.

## Adding a Phase

### File location

`packages/reasoning/src/strategies/kernel/phases/<name>.ts`

### Exact type signature (no deviations)

```typescript
import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { KernelState, KernelContext } from "../kernel-state.js";

export const myPhase = (
  state: KernelState,
  context: KernelContext,
): Effect.Effect<KernelState, never, LLMService> =>
  Effect.gen(function* () {
    // Read state — pure access, no mutation
    const lastStep = state.steps.at(-1);

    // Do work — yield* LLMService only if this is a think-equivalent phase
    // For non-LLM phases, use Effect.sync(() => ...) for pure transformations

    // Return FULL state — spread and override only what changed
    return {
      ...state,
      myNewField: "computed value",
    };
  });
```

### Wire into the kernel

```typescript
// In your strategy file or react-kernel.ts:
import { makeKernel } from "./react-kernel.js";
import { contextBuilder } from "./phases/context-builder.js";
import { think } from "./phases/think.js";
import { guard } from "./phases/guard.js";
import { act } from "./phases/act.js";
import { myPhase } from "./phases/my-phase.js";

// Insert your phase at the right position in the pipeline:
// - Before think: pre-processing, context enrichment
// - Between think and guard: post-LLM analysis
// - Between guard and act: pre-execution enrichment
// - After act: post-execution reflection
const kernel = makeKernel({
  phases: [contextBuilder, think, guard, myPhase, act],
});
```

### Rules

- Phases are pure functions of `(state, context)` → `Effect<state>`
- NEVER mutate `state` directly — always return a new object via spread
- NEVER add per-turn logic to `kernel-runner.ts` — that's what phases are for
- A phase that calls LLMService should be placed where `think.ts` is or alongside it

## Adding a Guard

### Location

`packages/reasoning/src/strategies/kernel/phases/guard.ts`

### Exact type signature

```typescript
import { Guard, GuardOutcome } from "../kernel-state.js";

export const myGuard: Guard = (
  toolCall: { name: string; input: unknown },
  state: KernelState,
  input: unknown,
): GuardOutcome =>
  // GuardOutcome MUST be exactly one of:
  //   { allow: true }
  //   { block: true; reason: string }
  toolCall.name === "forbidden-tool"
    ? { block: true, reason: "This tool is blocked by myGuard." }
    : { allow: true };
```

### Register for all strategies (default guards)

```typescript
// In guard.ts — add to defaultGuards array:
export const defaultGuards: Guard[] = [
  existingGuard1,
  deduplicationGuard,
  myGuard, // ← add here
];
```

### Register for a single strategy only

```typescript
// In your strategy file — pass a custom guards array:
const kernel = makeKernel({
  phases: [contextBuilder, think, guard, act],
  // custom guards passed via context — see KernelContext.guards
});
```

### Rules

- Guards are SYNCHRONOUS — no `Effect`, no `async`, no `yield*`
- Return exactly `{ allow: true }` or `{ block: true; reason: string }` — nothing else
- Guards run in array order; first `block` wins
- A blocked tool call is logged but does NOT end the run — the LLM gets the block reason and continues

## Adding a MetaTool

### Location

`packages/reasoning/src/strategies/kernel/phases/act.ts`

### Pattern

```typescript
// In act.ts, inside metaToolRegistry:
const metaToolRegistry: Record<string, MetaToolHandler> = {
  "pulse": pulseHandler,       // existing
  "brief": briefHandler,       // existing
  "my-meta-tool": async (args, state, context) => {
    // Receives the parsed tool call arguments
    // Returns a synthetic ToolResult — no real ToolService call
    const result = computeResult(args);
    return {
      content: JSON.stringify(result),
      success: true,
    };
  },
};
```

### When MetaTool vs real Tool

| Use | When |
|-----|------|
| MetaTool | Intercepts a known tool name, synthesizes result from in-memory state, no external I/O |
| Real Tool | Needs ToolService registration, may do HTTP/file/process I/O, follows `ToolDefinition` schema |

## Custom Kernel

Use when a strategy needs a fundamentally different phase sequence:

```typescript
import { makeKernel } from "./react-kernel.js";

// Compose only the phases you need:
export const myCustomKernel = makeKernel({
  phases: [contextBuilder, myThink, act],
  // Phases are executed in order, left to right, each turn
});

// Register as a ReasoningStrategy:
export const myStrategy: ReasoningStrategy = {
  name: "my-strategy",
  execute: (input) =>
    Effect.gen(function* () {
      const result = yield* myCustomKernel(input);
      return result;
    }),
};
```

## Testing a Phase

Every phase test needs a timeout. Use a mock LLMService layer.

```typescript
// tests/phases/my-phase.test.ts
// Run: bun test packages/reasoning/tests/phases/my-phase.test.ts --timeout 15000
import { Effect, Layer } from "effect";
import { describe, it, expect } from "bun:test";
import { myPhase } from "../../src/strategies/kernel/phases/my-phase.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { makeMockLLM } from "@reactive-agents/testing";

describe("myPhase", () => {
  const mockLLMLayer = Layer.succeed(LLMService, makeMockLLM({
    defaultResponse: "mock response",
  }));

  const makeState = (overrides = {}) => ({
    messages: [],
    steps: [],
    iteration: 0,
    status: "running" as const,
    ...overrides,
  });

  it("should transform state correctly", async () => {
    const state = makeState({ iteration: 1 });
    const context = { task: "test task", agentId: "agent-1" };

    const result = await myPhase(state, context).pipe(
      Effect.provide(mockLLMLayer),
      Effect.runPromise,
    );

    expect(result.myNewField).toBe("expected value");
  }, 15000);

  it("should not modify unrelated state fields", async () => {
    const state = makeState({ messages: [{ role: "user", content: "hi" }] });
    const context = { task: "test", agentId: "agent-1" };

    const result = await myPhase(state, context).pipe(
      Effect.provide(mockLLMLayer),
      Effect.runPromise,
    );

    // Phase should not touch fields it doesn't own
    expect(result.messages).toEqual(state.messages);
  }, 15000);
});
```

## Critical: Do NOT Touch

- `kernel-runner.ts` main loop — extend via phases, not inline logic
- `context-engine.ts` dead sections (`buildDynamicContext`, `buildStaticContext`, ~560–690 LOC) — disabled, do not re-enable
- `state.messages[]` via direct mutation — return new state object from phases
