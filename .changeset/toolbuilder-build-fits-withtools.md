---
"@reactive-agents/tools": patch
---

`ToolBuilder...build()` now passes straight into `.withTools({ tools: [...] })` without a type error or cast. `build()` types `handler` as required when `.handler(fn)` was called, and keeps the handler's own type. Before, `handler` was always optional and returned `unknown`, so the documented builder chain failed with TS2322. A tool built without a handler, or with a handler that returns a plain value instead of an Effect, is now rejected at the `.withTools()` call at compile time, because `.withTools()` runs handlers as Effects. New exported types: `ToolBuilderHandler`, `BuiltTool`.
