---
"@reactive-agents/core": minor
"@reactive-agents/reasoning": minor
"@reactive-agents/runtime": minor
"@reactive-agents/ui-core": minor
"@reactive-agents/cortex": minor
---

The stream looks the same whichever reasoning strategy runs. `ThoughtEmitted` now carries only the model's own reasoning from kernel turns (`ReasoningStepCompleted.producedBy: "kernel"`); a strategy's internal control notes (`[PLAN 2] ...`, `[REFLECT 1] ✗ UNSATISFIED`, raw plan JSON) stay in traces and no longer appear as thinking. A new full-density stream event, `ExitGateDecision` (`repair` | `handoff` | `accept-unfinished`, with the outstanding items), reports the shared exit gate's decision for the main loop and for every strategy alike. Plans reach consumers as live checklist rows from one shared planning primitive, now used by both plan-execute and blueprint. Cortex shows the gate decision as one line in the turn's checklist card.
