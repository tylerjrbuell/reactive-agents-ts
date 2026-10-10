---
"@reactive-agents/reasoning": patch
---

Entropy-observer failures are now published as `ErrorSwallowed` events instead of vanishing silently. All eight bare swallow sites in the reactive observer, including the entropy-sensor scoring path that silently degraded the Reactive Controller and calibration/drift detection, route through `emitErrorSwallowed`. The never-error, not-fatal semantics are unchanged: the helper never throws and no-ops without an ambient `EventBus`.
