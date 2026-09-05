---
"@reactive-agents/reactive-intelligence": patch
"@reactive-agents/runtime": patch
---

Wire the Thompson Sampling bandit into the strategy-selector seam (opt-in, off by default) and fix the calibration-drift and calibration feedback loops, both previously fully dead. Add `NoticesManager` with a notice-suppression mechanism (`REACTIVE_AGENTS_SUPPRESS_NOTICES`) for quieting repeated one-time warnings.
