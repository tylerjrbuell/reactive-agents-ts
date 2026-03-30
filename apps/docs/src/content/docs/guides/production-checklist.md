---
title: "Production Deployment Checklist"
description: "Everything to enable before deploying Reactive Agents to production"
---

This checklist covers the builder methods and configuration options you should evaluate before deploying a Reactive Agents application to production. Each section is independent — enable the layers that match your threat model and reliability requirements.

## Security

### Guardrails

Guardrails screen every prompt and response for prompt injection, PII leakage, and toxic content. Enable with `.withGuardrails()`. Pass optional thresholds (0–1 scale) to tighten or relax detection sensitivity.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withGuardrails({
    thresholds: {
      injection: 0.8,
      pii: 0.7,
      toxicity: 0.9,
    },
  })
  .build();
```

A `GuardrailViolationDetected` event is emitted on the EventBus whenever a check fires, so violations surface in your observability pipeline automatically.

### Behavioral Contracts

Behavioral contracts constrain what the agent is allowed to do at runtime. Use a tool deny list to block dangerous tools, cap iterations, and restrict output patterns.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withBehavioralContracts({
    toolDenyList: ["shell-execute"],
    maxIterations: 20,
    outputPatterns: [],
  })
  .build();
```

### Identity and RBAC

Assign an identity to the agent so that downstream services, audit logs, and A2A protocol messages carry a verified agent ID and role.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withIdentity({ agentId: "prod-agent", role: "analyst" })
  .build();
```

### Tool Approval Gates

Mark high-risk tools as requiring human approval before execution. The agent will pause and emit an `ApprovalRequired` event; execution resumes once the gate is cleared.

```typescript
const dangerousTool = {
  name: "database-write",
  description: "Write records to the production database",
  requiresApproval: true,
  parameters: { /* ... */ },
  execute: async (params) => { /* ... */ },
};
```

### Tool Allowlist

Restrict the agent to a fixed set of tools. Any tool not in the list is invisible to the LLM and cannot be called, regardless of what the model requests.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools({ allowedTools: ["web-search", "file-read"] })
  .build();
```

---

## Reliability

### Kill Switch

The kill switch enables programmatic lifecycle control. Call `agent.stop()` for a graceful exit that completes the current step, or `agent.terminate()` for an immediate halt.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withKillSwitch()
  .build();

// Graceful stop from a signal handler or timeout
process.on("SIGTERM", () => agent.stop());
```

### Max Iterations

The default iteration cap is 10. Increase it for complex multi-step tasks, or lower it for latency-sensitive paths.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withMaxIterations(20)
  .build();
```

### Execution Timeout

Set a wall-clock timeout in milliseconds. The agent throws a `TimeoutError` if the run does not complete within the limit.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTimeout(60_000) // 60 seconds
  .build();
```

### Retry Policy

Configure automatic retries on transient failures (network errors, rate limits). Exponential backoff is applied between attempts.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withRetryPolicy({ maxAttempts: 3, backoffMs: 1000 })
  .build();
```

---

## Cost Control

### Budget Enforcement

Set per-request and daily token budgets. The agent performs a pre-flight budget check before each run and a per-iteration check during the ReAct loop. A `BudgetExceededError` is thrown on overspend.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withCostTracking({
    budget: {
      perRequest: 0.10,  // USD
      daily: 5.00,       // USD
    },
  })
  .build();

try {
  const result = await agent.run("Analyze the Q4 sales report");
} catch (e) {
  if (e instanceof BudgetExceededError) {
    console.error("Budget exceeded:", e.message);
    // escalate, alert, or degrade gracefully
  }
}
```

### Complexity Routing

With complexity routing enabled, simple queries are automatically routed to a cheaper model tier, reserving your primary model for tasks that need it.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withCostTracking({ complexityRouting: true })
  .build();
```

---

## Observability

### Metrics Dashboard

Enable the metrics dashboard to get a structured execution summary after every run: phase timing, tool call counts, token usage, estimated cost, and smart alerts.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withObservability({ verbosity: "normal", live: true })
  .build();
```

The dashboard is driven entirely by the EventBus. No manual instrumentation is required — `MetricsCollector` auto-subscribes to `ToolCallCompleted` and phase lifecycle events.

### Exporting Metrics

Call `agent.exportMetrics()` to retrieve metrics programmatically for forwarding to an external monitoring system (Prometheus, Datadog, etc.).

```typescript
const result = await agent.run("Process batch job");
const metrics = await agent.exportMetrics();

// Forward to your monitoring pipeline
await metricsClient.record({
  agentId: "prod-agent",
  duration: metrics.totalDurationMs,
  tokens: metrics.totalTokens,
  cost: metrics.estimatedCostUsd,
  steps: metrics.stepCount,
});
```

---

## Error Handling

### Global Error Handler

Register a handler to capture all agent errors in one place. The handler receives the error and a context object with task metadata for structured logging.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withErrorHandler((error, ctx) => {
    logger.error(error.message, {
      taskId: ctx.taskId,
      agentId: ctx.agentId,
      iteration: ctx.iteration,
    });
    metrics.increment("agent.error", { type: error.constructor.name });
  })
  .build();
```

### RuntimeErrors Union

`RuntimeErrors` is the exhaustive union of all errors the agent can throw. Use it for type-safe catch blocks.

```typescript
import { RuntimeErrors } from "@reactive-agents/runtime";

try {
  const result = await agent.run(prompt);
} catch (e) {
  const error = e as RuntimeErrors;
  switch (error._tag) {
    case "BudgetExceededError":
      // degrade gracefully or queue for later
      break;
    case "GuardrailViolation":
      // return a safe fallback response
      break;
    case "MaxIterationsError":
      // return partial result if available
      break;
    default:
      throw e;
  }
}
```

### Unwrapping Effect Errors

When running Effect-based code directly, use `unwrapError()` to extract a clean message from an Effect `FiberFailure`, and `errorContext()` to retrieve actionable remediation hints.

```typescript
import { unwrapError, errorContext } from "@reactive-agents/runtime";

try {
  const result = await agent.run(prompt);
} catch (raw) {
  const error = unwrapError(raw);
  const ctx = errorContext(raw);
  console.error(error.message);
  if (ctx?.suggestion) {
    console.info("Suggestion:", ctx.suggestion);
  }
}
```

---

## Memory

### Enhanced Memory

The `"enhanced"` memory tier activates semantic search, episodic recall, and procedural memory in addition to working memory. It requires embedding support — set `EMBEDDING_PROVIDER` and `EMBEDDING_MODEL` in your environment.

```bash
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
```

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withMemory({ tier: "enhanced" })
  .build();
```

### Memory Consolidation

Background consolidation merges and compacts memory entries over time, preventing unbounded growth and keeping retrieval quality high.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withMemory({ tier: "enhanced" })
  .withMemoryConsolidation()
  .build();
```

### Experience Learning

Cross-run experience learning stores task outcomes in the episodic layer and surfaces relevant prior experiences at the start of each new run, improving performance on repeated task types.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withMemory({ tier: "enhanced" })
  .withExperienceLearning()
  .build();
```

---

## Quick Reference

| Concern | Builder Method | Default | Production Recommendation |
|---|---|---|---|
| Prompt injection | `.withGuardrails()` | off | Enable |
| Cost limits | `.withCostTracking({ budget })` | off | Set per-request budget |
| Iteration limit | `.withMaxIterations(N)` | 10 | 20–50 for complex tasks |
| Min iterations | `.withMinIterations(N)` | none | 2–3 for research tasks |
| Output quality | `.withOutputValidator(fn)` | none | Validate structure for critical outputs |
| Answer verification | `.withVerificationStep()` | none | Enable for high-stakes decisions |
| Timeout | `.withTimeout(ms)` | none | 60\_000–300\_000 |
| Retry | `.withRetryPolicy()` | none | `{ maxAttempts: 3 }` |
| Observability | `.withObservability()` | off | Enable with `verbosity: "normal"` |
| Error handler | `.withErrorHandler()` | none | Set for logging/alerting |
| Kill switch | `.withKillSwitch()` | off | Enable for long-running agents |
