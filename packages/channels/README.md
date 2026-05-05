# @reactive-agents/channels

External channel layer: **TriggerRegistry**, **SessionBridge**, **ChannelService**, **WebhookChannelAdapter**, plus shared types/errors.

**Transports:** Prefer bot tokens and HTTPS webhooks (Telegram Bot API, Discord, and similar). Adapters normalize provider payloads into shared `InboundMessage` shapes. User MTProto clients belong in optional MCP/adapters, not the default path.

**Gateway config:** Messaging allowlist / chat mode lives under `.withGateway({ accessControl: { ... } })` (renamed from `channels` to avoid clashing with this package).

See `docs/superpowers/plans/2026-03-22-channels-package.md` for the full rollout plan.

**Runtime:** use `.withChannels({ adapters, triggers?, defaultAgent? })` with `.withGateway()` — adapters start when `agent.start()` runs (see `ReactiveAgent.start` JSDoc for async registration timing).
