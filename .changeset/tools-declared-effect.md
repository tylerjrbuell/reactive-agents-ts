---
"@reactive-agents/tools": minor
---

Tools now resolve to a declared effect, `"read" | "write" | "unknown"`, through the new `toolEffect(definition)` helper and `ToolEffect` type. The effect comes from `mutatesExternalState` and `requiresApproval`; an undeclared tool is `unknown` and is never treated as read-only. MCP tools now also map `destructiveHint: true` and `readOnlyHint: false` to a write tool, even from an untrusted server (those hints only narrow). A tool is `read` only through an operator `readOnly` listing or a trusted `readOnlyHint: true`. No tool is added or removed from any tool surface.
