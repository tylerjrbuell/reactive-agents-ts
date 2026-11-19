---
"@reactive-agents/llm-provider": patch
---

Gemma models on the Gemini provider work again. Every Gemini request used to carry `thinkingConfig` (budget 0 when thinking was off), and Gemma models such as `gemma-4-26b-a4b-it` reject that field with `Thinking budget is not supported for this model.`, so the run failed before its first step. `thinkingConfig` is now sent only to models whose capability says they support thinking. Gemma ids resolve to `supportsThinkingMode: false` with their real window (gemma-4: 262144 input, 32768 output; other Gemma generations: a conservative 32768 / 8192), even when the model listing reports `thinking: true`. If the API still rejects the thinking field for some other model, the provider retries that request once without it, prints a one-time warning naming the model, and stops sending the field for that model.
