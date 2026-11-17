---
"@reactive-agents/core": minor
---

`PlanStep` gains optional `dependsOn` (ids of prerequisite steps) and `args` (tool arguments). Both survive the Markdown, JSON and HTML plan formats and `planFromChecklist` (via `meta.dependsOn` / `meta.args`). Importing a plan with an unknown step id, a self reference or a cycle in `dependsOn` fails with a `PlanParseError` (`invalid-shape`). New helper `findPlanDependencyProblem(plan)` runs the same check.
