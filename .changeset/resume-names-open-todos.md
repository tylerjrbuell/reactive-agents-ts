---
"@reactive-agents/runtime": patch
---

`agent.resumeRun` now names the run's still-open to-do rows in the continue guidance, so a paused or stopped run that is continued reconciles its list (mark done, remove, or finish) before its final answer. The kernel's own wrap-up turn is opt-in and is unchanged.
