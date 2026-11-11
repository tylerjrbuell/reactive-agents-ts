---
type: ablation-predictions
status: frozen
created: 2026-11-10
tags: [ablation, stable-tool-list, predictions]
---

# Predictions (written before the first measured cell)

Smoke runs (scratchpad, not counted) showed: with `toolIndex` on, hidden tools are promoted onto the wire, so on `wide-metric` both arms ship ~40 tool schemas while `visible` is 11-13. The shipped list, not `visible`, is the cost surface.

1. **H3 suite (1-4 builtins per task).** Accuracy: no resolvable difference on either tier. Billed tokens: stl within ±10 % of base (recall listed from turn 0 adds one small schema).
2. **wide-metric (40 tools).** Shipped-list changes within a run: base ≥1 per run (recall shown/hidden), stl 0. Tokens: within ±10 %. Accuracy: no difference.
3. **umami-explore (20 tools, open-ended).** Shipped-list changes: base > 0, stl 0. Accuracy: no resolvable difference; dominated by the verifier and the open-ended stop.
4. **Gate.** OPT-IN (no tier reaches +3 pp at 95 %). A REJECT would need a resolvable regression; not expected.
5. **Not-ready refusals.** Rare (< 1 per run): recall is the only floored meta tool on these surfaces.
6. **Answer turn.** Fires in < 20 % of runs; most runs end on `end_turn`.
