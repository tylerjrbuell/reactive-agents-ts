---
"@reactive-agents/llm-provider": patch
---

`selectAdapter` takes an optional 4th argument, the resolved calibration (`"auto"` default, `"skip"`, or a `ModelCalibration`). `"skip"` no longer loads the shipped calibration JSON, and an explicit calibration object wins over it. Adds `describeCapabilityResolution(cap)` and the `CapabilityResolution` type (source, tier, recommendedNumCtx, supportsThinkingMode) for tracing. Additive; callers that pass no 4th argument behave as before.
