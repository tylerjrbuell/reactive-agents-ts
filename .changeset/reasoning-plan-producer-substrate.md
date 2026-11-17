---
"@reactive-agents/reasoning": minor
---

Strategy planners plan from one shared context, and a strategy run can no longer finish `completed` with plan steps left open. The `blueprint` and `plan-execute-reflect` planner calls (generate, patch, augment) now carry the plan-only posture, the tool catalog with each tool's parameters and read or write effect, and the env date and timezone (the date rule appears when a tool takes a date). Plan-execute's planner now sees tool descriptions and parameters, as blueprint's already did.

Tool-call arguments are checked against the tool schemas when the plan is made. A missing required argument, or a date the goal does not give (a baked `2024-11-21` on a 2026 run), is no longer dispatched as written: the step becomes a composite step and the model chooses the argument when it runs. A relative phrase the goal used (`tomorrow`) resolves against the env date. A step typed `analysis` that names a tool becomes a composite step scoped to that tool. A `plan-args-validated` guard event lists the findings.

Each plan step now ends `done`, `skipped` or `failed` in `result.metadata.planSteps`. Blueprint's step executor finishes steps its worker does not run; a step the budget no longer allows stays open, the run is `partial`, `metadata.planIncomplete.open` names it, and a `plan-incomplete` guard event is published (this replaces blueprint marking unrun steps done). Plan-execute sends a SATISFIED reflection on a plan with unrun steps back to run them. Both strategies' final synthesis call chooses over-long step results by relevance to the goal within the model's evidence budget, names what it left out, and records the choice in a `solve-evidence` guard event.
