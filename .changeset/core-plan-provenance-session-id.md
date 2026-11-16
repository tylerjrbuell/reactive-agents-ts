---
"@reactive-agents/core": patch
---

Checklist items can now be marked `origin: "harness-derived"` (a checklist the harness derived from model output; such rows stay explicit or inferrable, unlike `"plan"` rows) and can carry an optional `tool` hint that survives the ledger fold into `ChecklistRow` and `planFromChecklist` / `planToChecklistSeed`. `PlanRecorded` and `PlanStepStatusChanged` events gain an optional `sessionId`. All additions are optional; existing data decodes unchanged.
