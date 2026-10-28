---
"@reactive-agents/core": minor
"@reactive-agents/tools": minor
"@reactive-agents/reasoning": minor
"@reactive-agents/runtime": minor
"@reactive-agents/ui-core": minor
"@reactive-agents/observability": minor
"@reactive-agents/llm-provider": minor
"reactive-agents": minor
---

Live checklist on the meta-loop spine. Every run now has a checklist projected from the contract and ledger facts the terminal gate judges: requirement rows carry gate truth, advisory rows (the opt-in `todo` meta-tool) never count toward done. New: `ChecklistUpdated` and `SubAgentActivity` on the full-density `AgentStream`; `observability.checklist` display option (default on, display-only, proven by a request-identity test); TUI checklist; `makeRunTree`, `projectChecklist`, `makeChecklistTracker` in core; one stream scope resolver in runtime; `checklist-item` ledger fact; `ui-core` recursive sub-agent fold.

**Breaking (tools):** removed the legacy `todo` list API — `applyTodoAction`, `parseTodoList`, `renderTodoList`, `TodoItem`, `TodoActionResult`. Use `applyTodoChecklistAction` / `renderTodoChecklist` over ledger-folded `AdvisoryItem`s. The global `_todo` scratchpad list is retired; old checkpoints migrate once on resume. The `todo` tool contract is byte-identical.

**Model-visible delta (one):** `brief`'s recall-key list no longer includes `_todo:<taskId>`.

Also: `llm-provider` normalizes tool schemas once for every provider (fixes OpenAI 400s on MCP tools with arrays lacking `items`) and adds live model discovery (`listProviderModels`, `resolveProviderModels`); repetition guard treats identical canonicalized arguments, not tool-name heuristics, as repetition; failed strategies and LLM errors surface a named failure message instead of empty output; URL document sources are fetched and indexed and any failed source emits `DocumentIngestFailed`; HTML ingestion extracts main content; `.withMetaTools({...})` warns when it drops default-on `recall`; sub-agent children no longer leak `TextDelta` to the parent stream.
