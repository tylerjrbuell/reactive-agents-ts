---
"@reactive-agents/reasoning": patch
---

Improved — agents finish more reliably once their required tools are satisfied

Previously, once a task's required tools were all satisfied, the harness
only proactively told the model it could finish when a tool needed to be
called more than once. In the common single-call case it said nothing —
smaller/local models frequently satisfied their required tools and then
just stopped without calling `final-answer`, forcing the harness to
reconstruct an answer from raw tool output instead of the model's own
synthesis. Now sends a soft, informational nudge ("if you have what you
need, give your final answer now") the first time this happens, without
overriding the model's judgment on whether more research is needed.

Fixed — LLM-level failures (bad model, connection refused, provider
rejection) are now visible in the terminal/status output. Previously the
diagnostic message was computed but only published to a programmatic
event-bus channel — a run failing this way showed "Task failed" with no
indication of why.
