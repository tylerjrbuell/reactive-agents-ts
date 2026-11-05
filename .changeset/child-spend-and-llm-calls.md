---
"@reactive-agents/runtime": patch
---

A sub-agent that crashes now adds its full spend to the parent run (tokens, cost, input and output tokens, and LLM calls, including spend inside the phase that failed). Before, only tokens and cost were folded, and spend in the failing phase was lost. `AgentResultMetadata` now declares `llmCalls`, the number of LLM calls the run made (the value was already reported).
