---
"@reactive-agents/reasoning": patch
---

Read-and-answer tasks ("read config.json and tell me ...", "add the two counts") on a surface of only retrieval tools (file-read, web-search, http-get) no longer end as `failure` with a correct answer. The loose prose heuristic derived a `SideEffectLanded` condition that a retrieval-only surface can never meet, so the exit gate denied the answer until the run stalled. `seedPostConditions` now drops it on a retrieval-only surface unless the task names an outward-effect verb (send, post, publish, ...), so "send a message" with only web-search still ends as an honest non-success.
