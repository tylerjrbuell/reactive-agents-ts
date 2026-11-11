---
"@reactive-agents/llm-provider": minor
"@reactive-agents/core": patch
"@reactive-agents/reasoning": patch
---

Token usage halves are now optional: a count the provider did not report is unknown, never a measured 0.

- `TokenUsage.inputTokens` / `outputTokens` are optional. Ollama leaves a half out when `prompt_eval_count` / `eval_count` is absent. OpenAI and LiteLLM streams emit no usage event when no usage chunk arrives, and `complete()` falls back to input + output when `total_tokens` is missing.
- Gemini now counts thinking tokens (`thoughtsTokenCount`) in `outputTokens` and reports them as `reasoningTokens`, matching the SDK's `totalTokenCount`. Totals and cost for Gemini thinking models rise to the honest figure.
- Reasoning sums a half only when every contributing call reported it. `LLMRequestCompleted` omits `tokensIn` / `tokensOut` / `billedTokens` it cannot know, and strategy direct calls (reflexion critique, plan-execute synthesis and patches) now carry the provider split.
- Core `DebriefPayload.metrics.synthesisTokens.input` / `output` are optional.
