---
"@reactive-agents/reasoning": patch
---

A trace can now say what a model calibration changed. Three additive `guard-fired` events: `profile-overrides-applied` (one per context-profile field a calibration overrode, with `field`, `from`, `to`, `source`) and `calibration-effect` (one per calibration-fed branch that fired: recall force-on, blueprint worker concurrency, adaptive classifier skip; with `field`, `value`, `consumer`, `effect`). `ResolvedActOrAnswer.source` gains `"default-off"` for the never-configured OFF state (pass `actOrAnswerIsDefault(config)` as `resolveActOrAnswer`'s new fourth argument), distinct from an explicit `false`. Native function calls the resolver reports as dialect `"none"` are now recorded as `native-fc`, so `metadata.lastDialectObserved` is correct. No behavior change.
