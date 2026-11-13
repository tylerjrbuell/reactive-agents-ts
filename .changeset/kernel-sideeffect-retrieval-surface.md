---
"@reactive-agents/reasoning": patch
---

Read-and-answer tasks ("read config.json and tell me ...", "add the two counts and reply with the sum") no longer end as `failure` with a correct answer. The prose heuristic that derives a `SideEffectLanded` condition paired a mutation verb and a resource noun anywhere in the task text, so a harness line like "Working directory for this task: ..." plus the answer-shaped "reply"/"add" seeded a condition nothing a read can meet. Verb and noun must now share a sentence or line, so "send an email to the team" still derives it and a read-and-answer prompt with a preamble does not.
