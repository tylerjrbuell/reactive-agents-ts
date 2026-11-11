---
"@reactive-agents/eval": minor
---

Deterministic graders for typed results. An `EvalCase` can declare `structured` expectations (a partial expected value plus `equals`, `approx`, `contains`, `matches`, `array-contains`, `length` and `type` checks at JSON Pointer paths) instead of a judge. Such cases are graded field by field with no LLM call, scored under the `structured` dimension, and carry per-field `fieldResults` that persist in `EvalStore`. A grade that cannot be decided (no checks, an invalid check) is `inconclusive` and never passes.

New exports: `gradeFields`, `gradeSchema` (Effect Schema validation with JSON Pointer field errors), `gradeStructured`, `runFieldCheck`, `resolveJsonPointer` and their types. `SuiteAgentRunner` may return `structuredOutput`; without it, structured cases parse `actualOutput` as JSON.

`EvalRunSummary.passed`/`failed` now count each result's `passed` flag. For judged cases this is unchanged (`overallScore >= passThreshold`).
