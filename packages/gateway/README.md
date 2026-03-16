# @reactive-agents/gateway

Persistent autonomous agent harness for the [Reactive Agents](https://docs.reactiveagents.dev/) framework.

Keeps agents running long-term with adaptive heartbeats, cron scheduling, webhook ingestion, and a composable policy engine that governs when and how events trigger agent execution.

## Installation

```bash
bun add @reactive-agents/gateway
```

Or install everything at once:

```bash
bun add reactive-agents
```

## Usage

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("ops-agent")
  .withProvider("anthropic")
  .withGateway({
    heartbeat: { intervalMs: 1_800_000, policy: "adaptive" },
    crons: [
      { schedule: "0 9 * * MON", instruction: "Review open PRs and summarize status" },
      { schedule: "0 */6 * * *", instruction: "Check system health metrics" },
    ],
    webhooks: [
      { path: "/github", adapter: "github", secret: process.env.WEBHOOK_SECRET },
    ],
    policies: {
      dailyTokenBudget: 50_000,
      maxActionsPerHour: 30,
    },
  })
  .build();
```

### Direct Service Usage

```typescript
import { GatewayService, PolicyEngine, SchedulerService } from "@reactive-agents/gateway";
import { createGitHubAdapter } from "@reactive-agents/gateway";
import { createCostBudgetPolicy, createRateLimitPolicy } from "@reactive-agents/gateway";
```

## Key Features

- **Adaptive heartbeats** — `always`, `adaptive`, or `conservative` policies that skip idle beats to save tokens
- **Cron scheduling** — standard cron expressions with timezone support and per-job priority
- **Webhook ingestion** — HTTP endpoint with pluggable adapters (GitHub, generic) and secret verification
- **Policy engine** — composable policies for cost budgets, rate limits, event merging, and access control
- **Event routing** — unified `GatewayEvent` envelope routes heartbeats, crons, webhooks, and channels through the same pipeline
- **EventBus integration** — all gateway events publish to the core EventBus for observability
- **State tracking** — tracks tokens used, actions per hour, consecutive skips, and pending events without LLM calls

## Built-in Policies

| Policy | Purpose |
| --- | --- |
| `createAdaptiveHeartbeatPolicy` | Skip heartbeats when agent is idle |
| `createCostBudgetPolicy` | Enforce daily token budget |
| `createRateLimitPolicy` | Cap actions per hour |
| `createEventMergingPolicy` | Merge duplicate events within a time window |
| `createAccessControlPolicy` | Allowlist/blocklist sender filtering |

## Documentation

Full documentation at [docs.reactiveagents.dev](https://docs.reactiveagents.dev/)

## License

MIT
