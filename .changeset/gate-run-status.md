---
"@reactive-agents/benchmarks": patch
---

The lift gate now rejects a candidate whose runs end non-success (`run-completed.status`) at least 25pp and 2 runs more often than baseline, even when accuracy is flat, and also when a single task flips from near 0 to all-or-nearly-all runs non-success (per task, k>=3, vs that task's own baseline; the receipt names the tasks); `runSession` records `RunScore.endStatus` from the trace and the receipt prints the status read and the billed-token ratio per run. The H3 runner labels run causes in process with `analyzeCause` instead of spawning the CLI, so a healthy trace no longer prints `cause=parse-failed`.
