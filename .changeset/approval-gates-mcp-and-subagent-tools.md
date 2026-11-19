---
"@reactive-agents/runtime": patch
"reactive-agents": patch
---

Security: `.withApprovalPolicy()` now gates tools that are registered after `build()`. Before, only built-in and custom tools that need approval were gated, so these ran without approval under every strategy:

- MCP tools the server marks as writing (`destructiveHint: true`, or `readOnlyHint: false`). MCP tools with no annotation and no `readOnly` promise are not gated by default, the same rule as custom tools without `requiresApproval`. To gate them, name them in `tools` (`"server/tool"`) or use `requireFor`.
- `.withAgentTool()` sub-agent tools. Their documented default is `requiresApproval: true`.
- Tools added with `agent.registerTool()` that set `requiresApproval: true`.

Each reasoning pass reads the live tool registry, so the block and detach gates and code-action's refusal check all see these tools. Agents with no approval policy behave as before.

Chat sessions: the first turn of a conversation no longer gets an "Environment update since your last turn" notice from a stale `initialEnvironment` seed. With no earlier turn there is nothing to compare against, so the current environment becomes the baseline.

`codeActionApprovalConflict` and its `CodeActionApprovalConflict` / `CodeActionApprovalConflictInput` types are now exported from `@reactive-agents/runtime` and `reactive-agents`, so apps can warn before a code-action run without importing `@reactive-agents/reasoning`.
