---
"@reactive-agents/reasoning": patch
---

The unbacked-action check no longer treats a passive sentence about someone else's action as the agent's claim. "Issue #12 was created by alice" in a summary used to count as a claim that `create_issue` ran, so the exit gate denied a correct answer and pushed the model to call the tool. A passive form now counts only with no doer named, with "by me" / "by us", or with the agent's means ("by calling the API").
