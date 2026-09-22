---
"@reactive-agents/judgment": minor
"@reactive-agents/eval": minor
"@reactive-agents/judge-server": minor
"@reactive-agents/core": patch
---

New `@reactive-agents/judgment` package: a calibrated typed-judgment primitive
(Choice/Score/Noul with probabilities) over a provider-abstracted
`JudgmentBackend` — `jev` (TypeSafe's System One model, `@typesafe-ai/sdk`)
and `llm` (structured-output emulation over your existing `LLMService`, no
TypeSafe key required). Every judgment call emits `JudgmentEvaluated`/
`JudgmentFailed` EventBus events.

`@reactive-agents/eval` now scores the four LLM-judged dimensions
(accuracy/relevance/completeness/safety) via the `jev` engine by **default**
— one batched request per case instead of four separate float-prompt LLM
calls, with real calibrated `confidence` (was: `parseFloat(...) || 0.5`, a
silent 0.5 on any parse failure). The original LLM-judge path is unchanged
and selectable via `judgeEngine: "llm"`; with no `JudgmentService` wired at
all, behavior is byte-for-byte identical to before this release.
`EvalConfig.repeats` (default 1) enables repeated-scoring runs whose
variance now drives `checkRegression`/`compare` via a statistically-derived
minimum-detectable-effect instead of a flat ±0.02/±0.05 epsilon — the same
flat fallback still applies to `repeats:1` runs.

`@reactive-agents/judge-server`'s `/judge` endpoint gains a `judgeEngine:
"jev"` option (default remains `"llm"`) that answers `passed`/`overallScore`/
`recommendation` from one batched Noul+Score+Choice request instead of a
text prompt parsed with `indexOf("{")`/`JSON.parse`.

No default-runtime-path behavior changes for existing agents — this release
is the measurement-tooling layer (Phase B of the judgment-primitive plan,
`wiki/Planning/Implementation-Plans/2026-09-20-typesafe-judgment-layer.md`).
The runtime `.withJudgment()` opt-in tier (Phase C) ships separately.
