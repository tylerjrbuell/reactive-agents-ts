---
"@reactive-agents/runtime": minor
---

Goal supervisor reads the run's own verdict. `GoalSegmentResult` gains an optional `run` field (`GoalRunOutcome`), built with the new `goalRunOf(agentResult, events?)`. When it is set, `evaluateGoal`/`pursueGoal` never call a goal achieved if the run's exit gate denied completion (`goalAchieved: false`) or RunContract requirements stayed outstanding. Progress then comes from the summed `RunAssessment.evidenceDelta` (`AssessmentEmitted` events), so a turn that used only meta tools does not count as progress. `progressed` is now optional and acts only as a fallback when `run.evidenceDelta` is absent. Callers that do not set `run` see no change.
