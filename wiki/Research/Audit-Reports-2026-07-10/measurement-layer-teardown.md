---
tags: [measurement, eval, benchmark, diagnose, audit, root-cause]
date: 2026-07-10
status: active
scope: every mechanism that turns a harness change into a verdict
---

# Measurement-layer teardown — why we can't conclude what boosts capability vs what's a disease

Verified in code 2026-07-10 (two read-only investigators + direct reads). Every claim is
file:line-checked. This supersedes the scattered "bench can't measure the framework" notes.

## The one disease

**The instrument narrows; it does not conclude — and nothing durable or automatic records
what was concluded.**

Sort every mechanism by two axes — *what it measures* (behavior/wiring vs capability/accuracy)
and *how it runs* (automatic+deterministic vs manual+stochastic):

| | Automatic · deterministic · CI-able · committed | Manual · stochastic · keys-gated · un-CI-able |
|---|---|---|
| **Behavior / wiring** | north-star scenario gate (ci.yml, scripted-LLM); T0 deterministic gate (`bench:t0`, this session); BASELINE-UPDATE trailer check | — |
| **Capability / accuracy** | **(empty — this is the hole)** | eval bench + `rax eval gate`; RunDiagnosis; rax-diagnose diff; probe scripts; ImprovementLedger |

Everything that answers *"did this change make the models better?"* lives in the bottom-right:
it needs live models, so it cannot run in a CI that has no provider keys and no Ollama; it runs
by hand; its results are Bernoulli-noisy; and the record of them (the ledger) is gitignored.
Everything automatic and trustworthy lives in the top-left and only measures whether the harness
*wiring* changed, not whether *capability* moved.

The whole redesign is one move: **fill the bottom-left cell** — get a capability/accuracy signal
that is deterministic, CI-able, and committed. The machinery to do it already exists and is
unwired (`packages/replay`). That is the keystone; everything else is cleanup that the keystone
makes worth doing.

## Mechanism inventory

| Mechanism | Layer | State | Measures | Cannot measure | Key file:line |
|---|---|---|---|---|---|
| task `expected` regex | scoring | LIVE, 25/45 tasks | keyword presence | correctness (any output with the word passes) | judge.ts:390-397 |
| `scoreVerifiable` + partialCredit | scoring | LIVE, 5 tasks | graded subgoal completion | anything without a hidden-check fixture | judge.ts:181; graded-check.ts |
| `llm-judge` | scoring | LIVE, 7 tasks | rubric quality | reliably — silent 0.0 on judge outage; stubs 0.95 without JUDGE_LAYER=live | judge.ts:374 |
| `schema` scorer | scoring | LIVE but INERT | JSON parseability | shape — always 1.0 for any valid JSON ("not yet implemented") | judge.ts:379-388 |
| efficiency | scoring | LIVE | token ratio vs baseline | quality tradeoff | judge.ts:403 |
| `evaluateLiftGate` | statistics | LIVE + **paired this session** | per-task paired lift, clustered SE, 1.96σ | — (now honest) | gate/gate.ts |
| pass^k | statistics | LIVE but **starved + mis-binarized** | reliability across k trials | anything: no session runs ≥8; `isSolved` needs accuracy≥1 so it discards graded partial credit | report-format.ts:34,79 |
| CRN / seed pinning | statistics | ABSENT | — | pairs on taskId only; within-task sampling noise survives (no temp=0) | runner.ts:1174 |
| RunDiagnosis honesty | diagnosis | LIVE, heuristic | claimed-success-without-traced-deliverable | correctness (needs judge); brittle: `includes("write")` + hardcoded INTROSPECTION_TOOLS set | analyze.ts:437-461,284-290 |
| RunDiagnosis failureModes | diagnosis | LIVE | 5 threshold symptoms | causality (header says so); overlap-storm is structurally ~0 today | analyze.ts:177-203,130 |
| rax-diagnose diff | diagnosis | LIVE, **eyeball-only** | one-run-vs-one-run deltas | significance — no variance, no N, no noise floor | diff.ts:28-48 |
| rax-diagnose replay-run | diagnosis | LIVE but **prints metadata only** | — | does NOT re-execute; the real `replay()` is API-only, unwired | replay-run.ts:38; replay.ts:15 |
| debrief curator/alternatives | diagnosis | **DEAD** (0 emitters) | — | always empty — emitCuratorDecision/emitAlternativesConsidered have no callers | analyze.ts:422-424 |
| guard-fired blindSpot | diagnosis | **STALE** | — | threshold `≤1` predates ~9 live emit sites → mislabels real data as blind spot | analyze.ts:540 |
| ImprovementLedger | record | LIVE code, **gitignored + opt-in** | weakness→hypothesis→verdict chain | durably — 2 entries, 0 adopted, no git history; written only on `--ledger` | ledger.ts:70; eval-gate.ts:102 |
| weakness-queue | record | **dead-wired script** | ranked targets | nothing reads it; emitted probe cmd hardcodes `ra-full`/`<session>` (not runnable) | weakness-queue.ts:135 |
| loop-state.json | record | **NEVER EXISTED** | — | dangling refs in ledger.ts:5, SKILL.md:160; maintaining scripts orphaned | — |
| CI lift signal | record | **ABSENT** | — | eval.yml runs unit tests not benches; regression-gate.yml manual + needs keys | .github/workflows/*.yml |
| north-star scenario gate | record | LIVE + AUTOMATIC | control-flow wiring | capability/accuracy (scripted-LLM, deterministic) | ci.yml:87-99 |
| committed baseline | record | LIVE (real-world-full + t0) | drift vs a pinned run | only via `run.ts --ci`, which no workflow calls | benchmark-baselines/ (e16053cf) |
| task-quality-gate probe | probe | live-runnable, **dead-wired** | deterministic fixture score (T3 strict-set honest) | judged quality; nobody reads its JSON | task-quality-gate.ts:242 |
| harness-probe(-wide) | probe | live-runnable, **vestigial** | self-report + length/substring proxies | quality — `success` is unverified self-report; `outputLength>600`=quality | harness-probe.ts:153 |

## The five sub-diseases (each a facet of the one)

1. **Capability signal can't be automatic.** Live-model requirement → no CI (no keys/Ollama) →
   manual → gitignored notebook. The `replay()` rail (`packages/replay`: exchangeKey hashing,
   makeReplayLLMLayer die-on-miss, makeReplayToolLayer, diffTraces) is COMPLETE and wired to
   NOTHING that measures. This is the keystone gap.
2. **Most tasks score presence, not correctness.** 25/45 keyword-binary + `schema` always-1.0
   ⇒ Bernoulli variance ⇒ the 3pp lift rule needs ~556 runs/arm ⇒ unmeasurable ⇒ the ledger's
   0 adopted entries are the receipt. A rerun of this suite measures sampling noise.
3. **The verdict metrics are under-powered or self-defeating.** No session runs ≥8 so pass^k
   emits only pass^1; `isSolved` binarizes graded tasks at accuracy≥1 so pass^k throws away the
   partial-credit signal that fixed the variance in #2; no CRN/temp=0 so pairing leaves sampling
   noise in.
4. **Diagnosis narrows but never concludes, and leans on brittle strings.** honesty = heuristic
   over `includes("write")` + a hardcoded introspection set (a tool rename flips the keystone
   label); it means nothing without the judge (which stubs 0.95 silently); failureModes are
   symptoms with an explicit no-causality disclaimer; diff has no statistics; debrief's
   curator/alternatives sections are dead; overlap-storm measures something structurally
   impossible now.
5. **The improvement record is aspirational.** Ledger gitignored + opt-in (SKILL says "not
   optional" — the code says otherwise); weakness-queue unwired and emits a non-runnable probe
   command; loop-state.json never existed; the self-improving-harness scripts are orphaned.
   A harness change can land with zero before/after evidence in history.

## Redesign — ranked by leverage, keystone first

### K. Wire the deterministic replay rail into measurement (unlocks the empty quadrant) — **STARTED `ef3cc3d6`**
LANDED: diagnosed why the complete `packages/replay` engine was unwired — `.withLayers()`
overrides ToolService (late-bound) but NOT LLMService (captured via `Layer.provide` at
construction), confirmed by a live spike where `.withLayers(replayLLM)` was ignored and the
run hit the real gpt-4o. Added `.withReplayLLM()` (swaps the base LLMService upstream of every
capture), `buildSequentialLLMTable` (Nth-call→Nth-response, immune to date/schema prompt
drift), `makeReplayAgent`, and `replay-golden.test.ts` — records a real harness run, rebuilds
the WHOLE agent against it, reproduces the deliverable EXACTLY with no keys (mutation-proven).
REMAINING (task #45): a live golden record script + `bench:replay` CI lane; the trace
recorder leaves `run-completed.output` undefined so `diffTraces` is output-blind; run real
graded scoring on the replayed deliverable to make it an accuracy (not just reproduction)
signal. Original plan below.


`replay()` exists; make it a first-class lane:
- `scripts/record-golden.ts`: archive K cross-tier trace runs (llm-exchange + tool events) +
  a manifest into `packages/benchmarks/golden/`.
- A builder factory that provides `makeReplayLLMLayer(buildLLMTable(events))` + replay tool
  layer for a `RecordedRun` (the `replay()` orchestrator already accepts it).
- `rax-diagnose replay-run <id> --execute` and a `bench:replay` bun test that re-runs the
  goldens through REAL scoring and asserts `diff.identical` on the deliverable + score.
- CI job on every PR: no keys, no Ollama, seconds. **This is the automatic capability signal
  that does not exist today.** Honest limit: exact-replay misses on any prompt-affecting change
  by design — so it's a drift detector (intentional change ⇒ re-record; unintentional ⇒ caught),
  the accuracy analogue of the north-star scenario gate.

### 1. Graded-everywhere: kill keyword-binary scoring
Convert the 25 `expected`-regex + 7 judge tasks to deterministic hidden-check fixtures
(rw-7/lh-1 pattern; graded-check.ts already gives partial credit). Audit-identified conversions:
rw-2/rw-3 fully (fixture ⇒ computable aggregates), rw-1 structurally, rw-6 via trace,
cs-dishonest-bait via sentinel. Implement `schema` shape-validation or delete the scorer.
Only after this is the 3pp rule physically measurable (sd 0.50→~0.20 ⇒ ~147 runs/arm). Declared
metric change ⇒ re-baseline immediately.

### 2. Fix the verdict metrics I shipped
- pass^k solve bar: use a defensible threshold (≥0.9) or run pass^k on the continuous graded
  score, so it stops fighting partial credit.
- Add a `runs: 8+` session on the deterministic-scored subset so pass^k has a producer.
- CRN: run deterministic tasks at temperature 0 and pin the seed across variants so the pairing
  removes sampling noise too, not just between-task variance.

### 3. Make the improvement record durable + enforced
Un-gitignore + commit `improvement-ledger.json`; default `--ledger` to the canonical path in
`eval-gate.ts` (write always); add a PR check that fails when a diff touching
`packages/reasoning|runtime|llm-provider` carries no new ledger entry with non-empty
weakness+hypothesis+verdict. Turns "Ledger is not optional" from prose into a gate. Wire
weakness-queue into the gate output and fix its probe-command emitter to use the row's real
model/variant/session.

### 4. Make diagnosis concluding, not just narrowing
- Replace honesty's hardcoded tool-name strings with a capability flag on the tool definition
  (`produces: "deliverable" | "introspection" | "substantive"`) so labels can't drift on rename.
- Give `diff` variance: accept N traces/side, report mean ± spread, refuse a better/worse call
  inside the noise floor (inline the gate's logic into the CLI).
- Enable traced post-condition content-match so `dishonest-success` is *proven* from artifact
  content, not inferred from a missing tool name.
- Fix the stale guard-fired threshold; wire or delete emitCuratorDecision/emitAlternativesConsidered
  and the overlap-storm metric so coverage stops reporting un-wired emitters as blind spots.

### 5. Retire the vestigial probes
harness-probe / harness-probe-wide score with self-report + length/substring proxies — retire as
scored instruments (keep for manual exploration). Fold their unique subsystem coverage (memory
recall, strategy routing) into bench tasks. Keep task-quality-gate's frozen-fixture deterministic
scoring as a fast judge-free check and route its output into the ledger instead of an orphaned
JSON. Correct SKILL.md's standing-state claims (eval.yml/regression-gate manual+keys; ledger
committed+enforced only after step 3; drop loop-state dependency).

## Sequence
K → 1 are the unlock (automatic + measurable). 2 makes the verdict trustworthy. 3 makes it
auditable. 4–5 sharpen diagnosis and cut dead weight. Do NOT run a full live rerun before 1 —
it produces noise, not signal. The first honest capability number comes from K (deterministic,
now) plus a judge-free T1 smoke on the tasks that already grade correctly.

## Corrections to prior notes
- ImprovementLedger has **2** entries (not 4).
- A committed baseline **does** exist: `packages/benchmarks/benchmark-baselines/{real-world-full,t0-deterministic}.json` (tracked, `e16053cf`); the gap is that no workflow runs `run.ts --ci` against it.
- `.claude/skills` is a symlink to `.agents/skills` — one copy of each probe, not two.
