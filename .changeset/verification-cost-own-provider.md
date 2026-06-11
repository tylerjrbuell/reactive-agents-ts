---
"@reactive-agents/verification": patch
"@reactive-agents/cost": patch
---

Helper LLM calls (verification scoring, cost/complexity routing) now run on the agent's own configured provider and model instead of a hard-coded provider. Agents configured for local or non-default providers no longer make surprise cross-provider calls — or fail when only one provider's credentials are present.
