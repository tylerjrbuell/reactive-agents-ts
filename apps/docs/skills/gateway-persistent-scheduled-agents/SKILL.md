---
name: gateway-persistent-scheduled-agents
description: Build persistent scheduled agents with Gateway heartbeats, cron jobs, webhook ingestion, and policy enforcement.
compatibility: Reactive Agents projects using @reactive-agents/gateway and builder .withGateway().
metadata:
  author: reactive-agents
  version: "1.0"
---

# Gateway Persistent Scheduled Agents

Use this skill to run long-lived agents that execute scheduled work reliably.

## Agent objective

When implementing persistent scheduled agents, generate code that:

- Enables gateway runtime explicitly before calling `.start()`.
- Uses bounded cron instructions with policy gates.
- Exposes heartbeat and execution telemetry for operations teams.

## What this skill does

- Enables persistent runtime loops through `.withGateway()` + `.start()`.
- Defines cron-driven instructions for recurring tasks.
- Adds heartbeat liveness checks and policy guards before execution.

## Workflow

1. Configure gateway heartbeat interval and policy mode.
2. Add cron entries with explicit schedules and bounded instructions.
3. Wire webhook inputs only for validated trusted sources.
4. Apply budget/rate policies to prevent runaway task execution.
5. Monitor gateway events and phase metrics during long-running operation.

## Expected implementation output

- A gateway-enabled builder configuration with heartbeat and cron entries.
- Startup/shutdown logic suitable for long-lived process management.
- Observability output that makes failed schedules and lag visible.

## Code Examples

### Enabling the Gateway for Persistent Agents

To create a long-running agent that can execute tasks on a schedule, use the `.withGateway()` builder method. This enables a persistent runtime that can be started with `agent.start()` and stopped with `agent.stop()`.

The gateway can be configured with:

- **Heartbeats**: A recurring instruction that runs at a set interval.
- **Crons**: Standard cron jobs that run at specific times.
- **Policies**: Rules to enforce budgets and rate limits.

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("persistent-agent")
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  // Enable and configure the gateway
  .withGateway({
    timezone: "America/New_York",
    // A heartbeat instruction that runs every 15 seconds
    heartbeat: {
      intervalMs: 15_000,
      policy: "adaptive", // Skips runs if the agent is busy
      instruction: "Check for new tasks and report status.",
    },
    // A cron job that runs every Monday at 9 AM
    crons: [
      {
        schedule: "0 9 * * MON",
        instruction: "Generate and send the weekly team report.",
      },
    ],
    // Policies to prevent runaway execution
    policies: {
      dailyTokenBudget: 100_000, // Max 100k tokens per day
      maxActionsPerHour: 60, // Max 60 tool calls per hour
    },
  })
  .build();

// Start the persistent agent loop
console.log("Starting persistent agent...");
await agent.start();

// The agent will now run its heartbeat and cron jobs in the background.
// To stop it gracefully:
// setTimeout(async () => {
//   console.log("Stopping agent...");
//   await agent.stop();
//   console.log("Agent stopped.");
// }, 60000); // Stop after 1 minute
```

## Pitfalls to avoid

- Calling `.start()` without `.withGateway()` configured.
- Broad cron schedules without budget limits or kill-switch controls.
- Running without observability enabled for heartbeat and failure visibility.
