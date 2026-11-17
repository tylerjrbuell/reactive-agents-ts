---
"@reactive-agents/channels": patch
---

Channels now emits the typed core events `ChannelSendFailed` and `ChannelFollowUpScheduled` / `ChannelFollowUpFired` / `ChannelFollowUpCancelled` instead of `Custom` events. Event names and fields are unchanged; consumers that matched `Custom` with `type` and `payload` now match on `_tag` directly.
