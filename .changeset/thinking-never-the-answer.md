---
"@reactive-agents/reasoning": patch
---

Model thinking is no longer shipped as the answer. When a thinking model returned an empty answer channel and only reasoning text, plan-execute, blueprint, reflexion and the kernel's terminal synthesis used that reasoning as the deliverable, and the run could report success with output like "Let me check the workspace...". These sites now read the answer channel only (`extractDeliverableContent`); an empty answer fails the step or leaves the run unanswered with a cause, instead of succeeding.

Planner and plan-repair calls also no longer label their `ReasoningStepCompleted` events `structured-output-native`; they carry the strategy that ran (`plan-execute-reflect`, `blueprint`), so dashboards stop reporting a strategy switch that never happened.
