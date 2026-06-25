---
type: design-spec
status: draft (for review)
created: 2026-06-24
tags: [eval, benchmark, lift-gate, regression, self-improvement, harness, ci, replay]
related:
  - "[[2026-06-24-high-leverage-roadmap-ranking]]"
  - "[[2026-06-17-agentic-orchestration-strategies]]"
  - "[[01-RESEARCH-DISCIPLINE]]"
  - "[[05-DESIGN-NORTH-STAR]]"
---

# Eval + Lift-Gate Harness — Design Spec (L2)

> **One line:** RA already has the eval substrate (5 packages). The gap is they are
> **fragmented, the lift rule is markdown not code, and there is no closed
> bench→score→lift→receipt loop.** This spec makes `@reactive-agents/eval` the
> canonical scoring substrate (industry-standard shape), expresses `benchmarks`
> as suites on top of it, **codifies the project lift rule as `evaluateLiftGate()`**,
> and ships one authoritative gate that serves three callers at once: the internal
> dev/CI gate, the validator that **B** (self-improvement) needs, and the
> user-facing "BYO eval + honest receipts" product.

## 1. Why (the gap is consolidation, not absence)

Code-verified inventory (2026-06-24 audit):

- `@reactive-agents/eval` (published) — `EvalService`, LLM-judge with **frozen-judge Rule-4 guard**, 5 dimension scorers (accuracy/relevance/completeness/safety/cost-efficiency), SQLite history store, `checkRegression`/`compare`.
- `@reactive-agents/benchmarks` (private) — v1 (20 tasks × 5 tiers), v2 (multi-dim scoring, **9-variant ablation ladder**, drift detection, competitor comparison, overhead isolation).
- `@reactive-agents/replay` (published) — deterministic replay + `diffTraces`.
- `@reactive-agents/diagnose` (published) — `rax diagnose list/replay/grep/diff/debrief`.
- `@reactive-agents/trace` (published) — JSONL event schema, recorder, `analyzeRun`, cohort aggregation.

**Five real problems:**

1. **Two overlapping scoring stacks.** `benchmarks` (sessions/ablation/drift) and `eval` (judge/scorers/store) duplicate scoring + judging. No canonical path; "did my change help?" requires running both and eyeballing.
2. **The lift rule is a markdown agent convention, not code.** `≥3pp ∧ ≤15%tok` lives in `.agents/ablation-warden.md`. There is no `evaluateLiftGate()` function and no CI gate — the project's most important discipline cannot fail a build.
3. **No closed loop.** Run → report → human reads → updates MEMORY.md. `replay` proves determinism but is not wired to scoring, so it cannot answer "candidate beats baseline."
4. **Self-improvement is manual one-off scripts** (`ri-ablation.ts`), not a deterministic, reusable gate.
5. **No multi-agent / M8 scenarios** — orchestration (spec 2026-06-17, A/C) has nothing to bench against.

## 2. Industry-standard shape (and how RA already matches it)

Prevailing eval frameworks (OpenAI Evals, UK AISI **Inspect**, Braintrust, promptfoo, DeepEval) share one model:

```
Eval = Dataset (cases) + Target (system-under-test) + Scorers (deterministic + LLM-judge) + Tracking (vs baseline)
```

"Eval" is the framework noun; a "benchmark" is a specific *named suite*.

**Grounded correction (post code-read 2026-06-24):** `eval` and `benchmarks` are
**at different altitudes, not redundant peers** — so "eval canonical, benchmarks
on top" (an earlier framing) is backwards for the *engine*:

- `eval` (`EvalRun`) scores **one** `(agent, suite)` — flat, **no tier / variant /
  multi-run axis**. But it is published, Effect-Schema-validated, frozen-judge
  Rule-4 guarded, with a SQLite store. It is the **product facade + unit scorer**.
- `benchmarks` v2 (`SessionReport`) is the **matrix engine**: `models (w/
  contextTier) × harnessVariants × runs`, and it **already computes**
  `AblationResult.harnessLift`, `perDimensionLift`, `DriftReport` (vs
  `baselineGitSha`), per-cell `variance`, `SessionReproducibility`, and honest
  `inconclusiveCells`/`partialMeasurement`. It is the better engine — just private
  and internal-shaped (plain interfaces, not Effect Schema).

**Decision (corrected):** one *unit scorer* (canonical: `eval`'s frozen judge +
`DimensionScore`), one *matrix engine* (canonical: `benchmarks` v2, which calls
the unit scorer), one *product facade* (`eval`'s public API), and one net-new
*verdict* layer. See the 4-layer model in §3.

**The candidate insight (load-bearing):** a candidate harness mutation is already
expressible as a `HarnessVariant` (`InternalVariant` + `HarnessConfig`, incl.
env-gated `HarnessConfig.env`). So **"baseline vs candidate" is a 2-variant
ablation** — which `benchmarks` already runs and already reduces to
`AblationResult.harnessLift` + `DriftReport.hasRegressions`. The gate adds only
the missing piece: the **promotion verdict**.

**The net-new layer no competitor has:** they all *track* regressions; none
*codify a promotion decision*. `benchmarks` computes a lift *number* and a
regression *bool* but stops there — it does not emit `default-on | opt-in |
reject`. `evaluateLiftGate()` (§4) turns those into a verdict. That is the RA
differentiator and the spine of B.

## 3. Architecture: the 4-layer model

The reconciliation is a clean stack, each layer a single canonical owner. Only
Layer 0 is net-new; everything else exists and gets *connected*, not rebuilt.

```
L3  PRODUCT FACADE  (@reactive-agents/eval public API — published)
      ReactiveAgents.eval(suite).against(agent).baseline(ref).gate(policy) → GateVerdict
      rax eval gate --suite --baseline --candidate --tiers …                (CLI/CI surface)
        owns: user-facing shape, EvalStore history, receipt rendering

L2  MATRIX ENGINE  (benchmarks v2 runMatrix — canonical experiment runner)
      runMatrix(suite, { models[w/ contextTier] × variants[HarnessVariant] × runs }) → MatrixReport
        already computes: harnessLift, perDimensionLift, DriftReport(vs baselineGitSha),
                          per-cell variance, SessionReproducibility, inconclusiveCells
        calls ↓ the canonical unit scorer (today it has its own judge.ts — FOLD into L1)

L1  UNIT SCORER  (@reactive-agents/eval — canonical, frozen judge)
      score(agentOutput, case, dimensions) → DimensionScore[]
        Rule-4 frozen JudgeLLMService + 5 dimension scorers. ONE judge, ONE DimensionScore.

L0  VERDICT  (NET-NEW — the only new logic)
      evaluateLiftGate(MatrixReport, policy) → GateVerdict        // pure, deterministic, no LLM
      policy = { metric, minLiftPp:3, maxTokenOverheadPct:15, minTiers:2 }
      decision = "default-on" | "opt-in" | "reject"  + per-tier evidence + receipt
```

**Three callers, one stack:**
1. **CLI / CI** (`rax eval gate`) — dev gate; CI fails on `reject`.
2. **Product** (`ReactiveAgents.eval().against().gate()`) — BYO eval + receipt.
3. **Loop (B)** — `candidate` = a `.compose()` mutation expressed as a
   `HarnessVariant`; the gate *is* the validator.

**The duplication being killed:** today both `eval` (L1) and `benchmarks`
(`judge.ts`) score with their own judge + `DimensionScore`. L1 becomes the single
scorer; L2's `judge.ts` folds into it. After that there is exactly **one scoring
path**, and L2 stops owning judging.

**A gate run = a 2-variant matrix run.** `baseline` and `candidate` are two
`HarnessVariant`s over the same suite × tiers. `runMatrix` already produces the
per-tier `TaskVariantReport` (with `meanScores`, `meanTokens`, `variance`,
`passRate`) and the `AblationResult.harnessLift`. `evaluateLiftGate` reads those
and emits the verdict. **Net-new code ≈ one pure function + a thin facade.**

### 3.1 The gate primitive

```ts
interface LiftPolicy {
  readonly metric: string;              // which scored dimension is the success metric (default: accuracy)
  readonly minLiftPp: number;           // default 3  (percentage POINTS, not %)
  readonly maxTokenOverheadPct: number; // default 15
  readonly minTiers: number;            // default 2  (≥2 model tiers required)
}

interface TierEvidence {
  readonly tier: string;                // ModelVariant.contextTier + model, e.g. "local:qwen3:8b"
  readonly baselineMetric: number;      // baseline variant's meanScore on `metric` for this tier
  readonly candidateMetric: number;     // candidate variant's meanScore
  readonly liftPp: number;              // (candidate − baseline) × 100, in points
  readonly tokenOverheadPct: number;    // (candidate.meanTokens − baseline.meanTokens) / baseline × 100
  readonly variance: number;            // max per-cell variance — the noise floor for this tier
  readonly significant: boolean;        // |liftPp| > k·stddev (not within noise)
  readonly passes: boolean;
  readonly inconclusive: boolean;       // any cell preflight-violated (capability=fallback) → can't judge
}

type GateDecision = "default-on" | "opt-in" | "reject";

interface GateVerdict {
  readonly decision: GateDecision;
  readonly perTier: readonly TierEvidence[];
  readonly aggregate: { liftPp: number; tokenOverheadPct: number; tiersCovered: number };
  readonly partial: boolean;            // true if any tier inconclusive → cannot emit "default-on"
  readonly rationale: string;           // human-readable receipt line
  readonly suiteId: string; readonly baselineRef: string; readonly candidateRef: string;
  readonly reproducibility: SessionReproducibility;  // reuse benchmarks' repro block
}

// Pure, deterministic — no LLM. The whole point.
// Input is a 2-variant MatrixReport (baseline + candidate variants over tiers × runs).
declare function evaluateLiftGate(
  report: MatrixReport, baselineVariantId: string, candidateVariantId: string,
  policy?: Partial<LiftPolicy>
): GateVerdict;
```

`MatrixReport` is `SessionReport` (or a thin alias) — `evaluateLiftGate` reads its
`taskReports`/`ablation` + per-variant `meanScores`/`meanTokens`/`variance`, keyed
by `ModelVariant.contextTier`. **It computes nothing new about scoring** — it only
applies the decision rule to numbers already in the report.

**Decision rule (the codified convention):**
- **`partial` short-circuit** — if any tier is `inconclusive` (a cell preflight-violated, e.g. capability source=fallback), the gate **cannot** emit `default-on`; best case is `opt-in` with the partial flag set. Honesty before promotion (reuses benchmarks' `inconclusiveCells` contract).
- `default-on` ⇔ aggregate `liftPp ≥ minLiftPp` AND `tokenOverheadPct ≤ maxTokenOverheadPct` AND `tiersCovered ≥ minTiers` AND every tier `passes` AND the lift is `significant` (|liftPp| > k·stddev — not within noise) AND not `partial`.
- `opt-in` ⇔ no tier regresses, but lift below threshold OR token overhead above OR lift not significant OR partial (positive/uncertain-but-not-enough → ship behind a flag).
- `reject` ⇔ any tier regresses on the success metric beyond noise (`significant` negative lift).

This is **pure and deterministic** — mirrors the orchestration spec's `ownFailure` FSM constraint (no parent-side LLM re-verify). The verdict is reproducible from the `MatrixReport`. Significance uses the per-cell `variance` already in `TaskVariantReport` (no new measurement).

### 3.2 The receipt

Every gate run emits a receipt (stored via `EvalStore`, printed by CLI, surfaced in cortex):

```
LIFT GATE · suite=real-world-10 · metric=accuracy
  candidate: compose{ctx-budget:+512, tool-gate:dedupe-on-view}  vs  baseline: main@e5a1f0cd
  ┌ tier                 baseline  candidate   lift     tok      verdict
  │ local:qwen3:8b         62.0%     66.5%    +4.5pp   +1.2%    PASS
  │ frontier:claude-…      88.0%     89.0%    +1.0pp   +0.3%    PASS
  └ AGGREGATE             +2.8pp gate-metric ·  tiers=2 · DECISION: opt-in (lift<3pp on aggregate)
  trace: gate_01KQ…   replay: rax diagnose diff <baseRun> <candRun>
```

"No headline without a receipt" (`01-RESEARCH-DISCIPLINE` Rule 11) becomes mechanically enforceable: the receipt *is* the artifact.

### 3.3 Candidate = a harness mutation (the B hook)

A `candidate` is a `baseline` run with a `.compose()` override applied. The same gate that compares "main vs PR branch" compares "current harness vs proposed mutation." So:
- **Dev gate:** candidate = your branch's harness.
- **B (self-improvement):** candidate = the loop's proposed `.compose()` mutation; the gate is the validator; `opt-in`/`reject` verdicts are the loop's accept/discard signal. **No separate validator is built for B** — it *is* this gate.

## 4. Reuse map (do NOT duplicate — 5 packages already exist)

| Need | Existing seam reused | Change |
|---|---|---|
| Unit scoring / dimensions | `eval` dimension scorers + `DimensionScore` | none — make canonical (L1) |
| LLM-judge isolation | `JudgeLLMService` + Rule-4 guard (`eval-service.ts:200`) | none — keep frozen judge |
| **Lift number** | `AblationResult.harnessLift` + `perDimensionLift` (`benchmarks/types.ts:146`) | reuse — gate consumes, doesn't recompute |
| **Regression vs baseline** | `DriftReport` (`hasRegressions`, `maxRegressionDelta`, `baselineGitSha`) | reuse — feeds `reject` decision |
| **Per-tier metric + tokens** | `TaskVariantReport.meanScores`/`meanTokens`/`passRate` keyed by `ModelVariant.contextTier` | reuse — `TierEvidence` reads these |
| **Noise floor** | `RunScore.variance` + `TaskVariantReport.variance` + multi-`runs` | reuse — `significant` test; set default `runs≥3` |
| **Candidate = mutation** | `HarnessVariant`/`InternalVariant` + `HarnessConfig.env` | reuse — a candidate IS a variant; gate run = 2-variant ablation |
| **Token-overhead (honest)** | `OverheadMeasurement` (framework-isolated) + `meanTokens` | reuse — `tokenOverheadPct` from `meanTokens` delta |
| **Repro / receipt metadata** | `SessionReproducibility` (judge SHA, runId, replayCommand) | reuse — embed in `GateVerdict.reproducibility` |
| **Honest partial measurement** | `inconclusiveCells` + `partialMeasurement` (`SessionReport`) | reuse — drives the `partial` short-circuit |
| Run history / baselines | `EvalStore` SQLite (`eval-store.ts`) | extend: store `MatrixReport` + tag baselines by git-ref AND name |
| Matrix runner | `benchmarks` `runSession` (`session.ts`) | expose as `runMatrix()`; `eval` facade (L3) delegates to it |
| Task corpus + ablation ladder | `benchmarks` `REAL_WORLD_TASKS`, `ABLATION_VARIANTS` | keep as suite/variant catalog (private); 2-variant gate subset |
| Determinism / candidate replay | `replay` (`replay()`, `diffTraces`) | optional: tool-stable candidate comparison |
| Diff two runs | `diagnose diff` + `RunScore.traceId` | receipt links the command |
| CLI wiring | `rax` (`bench`, `eval`, `diagnose`) | add `rax eval gate` subcommand (alias `rax bench gate`) |
| Lift rule | `.agents/ablation-warden.md` (markdown) | **codify as `evaluateLiftGate()`** + CI step |

**Net-new code is genuinely small:** `evaluateLiftGate()` (one pure fn over data
the matrix already emits), the `runMatrix()` export + `eval` facade delegation,
the `rax eval gate` subcommand, the receipt formatter, the CI step, the
`EvalStore` baseline-tagging extension, and the L1 judge-dedup refactor
(`benchmarks/judge.ts` → `eval` scorer). The lift/drift/variance/repro/tier
machinery **already exists** — the gate *consumes* it.

## 5. The three surfaces (both targets at once, per decision)

### 5.1 Internal dev / CI gate
```
rax eval gate --suite real-world-10 --baseline main --candidate HEAD --tiers local:qwen3:8b,frontier
# exit 0 = no regression; exit 1 = reject (CI fails). Prints receipt. Stores baseline.
```
CI: a `regression-gate` job runs the gate against the prior release's stored baseline; a `reject` verdict fails the build. This replaces "ablation-warden eyeballs it in review."

### 5.2 User-facing product ("BYO eval + receipts")
```ts
const verdict = await ReactiveAgents
  .eval(mySuite)                 // user's own EvalCase[]
  .against(myAgent)              // their SUT
  .baseline("v1")                // optional stored baseline
  .gate({ minLiftPp: 3 });       // honest verdict + receipt
```
Receipt rendered in cortex; history in `EvalStore`. This is the v0.13 "Receipts" headline — the honesty discipline shipped as a feature.

### 5.3 Loop validator (B, future)
`candidate` = the loop's proposed mutation; `verdict.decision` drives adopt/discard. Built for free by 3.1/3.3 — listed here to prove the gate is B's validator, not a throwaway.

## 6. Phasing
1. **Codify the verdict (L0).** `evaluateLiftGate(MatrixReport, …)` pure fn + `GateVerdict`/`LiftPolicy`/`TierEvidence` types + TDD over **fixture `SessionReport`s** (no model runs needed — the gate is pure). Zero falsification risk; ships the decision rule as code. *(Can build against existing benchmarks types immediately.)*
2. **Dedup the scorer (L1).** Fold `benchmarks/judge.ts` into `eval`'s frozen-judge scorer; one `DimensionScore`, one judge path. Resolve the published-pkg dependency (engine moves into `eval`, or `benchmarks` publishes).
3. **Expose the engine + gate run (L2→L0 wire).** `runMatrix()` export; a 2-variant gate run (baseline + candidate `HarnessVariant`) → `MatrixReport` → `evaluateLiftGate`. `EvalStore` baseline tagging (git-ref + name).
4. **Surfaces (L3).** `rax eval gate` subcommand + receipt formatter + CI `regression-gate` job (fails on `reject`); then product sugar `ReactiveAgents.eval().against().gate()` + cortex receipt panel + "BYO eval" docs.
5. **Seed suites:** an M8/orchestration scenario set (the gate for spec A/C) + a starter real-world suite for users. Run the variance study here to fix `runs`/`k` defaults.

**Phase 1 is independently shippable and unblocks B** — a pure verdict fn over the
matrix reports benchmarks already produces. Everything after is reconciliation +
surface.

## 7. Constraints (carried — do not re-discover)
1. **Gate is pure + deterministic** — `evaluateLiftGate()` takes two `EvalRun`s, returns a verdict; never calls an LLM. (Same constraint as orchestration `ownFailure`.)
2. **Frozen judge (Rule 4)** — judge model MUST differ from SUT; keep the `JudgeLLMService` Tag + runtime guard. The gate does not weaken this.
3. **No new package** — extend `eval` (canonical) + `benchmarks` (suites); add CLI subcommand. No net-new package; net type count minimal (gate types are additive).
4. **No headline without a receipt** — Rule 11, now mechanically enforced by the receipt artifact.
5. **lift = percentage POINTS** — `minLiftPp` is points (62%→66.5% = 4.5pp), not relative %.

## 8. Questions — resolved by code-read + still-open

**Resolved (2026-06-24 code-read):**
- ~~Command home~~ → `rax eval gate` (eval is the L3 facade), alias `rax bench gate`.
- ~~Token-overhead source~~ → `meanTokens` delta per tier, with `OverheadMeasurement` available for framework-isolated honesty. Both already measured.
- ~~Noise floor mechanism~~ → reuse `RunScore.variance`/`TaskVariantReport.variance`; `significant` = |liftPp| > k·stddev. Only the *default `runs` count* and *k* need an ablation (below).
- ~~Lift / drift / repro machinery~~ → exists in benchmarks v2; gate consumes, does not rebuild.
- ~~How a candidate is expressed~~ → a `HarnessVariant` (incl. `HarnessConfig.env`); gate run = 2-variant ablation.

**Still open (need a decision):**
- **benchmarks publish vs fold:** keep `@reactive-agents/benchmarks` private (suite catalog + internal sessions) with `eval` as the only published facade — OR publish it so the task corpus is a user asset? Lean: **keep private**, expose only `runMatrix` + the gate through `eval`. (The matrix engine relocating *into* `eval` vs staying in `benchmarks` and `eval` depending on it — a layering call: a published pkg should not depend on a private one, so either the engine moves into `eval`, or `benchmarks` gets published. Pick at Phase 2.)
- **Baseline storage key:** git-ref (CI wants) AND named tag (product wants) — store both? Lean yes, dual-keyed in `EvalStore`.
- **Significance defaults:** default `runs` per cell (3? 5?) and `k` (1.0σ? 2.0σ?) — needs a short variance study on the real-world suite before setting.
- **Competitor comparison surface:** keep benchmarks v2 competitor-compare (Mastra/LangGraph deltas) internal-only, or expose as a product receipt? (Pre-traction caution — internal-only for now.)
- **Effect-Schema boundary:** benchmarks types are plain interfaces; `eval` types are Effect Schema. When the engine feeds the L3 facade, where does the plain→Schema boundary sit? (Likely at the `eval` facade edge.)

## 9. Non-goals (this cut)
- Auto-applying mutations (that is B; this spec only *validates* them).
- A new judge or new scorers (reuse eval's 5 dimensions; add suite-specific ones later).
- Public leaderboard / hosted bench service (SaaS-free; local-first stays).
- Replacing `diagnose`/`trace` views (the gate *cites* them, does not reimplement).
