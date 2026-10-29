---
type: harness-report
status: complete
created: 2026-10-28
tags: [harness, todo, advisory-checklist, ablation, v5, cortex]
verdict: REWORK (stays opt-in; do not default-on)
---

# Todo guidance ablation (V5: M1 systemLine, M3-midrun reminder)

Plan ruling: `wiki/Planning/Implementation-Plans/2026-10-28-plan-and-goal-primitives.md` (V5). Prior diagnosis: [[2026-10-28-todo-status-compliance]].

## Setup

- Code pinned to a git worktree of `011087112` (`/tmp/ra-tg-pin`, own `bun install`); every cell logs `reasoningPath`/`toolsPath` and all resolve into the worktree. Another agent edits `todo.ts` concurrently, so the live tree was NOT used. A first 22-cell run on the live tree and a 120-cell run with a bad script path (all cell-timeouts) were discarded, not pooled.
- Option under test: `.withMetaTools({ enabled:true, todo:true, todoGuidance })`. Arms: A0 none; A1 `{systemLine}`; A2 `{reminder}`; A3 both. Aliases (M4) on in all arms (part of the commit).
- Tiers: cogito:14b, qwen3:14b (Ollama, sequential). gpt-4o-mini skipped (budget; local result already disqualifying). Strategy reactive, maxIterations 10, memory off.
- Tasks x n=5 per arm per tier (25 cells/arm/tier, 50 pooled): W1, W2 (web-search, Brave key present), N3 (3-step no tool), L4 (long sequential, 4 SKUs x 2 lookups), C5 (single-step control, 17x23).
- Primary metric "consistent": multi-step tasks only (20/arm/tier): >=1 successful `add` and 0 rows open at the end (replayed from `tool-call-end` trace events). Control: consistent = no todo use.
- Scripts/data: `wiki/Research/Prototypes/todo-guidance-probe-2026-10-28.ts`, `todo-guidance-matrix-2026-10-28.sh`, `wiki/Research/Harness-Reports/2026-10-28-todo-guidance-ablation.jsonl` (200 cells; 2 cell-timeouts at 240s counted as failures).

## Instrument check (done before reading outcomes)

- A1/A3: 50/50 cells contain the M1 line in the system prompt; A0/A2: 0/50. `toolSchemaNames` includes `todo` in all cells.
- Reminder text rendered: 6 cells (all A3, cogito); 0 in A2 (reminder requires todo already used, and A2 models never used it, so A2 is largely inert by construction).
- Parser limit: my row replay does not understand every cogito-invented alias (`mark`), so cogito row counts are approximate. Open rows were still plainly nonzero in the traces (e.g. add of 6 rows, 2 `done` calls). The 0% primary result does not depend on this.

## Results (multi-step cells n=20/arm/tier; Wilson 95% CI)

| Tier | Arm | Consistent | Used todo (multi) | Over-plan on control | Correct (all 25) | Tokens/run | Tok vs A0 | Valid todo calls |
|---|---|---|---|---|---|---|---|---|
| cogito:14b | A0 | 0/20 [0,16] | 1/20 | 0/5 | 15/25 | 1477 | 0% | 3/6 |
| cogito:14b | A1 | 0/20 [0,16] | 5/20 | 5/5 | 21/25 | 2938 | +99% | 23/32 |
| cogito:14b | A2 | 0/20 [0,16] | 0/20 | 2/5 | 15/25 | 1380 | -7% | 0/2 |
| cogito:14b | A3 | 0/20 [0,16] | 7/20 | 5/5 | 18/25 | 2097 | +42% | 22/39 |
| qwen3:14b | A0 | 0/20 [0,16] | 0/20 | 0/5 | 25/25 | 2688 | 0% | 0/0 |
| qwen3:14b | A1 | 0/20 [0,16] | 0/20 | 0/5 | 25/25 | 2579 | -4% | 0/0 |
| qwen3:14b | A2 | 0/20 [0,16] | 0/20 | 0/5 | 23/25 | 1370 | -49% | 0/0 |
| qwen3:14b | A3 | 1/20 [1,24] | 1/20 | 0/5 | 25/25 | 2838 | +6% | 6/6 |
| pooled | A1 | 0/40 | 5/40 | 5/10 | 46/50 | 2759 | +32% | |
| pooled | A3 | 1/40 | 8/40 | 5/10 | 43/50 | 2468 | +18% | |

(Token deltas are noisy: qwen3 A2 -49% is run-length variance, not a mechanism effect; A2 changed no request bytes in cells where todo was unused.)

Findings:
1. **No lift.** Primary metric is 0% in 7 of 8 tier-arm cells; the only hit is 1 qwen3 A3 N3 run (add x3, mark_done x3, 0 open). Lift vs A0 is at most +5pp on one tier with a CI spanning 1-24%; this is not distinguishable from noise.
2. **M1 moves usage on cogito, not quality.** Todo use rose 1/20 -> 5/20 (A1), 7/20 (A3), but none finished consistently: cogito mostly invents `mark`/`mark_done`/arbitrary action strings or add-then-two-dones then stops, leaving rows open. qwen3 ignores the line entirely (0/20 used in A1).
3. **Over-planning:** cogito uses todo on the single-step control 5/5 with the M1 line (and 2/5 in A2, where the reminder text is not shown, so this is run-to-run variance in A2 or an artifact).
4. **Correctness regression on the long-sequential task (cogito):** L4 5/5 correct (A0) -> 1/5 (A1) and 1/5 (A3); runs burn ~27 iterations and 8-12k tokens on todo bookkeeping. This is a correctness regression, not just overhead.
5. Offsetting, unexplained cogito gains in A1/A3 on C5 and N3 (A0 0/5 correct, runs abstained or truncated after 1 iteration; A1 5/5). Any system-prompt text change perturbs this behavior; it is not a todo-tracking effect and must not be read as lift.
6. **M3-midrun reminder (A2) is inert alone**: it fires only after todo has been used, and without M1 the models almost never use it. In A3 it rendered 6 times (cogito) with no observed repair of status (no arm reached consistency).

## Verdict (V5 rule): REWORK, mechanisms stay opt-in (default off)

- PASS needs >=2 tiers with >=3pp lift: 0 tiers show lift.
- Overhead: M1 +99% tokens on cogito (+32% pooled) exceeds the 30% REWORK line; A3 +42% on cogito.
- Correctness regression (cogito L4 5/5 -> 1/5) and over-planning (5/5 control) are independent disqualifiers.
- Tier divergence: cogito reacts (badly), qwen3 does not react.
- Caveats: n=5 per task cell, 25 per arm per tier (CIs above; meets V5 n=5 but cannot resolve 3pp); gpt-4o-mini/gpt-5-mini not run; web tasks gave 0 todo use in all but one cell; metric parser approximate for cogito aliases. Even so the direction (no lift, high cost) is consistent across 8 tier-arm cells, so INCONCLUSIVE would understate it.
- Cortex "behaves like Claude Code" remains unsupported for these tiers. The root defect is model tool-use quality for status updates (cogito invents actions; qwen3 never plans), which prompt text does not fix. Candidate for a separate cycle (not tested here): UI-side derivation of progress from tool-call events rather than model-driven todo calls. Not recommended to ship M1 default-on.

## Housekeeping

- Worktree `/tmp/ra-tg-pin` (detached at `011087112`) left in place; remove with `git worktree remove --force /tmp/ra-tg-pin` when no longer needed.
- No framework code edited.
