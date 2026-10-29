---
"@reactive-agents/cortex": minor
"@reactive-agents/runtime": patch
"@reactive-agents/core": patch
---

Cortex chat gains user-started `/goal` (propose, accept, pause/resume/cancel/status over a pure goal supervisor), `/plan`, `/loop` and `/schedule`, plus prompt/provider/model chips, a document-failures banner, a per-session URL document cache, and run hierarchy keyed by each run's own `contextRunId`. `@reactive-agents/runtime` exports the goal supervisor; `AgentStarted`/`AgentCompleted` now carry the run's `runId`; a failed child's cost is folded into the parent's cost like a successful one.

Goals change no default and add no model-visible prompt outside a goal the user starts, so no ablation applies. Nothing here is claimed to improve results. A goal verdict of `null` means "not yet decided".
