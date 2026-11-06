---
"@reactive-agents/cortex": patch
---

Chat goals take progress from the run, not a Cortex heuristic. Each goal segment passes `run: goalRunOf(...)` to the supervisor: progress is the sum of the turn's root-run `AssessmentEmitted.evidenceDelta`, so meta-tool-only turns (for example to-do ticks) and failed tool calls no longer count as progress. A segment whose run reports `goalAchieved: false` or outstanding requirements is never marked achieved. Ordinary chat turns (`session.chat()`) do not expose that exit-gate verdict yet, so the veto applies once the runtime reports it.
