---
"@reactive-agents/reasoning": patch
---

Fixed — a failed tool call inside a parallel batch showed no error message

Found via live-model QA: when the kernel dispatches multiple tool calls in
parallel (a model requesting more than one tool in the same turn) and one
fails, the terminal/verbose log printed a bare `✗ tool 0.00s` with nothing
after it — the error text was there in the result, it just never made it
into the log event at this one call site. Sequential tool calls always
showed their error; parallel ones silently didn't. Now consistent.
