---
"@reactive-agents/cortex": patch
---

Cortex shows opt-in calibration truthfully. The model page labels learned values as applied only when learned calibration is on, and no longer claims a community profile is on by default. The Builder (and the chat quick config) has Learned calibration and Community calibration switches under Reliability, off by default, which write `.withCalibration("auto", { learned, community })`.
