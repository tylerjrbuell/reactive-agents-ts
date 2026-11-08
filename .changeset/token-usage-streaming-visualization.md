---
"@reactive-agents/runtime": minor
"@reactive-agents/ui-core": minor
"@reactive-agents/cortex": patch
---

Add a public full-density `TokenUsage` stream event projected from the existing `LLMRequestCompleted` bus event, carrying the provider's per-call input/output split, cache figures, cost and duration. ui-core folds these into `TurnTraceState.usage` and persists them. Cortex persists real provider splits per turn, shows live input/output counters and a per-call strip, and consolidates usage into the Inspector's Context tab. Live counters roll in place (session wheel, per-turn badge, run chat), each half is marked `~` only while estimated, and provider-reported values win.