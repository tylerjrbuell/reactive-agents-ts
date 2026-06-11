---
"@reactive-agents/runtime": patch
---

Chat history fixes for gateway and tool-capable conversations. Conversation history now seeds the kernel on tool-capable chat turns — including streaming — so multi-turn chats with tools no longer lose prior context. History is presented to the model as a clearly labeled context block rather than synthetic function-calling messages, which removes a class of provider confusion on resumed threads. Local providers default to `numCtx` 8192 so longer histories are not silently truncated by the runtime default context window.
