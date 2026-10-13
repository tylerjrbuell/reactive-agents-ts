---
"@reactive-agents/runtime": patch
"@reactive-agents/reasoning": patch
---

GH temp-threading (Wave-4 measurement integrity): a commanded `.withModel({ temperature })` now reaches the LLM request verbatim, command-first (`config.temperature ?? config.contextProfile?.temperature` at the reasoning-think seam, then `input.temperature` leading the KernelInput mapping in the reactive strategy). Previously the commanded value was dropped at both seams, so `think.ts` always stamped the tier-profile temperature (local 0.3 / mid 0.5) and every "temp 0" capture actually sampled at the tier default. Unset commands keep today's behavior (tier/profile default, then strategy-config temperature) exactly.
