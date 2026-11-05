---
"@reactive-agents/reasoning": minor
---

When a run writes its own todo list (the opt-in `todo` meta tool), output files named in its items (for example "Read notes-1.txt and write out-1.txt") become required deliverables. The run cannot finish as done until each declared file has actually been written, and the refusal names the missing files. The check reads write evidence, never the item's done/pending mark. Items that name no output file, items carried over from an earlier turn, and sub-agent items declare nothing. Runs without the `todo` tool are unchanged.
