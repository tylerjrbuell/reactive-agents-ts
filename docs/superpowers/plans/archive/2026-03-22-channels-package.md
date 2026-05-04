# Channels Package — Implementation Plan (Phase 1: Core + Webhook)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@reactive-agents/channels` — the external interaction layer that turns inbound events (webhooks, messaging platforms, triggers) into agent sessions and routes responses back, integrated with the existing gateway policy engine.

**Architecture:** Three core services — `ChannelService` (adapter registry + orchestration), `TriggerRegistry` (match inbound events to agent configs), and `SessionBridge` (map external identities to `agent.session()` instances with per-session message queues). A generic webhook adapter validates the pattern. All channel events flow through the existing gateway policy engine before reaching agents. Sessions persist in SQLite for restart recovery.

**Tech Stack:** TypeScript, Effect-TS, bun:test, bun:sqlite

**Spec:** `docs/superpowers/specs/2026-03-11-channels-design.md`

---

## Scope

This plan covers Phase 1 — the core channels infrastructure and a webhook adapter. Phase 2 (Discord adapter) is a separate plan that builds on this.

**In scope:**
- New `packages/channels/` package scaffold
- All shared types (MessageChannel, InboundMessage, TriggerDefinition, etc.)
- ChannelService, TriggerRegistry, SessionBridge
- Generic webhook adapter (HTTP POST → agent session)
- Gateway integration (rename `channels` → `accessControl`, add channels config)
- 4 new EventBus events
- Session persistence in SQLite (`channel_sessions` table)
- Per-session message queuing (FIFO, sequential processing)

**Not in scope (Phase 2):**
- Discord adapter (discord.js, slash commands, embeds)
- Message chunking per platform
- Rich embed content mapping
- `GatewayCron.notify` (cron → channel output routing) — will add in Phase 2 with Discord

**Design decisions:**
- The spec's `TriggerSource` Effect interface is replaced by a concrete `TriggerRegistry` class (synchronous, in-memory). Effect wrapping is unnecessary for fast trigger matching.
- The spec's `TriggerMatchCondition.custom` accepts `boolean | Effect<boolean>` — simplified to `boolean` only. Effect variant adds complexity without clear use case.
- **Circular dependency prevention:** `@reactive-agents/channels` does NOT depend on `@reactive-agents/runtime`. Instead, `SessionBridge` accepts an `agentFactory` callback injected by the runtime at startup. This breaks the cycle: runtime imports channels, channels never imports runtime.

---

## File Structure

### New Package: `packages/channels/`

| File | Responsibility |
|------|---------------|
| `packages/channels/package.json` | Package manifest with dependencies |
| `packages/channels/tsconfig.json` | TypeScript config extending workspace base |
| `packages/channels/tsup.config.ts` | Build config |
| `packages/channels/src/index.ts` | Public exports |
| `packages/channels/src/types.ts` | All shared interfaces: MessageChannel, InboundMessage, ChannelTarget, MessageContent, TriggerDefinition, TriggerMatchCondition, ExternalIdentity, etc. |
| `packages/channels/src/errors.ts` | ChannelConnectionError, ChannelSendError, SessionResolutionError |
| `packages/channels/src/services/channel-service.ts` | ChannelService: adapter registry, trigger routing, event → agent orchestration |
| `packages/channels/src/services/trigger-registry.ts` | TriggerSource: register/unregister triggers, evaluate matches |
| `packages/channels/src/services/session-bridge.ts` | SessionBridge: external identity → AgentSession, per-session queues, lifecycle, SQLite persistence |
| `packages/channels/src/adapters/webhook.ts` | Generic webhook adapter: HTTP POST → InboundMessage, HMAC signature validation |
| `packages/channels/tests/trigger-registry.test.ts` | Trigger matching tests |
| `packages/channels/tests/session-bridge.test.ts` | Session lifecycle + persistence tests |
| `packages/channels/tests/channel-service.test.ts` | End-to-end orchestration tests |
| `packages/channels/tests/webhook-adapter.test.ts` | Webhook validation + transformation tests |

### Modified Files

| File | What Changes |
|------|-------------|
| `packages/core/src/services/event-bus.ts` | Add 4 new AgentEvent variants |
| `packages/gateway/src/types.ts` | Rename `channels` → `accessControl` in GatewayConfigSchema |
| `packages/gateway/src/services/gateway-service.ts` | Update `channels` references to `accessControl` |
| `packages/gateway/src/policies/access-control.ts` | Update config field name |
| `packages/gateway/tests/` | Update tests for renamed field |
| `packages/runtime/src/builder.ts` | Add `.withChannels()` method, wire channels into gateway start, rename `GatewayOptions.channels` → `accessControl` |
| `packages/runtime/src/runtime.ts` | Rename `channels` references in gateway wiring, add ChannelService to layer composition |
| `package.json` (root) | Add channels workspace |

---

## Task 1: Package Scaffold

**Files:**
- Create: `packages/channels/package.json`
- Create: `packages/channels/tsconfig.json`
- Create: `packages/channels/tsup.config.ts`
- Create: `packages/channels/src/index.ts`

- [ ] **Step 1: Create package.json**

Follow the pattern of existing packages (e.g., `packages/gateway/package.json`). Dependencies:
- `@reactive-agents/core` (EventBus, types)
- `@reactive-agents/gateway` (GatewayEvent, policy engine)
- `effect` (peer)

**IMPORTANT:** Do NOT add `@reactive-agents/runtime` as a dependency — this would create a circular dependency. The channels package uses an `AgentSessionFactory` callback (injected by runtime at startup) instead of importing the builder directly.

- [ ] **Step 2: Create tsconfig.json extending workspace base**

- [ ] **Step 3: Create tsup.config.ts following workspace pattern**

Read `packages/gateway/tsup.config.ts` and copy the pattern.

- [ ] **Step 4: Create empty src/index.ts**

- [ ] **Step 5: Add to root package.json workspaces**

- [ ] **Step 6: Run `bun install` to link workspace**

- [ ] **Step 7: Commit**

```
git add packages/channels/ package.json
git commit -m "feat(channels): scaffold @reactive-agents/channels package"
```

---

## Task 2: Types & Errors

**Files:**
- Create: `packages/channels/src/types.ts`
- Create: `packages/channels/src/errors.ts`

- [ ] **Step 1: Create types.ts with all shared interfaces**

Read the spec at `docs/superpowers/specs/2026-03-11-channels-design.md` §"Core Interfaces" and §"Shared Types". Implement all types:

```typescript
import type { Effect } from "effect";

// ── MessageChannel — Bi-Directional Transport ─────────────────────────────

export interface MessageChannel {
  readonly id: string;
  connect(): Effect.Effect<void, ChannelConnectionError>;
  disconnect(): Effect.Effect<void, ChannelConnectionError>;
  sendMessage(target: ChannelTarget, content: MessageContent): Effect.Effect<SendResult, ChannelSendError>;
  onMessage(handler: (msg: InboundMessage) => Effect.Effect<void>): Effect.Effect<ChannelSubscription>;
}

export interface ChannelSubscription {
  unsubscribe(): Effect.Effect<void>;
}

// ── Inbound Message ───────────────────────────────────────────────────────

export interface InboundMessage {
  readonly id: string;
  readonly platform: string;
  readonly channelId: string;
  readonly senderId: string;
  readonly senderName?: string;
  readonly content: string;
  readonly attachments?: Attachment[];
  readonly replyTo?: string;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: Date;
}

// ── Outbound ──────────────────────────────────────────────────────────────

export interface ChannelTarget {
  readonly channelId: string;
  readonly threadId?: string;
  readonly replyToMessageId?: string;
}

export interface MessageContent {
  readonly text: string;
  readonly format?: "plain" | "markdown";
  readonly embeds?: EmbedContent[];
  readonly attachments?: Attachment[];
}

export interface EmbedContent {
  readonly title?: string;
  readonly description?: string;
  readonly color?: string;
  readonly fields?: Array<{ name: string; value: string; inline?: boolean }>;
  readonly footer?: string;
}

export type Attachment =
  | { readonly type: "url"; readonly filename: string; readonly contentType: string; readonly url: string }
  | { readonly type: "binary"; readonly filename: string; readonly contentType: string; readonly data: Buffer };

export interface SendResult {
  readonly messageId: string;
  readonly timestamp: Date;
}

// ── External Identity ─────────────────────────────────────────────────────

export interface ExternalIdentity {
  readonly platform: string;
  readonly userId: string;
  readonly displayName?: string;
  readonly metadata?: Record<string, unknown>;
}

// ── Triggers ──────────────────────────────────────────────────────────────

export interface TriggerDefinition {
  readonly id: string;
  readonly name: string;
  readonly match: TriggerMatchCondition;
  readonly agent: TriggerAgentConfig;
  readonly response?: ResponseRouting;
  readonly lifecycle?: AgentLifecycle;
  readonly permissions?: TriggerPermissions;
}

export type TriggerMatchCondition =
  | { readonly type: "mention" }
  | { readonly type: "slash_command"; readonly command: string }
  | { readonly type: "keyword"; readonly patterns: readonly string[] }
  | { readonly type: "reaction"; readonly emoji: string }
  | { readonly type: "webhook"; readonly path: string }
  | { readonly type: "custom"; readonly evaluate: (msg: InboundMessage) => boolean };

export interface TriggerAgentConfig {
  readonly persona?: { name?: string; role?: string; background?: string; instructions?: string; tone?: string };
  readonly tools?: readonly string[];
  readonly reasoning?: "reactive" | "plan-execute" | "tree-of-thought" | "reflexion" | "adaptive";
  readonly model?: string;
  readonly systemPrompt?: string;
  readonly maxIterations?: number;
  readonly derive?: (msg: InboundMessage) => Partial<TriggerAgentConfig>;
}

export interface ResponseRouting {
  readonly mode: "trigger_thread" | "dm" | "channel" | "callback";
  readonly channelId?: string;
  readonly callbackUrl?: string;
}

export type AgentLifecycle =
  | { readonly type: "single_response" }
  | { readonly type: "conversation"; readonly idleTimeoutMs?: number }
  | { readonly type: "persistent" }
  | { readonly type: "ttl"; readonly durationMs: number };

export interface TriggerPermissions {
  readonly allowedUsers?: readonly string[];
  readonly allowedRoles?: readonly string[];
  readonly deniedUsers?: readonly string[];
}

// ── Status ────────────────────────────────────────────────────────────────

export interface ActiveSession {
  readonly sessionId: string;
  readonly platform: string;
  readonly externalUserId: string;
  readonly externalChannelId: string;
  readonly state: "active" | "idle" | "ended";
  readonly messageCount: number;
  readonly lastActiveAt: Date;
}

export interface AdapterInfo {
  readonly id: string;
  readonly connected: boolean;
  readonly sessionsActive: number;
}

export interface ChannelStatus {
  readonly adapters: readonly AdapterInfo[];
  readonly activeSessions: number;
  readonly totalMessagesProcessed: number;
}

// ── Session Bridge ────────────────────────────────────────────────────────

/**
 * Factory function injected by runtime to create chat sessions from trigger configs.
 * This breaks the circular dependency: channels never imports runtime.
 */
export type AgentSessionFactory = (
  agentConfig: TriggerAgentConfig | undefined,
  sessionId: string,
) => Promise<{ chat: (message: string) => Promise<{ message: string; tokens?: number }> }>;

/**
 * SessionBridge.resolve() signature — needs external identity, channel, config, and lifecycle.
 */
export interface SessionBridgeResolveParams {
  readonly identity: ExternalIdentity;
  readonly channelId: string;
  readonly agentConfig?: TriggerAgentConfig;
  readonly lifecycle?: AgentLifecycle;
}

// ── Channels Config (for builder) ─────────────────────────────────────────

export interface ChannelsConfig {
  readonly adapters: readonly MessageChannel[];
  readonly triggers?: readonly TriggerDefinition[];
  readonly defaultAgent?: TriggerAgentConfig;
  readonly sessions?: {
    readonly compactionThreshold?: number;
    readonly idleTimeoutMs?: number;
  };
}
```

- [ ] **Step 2: Create errors.ts**

```typescript
import { Data } from "effect";
import type { ChannelTarget, ExternalIdentity } from "./types.js";

export class ChannelConnectionError extends Data.TaggedError("ChannelConnectionError")<{
  readonly adapter: string;
  readonly reason: string;
  readonly cause?: unknown;
}> {}

export class ChannelSendError extends Data.TaggedError("ChannelSendError")<{
  readonly adapter: string;
  readonly target: ChannelTarget;
  readonly reason: "rate_limited" | "message_too_large" | "channel_not_found" | "unauthorized" | "unknown";
  readonly cause?: unknown;
}> {}

export class SessionResolutionError extends Data.TaggedError("SessionResolutionError")<{
  readonly externalId: ExternalIdentity;
  readonly reason: string;
  readonly cause?: unknown;
}> {}
```

- [ ] **Step 3: Update index.ts to export types and errors**

- [ ] **Step 4: Verify build**

Run: `cd packages/channels && bun run build` (if tsup is set up) or just `tsc --noEmit`

- [ ] **Step 5: Commit**

```
git add packages/channels/src/types.ts packages/channels/src/errors.ts packages/channels/src/index.ts
git commit -m "feat(channels): add shared types, interfaces, and error classes"
```

---

## Task 3: Add EventBus Events

**Files:**
- Modify: `packages/core/src/services/event-bus.ts`

- [ ] **Step 1: Read the AgentEvent union in event-bus.ts**

Find where `ChannelMessageReceived` is defined (it already exists). Add 4 new events nearby.

- [ ] **Step 2: Add the 4 new event types to the AgentEvent union**

```typescript
| { readonly _tag: "ChannelMessageSent"; readonly taskId: string; readonly platform: string; readonly messageId: string; readonly channelId: string; readonly timestamp: number }
| { readonly _tag: "TriggerFired"; readonly taskId: string; readonly triggerId: string; readonly triggerName: string; readonly platform: string; readonly sessionId: string; readonly timestamp: number }
| { readonly _tag: "SessionCreated"; readonly taskId: string; readonly sessionId: string; readonly platform: string; readonly externalUserId: string; readonly externalChannelId: string; readonly timestamp: number }
| { readonly _tag: "SessionEnded"; readonly taskId: string; readonly sessionId: string; readonly reason: string; readonly state: string; readonly timestamp: number }
```

- [ ] **Step 3: Add the new tags to `AgentEventTag` type if it exists**

- [ ] **Step 4: Run core tests**

Run: `cd packages/core && bun test`

- [ ] **Step 5: Commit**

```
git add packages/core/src/services/event-bus.ts
git commit -m "feat(core): add ChannelMessageSent, TriggerFired, SessionCreated, SessionEnded events"
```

---

## Task 4: Rename GatewayConfig.channels → accessControl

**Files:**
- Modify: `packages/gateway/src/types.ts`
- Modify: `packages/gateway/src/services/gateway-service.ts`
- Modify: `packages/gateway/src/policies/access-control.ts`
- Modify: gateway test files as needed

- [ ] **Step 1: Rename in types.ts**

In `GatewayConfigSchema`, rename the `channels` field to `accessControl`. Keep the same schema shape.

- [ ] **Step 2: Update gateway-service.ts**

Search for `config.channels` or `channels` references and rename to `accessControl`.

- [ ] **Step 3: Update access-control.ts**

Update any references to the config field.

- [ ] **Step 4: Update tests**

Search all gateway test files for `channels:` in config objects and rename to `accessControl:`.

- [ ] **Step 5: Also update builder.ts**

Search `packages/runtime/src/builder.ts` for `channels` references in the gateway config handling and rename to `accessControl`.

- [ ] **Step 6: Run gateway + runtime tests**

Run: `bun test`

- [ ] **Step 7: Commit**

```
git add packages/gateway/ packages/runtime/
git commit -m "refactor(gateway): rename GatewayConfig.channels to accessControl (breaking)"
```

---

## Task 5: TriggerRegistry Service

**Files:**
- Create: `packages/channels/src/services/trigger-registry.ts`
- Create: `packages/channels/tests/trigger-registry.test.ts`

- [ ] **Step 1: Write tests for trigger matching**

```typescript
import { describe, test, expect } from "bun:test";
import { TriggerRegistry } from "../src/services/trigger-registry.js";
import type { InboundMessage, TriggerDefinition } from "../src/types.js";

const makeMsg = (overrides: Partial<InboundMessage> = {}): InboundMessage => ({
  id: "msg-1",
  platform: "discord",
  channelId: "ch-1",
  senderId: "user-1",
  content: "hello",
  metadata: {},
  timestamp: new Date(),
  ...overrides,
});

describe("TriggerRegistry", () => {
  test("keyword match fires on matching content", () => { ... });
  test("slash_command match fires on /command prefix", () => { ... });
  test("mention match fires when content mentions bot", () => { ... });
  test("custom evaluator fires when function returns true", () => { ... });
  test("no match returns null", () => { ... });
  test("permissions deny blocked users", () => { ... });
  test("default agent returned when no trigger matches", () => { ... });
  test("register and unregister work", () => { ... });
});
```

- [ ] **Step 2: Implement TriggerRegistry**

Pure synchronous service (no Effect needed for evaluate — it's a fast in-memory lookup):

```typescript
export class TriggerRegistry {
  private triggers = new Map<string, TriggerDefinition>();
  private defaultAgent?: TriggerAgentConfig;

  register(trigger: TriggerDefinition): void { ... }
  unregister(triggerId: string): void { ... }
  setDefault(config: TriggerAgentConfig): void { ... }

  evaluate(msg: InboundMessage): TriggerDefinition | null {
    for (const trigger of this.triggers.values()) {
      if (this.matchesTrigger(trigger, msg)) {
        if (this.isPermitted(trigger, msg)) return trigger;
      }
    }
    return null;
  }

  private matchesTrigger(trigger: TriggerDefinition, msg: InboundMessage): boolean {
    const match = trigger.match;
    switch (match.type) {
      case "keyword": return match.patterns.some(p => msg.content.toLowerCase().includes(p.toLowerCase()));
      case "slash_command": return msg.content.startsWith(`/${match.command}`);
      case "mention": return /(@bot|@agent)/i.test(msg.content); // adapter sets specific pattern
      case "reaction": return false; // reactions are platform-specific events, not message content
      case "webhook": return false; // webhooks match by path, not message content
      case "custom": return match.evaluate(msg);
    }
  }

  private isPermitted(trigger: TriggerDefinition, msg: InboundMessage): boolean {
    const perms = trigger.permissions;
    if (!perms) return true;
    if (perms.deniedUsers?.includes(msg.senderId)) return false;
    if (perms.allowedUsers && !perms.allowedUsers.includes(msg.senderId)) return false;
    return true;
  }
}
```

- [ ] **Step 3: Run tests**
- [ ] **Step 4: Export from index.ts**
- [ ] **Step 5: Commit**

```
git add packages/channels/src/services/trigger-registry.ts packages/channels/tests/trigger-registry.test.ts packages/channels/src/index.ts
git commit -m "feat(channels): implement TriggerRegistry with keyword, slash_command, mention, and custom matching"
```

---

## Task 6: SessionBridge Service

**Files:**
- Create: `packages/channels/src/services/session-bridge.ts`
- Create: `packages/channels/tests/session-bridge.test.ts`

This is the most complex service. It maps external identities to agent sessions with per-session FIFO queues and SQLite persistence.

- [ ] **Step 1: Write tests**

Tests should cover:
- `resolve()` creates new session for unknown user
- `resolve()` returns existing session for known user
- `release()` ends session and cleans up
- `listActive()` returns only active/idle sessions
- Per-session message queue processes sequentially (not in parallel)
- Session idle timeout fires after configured duration
- Lifecycle types: single_response ends after first reply, conversation resets idle timer, persistent never auto-ends

- [ ] **Step 2: Implement SessionBridge**

The service needs:
- A `Map<string, AgentSession>` for active sessions keyed by `${platform}:${userId}:${channelId}`
- A `Map<string, Effect.Queue<InboundMessage>>` for per-session message queues
- SQLite persistence for `channel_sessions` table (create table on init)
- Session lifecycle management (idle timers, TTL, single_response cleanup)

Read `packages/runtime/src/chat.ts` and the `agent.session()` method in `builder.ts` to understand how to create and use `AgentSession`. The session bridge calls `agent.session()` to create each session, then `session.chat(message)` for each inbound message.

**Key design:** The session bridge does NOT own agent creation for default sessions — it receives a `chatFn` factory from the ChannelService that handles building agents from trigger configs.

- [ ] **Step 3: Run tests**
- [ ] **Step 4: Export from index.ts**
- [ ] **Step 5: Commit**

```
git add packages/channels/src/services/session-bridge.ts packages/channels/tests/session-bridge.test.ts packages/channels/src/index.ts
git commit -m "feat(channels): implement SessionBridge with per-session queues, lifecycle, and SQLite persistence"
```

---

## Task 7: ChannelService Orchestrator

**Files:**
- Create: `packages/channels/src/services/channel-service.ts`
- Create: `packages/channels/tests/channel-service.test.ts`

- [ ] **Step 1: Write tests**

Tests should cover:
- Register adapter → connect called
- Inbound message → trigger evaluated → session resolved → agent.chat() called → response sent back
- Inbound message → policy rejects (rate limit) → message not processed
- Inbound message → no trigger match → default agent used
- Multiple adapters registered → each forwards messages
- Status reports adapter info and session counts
- EventBus events published for each step

- [ ] **Step 2: Implement ChannelService**

The orchestrator ties everything together:

```typescript
export class ChannelService {
  constructor(
    private triggerRegistry: TriggerRegistry,
    private sessionBridge: SessionBridge,
    private policyEngine: PolicyEngine,  // from @reactive-agents/gateway
    private eventBus?: EventBusLike,
  ) {}

  async registerAdapter(adapter: MessageChannel): Promise<void> {
    await Effect.runPromise(adapter.connect());
    await Effect.runPromise(adapter.onMessage((msg) => this.handleMessage(adapter.id, msg)));
    this.adapters.set(adapter.id, adapter);
  }

  private handleMessage(adapterId: string, msg: InboundMessage): Effect.Effect<void> {
    return Effect.gen(function* () {
      // 1. Convert to GatewayEvent
      const gwEvent = toGatewayEvent(msg);

      // 2. Run through policy engine
      const decision = yield* policyEngine.evaluate(gwEvent);
      if (decision.action !== "execute") return; // skip/queue/escalate

      // 3. Evaluate triggers
      const trigger = triggerRegistry.evaluate(msg);
      const agentConfig = trigger?.agent ?? triggerRegistry.getDefault();

      // 4. Resolve session (creates if needed via injected agentFactory)
      const session = yield* sessionBridge.resolve({
        identity: { platform: msg.platform, userId: msg.senderId, displayName: msg.senderName },
        channelId: msg.channelId,
        agentConfig,
        lifecycle: trigger?.lifecycle,
      });

      // 5. Enqueue message for sequential processing
      yield* sessionBridge.enqueue(session.id, msg);

      // 6. Publish TriggerFired event
      if (trigger && eventBus) {
        yield* eventBus.publish({ _tag: "TriggerFired", ... });
      }
    });
  }
}
```

The session bridge's queue drain loop calls `session.chat(msg.content)` and routes the reply via `adapter.sendMessage()`.

- [ ] **Step 3: Run tests**
- [ ] **Step 4: Export from index.ts**
- [ ] **Step 5: Commit**

```
git add packages/channels/src/services/channel-service.ts packages/channels/tests/channel-service.test.ts packages/channels/src/index.ts
git commit -m "feat(channels): implement ChannelService orchestrator with policy integration"
```

---

## Task 8: Webhook Adapter

**Files:**
- Create: `packages/channels/src/adapters/webhook.ts`
- Create: `packages/channels/tests/webhook-adapter.test.ts`

- [ ] **Step 1: Write tests**

```typescript
describe("WebhookChannelAdapter", () => {
  test("valid HMAC signature → message accepted", () => { ... });
  test("invalid signature → connection error", () => { ... });
  test("POST body → InboundMessage transformation", () => { ... });
  test("onMessage handler called for each request", () => { ... });
  test("sendMessage returns messageId", () => { ... });
  test("no secret configured → signature check skipped", () => { ... });
});
```

- [ ] **Step 2: Implement WebhookChannelAdapter**

This adapter implements `MessageChannel` for generic HTTP webhooks:

```typescript
export class WebhookChannelAdapter implements MessageChannel {
  readonly id: string;

  constructor(private config: {
    id?: string;
    secret?: string;
    platform?: string;
    // Response callback — webhook adapter doesn't "send" in the traditional sense,
    // it returns the response to the HTTP handler. ChannelService provides this.
    onResponse?: (target: ChannelTarget, content: MessageContent) => Promise<void>;
  }) {
    this.id = config.id ?? "webhook";
  }

  // Webhook adapter is stateless — connect/disconnect are no-ops
  connect() { return Effect.void; }
  disconnect() { return Effect.void; }

  // Called by the HTTP handler (e.g., from gateway webhook service)
  handleRequest(req: { body: string; headers: Record<string, string> }): Effect.Effect<void> {
    // 1. Validate HMAC signature if secret configured
    // 2. Parse body into InboundMessage
    // 3. Call registered onMessage handler
  }

  sendMessage(target: ChannelTarget, content: MessageContent): Effect.Effect<SendResult> {
    // Delegate to onResponse callback
  }

  onMessage(handler: (msg: InboundMessage) => Effect.Effect<void>): Effect.Effect<ChannelSubscription> {
    // Store handler, return unsubscribe
  }
}
```

- [ ] **Step 3: Run tests**
- [ ] **Step 4: Export from index.ts**
- [ ] **Step 5: Commit**

```
git add packages/channels/src/adapters/webhook.ts packages/channels/tests/webhook-adapter.test.ts packages/channels/src/index.ts
git commit -m "feat(channels): implement WebhookChannelAdapter with HMAC validation"
```

---

## Task 9: Builder + Runtime Integration

**Files:**
- Modify: `packages/runtime/src/builder.ts`
- Modify: `packages/runtime/src/runtime.ts`

- [ ] **Step 1: Add `.withChannels()` to builder**

Add a method that accepts `ChannelsConfig` and stores it on the builder. In `build()`, when channels config is present + gateway is enabled, start the ChannelService alongside the gateway.

```typescript
withChannels(config: ChannelsConfig): this {
  this._channelsConfig = config;
  return this;
}
```

- [ ] **Step 2: Wire channels startup into gateway start**

In the builder's gateway startup logic (the `start()` method or `withGateway` handler), after the gateway starts, initialize ChannelService:
1. Create TriggerRegistry, register configured triggers
2. Create SessionBridge (with SQLite from memory layer if available)
3. Create ChannelService with policy engine + EventBus
4. Register all adapters from config
5. Store stop handles for cleanup

- [ ] **Step 3: Run full test suite**

Run: `bun test`

- [ ] **Step 4: Commit**

```
git add packages/runtime/src/builder.ts packages/runtime/src/runtime.ts
git commit -m "feat(runtime): add .withChannels() builder method and gateway integration"
```

---

## Task 10: Integration Tests & Verification

- [ ] **Step 1: Write end-to-end integration test**

Create `packages/channels/tests/integration.test.ts`:
- Build an agent with `.withChannels()` + webhook adapter
- Simulate an inbound webhook message
- Verify: trigger matched → session created → agent.chat() called → response sent
- Verify: EventBus events published in correct order

- [ ] **Step 2: Run full test suite**

Run: `bun test`

- [ ] **Step 3: Run build**

Run: `bun run build`

- [ ] **Step 4: Commit**

```
git add packages/channels/tests/integration.test.ts
git commit -m "test(channels): add end-to-end integration test for webhook → session → response flow"
```
