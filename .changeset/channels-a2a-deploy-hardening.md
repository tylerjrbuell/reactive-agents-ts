---
"@reactive-agents/channels": patch
"@reactive-agents/a2a": patch
"@reactive-agents/cli": patch
---

Security hardening for channels, A2A and deploy scaffolds.

- channels: an empty or whitespace webhook / Telegram `secretToken` secret is treated as unset and fails closed (previously an empty key let anyone forge a signature). Sender identity (`sender`, `platform`, `adapterId`) can no longer be overridden by adapter-supplied `metadata` when the policy event is built. The per-sender session map is now bounded (LRU, default 500, `SessionBridge({ maxSessions })`). Telegram and Signal adapters ask the new `ChannelAdapter.setSenderGate` hook (installed by `ChannelService`, backed by the gateway access policy or `ChannelServiceDeps.allowSender`) before downloading inbound attachments, so unknown senders cannot force downloads.
- a2a: the HTTP server counts request bytes on the stream (default 1 MiB, `maxBodyBytes` option, 413 on excess) so chunked bodies cannot bypass the cap; the task store is bounded (default 1000, `createA2AServer(card, { maxTasks })`, oldest evicted); discovery and `getAgentCard` no longer follow redirects, and `getAgentCard` now goes through the same `assertPublicUrl` egress guard as `discoverAgent` (cloud metadata always blocked, private targets blocked with `strictEgress`).
- cli: `rax deploy` SDK scaffolds now create or extend `.dockerignore` (`.git`, `.env*`) so `.env.production` and git history never land in image layers.
- docker/signal-mcp: the Signal data dir is `chmod 700` (was 777; the compose service runs as `SIGNAL_UID`/`SIGNAL_GID`, default 1000), Bun is pinned, and the signal-cli tarball is verified against a SHA-256.
