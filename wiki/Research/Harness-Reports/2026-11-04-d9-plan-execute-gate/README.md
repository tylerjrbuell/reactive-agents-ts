---
type: experiment
status: complete
created: 2026-11-04
tags: [harness, h3, plan-execute, d9, delivery-gate]
---

# D9: plan-execute on the shared delivery gate (H3, 2026-11-04)

Plan: `wiki/Planning/Implementation-Plans/2026-11-04-d9-plan-execute-shared-gate.md`. Commits `75285453e` (P1), `47811d31a` (P2), `26d2299c6` (P3), `cf1787a9d` (P4). Cells: `h3-plan-only` (target) and `rw-3` (the other H3 task that runs plan-execute), k=5, before = `2026-11-04-h3-baseline`.

| Tier | Decision | Target reason | Pass (2 tasks) | Gate fired |
|---|---|---|---|---|
| qwen3:4b | SHIFTED | completeness-blind 6 to 0 | 0/10 to 3/10 (h3-plan-only 3/5) | 1/10 (block 1, terminate 1) |
| cogito:8b | INERT | absent in the baseline cells | 0/10 to 0/10 | 0/10 |

Both tiers: plan-execute runs now show `requirement:*` activity (10/10, was 0/10): the contract is compiled at plan level. No harness reason remains on cogito (9 model:had-evidence-wrong-output, 1 unattributed). rw-3 stays 0/5 on both tiers, all model-attributed (same as after the prior-results fix).

## Why SHIFTED, not FIXED: harness:false-veto 0 to 2 (qwen h3-plan-only run3, run4)

Both runs passed the hidden check (score 1.0), and the plan-level delivery verdict accepted them (`delivery verified (5/5 conditions met)`). They still ended `status: partial`, `outcome.success: false` (the runtime tolerated them as `partial-substantive-output`). The cap is not the new gate. It is plan-execute's `deriveTerminalOutcome` (`strategies/plan-execute/terminal-outcome.ts`): `capStatusToEnvelope("completed", subKernelEnvelope)` downgrades the plan to `partial` whenever any composite step's sub-kernel ended non-completed. In run3 a step's `file-write` failed once and a retry succeeded. The envelope carried no honesty marker (no warning, no harness-authored output, no budget stop).

This cap predates D9; the baseline cells never passed, so it was invisible. It is a general defect: a step-local status outranks the plan-level verdict on the plan's own deliverables, the inverse of the step-scope exemption (`deliveryScope: "step"`).

Second gap (instrument): the trace does not record why the plan was capped. The sub-kernel's terminal status and reason never reach the run trace.

## Next

1. Fold the envelope cap into the shared mint: a step envelope `partial` with no honesty marker does not cap a plan whose delivery verdict accepted deterministic conditions; honesty markers (budget, harness-authored output, abstention, warning) still cap. This also retires plan-execute's own status derivation (the per-strategy logic the plan lists as remaining).
2. Trace the cap: name the capping step and its reason on the terminal decision.
3. Re-run `h3-plan-only` both tiers; expect false-veto 2 to 0.

Correctness rule (no regression) holds on both tiers. The lift rule is not met (one tier; +30pp at n=5 is within noise).
