---
title: Agent Lifecycle
description: The 10-phase execution engine that powers every agent — now fully wired to all services.
---

Every task an agent processes flows through a deterministic 10-phase lifecycle. This is the core of the ExecutionEngine — and every phase is wired to its corresponding service when enabled.

## Phase Diagram

```
  ┌──────────┐
  │ BOOTSTRAP│ ← Load memory context, build system prompt
  └────┬─────┘
       │
  ┌────▼─────┐
  │ GUARDRAIL│ ← GuardrailService.check() — blocks unsafe input
  └────┬─────┘
       │
  ┌────▼──────┐
  │ COST_ROUTE│ ← CostService.routeToModel() — select optimal tier
  └────┬──────┘
       │
  ┌────▼───────────┐
  │ STRATEGY_SELECT│ ← Choose reasoning strategy (or direct LLM)
  └────┬───────────┘
       │
  ┌────▼──┐    ┌─────┐    ┌────────┐
  │ THINK │───►│ ACT │───►│OBSERVE │──┐
  └───────┘    └─────┘    └────────┘  │
       ▲                              │
       └──────────────────────────────┘  (loop until done)
       │
  ┌────▼───┐
  │ VERIFY │ ← VerificationService.verify() — fact-check output
  └────┬───┘
       │
  ┌────▼────────┐
  │ MEMORY_FLUSH│ ← MemoryService.flush() + snapshot()
  └────┬────────┘
       │
  ┌────▼──────┐
  │ COST_TRACK│ ← CostService.recordCost() — log spend
  └────┬──────┘
       │
  ┌────▼────┐
  │  AUDIT  │ ← ObservabilityService.info() — audit trail
  └────┬────┘
       │
  ┌────▼─────┐
  │ COMPLETE │ ← Build TaskResult with output + metadata
  └──────────┘
```

## Phase Details

### 1. Bootstrap

Loads memory context for the agent:
- Retrieves semantic entries from the memory database
- Loads the last session snapshot for continuity
- Generates a markdown projection of relevant knowledge
- Injects context into the system prompt

Always runs. If memory is disabled, produces an empty context string.

### 2. Guardrail (optional)

Calls `GuardrailService.check(inputText)` on the user's input:
- Injection detection, PII scanning, toxicity filtering, contract validation
- If `result.passed` is `false`, throws `GuardrailViolationError` and stops execution
- The LLM never sees unsafe input

Requires: `.withGuardrails()`

### 3. Cost Route (optional)

Calls `CostService.routeToModel(task)` to analyze task complexity:
- Simple tasks route to cheaper models (Haiku)
- Complex tasks route to more capable models (Opus)
- Selection stored in context for the Think phase

Requires: `.withCostTracking()`

### 4. Strategy Select

Chooses how the agent will reason:
- If `.withReasoning()` is enabled, uses the configured strategy (ReAct, Reflexion, etc.)
- Otherwise defaults to a direct LLM loop with tool calling support

### 5. Think / Act / Observe (Agent Loop)

The core reasoning loop, which runs differently based on strategy:

**With Reasoning (ReAct example):**
- **Think**: LLM generates thoughts and actions
- **Act**: Actions parsed, tools executed via ToolService
- **Observe**: Real tool results fed back as observations
- Loop until `FINAL ANSWER:` or max iterations

**Without Reasoning (Direct LLM):**
- **Think**: LLM called with messages + tool definitions
- **Act**: If `stopReason: "tool_use"`, tools executed
- **Observe**: Tool results appended to message history
- Loop until LLM returns without requesting tools

**Token tracking**: After each LLM call, `response.usage.totalTokens` is accumulated in the execution context.

**Context window management**: Before each LLM call, messages are truncated via `ContextWindowManager.truncate()` to stay within token limits.

**Memory integration**: During the Observe phase, tool results are logged as episodic memories via `MemoryService.logEpisode()`.

### 6. Verify (optional)

Calls `VerificationService.verify(response, input)`:
- Runs semantic entropy, fact decomposition, self-consistency, and NLI checks
- Stores `verificationScore` and `riskLevel` in context metadata
- Score and risk available via lifecycle hooks

Requires: `.withVerification()`

### 7. Memory Flush

Persists the session:
- Calls `MemoryService.snapshot()` to save session state
- Calls `MemoryService.flush()` to generate the memory.md projection
- Stores messages, key decisions, and cost data for future context

### 8. Cost Track (optional)

Calls `CostService.recordCost()` with accumulated token/cost data:
- Records model tier, token counts, latency, and estimated cost
- Updates budget tracking (per-session, daily, monthly)

Requires: `.withCostTracking()`

### 9. Audit (optional)

Logs an audit trail entry via `ObservabilityService.info()`:
- Task summary with ID, agent, iterations, tokens used
- Cost, strategy, duration, and completion status
- Full audit trail for compliance and debugging

Requires: `.withObservability()` or `.withAudit()`

### 10. Complete

Builds the final `TaskResult`:
- `output`: The agent's response text
- `success`: Whether the task completed without errors
- `metadata`: Duration, cost, tokens used, strategy, step count

## Observability Integration

When `.withObservability()` is enabled, every phase is wrapped in a trace span:

```
execution.phase.bootstrap      → span with taskId, agentId attributes
execution.phase.guardrail      → span with phase timing
execution.phase.think          → span with LLM latency
...
```

Counters are incremented on phase completion/error, and durations are recorded as histogram metrics. You get full distributed tracing across the entire lifecycle.

## Lifecycle Hooks

Every phase supports three hook timings:

| Timing | When | Use Case |
|--------|------|----------|
| `before` | Before phase executes | Modify context, add data, log |
| `after` | After phase completes | Transform output, record metrics |
| `on-error` | When phase fails | Custom error handling, alerting |

```typescript
agent.withHook({
  phase: "think",
  timing: "before",
  handler: (ctx) => {
    console.log(`Iteration ${ctx.iteration}, tokens: ${ctx.tokensUsed}, cost: $${ctx.cost}`);
    return Effect.succeed(ctx);
  },
});
```

## Agent States

```
idle → bootstrapping → running → [paused] → [verifying] → flushing → completed
                                                                     → failed
```
