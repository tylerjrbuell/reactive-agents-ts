---
"@reactive-agents/runtime": patch
---

`AgentConfig.gateway` now accepts and round-trips `ingress: { channels?: false | string[] }`, so config-driven hosts can opt out of the framework channel ingress without re-applying `withGateway`.
