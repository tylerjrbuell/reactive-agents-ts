---
"@reactive-agents/trace": minor
"@reactive-agents/diagnose": minor
---

Deterministic failure-cause classifier. `analyzeCause(trace)` (new, `@reactive-agents/trace`) returns a closed-union `cause` with `confidence` (`decisive` | `probable` | `insufficient-trace`), supporting `evidence` (`eventKind`, `seq`, `detail`) and the `missing` trace signals that would have made it decisive, using ordered trace-only rules (provider error, abort sentinel, undisclosed terminal mislabel, plan-posture veto, never-engaged, tool failure, stall/loop after work, verifier reject, budget/cap, residual). It never reads model text and returns `insufficient-trace` instead of guessing on legacy traces. `RunAnalysis.cause` is added additively; `analyzeRun` now labels runs with a `run-aborted` sentinel and no `run-completed` as `aborted` (was `honest-failure`) and reports `overlap-storm` on a successful run only when a storm iteration contains a terminating guard. `tallyCauses` aggregates a cohort. New CLI: `rax-diagnose cause <runId|path>` and `rax-diagnose cause --all [dir] [--real]`.
