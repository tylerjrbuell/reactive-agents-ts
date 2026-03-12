# @reactive-agents/cost

Cost management for the [Reactive Agents](https://docs.reactiveagents.dev/) framework.

Automatically routes tasks to the cheapest capable model and enforces per-request and session budgets.

## Installation

```bash
bun add @reactive-agents/cost
```

## Features

- **Complexity router** — classifies tasks and selects Haiku / Sonnet / Opus accordingly
- **Budget enforcer** — blocks requests that would exceed configured limits
- **Cost tracking** — accumulates token usage and USD cost per session

## Usage

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("budget-agent")
  .withProvider("anthropic")
  .withCostTracking({
    maxSessionCost: 1.0, // $1.00 per session
    maxRequestCost: 0.1, // $0.10 per request
  })
  .build();

const result = await agent.run("Summarize this document");
console.log(result.metadata.cost); // { usd: 0.003, tokens: 450 }
console.log(result.metadata.modelUsed); // "claude-haiku-4-5" (auto-routed)
```

## Routing Logic

| Task signals                 | → Model |
| ---------------------------- | ------- |
| Simple, short, factual       | Haiku   |
| Analysis, coding, multi-step | Sonnet  |
| Complex reasoning, research  | Opus    |

## Documentation

Full documentation at [docs.reactiveagents.dev](https://docs.reactiveagents.dev/)
