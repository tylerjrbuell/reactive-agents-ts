---
"@reactive-agents/runtime": patch
---

Chat and gateway turns now classify intent on the current user message only. Tool-relevance and literal-mention detection, strategy and complexity routing, task classification, and skill and experience lookups no longer read the inlined conversation-history block, so an old turn that named a tool or action no longer drives the current turn.
