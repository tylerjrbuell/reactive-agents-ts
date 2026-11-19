---
"@reactive-agents/reasoning": patch
---

Reflexion no longer fails a run when its generate pass runs out of iterations mid-tool-work. The generate pass now gets half of the run's iteration budget (8 of 16 with `maxIterations: 16`, `maxRetries: 3`; it got 4 before), and the improve passes split the rest. An explicit `kernelMaxIterations` still sets every pass's cap. When the generate pass still hits its cap, reflexion writes the answer from the pass's tool results and critiques it as before. If the critique accepts that answer, the run's `answer` requirement is now met, so the run ships it as `partial` instead of being reported as failed with "unmet requirements: answer".
