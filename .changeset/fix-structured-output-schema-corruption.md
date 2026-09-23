---
"@reactive-agents/llm-provider": patch
---

Fix `completeStructured()` sending a corrupted output schema on all 5 providers (local, openai, gemini, anthropic, litellm). Each built the schema via `Schema.encodedSchema(outputSchema)`, which returns another Effect `Schema` instance rather than a JSON-serializable object — `JSON.stringify()` on it evaluates to `undefined`. On local/openai/gemini this crashed with `SyntaxError: JSON Parse error: Unexpected identifier undefined`; on anthropic/litellm it degraded silently, sending the model the literal text `"undefined"` in place of the real schema. Fixed by using `JSONSchema.make()` instead.
