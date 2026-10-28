---
"create-reactive-agent": patch
"@reactive-agents/reasoning": patch
"@reactive-agents/runtime": patch
---

`create-reactive-agent` `with-approval-gates` template now prompts the human via `node:readline` and denies when there is no TTY, instead of auto-approving every gated call. Reasoning: plan-execute no longer double-counts the LLM call of an inline step patch, and the refine-level patch now counts its call (`llmCalls` in result metadata is more accurate). Internal decomposition of `plan-execute.ts`, `event-bus.ts`, and `reactive-agent.ts` into focused modules (no API change).
