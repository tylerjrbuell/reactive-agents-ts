---
name: recipe-persistent-monitor
description: Full recipe for a persistent monitoring agent with heartbeats, daily cron reports, webhook triggers, daily token budgets, and graceful shutdown.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "recipe"
---

# Recipe: Persistent Monitor

## What this builds

A long-running monitoring agent that fires a heartbeat every 30 minutes (adaptive — skips if nothing to do), generates a daily report every weekday at 9am, accepts webhook events from external services, and enforces daily token and cost budgets. Shuts down gracefully on SIGINT/SIGTERM.

## Skills loaded by this recipe

- `gateway-persistent-agents` — heartbeat, cron, webhook, policy configuration
- `tool-creation` — allowedTools
- `cost-budget-enforcement` — daily token budget and cost limits
- `observability-instrumentation` — normal verbosity for production

## Complete implementation

```ts
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("ops-monitor")
  .withProvider("anthropic")
  .withReasoning({
    defaultStrategy: "reactive",
    maxIterations: 8,   // keep iterations short for monitoring tasks
  })
  .withTools({
    allowedTools: ["web-search", "http-get", "checkpoint", "final-answer"],
  })
  .withGateway({
    timezone: "America/New_York",
    heartbeat: {
      intervalMs: 30 * 60 * 1_000,   // check every 30 minutes
      policy: "adaptive",             // skip if nothing requires attention
      instruction: `
        Check the following:
        1. Fetch https://status.myservice.com/api/status — is everything green?
        2. If any service is degraded or down, create an incident summary.
        3. If all green, no action needed (adaptive policy will skip next run).
      `,
      maxConsecutiveSkips: 12,        // wake up after 12 skips (~6 hours) regardless
    },
    crons: [
      {
        schedule: "0 9 * * MON-FRI",   // 9am weekdays
        instruction: `
          Generate a daily operations report:
          1. Summarize the last 24 hours of activity from https://api.myservice.com/logs.
          2. Highlight any incidents, performance degradations, or anomalies.
          3. Save the report to ./reports/daily-{date}.md.
        `,
        priority: "normal",
        timezone: "America/New_York",
      },
    ],
    webhooks: [
      {
        path: "/github/webhook",
        adapter: "github",
        secret: process.env.GITHUB_WEBHOOK_SECRET,
        events: ["push", "pull_request"],
      },
    ],
    policies: {
      dailyTokenBudget: 50_000,    // hard stop after 50k tokens/day
      maxActionsPerHour: 20,        // rate limit proactive actions
    },
  })
  .withCostTracking({ daily: 5.0 })
  .withObservability({ verbosity: "normal", file: "./logs/monitor.jsonl" })
  .withHealthCheck()
  .build();

// Start the persistent agent loop
const handle = await agent.start();
console.log("Monitor started. Ctrl+C to stop.");

// Graceful shutdown on SIGINT / SIGTERM
const shutdown = async (signal: string) => {
  console.log(`\nReceived ${signal}. Shutting down...`);
  const summary = await handle.stop();
  console.log(`Ran ${summary.totalRuns} times`);
  console.log(`Heartbeats fired: ${summary.heartbeatsFired}`);
  console.log(`Cron checks: ${summary.cronChecks}`);
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
```

## Customization options

### Alerting integration

```ts
import { tool } from "@reactive-agents/tools";

const sendAlert = tool("send-alert", "Send an alert to the on-call channel", async (args) => {
  const { message, severity } = args as { message: string; severity: "low" | "high" | "critical" };
  await slackClient.postMessage({ channel: "#on-call", text: `[${severity}] ${message}` });
  return { sent: true };
});

// Add to the agent's tools:
.withTools({
  tools: [sendAlert],
  allowedTools: ["send-alert", "http-get", "checkpoint"],
})
```

### Conservative policy (manual triggers only)

```ts
heartbeat: {
  intervalMs: 60 * 60 * 1_000,   // 1 hour
  policy: "conservative",         // only fires on explicit webhook triggers
  instruction: "Process incoming events only.",
}
```

### Multiple monitoring targets

```ts
crons: [
  { schedule: "*/15 * * * *", instruction: "Check support queue...", priority: "high" },
  { schedule: "0 * * * *",    instruction: "Hourly metrics snapshot...", priority: "normal" },
  { schedule: "0 8 * * MON",  instruction: "Weekly executive summary...", priority: "normal" },
]
```

## GatewaySummary (from handle.stop())

```ts
const summary = await handle.stop();
// summary.totalRuns        — total agent executions
// summary.heartbeatsFired  — number of heartbeat triggers
// summary.cronChecks       — number of cron-triggered runs
```

## Pitfalls

- `.start()` returns a handle — you must call `handle.stop()` before `process.exit()` or the Node process will not exit cleanly
- Webhook `secret` mismatch causes all webhook events to be silently rejected — verify the secret matches what the external service sends
- `policy: "adaptive"` skips when the agent decides there's nothing to do — the agent itself determines this, so system prompt guidance matters
- `dailyTokenBudget` resets at midnight in the configured `timezone` — ensure timezone is set correctly for your use case
- `maxConcurrentSkips` is a safety net — without it, an adaptive agent can skip indefinitely if the monitored service is always healthy
