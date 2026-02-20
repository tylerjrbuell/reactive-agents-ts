---
title: Agent Lifecycle
description: The 10-phase execution engine that powers every agent.
---

Every task an agent processes flows through a deterministic 10-phase lifecycle. This is the core of the ExecutionEngine.

## Phase Diagram

```
  ┌──────────┐
  │ BOOTSTRAP│ ← Load memory context
  └────┬─────┘
       │
  ┌────▼─────┐
  │ GUARDRAIL│ ← Safety checks (optional)
  └────┬─────┘
       │
  ┌────▼──────┐
  │ COST_ROUTE│ ← Model selection (optional)
  └────┬──────┘
       │
  ┌────▼───────────┐
  │ STRATEGY_SELECT│ ← Choose reasoning strategy
  └────┬───────────┘
       │
  ┌────▼──┐    ┌─────┐    ┌────────┐
  │ THINK │───►│ ACT │───►│OBSERVE │──┐
  └───────┘    └─────┘    └────────┘  │
       ▲                              │
       └──────────────────────────────┘  (loop)
       │
  ┌────▼───┐
  │ VERIFY │ ← Fact-check output (optional)
  └────┬───┘
       │
  ┌────▼────────┐
  │ MEMORY_FLUSH│ ← Persist session
  └────┬────────┘
       │
  ┌────▼──────┐
  │ COST_TRACK│ ← Record budget (optional)
  └────┬──────┘
       │
  ┌────▼────┐
  │  AUDIT  │ ← Audit log (optional)
  └────┬────┘
       │
  ┌────▼─────┐
  │ COMPLETE │ ← Return result
  └──────────┘
```

## Phases in Detail

### 1. Bootstrap
Loads memory context for the agent. If the Memory layer is enabled, this retrieves semantic entries, session snapshots, and builds a context string injected into the system prompt.

### 2. Guardrail (optional)
Runs input through injection detection, PII scanning, toxicity checks, and contract validation. Fires before the LLM sees the input.

### 3. Cost Route (optional)
Uses the complexity router to select the optimal model tier (haiku/sonnet/opus) based on task complexity.

### 4. Strategy Select
Chooses a reasoning strategy. If the Reasoning layer is enabled, consults the StrategySelector. Otherwise defaults to "reactive" (direct LLM loop).

### 5. Think / Act / Observe (Agent Loop)
The core reasoning loop:
- **Think**: Call the LLM for a response
- **Act**: If tool calls are requested, execute them in the sandbox
- **Observe**: Append results to the message history
- Repeat until the LLM signals completion or max iterations reached

### 6. Verify (optional)
Runs the output through verification layers: semantic entropy, fact decomposition, self-consistency, and NLI scoring.

### 7. Memory Flush
Saves a session snapshot with messages, key decisions, and cost data for future context.

### 8. Cost Track (optional)
Records the task's token usage and cost against the session budget.

### 9. Audit (optional)
Writes an audit log entry for compliance and observability.

### 10. Complete
Builds the final `TaskResult` with output, success status, and metadata.

## Lifecycle Hooks

Every phase supports three hook timings:

| Timing | When | Use Case |
|--------|------|----------|
| `before` | Before phase executes | Modify context, add data |
| `after` | After phase completes | Log results, transform output |
| `on-error` | When phase fails | Custom error handling |

Hooks receive the `ExecutionContext` and can modify it:

```typescript
agent.withHook({
  phase: "think",
  timing: "before",
  handler: (ctx) => {
    console.log(`Iteration ${ctx.iteration}, cost so far: $${ctx.cost}`);
    return Effect.succeed(ctx);
  },
});
```

## Agent States

The agent transitions through these states:

```
idle → bootstrapping → running → [paused] → [verifying] → flushing → completed
                                                                    → failed
```
