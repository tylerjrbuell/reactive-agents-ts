---
"@reactive-agents/reasoning": patch
---

code-action: generated code may call a tool with no argument (`tool()`) or `tool(null)`; the call reaches the tool as `{}` instead of failing with `undefined is not an object (evaluating 'Object.keys(args)')`. A non-object argument throws an error into the generated code that names the call shape, e.g. `search takes one object argument, e.g. search({ query: value })`, and the tool does not run. The prompt and tool declarations now show that zero-argument calls are allowed. When the same sandbox error repeats on two iterations in a row, the run stops early as failed and names the error, instead of retrying until the iteration cap.
