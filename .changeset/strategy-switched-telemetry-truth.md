---
"@reactive-agents/runtime": patch
---

Run telemetry `strategySwitched` now reads the run's recorded `StrategySwitched` history instead of the `strategyFallback` flag. A strategy body error is no longer reported as a strategy switch, and a real mid-run switch is now reported as one.
