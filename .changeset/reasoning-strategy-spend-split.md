---
"@reactive-agents/reasoning": patch
---

Strategy runs keep the input/output token split for their direct LLM calls. Reflexion's critique, plan-execute's reflect, synthesis and plan patches, blueprint's worker and patch calls, adaptive's fallback roll-up and the quality gate now account the provider's `inputTokens` / `outputTokens`, not only the total. A provider that reports a split now shows it on these strategies' results instead of leaving it unknown. Plan patch and augment calls also count their cost, which they dropped before.
