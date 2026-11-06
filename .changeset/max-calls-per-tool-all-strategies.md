---
"@reactive-agents/reasoning": patch
---

`maxCallsPerTool` (`.withTools({ maxCallsPerTool })`) now holds on every strategy, not only `reactive` and `adaptive`. Before this, `plan-execute-reflect`, `tree-of-thought`, `reflexion`, `blueprint` and `code-action` ignored the cap. The caps now travel on the run envelope (`RunEnvelope.rails.maxCallsPerTool`), so each kernel pass refuses the extra call. Tool calls made outside a kernel are also capped: `tool_call` plan steps in plan-execute and blueprint, and tool calls from code-action's generated code. A refused call is not run. It is answered with "`<tool>` was not run: its per-tool call budget is used up …" and emits a `guard-fired` event with `guard: "tool-gate"`. Strategies no longer take `maxCallsPerTool` as their own input field. Pass it to `ReasoningService.execute` or put it on the envelope.
