---
title: Cost Optimization
description: Budget planning, provider pricing, and cost control strategies for Reactive Agents
sidebar:
  order: 35
---

Smart cost management is essential for production agents. This guide covers pricing, budget controls, and zero-cost local model options.

## Provider Pricing Table

Prices fluctuate frequently. Check provider docs for current rates. Costs below are approximate per 1,000 tokens (as of March 2026):

| Provider | Model | Input (per 1K tokens) | Output (per 1K tokens) |
|----------|-------|:---------------------:|:---------------------:|
| Anthropic | Claude Sonnet 4 | $0.003 | $0.015 |
| Anthropic | Claude Haiku 3.5 | $0.0008 | $0.004 |
| OpenAI | GPT-4o | $0.0025 | $0.010 |
| OpenAI | GPT-4o-mini | $0.00015 | $0.0006 |
| Google | Gemini 2.0 Flash | $0.0001 | $0.0004 |
| Ollama | Any local model | $0 | $0 |

**Note:** Prices change frequently and vary by region. Always verify against the provider's official pricing page before building estimates.

## Budget Calculator

Quick formula for monthly cost estimates:

```
Monthly cost = (requests/day) × (avg_tokens/request) × (cost/token) × 30
```

### Example Calculations

**Light usage** (low daily volume, simple queries)
```
100 requests/day × 2,000 avg tokens × $0.0008 per 1K tokens (Haiku input) × 30 days
= 100 × 2 × 0.0008 × 30 = $4.80/month
```

**Medium usage** (moderate volume, mix of simple and complex)
```
1,000 requests/day × 3,000 avg tokens × $0.00015 per 1K tokens (GPT-4o-mini input) × 30 days
= 1,000 × 3 × 0.00015 × 30 = $13.50/month
```

**Heavy usage** (frequent complex reasoning and tool use)
```
500 requests/day × 5,000 avg tokens × $0.003 per 1K tokens (Sonnet input) × 30 days
= 500 × 5 × 0.003 × 30 = $225/month
```

### Token Estimation Tips

- **Simple Q&A**: 500–1,500 tokens (prompt + response)
- **Tool-calling tasks** (1–3 tool calls): 2,000–5,000 tokens
- **Multi-step reasoning** (5+ iterations): 5,000–10,000+ tokens
- **With semantic memory retrieval**: +1,000–3,000 tokens (embedded context)

## Budget Tier Recommendations

Choose a provider and model combo aligned with your monthly token budget:

### $5/month Tier
- **Primary**: Ollama local models (free electricity only)
- **Alternative**: OpenAI GPT-4o-mini for ~1,000–2,000 requests/day
- **Use case**: Personal projects, internal copilots, low-latency edge inference

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("qwen3:4b")
  .withReasoning({ defaultStrategy: "reactive" })
  .withMaxIterations(5)
  .build();
```

### $25/month Tier
- **Primary**: OpenAI GPT-4o-mini or Claude Haiku 3.5
- **Fallback**: Ollama for cost spikes
- **Use case**: Small teams, MVP products, non-critical automation

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("openai")
  .withModel("gpt-4o-mini")
  .withCostTracking({ budget: { daily: 1.0 } })
  .withReasoning({ defaultStrategy: "reactive" })
  .build();
```

### $100/month Tier
- **Primary**: Claude Sonnet 4 or GPT-4o
- **Use case**: Production SaaS, high-reliability automations, complex reasoning

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withCostTracking({ budget: { daily: 5.0 } })
  .withReasoning({ defaultStrategy: "adaptive" })
  .withVerification()
  .build();
```

### $500+/month Tier
- **Primary**: Claude Sonnet 4 with extended reasoning, high iteration limits
- **Observability**: Full event tracing and metrics
- **Use case**: Enterprise agents, research platforms, autonomous systems

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withCostTracking({ budget: { daily: 20.0 } })
  .withReasoning({ defaultStrategy: "adaptive", maxIterations: 20 })
  .withMemory("2")
  .withVerification()
  .withObservability({ verbosity: "verbose" })
  .build();
```

## Cost Control Features

Use these builder methods to enforce budgets and reduce token usage:

### Budget Enforcement

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withCostTracking({
    budget: {
      perRequest: 0.10,    // Max $0.10 per single run
      daily: 5.0,          // Max $5.00 per day
      monthly: 100.0       // Max $100.00 per month
    }
  })
  .build();

const result = await agent.run("Complex task");
// Throws BudgetExceededError if any threshold is hit
console.log(result.metadata.cost);  // Estimated USD cost
```

### Semantic Cache (1-hour dedupe)

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withCacheTimeout(3600000)  // 1-hour cache window
  .build();

// Repeated queries within 1 hour reuse LLM output
// Zero tokens used on cache hits
```

**Impact:** ~40–60% token reduction for applications with repeated queries (e.g., FAQ bots, recurring reports).

### Iteration Limits

```typescript
.withReasoning({ maxIterations: 5 })
// Fewer iterations = fewer LLM calls = lower cost
// ReAct typically solves in 3–8 steps
```

**Impact:** Single biggest lever on cost. Each iteration adds 1,000–2,000 tokens.

### Tool Result Compression

```typescript
.withTools({
  compression: {
    maxLength: 2000      // Truncate large tool outputs
  }
})
```

**Impact:** Reduces context bloat from API responses (e.g., 5,000-char web search result → 2,000 char summary).

### Complexity Routing

When configured, Reactive Agents automatically routes simple tasks to cheaper models:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")  // Primary
  .withComplexityRouting({
    simple: "claude-haiku-3-5-sonnet",    // Simple tasks use Haiku
    threshold: 0.5                         // Routing confidence (0–1)
  })
  .build();

// Agent analyzes input and routes to Haiku if simple, Sonnet if complex
// Save up to 60% on routine queries
```

### Context Profile Tiers

Optimize prompt verbosity for model size:

```typescript
// Small models: lean prompts, early compaction
.withContextProfile({ tier: "local" })

// Mid-tier: balanced
.withContextProfile({ tier: "mid" })

// Large cloud models: full context
.withContextProfile({ tier: "large" })
```

**Impact:** ~20–30% token reduction by avoiding verbose prompts on small models.

## Local Models: Zero Cost Option

Ollama lets you run models locally (on your machine or private servers) with **zero API costs**.

### Setup

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows — download from https://ollama.com
```

### Recommended Models

| Task | Model | Size | Notes |
|------|-------|------|-------|
| Simple Q&A | `qwen3:4b` | 3GB | Fast, low memory |
| Tool calling | `qwen3:14b` | 9GB | Best tool accuracy |
| Code generation | `qwen2.5-coder:7b` | 4.5GB | Specialized |
| Complex reasoning | `cogito:14b` | 9GB | Extended thinking |
| High quality | `llama3.1:70b` | 40GB | Near-cloud quality |

### Trade-offs vs. Hosted Models

| Aspect | Ollama Local | Cloud (Sonnet) |
|--------|--------------|----------------|
| Cost | $0 (electricity) | ~$0.003/1K input tokens |
| Latency | 1–5s/response | 0.5–2s/response |
| Quality | Good for most tasks | Excellent, especially complex reasoning |
| Setup | One-time download | API key only |
| Privacy | 100% local | Data sent to provider |
| Model control | Change anytime | Pinned to provider's release cycle |

### Builder Example

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("local-researcher")
  .withProvider("ollama")
  .withModel("qwen3:14b")
  .withReasoning({ defaultStrategy: "reactive" })
  .withTools({ include: ["web-search", "file-read"] })
  .withContextProfile({ tier: "local" })
  .withMaxIterations(6)
  .build();

const result = await agent.run("What are the latest TypeScript best practices?");
console.log(result.output);
console.log(result.metadata);  // { cost: 0, tokensUsed, duration }
```

### For More Detail

See the **[Local Models Guide](./local-models.md)** for:
- Detailed per-task model recommendations
- Performance tuning
- Common pitfalls and fixes
- Strategy selection for local models

## Cost Optimization Checklist

Before deploying to production:

- [ ] Budget tiers set via `.withCostTracking()`
- [ ] Max iterations limited (5–10 for most tasks)
- [ ] Context profile tier matches your model size (`local` / `mid` / `large`)
- [ ] Semantic cache enabled if you have repeated queries
- [ ] Tool count limited (3–5 tools max reduces hallucinations)
- [ ] Tool result compression enabled for large APIs
- [ ] Monitoring alerts set up (via observability layer)
- [ ] Cost estimates reviewed against real usage monthly
- [ ] Fallback model configured for budget spikes (optional)

## Next Steps

- Configure budgets with [Cost Tracking](../cost-tracking/)
- Choose a model with [Choosing a Stack](./choosing-a-stack.md)
- Set up monitoring with [Observability](../observability/)
