---
"@reactive-agents/tools": minor
---

Tools now resolve to a declared effect, `"read" | "write" | "unknown"`, through the new `toolEffect(definition)` helper and `ToolEffect` type. The effect comes from `mutatesExternalState` and `requiresApproval`. An undeclared tool is `unknown` and is never treated as read-only. No tool is added to or removed from any tool surface.

MCP tool annotations are classified in this order:
1. Write hints (`destructiveHint: true` or `readOnlyHint: false`) make the tool `write`, even from an untrusted server and even if the operator listed it read-only. A server that says a tool writes is believed.
2. `openWorldHint: true` makes the tool `unknown`.
3. Otherwise the tool is `read` only through an operator `readOnly` listing or a trusted `readOnlyHint: true`.
