---
"@reactive-agents/llm-provider": patch
---

`calibration-runner.ts --commit` now merges probe results into the existing calibration JSON instead of overwriting it. Probe-measured fields are replaced. Fields the probes do not measure (`actOrAnswer`, `classifierReliability`, alias maps) are kept; before this change they were silently deleted. New flags: `--probes <field,...>` runs a subset, and `--probe-timeout <seconds>` cancels a probe that runs too long and leaves its field unmeasured. Per-probe progress is printed to stderr. Together these let a large model be calibrated across several invocations. A partial measurement keeps the file's `probeVersion`/`calibratedAt`/`runsAveraged`, so a file is never stamped with a probe version that some of its fields were not measured at. New exports from the runner module: `measureCalibration` and `commitCalibration`.
