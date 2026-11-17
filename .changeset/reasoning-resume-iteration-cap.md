---
"@reactive-agents/reasoning": patch
---

A resumed run now honors the raised per-run iteration cap. When a run resumes from a saved kernel state and the runtime's resume cap is higher than the strategy's resolved cap, the loop uses the resume cap, even over an explicit `withMaxIterations` cap. Before, a Continued run kept the old threshold and stopped at the same limit. Runs that are not resumed are unchanged.
