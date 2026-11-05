---
"@reactive-agents/reasoning": minor
---

When a provider rejects a request as too long for the model's context window, the agent now compacts its conversation to half the window and retries once instead of ending the run. A second failure ends the run as before. When a thinking model runs away and exhausts its output budget, the one retry now runs with thinking turned off for that call. Both decisions are recorded as `context-overflow` / `thinking-runaway` trace signals.
