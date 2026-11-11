---
"@reactive-agents/llm-provider": minor
---

Anthropic `completeStructured()` now enforces the output schema. It forces one call to a tool whose `input_schema` is your schema (`tool_choice: { type: "tool" }`) and returns the tool input, instead of asking for JSON in the prompt and prefilling `{`. A non-object schema (an array, a union) travels as a `value` property and is unwrapped. When extended thinking is on for the call, Anthropic does not allow a forced tool, so that call keeps the prompt-and-prefill path. Anthropic now reports `nativeJsonMode: true` and `jsonSchemaEnforcement: true` from `getStructuredOutputCapabilities()`, so the structured-output pipeline uses its native layer for Anthropic before any prompt-mode fallback. Usage reporting and `LLMParseError` on repeated schema failures are unchanged.
