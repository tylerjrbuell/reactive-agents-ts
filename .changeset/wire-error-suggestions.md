---
"@reactive-agents/runtime": patch
---

Fixed — `agent.run()` errors now include a remediation suggestion

Errors thrown from `agent.run()`, `resumeRun()`, `approveRun()`, and
`denyRun()` now carry a one-line "→ suggestion" for known error types
(e.g. `BudgetExceededError` → "wire `.withCostTracking()`"). The helper
that builds this already existed but was never actually called from any
`agent.run()` catch path, so no user ever saw it.
