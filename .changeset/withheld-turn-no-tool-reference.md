---
"@reactive-agents/reasoning": patch
---

When the kernel withholds tools for one think call, the system prompt for that call no longer lists tools. The in-prompt tool reference, the text-parse call grammar ("How to Call a Tool"), the tool-index note, the rationale block and the checklist line are all left out, and the recall pointers in tool results drop with them. Before, a text-parse model could read "Available Tools" on a turn that offered none.
