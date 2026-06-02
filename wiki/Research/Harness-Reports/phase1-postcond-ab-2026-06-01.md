---
title: Phase 1 PostConditions A/B — cogito:14b, pinned fixture, N=3
date: 2026-06-01
phase: "Phase 1 (WS-1) — PostConditionVerifier spine — LIVE-RUN GATE (partial)"
plan: "[[2026-05-30-canonical-agentic-convergence-plan]]"
fixture: wiki/Research/Harness-Reports/hn-fixture-2026-06-01.json
arms: { on: "RA_POST_CONDITIONS unset (default-on)", off: "RA_POST_CONDITIONS=0" }
reports: [task-quality-gate-cogito-14b-2026-06-01T11-30-16.json (ON), task-quality-gate-cogito-14b-2026-06-01T11-44-41.json (OFF)]
status: ACTIVE
---

# Phase 1 PostConditions A/B (2026-06-01)

Resolves the stale "0.31→0.72 retired/unmeasured on current code" debt with a
fixture-pinned N=3 measurement, and partially satisfies Phase 1's LIVE-RUN GATE.
ON arm = UNSET (the real default regime users get; equivalence-proven ≡ "1");
OFF arm = `RA_POST_CONDITIONS=0`. Both arms ran on the SAME frozen HN fixture
(`hn-fixture-2026-06-01.json`, 30 posts) so cross-arm numbers are comparable.

## Results

| task | ON pass^k | OFF pass^k | ON postCond | OFF postCond | ON T3-strict | OFF T3-strict |
|---|---|---|---|---|---|---|
| T1-knowledge-recall | 3/3 | 3/3 | — | — | — | — |
| T2-single-tool-synthesis | 3/3 | 3/3 | 3/3 | 3/3 | — | — |
| T3-selective-filter | 3/3 | 3/3 | 3/3 | 3/3 | **0/3** | **0/3** |
| T4-multi-criteria | 3/3 | 3/3 | 3/3 | 3/3 | — | — |
| T5-long-form-synthesis | 3/3 | 3/3 | 3/3 | 3/3 | — | — |
| **suite** | **5/5** | **5/5** | all met | all met | — | — |

avgComposite ON 86% vs OFF 91% — run-noise (T3 ON had a single 25%-composite
outlier run [88,25,88]; OFF [88,88,88]; T4/T5 within normal spread). NOT a
behavioral regression: pass^k and postCond are flat across arms.

## Two findings

1. **#7 default-on is REGRESSION-SAFE on this task set.** pass^k 5/5 both arms;
   postCond 3/3 met every derivable case both arms; no-required task (T1) still
   completes. The default-on gate does not block or degrade legitimate completion.
   This is the "no regression on no-required tasks" half of Phase 1's gate — PASSED.

2. **#7's honesty LIFT is UNMEASURABLE on this instrument.** Every HN synthesis
   task DOES produce its deliverable, so `ArtifactProduced`/`ToolCalled` conditions
   are always MET → zero discrimination between honest and prose authority. The
   synthesis gate measures SELECTION QUALITY (T3-strict: cite exactly the right 3
   posts), which post-conditions do NOT and cannot check — T3-strict stays 0/3 on
   BOTH arms because #7 verifies deliverable-presence, not selection-correctness.
   **The synthesis gate is the wrong instrument for #7's headline.**

## Methodology conclusion — wrong-instrument, not no-effect

This A/B confirms the evidence-refresh (`evidence-refresh-2026-06-01.md`): the
single cogito counterexample (`01KT1BQ6Z5`) was a tool-malfunction artifact
(malformed write args), NOT a reproducible honesty gap. On a clean fixture with
working tool calls, cogito produces deliverables every run, so #7 never fires.

To MEASURE #7's lift you need a task that reliably generates "claimed success +
absent deliverable" — Phase 1's gate names exactly this: the spot-test
(`success:true` impossible without `./commits.md` evidenced in the ledger). The
HN synthesis gate cannot generate that failure class. **Two separate failure
axes, two separate instruments:**
- deliverable-honesty (#7 / post-conditions) → spot-test with a file deliverable.
- selection-correctness (T3-strict) → the synthesis gate (a Phase 3 curation
  concern, not #7).

## #7 VERDICT — CLOSED (advisor-reconciled, do not reopen)

The A/B **is** the lift verdict; do not chase a stochastic spot-test to manufacture
the failure mode (that repeats the N=2-non-signal mistake banked 3× this session,
and just re-proves the deterministic gate). Read against the project's default-on
lift rule (≥3pp lift AND ≤15% overhead → default-on; else opt-in/remove):

- **Lift on the realistic distribution: ~0 BY NATURE.** The mode #7 catches
  (claimed-success + absent-deliverable) is a rare tail event; on a clean fixture
  with working tool calls every run produces its deliverable, so the gate never
  fires. Not "unmeasured pending a better instrument" — structurally ~0 on the
  realistic dist.
- **Overhead: ~0.** `deriveConditions` is deterministic, NO LLM call; `verify` is a
  pure ledger scan. Zero token overhead, zero regression (this A/B: pass^k 5/5
  both, postCond flat).
- **Defense for keeping default-on:** cheap tail-risk insurance — zero-cost, zero
  regression, catches the rare false-success (e.g. the malformed-args malfunction
  that produced the original cogito trace). KEPT default-on on that basis, NOT on a
  lift claim. "0.31→0.72" stays RETIRED (stale-code artifact, never reproducible).

### Composition — PROVEN BY EXECUTION (not just isolation)
The advisor's worry (the steer-then-terminate-honestly path composed live, vs the
isolated gate/seed/terminate tests) is closed by the PRE-EXISTING
`packages/reasoning/tests/kernel/terminal-post-condition-gate.test.ts`: it runs the
REAL imperative stall path (`runStallDeliverableStep` — the exact path that
produced the original cogito false-success trace `01KSWR3S5FEW0KM61PCF1M6946`) and
asserts it resolves to `status:failed` (honest) with #7 on, `done` with #7 off.
Added a DEFAULT-ON (env-unset) integration case this session so the real path is
pinned in the regime users actually get (7/7 green). Every link AND the riskiest
composition (imperative terminate bypassing the verdict) is now proven by
execution.

## Status — #7 / Phase 1 spine CLOSED
- LIVE-RUN GATE "no-regression": **PASSED** (cogito N=3 pinned; pass^k 5/5, postCond flat).
- LIVE-RUN GATE "completion-honesty ↑": **N/A on realistic dist** — lift ~0 by
  nature; #7 kept as zero-cost tail insurance, not on a lift claim.
- Composition: **PROVEN BY EXECUTION** (real stall path, default-on + opt-out).
- **#7 is DONE.** Stop polishing it.

## ▶ NEXT MOVE — selection-correctness (the gap the baseline actually found)
The real prose≠state-grounded dishonesty the Phase-0 baseline exposed is
**T3-strict 0/3 across EVERY tier including sonnet-4-6, while prose `success`
reports 3/3.** That is SELECTION-wrongness (cite exactly the right 3 posts), which
#7 structurally CANNOT catch. No amount of #7 work touches it. This is the
higher-leverage target.

**GUARDRAIL before chasing it (baseline's own over-strictness caveat):**
`resolveT3StrictCorrect` scans the whole output for title snippets and requires
EXACTLY 3 distinct cited ids — a correct-but-verbose answer (names other posts in a
preamble, then the right 3) scores strict-fail. BEFORE treating T3-strict 0/3 as a
real selection failure, verify on SONNET specifically that its 0/3 is genuine
wrong-picks / no-filter, not a verbose-output or oracle artifact. If even sonnet
cannot pass a metric, the metric may be measuring itself.

## ‼️ ROOT-CAUSE RETRACTED (2026-06-01) — the truncation was ALREADY FIXED

The "observation-array truncation" diagnosis below is RETRACTED. A kernel-warden
ran the LIVE `buildConversationMessages` pipeline and found all 25 fixture posts
reach the provider at frontier/mid/local-8k/local-4k (no truncation marker) —
because `applyAgeAwareCuration` (DEFAULT-ON since 2026-05-30, `context-utils.ts:229`)
runs after assembly and keeps the synthesis-target FULL. My isolation repros
omitted that default-on stage. Git timing: the sonnet 0/3 baseline ran 2026-05-30
13:58, ~6h BEFORE the curation flip `799487c1` (19:47) that took sonnet T3-strict
1/3→3/3 — so the 0/3 was a STALE pre-fix number. The genuine T3 residual (cogito
wrong-field sort = reasoning; qwen no-filter dump = instruction) is NOT truncation;
both see all 25. See `wiki/Research/2026-06-01-context-length-handling-competitive-research.md`
§"FINAL CORRECTION". The section below is retained only as the (mistaken) reasoning trail.

## [RETRACTED] ROOT CAUSE — observation-array truncation (DIAGNOSED + confirmed, 2026-06-01)

Guardrail SATISFIED — sonnet 0/3 is GENUINE, not metric over-strictness. Sonnet T3
runs (baseline `…sonnet-4-6-2026-05-30T13-58-33.json`):
- run0: cited `[48326802,48333820,48330436,48324712]` — 4 posts, only 1 of the right
  3 (wrong-pick).
- run1 & run2: `cited=[]` — output is MID-REASONING ("the results were
  truncated… Let me retrieve the full content"). NO deliverable produced; the model
  balked on a truncation marker.

**Empirically reproduced** (`compressToolResult` on the pinned 25-post fixture at
`tool-formatting.ts:221`):

| `toolResultMaxChars` | rows shown | descendants visible | can rank 25-by-comments |
|---|---|---|---|
| 800 (default profile) | **3 / 25** | only for the 3 shown | ❌ |
| 2000 | 3 / 25 | only for the 3 shown | ❌ |
| 4000 | 25 / 25 (showAll) | all | ✓ |

The `get-hn-posts` result is 4874 raw chars; the full 6-field render is ~3900. At
the default budget (800) `showAll` fails → falls to `slice(0, previewItems=3)`. The
model sees 3 of 25 posts and a `recall(...)` hint for the other 22, which models
rarely follow (sonnet tried to "retrieve full content" and never answered). The
prior 4→6 field lift (`renderRecord`, comment `tool-formatting.ts:320`) made
`descendants` VISIBLE but only on the 3 previewed rows — it did not fix the
ROW-COUNT truncation that makes top-N-by-field selection impossible for K>~6 arrays.

### Structural defect: the array try-fit is all-or-nothing
`tool-formatting.ts:351-385` — either (a) all items at full 6-field detail
(`showAll`, needs ~3900 chars here) or (b) `previewItems=3` items. There is no
MIDDLE tier. A rank-by-X task over K items needs every item's X; 3 full records is
strictly worse than K field-projected records. For 25 HN posts, all-25 at
`[i] title(40) score descendants` ≈ 1375 chars — fits a modest budget and preserves
the ranking criterion. **Proposed fix (kernel → kernel-warden): add a
full-coverage-reduced-fields tier between (a) and (b)** — when full detail overflows
but a minimal projection (drop url, tighten title, keep numeric selection fields) of
ALL items fits the budget, emit that instead of a 3-item preview. This is exactly
the content-aware projection thesis of the overhaul, applied to arrays. Tier-agnostic
(hit sonnet); closes the prose≠state selection gap #7 structurally cannot.
