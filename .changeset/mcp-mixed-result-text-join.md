---
"@reactive-agents/tools": patch
---

MCP tool results that mix text items with image, audio or resource items now keep the line breaks between adjacent text items. `mapMcpToolResult` merges each run of adjacent text items into one text part joined with "\n", so the kernel's text view of `[text "a", text "b", image]` is `"a\nb"` (it was `"ab"`), matching text-only results. Text-only results are unchanged.
