---
"@reactive-agents/reasoning": patch
---

After two unresolvable tool-call replies, tools are now withheld for exactly one think call. Once the model answers that call in prose, the next call offers tools again. Before, the withhold lasted until a tool call succeeded, which could never happen with no tools offered, so the run abstained.
