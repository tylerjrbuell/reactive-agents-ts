---
title: Agent Gateway
description: >-
  Persistent autonomous agent harness with adaptive heartbeats, cron scheduling,
  webhooks, and a composable policy engine.
sidebar:
  order: 3
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
  .withTools({ builtins: true })
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

<!-- docs-skip-typecheck -->
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

#### Durable schedules (`ScheduleRegistry`)

Every cron entry lives in a `ScheduleRegistry`: a stable id, `enabled`, `nextFireAt`, `lastRun`, `runCount`. Entries from `crons` are seeded with an id derived from their definition (`cfg-<hash>`), so an entry keeps its id and history across restarts and reordering. Schedules can also be created through the registry (cron or one-shot `runAt`) and survive a restart when you give the registry a SQLite `path`. Without a `path` the registry is in-memory.

```typescript
import { Effect } from "effect";
import { ScheduleRegistry, ScheduleRegistryLive } from "@reactive-agents/gateway";

const program = Effect.gen(function* () {
  const schedules = yield* ScheduleRegistry;
  const s = yield* schedules.create({
    cron: "0 9 * * *",
    timezone: "Europe/Berlin",
    instruction: "Summarise overnight alerts",
    catchUp: { mode: "fire-once" },
    delivery: { adapterId: "telegram", conversationId: "1001" },
  });
  yield* schedules.pause(s.id); // resume(id), remove(id), update(id, patch)
  yield* schedules.runNow(s.id); // works while paused
  return yield* schedules.lastResult(s.id); // { runId, firedAt, status, outputRef?, error?, delivery? }
}).pipe(Effect.provide(ScheduleRegistryLive({ path: ".reactive-agents/gateway.db" })));
```

**Restart catch-up.** The registry stores `lastCheckedAt`. After downtime, fires that were due more than 5 minutes ago are "missed" and follow the schedule's `catchUp` policy: `skip` drops them, `fire-once` (default) runs the most recent one once, `fire-all` runs them oldest first, at most `maxFires` (default 10) of the newest. Time spent paused is never caught up. A skipped one-shot leaves a `skipped` receipt in `lastRun`.

**Crash safety.** A fire is saved as `running` before it is handed to the executor. If the process dies before the run is settled, the next start re-offers it under the same `fireId` (delivery is at-least-once, so make scheduled instructions safe to repeat), following the schedule's `catchUp` policy: `skip` closes the interrupted run as `failed` ("interrupted by gateway restart"), `fire-once` re-offers the newest, `fire-all` re-offers up to `maxFires`. Manual runs and runs of paused schedules are closed, never re-run. Each fire keeps its own result: `runs` holds the last 20 runs (oldest first) and `lastRun` is the newest. Waiting events in the in-memory inbound queue are lost on restart; cron fires replay via the registry.

**Config re-sync.** On every start, config-declared schedules take `priority` from the config again. A runtime pause survives a restart unless the config's own `enabled` value changed since the last start, in which case the config wins.

**Reporting results.** A fired schedule starts with `lastRun.status: "running"`. The executor reports the outcome with `completeRun(id, fireId, { runId, status, outputRef?, error? })`. The `scheduleId` and `fireId` travel in the `GatewayEvent.metadata` of the cron event. `recordDelivery` stores the typed delivery outcome; `deliverScheduleResult` in `@reactive-agents/channels` sends the result through `ChannelService.deliver` and records the real message id or the error kind.

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

The `"github"` adapter rejects a replayed `x-github-delivery` id (a bounded per-adapter cache of the last 1024 ids), so a redelivered event does not run twice.

#### Serving webhooks (ingress)

`startGatewayIngress(config, { onEvent })` opens one small HTTP server for `GatewayConfig.webhooks` on `GatewayConfig.port`, bound to `127.0.0.1` unless you pass another `hostname`. It opens no socket when nothing is configured. Channel webhooks (for example Telegram) mount on the same server through `channelRoutes`.

```typescript
import { Effect, Redacted } from "effect";
import { WebhookServiceLive, startIngress } from "@reactive-agents/gateway";
import { TelegramChannelAdapter, channelWebhookRoute } from "@reactive-agents/channels";

const telegram = new TelegramChannelAdapter({
  token: Redacted.make(process.env.TELEGRAM_BOT_TOKEN ?? ""),
  webhook: { secretToken: process.env.TELEGRAM_WEBHOOK_SECRET ?? "" },
});

const serve = startIngress({
  port: 3000,
  maxBodyBytes: 256 * 1024,
  channelRoutes: [channelWebhookRoute("/channels/telegram", telegram)],
  onEvent: () => Effect.void, // must enqueue the event, not run the agent
}).pipe(Effect.provide(WebhookServiceLive()), Effect.scoped);
```

The agent's own ingress serves every webhook-capable channel adapter at `/channels/<id>`. A host that mounts the adapter itself turns that off with `gateway.ingress` (builder `.withGateway({ ingress: { channels: false } })`, or the same key in `AgentConfig`): `false` serves none, a string list only those ids.

Fail-closed by design: POST only (405 otherwise), bodies over `maxBodyBytes` (default 1 MiB) get 413 before any parsing, a sender that stalls longer than `bodyTimeoutMs` (default 10 s) gets 408, more than `maxInFlight` (default 64) simultaneous requests get 503 before any body is read, unknown paths 404, a webhook route with no secret refuses every request, and a bad or missing signature is 401. Error bodies are generic; adapter messages never leave the process. Behind a public URL, terminate TLS in a reverse proxy.

#### Custom Webhook Adapters

Implement the `WebhookAdapter` interface for any source:

<!-- docs-skip-typecheck -->
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

### Five Built-in Policies

| Policy | Priority | What It Does |
|--------|----------|-------------|
| **Access Control** | 5 | Allowlist/blocklist channel senders by identity; unknown senders skip or escalate |
| **Adaptive Heartbeat** | 10 | Skips heartbeat ticks when agent state is unchanged |
| **Cost Budget** | 20 | Blocks execution when daily token budget is exhausted |
| **Rate Limit** | 30 | Caps actions per hour to prevent runaway execution |
| **Event Merging** | 50 | Batches events with the same merge key (e.g., 5 PRs = 1 review) |

Access Control only evaluates events with `source: "channel"` (webhooks, chat) — it's a no-op on cron/heartbeat-originated events. Create one with `createAccessControlPolicy`:

```typescript
import { createAccessControlPolicy } from "@reactive-agents/gateway";

const accessPolicy = createAccessControlPolicy({
  policy: "allowlist",
  allowedSenders: ["email:alice@example.com", "signal:+15551234567"], // platform:userId
  unknownSenderAction: "escalate", // or "skip" (default)
});
```

Sender keys are namespaced `platform:userId` (taken from the event's `metadata.platform` and `metadata.sender`), so identical ids on different platforms never collide. A channel event with an empty sender is always denied.

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

<!-- docs-skip-typecheck -->
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

<!-- docs-skip-typecheck -->
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
| `chatTurnsHandled` | Incoming channel messages handled in chat mode |
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

<!-- docs-skip-typecheck -->
```typescript
interface GatewayConfig {
  heartbeat?: HeartbeatConfig;
  crons?: CronEntry[];
  webhooks?: WebhookConfig[];
  accessControl?: GatewayAccessControlConfig;
  policies?: PolicyConfig;
  port?: number;                    // Default: 3000
  queue?: { capacity?: number; overflow?: "drop-oldest" | "drop-newest" };
  persistMemoryAcrossRuns?: boolean; // Share agent ID across ticks for memory continuity
  timezone?: string;                // IANA timezone for cron evaluation (default: "UTC")
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

### `GatewayAccessControlConfig` (`accessControl`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `accessPolicy` | `"allowlist" \| "blocklist" \| "open"` | `"allowlist"` | Who can send messages |
| `allowedSenders` | `string[]` | — | `platform:userId` entries allowed (allowlist mode), e.g. `signal:+15551234567` |
| `blockedSenders` | `string[]` | — | `platform:userId` entries blocked (blocklist mode) |
| `unknownSenderAction` | `"skip" \| "escalate"` | `"skip"` | What to do with unauthorized senders |
| `replyToUnknown` | `string` | — | Fixed reply to allowlist-denied senders. Sent only by the `@reactive-agents/channels` `ChannelService` (native adapters); the legacy MCP-push path does not send it |
| `mode` | `"chat" \| "task"` | `"chat"` | `"chat"` maintains per-sender conversation history; `"task"` sends one-shot instructions |
| `sessionTtlDays` | `number` | `30` | Days of inactivity before a chat session is pruned |

### Inbound queue (`queue`)

Events that arrive while the agent is busy, and events the policy engine defers (rate limit, token budget), wait in a bounded in-memory queue. One worker drains it in order, one agent run at a time.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `capacity` | `number` | `100` | Maximum waiting events per list (ready and deferred) |
| `overflow` | `"drop-oldest" \| "drop-newest"` | `"drop-oldest"` | What to discard when a full queue receives another event |

Every queued, deferred and dropped event is published as a `ProactiveActionSuppressed` event whose `policy` is `inbound-queue:queued`, `inbound-queue:deferred` or `inbound-queue:dropped`. The queue is in memory only: waiting events are lost on restart. Cron fires survive because they replay through the schedule registry.

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

const builder = ReactiveAgents.create()
  .withName("busy-agent")
  .withProvider("test")
  .withGateway({ queue: { capacity: 50, overflow: "drop-newest" } });
```

### `GatewaySummary`

Returned by `handle.stop()`:

| Field | Type | Description |
|-------|------|-------------|
| `heartbeatsFired` | `number` | Heartbeat ticks that triggered an LLM run |
| `totalRuns` | `number` | Total agent executions (heartbeats + crons + channels) |
| `cronChecks` | `number` | Cron schedule evaluations |
| `chatTurns` | `number \| undefined` | Incoming channel messages handled in chat mode |
| `error` | `string \| undefined` | Fatal error if the loop exited unexpectedly |

### `PolicyConfig`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dailyTokenBudget` | `number` | `100_000` | Max tokens per day |
| `maxActionsPerHour` | `number` | `30` | Max LLM invocations per hour |
| `heartbeatPolicy` | `HeartbeatPolicy` | `"adaptive"` | Heartbeat strategy |
| `mergeWindowMs` | `number` | `300_000` | Event merge window (5 min) |
| `requireApprovalFor` | `string[]` | — | Categories requiring human approval |

## Messaging Channels

Agents talk to **Signal** and **Telegram** through native channel adapters from `@reactive-agents/channels`: `SignalChannelAdapter` (signal-cli JSON-RPC) and `TelegramChannelAdapter` (Bot API, long polling or webhook). Each implements the `ChannelAdapter` contract, so `ChannelService` sends replies itself and gets real delivery receipts instead of relying on the model to call a send tool. Register adapters with `.withChannels({ adapters: [...] })`. The older MCP-server setups (Docker Signal image, Telethon Telegram) still work, but they are the legacy path: no receipts, and the model does the sending.

Webhook-capable adapters (for example Telegram in webhook mode) mount on the gateway ingress server; see [Serving webhooks (ingress)](#serving-webhooks-ingress). To write your own adapter, see the [Channel Adapters guide](/guides/channel-adapters/).

See the [Messaging Channels guide](/guides/messaging-channels/) for setup instructions.

### Channel Access Control

<!-- docs-skip-typecheck -->
```typescript
accessControl: {
  accessPolicy: "allowlist",           // "allowlist" | "blocklist" | "open"
  allowedSenders: ["signal:+15551234567"], // platform:userId
  unknownSenderAction: "skip",         // "skip" | "escalate"
  replyToUnknown: "Sorry, I only respond to authorized contacts.",
}
```

:::caution[Breaking: channels reject unknown senders by default]
A gateway with **no `accessControl`** now denies every inbound channel sender (Telegram, Signal, webhook-channel) instead of letting them drive the agent. The deny reason names the sender (`telegram:123`) and how to allow it, and the gateway logs a warning at start. Set `accessControl.allowedSenders`, or opt in to the old behavior explicitly with `accessControl: { accessPolicy: "open" }`. An `accessControl` block with no `accessPolicy` still defaults to `allowlist`.
:::

:::caution[Breaking: senders are `platform:userId`]
`allowedSenders` and `blockedSenders` entries must carry the platform prefix (`signal:+15551234567`, `telegram:123456789`). A bare `+15551234567` no longer matches a platform-tagged sender, so an old allowlist denies everyone and an old blocklist blocks no one. Prefix every existing entry when you upgrade. A channel event with an empty sender is always denied.
:::

### Gateway Chat Mode

By default (`accessControl.mode: "chat"`), each incoming channel message starts a **stateful per-sender conversation** — not a one-shot task. The agent receives the full conversation history, recent episodic context, and a directive to respond via the channel tool.

<!-- docs-skip-typecheck -->
```typescript
accessControl: {
  accessPolicy: "allowlist",
  allowedSenders: ["signal:+15551234567"],
  mode: "chat",          // default — persistent per-sender history
  sessionTtlDays: 30,    // prune inactive sessions after 30 days
}
```

**What happens each turn:**

1. Session history for the sender is loaded from SQLite (or the in-memory cache for repeat turns)
2. History is windowed to the most recent **40 turns / 8,000 characters** before injection
3. Recent gateway activity (heartbeat and cron results) is injected as episodic context — `chat-turn` episodes are filtered out to avoid recursive noise
4. The enriched instruction is sent to the execution engine: episodic context → conversation history → user message → tool delivery directive
5. After the agent run, both the user message and the assistant reply are appended to the session and persisted to SQLite
6. `GatewaySummary.chatTurns` is incremented

**Session IDs:** each sender's conversation is keyed under a canonical id of the form `sess_gateway_<agentId>_<sender>`. Sessions persisted under the legacy `gateway-chat-<agentId>-<sender>` keys remain loadable via fallback, and new saves switch to the canonical id without losing the loaded turns.

**Task mode** skips all of the above and sends a direct one-shot instruction per message:

<!-- docs-skip-typecheck -->
```typescript
accessControl: {
  mode: "task",   // stateless — no history, no session persistence
}
```

Use `task` mode when each message is an independent command and you don't want conversation context to accumulate (e.g. automation triggers, slash-command bots).

**Memory requirements:** Chat mode requires `.withMemory()` to be configured — session persistence is backed by `SessionStoreService`, and episodic context injection uses `EpisodicMemoryService`. Without a memory layer, sessions are in-memory only (lost on restart) and episodic context is empty.

<!-- docs-skip-typecheck -->
```typescript
const agent = await ReactiveAgents.create()
  .withName("signal-agent")
  .withAgentId("signal-agent")      // stable ID for memory continuity across restarts
  .withProvider("ollama")
  .withChannels({ adapters: [signal] }) // a SignalChannelAdapter, see the Messaging Channels guide
  .withMemory({ tier: "enhanced", dbPath: "./memory.sqlite" })
  .withGateway({
    persistMemoryAcrossRuns: true,
    accessControl: {
      accessPolicy: "allowlist",
      allowedSenders: [`signal:${process.env.RECIPIENT ?? ""}`], // platform:userId, not a bare number
      mode: "chat",
      sessionTtlDays: 30,
    },
  })
  .build();
```

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

## What's Next

- [Messaging Channels](/guides/messaging-channels/) — wire Signal or Telegram as an input source
- [A2A Protocol](/features/a2a-protocol/) — expose a gateway-hosted agent to other agents
- [Production Checklist](/guides/production-checklist/) — everything else to enable before a gateway runs unattended in production
