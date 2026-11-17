---
"@reactive-agents/runtime": patch
---

Agent configs now carry calibration. `toConfig()` emits `calibration: { mode, learned?, community? }` for an agent built with `.withCalibration("auto" | "skip", options)`, and `agentConfigToBuilder()` / `agentConfigToSource()` apply it with `.withCalibration(mode, { learned, community })`. Before, the round trip dropped the call, so an agent reloaded from config ran with learned and community calibration off. A `ModelCalibration` object passed to `.withCalibration()` is still code-only and is not serialized. An agent that never calls `.withCalibration()` produces the same config as before.
