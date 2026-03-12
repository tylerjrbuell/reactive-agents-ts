---
title: Lifecycle Hooks
description: Intercept and extend the 10-phase execution engine with custom hooks
---

# Lifecycle Hooks

Every agent execution flows through a deterministic 10-phase lifecycle. Hooks let you intercept any phase to add logging, metrics, validation, or custom behavior.

## Quick Example

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withHook({
    phase: "think",
    timing: "after",
    handler: (ctx) => {
      console.log(`Iteration ${ctx.metadata.stepsCount}`);
      return Effect.succeed(ctx);
    },
  })
  .build();
```

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
handler: (ctx: ExecutionContext) => Effect.Effect<ExecutionContext, HookError>
```

The handler receives the current `ExecutionContext` and must return it (possibly modified). The context includes:
- `metadata` — step count, strategy, tokens used
- `scratchpad` — key/value store shared across phases
- `taskId` — current task identifier

## Ordering

Hooks registered for the same phase and timing run **sequentially in registration order**. If a hook fails:
- `before` hook failure: the phase is skipped and the `on-error` hook runs
- `after` hook failure: logged but does not affect the phase result
- `on-error` hook failure: logged but does not mask the original error

## Practical Patterns

### Progress Logging

```typescript
.withHook({
  phase: "think",
  timing: "before",
  handler: (ctx) => {
    const step = ctx.metadata.stepsCount + 1;
    const max = ctx.metadata.maxIterations ?? 10;
    console.log(`Step ${step}/${max}`);
    return Effect.succeed(ctx);
  },
})
```

### Cost Alert

```typescript
.withHook({
  phase: "complete",
  timing: "after",
  handler: (ctx) => {
    if (ctx.metadata.cost > 0.10) {
      console.warn(`⚠ Execution cost $${ctx.metadata.cost.toFixed(3)} exceeded $0.10 threshold`);
    }
    return Effect.succeed(ctx);
  },
})
```

### Audit Trail

```typescript
.withHook({
  phase: "act",
  timing: "after",
  handler: (ctx) => {
    const toolName = ctx.scratchpad.get("_last_tool_name");
    auditLog.append({ event: "tool_call", tool: toolName, taskId: ctx.taskId, timestamp: Date.now() });
    return Effect.succeed(ctx);
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
    return Effect.succeed(ctx);
  },
})
```
