---
"@reactive-agents/reasoning": patch
---

Media parts no longer vanish inside the kernel. Context compaction and the projection trace now count each image, audio or file part as a fixed 4,000 chars (`MEDIA_PART_CHARS`, about 1,000 tokens) instead of 0, so a thread with many images can trigger compaction. An assistant turn made of parts is now recorded as a thought. The prompt trace on thought events and the `ContextSynthesized` payload flatten messages the same way the `llm-exchange` trace does, so tool-use blocks show as `[tool_use:<name>]` instead of an empty string. Text-only runs send the same bytes as before.
