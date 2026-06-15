---
title: Lifecycle Hooks
description: Intercept and extend the 12-phase execution engine with custom hooks
sidebar:
  order: 16
---

# Lifecycle Hooks

Every agent execution flows through a deterministic 12-phase lifecycle. Hooks let you intercept any phase to add logging, metrics, validation, or custom behavior.

:::tip[No Effect import required]
Hook handlers can be plain sync or `async` functions — no `Effect` import needed for most use cases. The Effect form is still accepted if you are already using Effect-TS elsewhere. See the [Effect-TS primer](/concepts/effect-ts/) for the full helper table.
:::

## Quick Example

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withHook({
    phase: "think",
    timing: "after",
    // Plain function — no Effect import needed.
    // Return nothing to observe, or return the (modified) context to change it.
    handler: (ctx) => {
      console.log(`Iteration ${ctx.metadata.stepsCount}`);
    },
  })
  .build();
```

:::note
Hook handlers can be plain sync functions, `async` functions, or return an
Effect. Return the (modified) context to change it, or return nothing to
observe. Throwing (or a rejected promise / failed Effect) raises a `HookError`.
:::

## Available Phases

| Phase | When It Runs | Common Hook Use Cases |
|-------|-------------|----------------------|
| `bootstrap` | Before anything else | Load external config, validate preconditions |
| `guardrail` | Input safety check | Log blocked inputs, custom filtering |
| `cost-route` | Model tier selection | Override routing decisions |
| `strategy` | Strategy selection | Log which strategy was chosen |
| `think` | Each reasoning iteration | Progress logging, custom metrics |
| `act` | Tool execution | Tool call tracking, audit logging |
| `observe` | Process tool results | Result validation, caching |
| `verify` | Output fact-checking | Custom verification logic |
| `memory-flush` | Persist memories | Custom memory operations |
| `complete` | Final result assembly | Post-processing, cleanup |

## Hook Timing

Each phase supports three timing points:

- **`before`** — Runs before the phase executes. Can modify the `ExecutionContext`.
- **`after`** — Runs after the phase completes successfully. Receives the updated context.
- **`on-error`** — Runs when the phase throws an error. Can log or clean up, but cannot prevent the error from propagating.

## Hook Handler Signature

```typescript
handler: (ctx: ExecutionContext) =>
  | ExecutionContext | void
  | Promise<ExecutionContext | void>
  | Effect.Effect<ExecutionContext, ExecutionError>
```

The handler receives the current `ExecutionContext`. Return the (possibly modified) context to change execution, or return nothing (`void`) to observe without side-effects. The Effect form is also accepted. Useful fields include:
- `metadata` — step count, strategy, last response, reasoning results (engine-populated)
- `toolResults` — tool execution results accumulated this run
- `messages` — conversation messages for the task
- `taskId` / `agentId` / `sessionId` — correlation identifiers

Agent-visible working memory is the **`recall`** meta-tool (Conductor's Suite), not a field on this context.

## Ordering

Hooks registered for the same phase and timing run **sequentially in registration order**. If a hook fails:
- `before` hook failure: the phase is skipped and the `on-error` hook runs
- `after` hook failure: logged but does not affect the phase result
- `on-error` hook failure: logged but does not mask the original error

## Practical Patterns

### Progress Logging

```typescript
// …then chain on your builder:
.withHook({
  phase: "think",
  timing: "before",
  handler: (ctx) => {
    const step = ctx.metadata.stepsCount + 1;
    const max = ctx.maxIterations ?? 10;
    console.log(`Step ${step}/${max}`);
    // Return nothing — just observing.
  },
})
```

### Cost Alert

```typescript
.withHook({
  phase: "complete",
  timing: "after",
  handler: (ctx) => {
    if (ctx.cost > 0.10) {
      console.warn(`⚠ Execution cost $${ctx.cost.toFixed(3)} exceeded $0.10 threshold`);
    }
    // Return nothing — just observing.
  },
})
```

### Audit Trail

```typescript
.withHook({
  phase: "act",
  timing: "after",
  handler: (ctx) => {
    const last = ctx.toolResults.at(-1) as { toolName?: string } | undefined;
    const toolName = last?.toolName ?? "unknown";
    auditLog.append({ event: "tool_call", tool: toolName, taskId: ctx.taskId, timestamp: Date.now() });
    // Return nothing — just observing.
  },
})
```

### Error Handling

```typescript
.withHook({
  phase: "think",
  timing: "on-error",
  handler: (ctx) => {
    console.error(`Think phase failed at step ${ctx.metadata.stepsCount}. Check your prompt or model.`);
    // Return nothing — just observing the error.
  },
})
```
