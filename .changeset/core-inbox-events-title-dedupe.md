---
"@reactive-agents/core": patch
---

Adds typed `ChannelInboxRetried`, `ChannelInboxFailed`, `ChannelInboxBatched`, `ChannelInboxFolded` and `ChannelInboxInterrupted` events (additive `AgentEvent` members). Adds `normalizeTitle` and `isNearDuplicateTitle`, the shared near-duplicate rule for plan and checklist step titles.
