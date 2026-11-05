---
"@reactive-agents/runtime": minor
---

`.withTools({ riskLevels })` overrides any tool's risk level by name, built-ins included, for example `{ "file-read": "low" }`. The text tool-call parser binds a call embedded in prose or code (`const x = fileRead("/abs")`) only for `"low"` tools, so this lets you allow embedded calls for tools you trust. The override applies to every tool definition the agent reads during a run (built-in, custom and MCP). Maps merge across `.withTools()` calls, round-trip through `toConfig()` / `createAgent({ tools: { riskLevels } })`, and an unknown tool name logs a build warning instead of throwing.
