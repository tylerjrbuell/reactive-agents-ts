---
"@reactive-agents/llm-provider": patch
---

Capability rows added for `openai/gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `o4-mini`, `anthropic/claude-opus-4-1` and `gemini/gemini-2.0-flash`. These ids used to resolve to the made-up 4096-token fallback window, so UIs showed no context meter and context logic sized against a wrong window. They now resolve to a static row with the model's real context window and max output.
