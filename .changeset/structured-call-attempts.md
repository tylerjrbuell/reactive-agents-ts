---
"@reactive-agents/core": patch
"@reactive-agents/trace": patch
"@reactive-agents/reasoning": patch
---

`completeStructured()` exchanges now show what happened inside the call. When the provider reports it, the `llm-exchange` trace event carries `response.attempts`: one entry per native attempt with input and output tokens, stop reason, thinking size and whether it parsed. The exchange also gets the final attempt's `stopReason` and the summed `thinkingChars`. A thinking runaway, a parse retry and real output no longer look the same. Old traces load unchanged; the field is optional (`StructuredAttemptReport` in `@reactive-agents/core`).

Structured spend is now counted from the provider's reported usage:

- A failed `completeStructured()` call that billed tokens now counts toward the run budget, and its error exchange records the tokens and attempts.
- `extractStructuredOutput()` returns real `usage` on the native path. A failed native call's usage is added to the prompt-mode fallback total.
- The plan-execute and blueprint planners account their spend from that usage. They estimate from text length only when the provider reported none.

Providers report attempts by attaching `attempts` to the usage they leave on `StructuredUsageRef`.
