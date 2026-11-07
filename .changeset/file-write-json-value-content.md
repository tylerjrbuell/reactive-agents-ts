---
"@reactive-agents/tools": patch
---

`file-write` now accepts a JSON value as `content` as well as a string. The healing pipeline has a new value-shape stage that serializes an object, array, number or boolean sent to a `file-content` parameter as `JSON.stringify(value, null, 2)` plus a newline, and records a `value-shape` HealingAction. This means a model no longer has to double-escape a `.json` document inside its tool arguments. String content is unchanged byte-for-byte, and `null` is still a missing-parameter error.

New: `ToolParameter.semantic` (optional, `"file-content"`) and `toParameterJsonSchema(p)`, the one projection from a `ToolParameter` to its wire JSON schema. `toFunctionCallingTool` and `ToolRegistry.toFunctionCallingFormat` now use it, so `enum`, `items` and `additionalProperties` reach the function-calling schema. Before this change they were dropped.
