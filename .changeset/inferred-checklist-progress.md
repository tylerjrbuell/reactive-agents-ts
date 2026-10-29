---
"@reactive-agents/core": patch
"@reactive-agents/runtime": patch
"@reactive-agents/ui-core": patch
"@reactive-agents/trace": patch
"@reactive-agents/observability": patch
"@reactive-agents/cortex": patch
---

Deterministic inferred checklist progress: advisory to-do rows can now be shown as done from ledger evidence (`source: "inferred"` plus an `evidence` ref on `ChecklistUpdated` rows, new `ChecklistInferred` event, `checklist-inferred` trace event). Inferred rows render distinctly in Cortex (dashed check with an evidence tooltip) and the terminal status line (`(inferred)`); pending rows after a finished turn read "not marked done". Display-only and advisory: explicit marks win, the model's request is unchanged, and no improvement is claimed.
