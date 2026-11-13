---
"@reactive-agents/cortex": patch
---

Cortex no longer carries its own copies of two framework rules. Chat and channel-hub session turns pass no `useTools` and rely on the framework's capability default (only the user's tools-off switch is still passed), and the channel ingress opt-out rides `AgentConfig.gateway.ingress` instead of a `withGateway` overlay. Behavior is unchanged.
