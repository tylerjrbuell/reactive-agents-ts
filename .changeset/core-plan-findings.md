---
"@reactive-agents/core": patch
---

`Plan` gains optional `findings` (`PlanFinding`: `id`, `tool`, `summary`, optional `at`): facts learned by plan recon that travel with the plan. `planFromChecklist` accepts `meta.findings`, `PlanRecorded` carries them, and the portable formats round trip them (Markdown `## Findings` section, JSON envelope, escaped HTML section). Plan format version stays 1; plans without findings are unchanged.
