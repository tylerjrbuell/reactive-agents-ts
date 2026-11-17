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
// Gateway starts an HTTP ingress server on gateway.port (default 3000), bound to 127.0.0.1
// Incoming webhooks are normalized and passed as tasks to the agent
```

Ingress is fail-closed: POST only (405), bodies over 1 MiB get 413, a sender that stalls the body for 10 s gets 408, more than 64 in-flight requests get 503, a webhook with no secret refuses every request, and a bad signature is 401. Put a reverse proxy with TLS in front of a public URL.

### Durable schedules

Every `crons` entry lives in a `ScheduleRegistry` (stable id, `nextFireAt`, `lastRun`, per-fire history of the last 20 runs). Give the registry a SQLite `path` and schedules survive restarts:

- Catch-up after downtime follows each schedule's `catchUp` policy: `skip`, `fire-once` (default, runs the most recent missed fire once) or `fire-all` (oldest first, at most `maxFires`).
- A fire is saved as `running` before it executes. If the process dies mid-run, the next start re-offers it under the same `fireId`, so delivery is at-least-once: write scheduled instructions that are safe to repeat.
- On every start, config-declared schedules take `priority` from the config again; a runtime pause survives unless the config's `enabled` changed.

### Inbound queue

Events that arrive while the agent is busy, or that the policy engine defers, wait in a bounded in-memory queue:

```ts
.withGateway({
  queue: { capacity: 100, overflow: "drop-oldest" },  // or "drop-newest"
})
```

Waiting events are lost on restart (cron fires replay through the registry). Drops are published as `ProactiveActionSuppressed` with `policy: "inbound-queue:dropped"`.

### Messaging channels

Signal and Telegram use native adapters from `@reactive-agents/channels` (`SignalChannelAdapter`, `TelegramChannelAdapter`), registered with `.withChannels({ adapters: [...] })`, not MCP servers. Restrict who can talk to the agent with `accessControl`, and prefix every sender with its platform:

```ts
accessControl: {
  accessPolicy: "allowlist",
  allowedSenders: ["signal:+15551234567", "telegram:123456789"],  // platform:userId
}
```

A bare `+15551234567` no longer matches, so an unprefixed allowlist denies everyone.

Channels reject unknown senders by default: with no `accessControl`, every inbound channel sender is denied (and the gateway logs a warning at start). Allow specific senders as above, or accept anyone explicitly with `accessControl: { accessPolicy: "open" }`. The GitHub webhook adapter also drops a replayed `x-github-delivery` id.

### Durable inbox and event policy (channel router)

Routed channels (`.withChannels({ routes })`) keep dedupe and queued messages in memory by default. For an always-on agent pass `store: await Effect.runPromise(openSqliteRouterStore({ path }))` from `@reactive-agents/channels`: every accepted message becomes a row (`received | running | done | failed | dropped`), dedupe survives a restart, turns a crash left `running` retry up to `maxAttempts` (default 3) then become `failed` (`ChannelInboxRetried` / `ChannelInboxFailed` events), and finished rows are pruned by age and count. Delivery is at-least-once with dedupe, so keep tools idempotent.

Per route: `batchWindowMs` (0 to 30 000, default 0) joins one sender's burst into one turn; `midRun` (`"queue"` default, `"fold"`, `"interrupt"`) decides what a message that arrives during a running turn does. `fold` joins it through `turn.takeFolded()` (undrained text runs as one follow-up turn); `interrupt` cancels the turn with `turn_interrupted` and restarts from the combined input. Status: `agent.channelRouterStatus()` reports `durableStore` and per-status `inbox` counts. Full guide: messaging-channels.

Sends and wake-ups (`createChannelRouter` options): `outbox: { maxAttempts, baseBackoffMs, maxBackoffMs, minGapMs }` retries transient send failures in order per conversation (default 1 attempt, no pacing; per-route `minGapMs` paces a chat) and a permanent failure becomes a `ChannelSendFailed` event, never silence. `followUp: true | { maxPending, maxHorizonMs, pollMs }` gives each session a `req.followUp` port; `makeFollowUpTool(req.followUp)` is the agent's `follow-up` tool (`{ in | at, note }`, `{ cancel }`, or no arguments to list), bounded per conversation, durable with the SQLite store, and a due timer wakes the conversation as a normal inbound turn. Both are set on `createChannelRouter` or on `.withChannels({ outbox, followUp })`; `.withChannels({ inbox: { path } })` opens the durable SQLite store for you. With `followUp`, each conversation runs on its own agent that owns the `follow-up` tool.

### Policy engine

```ts
policies: {
  dailyTokenBudget: 100_000,    // hard stop after N tokens/day
  maxActionsPerHour: 50,        // rate-limit proactive actions
  heartbeatPolicy: "adaptive",  // global override for all heartbeats
  requireApprovalFor: ["file-write", "send-email"],  // tools that need human approval
}
```

### Persistent memory across runs (episodic context across heartbeats/crons)

```ts
.withGateway({
  persistMemoryAcrossRuns: true,  // default: false
  heartbeat: { intervalMs: 60_000, instruction: "Check for new work" },
  crons: [{ schedule: "0 9 * * *", instruction: "Daily summary" }],
})
.withMemory({ tier: "enhanced", dbPath: "./memory.sqlite" })
```

When `persistMemoryAcrossRuns: true`, the agent reuses the same stable `agentId` across all gateway executions (heartbeats, crons, webhooks). This allows the memory layer to maintain episodic context across runs — the agent "remembers" what it saw in the previous heartbeat when processing the next cron, avoiding repeated work and building narrative continuity.

**Without persistence** (default): Each gateway execution gets a unique `agentId` like `agent-name-heartbeat-1234567890`, so memory is isolated per run. Good for stateless checks.

**With persistence**: All executions share `agent-name`, so memory spans across runs. Good for agents that need to understand history, avoid duplication, or provide narrative context (e.g., digest monitors, status trackers).

## GatewayOptions reference

| Field | Type | Notes |
|-------|------|-------|
| `timezone` | `string` | Default timezone for crons (e.g., `"America/New_York"`) |
| `persistMemoryAcrossRuns` | `boolean` | Reuse same agent ID across all gateway executions so memory spans heartbeats/crons. Default: false |
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
| `port` | `number` | HTTP port for webhook ingress (default 3000, binds 127.0.0.1) |
| `queue.capacity` | `number` | Waiting events per list in the inbound queue (default 100) |
| `queue.overflow` | `"drop-oldest"\|"drop-newest"` | What to discard when the queue is full (default `drop-oldest`) |
| `accessControl.allowedSenders` / `blockedSenders` | `string[]` | `platform:userId` entries, e.g. `signal:+15551234567` |

## GatewaySummary (from `handle.stop()`)

| Field | Type |
|-------|------|
| `totalRuns` | `number` |
| `heartbeatsFired` | `number` |
| `cronChecks` | `number` |

## State Tracking (advanced)

The gateway maintains zero-LLM-cost state that powers all policy decisions:

```ts
type GatewayState = {
  lastExecutionAt: Date | null           // Enables adaptive skip
  consecutiveHeartbeatSkips: number      // Forces execute after N skips (safety net)
  tokensUsedToday: number                // For daily budget enforcement
  actionsThisHour: number                // For rate limit enforcement
  pendingEvents: GatewayEvent[]          // Queued work from webhooks
}
```

Inspect state at runtime: `const status = await agent.gatewayStatus()`

For policy evaluation, ingress, schedules and channels in depth, see the [Agent Gateway guide](https://docs.reactiveagents.dev/features/gateway/).

## Pitfalls

- `.withGateway()` alone does nothing — you must call `.start()` on the built agent to begin the loop
- Gateway holds the Node process open — always register a shutdown handler (`SIGINT`, `SIGTERM`) that calls `handle.stop()`
- Heartbeat `intervalMs` default is 60,000ms (1 min) — set a longer interval for agents that don't need frequent checks
- Cron expressions follow standard 5-field format (`min hour dom month dow`) — verify with a cron parser before deploying
- `policies.dailyTokenBudget` resets at midnight in the `timezone` specified — ensure timezone is set correctly
- Webhook secrets must match what the external service sends — a mismatch (or a missing secret) rejects every request with 401 and never reaches the agent
- `allowedSenders` / `blockedSenders` entries need the `platform:` prefix; bare ids silently match nobody
- `persistMemoryAcrossRuns: true` requires `.withMemory()` with a persistent database (e.g., SQLite) to be useful — otherwise memory tiers default to in-memory and still get wiped between runs
- `consecutiveHeartbeatSkips` is adaptive-mode only — "always" and "conservative" modes don't use it (no skipping to reset)
