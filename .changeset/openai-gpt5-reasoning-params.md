---
"@reactive-agents/llm-provider": patch
---

OpenAI: every `gpt-5*` and `o<digit>` model id now sends `max_completion_tokens` (previously only ids listed in the static capability table did, so `gpt-5-mini` and any live-discovered or dated id failed with `400 Unsupported parameter: 'max_tokens'`). These models also reject a non-default `temperature`, so it is omitted for them. groq, xai and litellm are unchanged.
