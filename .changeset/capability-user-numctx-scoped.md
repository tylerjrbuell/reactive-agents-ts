---
"@reactive-agents/llm-provider": patch
---

A declared context window can now be applied to one resolution instead of the whole process: `resolveCapability(provider, model, { userNumCtx })` and `resolveCanonical(provider, model, { userNumCtx })` lift a fallback or inferred row to a `source: "user"` row for that call only, and `applyUserNumCtx(capability, numCtx)` is the same rule as a pure function. Probe, cache and static-table rows still win. `registerUserSuppliedCapability` (now exported from the resolver module, same public name) is deprecated: it writes a process-wide row, so one agent's `.withModel({ numCtx })` changed the window of every other agent on the same model id, and the first declared value won for good.
