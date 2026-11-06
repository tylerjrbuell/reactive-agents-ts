---
"@reactive-agents/llm-provider": minor
---

`CompletionRequest` has a new optional `toolChoice: "auto" | "required"`. `"required"` makes the response carry at least one call to a tool in `tools`, on `complete()` and `stream()`. Anthropic gets `tool_choice: { type: "any" }`, with extended thinking turned off for that call because Anthropic does not accept both. OpenAI, Groq, xAI and LiteLLM get `tool_choice: "required"`. Gemini gets `functionCallingConfig.mode: "ANY"`. Ollama uses constrained decoding: `format` is a JSON schema that only accepts a call to one of the offered tools, and the result comes back as a normal tool call. If the output does not parse, it comes back as plain text. Leaving `toolChoice` out, or setting `"auto"`, sends the same request as before. Also new: `ToolChoice` type and `isToolCallRequired()` helper exports.
