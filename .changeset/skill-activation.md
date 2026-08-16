---
"@reactive-agents/runtime": minor
---

Added — skill activation (auto + explicit)

`.withSkills({ paths: [...], activate: [...] })`'s `activate` option now
injects a named skill's full instructions into context at bootstrap, with
task-relevance-based auto-activation on top — skills were previously only
shown in a discoverable catalog, never actually loaded into the model's
context.
