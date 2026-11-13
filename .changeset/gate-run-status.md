---
"@reactive-agents/benchmarks": patch
---

The lift gate now rejects a candidate whose runs end non-success (`run-completed.status`) at least 25pp and 2 runs more often than baseline, even when accuracy is flat; `runSession` records `RunScore.endStatus` from the trace and the receipt prints the status read and the billed-token ratio per run. The H3 runner labels run causes in process with `analyzeCause` instead of spawning the CLI, so a healthy trace no longer prints `cause=parse-failed`.
