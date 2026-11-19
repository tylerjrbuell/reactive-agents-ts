---
"@reactive-agents/reasoning": patch
---

The kernel now honors a calibration mode. `KernelInput.calibrationMode` (`"auto"` default, or `"skip"`) reaches `selectAdapter` at the run-start profile merge and in the act and think phases, so a `"skip"` run applies no shipped model calibration (no `optimalToolResultChars` override, no calibrated adapter hooks). Runs that do not set it are unchanged. Each run with a provider also records one `capability-resolved` guard event (provider, model, source, tier, `recommendedNumCtx`, `supportsThinkingMode`).
