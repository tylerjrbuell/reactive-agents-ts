---
type: experiment
status: complete
created: 2026-11-04
tags: [harness, h3, plan-execute, d9, delivery-gate, regression-check]
---

# D9 close: full H3 rerun (2026-11-04)

Full H3 suite (12 tasks, k=5, qwen3:4b + cogito:8b, cell timeout 150 s) on `dev` at `6bd65164d`, after D9 P1-P7, the envelope cap fix (`f57e71617`) and the strategy-neutral stream. Before = `2026-11-04-h3-baseline`. Results: `results-qwen3-4b.json`, `results-cogito-8b.json`. Ledger entry 14 (`--reason harness:completeness-blind --mechanism strategy_delivery_gate`).

| | Before | After |
|---|---|---|
| Pass, both tiers | 58/120 | 56/120 (-2pp, within noise) |
| qwen3:4b pass | 37/60 | 35/60 |
| cogito:8b pass | 21/60 | 21/60 |
| `harness:completeness-blind` | 6 | **0** |
| `harness:evidence-truncated` | 8 | 1 (prior-results fix, landed after the baseline) |
| `harness:tool-call-corrupted` | 5 | 9 (cogito only) |
| `harness:false-veto` | 3 | 6 |
| `harness:tool-call-dropped` | 1 | 2 |
| `strategy_delivery_gate` fired | 0/120 | 10/120 |

Decision: **SHIFTED**. The D9 target reason is gone on both tiers and pass did not move outside noise. No default-path regression is claimed or excluded at n=5 per cell (gaps under 26pp are noise).

## Remaining harness reasons (18 runs)

- **`tool-call-corrupted` (9, cogito only):** rw-6 x3, rw-7 x3, h3-todo-heavy x2, rw-9 x1. Text-parsed call arguments are mangled. The baseline had 5 on 5 different tasks; 5 to 9 on one tier is inside run-to-run spread for a Bernoulli cell, but it is now the top harness reason. Owner: tool-call extraction P2 (one parser, one argument grammar).
- **`false-veto` (6):** rw-6 x3 (pre-existing, both tiers), h3-plan-only qwen x1, h3-exact-value cogito x2. The cogito exact-value runs were graded solved, then `stall_deliverable` fired at `consecutiveStalled 4/4` with 2 artifacts written, and the runtime vetoed on `outstanding-criteria`. That is the B5 shape: stall accounting counts non-progress turns after the work is done.
- **`tool-call-dropped` (2), `evidence-truncated` (1):** single runs, no pattern yet.

## Next

1. Tool-call extraction P2 (top harness reason, single-tier).
2. B5: meta and post-work churn never accrue stall; stall after delivered artifacts proposes to the exit gate rather than ending the run as a failure.
3. rw-6 false-veto (standing since the baseline).
