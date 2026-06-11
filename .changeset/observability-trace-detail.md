---
"@reactive-agents/trace": patch
"@reactive-agents/observability": patch
"@reactive-agents/diagnose": patch
---

Deeper run observability. Traces now record decision-record instrumentation and per-stream cache-token accounting, and `rax-diagnose replay` shows per-iteration tool calls, output, and cache detail for root-cause analysis. Per-tool-call rationale auditing is available opt-in (default off — it measurably affects weak-model behavior when forced).
