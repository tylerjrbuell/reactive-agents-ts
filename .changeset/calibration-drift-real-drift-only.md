---
"@reactive-agents/reactive-intelligence": patch
"@reactive-agents/reasoning": patch
---

`CalibrationDrift` is published only for real drift. The kernel used to publish it on every iteration of every run once a model's stored drift flag was set, with `deviationSigma: 0` and `expectedMean === observedMean`, so every observer had to filter it out. Now only the reactive-intelligence calibration subscriber publishes it, once per task. It fires when the model's history flags drift and that run's own scores show it: at least `CALIBRATION_DRIFT_MIN_SAMPLES` (10) scores, with the recent-window mean at least `CALIBRATION_DRIFT_MIN_SIGMA` (1σ) above the run mean. `measureRunDrift` and `isMeaningfulDrift` are exported.
