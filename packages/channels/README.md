# @reactive-agents/channels

> Channel layer for Reactive Agents: one adapter contract for Signal, Telegram and webhooks, plus a fail-closed router that maps inbound messages to agents.

> **Stability:** unstable. The channel router shipped as its first slice; route and adapter shapes are still growing.

## Install

```bash
bun add @reactive-agents/channels @reactive-agents/gateway
# or: npm install @reactive-agents/channels @reactive-agents/gateway
```

## Usage

```ts
import { ReactiveAgents } from "@reactive-agents/runtime";
import { WebhookChannelAdapter as Webhook } from "@reactive-agents/channels";

const webhook = new Webhook({
  id: "ops",
  platform: "webhook",
  secret: process.env.CHANNEL_WEBHOOK_SECRET, // HMAC-SHA256; requests without a valid signature are rejected
  onResponse: async (target, content) => {
    // deliver the reply; throw with `status` / `retryAfterMs` for typed delivery errors
  },
});

const channels = { adapters: [webhook] };

const agent = await ReactiveAgents.create()
  .withName("ops-bot")
  .withProvider("anthropic")
  .withGateway({ accessControl: { accessPolicy: "allowlist", allowedSenders: ["webhook:alice"] } })
  .withChannels(channels)
  .build();

await agent.start(); // adapters and gateway loop start together
// Your HTTP server forwards requests to webhook.handleRequest({ body, headers }).
```

Unknown senders are denied by default. Set `allowUnsigned: true` on the webhook adapter for local development only.

## API

| Export | Use it when |
|---|---|
| `ChannelAdapter`, `InboundEnvelope`, `DeliveryReceipt`, `ChannelError` | You write an adapter or consume the shared contract. |
| `withReconnect`, `makeOutboundRateLimiter`, `makeInboundDedupe` | You reuse the shared adapter combinators. |
| `WebhookChannelAdapter`, `SignalChannelAdapter`, `TelegramChannelAdapter` | You connect a built-in transport. |
| `createChannelRouter`, `matchRoute`, `explainRoute` | You route conversations to agents with per-route access rules; `explain` reports why a message would be answered. |
| `makeSqliteRouterStore`, `makeMemoryRouterStore`, `RouterInbox`, `RouterOutbox`, `FollowUpTimers` | You need the router's stores, durable inbox, outbox and follow-up timers. |
| `TriggerRegistry`, `SessionBridge`, `ChannelService` | You use the lower-level trigger, session and orchestration services. |

## Limitations

- Discord, Slack and email adapters do not exist yet; use the webhook adapter or write one against the contract.
- In-memory stores reset on restart; use the SQLite router store for durability.

## Documentation

- [Channel adapters](https://docs.reactiveagents.dev/guides/channel-adapters/): the adapter contract, building blocks and conformance suite.
- [Messaging channels](https://docs.reactiveagents.dev/guides/messaging-channels/): Signal, Telegram, webhook and route setup.
- [Gateway](https://docs.reactiveagents.dev/features/gateway/): policies, access control and chat mode that channels feed into.

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.
## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
