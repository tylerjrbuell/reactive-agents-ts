---
title: pass^k Cross-Tier Baseline — Canonical Convergence Phase 0
date: 2026-05-30
phase: "Phase 0 (WS-3) — pass^k measurement harness"
plan: "[[2026-05-30-canonical-agentic-convergence-plan]]"
runsPerTask: 3
tiers: [gpt-4o-mini, cogito:14b, qwen3.5:latest, claude-sonnet-4-6]
note: "Re-run after fixing a T3 oracle scope bug (oracle computed over 30 cached posts vs the 25 the task fetches) + adding an expected/cited-id audit trail. Pre-fix runs discarded."
---

# pass^k Cross-Tier Baseline (N=3) — 2026-05-30

Baseline captured by the Phase 0 `pass^k` harness extension to
`task-quality-gate.ts` (`RUNS_PER_TASK=3`). This is the consistency measurement
substrate every later phase's live-run gate depends on. Source JSON reports
(corrected set): `task-quality-gate-<model>-2026-05-30T13-58*.json` +
`…qwen3-5-latest…T14-01-59.json`.

> **Methodology correction (advisor-caught, this phase).** First pass computed the
> T3 expected-answer oracle (`top3ByComments`) over the full 30-post cache while the
> T3 task only fetches 25 — a latent unreachable-oracle risk (T4 correctly scopes to
> its fetched window). Fixed to `slice(0,25)`; added an `expected=[…] cited=[…]` audit
> line to every T3 run so strict failures are auditable rather than asserted. All
> numbers below are post-fix. The universal T3-strict 0/3 survived the fix and is now
> explained by three concrete mechanisms (below), not by an oracle artifact.

## Per-tier summary (post-fix)

### gpt-4o-mini (openai) — pass^k 3/5 · avg composite 74%
| task | pass^k | composite(runs) | T3-strict | spread |
|---|---|---|---|---|
| T1-knowledge-recall | ✓ 3/3 | 100% | — | 0pp |
| T2-single-tool-synthesis | ✓ 3/3 | 100% | — | 0pp |
| T3-selective-filter | ✗ 0/3 | 35% [35,35,35] | 0/3 | 0pp |
| T4-multi-criteria | ✗ 1/3 | 50% [91,30,30] | — | **61pp** |
| T5-long-form-synthesis | ✓ 3/3 | 84% [84,84,86] | — | 2pp |

### cogito:14b (ollama) — pass^k 4/5 · avg composite 86%
| task | pass^k | composite(runs) | T3-strict | spread |
|---|---|---|---|---|
| T1 | ✓ 3/3 | 100% | — | 0pp |
| T2 | ✓ 3/3 | 100% | — | 0pp |
| T3-selective-filter | ✓ 3/3 | 73% [78,65,77] | 0/3 | 13pp |
| T4-multi-criteria | ✗ 2/3 | 88% [82,91,91] | — | 9pp |
| T5-long-form-synthesis | ✓ 3/3 | 68% [67,70,67] | — | 2pp |

### qwen3.5:latest (ollama) — pass^k 5/5 · avg composite 93%
| task | pass^k | composite(runs) | T3-strict | spread |
|---|---|---|---|---|
| T1 | ✓ 3/3 | 100% | — | 0pp |
| T2 | ✓ 3/3 | 100% | — | 0pp |
| T3-selective-filter | ✓ 3/3 | 80% [80,78,80] | 0/3 | 2pp |
| T4-multi-criteria | ✓ 3/3 | 95% [100,100,85] | — | 15pp |
| T5-long-form-synthesis | ✓ 3/3 | 88% [100,90,74] | — | 26pp |

### claude-sonnet-4-6 (anthropic) — pass^k 5/5 · avg composite 86% (clean control)
| task | pass^k | composite(runs) | T3-strict | spread |
|---|---|---|---|---|
| T1 | ✓ 3/3 | 100% | — | 0pp |
| T2 | ✓ 3/3 | 100% | — | 0pp |
| T3-selective-filter | ✓ 3/3 | 45% [67,35,35] | 0/3 | 32pp |
| T4-multi-criteria | ✓ 3/3 | 100% | — | 0pp |
| T5-long-form-synthesis | ✓ 3/3 | 85% [98,79,79] | — | 19pp |

## Headline finding — prose success ≠ state-grounded success

**T3-strict (exact top-3-by-comments id set) is 0/3 on every tier, including
sonnet-4-6, while the prose `result.success` bit reports `pass^k 3/3` on T3 for
cogito, qwen3.5, and sonnet.** `rax:diagnose replay` on a passing run shows the
authority that produced that "success": `[verifier] ✓ final-answer: 8 checks
passed → run-end success`. That verifier verdict is prose-judged; the deliverable
was wrong or absent. This is exactly the gap Phase 1 (PostConditionVerifier as the
success authority) exists to close. (Canon: τ-bench, DSPy assertions,
evaluator-optimizer.)

### The audit trail explains 0/3 with three distinct, real mechanisms
Per-run `expected=[…] cited=[…]` ids (expected = `[48324712,48323869,48321631]`):

1. **Score-confusion (cogito:14b)** — picks the wrong posts. run1
   `cited=[48334515,48334048,48334710]` = **0/3 correct**; sorts by the wrong field.
2. **No-filter dump (qwen3.5)** — does not filter to top-3. run2 cites **23 ids**
   (nearly every fetched post), run0 cites **15**. The correct 3 are present, but the
   task ("output the 3 most-commented") is not performed. Composite rewards this
   (faith 100% because it cited everything) — composite leniency in full color.
3. **Truncated-reasoning-as-output (sonnet)** — never emits a final deliverable on 2/3
   runs: output is mid-reasoning ("the results were truncated… let me retrieve the full
   content") with `cited=[]`. On the run that did answer, it listed 4 posts, only 1 in
   the true top-3 (score-confusion). A context-curation/observation-truncation
   interaction worth tracking for Phase 3.

### Composite leniency (independent confirmation of why strict was added)
cogito T3 composite **73%** while only 0–2/3 ids correct; qwen T3 composite **80%**
with faith 100% but the selective-filter task unperformed. The lenient composite
masks both wrong-pick and no-filter failures; strict id-match exposes them.

### Variance is real and was previously invisible
Single-run probes would have hidden: gpt-4o-mini T4 flip-flop **91/30/30 (61pp
spread)**; sonnet T3 (32pp), T5 (19pp); qwen T5 (26pp); cogito T3 (13pp).
`pass^k` + the variance line surface it.

## rax:diagnose evidence
`bun run rax:diagnose replay latest --only=run-started,verifier-verdict,run-completed`
→ `[verifier] ✓ final-answer: 8 checks passed` then `[run-end] success`. The
prose verifier-verdict is the current success authority. Phase 1 demotes it to a
quality signal and makes state-grounded post-conditions authoritative.

## Reproducibility & data pinning (added this phase)
`HN_CACHE` is fetched live per process. This baseline was **data-stable** — the T3
expected-id set was identical (`[48324712,48323869,48321631]`) across all four tiers,
so cross-tier numbers are comparable. That is timing luck, not a guarantee: HN
comment-count rankings drift continuously, so cross-*process* A/B runs (Phase 1
honest-vs-prose, Phase 3 obsMode A/B, Phase 4 arm-A/arm-B) could confound a real
"pass^k +Npp" with "different stories." A fixture-freeze was therefore added this
phase (control-first, env-gated, default behavior unchanged):
- `TASK_GATE_HN_FIXTURE=<path>` — load `HN_CACHE` from JSON if the file exists; else
  live-fetch and freeze it to that path for reuse.
- `TASK_GATE_FREEZE_ONLY=1` — freeze the fixture and exit, without running the suite.
- Frozen fixture for this campaign: `hn-fixture-2026-05-30.json` (30 posts).

**Floor for Phase 1+:** every cross-phase pass^k claim MUST run on the pinned fixture.
Phase 1's first task is to capture the fixture-pinned cross-tier baseline as the
canonical "before" for all A/B gates (the live-data numbers above are the Phase-0
honest snapshot, not the A/B baseline).

## Known caveat — strict-T3 over-strictness
`resolveT3StrictCorrect` scans the whole output for title snippets and requires
*exactly* 3 distinct cited ids. A correct-but-verbose answer (preamble that names
other posts, then the right 3) would score strict-fail. It does not bite this
baseline (the failures are genuine: wrong picks / no-filter dumps / unfinished
output — see audit). Flagged so a future verbose-but-correct run is not misread as a
regression.

## postConditionsMet column
Emitted as stub (`—`) this phase. Phase 1 wires it to real `verify(...)` output, then
this baseline is re-run **on the pinned fixture** to compare honest-vs-prose
completion rates.
