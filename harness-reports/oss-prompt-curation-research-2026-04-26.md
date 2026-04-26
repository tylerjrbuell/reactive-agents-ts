# OSS Agent Framework Prompt Curation Research

**Date:** 2026-04-26
**Audience:** Reactive Agents Context Curator redesign team
**Methodology:** Direct WebFetch of current `main` branch source for each framework. Where a 404 was returned, an alternative authoritative file in the same repo was used. Findings below quote the actual functions; file paths cite where to follow up.

---

## 1. smolagents (Hugging Face)

Source examined: `src/smolagents/agents.py`, `src/smolagents/prompts/toolcalling_agent.yaml`.

- **System prompt is built ONCE at run start, not per step.** `MultiStepAgent.system_prompt` is a `@property` that calls `initialize_system_prompt()`, which `populate_template()`s a Jinja YAML against `{tools, managed_agents, custom_instructions}`. No per-iteration mutation.
- **All registered tools are dumped inline.** `_setup_tools()` collects `self.tools = {tool.name: tool for tool in tools}` plus optional `TOOL_MAPPING` base tools plus a default `final_answer`. The template loops `{%- for tool in tools.values() %}` — there is no relevance filter.
- **YAML system prompt anatomy** (`toolcalling_agent.yaml`): opening paradigm explainer (~200ch) + 3 worked Action/Observation examples (~900ch) + tool inventory loop (variable) + managed-agents block (conditional) + optional `custom_instructions` + a hard-coded numbered "rules" block (~400ch). No environment block; `task` and `remaining_steps` injected through template variables.
- **`planning_interval` is a step-counter trigger**, not a stuck detector: `if step_number == 1 or (step_number - 1) % planning_interval == 0` then `_generate_planning_step()` runs as an extra LLM call. Regular ACT steps run otherwise.
- **CodeAgent vs ToolCallingAgent** differ only in template choice and template variables (`code_block_opening_tag`, `authorized_imports` vs just `tools/managed_agents/custom_instructions`); both use the same one-shot prompt model.
- **No runtime tool discovery.** Tools are static after `__init__`.
- **Stuck handling = max-steps only.** `_handle_max_steps_reached()` forces a final answer via `provide_final_answer(task)` and raises `AgentMaxStepsError`. No loop / repetition detection.

---

## 2. LangGraph (`create_react_agent`)

Source examined: `libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py`.

- **System prompt is one static `SystemMessage` prepended every turn**: `_get_prompt_runnable()` wraps `lambda state: [_system_message] + state["messages"]` and pipes it into the model. The runnable is built once during `create_react_agent()` and reused.
- **Tools bound globally to the model** via `model.bind_tools(tool_classes + llm_builtin_tools)`. Stored as `static_model`. Per-node tool binding only happens if the user wires it manually with custom nodes — the default ReAct prebuilt is global.
- **No prompt evolution across iterations.** Same `SystemMessage` is prepended each pass; only `messages[]` grows.
- **No discovery primitive.** Agent rejects calls to tools not in the bound list.
- **Stuck handling = step budget.** `_are_more_steps_needed()` fires `if remaining_steps < 2 and has_tool_calls` and returns the literal `"Sorry, need more steps to process this request."` No loop detection in the prebuilt; users add it as a custom graph node.

---

## 3. CrewAI

Source examined: `src/crewai/utilities/prompts.py` (the agents/agent.py and translations json moved in a recent refactor and 404 on raw URLs; behavior below is from `prompts.py` and prior public docs cross-checked against the file's slice references).

- **`Prompts.task_execution()` selects a slice combination** rather than building a single mega-prompt: `role_playing` (always) + one of three task slices: `native_tools + native_task` (when native FC), `tools + task` (ReAct), or `no_tools + task_no_tools` (no tools registered).
- **All agent-scoped tools are exposed**, but tools are scoped per-Agent in CrewAI's data model — different agents in a crew see different lists. Within a single agent, every tool that agent owns is rendered each turn.
- **System prompt is static per agent within a Task.** Mutation across iterations is via the message log (Thought/Action/Observation), not by re-rendering the system prompt.
- **Slice-based templating** means rules / format / role are pre-baked text blocks, not assembled conditionally per iteration. Custom templates can substitute `{{ .System }}`, `{{ .Prompt }}`, `{{ .Response }}` placeholders + `{role}/{goal}/{backstory}`.
- **No runtime tool discovery.** Crew composition is the discovery layer — agents delegate to other agents instead of probing tool catalogs.
- **Stuck handling**: `max_iter` per agent and `max_rpm` per crew, plus a `RPMController`. Repetitive-action detection lives in the executor (renamed/moved file); historically CrewAI compares the latest `(tool, args)` tuple against the prior one and refuses to re-execute identical calls.

---

## 4. openai-agents-python (Swarm successor)

Source examined: `src/agents/agent.py`, `src/agents/run.py`.

- **`Agent.get_system_prompt()` supports three modes**: literal `str`, async callable `(context, agent) -> str` with strict 2-arg validation, or `None`. The callable form is the per-run dynamic hook — not per-step within a run.
- **Tool list rebuilt per run, not per step.** `get_all_tools()` aggregates static tools + MCP-fetched tools each run; each tool passes `_check_tool_enabled()` which evaluates `is_enabled` (bool or `MaybeAwaitable[bool]`). Disabled tools never reach the LLM. MCP servers are queried each run via `get_mcp_tools()`.
- **Handoffs swap the active Agent wholesale**, including its tool set. `run.py`: when `NextStepHandoff` fires, `current_agent = turn_result.next_step.new_agent` and `should_run_agent_start_hooks = True`. The receiving agent gets full conversation history; tool sets do not merge.
- **Tools-as-handoffs** (`agent.as_tool()`) is the closest thing to discovery: a parent agent treats sub-agents as callable tools that re-enter the parent on completion.
- **Stuck handling**: `reset_tool_choice=True` (default) clears `tool_choice` after each tool call to break forced-tool loops; `max_turns` raises `MaxTurnsExceeded`. No semantic stuck detection.

---

## 5. Pydantic AI

Source examined: `pydantic_ai_slim/pydantic_ai/_agent_graph.py`, `pydantic_ai_slim/pydantic_ai/tool_manager.py`.

- **System prompt added on first turn only**, but **mutates across iterations**. `UserPromptNode._sys_parts()` calls `_system_prompt.resolve_system_prompts()`, then `_reevaluate_dynamic_prompts()` re-runs any `@agent.system_prompt(dynamic=True)` functions on subsequent turns and **rewrites the existing `SystemPromptPart` in place** by `dynamic_ref`. This is the most sophisticated curation pattern of the five frameworks.
- **Tool manager rebuilt per step** via `tool_manager.for_run_step(run_context)` which re-calls `toolset.get_tools(ctx)`. Tools can appear/disappear per step. The `prepare_tools` hook on the root capability further filters: `all_tool_defs = await ctx.deps.root_capability.prepare_tools(run_context, all_tool_defs)`.
- **Conditional tool exposure is first-class**: `AbstractToolset` subclasses (e.g. `WrapperToolset`) override `get_tools()` to gate visibility based on context.
- **No "list-all-tools" discovery RPC.** Tools must be pre-registered, but visibility is dynamic.
- **Retry handling is structured.** `increment_retries()` + `_build_retry_node()` injects a `RetryPromptPart` carrying the validation error back into the next request. `check_incomplete_tool_call()` and empty-response retries are explicit. Token-limit and unexpected-behavior paths raise typed errors.

---

## Comparison Table

| Framework | Default tool exposure | System prompt size (typical) | Discovery tool? | Per-iteration mutation | Stuck handling |
|---|---|---|---|---|---|
| smolagents | All registered, inline | ~1500–2500ch + N tool schemas | No | None | Max-steps + force final answer |
| LangGraph (prebuilt) | All bound globally | User-provided string, static | No | None (same SystemMessage prepended each turn) | Step budget warning |
| CrewAI | All per-agent (scoped) | Slice composition (role + tool/no-tool variant) | No (delegation instead) | None to system prompt | `max_iter`, RPM, repeat-call refusal |
| openai-agents-python | All static + dynamic MCP, gated by `is_enabled` | Literal or callable, computed once per run | Tools-as-handoffs (sub-agent invocation) | Per-run only (not per-step) | `reset_tool_choice`, `max_turns` |
| Pydantic AI | Filtered per-step via `prepare_tools` + `Toolset.get_tools` | Initial static + dynamic re-evaluation in place | No (visibility is the lever) | **Yes** — `_reevaluate_dynamic_prompts` rewrites parts each turn | Typed retry node injects validator errors |

---

## Recommendations for Reactive Agents Curator Redesign

What to adopt:

1. **Adopt Pydantic AI's per-step toolset rebuild as the architectural backbone.** `Toolset.get_tools(ctx)` + `prepare_tools` hook is exactly the lazy-disclosure shape we want. Our Curator should be a `Toolset`-like component called once per kernel iteration, returning `{required_tools, relevant_tools}` that the prompt builder renders.
2. **Adopt Pydantic AI's `dynamic_ref`-based prompt-part rewriting.** Section identity is a stable key; section *content* is recomputed per turn. This lets us mutate the "recent observations" or "current rule violations" sections without re-emitting the whole system prompt — and lets us keep prompt-cache prefixes stable on the parts that didn't change.
3. **Adopt openai-agents-python's `is_enabled` callable on tools.** Trivially extends to "rule violated → enable healing tool" or "stall detected → enable discovery tool" without restructuring the prompt.
4. **Adopt CrewAI's slice-selection idea** for sections: `tools / no_tools / native_tools` is a much cleaner pattern than always-on conditional fragments. Map this to our case as `simple_task / multi_tool_task / recovery_task` slice families.
5. **Implement a `discover_tools(query)` meta-tool** — none of the five frameworks has this and our local-model failure mode (gemma4:e4b confused by 14 tools when 1 is needed) is the exact problem it solves. Start with semantic match against `tool.description`, return name + 1-line summary + minimal schema.

What to avoid:

6. **Do not copy smolagents' all-tools-always-inline pattern.** It is the failure mode we are trying to escape; the worked-examples block in their YAML is also exactly the kind of scaffolding that makes local models echo framework formats.
7. **Do not copy LangGraph's prepend-static-SystemMessage pattern.** It throws away the per-iteration optimization we need. (Their flexibility lives in custom graphs — but the prebuilt is the bad default.)
8. **Avoid CrewAI-style monolithic role/goal/backstory blocks** for local models. They are heavy persona-priming text that does not help a small model decide which tool to call.
9. **Do not implement smolagents-style `planning_interval`.** It is a fixed-cadence extra LLM call; we already pay for richer per-turn signal via entropy/RI.

Local-model-specific divergences:

10. **Local models penalize prompt length disproportionately.** Pydantic AI's pattern was designed for SaaS frontier models where dynamic prompt mutation is "free" relative to model cost. For local models it is also free relative to *capability* — keeping the prompt under ~1500 chars when the task is trivial is more important than keeping it under N tokens for budget reasons.
11. **None of the five frameworks de-scaffold "rules" blocks**, because frontier models tolerate them. We should treat rules as **violation-triggered**: omit by default, inject a single targeted reminder only after the kernel observes a specific violation. This is a genuine departure from the OSS norm.
12. **None expose a discovery tool**, because frontier models can be told "you have these 14 tools" without confusion. Discovery is the local-model unlock and should be Reactive Agents' distinguishing feature.
13. **Mutation cadence**: prefer adopting Pydantic-AI-style stable-key rewriting over rebuilding the system prompt from scratch each turn. This preserves the prompt-cache prefix on parts that didn't change — important even on Ollama where KV-cache reuse is the only caching we get.

---

## Files to follow up

- smolagents: `src/smolagents/agents.py` (`MultiStepAgent.initialize_system_prompt`, `_setup_tools`, `_handle_max_steps_reached`); `src/smolagents/prompts/toolcalling_agent.yaml`.
- LangGraph: `libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py` (`create_react_agent`, `_get_prompt_runnable`, `_are_more_steps_needed`).
- CrewAI: `src/crewai/utilities/prompts.py` (`Prompts.task_execution`); the agent executor file moved in a recent refactor — search the repo for `crew_agent_executor` to locate.
- openai-agents-python: `src/agents/agent.py` (`Agent.get_system_prompt`, `get_all_tools`, `_check_tool_enabled`); `src/agents/run.py` (`NextStepHandoff` block).
- Pydantic AI: `pydantic_ai_slim/pydantic_ai/_agent_graph.py` (`UserPromptNode._sys_parts`, `_reevaluate_dynamic_prompts`, `_prepare_request_parameters`, `_build_retry_node`); `pydantic_ai_slim/pydantic_ai/tool_manager.py` (`for_run_step`, `tool_defs`).

Word count: ~1,440.
