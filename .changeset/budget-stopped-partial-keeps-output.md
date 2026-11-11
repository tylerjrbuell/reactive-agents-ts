---
"@reactive-agents/runtime": patch
---

Budget-stopped plan-execute and blueprint runs keep their completed step results. When a strategy stopped at the run budget, or shipped its joined step results because the final answer call failed, `result.output` was `""` and the work was lost. The output is now the joined step results, reported as a partial (`success: false`, `outcome.status: "partial"`) with the verification warning. Text the harness writes itself (the `harness_deliverable` terminal, such as "✓ Written to x.txt") is still never shipped as output.
