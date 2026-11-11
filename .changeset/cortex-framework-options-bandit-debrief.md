---
"@reactive-agents/cortex": patch
---

Cortex: "All framework options" no longer duplicates curated controls (each builder section declares the AgentConfig paths it sets; pinned against the mapping) and now renders `reasoning.observationSummary`. The Model page shows what the strategy-choice bandit learned per task category (from the calibration database). Debriefs: the run view no longer points to a nonexistent Observability setting; it says debriefs need memory and links the run's config, and the Memory section has a "Debrief after each run" switch that maps to memory.
