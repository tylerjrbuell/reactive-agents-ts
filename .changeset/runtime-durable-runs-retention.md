---
"@reactive-agents/runtime": minor
---

Durable runs now bound their own growth. `.withDurableRuns({ retention: { keepCompleted?, maxAgeDays?, compactCheckpoints? } })` prunes FINISHED runs at the start of each run: completed runs keep only their final checkpoint (and drop tool-effect rows), and completed runs beyond the newest 50 or older than 30 days are deleted (`0` disables a bound; `compactCheckpoints: false` keeps every iteration for `agent.fork()`). Resumable runs (stopped, paused, failed, awaiting approval or input, or running with a checkpoint) are never touched. Pruning is fail-soft: a failure never fails a run. `defaultDurableRunsDir` also honors `REACTIVE_AGENTS_RUNS_DIR`, a base directory that replaces `~/.reactive-agents` (explicit `durableRuns.dir` still wins), so tests and hosts can isolate durable stores.
