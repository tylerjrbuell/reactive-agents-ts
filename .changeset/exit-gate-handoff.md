---
"@reactive-agents/reasoning": patch
---

Guard, cap and early-stop exits are now proposals to one exit gate instead of ending the run on their own. The gate accepts when nothing is outstanding, denies a soft guard once (with guidance naming what is missing) when budget remains, and otherwise runs one handoff synthesis over the evidence that returns the best answer plus an explicit `Unfinished:` list, reported as `partial`. The iteration cap stays a hard bound. Each decision emits an `exit_gate` guard event and is recorded on the terminal decision.
