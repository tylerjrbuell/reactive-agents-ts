---
name: recipe-saas-agent
description: Full recipe for a production-ready SaaS agent with guardrails, per-user cost isolation, rate limiting, A2A exposure, audit logging, and graceful error handling.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "recipe"
---

# Recipe: Production SaaS Agent

## What this builds

A production-ready agent designed for multi-tenant SaaS deployment. Includes prompt injection protection, per-user cost tracking, behavioral contracts, rate limiting, circuit breakers, A2A networking, and full audit logging.

## Skills loaded by this recipe

- `identity-and-guardrails` — injection detection, PII masking, behavioral contracts
- `cost-budget-enforcement` — per-request and daily cost limits, rate limiting
- `observability-instrumentation` — audit logging, minimal verbosity
- `a2a-agent-networking` — A2A server exposure for service mesh
- `reasoning-strategy-selection` — adaptive strategy

## Complete implementation

```ts
import { ReactiveAgents } from "@reactive-agents/runtime";

export async function createSaaSAgent(userId: string, plan: "free" | "pro" | "enterprise") {
  const budgets = {
    free:       { perSession: 0.10, daily: 0.50 },
    pro:        { perSession: 0.50, daily: 5.00 },
    enterprise: { perSession: 2.00, daily: 50.00 },
  }[plan];

  return ReactiveAgents.create()
    .withName(`saas-agent-${userId}`)
    .withProvider("anthropic")
    .withReasoning({
      defaultStrategy: "adaptive",
      maxIterations: 15,
    })
    .withTools({
      allowedTools: ["web-search", "http-get", "checkpoint", "final-answer"],
    })
    .withGuardrails({
      injection: true,      // block prompt injection attacks
      pii: true,            // mask PII in inputs and outputs
      toxicity: true,
    })
    .withBehavioralContracts({
      deniedTools: ["file-write", "shell-execute", "code-execute"],
      maxToolCalls: 30,
      maxIterations: 15,
      maxOutputLength: 10_000,
      requireDisclosure: true,
    })
    .withCostTracking(budgets)
    .withRateLimiting({
      requestsPerMinute: plan === "free" ? 10 : 60,
      tokensPerMinute:   plan === "free" ? 10_000 : 100_000,
      maxConcurrent:     plan === "free" ? 1 : 5,
    })
    .withCircuitBreaker({
      failureThreshold: 5,
      windowMs: 60_000,
      retryAfterMs: 30_000,
    })
    .withIdentity()
    .withAudit()
    .withObservability({
      verbosity: "minimal",            // silent in production — results returned programmatically
      file: `./logs/users/${userId}.jsonl`,
    })
    .withA2A({ port: 8000 })           // expose for internal service mesh
    .build();
}

// Usage per request:
app.post("/api/chat", async (req, res) => {
  const { userId, plan, prompt } = req.body;
  const agent = await createSaaSAgent(userId, plan);
  try {
    const result = await agent.run(prompt);
    res.json({ output: result.output, cost: result.cost });
  } catch (error) {
    if (error.name === "BudgetExceededError") {
      res.status(429).json({ error: "Usage limit reached. Upgrade your plan." });
    } else if (error.name === "GuardrailViolation") {
      res.status(400).json({ error: "Request blocked by safety filter." });
    } else {
      res.status(500).json({ error: "Agent error." });
    }
  } finally {
    await agent.dispose();
  }
});
```

## Per-user agent pattern

For SaaS, build one agent per request (not shared) to ensure isolation:

```ts
// ✅ Per-request — isolated context, separate cost tracking
app.post("/api/chat", async (req, res) => {
  const agent = await createSaaSAgent(req.body.userId, req.body.plan);
  const result = await agent.run(req.body.prompt);
  await agent.dispose();
  res.json({ output: result.output });
});

// ❌ Shared agent — users could see each other's conversation context
const sharedAgent = await createSaaSAgent("shared", "pro");
app.post("/api/chat", async (req, res) => {
  const result = await sharedAgent.run(req.body.prompt); // UNSAFE
  res.json({ output: result.output });
});
```

## Streaming for SaaS

```ts
import { AgentStream } from "@reactive-agents/runtime";

app.post("/api/stream", async (req, res) => {
  const { userId, plan, prompt } = req.body;
  const agent = await createSaaSAgent(userId, plan);

  // SSE streaming response
  res.setHeader("Content-Type", "text/event-stream");
  try {
    const stream = agent.runStream(prompt);
    for await (const event of stream) {
      if (event.type === "TextDelta") {
        res.write(`data: ${JSON.stringify({ text: event.content })}\n\n`);
      }
      if (event.type === "StreamCompleted") break;
    }
  } finally {
    res.end();
    await agent.dispose();
  }
});
```

## Error types to handle

| Error | Cause | Response |
|-------|-------|----------|
| `BudgetExceededError` | Cost or token limit hit | 429 — prompt to upgrade |
| `GuardrailViolation` | Injection / PII / toxicity detected | 400 — blocked by safety |
| `ContractViolation` | Behavioral contract exceeded | 400 — usage policy exceeded |
| `CircuitBreakerOpenError` | Provider failures | 503 — retry after delay |
| `RateLimitError` | Requests/tokens per minute exceeded | 429 — retry after delay |

## Pitfalls

- Build agents per-request, not at server startup — module-level agents share context across users
- `.withA2A({ port: 8000 })` is for internal service mesh use — do not expose the A2A port publicly without authentication
- `verbosity: "minimal"` suppresses all console output — ensure `file` logging is configured, or errors will be invisible
- `requireDisclosure: true` requires the agent to state it is an AI in its first response — test this in your system prompt
- `pii: true` masks PII before it reaches the LLM — if your agent legitimately processes PII (e.g., user profile management), disable this detector selectively
