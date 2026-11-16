---
"@reactive-agents/reasoning": minor
---

Plan-execute and blueprint now publish the typed `PlanRecorded` event when their plan first appears or its step set changes (including patches), and `PlanStepStatusChanged` for each step status change, from the same sync that writes their plan checklist rows. Strategy plans reach subscribers through the same events as `agent.plan()`, with the strategy run's task id as the plan id. Step-title de-duplication (derived checklists, patch and augment steps) now uses core's shared `isNearDuplicateTitle` rule.
