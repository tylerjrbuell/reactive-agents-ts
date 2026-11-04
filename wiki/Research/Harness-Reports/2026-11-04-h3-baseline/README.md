---
type: harness-report
status: complete
created: 2026-11-04
tags: [h3, baseline, attribution, mechanism-activity]
---
# H3 full baseline, 2026-11-04 (dev `7b2a6305b`)

12 tasks x k=5 x 2 tiers, cell timeout 150 s. Regression check for the day's default-path changes (exit-gate nudge before a no-material fail, `guard_stop`, bound template deliverables) and the new baseline for the improvement loop. Traces: `packages/benchmarks/benchmark-traces/h3-baseline-1104/` (local).

## Pass rate vs 2026-11-03

| Tier | 2026-11-03 | 2026-11-04 | Mean tokens |
|---|---|---|---|
| qwen3:4b | 39/60 (0.65, CI 0.52-0.76) | 37/60 (0.62, CI 0.49-0.73) | 7,099 → 7,772 (+9%) |
| cogito:8b | 17/60 (0.28, CI 0.19-0.41) | 21/60 (0.35, CI 0.24-0.48) | 3,705 → 3,837 (+4%) |

Both within noise: no regression. Per-task movement worth noting: cogito h3-exact-value 1/5 → 3/5, rw-9 2/5 → 3/5; qwen h3-plan-only 1/5 → 0/5.

## Attribution (`rax-diagnose attribute --all`)

| | qwen3:4b | cogito:8b |
|---|---|---|
| failed | 26 | 39 |
| harness | 12 | 11 |
| model | 4 | 26 |
| unattributed | 10 | 2 |

Harness reasons by task:

| Reason | Runs | Where |
|---|---|---|
| `harness:evidence-truncated` | 8 | rw-3 (both tiers): the report-writing turn saw a `file-read` result only as a compressed preview (`...43 more lines`) |
| `harness:completeness-blind` | 6 | h3-plan-only 4 (its 3 named files never reach the terminal gates: contract has them, the run-start seed does not), rw-3 2 |
| `harness:tool-call-corrupted` | 5 | cogito, 5 different tasks (text-parsed call arguments mangled) |
| `harness:false-veto` | 3 | rw-6 |
| `harness:tool-call-dropped` | 1 | h3-todo-heavy |

Model-side on cogito is dominated by `model:ignored-guidance` (14) and `model:had-evidence-wrong-output` (12). Per the standing rule (fix general harness gaps, not small-model quirks), those are probes, not targets.
