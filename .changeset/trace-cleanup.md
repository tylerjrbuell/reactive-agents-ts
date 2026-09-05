---
"@reactive-agents/trace": patch
"@reactive-agents/diagnose": patch
"@reactive-agents/reasoning": patch
"@reactive-agents/core": patch
---

Remove the `alternatives-considered` trace event end to end (emitter, `AgentEvent` union member, debrief rendering): it had zero live emitters and was dead weight in every consumer. Fix plan-execute's ledger to record the healed (post-repair) tool-call arguments instead of the pre-heal ones, so the ledger matches the trace it's compared against during replay.
