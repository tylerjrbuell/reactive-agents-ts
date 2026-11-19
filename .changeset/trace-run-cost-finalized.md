---
"@reactive-agents/trace": patch
"@reactive-agents/replay": patch
"@reactive-agents/diagnose": patch
---

Traces record a run's final billed cost and say when a cost total is partial.

- **trace:** a new `run-cost-finalized` event (`totalCostUsd`, `costComplete`) records the core `RunCostFinalized` event. It can arrive after `run-completed` (the background debrief call settles first), and the trace bridge appends it to the same run's trace file. `run-completed` gains an optional `costComplete`. A run whose publisher reported no cost now records `totalCostUsd: 0` with `costComplete: false` (unknown spend, not a measured $0). New `runCost(events)` reads a run's cost: the `run-cost-finalized` total when present, else `run-completed`'s, with its completeness. `renderRunCost` formats it, marking a partial total as `≥$X (partial: unpriced calls)`. `analyzeRun` exposes it as `cost.spend`, and the run report prints it. Traces recorded before these fields load unchanged; their completeness reads as unknown.
- **replay:** `TraceSnapshot` gains an optional `costComplete`, read through `runCost` (the finalized total first). An unknown cost is `0` with `costComplete: false`, not $0. `ReplayDiff.costPartial` is `true` when either side's cost is a lower bound. The replay LLM layer reports its deterministic $0 with `priceSource: "price-book"`.
- **diagnose:** `rax-diagnose replay` shows the run cost in the stats line and on the `run-end` line, and prints the `run-cost-finalized` record.
