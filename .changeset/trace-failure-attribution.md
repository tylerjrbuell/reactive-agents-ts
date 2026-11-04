---
"@reactive-agents/trace": patch
"@reactive-agents/diagnose": patch
---

Harness-vs-model failure attribution (zero tokens). New `attributeFailure(trace)` in `@reactive-agents/trace` answers "is it my harness configuration or the model?" for any recorded trace, with or without an `eval-graded` grader verdict. It locates the divergence turn (the `llm-exchange` that produced the failing file or answer), checks whether the tool results the run obtained were in that turn's projected request, and returns a verdict (`harness` / `model` / `unattributed` / `not-failed`), a reason (`harness:false-veto`, `harness:tool-surface`, `harness:tool-call-dropped`, `harness:tool-call-corrupted`, `harness:premature-stop`, `harness:evidence-truncated`, `harness:evidence-missing`, `harness:misleading-guidance`, `model:ignored-guidance`, `model:had-evidence-wrong-output`), a confidence, `eventKind#seq` evidence and the missing signals. New CLI `rax diagnose attribute <runId|path> [--json]` and `attribute --all <dir>` (counts by verdict and reason); `rax diagnose cause --json` gains an `attribution` field.
