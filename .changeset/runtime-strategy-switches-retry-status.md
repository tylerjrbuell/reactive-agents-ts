---
"@reactive-agents/runtime": minor
"reactive-agents": minor
---

Every strategy switch is now on the result, and a failed verification retry reports one status.

- **`metadata.strategySwitches`.** `AgentResult.metadata` and `StreamCompleted.metadata` now list every mid-run strategy switch, in order, as `{ from, to, iteration? }`. Before, only the last target was kept (as `strategyUsed`), so a UI could not show a run that went `plan-execute-reflect` → `reactive`. `strategyUsed` is unchanged: it is still the strategy that finished the run. The field is absent when the run never switched. The record type is exported as `StrategySwitchRecord` from `@reactive-agents/runtime` and `reactive-agents`.
- **A failed verification retry reports `failed` everywhere.** When `.withVerification()` rejected an answer and the retry then failed, `AgentCompleted.runOutcome` (and `AgentResult.outcome`) said `failed`, but `AgentCompleted.outcome.status` (and the trace's `run-completed.outcome.status`) still said `completed`, from the first pass. Both now say `failed`. `outcome.authority` is `runtime-success-veto:strategy-result-failed`, `kernelAuthority` keeps the kernel's own authority, and `statusReason` still names the first pass's status. A run that succeeds is unchanged.
