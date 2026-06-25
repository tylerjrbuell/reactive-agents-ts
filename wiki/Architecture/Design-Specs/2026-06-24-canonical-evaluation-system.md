---
type: design-spec
status: draft (for review)
created: 2026-06-24
tags: [eval, benchmark, judge, trace, feedback-loop, self-improvement, public-bench, unification, canonical]
related:
  - "[[2026-06-24-eval-lift-gate-harness]]"
  - "[[2026-06-24-high-leverage-roadmap-ranking]]"
  - "[[01-RESEARCH-DISCIPLINE]]"
  - "[[05-DESIGN-NORTH-STAR]]"
  - "ROADMAP.md (v0.13 Receipts gate)"
---

# Canonical Evaluation & Improvement System — Design Spec

> **One line:** RA's measurement infra is **mature but triple-fragmented** — six
> packages and a skill, with **three parallel scoring/feedback stacks that don't
> share a spine**. This spec collapses them onto **one canonical Run record + one
> frozen judge + one dimension taxonomy**, wires the (excellent, already-built)
> trace diagnosis *into* results so every score carries its **why**, formalizes the
> dogfood loop into a machine-readable **improvement ledger**, and adds **real
> industry-benchmark adapters + an honest publication path**. The lift-gate
> ([[2026-06-24-eval-lift-gate-harness]]) is the *verdict* layer of this system.

## 1. The whole picture (code-verified 2026-06-24)

Not two packages — **six + a skill**, at three different maturity levels:

| Component | What it is | Maturity | Role today |
|---|---|---|---|
| `@reactive-agents/benchmarks` | Matrix engine: 34 tasks, **9-variant ablation ladder**, **5 competitor adapters (implemented)**, 6 sessions, ablation/drift/preflight-honesty/reproducibility | **mature**, private, `@unstable` | the real experiment engine |
| `@reactive-agents/judge-server` | **Frozen judge**: HTTP server, Dockerfile, model+code SHA pinning, Rule-4 enforce, ±0.5% reproducibility regression script | **production-ready** | the rigorous, reproducible judge |
| `@reactive-agents/eval` | 5-dimension LLM-judge, `EvalSuite`/`EvalCase`, SQLite store, regression | published, **simpler** | parallel product-shaped scorer |
| `@reactive-agents/trace` | JSONL events + **`analyzeRun` (7 diagnostic lenses incl. HONESTY keystone + blind-spot detection + failure-mode detection)** + **`cohort` (trust-gated deltas)** | **mature** | the best feedback — but disconnected |
| `@reactive-agents/diagnose` | `rax diagnose` replay/grep/diff/debrief | mature | forensic CLI |
| `@reactive-agents/replay` | deterministic replay + `diffTraces` | mature | determinism |
| **`harness-improvement-loop` skill** | 7-phase loop, **17 probe scripts**, **`loop-state.json` (machine-readable weakness/regression ledger)**, `harness-evolve.ts` | operational, **manual** | the existing dogfood loop |

### The three parallel stacks (the actual problem)

1. **Scoring-via-benchmarks** — `judge.ts` + judge-server RPC, 10 dimensions, `SuccessCriteria` (regex|verifiable|llm-judge|schema), matrix/ablation/drift.
2. **Scoring-via-eval** — `JudgeLLMService` Tag (in-process), 5 dimensions, SQLite store, `checkRegression`.
3. **Feedback-via-trace** — `analyzeRun` honesty/failure-mode/blind-spot analysis + `cohort` trust-gated verdicts.

They **do not share a spine**. Concretely fragmented:
- **Two judge paths** — eval's in-process `JudgeLLMService` (NOT frozen, NOT reproducible) vs benchmarks' SHA-pinned Dockerized **judge-server** (reproducible). The credible one is the judge-server; eval's is a convenience that silently lacks Rule-4 reproducibility guarantees.
- **Two dimension taxonomies** — eval's 5 (accuracy/relevance/completeness/safety/cost-efficiency) vs benchmarks' 10 (…/reasoning/tool-mastery/memory-fidelity/loop-intelligence/resilience/efficiency/reliability/scope-discipline/honest-uncertainty). Different vocabularies, no mapping.
- **Two task/suite models** — `EvalCase` (input+expectedOutput) vs `BenchmarkTask` (tiers, SuccessCriteria, rubrics, fixtures, optimalHarnessConfig, nominal `benchmark` field).
- **Two stores + two regression mechanisms** — eval SQLite `checkRegression` vs benchmarks `SessionReport` JSON + `ci.ts` `computeDrift`.
- **The richest feedback is orphaned** — `analyzeRun`'s honesty label + failure modes (overlap-storm, nudge-loop, recall-loop, runaway-tokens, max-iter-no-progress) + blind-spot flags live in `trace/`, keyed by `runId`, but **no scored result links to its trace**. `EvalRun` has no `traceId`; benchmarks' `RunScore.traceId` is optional and not fed back into scoring. So a result tells you the *number* (0.4 accuracy) but you must hand-hunt the trace to learn *why*.
- **Industry alignment is nominal** — tasks are *named* "SWE-bench"/"GAIA"/"HumanEval" but the `benchmark` field is empty and **none run the real datasets**. Alignment is aspirational.
- **The loop is manual** — `harness-improvement-loop` probes→diagnose→hypothesize(**manual**)→fix(**manual**)→verify. `loop-state.json` is a machine-readable ledger but a human drives the cycle.

**Reframe of the earlier spec:** "eval is canonical" was half-right. eval owns the
right *product-facing shape + Effect-Schema*, but the canonical **judge** is the
frozen judge-server (not eval's in-process judge) and the canonical **engine** is
benchmarks. The canonical system is an *assembly* of the best of each, not a
coronation of one package.

## 2. Goals (from the mandate)

1. **Dogfood** — a rich, mostly-automated feedback loop to improve the framework: run → score → **diagnose why** → hypothesize → fix → re-run → prove lift.
2. **Capability map** — know how RA performs across reasoning / tool-use / agentic problem-solving, **aligned to widely-accepted benchmarks** (real, not nominal).
3. **Root-cause** — when RA underperforms a task, know **why** (failure mode, honesty, harness vs model) and **how to improve**.
4. **Honest public data** — fair, reproducible, published bench + perf data from **real run traces**, governed by the stop-the-line rule.

## 3. Canonical architecture — one spine, layered faces

The spine is a **canonical `Run` record** keyed by a single `runId`, unifying
`EvalResult` + `RunScore` + the trace. Every layer reads/writes this spine.

```
L5  SURFACES
    rax eval  (suite | matrix | gate | diagnose | publish)   ·   product API   ·   PUBLIC BENCH publication
L4  IMPROVEMENT LEDGER  (formalize the dogfood loop)
    loop-state.json → canonical ImprovementLedger: weakness → hypothesis → gate verdict → fix → regression-baseline
    (this is also the substrate for B — verifiable self-improvement)
Lg  VERDICT      evaluateLiftGate(MatrixReport) → default-on|opt-in|reject   ([[2026-06-24-eval-lift-gate-harness]])
L3  FEEDBACK / DIAGNOSIS  (wire the orphaned trace analysis INTO results)
    analyzeRun (honesty, failure-modes, blind-spots) + cohort trust-gated deltas  → attached to every Run by runId
L2  EXECUTION / MATRIX    benchmarks runSession/runMatrix: models × variants(HarnessVariant) × runs; preflight honesty; ablation ladder; competitor adapters
L1  SCORING (canonical)   ONE judge = frozen judge-server (SHA-pinned, Rule-4) ; ONE DimensionScore ; ONE taxonomy ; deterministic SuccessCriteria preferred
L0  CORPUS                ONE task/suite model: SuccessCriteria + rubrics + fixtures + REAL benchmark-alignment ; internal suite + industry adapters
```

### The canonical `Run` record (the spine)
```ts
interface Run {
  readonly runId: string;                  // SINGLE id linking score ↔ trace ↔ diagnosis
  readonly taskId: string; readonly suiteId: string;
  readonly model: ModelRef; readonly variant: HarnessVariantRef;  // the SUT + harness config
  readonly scores: readonly DimensionScore[];  // canonical taxonomy
  readonly status: "pass" | "fail" | "error";
  readonly cost: { tokensUsed: number; costUsd: number; latencyMs: number };
  readonly traceId: string;                // ALWAYS linked (was optional/missing)
  readonly diagnosis: RunDiagnosis;        // L3 — honesty label, failure modes, blind spots (from analyzeRun)
  readonly reproducibility: Reproducibility; // judge SHA, code SHA, replayCommand
}
```
`MatrixReport` (L2) is a set of `Run`s grouped by tier × variant; `evaluateLiftGate`
(Lg) reads it; the `ImprovementLedger` (L4) records verdicts against it.

## 4. Reconciliation decisions (the unification core)

| Fragment | Decision | Why |
|---|---|---|
| **Judge** | **Frozen judge-server is canonical.** eval's in-process `JudgeLLMService` is kept ONLY as a clearly-labeled `--judge=fast` dev fallback that **stamps `reproducible:false`** on its Runs. No published claim may use the fast judge. | Reproducibility is the moat; an unfrozen judge can't back a public number. |
| **Dimension taxonomy** | **The 10-dimension set is canonical** (superset). eval's 5 become aliases/subset; a suite declares which dimensions it scores. One `DimensionScore` type (Effect-Schema, from eval). | Superset preserves both; one vocabulary kills the mapping tax. |
| **Task/suite model** | **`BenchmarkTask` is the canonical corpus model** (richer: SuccessCriteria, rubrics, fixtures, harness config), given eval's **Effect-Schema** treatment. `EvalCase` becomes a thin sugar that compiles to it. | Don't lose `verifiable`/`regex` ground-truth scoring; keep the validated-schema product shape. |
| **Scoring mode** | **Deterministic `SuccessCriteria` (regex/verifiable/schema) preferred; LLM-judge only where unavoidable.** Expand verifiable coverage (today only ~4 tasks). | Ground truth > judge heuristic; reduces judge-model bias + cost. |
| **Store + regression** | **One store** (extend eval's SQLite to hold the full `Run` + `MatrixReport`, keyed by runId, indexed by task/suite/git-ref/name). `computeDrift` + `checkRegression` unify into the gate (Lg). | One history, one regression path, dual-keyed for CI (git-ref) + product (name). |
| **Feedback** | **Wire `analyzeRun` + `cohort` into the `Run.diagnosis` field at score time.** No new analyzer — the 7-lens honesty/failure-mode/blind-spot engine already exists; it just isn't attached. | The "why" already exists; the gap is *linkage*, not capability. |
| **Package shape** | Resolve the published-pkg dependency: **the matrix engine + frozen-judge client move under `eval` (published) as internals; `benchmarks` becomes the private suite/competitor catalog.** OR publish `benchmarks`. Decide at Phase 2. | A published facade must not depend on a private pkg. |

## 5. The feedback loop — "know why, know how to improve" (L3 + L4)

This is the dogfood heart, and most of it **already exists, unwired**.

**L3 — every score carries its why (wire, don't build).** At score time, attach
`analyzeRun(trace)` to the `Run`:
- **Honesty label** (keystone): honest-failure | claimed-success-unverified | dishonest-success-suspected — so a "pass" is never trusted blindly.
- **Failure modes** (auto-detected): overlap-storm, nudge-loop, recall-loop, runaway-tokens, max-iter-no-progress.
- **Blind spots**: metrics that can't be computed because source events are missing (prevents misleading zeros).
- **Harness-vs-model attribution** (partial today): intervention pressure, which guards fired. Full causal attribution needs the ablation (L2: same task, guard on/off).

So a result reads: *"rw-7 scored 0.35 accuracy · honesty=claimed-success-unverified ·
failure-mode=nudge-loop (guard `recall` steered 4× without terminal resolution) ·
0 deliverable file produced."* — the **why**, not just the number.

**L4 — the Improvement Ledger (formalize `loop-state.json`).** Promote the skill's
machine-readable ledger to a first-class artifact the system reads/writes:
```
weakness (from L3 failure-mode aggregation across a cohort)
  → hypothesis (a .compose() harness change, expressed as a HarnessVariant)
  → gate run (Lg: baseline vs candidate variant on the affected tasks)
  → verdict (default-on | opt-in | reject) + receipt
  → regression-baseline (pin the win so it can't silently regress)
```
This is exactly **B (verifiable self-improvement)** — the ledger + gate ARE the
loop; today a human walks it, later the loop walks itself. Same spine either way.

## 6. Industry-benchmark alignment + honest public data (L0 + L5)

**Make alignment real (net-new).** Today tasks are *named* after SWE-bench/GAIA/etc.
but run none of them. Add **industry-benchmark adapters** — task loaders that pull
real datasets into the canonical corpus model:
- **SWE-bench (Verified subset)** — `verifiable` scoring (run the repo's tests). Highest-credibility, deterministic.
- **GAIA** — multi-step tool-use; judge + verifiable hybrid.
- **τ-bench / BFCL** — tool/function-calling correctness; deterministic.
- (Stretch) WebArena / AgentBench — agentic.
Each adapter maps to `BenchmarkTask` + `SuccessCriteria`, runs through the same
matrix engine + frozen judge. Now the capability map is **against recognized
benchmarks with real ground truth**, not nominal labels.

**Honest publication path (L5 — the v0.13 "Receipts" gate).** A `rax eval publish`
flow that emits a public artifact:
- pinned model + provider + date; **≥3 seed runs** (variance, not single-run);
- raw traces published (the flight recorder IS the receipt);
- frozen-judge SHA + replayCommand (reproducible);
- RA vs competitors (the 5 implemented adapters) on shared tasks, deterministic verifier where possible;
- **stop-the-line rule encoded**: if external/competitor delta >15% from internal expectation → the pipeline flags "fix the harness, not the result" (don't publish a number you can't defend).
- **honesty-gated**: any `partialMeasurement`/inconclusive cell or `dishonest-success-suspected` blocks publication of that cell.

This turns the moat (reproducibility + honesty) into the public proof — fair,
because deterministic where possible; honest, because negative results and
overhead publish too (Rule 11 / North Star §1).

## 7. Phasing (each phase ships value + has consumers — no scaffold)

1. **Spine + verdict (foundation).** Define the canonical `Run` + `DimensionScore` (Effect-Schema, 10-dim) + `evaluateLiftGate()` (pure fn over `MatrixReport`, TDD on fixtures). Adapter shims so benchmarks `RunScore`/eval `EvalResult` project into `Run`. *(Unblocks B; zero falsification risk.)*
2. **One judge, one taxonomy.** Make frozen judge-server canonical; eval in-process judge → `--judge=fast` with `reproducible:false` stamp. Fold eval's 5 dims into the 10 (aliases). Dedup `judge.ts`. Resolve the published-pkg dependency.
3. **Wire the why (L3).** Attach `analyzeRun` + honesty + failure-modes to every `Run.diagnosis` at score time; always link `traceId`. One store holding the full `Run`. *(This is the single biggest dogfood win — "know why" — and it's mostly wiring.)*
4. **Improvement ledger (L4) + gate surface.** Promote `loop-state.json` → canonical `ImprovementLedger`; `rax eval gate` + CI regression job (fails on `reject`); receipt formatter. The manual loop now has rails.
5. **Industry adapters + publication (L0/L5).** SWE-bench-Verified + τ-bench/BFCL adapters first (deterministic, highest-credibility); then GAIA. `rax eval publish` with ≥3 seeds + raw traces + stop-the-line. The v0.13 "Receipts" deliverable.
6. **(Optional) close the loop (B).** The ledger walks itself: failure-mode → proposed variant → gate → adopt-if-lift. Built on 1–5; nothing new structurally.

## 8. Constraints / anti-patterns (carried — do not re-discover)
1. **No scaffold without callers** (North Star §9). Each phase wires a consumer: the `Run` spine is consumed by the gate (P1); L3 diagnosis by the ledger (P4); adapters by publication (P5). Do not land the canonical types without the projection shims that feed them.
2. **Frozen judge for any claim; fast judge stamps `reproducible:false`.** Rule 4. A public number from an unfrozen judge is forbidden.
3. **Honesty-gated promotion + publication.** `partialMeasurement`/inconclusive/`dishonest-success-suspected` blocks `default-on` AND publication.
4. **Gate verdict is pure + deterministic** (no LLM re-verify) — same constraint as orchestration `ownFailure`.
5. **No headline without a receipt** (Rule 11). The published artifact (traces + SHAs + replayCommand) IS the receipt.
6. **Stop-the-line**: external delta >15% from internal → fix the harness, not the result.
7. **Net type count discipline** — `Run`/`DimensionScore`/`GateVerdict` are additive; eval `EvalCase` + benchmarks `RunScore` become projections, not parallel peers (reduces type surface over time).

## 9. Open decisions (for review)
- **Published-pkg home:** matrix engine moves into `eval` (publish-clean) vs publish `benchmarks` (more code public). Lean: engine into `eval`, `benchmarks` stays private catalog.
- **Dimension reconciliation detail:** are eval's `relevance`/`completeness`/`safety` kept as first-class in the 10, or folded (e.g. safety → a guardrail check, not a quality dim)? Needs a taxonomy pass.
- **Industry adapter priority + licensing:** SWE-bench-Verified first (deterministic) — confirm dataset licensing for redistribution / whether we run-but-don't-redistribute.
- **Judge model for public bench:** which frozen model + who hosts (local container only, or a pinned hosted judge for external reproducers)?
- **Variance defaults:** seeds per published cell (≥3 floor; 5 for headline?), and the significance `k` for the gate.
- **Cortex surface:** does the capability map + receipts get a cortex panel in this cut, or CLI/static-site first?
- **Relationship to `harness-improvement-loop` skill:** does the skill become a thin driver over the L4 ledger, or is it deprecated in favor of `rax eval`?

## 10. Non-goals (this system)
- Hosted SaaS eval/leaderboard (local-first stays; publication is static artifacts + raw traces).
- Auto-applying fixes (that's B/L4-optional; this system *validates* + *records*).
- A new analyzer or judge model (reuse `analyzeRun` + judge-server).
- Procedural/auto-generated task corpus (hand-authored + real industry datasets only, for credibility).
