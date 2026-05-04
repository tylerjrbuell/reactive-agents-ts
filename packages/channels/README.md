# @reactive-agents/channels

External channel types and errors: webhooks, Bot API transports, triggers, and session bridging (Phase 1 scaffold).

**Transports:** Prefer bot tokens and HTTPS webhooks (Telegram Bot API, Discord, and similar). Adapters normalize provider payloads into shared `InboundMessage` shapes. User MTProto clients belong in optional MCP/adapters, not the default path.

See `docs/superpowers/plans/2026-03-22-channels-package.md` for the full rollout plan.
