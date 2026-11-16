---
"@reactive-agents/tools": patch
---

`todo` add accepts a structured per-step tool: a `tools` array parallel to `items`, or `{text, tool}` items. The hint lands on the checklist row's `tool` field, so plan cards show the tool without it being written into the step text. `todo` add also skips rephrased duplicates (80% word overlap, or wholly inside an existing title of 3 or more words) instead of only exact repeats.
