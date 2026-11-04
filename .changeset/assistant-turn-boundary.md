---
"@reactive-agents/reasoning": patch
---

Every assistant turn now passes through one boundary that records which parts of the reply were consumed as tool calls. Final answers and fallback deliveries read only the unconsumed text, so a tool call the model printed (and the harness already ran) is no longer shipped as the answer. An earlier code block is prepended to a short final answer only when the run contract expects code. Each non-prose turn emits a `tool_call_extracted` guard event.
