---
"@reactive-agents/reasoning": patch
---

`ReasoningService.execute` and `StrategyRegistry` now accept `initialMessages` whose content is `MessageContent` (a string or content parts such as images, audio and files). Parts reach the provider request unchanged; text-only content is unchanged on the wire.
