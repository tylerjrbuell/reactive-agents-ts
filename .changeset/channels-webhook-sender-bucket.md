---
"@reactive-agents/channels": patch
---

Webhook routes are no longer throttled as one sender. Most webhook callers send no `senderId`, so every request shared one `unknown` bucket and the default cap of 6 turns per sender per hour throttled all webhook traffic on the route. Routes on the `webhook` platform now have no default per-sender cap; the route-level caps (`maxCostPerDayUsd`, `maxTurnsPerHour`) still apply, and an explicit `maxTurnsPerSenderPerHour` is enforced per `senderId`. Messaging channels keep the default.
