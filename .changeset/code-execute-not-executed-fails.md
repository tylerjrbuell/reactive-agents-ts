---
"@reactive-agents/reasoning": patch
---

A `code-execute` call whose code did not run (`{ executed: false, error }`) is now a failed tool call: `ToolCallCompleted.success` / trace `tool-call-end.ok` is `false` and the model receives it as an error tool result. Before, the kernel trusted the tool service's `success: true` and counted the failure as a success.
