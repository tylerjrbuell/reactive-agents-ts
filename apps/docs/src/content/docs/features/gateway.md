---
title: Agent Gateway
description: Persistent autonomous agent harness with adaptive heartbeats, cron scheduling, webhooks, and a composable policy engine.
sidebar:
  order: 1
---

The Agent Gateway turns reactive agents into **persistent, autonomous services**. Instead of waiting for user prompts, gateway-enabled agents respond to heartbeat ticks, cron schedules, webhooks, and other event sources — all governed by a deterministic policy engine that decides what deserves an LLM call and what doesn't.

## The Harness vs The Horse

Most agent frameworks route every input through an LLM. The gateway inverts this:

```
                         ┌──────── THE HARNESS ────────┐
                         │  (zero LLM calls)           │
Heartbeats ──┐           │                             │
Crons ───────┤           │  InputRouter                │
Webhooks ────┼──────────▶│    → PolicyEngine            │
Channels ────┤           │    → EventBus               │
A2A ─────────┘           │    → AuditLog               │
                         └──────────┬──────────────────┘
                                    │
                         Does this need intelligence?
                                    │
                    ┌───────────────┼───────────────┐
                    │ NO                            │ YES
                    ▼                               ▼
              Skip / Queue / Merge          ┌─ THE HORSE ─┐
              (deterministic)               │  LLM Call    │
                                            │  Exec Engine │
                                            └──────────────┘
```

**The Harness** handles event routing, policy evaluation, rate limiting, budget enforcement, and event merging — all without touching the LLM. **The Horse** (the LLM) is only invoked when the policy engine decides intelligence is genuinely needed.

This means autonomous agents are cheaper, faster, and more predictable than architectures that blindly invoke an LLM on every tick.

## Quick Start

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("ops-agent")
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .withGateway({
    heartbeat: {
      intervalMs: 1_800_000, // 30 minutes
      policy: "adaptive",    // Skip ticks when idle
      instruction: "Check for pending tasks and take action if needed",
    },
    crons: [
      {
        schedule: "0 9 * * MON-FRI",
        instruction: "Review overnight alerts and summarize",
        priority: "high",
      },
    ],
    webhooks: [
      {
        path: "/github",
        adapter: "github",
        secret: process.env.GITHUB_WEBHOOK_SECRET,
      },
    ],
    policies: {
      dailyTokenBudget: 50_000,
      maxActionsPerHour: 20,
      heartbeatPolicy: "adaptive",
    },
  })
  .build();
```

## Five Input Sources

All inputs normalize to a universal `GatewayEvent` envelope before entering the policy engine:

```typescript
interface GatewayEvent {
  readonly id: string;
  readonly source: "heartbeat" | "cron" | "webhook" | "channel" | "a2a" | "state-change";
  readonly timestamp: Date;
  readonly agentId?: string;
  readonly payload: unknown;
  readonly priority: "low" | "normal" | "high" | "critical";
  readonly metadata: Record<string, unknown>;
  readonly traceId?: string;
}
```

### Heartbeats

Periodic ticks that give agents "thinking turns" — time to check memory, review pending items, and take proactive action.

```typescript
heartbeat: {
  intervalMs: 1_800_000,       // Every 30 minutes
  policy: "adaptive",          // Skip when nothing changed
  instruction: "Review and act on pending items",
  maxConsecutiveSkips: 6,      // Force execution after 6 skips
}
```

| Policy | Behavior |
|--------|----------|
| `"always"` | Fire every tick (like OpenClaw) |
| `"adaptive"` | Skip when agent state hasn't changed — no pending events, no memory updates. Saves ~50%+ of ticks when idle |
| `"conservative"` | Only fire when pending events exist |

After `maxConsecutiveSkips` (default: 6), the heartbeat fires regardless of policy to prevent indefinite silence.

### Cron Schedules

Standard 5-field cron expressions with attached instructions. Zero external dependencies.

```typescript
crons: [
  {
    schedule: "0 9 * * MON",            // 9 AM every Monday (UTC)
    instruction: "Generate weekly project status report",
    priority: "high",
  },
  {
    schedule: "*/15 * * * *",           // Every 15 minutes
    instruction: "Check deployment health",
    priority: "normal",
    enabled: true,
  },
  {
    schedule: "0 0 1 * *",             // Midnight on the 1st
    instruction: "Run monthly cost analysis",
  },
]
```

**Supported syntax:** `*`, specific values, ranges (`8-17`), steps (`*/15`), comma lists (`MON,WED,FRI`), day names (`MON`-`SUN`).

### Webhooks

HTTP POST endpoints with pluggable adapters for signature validation and payload transformation.

```typescript
webhooks: [
  {
    path: "/github",
    adapter: "github",
    secret: process.env.GITHUB_WEBHOOK_SECRET,
    events: ["push", "pull_request"],   // Optional: filter by event type
  },
  {
    path: "/stripe",
    adapter: "generic",
    secret: process.env.STRIPE_WEBHOOK_SECRET,
  },
]
```

**Built-in adapters:**

| Adapter | Validation | Classification |
|---------|-----------|---------------|
| `"github"` | HMAC-SHA256 via `X-Hub-Signature-256` | `"push"`, `"pull_request.opened"`, etc. |
| `"generic"` | Configurable HMAC header and algorithm | Extracted from payload or `"webhook.received"` |

#### Custom Webhook Adapters

Implement the `WebhookAdapter` interface for any source:

```typescript
import type { WebhookAdapter } from "@reactive-agents/gateway";
import { Effect } from "effect";

const stripeAdapter: WebhookAdapter = {
  source: "stripe",
  validateSignature: (req, secret) => {
    // Verify Stripe-Signature header
    return Effect.succeed(verifyStripeSignature(req, secret));
  },
  transform: (req) => {
    const body = JSON.parse(req.body);
    return Effect.succeed({
      id: body.id,
      source: "webhook" as const,
      timestamp: new Date(),
      payload: body,
      priority: body.type.includes("failed") ? "high" as const : "normal" as const,
      metadata: { adapter: "stripe", type: body.type },
    });
  },
  classify: (event) => String((event.metadata as any).type ?? "stripe.event"),
};
```

## Policy Engine

The policy engine evaluates a chain of policies against each incoming event. Policies are sorted by priority (lower number = evaluated first), and the **first non-null decision wins**. If no policy returns a decision, the event is executed.

### Five Decision Types

```typescript
type PolicyDecision =
  | { action: "execute"; taskDescription: string }  // Run it
  | { action: "queue"; reason: string }              // Defer for later
  | { action: "skip"; reason: string }               // Drop it
  | { action: "merge"; mergeKey: string }            // Batch with similar events
  | { action: "escalate"; reason: string }           // Flag for human review
```

### Four Built-in Policies

| Policy | Priority | What It Does |
|--------|----------|-------------|
| **Adaptive Heartbeat** | 10 | Skips heartbeat ticks when agent state is unchanged |
| **Cost Budget** | 20 | Blocks execution when daily token budget is exhausted |
| **Rate Limit** | 30 | Caps actions per hour to prevent runaway execution |
| **Event Merging** | 50 | Batches events with the same merge key (e.g., 5 PRs = 1 review) |

**Critical priority events bypass** cost budget and rate limit policies.

### Custom Policies

```typescript
import type { SchedulingPolicy } from "@reactive-agents/gateway";
import { Effect } from "effect";

const businessHoursOnly: SchedulingPolicy = {
  _tag: "BusinessHours",
  priority: 15,
  evaluate: (event, state) => {
    const hour = new Date().getUTCHours();
    if (hour < 9 || hour > 17) {
      return Effect.succeed({ action: "queue" as const, reason: "Outside business hours" });
    }
    return Effect.succeed(null); // Pass to next policy
  },
};
```

Register custom policies via the `PolicyEngine` service:

```typescript
import { PolicyEngine } from "@reactive-agents/gateway";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const engine = yield* PolicyEngine;
  yield* engine.addPolicy(businessHoursOnly);
});
```

## Ethical Autonomy

The gateway is built on three principles that ensure autonomous agents remain trustworthy:

### Observable

Every autonomous action is logged to the EventBus. Nothing happens in the dark.

| Event | When |
|-------|------|
| `GatewayEventReceived` | An event enters the router |
| `PolicyDecisionMade` | A policy makes a routing decision |
| `ProactiveActionInitiated` | The LLM is invoked for an autonomous task |
| `ProactiveActionCompleted` | An autonomous task finishes |
| `ProactiveActionSuppressed` | A policy blocked an event from reaching the LLM |
| `HeartbeatSkipped` | A heartbeat tick was skipped (with reason and skip count) |
| `EventsMerged` | Multiple events were batched into one |
| `BudgetExhausted` | Daily token budget reached |

Subscribe to any of these for real-time monitoring:

```typescript
await agent.subscribe("ProactiveActionSuppressed", (event) => {
  console.log(`Suppressed: ${event.reason} (event: ${event.eventId})`);
});

await agent.subscribe("BudgetExhausted", (event) => {
  console.log(`Budget hit: ${event.tokensUsed}/${event.dailyBudget} tokens`);
});
```

### Bounded

Hard limits prevent runaway execution:

- **Token budgets** — Daily cap on LLM token consumption (default: 100,000)
- **Rate limits** — Maximum actions per hour (default: 30)
- **Critical bypass** — Only `"critical"` priority events can exceed limits
- **Kill switch** — `agent.stop()` or `agent.terminate()` halts the entire event loop
- **Adaptive heartbeats** — Idle agents skip ticks instead of burning tokens

### Consentful

Agents declare their autonomous capabilities upfront. No hidden behaviors.

```typescript
policies: {
  dailyTokenBudget: 50_000,       // User sets the ceiling
  maxActionsPerHour: 20,          // User controls the rate
  heartbeatPolicy: "adaptive",    // User chooses the mode
  requireApprovalFor: ["deploy"], // User gates sensitive actions
}
```

## Gateway Status & Stats

Monitor gateway health programmatically:

```typescript
import { GatewayService } from "@reactive-agents/gateway";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const gw = yield* GatewayService;
  const status = yield* gw.status();

  console.log(status.isRunning);             // true
  console.log(status.uptime);                // 3600000 (ms)
  console.log(status.stats.heartbeatsFired); // 12
  console.log(status.stats.heartbeatsSkipped); // 36
  console.log(status.stats.webhooksReceived);  // 8
  console.log(status.stats.totalTokensUsed);   // 23400
  console.log(status.stats.actionsSuppressed); // 5
});
```

**Stats tracked:**

| Stat | Description |
|------|-------------|
| `heartbeatsFired` / `heartbeatsSkipped` | Heartbeat efficiency ratio |
| `webhooksReceived` / `webhooksProcessed` / `webhooksMerged` | Webhook throughput |
| `cronsExecuted` | Cron jobs completed |
| `totalTokensUsed` | Cumulative LLM token consumption |
| `actionsSuppressed` / `actionsEscalated` | Policy enforcement activity |

## Integration with Existing Layers

The gateway enhances — and is enhanced by — every existing layer:

| Layer | How It Integrates |
|-------|-------------------|
| **Guardrails** | Webhook payloads are checked for injection/PII before reaching the LLM |
| **Cost** | Budget policies delegate to the same CostService used by user-initiated tasks |
| **Identity** | Agent certificates can authenticate webhook sources |
| **Memory** | Heartbeats consult episodic memory for context before deciding to act |
| **Observability** | All gateway events stream to the metrics dashboard and tracing system |
| **Kill Switch** | `agent.stop()` halts the gateway event loop at the next phase boundary |
| **Verification** | Autonomous outputs are fact-checked before being sent |
| **Orchestration** | High-risk actions can route through approval gates |

## Configuration Reference

### `GatewayConfig`

```typescript
interface GatewayConfig {
  heartbeat?: HeartbeatConfig;
  crons?: CronEntry[];
  webhooks?: WebhookConfig[];
  policies?: PolicyConfig;
  port?: number;                    // Default: 3000
}
```

### `HeartbeatConfig`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `intervalMs` | `number` | — | Milliseconds between heartbeat ticks |
| `policy` | `"always" \| "adaptive" \| "conservative"` | `"adaptive"` | Heartbeat firing strategy |
| `instruction` | `string` | — | What the agent should do on each tick |
| `maxConsecutiveSkips` | `number` | `6` | Force execution after N consecutive skips |

### `CronEntry`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `schedule` | `string` | — | 5-field cron expression |
| `instruction` | `string` | — | Task for the agent when cron fires |
| `agentId` | `string` | — | Override target agent |
| `priority` | `EventPriority` | `"normal"` | Event priority level |
| `enabled` | `boolean` | `true` | Toggle without removing |

### `PolicyConfig`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dailyTokenBudget` | `number` | `100_000` | Max tokens per day |
| `maxActionsPerHour` | `number` | `30` | Max LLM invocations per hour |
| `heartbeatPolicy` | `HeartbeatPolicy` | `"adaptive"` | Heartbeat strategy |
| `mergeWindowMs` | `number` | `300_000` | Event merge window (5 min) |
| `requireApprovalFor` | `string[]` | — | Categories requiring human approval |

## Messaging Channels

The gateway enables agents to communicate via **Signal** and **Telegram** using existing MCP servers in Docker containers. No custom adapter code needed — the framework's `.withMCP()` connects to the messaging servers, and the gateway heartbeat drives message polling.

See the [Messaging Channels guide](/guides/messaging-channels/) for setup instructions.

## Error Types

| Error | When |
|-------|------|
| `GatewayError` | General gateway failure |
| `GatewayConfigError` | Invalid configuration |
| `WebhookValidationError` | Signature verification failed (401) |
| `WebhookTransformError` | Payload transformation failed |
| `PolicyViolationError` | Policy explicitly rejected an event |
| `SchedulerError` | Invalid cron expression or scheduling failure |
| `ChannelConnectionError` | Channel adapter connection failure |

All errors are `Data.TaggedError` instances — pattern-matchable in Effect error handlers.
