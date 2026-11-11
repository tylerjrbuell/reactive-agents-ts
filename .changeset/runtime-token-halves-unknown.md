---
"@reactive-agents/runtime": patch
---

Unknown token halves are reported absent, never 0. When a provider reports only a total for some call, the run result omits `inputTokens` / `outputTokens` (a one-sided split is never published), and the debrief's `metrics.synthesisTokens` omits `input` / `output` the provider did not report. `tokensUsed`, cost and call counts are unchanged.
