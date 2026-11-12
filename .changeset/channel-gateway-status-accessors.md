---
"@reactive-agents/channels": minor
"@reactive-agents/gateway": minor
---

Channel health is readable without reaching into adapters. `ChannelService.status()` adapters now report `platform`, `messagesReceived`, `messagesSent`, `lastInboundAt` and `lastSentAt` next to connection state, delivery failures and the last error. `WebhookChannelAdapter.handleWebhook` verifies and enqueues like `handleRequest` but fails with a typed `ChannelError`, so it fits the gateway's `IngressChannelRoute.handle` directly. `GatewayStatus` gains an optional `inboundQueue` (`ready`, `deferred`, `capacity`, `overflow`, `dropped`) and a `withInboundQueue` helper; the runtime fills it.
