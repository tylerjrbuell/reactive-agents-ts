---
"@reactive-agents/judgment": patch
---

`JudgmentService.ask` accepts `priority: "shadow"` for observation-only calls. Shadow asks run through a per-service gate (default 1 in flight, 8 queued, 5 s budget, no retry); excess asks fail fast with the new `JudgmentShadowDropped` error and are counted, readable via `shadowStats()`. Explicit asks (the default) are never gated or dropped. Callers that fire shadow judgments must pass `priority: "shadow"` to get the cap.
