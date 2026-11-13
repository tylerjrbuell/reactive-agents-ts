---
"@reactive-agents/gateway": minor
---

The gateway `generic` webhook adapter now has replay protection on by default. Senders sign `<timestamp>.<body>` and send `x-webhook-timestamp`; timestamps outside `replayWindowMs` (default 5 minutes) are rejected, and a signature already accepted inside the window is rejected as `replayed_delivery`. Failures are typed `WebhookValidationError`s with a new `reason` field. Breaking for senders that sign the body alone: update them, or set `replayProtection: false` on the webhook config entry (logs a warning per request). The GitHub adapter's delivery-id dedupe and the channels `WebhookChannelAdapter` replay window are now pinned by tests.
