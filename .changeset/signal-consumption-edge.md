---
"@reactive-agents/trace": minor
"@reactive-agents/core": patch
"@reactive-agents/reasoning": minor
"@reactive-agents/runtime": patch
"@reactive-agents/reactive-intelligence": patch
"@reactive-agents/diagnose": patch
---

feat: signal consumption edge — every harness signal gets a stable id, a typed
reachability record (did it reach the model's prompt), and a deterministic
effect classification (remediated / ignored / contradicted / ambiguous) on the
following action, aggregated on run-completed and consumed by RI learning and
rax diagnose. Closes the signal gap root cause surfaced by the 2026-10-24
introspective harness loop (I4/I5/I7): emission-side-only telemetry could not
distinguish "signal never landed" from "signal landed and was misused." Adds
SignalRendered + SignalEffect trace events, a kernel signal ledger, a pure
classifier, render stamps in think.ts, run-completed tally, and read-only
consumers. Additive schema only; historical traces still load.