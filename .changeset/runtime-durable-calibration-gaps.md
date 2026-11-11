---
"@reactive-agents/runtime": patch
---

Durable run stores no longer leak SQLite handles: `RunStoreLive` is now a scoped layer that closes its database when the providing effect ends, so `listDurableRuns`, `agent.listRuns()`, the run journal and checkpoint writes no longer leave one open file per call in a long-running host. New `defaultDurableRunsDir(agentId)` export is the one resolver for the default durable directory (`~/.reactive-agents/<agentId>`); the framework's write and resume paths use it.

Calibration: new `resolveModelCalibrationWithProvenance(modelId)` returns the calibration plus the source of each field (`"shipped"`, `"community"`, `"learned"`, `"default"`). Models with no shipped calibration now learn too: once 5 local runs are recorded they resolve to the framework defaults plus the learned fields, where before they resolved to no calibration. Values for calibrated models are unchanged.

`AgentConfig.reactiveIntelligence` now carries the data options of `.withReactiveIntelligence({...})` (entropy, controller, learning, telemetry, notice, models, calibrationDbPath), so `toConfig()` and `agentConfigToBuilder()` round-trip them instead of keeping only `enabled`.
