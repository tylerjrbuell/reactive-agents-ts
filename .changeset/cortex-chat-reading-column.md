---
"@reactive-agents/cortex": patch
---

The chat reads as one wider column. The transcript, the to-do dock, the error banner and the composer share one width (58rem) and line up edge to edge; before, the transcript was narrower than the composer and left much of a wide screen empty. Answer text still wraps at a comfortable line length (about 80 characters), while code blocks, tables and tool cards use the full column. The run view's Answer follows the same rule. Under 900px the gutters drop to 16px.
