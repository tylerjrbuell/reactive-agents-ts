---
"@reactive-agents/reactive-intelligence": patch
---

Skill distillation reports what really happened. One skill whose refinement fails (or dies) no longer aborts the whole pass: it is recorded in `failures` and the other skills still refine. A refine that returns the same content (no LLM, LLM fallback, identical output) counts as `unchanged`, not `refined`. `DistillationResult` is now `{ refined, unchanged, skipped, failed, failures }` (the never-populated `errors` field is replaced by `failed`).
