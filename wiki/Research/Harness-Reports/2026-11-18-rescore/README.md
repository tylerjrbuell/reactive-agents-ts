---
type: harness-report
status: complete
created: 2026-11-18
tags: [measurement-overhaul, scorer-version, rescore, h3]
---

# Rescore of saved H3 data: scorers v1 (old) vs v2 (new)

Measurement overhaul items 0.5 and 0.6. Owner approved the comparability break: results carry `scorerVersion` (`packages/benchmarks/src/scorer-version.ts`, `SCORER_VERSION = 2`); files without it are v1. **Old** is the accuracy the file recorded; **new** is the same cell re-graded from its own trace (`rescore.ts`, zero tokens, no live run). Both are published; a v1 number and a v2 number are not comparable cell-for-cell with files of the other version.

What changed in v2: (1) rw-3 groundedness, outlier and performance checks must be about Engineering (no stray "40%"); (2) abstention on a solvable task no longer zeroes accuracy (accuracy is the task's own check, premature abstention is a separate check); (3) a trap task credits an honest decline that ended `dispatcher-early-stop` by text + tool provenance, with the `abstained` rail kept as its own check.

Cells: 684 total; 634 unchanged, 31 changed, 0 reconstruction mismatches (task scorer unchanged, regrade != recorded: old kept, excluded), 0 no trace on disk or regrade failed, 19 not measured (timeout or error), 0 unknown task.

### 2026-11-13-recent-default-harness-ablation/a-only.json

Cells 6, rescored 6, changed 0. Overall mean old 1.000 -> new 1.000.

No per-task change.

### 2026-11-13-recent-default-harness-ablation/base.json

Cells 72, rescored 71, changed 6. Overall mean old 0.742 -> new 0.782.

| task | tier | cells | old mean | new mean | delta | changed | recon-mismatch | not rescored |
|---|---|---|---|---|---|---|---|---|
| rw-3 | qwen3:4b | 6 | 0.639 | 0.750 | 0.111 | 3 | 0 | 0 |
| rw-6 | qwen3:4b | 6 | 0.452 | 0.810 | 0.357 | 3 | 0 | 0 |

### 2026-11-13-recent-default-harness-ablation/fix-head.json

Cells 72, rescored 72, changed 5. Overall mean old 0.778 -> new 0.790.

| task | tier | cells | old mean | new mean | delta | changed | recon-mismatch | not rescored |
|---|---|---|---|---|---|---|---|---|
| rw-3 | qwen3:4b | 6 | 0.611 | 0.750 | 0.139 | 5 | 0 | 0 |

### 2026-11-13-recent-default-harness-ablation/fix2-head.json

Cells 72, rescored 72, changed 4. Overall mean old 0.755 -> new 0.772.

| task | tier | cells | old mean | new mean | delta | changed | recon-mismatch | not rescored |
|---|---|---|---|---|---|---|---|---|
| rw-3 | qwen3:4b | 6 | 0.639 | 0.722 | 0.083 | 3 | 0 | 0 |
| rw-6 | qwen3:4b | 6 | 0.786 | 0.905 | 0.119 | 1 | 0 | 0 |

### 2026-11-13-recent-default-harness-ablation/head.json

Cells 72, rescored 72, changed 4. Overall mean old 0.762 -> new 0.779.

| task | tier | cells | old mean | new mean | delta | changed | recon-mismatch | not rescored |
|---|---|---|---|---|---|---|---|---|
| rw-3 | qwen3:4b | 6 | 0.639 | 0.722 | 0.083 | 3 | 0 | 0 |
| rw-6 | qwen3:4b | 6 | 0.810 | 0.929 | 0.119 | 1 | 0 | 0 |

### 2026-11-18-h3-v0.19-final/final-cogito-8b.json

Cells 60, rescored 60, changed 6. Overall mean old 0.723 -> new 0.735.

| task | tier | cells | old mean | new mean | delta | changed | recon-mismatch | not rescored |
|---|---|---|---|---|---|---|---|---|
| rw-3 | cogito:8b | 5 | 0.867 | 0.733 | -0.133 | 4 | 0 | 0 |
| rw-6 | cogito:8b | 5 | 0.571 | 0.857 | 0.286 | 2 | 0 | 0 |

### 2026-11-18-h3-v0.19-final/final-qwen3-4b.json

Cells 60, rescored 55, changed 0. Overall mean old 0.921 -> new 0.921.

No per-task change.

### 2026-11-18-h3-v0.19-final/lft/lft-h3-gemma4_e4b.json

Cells 5, rescored 5, changed 0. Overall mean old 0.600 -> new 0.600.

No per-task change.

### 2026-11-18-h3-v0.19-final/lft/off-h3-gemma4_e4b.json

Cells 5, rescored 5, changed 0. Overall mean old 1.000 -> new 1.000.

No per-task change.

### 2026-11-18-h3-v0.19-final/rerun-cogito-8b.json

Cells 60, rescored 60, changed 4. Overall mean old 0.747 -> new 0.751.

| task | tier | cells | old mean | new mean | delta | changed | recon-mismatch | not rescored |
|---|---|---|---|---|---|---|---|---|
| rw-3 | cogito:8b | 5 | 0.933 | 0.833 | -0.100 | 3 | 0 | 0 |
| rw-6 | cogito:8b | 5 | 0.800 | 0.943 | 0.143 | 1 | 0 | 0 |

### 2026-11-18-h3-v0.19-final/rerun-qwen3-4b.json

Cells 60, rescored 57, changed 2. Overall mean old 0.907 -> new 0.896.

| task | tier | cells | old mean | new mean | delta | changed | recon-mismatch | not rescored |
|---|---|---|---|---|---|---|---|---|
| rw-3 | qwen3:4b | 5 | 0.833 | 0.700 | -0.133 | 2 | 0 | 0 |

### 2026-11-18-v0.19-regression-check/dev-cogito-8b.json

Cells 35, rescored 33, changed 0. Overall mean old 0.803 -> new 0.803.

No per-task change.

### 2026-11-18-v0.19-regression-check/dev-qwen3-4b.json

Cells 35, rescored 30, changed 0. Overall mean old 1.000 -> new 1.000.

No per-task change.

### 2026-11-18-v0.19-regression-check/v018-cogito-8b.json

Cells 35, rescored 34, changed 0. Overall mean old 0.755 -> new 0.755.

No per-task change.

### 2026-11-18-v0.19-regression-check/v018-qwen3-4b.json

Cells 35, rescored 33, changed 0. Overall mean old 1.000 -> new 1.000.

No per-task change.

## Changed cells

| file | task | tier | run | terminatedBy | old | new | failed checks (new) |
|---|---|---|---|---|---|---|---|
| 2026-11-13-recent-default-harness-ablation/base.json | rw-6 | cogito:8b | 0 | abstained | 0.000 | 0.714 | optimization-report.md exists and is substantive; report reasons about asymptotic complexity (n log n); premature abstention (reported separately; accuracy is the task's own check) |
| 2026-11-13-recent-default-harness-ablation/base.json | rw-3 | qwen3:4b | 1 | final_answer | 0.667 | 1.000 |  |
| 2026-11-13-recent-default-harness-ablation/base.json | rw-6 | cogito:8b | 1 | abstained | 0.000 | 0.714 | optimization-report.md exists and is substantive; report reasons about asymptotic complexity (n log n); premature abstention (reported separately; accuracy is the task's own check) |
| 2026-11-13-recent-default-harness-ablation/base.json | rw-3 | qwen3:4b | 2 | loop_detected:all_tools_called | 0.333 | 0.500 | presents data in a structured form; salary claim is grounded in the data; gives a concrete recommendation |
| 2026-11-13-recent-default-harness-ablation/base.json | rw-3 | cogito:8b | 2 | final_answer | 0.667 | 0.833 | salary claim is grounded in the data |
| 2026-11-13-recent-default-harness-ablation/base.json | rw-6 | cogito:8b | 2 | abstained | 0.000 | 0.714 | optimization-report.md exists and is substantive; report reasons about asymptotic complexity (n log n); premature abstention (reported separately; accuracy is the task's own check) |
| 2026-11-13-recent-default-harness-ablation/fix-head.json | rw-3 | qwen3:4b | 0 | final_answer | 0.667 | 0.833 | connects salary to the performance dimension |
| 2026-11-13-recent-default-harness-ablation/fix-head.json | rw-3 | cogito:8b | 0 | final_answer | 0.667 | 0.833 | salary claim is grounded in the data |
| 2026-11-13-recent-default-harness-ablation/fix-head.json | rw-3 | qwen3:4b | 1 | loop_detected:all_tools_called | 0.333 | 0.500 | presents data in a structured form; salary claim is grounded in the data; gives a concrete recommendation |
| 2026-11-13-recent-default-harness-ablation/fix-head.json | rw-3 | qwen3:4b | 2 | final_answer | 0.667 | 0.833 | salary claim is grounded in the data |
| 2026-11-13-recent-default-harness-ablation/fix-head.json | rw-3 | cogito:8b | 2 | final_answer | 0.667 | 0.833 | salary claim is grounded in the data |
| 2026-11-13-recent-default-harness-ablation/fix2-head.json | rw-3 | qwen3:4b | 1 | final_answer | 0.667 | 0.833 | salary claim is grounded in the data |
| 2026-11-13-recent-default-harness-ablation/fix2-head.json | rw-3 | cogito:8b | 1 | loop_detected:all_tools_called | 0.333 | 0.500 | presents data in a structured form; salary claim is grounded in the data; gives a concrete recommendation |
| 2026-11-13-recent-default-harness-ablation/fix2-head.json | rw-6 | cogito:8b | 1 | abstained | 0.000 | 0.714 | optimization-report.md exists and is substantive; report reasons about asymptotic complexity (n log n); premature abstention (reported separately; accuracy is the task's own check) |
| 2026-11-13-recent-default-harness-ablation/fix2-head.json | rw-3 | cogito:8b | 2 | final_answer | 0.667 | 0.833 | salary claim is grounded in the data |
| 2026-11-13-recent-default-harness-ablation/head.json | rw-3 | qwen3:4b | 0 | final_answer | 0.667 | 0.833 | connects salary to the performance dimension |
| 2026-11-13-recent-default-harness-ablation/head.json | rw-6 | cogito:8b | 0 | abstained | 0.000 | 0.714 | optimization-report.md exists and is substantive; report reasons about asymptotic complexity (n log n); premature abstention (reported separately; accuracy is the task's own check) |
| 2026-11-13-recent-default-harness-ablation/head.json | rw-3 | qwen3:4b | 1 | final_answer | 0.667 | 0.833 | connects salary to the performance dimension |
| 2026-11-13-recent-default-harness-ablation/head.json | rw-3 | cogito:8b | 1 | loop_detected:all_tools_called | 0.333 | 0.500 | presents data in a structured form; salary claim is grounded in the data; gives a concrete recommendation |
| 2026-11-18-h3-v0.19-final/final-cogito-8b.json | rw-3 | cogito:8b | 0 | final_answer | 0.833 | 0.667 | salary claim is grounded in the data; connects salary to the performance dimension |
| 2026-11-18-h3-v0.19-final/final-cogito-8b.json | rw-3 | cogito:8b | 2 | final_answer | 1.000 | 0.833 | connects salary to the performance dimension |
| 2026-11-18-h3-v0.19-final/final-cogito-8b.json | rw-6 | cogito:8b | 2 | abstained | 0.000 | 0.714 | optimization-report.md exists and is substantive; report reasons about asymptotic complexity (n log n); premature abstention (reported separately; accuracy is the task's own check) |
| 2026-11-18-h3-v0.19-final/final-cogito-8b.json | rw-3 | cogito:8b | 3 | final_answer | 0.833 | 0.667 | salary claim is grounded in the data; connects salary to the performance dimension |
| 2026-11-18-h3-v0.19-final/final-cogito-8b.json | rw-6 | cogito:8b | 3 | abstained | 0.000 | 0.714 | optimization-report.md exists and is substantive; report reasons about asymptotic complexity (n log n); premature abstention (reported separately; accuracy is the task's own check) |
| 2026-11-18-h3-v0.19-final/final-cogito-8b.json | rw-3 | cogito:8b | 4 | final_answer | 0.833 | 0.667 | salary claim is grounded in the data; connects salary to the performance dimension |
| 2026-11-18-h3-v0.19-final/rerun-cogito-8b.json | rw-3 | cogito:8b | 0 | final_answer | 0.833 | 0.667 | salary claim is grounded in the data; connects salary to the performance dimension |
| 2026-11-18-h3-v0.19-final/rerun-cogito-8b.json | rw-3 | cogito:8b | 1 | final_answer | 1.000 | 0.833 | connects salary to the performance dimension |
| 2026-11-18-h3-v0.19-final/rerun-cogito-8b.json | rw-6 | cogito:8b | 1 | abstained | 0.000 | 0.714 | optimization-report.md exists and is substantive; report reasons about asymptotic complexity (n log n); premature abstention (reported separately; accuracy is the task's own check) |
| 2026-11-18-h3-v0.19-final/rerun-cogito-8b.json | rw-3 | cogito:8b | 4 | final_answer | 1.000 | 0.833 | connects salary to the performance dimension |
| 2026-11-18-h3-v0.19-final/rerun-qwen3-4b.json | rw-3 | qwen3:4b | 1 | final_answer | 0.833 | 0.500 | surfaces Engineering as the outlier department; salary claim is grounded in the data; connects salary to the performance dimension |
| 2026-11-18-h3-v0.19-final/rerun-qwen3-4b.json | rw-3 | qwen3:4b | 2 | final_answer | 0.833 | 0.500 | surfaces Engineering as the outlier department; salary claim is grounded in the data; connects salary to the performance dimension |

## Not rescored

- Files skipped (no per-cell accuracy, no H3 task, or already v2): 2026-11-16-plan-posture-ablations/raw/head-D-direct-cogito_14b.json, 2026-11-16-plan-posture-ablations/raw/head-D-direct-qwen3_latest.json, 2026-11-16-plan-posture-ablations/raw/head-D-plan-cogito_14b.json, 2026-11-16-plan-posture-ablations/raw/head-D-plan-qwen3_latest.json, 2026-11-16-plan-posture-ablations/raw/head-D-strategy_blueprint-cogito_14b.json, 2026-11-16-plan-posture-ablations/raw/head-D-strategy_blueprint-qwen3_latest.json, 2026-11-16-plan-posture-ablations/raw/head-D-strategy_plan-execute-reflect-cogito_14b.json, 2026-11-16-plan-posture-ablations/raw/head-D-strategy_plan-execute-reflect-qwen3_latest.json, 2026-11-16-plan-posture-ablations/raw/head-D@4-plan-cogito_14b.json, 2026-11-16-plan-posture-ablations/raw/head-D@4-plan-qwen3_latest.json, 2026-11-16-plan-posture-ablations/raw/head-answerTurn-plan-cogito_14b.json, 2026-11-16-plan-posture-ablations/raw/head-answerTurn-plan-qwen3_latest.json, 2026-11-16-plan-posture-ablations/raw/head-lean-plan-cogito_14b.json, 2026-11-16-plan-posture-ablations/raw/head-lean-plan-qwen3_latest.json, 2026-11-16-plan-posture-ablations/raw/head-nbWrapUp@4-plan-cogito_14b.json, 2026-11-16-plan-posture-ablations/raw/head-nbWrapUp@4-plan-qwen3_latest.json, 2026-11-16-plan-posture-ablations/raw/head-noBudget-plan-cogito_14b.json, 2026-11-16-plan-posture-ablations/raw/head-noBudget-plan-qwen3_latest.json, 2026-11-16-plan-posture-ablations/raw/head-noBudget@4-plan-cogito_14b.json, 2026-11-16-plan-posture-ablations/raw/head-noBudget@4-plan-qwen3_latest.json, 2026-11-16-plan-posture-ablations/raw/head-noCatalog-plan-cogito_14b.json, 2026-11-16-plan-posture-ablations/raw/head-noCatalog-plan-qwen3_latest.json, 2026-11-16-plan-posture-ablations/raw/head-recon-plan-cogito_14b.json, 2026-11-16-plan-posture-ablations/raw/head-recon-plan-qwen3_latest.json, 2026-11-16-plan-posture-ablations/raw/head-wrapUp-plan-cogito_14b.json, 2026-11-16-plan-posture-ablations/raw/head-wrapUp-plan-qwen3_latest.json, 2026-11-16-plan-posture-ablations/raw/head-wrapUp@4-plan-cogito_14b.json, 2026-11-16-plan-posture-ablations/raw/head-wrapUp@4-plan-qwen3_latest.json, 2026-11-16-plan-posture-ablations/raw/wt-D-plan-cogito_14b.json, 2026-11-16-plan-posture-ablations/raw/wt-D-plan-qwen3_latest.json, 2026-11-16-plan-posture-ablations/raw/wt-D-strategy_blueprint-cogito_14b.json, 2026-11-16-plan-posture-ablations/raw/wt-D-strategy_blueprint-qwen3_latest.json, 2026-11-16-plan-posture-ablations/raw/wt-D-strategy_plan-execute-reflect-cogito_14b.json, 2026-11-16-plan-posture-ablations/raw/wt-D-strategy_plan-execute-reflect-qwen3_latest.json.
- The lft gemma ab-trap-5 cells named in audit 03 are not rescorable: their traces are not on disk (the lft trace dirs hold h3-exact-value only), so the honest-decline credit shows only on cells whose traces survive.
