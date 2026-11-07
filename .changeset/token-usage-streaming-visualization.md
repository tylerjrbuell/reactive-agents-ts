---
"@reactive-agents/runtime": minor
"@reactive-agents/ui-core": minor
---

Add a public full-density `TokenUsage` stream event projected from the existing `LLMRequestCompleted` bus event, carrying the provider's per-call input/output split, cache figures, cost and duration. ui-core folds these into `TurnTraceState.usage` and persists them. Cortex persists real provider splits per turn, shows live input/output counters and a per-call strip, and consolidates usage into the Inspector's Context tab. Estimates are always marked `~`; provider-reported values win.