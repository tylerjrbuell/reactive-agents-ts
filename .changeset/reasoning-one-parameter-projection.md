---
"@reactive-agents/reasoning": patch
"@reactive-agents/runtime": patch
---

Tool parameters now keep every field inside the reasoning kernel. `ToolParamSchema` is derived from the tools package's `ToolParameter`, and the function-calling wire schema is built with `toParameterJsonSchema`. The healing pipeline (kernel act and plan-execute/blueprint steps) receives whole schemas, so a `semantic: "file-content"` parameter reaches the value-shape stage. code-action tool bindings now show `enum` choices as string-literal unions. Before this change, each projection copied parameters field by field and silently dropped new fields.
