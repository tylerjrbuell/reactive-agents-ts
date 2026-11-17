---
"@reactive-agents/runtime": minor
---

Learned and community calibration are now opt-in. With `calibration: "auto"` (the default when reasoning is on), a run resolves only the calibration shipped for its model. Opt in with `.withCalibration("auto", { learned: true, community: true })`:

- `learned`: once a model has 5 recorded runs on this machine, the observed behavior (parallel tool calls, tool-classifier reliability, act-or-answer forcing) overrides the shipped assumptions. This helps most for models with no shipped calibration. Runs are still recorded locally under `~/.reactive-agents/observations` when this is off, so turning it on later uses the history you already have. Nothing is uploaded.
- `community`: one GET request per model to the community profile endpoint (the model id is in the URL), cached on disk for 24 hours. `DO_NOT_TRACK=1` and `REACTIVE_AGENTS_TELEMETRY=0` still block the request.

**Breaking default:** before this change, both tiers were on with no option set. An agent that relied on learned values or the community profile now runs on the shipped calibration (or the generic defaults) until you opt in. The undocumented `reactiveIntelligenceOptions.communityCalibration: true` key still turns the community tier on. `resolveModelCalibration*` called directly still applies local observations unless `localObservations: false`.
