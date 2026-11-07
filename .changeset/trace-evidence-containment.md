---
"@reactive-agents/trace": minor
"@reactive-agents/diagnose": minor
---

`rax-diagnose attribute` blames cut-off evidence (`harness:evidence-truncated`, `harness:evidence-missing`) only when a URL the run delivered was really hidden from the turn that wrote it. New reason `harness:unrepaired-content`: a text deliverable was written with literal `\n` sequences instead of newlines, which a repair at the write boundary would have fixed.
