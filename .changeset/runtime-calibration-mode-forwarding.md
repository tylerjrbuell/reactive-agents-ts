---
"@reactive-agents/runtime": patch
---

`.withCalibration("skip")` now reaches the reasoning request as `calibrationMode: "skip"` with no resolved calibration object (it was previously collapsed to unset). Other settings send `calibrationMode: "auto"` with the resolved value, so default runs are unchanged. `run-started.config.mechanisms.actOrAnswerSource` now reports `"default-off"` when act-or-answer was never configured, and `builder.calibration` records `"skip"`.
