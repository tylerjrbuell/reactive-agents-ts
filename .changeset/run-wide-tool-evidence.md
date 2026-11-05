---
"@reactive-agents/reasoning": minor
---

Tool evidence is one value per run, derived from the run ledger. A later pass of a multi-pass strategy (reflexion, plan steps that continue a run) no longer forgets tools an earlier pass already ran: it is not redirected to "call a tool first" or pushed to abstain after the work is done. In a scripted reflexion run this removes one LLM call and about 20% of tokens.

Behavior changes:
- `maxCallsPerTool` is now a budget for the whole run, not for each pass.
- `maxCallsPerTool` is now enforced on native function calling. A fallback path re-sent calls the budget had already refused.

`ArbitrationContext` (public) now requires `evidence: ToolEvidence`. `NO_TOOL_EVIDENCE`, `toolEvidence(ledger)` and the `ToolEvidence` type are exported for callers that build one.
