---
"@reactive-agents/gateway": patch
"@reactive-agents/channels": patch
"@reactive-agents/cli": patch
---

Gateway and deploy hardening.

- Gateway: the hourly action cap (`maxActionsPerHour`) and daily token budget now reset when their window elapses. Before, a long-running gateway stopped acting after 30 runs until restarted.
- Channel access control is now keyed by `platform:userId` (for example `signal:+15551234567`), so ids on different platforms cannot collide, and a channel event with an empty sender is denied. **Migration:** prefix existing `allowedSenders` / `blockedSenders` entries with the platform; bare entries no longer match platform-tagged senders. `replyToUnknown` is now sent by `ChannelService` (`replyToUnknown` dep) to allowlist-denied senders; the MCP-push Signal/Telegram path still does not send it.
- `rax deploy`: `--name` is validated (`/^[a-z0-9][a-z0-9-]{0,40}$/`) and every provider command runs as an argument array instead of a `sh -c` string, closing a shell-injection path. Cloud Run now deploys authenticated by default (`--allow-unauthenticated` is an opt-in flag) and, in daemon mode, with `--min-instances=1 --no-cpu-throttling`. The Fly scaffold no longer auto-stops machines in daemon mode and defines one health check. Render no longer calls the non-existent `render blueprint launch` (it runs `render blueprints validate` and prints the Git-connect steps); empty `dockerCommand` / `startCommand` strings are gone from the Render and Railway scaffolds.
