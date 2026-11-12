---
"@reactive-agents/core": minor
---

Add typed `AgentEvent` members for the channel router: `ChannelRouteMatched`, `ChannelRouteDenied`, `ChannelUnrouted`, `ChannelTurnStarted`, `ChannelTurnCompleted`, `ChannelTurnDropped` and `ChannelOwnershipChanged`. `ChannelDeliveryFailed.kind` gains `"conflict"` (another consumer owns the account).
