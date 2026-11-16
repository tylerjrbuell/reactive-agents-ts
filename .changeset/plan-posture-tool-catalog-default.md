---
"@reactive-agents/reasoning": patch
---

Plan posture now names the tools the execute phase will have, by default. The plan turn's guidance gains one capped line listing the agent's own tools and its MCP tools (grouped by server, full `server/name` names, up to 40, one-line descriptions), so plan steps can reference real tools as `tool: name` instead of generic ones. The list comes from the full tool catalog, not the relevance-pruned set. Turn it off with `.withHarness({ planToolCatalog: false })` or `RA_PLAN_TOOL_CATALOG=0`. Execute posture is unchanged.

Plan steps derived from a prose reply (when the model recorded no `todo` list) now skip first-person narrative ("I need to…", "To understand X, I'll…") and drop near-duplicate restatements.
