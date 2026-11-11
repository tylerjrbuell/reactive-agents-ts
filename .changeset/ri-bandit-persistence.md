---
"@reactive-agents/reactive-intelligence": minor
---

Strategy-selection learning now persists. The bandit's arm stats are stored in the calibration DB file (`calibrationDbPath`, table `bandit_arms`), so they survive process restarts whenever calibration does; `":memory:"` keeps both per-process as before. New read API: `BanditStore#listArmStats({ modelId?, taskCategory? })` and `readBanditArmStats(dbPath, filter?)` list arm stats per model and task category with posterior mean reward and last update time.
