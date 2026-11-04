---
"@reactive-agents/trace": minor
"@reactive-agents/diagnose": minor
---

`rax-diagnose attribute` now tells you whether a harness change actually ran, and names one more harness failure.

- New attribution reason `harness:completeness-blind`: the run ended on its own with files the grader required never written, and neither the compiled contract nor any requirement declared later on the run ledger listed them. The fix is a completeness signal, not the prompt.
- New `mechanismActivity(trace)`, `compareActivity(before, after)` and `runsWithMechanism(runs, key)` in `@reactive-agents/trace`: stable keys for the harness mechanisms that acted in a run (guards that did not pass, injected signals, strategy switches, contract requirements by source). `rax-diagnose attribute` prints them per run (`activity`) and per cohort (`mechanisms that acted`).
