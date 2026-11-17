---
"@reactive-agents/cortex": patch
---

Cortex finds a chat's or agent's durable run store through the framework's `defaultDurableRunsDir`, so `REACTIVE_AGENTS_RUNS_DIR` applies to Continue and crash recovery as it does to the writer. A saved `durableRuns.dir` or `checkpointEvery` is kept even when `enabled` is absent (absent still means on).
