---
"@reactive-agents/gateway": minor
"@reactive-agents/channels": minor
---

Gateway schedules are now durable and manageable. A new `ScheduleRegistry` gives every cron entry a stable id (config crons get an id derived from their definition), `enabled`, `nextFireAt`, `lastRun` and `runCount`, with `list`, `get`, `create`, `update`, `pause`, `resume`, `remove`, `runNow` and `lastResult`. Pass a SQLite `path` and schedules, last results and the last-evaluated time survive a restart. After downtime, missed fires follow a per-schedule catch-up policy (`skip`, `fire-once` (default) or `fire-all`, bounded). `SchedulerService` now fires through the registry and gains `runNow`; `checkCrons` can fail with `ScheduleStoreError`.

The gateway can now serve webhooks. `startIngress` and `startGatewayIngress` mount the WebhookService routes (GitHub, generic) and channel webhooks on one HTTP server bound to 127.0.0.1 by default, with POST-only, a body size cap (default 1 MiB), and per-route secret verification that fails closed. `GatewayConfig.port` and `GatewayConfig.webhooks` are now consumed. `@reactive-agents/channels` adds `channelWebhookRoute` (mount `TelegramChannelAdapter.handleWebhook`) and `deliverScheduleResult` (deliver a schedule result through `ChannelService.deliver` and record the receipt). `@reactive-agents/gateway` now depends on `@reactive-agents/runtime-shim`.
