---
"@reactive-agents/reasoning": patch
---

Observation-only judgment asks (completion, grounding-fabrication, task comprehension, strategy selection) now pass `priority: "shadow"`, so the JudgmentService concurrency gate bounds them instead of letting bursts starve real work. No run decision changes.
