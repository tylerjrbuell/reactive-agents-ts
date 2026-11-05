---
"@reactive-agents/llm-provider": minor
---

`CompletionRequest` accepts an optional `thinking?: boolean` that overrides `LLMConfig.thinking` for one call. `false` turns thinking off for that call (Ollama `think: false`, Anthropic without a thinking block, Gemini `thinkingBudget: 0`, OpenAI and LiteLLM without `reasoning_effort`; models that always reason keep the server default). `true` turns it on where the model supports it. Leaving the field out keeps today's request exactly as it was.
