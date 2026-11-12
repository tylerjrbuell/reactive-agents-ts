---
"@reactive-agents/gateway": minor
"@reactive-agents/a2a": minor
---

Breaking for open channels: a gateway with no `accessControl` now denies every inbound channel sender (Telegram, Signal, webhook-channel) instead of letting them drive the agent. The deny reason names the sender (`telegram:123`) and how to allow it, and the gateway logs a warning at start. Migration: set `accessControl.allowedSenders` (entries are `platform:userId`, e.g. `"telegram:123456789"`), or, to keep the old behavior, opt in explicitly with `accessControl: { accessPolicy: "open" }`. An `accessControl` block with no `accessPolicy` still defaults to `allowlist`.

Also: the GitHub webhook adapter rejects a replayed `x-github-delivery` id (bounded per-adapter cache of 1024 ids), and the A2A HTTP server validates `message/send`, `message/stream`, `tasks/get` and `tasks/cancel` params against their schemas, answering malformed params with JSON-RPC `-32602`.
