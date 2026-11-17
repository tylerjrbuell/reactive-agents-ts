---
"@reactive-agents/reasoning": patch
---

Under plan posture, a model that already recorded a plan can no longer grow it with rephrased `todo add` rows. An add whose steps restate existing rows (core's near-duplicate rule, or at least 60% of the smaller title's key words already present) is answered with the existing list and one line, "A plan is already recorded (N steps). Edit or remove rows instead of adding rephrased ones, or finish."; genuinely new steps in the same call are still added. Plan-posture `todo` edits are capped at 3 per turn, and each intervention emits a `plan-todo-churn` guard event. A rejected `request_user_input` call now includes a valid `questions` example.
