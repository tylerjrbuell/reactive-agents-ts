---
"@reactive-agents/trace": patch
---

`attributeFailure` (and `rax-diagnose attribute`) now attributes a run whose failure cause is `strategy-error` to the harness, as the new reason `harness:strategy-error` (probable, from the cause). A strategy body that throws or refuses the run's configuration is the framework's fault; it was `unattributed` before. A strategy body that failed on a model call is still `provider-error` and attributes to `environment:provider-error`.
