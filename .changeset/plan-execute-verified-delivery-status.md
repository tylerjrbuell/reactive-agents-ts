---
"@reactive-agents/reasoning": patch
---

A plan-execute run whose named files all verified no longer ends `partial` just because one plan step's own reasoning loop ended partial for no stated reason (for example, a write that failed once and then succeeded on retry). Steps are exempt from the plan's files, so the plan-level delivery check decides. A step that stopped on budget, abstained, failed, carried a verification warning or returned harness-written output still caps the plan. The decision is recorded as `statusCap` on the `terminal_decision` trace event.
