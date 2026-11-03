---
"@reactive-agents/trace": patch
"@reactive-agents/diagnose": patch
---

`rax-diagnose cause`: aborted runs are labelled from `run-aborted.reason` (`timeout`, `user-stop`, `aborted/<reason>`) instead of generic `incomplete-trace`; `llm-direct.jsonl` direct-chat traces return `direct-chat` and are excluded from cohort totals; successes accepted via `advisory-softfail` or with failed verifier checks are `success-with-warning` instead of `none`; `run-completed.status` contradicting `outcome.success`/`outcome.status` is `terminal-mislabel`; provider sub-class reads `outcome.errorClass` (text regex stays as legacy fallback).
