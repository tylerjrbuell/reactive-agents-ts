---
"@reactive-agents/core": minor
"@reactive-agents/tools": minor
"@reactive-agents/reasoning": minor
"@reactive-agents/runtime": minor
"@reactive-agents/ui-core": minor
"@reactive-agents/observability": minor
"@reactive-agents/cortex": minor
"@reactive-agents/llm-provider": minor
"reactive-agents": minor
---

Live checklist on the meta-loop spine. Every run now has a checklist projected from the contract and ledger facts the terminal gate judges: requirement rows carry gate truth, advisory rows (the opt-in `todo` meta-tool) never count toward done. New: `ChecklistUpdated` and `SubAgentActivity` on the full-density `AgentStream`; `observability.checklist` display option (default on, display-only, proven by a request-identity test); TUI checklist; `makeRunTree`, `projectChecklist`, `makeChecklistTracker` in core; one stream scope resolver in runtime; `checklist-item` ledger fact; `ui-core` recursive sub-agent fold.

**Breaking (tools):** removed the legacy `todo` list API — `applyTodoAction`, `parseTodoList`, `renderTodoList`, `TodoItem`, `TodoActionResult`. Use `applyTodoChecklistAction` / `renderTodoChecklist` over ledger-folded `AdvisoryItem`s. The global `_todo` scratchpad list is retired; old checkpoints migrate once on resume. The `todo` tool contract is no longer byte-identical: see the `todo` changes below (action aliases, duplicate-title skipping, new result lines and description).

**Model-visible delta (one):** `brief`'s recall-key list no longer includes `_todo:<taskId>`.

Also: `llm-provider` normalizes tool schemas once for every provider (fixes OpenAI 400s on MCP tools with arrays lacking `items`) and adds live model discovery (`listProviderModels`, `resolveProviderModels`); repetition guard treats identical canonicalized arguments, not tool-name heuristics, as repetition; failed strategies and LLM errors surface a named failure message instead of empty output; URL document sources are fetched and indexed and any failed source emits `DocumentIngestFailed`; HTML ingestion extracts main content; `.withMetaTools({...})` warns when it drops default-on `recall`; sub-agent children no longer leak `TextDelta` to the parent stream.

**`todo` and healing (tools, reasoning):** `todo` accepts a closed table of action aliases (`update`, `set`, ...) and heals drifted calls; `add` skips duplicate titles; results end with a loop-closing line and the tool description carries the lifecycle. `find`, `final-answer`, `brief` and `pulse` heal drifted section values and param names. Healed calls record `healedFrom` / `healingApplied` on the tool-call trace. `@reactive-agents/tools` exports the shared helpers `healEnumArg`, `healParamNames`, `closestValid`.

**Opt-in, experimental:** `.withMetaTools({ todo, todoGuidance: { reminder, systemLine } })` threads `checklistGuidance` to the kernel. Default off; not lift-measured, so it is not recommended as a default and no "Claude-Code-like" behavior is claimed.

**Conversation to-do (runtime, reasoning):** `RunEnvelope` gains `initialAdvisory`; `agent.session({ initialTodo })`, `session.todo()` and `snapshotToTodoSeed` carry a chat's to-do list across turns. Requirement status is scoped to the run's own pass so sub-agent facts cannot shadow the root answer requirement.

**llm-provider:** `gpt-5*` / o-series use `max_completion_tokens` and omit `temperature` (also for LiteLLM reasoning ids); live model discovery (`listProviderModels`, `resolveProviderModels`; 10-minute cache keyed by hashed credential, free-text fallback, groq and xai added; env keys are never sent to caller-named hosts, no redirects); Groq inactive models are skipped; strict tool schemas are capped at OpenAI depth/size limits and fall back to non-strict. **runtime:** URL document fetch blocks private-host targets (`allowPrivateHosts` opts out). **reasoning:** the repetition guard's distinct-argument carve-out also requires distinct results.

**cortex:** sub-agent blocks in chat; persisted turn cost (never a silent $0); Run trace tab and `/export`; Beacon hierarchy via persisted `parentRunId`, deterministic layout with per-browser persisted positions; live pickers with groq/xai and preset fallback; plan card ("Goal checks" and "Agent's to-do"); conversation to-do dock, persisted per session; chat agents get `todo` on by default for new sessions; opt-in "Keep to-do list current" setting (experimental); context-usage ring persists between runs; provider/model link to `/models/<provider>/<model>`.

**Ablation confirmation (V1/V4 PASS, mutation-checked):** ablation-warden confirmed the display-only checklist and the request-identity test (ON/OFF requests identical; the test fails when the identity is deliberately broken). The V5 guidance verdict is still pending, which is why guidance stays opt-in.
