---
"@reactive-agents/reasoning": patch
---

The repetition guard no longer counts calls that never ran. A call the tool gate refused or a guard blocked was counted as a prior call, so the first real read or write of a target could be replaced by "You have already called file-read 13 times" and never execute. Prior-call counts, the distinct-target and distinct-argument carve-outs, and the last-call lookup now read only calls that executed.
