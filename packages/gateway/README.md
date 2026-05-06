# @reactive-agents/gateway

> Version: **0.10.2** — persistent autonomous agent harness for [Reactive Agents](https://docs.reactiveagents.dev/).

Keeps an agent running long-term with **adaptive heartbeats**, **cron scheduling**, **webhook
ingestion**, a composable **policy engine**, **chat mode** (per-sender SQLite session history),
and unified event routing. The gateway turns a one-shot agent into an always-on operator.

## Installation

```bash
bun add @reactive-agents/gateway
```

Or install the umbrella:

```bash
bun add reactive-agents
```

## Builder usage

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("ops-agent")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withMemory("1")
  .withGateway({
    heartbeat: { intervalMs: 1_800_000, policy: "adaptive" },
    crons: [
      { schedule: "0 9 * * MON", instruction: "Review open PRs and summarize status" },
      { schedule: "0 */6 * * *", instruction: "Check system health metrics" },
    ],
    webhooks: [
      { path: "/github", adapter: "github", secret: process.env.WEBHOOK_SECRET },
    ],
    accessControl: {
      mode: "chat",                 // 'chat' (default) or 'task'
      accessPolicy: "allowlist",
      allowedSenders: ["U_TYLER"],
    },
    policies: {
      dailyTokenBudget: 50_000,
      maxActionsPerHour: 30,
    },
  })
  .build();

await agent.start();
```

## Direct service usage

```typescript
import {
  GatewayService,
  GatewayServiceLive,
  PolicyEngine,
  SchedulerService,
  WebhookService,
  createGitHubAdapter,
  createGenericAdapter,
  createAdaptiveHeartbeatPolicy,
  createCostBudgetPolicy,
  createRateLimitPolicy,
  createEventMergingPolicy,
  createAccessControlPolicy,
  routeEvent,
  routeEventWithBus,
} from "@reactive-agents/gateway";
```

## Key features

- **Adaptive heartbeats** — `always`, `adaptive`, or `conservative` policies skip idle beats to
  save tokens; tracked via `consecutiveHeartbeatSkips` in `GatewayState`.
- **Cron scheduling** — standard cron expressions with timezone support and per-job priority;
  parsed via `parseCron` / `shouldFireAt`.
- **Webhook ingestion** — HTTP endpoint with pluggable adapters (`createGitHubAdapter` for HMAC
  + signature verification, `createGenericAdapter` for any JSON payload).
- **Policy engine** — composable `SchedulingPolicy[]` evaluated per event; built-ins below.
- **Event routing** — unified `GatewayEvent` envelope routes heartbeats, crons, webhooks, and
  channel messages through the same `routeEvent` pipeline.
- **EventBus integration** — every gateway event publishes to the core EventBus for observability.
- **State tracking** — tokens used today, actions per hour, consecutive skips, pending events;
  all updated without LLM calls.

## Chat mode

Set `accessControl.mode: "chat"` (default) to keep per-`(platform, senderId)` SQLite sessions
across process restarts:

- 40-turn / 8 KiB sliding window
- Episodic memory injection from prior sessions
- Daily compaction of older turns into a summary
- TTL-based pruning (`accessControl.sessionTtlDays`, default 30 days)

Switch to `mode: "task"` for stateless, one-shot dispatch (each inbound message starts a fresh
run with no memory of prior turns).

## Built-in policies

| Factory | Purpose |
|---|---|
| `createAdaptiveHeartbeatPolicy` | Skip heartbeats when the agent is idle |
| `createCostBudgetPolicy` | Enforce a daily token budget |
| `createRateLimitPolicy` | Cap actions per hour |
| `createEventMergingPolicy` | Merge duplicate events within a sliding window |
| `createAccessControlPolicy` | Allowlist / blocklist sender filtering, escalate-or-skip on unknown |

Policies compose: pass an array to `evaluatePolicies(event, [p1, p2, p3])` or to
`.withGateway({ policies })`.

## Channels integration

For inbound messaging from Discord, Telegram Bot API, Signal bots, etc., pair this package with
`.withChannels({ adapters, triggers? })` from `@reactive-agents/runtime`. Channel adapters live in
`@reactive-agents/channels`. Adapters start when `agent.start()` runs.

## GatewayStatus snapshot

```typescript
const status: GatewayStatus | null = await agent.getGatewayStatus();
// { isRunning, lastExecutionAt, tokensUsedToday, actionsThisHour, pendingEvents, ... }
```

## Documentation

- Gateway guide: [docs.reactiveagents.dev/guides/gateway/](https://docs.reactiveagents.dev/guides/gateway/)
- Chat mode: [docs.reactiveagents.dev/guides/gateway-chat/](https://docs.reactiveagents.dev/guides/gateway-chat/)
- Webhook adapters: [docs.reactiveagents.dev/guides/webhooks/](https://docs.reactiveagents.dev/guides/webhooks/)
- Related: [`@reactive-agents/runtime`](../runtime/README.md),
  [`@reactive-agents/channels`](../channels/README.md),
  [`@reactive-agents/memory`](../memory/README.md).

## License

MIT
