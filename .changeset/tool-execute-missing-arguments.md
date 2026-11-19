---
"@reactive-agents/tools": patch
---

`ToolService.execute` now treats missing or null `arguments` as `{}`, so a zero-argument call such as `list_websites()` from a code-action sandbox runs instead of failing with `Object.keys` on undefined. A non-object `arguments` (array, string, number) returns a `ToolValidationError` that names the tool and shows the expected object shape. New export `normalizeToolArguments`; `validateToolInput` now accepts `unknown` arguments.
