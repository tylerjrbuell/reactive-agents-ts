---
"@reactive-agents/cortex": patch
---

The Gateway tab reads the framework's own `agent.channelStatus()` and `agent.gatewayStatus().inboundQueue` instead of folding events: it now shows live queue depth (waiting of capacity, drops) and the real per-channel message counts with the last message in and last reply out. Webhook channels route through `WebhookChannelAdapter.handleWebhook`.
