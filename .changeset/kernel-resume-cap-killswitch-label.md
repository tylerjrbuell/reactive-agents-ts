---
"@reactive-agents/reasoning": patch
---

Resumed runs honor the `extraIterations` bound over an explicit `maxIterations`. Compose `timeoutAfter`, `watchdog` and `requireApprovalFor` stops report `terminatedBy: "guard_stop"` and name the killswitch in the failure cause instead of the budget sentence.
