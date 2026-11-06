---
"@reactive-agents/reasoning": patch
---

`maxCallsPerTool` now holds inside a single turn. Before, the tool gate counted only calls from earlier turns, so a model that emitted several calls to the same tool in one turn could run past the cap. Calls admitted earlier in the same turn now count too. With `maxCallsPerTool: { x: 1 }`, two `x` calls in one turn run one and refuse the other. The refused call gets a `tool-gate` guard event and an answering `tool_result`, the same as a refusal across turns.
