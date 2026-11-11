---
"@reactive-agents/reactive-intelligence": patch
---

The strategy bandit now rewards a strategy only when its run succeeds. The reward used to be low mean entropy, so a strategy that failed confidently counted as a win and "best strategy" meant "most confident". `partial` and `failure` runs now count as losses; entropy still feeds calibration. Arm stats persisted under the old rule load unchanged and keep accumulating. New export: `banditReward(outcome)`.

`readBanditArmStats(dbPath)` now opens the DB read-only. It no longer creates the file, the `bandit_arms` table or the WAL pragma, and returns an empty list when the file or table is absent.
