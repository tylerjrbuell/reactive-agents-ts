---
"@reactive-agents/reasoning": patch
"@reactive-agents/trace": patch
---

A soft guard's `guard-fired` event (stall, required-tool quota, loop resolution, low-delta, oracle force, dispatcher early stop) no longer reports `outcome: "terminate"` before the exit gate decides. The gate now emits the guard's event after its decision: `terminate` when the run ended (accept or handoff), `block` when the gate denied the exit. Event kinds, guard names, reasons and metadata are unchanged.

`@reactive-agents/trace` adds `runEndingGuardEvents`, `guardEndedRun` and `gateDecisionFor`. They read a guard's run end from the paired `exit_gate` event, so older traces, where a denied proposal was labelled `terminate`, are read correctly too. `analyzeCause` (stall/loop after work), `analyzeInterventions` (terminal decision, overlap storms) and failure attribution (stop budget) use them.
