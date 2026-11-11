---
"@reactive-agents/trace": minor
"@reactive-agents/diagnose": minor
---

`@reactive-agents/trace` now describes every failure cause in plain words and lists the next steps the diagnosis can justify. `causeDescription(cause)` (table `CAUSE_DESCRIPTIONS`) and `causeNextActions({ cause, subCause })` are typed over the closed `FailureCause` union, so a new cause fails typecheck until it has words. Next steps follow from the cause and its sub-cause only (for example `provider-error` / `model-not-found`: "Check the model name; for Ollama, pull the model first."); a user stop or a healthy run has none. `loadTrace` also accepts JSONL text as `loadTrace({ text })`, and `parseTrace(text)` parses it synchronously.

`rax-diagnose cause` prints the cause's meaning and its next steps under the evidence; `--json` adds `description` and `nextActions`.
