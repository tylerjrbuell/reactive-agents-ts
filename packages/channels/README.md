# @reactive-agents/channels

> Version: **0.10.3** — external channel layer for [Reactive Agents](https://docs.reactiveagents.dev/).

The channels package provides the **inbound messaging surface** for agents: bot transports
(Discord, Telegram Bot API, Signal, …), HTTPS webhooks, a trigger registry that maps inbound
messages to agent invocations, and a session bridge that persists per-sender conversations into
gateway chat mode.

This package is the missing half of `@reactive-agents/gateway`: the gateway runs the policies and
schedule, channels carries the actual messages in and out.

## Installation

```bash
bun add @reactive-agents/channels @reactive-agents/gateway
```

Or install the umbrella:

```bash
bun add reactive-agents
```

## Design: bot-first

First-class transports are **bot tokens + HTTPS webhooks** (Discord, Telegram Bot API, Slack
Events API, etc.). Adapters normalize provider payloads into a shared `InboundMessage` shape.

User-mode clients (e.g. Telegram MTProto / Telethon) belong in optional MCP adapters or custom
transports — they are **not** the default path this package optimizes for.

## What this package provides

- **`MessageChannel` interface** — transport contract (`connect`, `disconnect`, `sendMessage`,
  `onMessage`).
- **`WebhookChannelAdapter`** — drop-in HTTPS webhook adapter with optional HMAC verification.
- **`TriggerRegistry`** — match inbound messages against `TriggerDefinition`s (regex, prefix,
  predicate) and pick which agent + system prompt to run.
- **`SessionBridge`** — owns the `(platform, senderId)` → `Session` mapping and merges trigger
  agent overrides with the running agent's defaults.
- **`ChannelService`** — orchestrates `adapters → policy → triggers → SessionBridge`; emits
  `GatewayEvent`s into the gateway loop.

## Quick example

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";
import { WebhookChannelAdapter } from "@reactive-agents/channels";

const slackAdapter = new WebhookChannelAdapter({
  id: "slack",
  platform: "slack",
  port: 3001,
  path: "/slack/events",
  secret: process.env.SLACK_SIGNING_SECRET,
});

const agent = await ReactiveAgents.create()
  .withName("ops-bot")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withMemory("1")
  .withGateway({
    accessControl: {
      mode: "chat",
      accessPolicy: "allowlist",
      allowedSenders: ["U_TYLER", "U_OPS"],
    },
  })
  .withChannels({
    adapters: [slackAdapter],
    triggers: [
      {
        match: { kind: "prefix", value: "!status" },
        agent: { systemPrompt: "Reply with a one-line ops summary." },
      },
    ],
  })
  .build();

await agent.start();   // adapters and gateway loop come up together
```

## Inbound message shape

```typescript
interface InboundMessage {
  readonly id: string;
  readonly platform: string;        // 'discord' | 'telegram-bot' | 'slack' | 'signal' | ...
  readonly channelId: string;
  readonly senderId: string;
  readonly senderName?: string;
  readonly content: string;
  readonly attachments?: Attachment[];
  readonly replyTo?: string;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: Date;
}
```

Adapters are responsible for normalizing provider payloads into this shape.

## Triggers

A `TriggerDefinition` decides whether a message activates an agent and with what overrides:

```typescript
import type { TriggerDefinition } from "@reactive-agents/channels";

const triggers: TriggerDefinition[] = [
  {
    match: { kind: "regex", pattern: /^@deploy\s+(\S+)/ },
    agent: { systemPrompt: "You are a deploy bot." },
  },
  {
    match: { kind: "predicate", fn: (msg) => msg.metadata.priority === "high" },
    agent: { systemPrompt: "Treat as urgent. Be concise." },
  },
];
```

If no trigger matches, `defaultAgent` (passed to `.withChannels()`) is used.

## Session bridge

`SessionBridge` is the seam between channels and the gateway. It:

- Hands each `(platform, senderId)` pair a stable session id.
- Merges trigger-supplied agent overrides (system prompt, model, …) with the agent's defaults.
- Emits inbound messages as `GatewayEvent`s for the gateway loop to evaluate against policies
  (allowlist, rate limit, daily budget) before invoking the agent.

Session **persistence** (window, compaction, TTL pruning, episodic memory injection) lives in
`@reactive-agents/memory` (`SessionStoreService`) and is wired up automatically when
`.withGateway({ accessControl: { mode: "chat" } })` is in effect.

## WebhookChannelAdapter

Minimal HTTPS adapter for any provider that supports outbound webhooks:

```typescript
import { WebhookChannelAdapter } from "@reactive-agents/channels";

const adapter = new WebhookChannelAdapter({
  id: "github-issues",
  platform: "github",
  port: 3002,
  path: "/github",
  secret: process.env.GITHUB_WEBHOOK_SECRET, // HMAC-SHA256
  parse: (body, headers) => {
    // return InboundMessage | null
  },
});
```

For full GitHub event semantics (signature verification, action filtering), prefer
`createGitHubAdapter` from `@reactive-agents/gateway`.

## Naming note

The gateway's messaging configuration lives under
`.withGateway({ accessControl: { ... } })` — renamed from `channels` to avoid clashing with this
package. The two surfaces are intentionally separate: `accessControl` governs **who can talk to
the agent**; `channels` governs **how messages get in and out**.

## Documentation

- Channels guide: [docs.reactiveagents.dev/guides/channels/](https://docs.reactiveagents.dev/guides/channels/)
- Bot quickstart (Discord / Telegram / Slack): [docs.reactiveagents.dev/guides/bots/](https://docs.reactiveagents.dev/guides/bots/)
- Related: [`@reactive-agents/runtime`](../runtime/README.md),
  [`@reactive-agents/gateway`](../gateway/README.md),
  [`@reactive-agents/memory`](../memory/README.md).

## License

MIT
