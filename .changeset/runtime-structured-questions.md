---
"@reactive-agents/runtime": patch
---

Structured `request_user_input` questions now reach the live HumanGate, the `InteractionRequested` stream event and `listPendingInteractions()` (live and durable) as an optional `questions` field; a legacy `kind` + `schema` request is unchanged. A HumanGate timeout now reports `timedOut: true` to the kernel so the model receives the structured timeout answer.
