---
type: debrief
created: 2026-09-22
tags: [type-safe, jev, judgment, eval, judge-server]
---

# TypeSafe/Jev Judgment Primitive — Phase A + Phase B Debrief

Plan: [[Implementation-Plans/2026-09-20-typesafe-judgment-layer]]. Covers Phase A (shared judgment
infrastructure, Tasks 0–2b) and Phase B (judge/eval measurement overhaul, Tasks 3–7), both implemented
and tested 2026-09-22. **Uncommitted on `dev` as of this debrief** — this is an engineering record of
what shipped, not a claim that it's merged.

## What shipped

**Phase A** — `@reactive-agents/judgment` (new package): `JudgmentService` over a `JudgmentBackend`
interface, two backends (`jev` wraps `@typesafe-ai/sdk`; `llm` emulates via RA's own
`LLMService.completeStructured()`, keyless-relative to TypeSafe). 17 tests, 45 assertions.

**Phase B** — judge/eval measurement overhaul, front-loaded per the plan's core thesis ("build the ruler
before you measure with it"):
- `packages/eval`: `judgeEngine: "jev"|"llm"` seam, default `"jev"`. Four dimensions
  (accuracy/relevance/completeness/safety) scored via ONE batched Jev Score request per case instead of
  four separate `parseFloat(...) || 0.5` LLM calls. `repeats` config + `dimensionVariance` on
  `EvalRunSummary`. `checkRegression`/`compare` use a minimum-detectable-effect threshold when variance
  data is available, flat-epsilon fallback otherwise.
- `packages/judge-server`: `judgeEngine: "jev"` option on `/judge` (default stays `"llm"` — a standalone
  network service some deployments run keyless). One batched Noul(`passed`)+Score(`overallScore`)+
  Choice(`recommendation`) request, no text parsing.
- `packages/eval/src/stats/variance.ts`: mean/stddev/CI/MDE + a reusable calibration-bucketing function.

## Verification (all real, no fabricated numbers)

| Package | Tests | Build | Typecheck |
|---|---|---|---|
| `judgment` | 17 pass / 0 fail | clean | clean |
| `eval` | 54 pass / 0 fail | clean | clean |
| `judge-server` | 37 pass / 0 fail | n/a (runtime-only pkg) | clean |
| `core` (regression) | 172 pass / 0 fail | clean | — |

Cross-package sweep: **280 pass / 0 fail**, 616 assertions. `check-version-sync.sh`: 35/35 packages match
`VERSION=0.16.0`. `doc-drift` gate caught two real misses (new package missing from `AGENTS.md`'s
dependency tree, twice — once for `judgment` itself, once for `eval`'s new dependency on it) — both fixed.

One real bug caught by TDD, not by review: `judgment-handler.ts`'s "unexpected answer shape" guard
originally used `throw` inside `Effect.gen`, which is a **defect** (`Die`), not a typed failure —
`Effect.either` can't observe it. The "never fabricates a verdict" test failed immediately, exposing it;
fixed to `yield* Effect.fail(...)`. Concrete evidence for why the project's "no throw" rule exists, not
just doctrine.

## Deviations from the written plan (all documented in-place in the plan file, summarized here)

1. **Task 1:** flat response records (`NoulAnswer`/`ChoiceAnswer`/`ScoreAnswer`) use `Schema.Struct`;
   generic/union request specs stay plain types — matched against real precedent in `llm-provider/types.ts`
   rather than applying the Schema-everywhere rule mechanically.
2. **Task 2b / Global Constraints:** `packages/judgment` depends on `llm-provider` (not "core only" as
   originally scoped) — reuses RA's existing Schema-validated structured-output pipeline
   (`completeStructured`) instead of duplicating it behind a hand-rolled interface.
3. **Task 3+4:** merged into one module (`judgment-dimensions.ts`) rather than a separate
   `judgment-judge.ts` + dimension-file edits. The four `dimensions/*.ts` files were left **untouched** —
   `scoreDimensionsWithEngine` intercepts before they run, which makes the `llm` fallback path provably
   byte-identical (it's literally the same unedited code) rather than a parallel branch to keep in sync.
4. **Task 4:** Score only, no Noul (none of the four dimensions is a yes/no judgment). Whole-batch
   degrade falls through to the real `llm` engine rather than an `"inconclusive"` marker — a real
   measurement beats a placeholder when one is available at the same call site for free.
5. **Task 5:** no per-requirement `layerResults` decomposition — `JudgeRequest.taskCriteria` is an
   unstructured string, nothing to decompose without a separate contract change. `handler.ts`'s
   `parseJudgmentText`/`judge_parse_failure` degrade was **not** renamed or deleted — confirmed its real
   consumer (`benchmarks/src/judge.ts`) already discards it as `inconclusive`, and it's still load-bearing
   for judge-server's `llm`-default path.
6. **Task 6 Steps 4–5 partially open, flagged honestly, not silently dropped:**
   `cost-efficiency`'s `/1000` normalization was not made explicit/config-driven. **Step 5's methodology
   gate (frozen-dataset `llm`-vs-`jev` agreement study) has not been run** — it needs a real benchmark
   execution with actual cost, not more code, and no results are invented here. The POC in the plan (10
   synthetic pairs, r=0.988 calibration parity, ~5x lower variance, ~10.7x cheaper) motivated shipping
   `jev` as the eval default; it is not a substitute for Step 5's larger RA-domain study.

## Post-implementation code review (2026-09-22, `/code-review medium`)

3 real findings, all fixed before commit, all with new regression tests proving the fix (not just
re-running the existing suite):

1. **`withEvents` never wired into any production layer** — only exercised in unit tests, so
   `JudgmentEvaluated`/`JudgmentFailed` were dead in every real deployment despite Task 2 Step 4 being
   marked done. Fixed: `judge-server`'s `buildJudgmentLayer()` now decorates with `withEvents` + its own
   `EventBusLive`. New test proves `Layer.suspend` laziness survived the change (server starts, no
   `TYPESAFE_API_KEY`, without crashing).
2. **Case-to-case quality spread was conflating with judge repeat-noise.** `runSuite`'s variance
   accumulator flattened every case's scores into one array before computing stddev — two cases scoring a
   rock-steady 0.95 and 0.60 (zero judge noise, real quality gap) would report ~0.175 stddev as if it were
   noise. Fixed with a proper pooled-variance formula (`pooledStats()`) operating on each case's own
   `RepeatStats`, never a flat concatenation. 4 new unit tests.
3. **Intra-case engine mixing.** A case's repeats could silently blend calibrated `jev` samples with
   uncalibrated `llm` fallback samples if `jev` flaked on only some repeats — nothing tracked provenance.
   Fixed: `scoreDimensionsWithEngine` now returns which dimensions each pass actually answered via `jev`;
   aggregation uses only a dimension's jev-sourced samples once any pass succeeded via jev. Proven
   end-to-end: a jev backend flaking on 1 of 5 calls, paired with a deliberately-far-off llm fixture, still
   produces the case's exact jev-only score with `stddev: 0`.

Re-verified after fixes: 286/286 pass (up from 280), 631 assertions. `check-version-sync.sh` 35/35.

## Open items / next steps

- Run Task 6 Step 5's methodology gate against a real, larger, RA-domain frozen dataset; file to
  `wiki/Research/Harness-Reports/`.
- `cost-efficiency` normalization still implicit (Task 6 Step 4 residue).
- Phase C (runtime `.withJudgment()` tier: strategy-selection, comprehend, guardrails, healing, plus the
  two newly-folded-in sites — the `cost` package's complexity router and `interaction`'s autonomy/approval
  confidence) not started.
- Everything in this debrief is uncommitted on `dev` — no PR opened yet.

See also: [[project_typesafe_judgment_layer_2026_09_22]] (session memory), [[feedback_reverify_staged_diff_before_commit]].
