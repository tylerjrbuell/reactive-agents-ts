---
"@reactive-agents/cortex": patch
---

The run view's **Why it ended** card now uses the framework's own cause descriptions and adds **What to try**: the next steps `causeNextActions` gives for the cause (the same lines `rax-diagnose cause` prints). `GET /api/runs/:runId/cause` returns them as `nextActions`.
