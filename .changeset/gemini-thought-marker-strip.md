---
"@reactive-agents/llm-provider": patch
---

Gemini (gemini-2.5-flash) sometimes starts visible text with a bare `thought` line, as plain text rather than a thought part, so it leaked into answers as a literal "thought" prefix. The Gemini adapter now strips exactly one leading `thought` line from visible content on both `stream()` and `complete()`. Text that only starts with the word (for example "thoughtful ..." or "Thought: ...") is left alone.
