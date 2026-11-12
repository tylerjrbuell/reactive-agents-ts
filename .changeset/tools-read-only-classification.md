---
"@reactive-agents/tools": minor
---

`ToolDefinition` gains an optional `mutatesExternalState` flag, set on every built-in tool, plus exported `isReadOnlyTool(def)` / `readOnlyTools(defs)`. A tool is read-only only when it declares `mutatesExternalState: false` and does not require approval; tools that omit the flag (user, MCP) are treated as not read-only. Tools whose writes outlive the run (`rag-ingest` document store, `relate` memory graph) are marked mutating; per-run stores (`recall`, `checkpoint`, scratchpad) are not.
