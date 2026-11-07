---
"@reactive-agents/runtime": minor
---

Agents can load a discovered skill mid-run with `activate-skill`. With `.withSkills()`, every workspace (and, with `global: true`, user-global) skill in the run's catalog can be activated by name: the tool returns the skill's instructions, they stay in context for the rest of the run, and a `skill-activated` fact is recorded on the run ledger. `activate-skill({ name, file })` reads one file bundled in the skill's directory. Skills already pinned with `activate` answer "already loaded". Runs without skills offer no `activate-skill` and send the same tools as before. Learned skills from the skill store stay catalog-only for now because they have no directory on disk.
