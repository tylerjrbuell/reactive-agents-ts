---
"@reactive-agents/core": patch
---

New typed `AgentEvent` members `ChannelSendFailed` (outbound send failed for good, no message text) and `ChannelFollowUpScheduled` / `ChannelFollowUpFired` / `ChannelFollowUpCancelled` (follow-up timer lifecycle). Additive; `@reactive-agents/channels` emits them.
