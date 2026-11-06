---
"@reactive-agents/llm-provider": patch
---

Structured calls now report each native attempt. `completeStructured()` leaves `attempts` (one `StructuredAttemptReport` per attempt: tokens, stop reason, thinking size, parsed or not) on the usage it sets in `StructuredUsageRef`, on success, on parse failure, and when a later attempt's provider call fails after earlier attempts ran. Stop reason comes from every adapter (Ollama `done_reason`, Anthropic `stop_reason`, OpenAI/LiteLLM `finish_reason`, Gemini raw `finishReason`); an unmapped token is reported raw instead of as `end_turn`. Thinking size comes from Ollama `message.thinking`, Anthropic `thinking` blocks and LiteLLM `reasoning_content`; OpenAI Chat Completions and Gemini (no `includeThoughts`) return no reasoning text, so they report none. New exported types: `StructuredCallUsage`, `StructuredAttemptResult`.
