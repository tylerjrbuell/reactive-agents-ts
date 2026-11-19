---
"@reactive-agents/runtime": patch
---

`run-started.config.calibration` now records the calibration a run resolved: mode (`auto`, `skip`, `custom`, `unresolved`), the tiers that contributed, the probe version, and each field's value with its source (`shipped`, `community`, `learned`, `default`, `custom`). The `◉ [calibration]` completion line reports the true sources (it used to always say prior, plus local when observations existed) and includes the tool-call dialect. Observability only; no behavior change.
