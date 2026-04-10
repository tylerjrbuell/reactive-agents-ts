---
name: gateway-persistent-agents
description: Build always-on agents with heartbeats, cron scheduling, webhook triggers, and a persistent policy engine using the Gateway layer.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "capability"
---

# Gateway — Persistent Agents

## Agent objective

Produce a builder with `.withGateway()` correctly configured for the persistence pattern needed, with the agent started and gracefully stopped.

## When to load this skill

- Agent must run continuously or on a schedule without human triggers
- Building a cron-based automation agent
- Agent responds to webhook events from external systems
- Agent needs daily token/action budgets and policy enforcement

## Implementation baseline

```ts
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("monitor")
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "reactive", maxIterations: 8 })
  .withTools({ allowedTools: ["web-search", "http-get"] })
  .withGateway({
    heartbeat: {
      intervalMs: 1_800_000,     // 30 minutes
      policy: "adaptive",        // skip if no new work
      instruction: "Check for new alerts and summarize",
    },
    crons: [
      {
        schedule: "0 9 * * MON-FRI",  // 9am weekdays
        instruction: "Generate daily status report",
        priority: "normal",
      },
    ],
    policies: {
      dailyTokenBudget: 50_000,
      maxActionsPerHour: 20,
    },
  })
  .withCostTracking({ daily: 5.0 })
  .withObservability({ verbosity: "normal" })
  .withHealthCheck()
  .build();

// Start the persistent loop
const handle = await agent.start();

// Graceful shutdown
process.on("SIGINT", async () => {
  const summary = await handle.stop();
  console.log(`Ran ${summary.totalRuns} times, ${summary.heartbeatsFired} heartbeats`);
  process.exit(0);
});
```

## Key patterns

### Heartbeat policies

```ts
heartbeat: {
  intervalMs: 3_600_000,      // 1 hour
  policy: "always",           // always run regardless of activity
  // policy: "adaptive"       // skip if agent has nothing useful to do (default)
  // policy: "conservative"   // only run on explicit triggers
  instruction: "Review incoming messages and respond to urgent ones",
  maxConsecutiveSkips: 5,     // stop skipping after 5 consecutive no-ops
}
```

### Cron scheduling

```ts
crons: [
  {
    schedule: "0 9 * * 1",      // Every Monday at 9am (standard cron syntax)
    instruction: "Review PRs and post weekly summary to Slack",
    priority: "high",           // "low" | "normal" | "high" | "critical"
    timezone: "America/New_York",
    enabled: true,
  },
  {
    schedule: "*/15 * * * *",   // Every 15 minutes
    instruction: "Check for new support tickets and categorize them",
    priority: "normal",
  },
]
```

### Webhook triggers

```ts
webhooks: [
  {
    path: "/github/webhook",
    adapter: "github",
    secret: process.env.GITHUB_WEBHOOK_SECRET,
    events: ["push", "pull_request"],
  },
]
// Gateway starts an HTTP server on gateway.port (default: varies — check builder docs)
// Incoming webhooks are normalized and passed as tasks to the agent
```

### Policy engine

```ts
policies: {
  dailyTokenBudget: 100_000,    // hard stop after N tokens/day
  maxActionsPerHour: 50,        // rate-limit proactive actions
  heartbeatPolicy: "adaptive",  // global override for all heartbeats
  requireApprovalFor: ["file-write", "send-email"],  // tools that need human approval
}
```

## GatewayOptions reference

| Field | Type | Notes |
|-------|------|-------|
| `timezone` | `string` | Default timezone for crons (e.g., `"America/New_York"`) |
| `heartbeat.intervalMs` | `number` | Default: 60,000ms (1 min) |
| `heartbeat.policy` | `"always"\|"adaptive"\|"conservative"` | |
| `heartbeat.instruction` | `string` | Task prompt for each heartbeat |
| `heartbeat.maxConsecutiveSkips` | `number` | Stop skipping after N no-ops |
| `crons[].schedule` | `string` | Standard cron expression |
| `crons[].instruction` | `string` | Task prompt for this cron |
| `crons[].priority` | `"low"\|"normal"\|"high"\|"critical"` | |
| `policies.dailyTokenBudget` | `number` | Hard token cap per day |
| `policies.maxActionsPerHour` | `number` | Rate limit for proactive actions |
| `policies.requireApprovalFor` | `string[]` | Tools requiring human approval |
| `port` | `number` | HTTP port for webhook server |

## GatewaySummary (from `handle.stop()`)

| Field | Type |
|-------|------|
| `totalRuns` | `number` |
| `heartbeatsFired` | `number` |
| `cronChecks` | `number` |

## Pitfalls

- `.withGateway()` alone does nothing — you must call `.start()` on the built agent to begin the loop
- Gateway holds the Node process open — always register a shutdown handler (`SIGINT`, `SIGTERM`) that calls `handle.stop()`
- Heartbeat `intervalMs` default is 60,000ms (1 min) — set a longer interval for agents that don't need frequent checks
- Cron expressions follow standard 5-field format (`min hour dom month dow`) — verify with a cron parser before deploying
- `policies.dailyTokenBudget` resets at midnight in the `timezone` specified — ensure timezone is set correctly
- Webhook secrets must match what the external service sends — mismatch causes all webhook events to be rejected silently
