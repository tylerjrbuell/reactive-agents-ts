---
"@reactive-agents/cortex": patch
"@reactive-agents/ui-core": patch
---

A model that prints its reasoning into the visible reply (a bare `thought` marker followed by "The user wants...", "I'll...", "Let me...") no longer shows that reasoning as the answer. `splitReasoning` now moves the leading reasoning block to the Thinking pill even when no reasoning channel reported it, ending the block at the first blank line or the first markdown structure (heading, list, table, fence), and while the turn streams the unfinished block stays in the pill. A first line that does not read as reasoning, or an answer that merely starts with the word "thought", is left untouched. Reloaded turns replay the pill from the stored text, and Copy, Read aloud, voice replies and "copy conversation" use the answer only.
