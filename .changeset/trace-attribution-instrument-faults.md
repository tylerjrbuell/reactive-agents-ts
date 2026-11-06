---
"@reactive-agents/trace": patch
---

`attributeFailure` no longer over-blames the model. Fixes six instrument faults from the 2026-11-06 evidence audit: a written file that passed is no longer picked as the failing target; a write or read the repetition guard replaced counts as not run; a dropped call inside a batch is no longer hidden by a sibling call of the same tool; results the projection compressed in the divergence turn count as elided; and tool-gate refusals of evidence reads count as withheld. New reasons: `harness:tool-not-offered`, `harness:refusal-counted-as-repeat`, `harness:evidence-withheld`, `harness:plan-fanout-blob`, `harness:offer-accepted-as-done`, `model:evidence-not-gathered`. `analyzeCause` flags a success with zero tool calls whose task asked for a named tool as `success-with-warning/tool-claim-without-call`.
