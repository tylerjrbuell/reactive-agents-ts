# Channels Package Design Spec

**Date:** 2026-03-11
**Package:** `@reactive-agents/channels`
**Status:** Approved
**Goal:** Platform-agnostic messaging transport layer that plugs into the existing gateway, enabling bi-directional communication between agents and external messaging platforms. Combined with gateway crons, webhooks, triggers, and policies, this gives users composable automation primitives.

### Migration Note: `GatewayOptions.channels` Rename

The existing `GatewayConfig.channels` field (access control: `accessPolicy`, `allowedSenders`, `blockedSenders`, `unknownSenderAction`, `replyToUnknown`) conflicts with this new channels config. **Resolution:** Rename the existing field to `GatewayConfig.accessControl` and move it under the gateway root config. The new `channels` field takes on the messaging transport meaning. This is a breaking change to the gateway config schema — update builder and all tests accordingly.

---

## Architecture Overview

```
Gateway (central orchestrator)
  ├── Policies (rate limit, budget, access control)
  ├── Crons (scheduled tasks) ──────────┐
  ├── Heartbeats (periodic checks) ─────┤── can all route output to channels
  ├── Webhooks (external events) ───────┘
  └── Channels (messaging transport)    ← @reactive-agents/channels
       ├── MessageChannel adapters (Discord, Telegram, Signal, ...)
       ├── TriggerSource (agent lifecycle from external events)
       └── SessionBridge (external identity → agent session)
```

The gateway is the single long-running process that owns session state, routing, and concurrency. Channels is a transport surface it manages — one of several input/output pathways alongside crons, heartbeats, and webhooks.

---

## Core Interfaces

### MessageChannel — Bi-Directional Transport

```typescript
interface MessageChannel {
  readonly id: string;                    // "discord", "telegram", "signal"
  connect(): Effect<void, ChannelConnectionError>;
  disconnect(): Effect<void, ChannelConnectionError>;
  sendMessage(target: ChannelTarget, content: MessageContent): Effect<SendResult, ChannelSendError>;
  onMessage(handler: (msg: InboundMessage) => Effect<void>): Effect<ChannelSubscription>;
}

// Cleanup handle returned by onMessage — mirrors EventBus.on() pattern
interface ChannelSubscription {
  unsubscribe(): Effect<void>;
}
```

### TriggerSource — Agent Lifecycle Control

```typescript
interface TriggerSource {
  register(trigger: TriggerDefinition): Effect<void>;
  unregister(triggerId: string): Effect<void>;
  evaluate(event: InboundMessage): Effect<TriggerDefinition | null>;
}
```

### SessionBridge — External Identity to Agent Session

```typescript
interface SessionBridge {
  resolve(externalId: ExternalIdentity): Effect<AgentSession, SessionResolutionError>;
  release(sessionId: string): Effect<void>;
  listActive(): Effect<ActiveSession[]>;
}
```

### Error Types

```typescript
// Data.TaggedError pattern (consistent with codebase)
class ChannelConnectionError extends Data.TaggedError("ChannelConnectionError")<{
  adapter: string;
  reason: string;
  cause?: unknown;
}> {}

class ChannelSendError extends Data.TaggedError("ChannelSendError")<{
  adapter: string;
  target: ChannelTarget;
  reason: "rate_limited" | "message_too_large" | "channel_not_found" | "unauthorized" | "unknown";
  cause?: unknown;
}> {}

class SessionResolutionError extends Data.TaggedError("SessionResolutionError")<{
  externalId: ExternalIdentity;
  reason: string;
  cause?: unknown;
}> {}
```

---

## Shared Types

```typescript
// Platform-agnostic inbound message
interface InboundMessage {
  id: string;
  platform: string;            // "discord", "telegram", "signal" — identifies source adapter
  channelId: string;           // platform channel/thread/DM identifier
  senderId: string;            // platform user identifier
  senderName?: string;
  content: string;
  attachments?: Attachment[];
  replyTo?: string;            // thread/parent message ID
  metadata: Record<string, unknown>;  // platform-specific extras
  timestamp: Date;
}

// Where to send a response
interface ChannelTarget {
  channelId: string;
  threadId?: string;           // reply in thread (default behavior)
  replyToMessageId?: string;   // quote-reply to specific message
}

// What to send back
interface MessageContent {
  text: string;
  format?: "plain" | "markdown";
  embeds?: EmbedContent[];     // rich cards (debrief, metrics, etc.)
  attachments?: Attachment[];
}

// Rich embed content (maps to Discord embeds, Telegram cards, etc.)
interface EmbedContent {
  title?: string;
  description?: string;
  color?: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: string;
}

// File/media attachment (tagged union for clarity)
type Attachment =
  | { type: "url"; filename: string; contentType: string; url: string }
  | { type: "binary"; filename: string; contentType: string; data: Buffer };

// External user identity
interface ExternalIdentity {
  platform: string;            // "discord", "telegram", etc.
  userId: string;
  displayName?: string;
  metadata?: Record<string, unknown>;
}

// Send result
interface SendResult {
  messageId: string;
  timestamp: Date;
}

// Active session info
interface ActiveSession {
  sessionId: string;
  platform: string;
  externalUserId: string;
  externalChannelId: string;
  state: "active" | "idle" | "ended";
  messageCount: number;
  lastActiveAt: Date;
}

// Adapter info for status queries
interface AdapterInfo {
  id: string;
  connected: boolean;
  sessionsActive: number;
}

// Channel subsystem status
interface ChannelStatus {
  adapters: AdapterInfo[];
  activeSessions: number;
  totalMessagesProcessed: number;
}
```

---

## Trigger System

### TriggerDefinition

```typescript
interface TriggerDefinition {
  id: string;
  name: string;

  // Match conditions — what fires this trigger
  match: TriggerMatchCondition;

  // Agent config — what to create
  agent: TriggerAgentConfig;

  // Response routing — where output goes (default: trigger_thread)
  response?: ResponseRouting;

  // Lifecycle — how long the agent lives (default: conversation)
  lifecycle?: AgentLifecycle;

  // Permissions — who can fire this (open by default)
  permissions?: TriggerPermissions;
}

// Match is a union — supports many trigger types
type TriggerMatchCondition =
  | { type: "mention" }
  | { type: "slash_command"; command: string }
  | { type: "keyword"; patterns: string[] }
  | { type: "reaction"; emoji: string }
  | { type: "webhook"; path: string }
  | { type: "custom"; evaluate: (msg: InboundMessage) => boolean | Effect<boolean> };

// What agent to spin up
interface TriggerAgentConfig {
  persona?: AgentPersona;
  tools?: string[];
  reasoning?: "reactive" | "plan-execute" | "tree-of-thought" | "reflexion" | "adaptive";
  model?: string;
  systemPrompt?: string;
  maxIterations?: number;
  // Dynamic — derive config from the trigger message
  derive?: (msg: InboundMessage) => Partial<TriggerAgentConfig>;
}

// Where responses go
interface ResponseRouting {
  mode: "trigger_thread" | "dm" | "channel" | "callback";
  channelId?: string;         // for "channel" mode
  callbackUrl?: string;       // for "callback" mode
}

// How long the agent lives
type AgentLifecycle =
  | { type: "single_response" }
  | { type: "conversation"; idleTimeoutMs?: number }
  | { type: "persistent" }
  | { type: "ttl"; durationMs: number };

// Who can fire it (open by default, RBAC hooks per-adapter)
interface TriggerPermissions {
  allowedUsers?: string[];
  allowedRoles?: string[];     // platform-specific role IDs
  deniedUsers?: string[];
}
```

### Default Trigger

Every channels setup has an implicit catch-all trigger: if no registered trigger matches an inbound message, route to the `defaultAgent` config. This makes "just tag the bot and chat" work without explicit trigger registration.

`defaultAgent` uses the same type as `TriggerAgentConfig` — if omitted, the parent agent's own config is used as the default (the agent that `.withGateway()` was called on).

### Session Construction Pipeline

When `SessionBridge.resolve()` creates a new session for a trigger-spawned agent:

1. `TriggerAgentConfig` is resolved (static fields merged with `derive()` output if present)
2. `ReactiveAgentBuilder.create()` constructs the agent from the resolved config
3. The builder's `.build()` produces a `ReactiveAgent` with a `ManagedRuntime`
4. `agent.session()` creates the `AgentSession` (wires `chatFn` to the agent's full runtime)
5. Session is stored in SQLite with the resolved static config (not the `derive` function)

**Note on `derive` and restart recovery:** The `derive` function is not serializable. On restart, sessions created via `derive` are rebuilt using the *resolved* static config that was stored at creation time. The dynamic derivation is a one-time evaluation.

### Dynamic Config via `derive`

The `derive` function is the escape hatch for programmatic trigger logic:

```typescript
{
  id: "smart-spawn",
  match: { type: "slash_command", command: "agent" },
  agent: {
    derive: (msg) => {
      if (msg.content.includes("research")) return { persona: { role: "researcher" }, tools: ["web-search"] };
      if (msg.content.includes("code")) return { persona: { role: "developer" }, tools: ["code-execute"] };
      return {};
    },
  },
  lifecycle: { type: "conversation", idleTimeoutMs: 300_000 },
}
```

---

## ChannelService — Central Orchestration

```typescript
interface ChannelService {
  registerAdapter(adapter: MessageChannel): Effect<void>;
  removeAdapter(channelId: string): Effect<void>;
  registerTrigger(trigger: TriggerDefinition): Effect<void>;
  removeTrigger(triggerId: string): Effect<void>;
  status(): Effect<ChannelStatus>;
  listAdapters(): Effect<AdapterInfo[]>;
  listActiveSessions(): Effect<ActiveSession[]>;
}
```

---

## GatewayEvent Bridge

`ChannelService` wraps each `InboundMessage` into a `GatewayEvent` before passing to the policy engine. This reuses the existing `source: "channel"` type:

```typescript
function toGatewayEvent(msg: InboundMessage): GatewayEvent {
  return {
    id: msg.id,
    source: "channel",
    timestamp: msg.timestamp,
    payload: { content: msg.content, senderId: msg.senderId, platform: msg.platform },
    priority: "normal",
    metadata: { channelId: msg.channelId, replyTo: msg.replyTo, ...msg.metadata },
  };
}
```

This means gateway policies (rate limit, cost budget, access control) apply to channel messages identically to webhooks and crons — no special-casing needed.

---

## Concurrency Model

**Per-session message queue:** Each active session has a serialized lane (FIFO queue). When multiple messages arrive for the same session before the first completes, they are queued and processed sequentially. This prevents history corruption from concurrent `session.chat()` calls.

**Cross-session parallelism:** Messages for different sessions are processed in parallel via Effect fibers. A Discord server with 10 active users runs 10 concurrent agent sessions.

**Implementation:** `SessionBridge` maintains a `Map<sessionId, Queue<InboundMessage>>` backed by Effect `Queue`. Each session's queue is drained by a single fiber.

---

## Message Chunking

Platform message limits vary (Discord: 2000 chars, Telegram: 4096). When an agent response exceeds the platform limit:

1. **Split at natural boundaries** — paragraph breaks, code block boundaries, bullet points
2. **Send as multiple messages** with a short delay between each (avoids rate limits)
3. **Rich content fallback** — if response exceeds ~4000 chars, post as a file attachment instead

Each adapter implements `maxMessageLength` and `chunkMessage(content: MessageContent): MessageContent[]` to handle platform-specific splitting.

---

## Message Flow

### Inbound (user → agent)

```
Platform message (@bot "find papers on RAG")
  │
  ▼
MessageChannel.onMessage()          ← Adapter normalizes to InboundMessage
  │
  ▼
ChannelService.toGatewayEvent()     ← Wraps InboundMessage → GatewayEvent (source: "channel")
  │
  ▼
GatewayService.processEvent()       ← Existing policy engine (rate limit, access control)
  │ PolicyDecision: "allow"
  ▼
TriggerSource.evaluate()            ← Match against registered triggers
  │ TriggerMatch found or default
  ▼
SessionBridge.resolve()             ← Lookup/create session for external user
  │ Returns AgentSession (with history if returning user)
  ▼
session.chat(message)               ← Full framework: reasoning, tools, memory, debrief
  │
  ▼
MessageChannel.sendMessage()        ← Adapter sends reply to trigger thread
```

### Trigger-Spawned Agent

```
Slash command (/research "RAG architectures")
  │
  ▼
MessageChannel.onMessage()          ← Normalized to InboundMessage
  │
  ▼
TriggerSource.evaluate()            ← Matches trigger definition
  │ Returns TriggerDefinition with agent config
  ▼
ReactiveAgentBuilder.create()       ← Build agent from trigger config
  .withPersona(trigger.agent.persona)
  .withTools(trigger.agent.tools)
  .withReasoning()
  .build()
  │
  ▼
SessionBridge creates new session   ← Tied to user + thread
  │
  ▼
agent.run(message) or agent.chat()  ← Full framework features
  │
  ▼
MessageChannel.sendMessage()        ← Routed per trigger.response config
  │
  ▼
Lifecycle manager                   ← Monitors idle timeout / TTL / cleanup
```

### Outbound (cron/heartbeat → channel)

```
Cron fires ("0 9 * * MON")
  │
  ▼
Agent runs instruction              ← "Review open PRs"
  │
  ▼
Agent produces result               ← AgentResult with debrief
  │
  ▼
Cron notify config                  ← { adapter: "discord", channelId: "123456" }
  │
  ▼
MessageChannel.sendMessage()        ← Posts result to specified channel
```

---

## Gateway Integration

Channels config nests under `.withGateway()`:

```typescript
const agent = await ReactiveAgents.create()
  .withName("my-bot")
  .withProvider("anthropic")
  .withReasoning()
  .withTools(["web-search", "file-write"])
  .withGateway({
    // Existing gateway config — unchanged
    heartbeat: { intervalMs: 1800000, policy: "adaptive" },
    crons: [
      {
        schedule: "0 9 * * MON",
        instruction: "Review open PRs",
        notify: { adapter: "discord", channelId: "123456" },
      },
    ],
    policies: { dailyTokenBudget: 50000 },

    // NEW — channels config
    channels: {
      adapters: [
        new DiscordAdapter({ token: process.env.DISCORD_BOT_TOKEN }),
      ],
      triggers: [
        {
          id: "research",
          name: "Research Agent",
          match: { type: "slash_command", command: "research" },
          agent: {
            persona: { role: "researcher", tone: "thorough" },
            tools: ["web-search"],
            reasoning: "plan-execute",
          },
          lifecycle: { type: "conversation", idleTimeoutMs: 300_000 },
        },
      ],
      defaultAgent: {
        persona: { role: "assistant" },
        reasoning: "reactive",
      },
      sessions: {
        compactionThreshold: 50,
        idleTimeoutMs: 600_000,
      },
    },
  })
  .build();
```

### Cron Notify Extension

Existing `GatewayCron` type gains an optional `notify` field:

```typescript
interface GatewayCron {
  schedule: string;
  instruction: string;
  notify?: {
    adapter: string;          // adapter ID ("discord", "telegram")
    channelId: string;        // where to post
    threadId?: string;        // optional thread
    format?: "text" | "embed"; // embed renders debrief as rich card
  };
}
```

---

## Session Persistence

### SQLite Table (memory layer)

```sql
CREATE TABLE channel_sessions (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  external_channel_id TEXT NOT NULL,
  agent_config_json TEXT,
  history_json TEXT,
  state TEXT DEFAULT 'active',
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  ended_at TEXT,
  UNIQUE(platform, external_user_id, external_channel_id)
);
```

### Lifecycle Management

| Lifecycle | Behavior |
|-----------|----------|
| `single_response` | Session ends after first reply, history persisted |
| `conversation` | Active until idle timeout, resets on each message. On timeout: flush to episodic memory, release, notify user |
| `persistent` | Never auto-ends, survives restarts. Agent config stored in session, rebuilt on startup |
| `ttl` | Hard timer, ends when duration expires regardless of activity |

### Session Compaction

Long-running sessions use the existing memory compaction system. When history exceeds `compactionThreshold` (default 50 messages), older messages get compacted into a summary stored in episodic memory. Agent retains context without unbounded growth.

### Restart Recovery

On startup, `SessionBridge` loads all `state: "active"` and `state: "idle"` sessions from SQLite, rebuilds agent instances from stored `agent_config_json`, and re-registers message handlers. Persistent and conversation sessions resume transparently.

---

## Discord Adapter (First Implementation)

### Implementation

```typescript
class DiscordAdapter implements MessageChannel {
  readonly id = "discord";
  readonly maxMessageLength = 2000;

  connect()        → Client.login(token), register 'messageCreate' + 'interactionCreate'
  disconnect()     → Client.destroy()
  sendMessage()    → channel.send() with MessageContent → Discord message/embed mapping
  onMessage()      → register handler for normalized InboundMessage
  chunkMessage()   → split at 2000 chars on paragraph/code-block boundaries

  // Discord-specific: register slash commands for triggers that use slash_command match
  registerSlashCommands(triggers: TriggerDefinition[]): Effect<void>
}
```

**Note:** `TriggerSource` is a shared service (`trigger-registry.ts`), not per-adapter. All adapters share the same trigger evaluation logic. Adapters only implement `MessageChannel`. Platform-specific trigger setup (like Discord slash command registration) is handled via adapter-specific methods called during `ChannelService` initialization.

### Discord-Specific Mappings

| Generic | Discord |
|---------|---------|
| `InboundMessage.channelId` | Channel or thread ID |
| `InboundMessage.replyTo` | Thread parent (auto-creates thread if none) |
| `MessageContent.embeds` | `EmbedBuilder` (debrief cards, metrics dashboards) |
| `TriggerPermissions.allowedRoles` | Discord role IDs |
| Slash commands | Auto-registered when triggers registered |
| `ChannelTarget.threadId` | Creates/replies in Discord thread |

### Default Reply Behavior

Agent responds in the thread where it was triggered. If triggered in a channel (not a thread), auto-creates a thread from the triggering message. This keeps conversations organized and avoids channel noise.

---

## Security Model

- **Open by default** — any user in the platform can interact with agents
- **RBAC hooks per-adapter** — `TriggerPermissions` supports `allowedUsers`, `allowedRoles`, `deniedUsers`
- **Gateway policies apply** — rate limiting, cost budgets, access control from existing policy engine
- **Per-user spend limits** — cost package budget enforcement applies per-session
- **Signature validation** — Discord adapter validates Ed25519 interaction signatures (Discord's auth model)

---

## Package Structure

```
packages/channels/
  src/
    types.ts                    — All shared types and interfaces
    services/
      channel-service.ts        — ChannelService (adapter registry, trigger routing, orchestration)
      session-bridge.ts         — SessionBridge (resolve, release, persistence, lifecycle)
      trigger-registry.ts       — TriggerSource default impl (evaluate, match logic)
    adapters/
      discord.ts                — Discord adapter (discord.js)
    index.ts                    — Public exports
  tests/
    channel-service.test.ts
    session-bridge.test.ts
    trigger-registry.test.ts
    discord-adapter.test.ts
  package.json
```

### Dependencies

| Dependency | Why |
|-----------|-----|
| `@reactive-agents/core` | EventBus, shared types |
| `@reactive-agents/gateway` | Policy engine, GatewayEvent |
| `@reactive-agents/runtime` | ReactiveAgentBuilder for trigger-spawned agents |
| `@reactive-agents/memory` | Session persistence (SQLite) |
| `discord.js` | Peer dependency (only needed if using Discord adapter) |

---

## EventBus Events

New events published by the channels layer:

| Event | When |
|-------|------|
| `ChannelMessageReceived` | Inbound message arrives from any adapter |
| `ChannelMessageSent` | Outbound message sent to any adapter |
| `TriggerFired` | A trigger matched and agent creation started |
| `SessionCreated` | New channel session established |
| `SessionEnded` | Session released (idle, TTL, manual) |

---

## What This Unlocks

With channels + existing gateway primitives, users can build:

- **Chat bot** — Tag bot in Discord, have a conversation with full reasoning/tool access
- **Scheduled reports** — Cron runs analysis, posts results to Discord channel
- **Alert pipeline** — Webhook receives alert → agent analyzes → posts to ops channel
- **Research assistant** — `/research` slash command spawns specialized agent in a thread
- **Multi-platform** — Same agent accessible from Discord, Telegram, Signal simultaneously
- **Automation chains** — Cron triggers agent → agent uses tools → result posted to channel → user reacts → triggers another agent
