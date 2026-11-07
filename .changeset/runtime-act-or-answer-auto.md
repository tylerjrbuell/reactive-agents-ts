---
"@reactive-agents/runtime": patch
---

`.withHarness({ actOrAnswer: "auto" })` picks forcing per model.

- `"auto"` resolves once at run start: the model's learned `calibration.actOrAnswer` when the run has one, else retry on Ollama and off on every other provider. Still opt-in; the default stays off.
- `run-started.config` records the mode the run uses as `mechanisms.actOrAnswer` (never `"auto"`) and where it came from as `mechanisms.actOrAnswerSource` (`"explicit"`, `"calibration"` or `"default"`). Calibration is now resolved before `AgentStarted`, from the same value the kernel receives.
- Each run's act-or-answer counts (`noCallStallTurns`, `unforcedToolWorkTurns`, `forcedCalls`, `forcedCallsCalled`, `forcedCallsSucceeded`) now reach the local run observation calibration learns from and the community telemetry report. Runs with no tally leave the fields out.
- `.withOutputSchema(schema, { onParseFail: "throw" })`: a parse failure now rejects `run()` with the parse error and a remediation hint, instead of "Unexpected error: An error has occurred". `StructuredOutputError.message` names the issues.
- The generated config reference lists union field types (for example `boolean | "proactive" | "auto"`) instead of `unknown`.
