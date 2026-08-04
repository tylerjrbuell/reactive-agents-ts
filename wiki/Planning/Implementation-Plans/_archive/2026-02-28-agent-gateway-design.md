# Agent Gateway Design — Persistent Autonomous Agent Harness

**Date:** 2026-02-28
**Package:** `@reactive-agents/gateway`
**Status:** Design approved, pending implementation plan
**Inspiration:** OpenClaw architecture (gateway, heartbeats, crons, webhooks, channels)
**Philosophy:** The optimistic side of AI agents — ethical, observable, bounded autonomy

---

## Vision

Reactive Agents is a framework for building AI agents that are ethical by default, observable by design, and autonomous only within explicit bounds. The gateway package extends the framework from request-response into persistent, proactive operation — where agents respond not just to users, but to time, external events, and state changes.

The gateway embodies a core principle: **the harness, not the horse**. Deterministic infrastructure collects events, evaluates conditions, manages state, and enforces policies without LLM involvement. The LLM is invoked only when a decision genuinely requires intelligence. This makes autonomous agents cheaper, faster, more reliable, and more predictable than architectures that route every input through an LLM call.

---

## Foundational Principle: The Harness, Not the Horse

OpenClaw's architecture treats the LLM as the center of every decision. Every heartbeat tick = an LLM call. Every webhook = an LLM call. The LLM becomes the bottleneck, the cost center, and the single point of failure.

Reactive Agents inverts this. The harness is deterministic infrastructure that runs without LLM involvement. It collects events, evaluates conditions, manages state, enforces policies — and only invokes the LLM when a decision genuinely requires intelligence. The framework already applies this pattern in guardrails (heuristic first, LLM fallback), cost routing (heuristic classification), and semantic caching (embedding similarity before LLM). The gateway extends this pattern to the entire autonomous lifecycle.

```
┌─────────────────────────────────────────────────────┐
│              THE HARNESS (zero LLM)                 │
│                                                     │
│  Scheduler ─→ InputRouter ─→ PolicyEngine ─→        │
│  Webhooks  ─→                EventBus    ─→  ───┐   │
│  Channels  ─→                AuditLog    ─→     │   │
│                                                  │   │
│           "Does this need intelligence?"          │   │
│                │              │                   │   │
│               NO             YES                 │   │
│                │              │                   │   │
│           Deterministic   ┌───▼──────────┐       │   │
│           action          │  THE HORSE   │       │   │
│           (route, log,    │  (LLM call)  │       │   │
│            store, skip)   │  Exec Engine │       │   │
│                           └──────────────┘       │   │
└─────────────────────────────────────────────────────┘
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    AgentGateway                          │
│               (persistent Bun process)                  │
├───────────┬───────────┬────────────┬────────────────────┤
│ Scheduler │ Webhook   │ Channel    │ A2A Server         │
│ Service   │ Service   │ Adapters   │ (existing)         │
│           │           │            │                    │
│ heartbeat │ POST /wh  │ Slack      │ JSON-RPC 2.0      │
│ cron      │ validate  │ Discord    │ (already built)    │
│ interval  │ transform │ Telegram   │                    │
└─────┬─────┴─────┬─────┴──────┬─────┴──────────┬────────┘
      │           │            │                │
      └───────────┴────────────┴────────────────┘
                        │
               ┌────────▼────────┐
               │  InputRouter    │
               │  (normalize →   │
               │   classify  →   │
               │   route)        │
               └────────┬────────┘
                        │
               ┌────────▼────────┐
               │  PolicyEngine   │
               │  (filter, merge │
               │   budget, gate) │
               └────────┬────────┘
                        │
               ┌────────▼────────┐
               │  EventBus       │  ← existing, unchanged
               └────────┬────────┘
                        │
               ┌────────▼────────┐
               │ ExecutionEngine  │  ← existing, unchanged
               └─────────────────┘
```

The gateway is a new Effect-TS layer that composes with the existing runtime via `Layer.provide()`. No existing code changes required. Every existing package (guardrails, cost, identity, memory, observability, verification, kill switch) enhances autonomous behavior automatically.

---

## Section 1: Input Sources

### Universal Input Abstraction

Every input source implements a single interface. This makes the system extensible — adding a new source (email, SMS, IoT sensor) requires only implementing `InputSource`.

```typescript
interface InputSource {
  readonly _tag: string
  readonly start: Effect<void, GatewayError>
  readonly stop: Effect<void, never>
  readonly events: Stream<GatewayEvent, GatewayError>
}
```

### GatewayEvent — The Universal Envelope

All inputs normalize to one type before entering the router:

```typescript
interface GatewayEvent {
  readonly id: string                    // unique event ID (ULID)
  readonly source: GatewayEventSource    // discriminator
  readonly timestamp: Date
  readonly agentId?: AgentId             // target agent (if known)
  readonly payload: unknown              // source-specific data
  readonly priority: EventPriority       // low | normal | high | critical
  readonly metadata: Record<string, unknown>
  readonly traceId?: string              // correlation with observability
}

type GatewayEventSource =
  | "heartbeat"
  | "cron"
  | "webhook"
  | "channel"
  | "a2a"
  | "state-change"
```

### Input Source 1: Heartbeats

Periodic timer ticks that give agents "thinking turns." Unlike OpenClaw's fixed 30-minute timer that always invokes the LLM, Reactive Agents heartbeats are **adaptive by default**.

```
tick → PolicyEngine evaluates (zero LLM cost):
  1. Has memory changed since last tick? → check Ref counter
  2. Any pending items in working memory? → check capacity
  3. Any unprocessed webhook backlog? → check queue depth
  4. Time-based rules matched? → check cron overlap
  5. State-change policies triggered? → check thresholds

  ALL conditions false → skip tick (logged as suppressed)
  ANY condition true  → create Task, invoke ExecutionEngine
```

Configuration:

```typescript
interface HeartbeatConfig {
  readonly interval: Duration          // default: 30 minutes
  readonly policy: "always" | "adaptive" | "conservative"
  readonly instruction?: string        // what to do on tick (optional)
  readonly maxConsecutiveSkips?: number // force a tick after N skips
}
```

- `"always"` — OpenClaw behavior, every tick fires (useful for monitoring agents)
- `"adaptive"` — skip when no state changes detected (recommended default)
- `"conservative"` — only fire when explicit state-change thresholds met

### Input Source 2: Crons

Standard cron expressions with attached instructions. Each cron entry is a typed configuration:

```typescript
interface CronEntry {
  readonly schedule: string        // cron expression: "0 9 * * MON"
  readonly instruction: string     // task description for the agent
  readonly agentId?: AgentId       // target agent (default: gateway's primary)
  readonly priority?: EventPriority
  readonly timezone?: string       // IANA timezone, default UTC
  readonly enabled?: boolean       // toggle without removing
}
```

Implementation uses Bun's built-in timing primitives with a lightweight cron parser (no external dependencies). The scheduler calculates next-fire times and sleeps efficiently.

### Input Source 3: Webhooks

HTTP POST endpoint with pluggable adapters for different sources. Each adapter handles signature validation and payload transformation without LLM involvement.

```typescript
interface WebhookAdapter {
  readonly source: string                        // "github" | "slack" | "generic"
  readonly validateSignature: (
    req: WebhookRequest,
    secret: string
  ) => Effect<boolean, WebhookValidationError>
  readonly transform: (
    req: WebhookRequest
  ) => Effect<GatewayEvent, WebhookTransformError>
  readonly classify: (
    event: GatewayEvent
  ) => string                                    // category for routing
}
```

Built-in adapters:

| Adapter | Signature | Classification |
|---------|-----------|---------------|
| `github` | HMAC-SHA256 (`X-Hub-Signature-256`) | Event type + action → category |
| `slack` | Slack signing secret | Event type → category |
| `generic` | Configurable header + algorithm | User-defined rules |

The webhook HTTP server runs alongside the existing A2A HTTP server (same port, different path prefix: `/webhooks/*` vs `/a2a/*`).

### Input Source 4: Channel Adapters

Bidirectional messaging platform connections. Each adapter maintains a persistent connection and translates platform-specific events to/from the universal format.

```typescript
interface ChannelAdapter {
  readonly platform: string              // "slack" | "discord" | "telegram"
  readonly connect: Effect<void, ChannelConnectionError>
  readonly disconnect: Effect<void, never>
  readonly onMessage: Stream<ChannelMessage, ChannelError>
  readonly sendMessage: (
    channelId: string,
    content: string
  ) => Effect<void, ChannelSendError>
}

interface ChannelMessage {
  readonly platform: string
  readonly channelId: string
  readonly userId: string
  readonly content: string
  readonly timestamp: Date
  readonly threadId?: string
  readonly metadata: Record<string, unknown>
}
```

Channel adapters are provided as separate optional packages (e.g., `@reactive-agents/gateway-slack`) to avoid pulling in platform SDKs for users who don't need them. The gateway package defines the interface; adapter packages implement it.

### Input Source 5: State Changes

Internal events triggered by agent state transitions. Unlike OpenClaw's generic "hooks" (which fire on every state change), Reactive Agents state-change sources evaluate **threshold policies** — the harness determines if a state change is significant enough to warrant agent attention.

```typescript
interface StateChangeSource {
  readonly watch: (agentId: AgentId) => Stream<GatewayEvent, never>
  readonly policies: StateChangePolicy[]
}

interface StateChangePolicy {
  readonly condition: string        // human-readable description
  readonly evaluate: (
    prev: AgentState,
    next: AgentState
  ) => boolean                      // did the threshold trigger?
  readonly priority: EventPriority
  readonly instruction?: string     // what to tell the agent
}
```

Built-in state-change policies:

- **WorkingMemoryOverflow** — triggers when working memory exceeds N items
- **WebhookBacklog** — triggers when N webhooks of the same category accumulate
- **IdleTimeout** — triggers when agent hasn't executed in N hours
- **MemoryDrift** — triggers when semantic memory changes significantly (embedding distance)

---

## Section 2: The Policy Engine

The policy engine is the decision layer between input sources and execution. It operates entirely without LLM calls, making deterministic decisions about what to do with each event.

### PolicyDecision Type

```typescript
type PolicyDecision =
  | { readonly action: "execute"; readonly task: Task }
  | { readonly action: "queue"; readonly reason: string; readonly retryAfter?: Duration }
  | { readonly action: "skip"; readonly reason: string }
  | { readonly action: "merge"; readonly mergeWith: GatewayEvent }
  | { readonly action: "route"; readonly targetAgentId: AgentId }
  | { readonly action: "escalate"; readonly reason: string; readonly channelId?: string }
```

### SchedulingPolicy Interface

```typescript
interface SchedulingPolicy {
  readonly _tag: string
  readonly priority: number        // evaluation order (lower = earlier)
  readonly evaluate: (
    event: GatewayEvent,
    state: GatewayState
  ) => Effect<PolicyDecision | null, never>
  // null = no opinion, pass to next policy
}
```

Policies compose as a chain. The first policy to return a non-null decision wins. If all return null, the default is `execute`.

### Built-in Policies

**AdaptiveHeartbeat** — Skip heartbeat ticks when agent state hasn't changed since the last execution. Checks: memory revision counter, pending event queue depth, time since last execution. Configurable `maxConsecutiveSkips` forces periodic ticks even when idle.

**CostBudget** — Reject events that would exceed a token budget for a time window. Integrates with the existing `@reactive-agents/cost` package. Budgets are configurable per time window (hourly, daily, weekly). When budget is exhausted, events are queued (not dropped) and resume when the window resets.

```typescript
CostBudget({
  hourly: 5_000,     // max tokens per hour on autonomous actions
  daily: 50_000,     // max tokens per day
  onExhausted: "queue"  // "queue" | "skip" | "escalate"
})
```

**RateLimit** — Cap the number of autonomous executions per time window. Prevents runaway agents. Configurable per source type (e.g., allow 50 webhook-triggered executions/hour but only 5 heartbeat executions/hour).

**EventMerging** — Batch multiple events of the same category within a time window into a single execution. Instead of 5 separate "PR opened" agent runs, the agent gets one execution with "5 new PRs opened" context. Configurable merge window and max batch size.

```typescript
EventMerging({
  window: Duration.minutes(5),
  maxBatchSize: 10,
  mergeKey: (event) => `${event.source}:${event.metadata.category}`,
})
```

**PriorityQueue** — Events with higher priority preempt lower-priority queued events. Critical events (e.g., security webhook) bypass rate limits. Low-priority events (e.g., routine heartbeat) yield to any pending higher-priority work.

**ConsentGate** — Only process channel messages from users who have opted in. Maintains a consent registry (persisted in agent memory). Agents cannot proactively message users who haven't consented. Consent can be granted per-channel, per-agent, or globally.

**ScopeLimit** — Restrict which tools are available during autonomous executions. Proactive actions may use a subset of tools (e.g., read but not write, search but not send messages). This is configured per source type:

```typescript
ScopeLimit({
  heartbeat: { allowedTools: ["file-read", "web-search", "scratchpad-*"] },
  webhook: { allowedTools: ["file-read", "file-write", "web-search"] },
  channel: { allowedTools: "*" },  // user-initiated, full access
})
```

**EscalationThreshold** — When the agent's confidence is below a threshold or the action is classified as high-risk, pause execution and escalate to a human. Integrates with the existing `InteractionManager.approvalGate()` and `OrchestrationService.approveStep()`.

### Policy Composition

```typescript
gateway.withPolicies(
  AdaptiveHeartbeat(),
  CostBudget({ daily: 50_000 }),
  RateLimit({ maxPerHour: 20 }),
  EventMerging({ window: Duration.minutes(5) }),
  ScopeLimit({ heartbeat: { allowedTools: ["file-read", "web-search"] } }),
  ConsentGate(),
  EscalationThreshold({ minConfidence: 0.7 }),
)
```

Policies evaluate in priority order. Each policy can pass (return null) or decide. The chain short-circuits on the first decision. This is efficient — most events pass through 2-3 checks in microseconds.

---

## Section 3: Ethical Autonomy — Built In, Not Bolted On

Proactive agents have real power: they can contact people, execute code, spend money, and take actions with real-world consequences. The framework must make ethical operation the **default, not an option**.

### Three Pillars: Observable, Bounded, Consentful

#### Observable

Every autonomous action is logged to an immutable audit trail. The existing ObservabilityService + EventBus provides the foundation. New event types:

```typescript
// New AgentEvent variants for gateway
| { _tag: "ProactiveActionInitiated"; source: GatewayEventSource; taskDescription: string }
| { _tag: "ProactiveActionCompleted"; source: GatewayEventSource; result: TaskResult }
| { _tag: "ProactiveActionSuppressed"; source: GatewayEventSource; reason: string; policy: string }
| { _tag: "ConsentRequested"; userId: string; channel: string; action: string }
| { _tag: "ConsentGranted"; userId: string; channel: string; scope: string }
| { _tag: "BudgetExhausted"; budgetType: string; limit: number; used: number }
| { _tag: "GatewayStarted"; sources: string[]; policies: string[] }
| { _tag: "GatewayStopped"; reason: string; stats: GatewayStats }
```

The existing metrics dashboard extends to show autonomous behavior:

```
🤖 Autonomous Activity (last 24h)
├─ Heartbeats: 48 ticks, 12 executed, 36 skipped (adaptive)
├─ Webhooks:   23 received, 18 processed, 5 merged
├─ Crons:       3 scheduled, 3 completed
├─ Channels:    7 messages handled
├─ Tokens:   4,200 / 50,000 daily budget (8.4%)
├─ Suppressed: 2 actions blocked by policy
└─ Escalated:  1 action sent to human for approval
```

#### Bounded

Hard limits on what agents can do autonomously:

1. **Token budgets** — per time window, across all autonomous actions (not just per-task)
2. **Action budgets** — max N proactive executions per hour
3. **Tool scope limits** — autonomous actions use restricted tool subsets per source type
4. **Escalation thresholds** — low confidence or high-risk actions pause for human approval
5. **Kill switch** — the existing `KillSwitchService` applies to the entire gateway; `agent.stop()` halts the event loop immediately
6. **Timeout protection** — autonomous executions have shorter timeouts than user-initiated ones

These bounds are not optional configuration — they have sensible defaults that protect users who don't customize them:

```typescript
// Default bounds (applied when no explicit config)
const DEFAULT_BOUNDS = {
  dailyTokenBudget: 100_000,
  maxActionsPerHour: 30,
  heartbeatPolicy: "adaptive",          // not "always"
  autonomousTimeout: Duration.minutes(2), // shorter than interactive
  requireApprovalAboveRisk: "high",
} as const;
```

#### Consentful

Agents declare their proactive capabilities upfront through the existing A2A Agent Card system:

```typescript
// Extension to existing AgentCard type
interface AgentCardAutonomy {
  readonly heartbeat: boolean
  readonly heartbeatInterval?: string
  readonly cronSchedules: readonly string[]
  readonly webhookSources: readonly string[]
  readonly channels: readonly string[]
  readonly maxDailyTokens: number
  readonly proactiveDescription: string  // human-readable summary
  readonly requiredConsent: readonly string[]  // what permissions are needed
}
```

Users and systems see exactly what an agent will do before enabling it. No hidden behaviors. Channel adapters enforce consent — agents cannot proactively message users who haven't granted permission for that specific agent and channel.

### Ethical Defaults

The gateway ships with these non-negotiable defaults:

1. **Adaptive heartbeats** — agents don't waste resources on empty ticks
2. **Audit logging always on** — every autonomous action is recorded, even in production
3. **Budget enforcement always on** — default daily token budget prevents runaway costs
4. **Consent required for outbound messaging** — agents cannot contact users without explicit opt-in
5. **Guardrails run on all inputs** — injection detection, PII filtering, toxicity checks apply to webhook payloads and channel messages, not just user prompts
6. **Suppressed actions are visible** — the dashboard shows what was blocked and why, providing transparency into the policy engine's decisions

---

## Section 4: Integration With Existing Layers

The gateway composes with every existing package through the standard Effect-TS layer system. No existing code requires modification.

| Existing Layer | Role in Gateway | Integration Point |
|---|---|---|
| **EventBus** (`core`) | All gateway events publish here | `GatewayEvent` → `AgentEvent` mapping |
| **Guardrails** (`guardrails`) | Runs on ALL inputs, not just user messages | Webhook payloads checked for injection |
| **Cost** (`cost`) | Budget enforcement extends to autonomous actions | `CostBudget` policy delegates to `CostService` |
| **Identity** (`identity`) | Agent certs authenticate webhook sources | RBAC controls which agents can act autonomously |
| **Memory** (`memory`) | Heartbeats consult procedural memory | "What should I be doing?" from learned patterns |
| **Observability** (`observability`) | Dashboard shows autonomous activity | New event types auto-captured by `MetricsCollector` |
| **Verification** (`verification`) | Semantic entropy on autonomous outputs | Check before sending externally |
| **Kill Switch** (`runtime`) | `agent.stop()` halts gateway event loop | `KillSwitchService` checked in policy engine |
| **Orchestration** (`orchestration`) | Approval gates on high-risk autonomous actions | `EscalationThreshold` uses `InteractionManager` |
| **A2A** (`a2a`) | Agent-to-agent events as input source | A2A messages are a `GatewayEventSource` |
| **Reasoning** (`reasoning`) | Strategy selection per event type | Heartbeat ticks may use simpler strategies than webhooks |

### Memory-Driven Proactivity

A key innovation: heartbeat ticks don't start from a blank prompt. The harness loads the agent's procedural memory ("what should I be doing?") and recent episodic memory ("what happened recently?") to construct a focused context before invoking the LLM. This means:

- First heartbeat: agent reasons from its system prompt + any cron instructions
- Subsequent heartbeats: agent reasons from accumulated experience, becoming more efficient over time
- Agents that learn patterns (via `@reactive-agents/evolution`) encode those patterns into procedural memory, reducing LLM reasoning needed per tick

### Cost-Aware Model Routing

Autonomous actions don't all need the most expensive model. The existing complexity router extends to consider event source:

- Heartbeat ticks (routine checks) → route to cheaper/smaller models
- Webhook processing (structured data) → route to mid-tier models
- Channel messages (human interaction) → route to high-quality models
- Critical escalations → route to frontier models

This happens automatically through the existing `CostService` complexity classification.

---

## Section 5: Builder & CLI DX

### Builder API

```typescript
const agent = await ReactiveAgents.create()
  .withName("project-assistant")
  .withProvider("anthropic")
  .withMemory()
  .withTools()
  .withGuardrails()
  .withObservability({ verbosity: "normal", live: true })
  .withGateway({
    heartbeat: {
      interval: "30m",
      policy: "adaptive",
      maxConsecutiveSkips: 6,          // force tick after 3 hours idle
    },
    crons: [
      {
        schedule: "0 9 * * MON",
        instruction: "Review open PRs and summarize status",
        priority: "normal",
      },
      {
        schedule: "0 0 1 * *",
        instruction: "Generate monthly project health report",
        priority: "low",
      },
    ],
    webhooks: [
      {
        path: "/github",
        adapter: "github",
        secret: process.env.GITHUB_WEBHOOK_SECRET,
        events: ["pull_request", "issues", "push"],
      },
    ],
    channels: [
      {
        adapter: "slack",
        token: process.env.SLACK_BOT_TOKEN,
        channels: ["#engineering"],
      },
    ],
    policies: {
      dailyTokenBudget: 50_000,
      maxActionsPerHour: 20,
      heartbeatPolicy: "adaptive",
      requireApprovalFor: ["send-message", "file-write"],
      mergeWindow: "5m",
    },
  })
  .build();

// Start the persistent event loop
await agent.start();

// Lifecycle management
await agent.pause();    // pause gateway, keep process alive
await agent.resume();   // resume gateway processing
await agent.stop();     // graceful shutdown
```

### CLI Commands

```bash
# Daemon management
rax daemon start --config agent.yaml    # start persistent agent
rax daemon start --port 3000            # with custom HTTP port
rax daemon stop                         # graceful shutdown
rax daemon status                       # show running agents + stats
rax daemon restart                      # stop + start

# Monitoring
rax daemon logs --follow                # stream gateway logs
rax daemon logs --source webhook        # filter by source
rax daemon audit --last 24h             # autonomous action audit trail
rax daemon metrics                      # current metrics dashboard

# Configuration
rax daemon cron add "0 9 * * MON" "Review PRs"    # add cron entry
rax daemon cron list                                # list cron entries
rax daemon cron remove <id>                         # remove cron entry
rax daemon webhook test /github                     # send test webhook
```

### YAML Configuration

```yaml
# agent.yaml
name: project-assistant
provider: anthropic
model: claude-sonnet-4-20250514

gateway:
  heartbeat:
    interval: 30m
    policy: adaptive
    maxConsecutiveSkips: 6

  crons:
    - schedule: "0 9 * * MON"
      instruction: "Review open PRs and summarize status"
    - schedule: "0 0 1 * *"
      instruction: "Generate monthly project health report"

  webhooks:
    - path: /github
      adapter: github
      secret: ${GITHUB_WEBHOOK_SECRET}
      events: [pull_request, issues, push]

  channels:
    - adapter: slack
      token: ${SLACK_BOT_TOKEN}
      channels: ["#engineering"]

  policies:
    dailyTokenBudget: 50000
    maxActionsPerHour: 20
    requireApprovalFor: [send-message, file-write]
    mergeWindow: 5m

memory:
  enabled: true
guardrails:
  enabled: true
observability:
  verbosity: normal
  live: true
```

---

## Section 6: Package Structure

```
packages/gateway/
  src/
    services/
      gateway-service.ts          # AgentGateway — persistent event loop, lifecycle
      scheduler-service.ts        # Heartbeats + cron evaluation + timer management
      webhook-service.ts          # HTTP endpoint, adapter registry, signature validation
      input-router.ts             # GatewayEvent normalization, classification, routing
      policy-engine.ts            # Policy chain evaluation, decision dispatch
      audit-service.ts            # Immutable autonomous action log
    adapters/
      channel-adapter.ts          # ChannelAdapter interface (base)
      webhook-adapter.ts          # WebhookAdapter interface (base)
      github-adapter.ts           # GitHub webhook validation + transformation
      slack-adapter.ts            # Slack Events API adapter
      generic-adapter.ts          # Configurable generic webhook handler
    policies/
      adaptive-heartbeat.ts       # Skip ticks when state unchanged
      cost-budget.ts              # Token budget enforcement per time window
      rate-limit.ts               # Action rate limiting per source
      event-merging.ts            # Batch events within time window
      priority-queue.ts           # Priority-based event ordering
      consent-gate.ts             # User opt-in enforcement for channels
      scope-limit.ts              # Tool subset restrictions per source
      escalation-threshold.ts     # Human approval for high-risk actions
    types.ts                      # GatewayEvent, PolicyDecision, configs, errors
    errors.ts                     # Tagged errors: GatewayError, WebhookValidationError, etc.
    index.ts                      # Public API exports
  tests/
    services/
      gateway-service.test.ts     # Event loop lifecycle, multi-source coordination
      scheduler-service.test.ts   # Heartbeat timing, cron parsing, adaptive skipping
      webhook-service.test.ts     # HTTP handling, signature validation, routing
      input-router.test.ts        # Event normalization, classification, agent routing
      policy-engine.test.ts       # Policy chain, composition, decision dispatch
      audit-service.test.ts       # Audit log persistence, querying
    policies/
      adaptive-heartbeat.test.ts  # Skip logic, consecutive skip limits
      cost-budget.test.ts         # Budget tracking, window reset, exhaustion
      rate-limit.test.ts          # Rate windows, per-source limits
      event-merging.test.ts       # Merge windows, batch assembly
      consent-gate.test.ts        # Opt-in registry, denial logging
      scope-limit.test.ts         # Tool filtering per source
    adapters/
      github-adapter.test.ts      # HMAC validation, event classification
      slack-adapter.test.ts       # Slack signing, event transformation
    integration/
      gateway-integration.test.ts # Full pipeline: source → router → policy → execute
  package.json
  tsconfig.json
  tsup.config.ts
```

Separate optional packages for platform-specific channel adapters:

```
packages/gateway-slack/     # Slack Bot adapter (depends on @slack/web-api)
packages/gateway-discord/   # Discord adapter (depends on discord.js)
packages/gateway-telegram/  # Telegram adapter (depends on telegraf)
```

These are separate packages to avoid pulling platform SDKs into the core gateway.

---

## Section 7: New Event Types

Added to the existing `AgentEvent` union in `@reactive-agents/core`:

```typescript
| { _tag: "GatewayStarted"; agentId: AgentId; sources: string[]; policies: string[]; timestamp: Date }
| { _tag: "GatewayStopped"; agentId: AgentId; reason: string; stats: GatewayStats; timestamp: Date }
| { _tag: "GatewayEventReceived"; agentId: AgentId; source: GatewayEventSource; eventId: string; timestamp: Date }
| { _tag: "ProactiveActionInitiated"; agentId: AgentId; source: GatewayEventSource; taskDescription: string; timestamp: Date }
| { _tag: "ProactiveActionCompleted"; agentId: AgentId; source: GatewayEventSource; result: TaskResult; tokensUsed: number; timestamp: Date }
| { _tag: "ProactiveActionSuppressed"; agentId: AgentId; source: GatewayEventSource; reason: string; policy: string; timestamp: Date }
| { _tag: "PolicyDecisionMade"; agentId: AgentId; policy: string; decision: string; eventId: string; timestamp: Date }
| { _tag: "ConsentRequested"; agentId: AgentId; userId: string; channel: string; action: string; timestamp: Date }
| { _tag: "ConsentGranted"; agentId: AgentId; userId: string; channel: string; scope: string; timestamp: Date }
| { _tag: "BudgetExhausted"; agentId: AgentId; budgetType: string; limit: number; used: number; timestamp: Date }
| { _tag: "HeartbeatSkipped"; agentId: AgentId; reason: string; consecutiveSkips: number; timestamp: Date }
| { _tag: "EventsMerged"; agentId: AgentId; mergedCount: number; mergeKey: string; timestamp: Date }
```

---

## Section 8: Innovations Over OpenClaw

| Dimension | OpenClaw | Reactive Agents Gateway |
|---|---|---|
| **LLM dependency** | Every input → LLM call | Harness evaluates first; LLM only when intelligence needed |
| **Heartbeat efficiency** | Fixed interval, always fires | Adaptive — skip when idle, force after max skips |
| **Cost control** | None | Token budgets per time window, complexity routing to cheaper models |
| **Event batching** | None — 5 PRs = 5 agent runs | Event merging — 5 PRs = 1 execution with batched context |
| **Security** | Skills run shell commands (high risk) | Sandboxed tool execution, scope limits per source, guardrails on all inputs |
| **Observability** | Basic logging | Full metrics dashboard, tracing, audit trail, live streaming |
| **Memory** | Markdown files | 4-tier SQLite (working, semantic, episodic, procedural) + FTS5 + KNN |
| **Multi-agent** | Basic agent-to-agent | A2A protocol with discovery, capability matching, Agent Cards |
| **Consent** | None | Opt-in registry, capability declaration, consent events |
| **Extensibility** | Markdown skills | Effect-TS layers, MCP protocol, typed tool registry |
| **Type safety** | JavaScript | Full Effect-TS with Schema validation, tagged errors, branded IDs |
| **Policy engine** | None | Composable policy chain with 8 built-in policies |

---

## Section 9: Dependencies

### Internal (existing packages)

- `@reactive-agents/core` — EventBus, AgentEvent types, Task/TaskResult
- `@reactive-agents/runtime` — ExecutionEngine, ReactiveAgentBuilder, ManagedRuntime
- `@reactive-agents/cost` — CostService for budget enforcement
- `@reactive-agents/observability` — MetricsCollector, tracing
- `@reactive-agents/tools` — ToolService for scope limiting
- `@reactive-agents/memory` — MemoryService for state-change detection
- `@reactive-agents/guardrails` — GuardrailService for input validation
- `@reactive-agents/identity` — IdentityService for webhook authentication
- `@reactive-agents/interaction` — InteractionManager for approval gates
- `@reactive-agents/a2a` — A2A server for HTTP infrastructure sharing

### External (new)

- None required for core gateway. Bun provides HTTP server, timers, and crypto (HMAC-SHA256).
- Channel adapter packages bring their own SDK deps (`@slack/web-api`, `discord.js`, `telegraf`).

---

## Section 10: Success Criteria

1. **Zero LLM calls for event routing** — inputs are classified and routed entirely by deterministic code
2. **Adaptive heartbeats skip 50%+ of ticks** when agent is idle
3. **Event merging reduces executions by 30%+** for bursty webhook sources
4. **All autonomous actions appear in audit trail** — no silent actions
5. **Budget enforcement prevents runaway costs** — hard cap on autonomous spending
6. **Existing tests don't break** — gateway is purely additive, composed via layers
7. **Builder DX feels natural** — `.withGateway()` is as simple as `.withTools()`
8. **Daemon mode works reliably** — graceful startup, shutdown, restart, signal handling
