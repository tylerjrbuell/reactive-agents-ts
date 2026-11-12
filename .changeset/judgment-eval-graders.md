---
"@reactive-agents/eval": minor
"@reactive-agents/judgment": minor
---

Eval cases can now be graded by a calibrated judgment rubric, after the deterministic checks.

- `EvalCase.rubric` asks one `JudgmentService` question (Noul yes/no, Choice, or Score) and states what passes: `passWhen: { minProbability }`, `{ accept: [...] }`, or `{ minScore }`, with an optional `minConfidence` (default 0.6).
- Order: `structured` checks run first. The rubric is asked only when they pass or are absent, so a case that data already failed costs no judge call.
- A grader that cannot decide says so. Low confidence, any `JudgmentError`, a wrong answer kind, an invalid rubric, or no `JudgmentService` wired gives `verdict: "inconclusive"`, never a guessed pass. An uncalibrated backend (the `llm` emulation) must reach confidence 0.8 or the verdict is inconclusive.
- `EvalResult` gains `verdict`, `rubric` (raw answer, score, confidence, calibrated, backend, reason) and a per-check `checks` breakdown. `EvalRunSummary.inconclusive` counts undecided cases apart from `passed` and `failed` and leaves them out of the averages. Stored runs stay readable; the new fields are additive.
- `checkRegression` also compares the pass rate over decided cases and returns `passRate` and `inconclusive` counts. Inconclusive cases are never counted as passes.
- `JudgmentService` exposes an optional `backend` name so verdicts record which judge answered.
- New exports: `gradeRubric`, `readRubricAnswer`, `rubricProblem`, `gradeCase`, `RubricSchema`, `RubricVerdictSchema`, `CaseVerdictSchema`, `RUBRIC_DIMENSION`.
