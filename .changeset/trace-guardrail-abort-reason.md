---
"@reactive-agents/trace": patch
---

`rax-diagnose cause` reads a run aborted with the stamped reason `guardrail` as `aborted/guardrail-block`, the same cause a guardrail block already gets from its error tag. `RunAbortedEvent.reason` now uses core's `RunAbortReason` instead of a copied union.
