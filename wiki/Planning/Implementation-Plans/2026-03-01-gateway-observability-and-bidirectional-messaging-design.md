# Gateway Observability & Bidirectional Messaging — Design

**Date**: 2026-03-01
**Status**: Approved
**Scope**: Gateway EventBus integration, Signal MCP push notifications, conversational agent messaging

---

## Problem Statement

Two gaps in the current gateway implementation:

1. **No observability**: GatewayService, SchedulerService, and the policy engine operate silently. `routeEventWithBus()` exists in `input-router.ts` but is never called. No structured logging, no EventBus publishing, no tracing for heartbeats, policy decisions, or cron checks.

2. **No bidirectional messaging**: Signal MCP supports send and receive, but the agent can only poll for messages on heartbeat ticks. There's no push-based notification path, no conversation threading, and no access control for incoming messages. The vision is agents that hold back-and-forth conversations through messaging platforms (Signal, Telegram, SMS/RCS).

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tackle both together | Yes | Observability is prerequisite for debugging messaging flow |
| Conversation model | Context-aware (command + multi-turn) | Agent detects intent — commands get one-shot execution, follow-ups maintain context |
| Conversation state | Existing memory layer (episodic) | Simpler, no new service. Memory retrieval surfaces past exchanges by sender |
| Initial platform | Signal only | Already built and working. Generalize later |
| Message delivery | MCP push notifications | Near-instant, uses standard MCP protocol, clean architecture |
| Interaction layer | Separate input channel | Messages don't route through InteractionManager. Gateway handles routing directly |
| Access control | Configurable per-agent | Allowlist (default), blocklist, or open. Builder API configurable |

---

## Section 1: Gateway Observability

### New EventBus Event Types

Added to `@reactive-agents/core` AgentEvent union:

| Event Tag | Published When | Payload |
|-----------|---------------|---------|
| `GatewayHeartbeatEmitted` | Heartbeat tick fires | agentId, eventId, consecutiveSkips |
| `GatewayPolicyEvaluated` | Policy engine returns decision | eventId, source, decision, policyTag, reason |
| `GatewayCronFired` | Cron schedule matches | agentId, schedule, instruction |
| `GatewayEventExecuted` | Agent.run() called from gateway | eventId, source, instruction, tokensUsed |
| `GatewayEventSkipped` | Policy skips an event | eventId, source, reason, policyTag |
| `ChannelMessageReceived` | Incoming message from messaging platform | sender, platform, message, threadId |

### Publishing Points

- `GatewayService.processEvent()` — publishes `GatewayPolicyEvaluated` after policy chain
- `SchedulerService.emitHeartbeat()` — publishes `GatewayHeartbeatEmitted`
- `SchedulerService.checkCrons()` — publishes `GatewayCronFired` for each matched cron
- Gateway loop in `builder.ts` — publishes `GatewayEventExecuted` after `agent.run()`, `GatewayEventSkipped` on skip/queue

### Structured Logging

Mirrors execution engine's phase logging style:

```
◉ [heartbeat]     tick #14, adaptive: executing
◉ [policy]        cost-budget: 12,450/50,000 tokens (24%)
◉ [cron]          "0 9 * * MON" matched, instruction: "Review PRs"
◉ [channel]       message from +1234 on signal: "check server status"
◉ [gateway-skip]  rate-limit: 31/30 actions this hour
```

### Implementation Pattern

GatewayService and SchedulerService accept an optional `EventBusLike` dependency (same pattern as execution engine's `EbLike`). If provided, events are published. If not, services work silently (backward compatible).

---

## Section 2: Signal MCP Push Notifications

### Signal CLI Bridge Changes

The signal-cli bridge already buffers incoming notifications. Enhancement: forward each notification immediately via callback.

```typescript
// signal-cli-bridge.ts — onNotification handler
this.notifications.push(notification);
this.onMessageCallback?.(notification);  // NEW: immediate callback
```

### MCP Server Notification

```typescript
// index.ts — MCP server setup
bridge.onMessageCallback = (notification) => {
  const message = formatMessage(notification);
  if (message) {
    server.notification({
      method: "notifications/message",
      params: {
        sender: message.source,
        message: message.message,
        timestamp: message.timestamp,
        groupId: message.groupId,
        platform: "signal"
      }
    });
  }
};
```

### Key Decisions

- `receive_message` tool still works (explicit polling / catching up on missed messages)
- Notifications are fire-and-forget from MCP server's perspective
- MCP notification method: `notifications/message` (follows MCP convention)
- Message format matches existing `formatMessages()` output

---

## Section 3: ToolService Notification Forwarding

### MCP Client Notification Listener

When connecting to an MCP server, register a notification handler:

```typescript
client.onNotification(({ method, params }) => {
  if (method === "notifications/message") {
    eb.publish({
      _tag: "ChannelMessageReceived",
      sender: params.sender,
      platform: params.platform,
      message: params.message,
      timestamp: params.timestamp,
      groupId: params.groupId,
      mcpServer: serverName,
    });
  }
});
```

### Design Properties

- EventBus dependency passed through to MCP client setup code
- Platform-agnostic: any MCP server sending `notifications/message` is automatically forwarded
- No Signal-specific code in ToolService

---

## Section 4: Gateway Channel Event Routing

### Event-Driven Message Processing

The gateway loop subscribes to EventBus for `ChannelMessageReceived` events, processes them through the policy engine immediately (not waiting for heartbeat timer).

```typescript
const unsubChannel = await eb.on("ChannelMessageReceived", async (event) => {
  const gwEvent: GatewayEvent = {
    id: generateId(),
    source: "channel",
    timestamp: new Date(event.timestamp),
    agentId: self._agentId,
    payload: { sender: event.sender, message: event.message },
    priority: "normal",
    metadata: {
      platform: event.platform,
      sender: event.sender,
      groupId: event.groupId,
      mcpServer: event.mcpServer,
    },
  };

  const decision = await gw.processEvent(gwEvent);

  if (decision.action === "execute") {
    const instruction = `Respond to this ${event.platform} message from ${event.sender}: "${event.message}". Use the ${event.mcpServer}/send_message_to_user tool to reply.`;
    const result = await self.run(instruction);
    await gw.updateTokensUsed(result.metadata.tokensUsed);
  }
});
```

### Key Decisions

- Channel events bypass heartbeat timer — processed immediately on receipt
- Still routed through full policy engine (rate limit, budget, access control)
- Heartbeat loop continues independently for proactive tasks
- `GatewayHandle.stop()` unsubscribes channel listener alongside heartbeat timer
- Sender context injected into instruction so LLM knows who to reply to

---

## Section 5: Access Control Policy

### Configuration

```typescript
interface ChannelAccessConfig {
  policy: "allowlist" | "blocklist" | "open";  // default: "allowlist"
  allowedSenders?: string[];
  blockedSenders?: string[];
  unknownSenderAction?: "skip" | "escalate";  // default: "skip"
  replyToUnknown?: string;  // optional auto-reply
}
```

### Behavior

- Priority 5 (evaluated before all other policies)
- Only evaluates events with `source === "channel"`
- `"allowlist"`: skip if sender not in allowedSenders
- `"blocklist"`: skip if sender in blockedSenders
- `"open"`: allow all (existing guardrails still apply)
- Optionally sends polite rejection to unknown senders

### Builder API

```typescript
.withGateway({
  heartbeat: { intervalMs: 30_000 },
  channels: {
    accessPolicy: "allowlist",
    allowedSenders: ["+15551234567"],
    unknownSenderAction: "skip",
    replyToUnknown: "Sorry, I'm not configured to chat with you.",
  },
  policies: { dailyTokenBudget: 50_000 },
})
```

### Defense in Depth

Access control is a gateway-level gate (runs before any LLM call). Existing `withGuardrails()` injection/PII/toxicity detection runs inside the execution engine on message content after access is approved.

---

## Section 6: Conversation Context & Memory

### How It Works

When a channel message triggers `agent.run()`, the instruction includes sender context. The existing memory layer handles conversation history:

1. **Episodic memory**: After each exchange, the agent stores the conversation in episodic memory via the `[memory-flush]` phase. Key metadata: sender ID, platform, timestamp.

2. **Memory retrieval at bootstrap**: When a new message arrives from the same sender, the `[bootstrap]` phase retrieves relevant episodic memories. Sender ID naturally surfaces recent conversation history.

3. **System prompt augmentation**: Gateway injects conversational system prompt for channel messages:
   ```
   You are responding to a message on Signal from {sender}.
   Recent conversation context will be in your memory.
   Reply concisely and conversationally.
   Use {mcpServer}/send_message_to_user to send your response.
   ```

### What This Gives Us Without New Code

- Multi-turn context (memory retrieves past exchanges with same sender)
- Intent detection (LLM decides if it's a command or conversation naturally)
- Tool use mid-conversation (agent executes tasks and reports results)

### What We're NOT Building

- No explicit conversation session/thread tracking service
- No conversation timeout/expiry logic
- No separate conversation database

---

## Data Flow Diagram

```
Signal message arrives
  → signal-cli notification buffer
  → Signal MCP server sends MCP notification (notifications/message)
  → ToolService MCP client receives notification
  → Publishes "ChannelMessageReceived" to EventBus
  → Gateway subscribes, creates GatewayEvent { source: "channel" }
  → AccessControlPolicy evaluates sender (allowlist/blocklist/open)
  → RateLimitPolicy checks hourly budget
  → CostBudgetPolicy checks daily token budget
  → If approved: agent.run(instruction with sender context)
    → [bootstrap] retrieves episodic memories for this sender
    → [guardrail] scans message for injection/PII/toxicity
    → [think] LLM reasons about response
    → [act] LLM calls signal/send_message_to_user
    → [memory-flush] stores exchange in episodic memory
  → Gateway publishes "GatewayEventExecuted" to EventBus
  → Structured log: ◉ [channel] message from +1234, responded in 2.3s
```

---

## Files Changed

| File | Change |
|------|--------|
| `packages/core/src/types.ts` | Add 6 new AgentEvent variants |
| `packages/gateway/src/services/gateway-service.ts` | Add EventBusLike dependency, publish events |
| `packages/gateway/src/services/scheduler-service.ts` | Add EventBusLike dependency, publish events |
| `packages/gateway/src/policies/access-control.ts` | New policy (priority 5) |
| `packages/gateway/src/types.ts` | Add ChannelAccessConfig to GatewayConfig |
| `packages/gateway/src/index.ts` | Export new policy + types |
| `packages/tools/src/tool-service.ts` | Add MCP notification listener, EventBus forwarding |
| `packages/runtime/src/builder.ts` | Channel event subscription in start(), channels config |
| `packages/runtime/src/runtime.ts` | Pass EventBus to gateway layer, channels config |
| `docker/signal-mcp/server/src/signal-cli-bridge.ts` | Add onMessageCallback |
| `docker/signal-mcp/server/src/index.ts` | Send MCP notifications on message |
| Test files | New tests for each component |
