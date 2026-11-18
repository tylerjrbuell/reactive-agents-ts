---
"@reactive-agents/runtime": patch
---

`toolBuilderToEntry()` now runs a handler that returns an Effect and uses its value as the tool result. Before, the tool returned the Effect object itself, and the model saw `{"_id":"Exit",...}` in place of the value. Async handlers are awaited. A throw, a rejected Promise or a failed Effect now fails the tool call with `ToolExecutionError`, which the model sees as a tool error. Before, a synchronous throw escaped the handler.
