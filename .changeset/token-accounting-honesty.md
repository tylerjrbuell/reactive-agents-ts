---
"@reactive-agents/llm-provider": minor
"@reactive-agents/core": minor
"@reactive-agents/runtime": minor
"@reactive-agents/ui-core": minor
"@reactive-agents/cortex": patch
---

Token accounting honesty. Provider-native `reasoningTokens` (OpenAI/LiteLLM `completion_tokens_details.reasoning_tokens`) now ride `TokenUsage` and are marked as a subset of output tokens, never added to the total. The cache-adjusted `billedTokens` figure the runtime already computed is projected onto the public `TokenUsage` stream event and folded into ui-core usage, so callers can show billed alongside raw tokens. Cortex surfaces billed and reasoning per call and in the Inspector Context tab, uses the runtime's 45/75/90 context thresholds in live estimates, and persists cancelled/errored chat turns (partial reply, spent tokens, and cost) marked incomplete instead of dropping their spend from session totals.
