---
"@reactive-agents/runtime": minor
"reactive-agents": minor
---

A debrief is now its own setting, and sub-agent tools take typed input as a JSON Schema.

- `.withDebrief(enabled?)` (`AgentConfig.debrief`). A debrief used to exist only when memory was on. Unset, it still follows `.withMemory()`; `.withDebrief()` produces and stores one with memory off, and `.withDebrief(false)` turns it off with memory on. With memory off, only the debrief table is opened, in the memory database path (an in-process database for the test provider). The runtime also never provided the debrief store before, so a debrief reached `result.debrief` and the `DebriefCompleted` event but was not saved. It is saved now whenever a debrief is on.
- `.withAgentTool(name, { parameters })` accepts a JSON Schema object as well as a `ToolParameter` list. A schema is stored in `AgentConfig` (`agentTools[].agent.parameters`; a `ToolParameter` list is stored as the equivalent object schema, so `parameters` no longer drops out of `toConfig()`). The parent model sees the schema's top-level properties as the tool's parameters, and every call is checked against the schema: a violation fails the tool call with a `SubAgentInputError` and no sub-agent runs. A schema the validator cannot check throws `SubAgentParametersError` when declared.
- A sub-agent that calls a gated tool now asks the parent's live approval gate. A parent `.withApprovalPolicy({ mode: "detach" })` was coerced to `block` in the child, which denied every gated call when no `onApprove` was set, so a person was never asked. The child now waits on the same gate under the root run's id: `approveRun(rootRunId)` / `denyRun` answer it, the root stream's `ApprovalRequested` event and `listPendingApprovals()` carry a new optional `subAgent` (its name), and stopping or terminating the root run denies the child's wait. Dynamic sub-agents (`spawn-agent`) are covered.
- A sub-agent with memory off no longer opens the user memory database. Every sub-agent run used to create a `~/.reactive-agents/memory/sub-<name>-<timestamp>` folder; it now uses an in-process database.
