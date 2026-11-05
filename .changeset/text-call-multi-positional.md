---
"@reactive-agents/tools": patch
---

Text tool calls with several positional literal arguments now bind to the tool's declared params in order. `fileRead("/abs/a.txt", "utf-8")` resolves to `{ path, encoding }` instead of being refused. Calls are still refused (the model is asked to restate) when there are more positionals than declared params, when the surface declares no param names, when a positional collides with a named arg, when a required param ends unbound, or when any value is non-literal. The embedded-form risk gate is unchanged.
