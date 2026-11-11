---
"@reactive-agents/cortex": minor
---

Run view: a **Why it ended** card diagnoses every finished run with the framework's own trace diagnosis (`analyzeCause` + `attributeFailure` from `@reactive-agents/trace`, the engine behind `rax-diagnose cause`). It shows the cause in plain words, harness vs model vs environment attribution, and the decisive steps, each linked to its trace row; it opens by itself for failed, abstained, partial and stopped runs. New route `GET /api/runs/:runId/cause` (cached per run until the trace file changes).
