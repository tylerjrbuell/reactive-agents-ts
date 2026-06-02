---
title: Assembly A/B Grid (hardened, N=3, cross-tier) — FLIP verdict
date: 2026-05-31
branch: overhaul/agentic-core-2026-05-31
harness: apps/examples/assembly-ab-grid.sh + section-coverage-grade.ts
verdict: FLIP JUSTIFIED — project() (arm1) clears the no-regression bar decisively
---

# Assembly A/B Grid (hardened) — RA_ASSEMBLY project() vs legacy curate()

N=3, 2 tiers (local qwen3.5:latest, mid claude-haiku-4-5), 2 tasks (compact MCP
list_commits; overflow 57k AGENTS.md fixture summarize), 2 arms (RA_ASSEMBLY 0/1).
24 cells. Faithfulness graded IN-GRID via section-coverage (22 sections) on a
per-cell deliverable snapshot (both prior instrumentation gaps — stale `summref`
grep + no deliverable snapshot — closed before this run).

## Results

### Faithfulness (section-coverage, overflow task)
| cell | legacy asm0 | project asm1 |
|---|---|---|
| local overflow | r1 **FAIL** (90635 tok, max_iterations), 0.91, 0.82 | **1.0 / 1.0 / 1.0** |
| mid overflow | 0.91 / 0.86 / 0.91 (mean 0.89) | **1.0 / 1.0 / 1.0** |

arm1 is deterministic 22/22 both tiers (pure projection → identical heading-skeleton
preview every run). Legacy: variance + one hard runaway. **The Phase-4 mid-overflow
regression that blocked the cutover (was 0/2 faithful) is gone — now 1.0.**

### Tokens (mean)
| cell | legacy asm0 | project asm1 | delta |
|---|---|---|---|
| local compact | 25041 | 10669 | **−57%** |
| local overflow | 45-90k (1 fail) | 17759 | **~−3×** |
| mid compact | 10626 (goal=null) | 14764 (goal=true) | +39% |
| mid overflow | 4433 | 6184 (median 4621) | +40% mean / ~par median |

local: arm1 dramatically cheaper. mid: arm1 higher, but **confounded** — (a) meta-tool
choice differs per arm (`brief` vs `discover-tools`), (b) legacy mid terminates
`end_turn`/`goalAchieved:null` (spends less because it doesn't cleanly finish).
arm1's mid cost is partly completing what legacy leaves incomplete.

### Termination
arm1 = `final_answer_tool` every cell. legacy = `end_turn` + `goalAchieved:null`
coherence gaps on mid (the M7 output/status gap).

## Verdict — FLIP JUSTIFIED

No-regression bar cleared decisively: faithfulness up-or-tied every cell,
deterministic, rescues two legacy failure modes (local runaway, mid incompleteness).
Token picture confounded (not a clean overhead) and net-favorable on local.
Honesty-first criteria (faithfulness + robustness + termination) all green.

**Caveats (noted, not blockers):**
- mid token delta is confounded by meta-tool choice + legacy's incomplete baseline;
  a clean overhead measurement needs the meta-tool variable pinned. #8 (KV-cache) +
  meta-tool tuning address mid cost later.
- haiku window capped at 32768 (`from-kernel-state.ts:112`, real 200k) so mid
  overflow fires because of the cap; conservative (more overflow testing), and arm1
  wins even so. The window-source fix is #5 and only REDUCES overflow frequency.
- N=3, single fixture; the structural win (determinism + failure-rescue) is robust
  to sample size — it is a mechanism property, not a sampling artifact.

## Action
FLIP `RA_ASSEMBLY` default-on (reactive seam) + delete legacy `curate()` (1 caller,
`think.ts:353`). Both kernel/** → kernel-warden. Next per the critical-path doc:
**#7 post-conditions default-on** (the capability reconnection).
