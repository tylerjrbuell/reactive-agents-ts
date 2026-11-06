---
"@reactive-agents/llm-provider": patch
---

LiteLLM now sends an assistant turn's tool calls as OpenAI-format `tool_calls` (id, `function` type, name, JSON-string arguments). Before, the request kept the `tool` result messages but dropped the `tool_calls` entry that they answer. OpenAI-compatible backends behind the proxy rejected that thread with HTTP 400 on the turn after a tool call. `complete()`, `stream()` and structured output now use the same message mapping as the OpenAI provider.
