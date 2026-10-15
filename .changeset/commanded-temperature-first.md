---
"@reactive-agents/runtime": patch
"@reactive-agents/reasoning": patch
---

GH temp-threading (Wave-4 measurement integrity): a commanded `.withModel({ temperature })` now reaches the LLM request verbatim on the KERNEL routes (reactive + direct), command-first: `config.temperature ?? config.contextProfile?.temperature`, threaded through the ReasoningExecuteRequest, the reactive strategy's KernelInput mapping, and the verification think-retry seam. Previously all three dropped the command, so `think.ts` always stamped the tier-profile temperature (local 0.3 / mid 0.5) and every "temp 0" capture actually sampled at the tier default. An unset command keeps today's behavior (tier/profile default, then strategy-config temperature) exactly. Scope honesty: reflexion, tree-of-thought, plan-execute step-executor, and code-action hard-code temperatures on their internal LLM calls, and blueprint/adaptive's internal calls likewise ignore the command; broader threading is tracked in GH #246.
