---
"@reactive-agents/runtime": patch
---

Stored skills now track their own usage. After each run, every SkillStore skill the run used (pinned, relevance-activated, or loaded with `activate-skill`) gets `useCount`, `successRate` and `lastActivatedAt` updated from the run outcome: a failed run counts against the skill and an abstained run adds no evidence. Needs memory on, where the skill store lives.

Fix: the run's skill resolver now sees the SkillStore. Before, it was built as a sibling layer and never got the store, so stored skills (learned ones, or ones added with `agent.loadSkill()`) were missing from every run's catalog and could not be pinned or activated.
