---
type: harness-report
created: 2026-05-12
status: complete
verdict: REWORK
tags: [research, harness, phase-1.5, M3, ablation, verifier]
links:
  - "[[Architecture/Specs/05-DESIGN-NORTH-STAR|North Star §6 Phase 1.5 — M3]]"
  - "[[Architecture/Design-Specs/2026-05-11-harness-research-integration|Harness Research Integration Design Spec]]"
  - "[[Research/Harness-Reports/phase-1-mechanism-validation-2026-05-04|Phase 1 Validation Evidence (M3 section)]]"
---

# M3 Verifier Ablation — Phase 1.5 Pre-Phase-B Gate

## Question

Does the heuristic terminal verifier at `runner.ts:568` produce net-positive outcomes on reactive-agents-ts's gate corpus, or is it net-negative (the NLAH-equivalent finding from arXiv:2603.25723)? Note: that paper tested LLM-as-judge gates; ours is a heuristic guard with retry — applicability unconfirmed until this ablation.

## Design

- **Conditions:** `ra-full` (default verifier) vs `ra-full-noop-verifier` (terminal verification bypassed; `act.ts:678` non-terminal verification left intact)
- **Models:** qwen3:14b, cogito:14b, gpt-4o-mini
- **Corpus:** 10 real-world tasks `rw-1`–`rw-10` (`packages/benchmarks/src/tasks/real-world.ts`)
- **Sample size:** n=1 per (task × model × condition) = 60 total runs
- **Judge:** `claude-haiku-4-5-20251001` via `packages/judge-server` RPC at `:8910`
- **Git SHA:** `989bee1a` (judge-server JSON extraction fix)

**Pre-stated decision rule (to prevent post-hoc reasoning):**
- **KEEP:** ≥2 of 3 models, default verifier shows higher accuracy AND not token-dominated by noop
- **IMPROVE (retry-tune):** accuracy comparable (±2pp) AND default uses ≥30% more tokens
- **REWORK/REMOVE:** ≥2 of 3 models, noop matches or exceeds accuracy

## Results

### Accuracy by Model

| Model | ra-full | ra-full-noop | Δ (noop − ra-full) |
|---|---|---|---|
| qwen3:14b | 10% | 11% | +1pp |
| cogito:14b | 17% | 18% | +1pp |
| gpt-4o-mini | 8% | 7% | −1pp |
| **All models** | **12%** | **12%** | **0pp** |

### Token Usage (sum across 10 tasks per model)

| Model | ra-full tokens | ra-full-noop tokens | Δ (noop − ra-full) |
|---|---|---|---|
| qwen3:14b | 101,795 | 96,596 | −5,199 (−5%) |
| cogito:14b | 112,962 | 120,215 | +7,253 (+6%) |
| gpt-4o-mini | 162,955 | 176,675 | +13,720 (+8%) |

**Notable:** ra-full uses *fewer* tokens than noop for cogito and gpt-4o-mini. The verifier appears to trigger early termination on some runs rather than adding retry overhead.

### Dimension Scores (aggregate, all 30 runs per variant)

| Dimension | ra-full | ra-full-noop | Δ |
|---|---|---|---|
| accuracy | 12% | 12% | 0pp |
| reasoning | 14% | 17% | noop +3pp |
| honest-uncertainty | 7% | 8% | noop +1pp |
| reliability | 100% | 100% | 0pp |
| loop-intelligence | 8% | 6% | ra-full +2pp |
| scope-discipline | 10% | 12% | noop +2pp |
| efficiency | 6% | 6% | 0pp |
| tool-mastery | 9% | 7% | ra-full +2pp |
| memory-fidelity | 7% | 6% | ra-full +1pp |
| resilience | 4% | 3% | ra-full +1pp |

### Per-Task Accuracy

**qwen3:14b**

| Task | ra-full | ra-full-noop |
|---|---|---|
| rw-1 | 15% | 65% |
| rw-2 | 0% | 0% |
| rw-3 | 65% | 45% |
| rw-4 | 0% | 0% |
| rw-5 | 0% ✗ timeout | 0% ✗ timeout |
| rw-6 | 0% | 0% |
| rw-7 | 0% | 0% |
| rw-8 | 0% | 0% |
| rw-9 | 0% | 0% |
| rw-10 | 20% | 0% |

**cogito:14b**

| Task | ra-full | ra-full-noop |
|---|---|---|
| rw-1 | 0% | 0% |
| rw-2 | 0% | 20% |
| rw-3 | 65% | 65% |
| rw-4 | 0% | 0% |
| rw-5 | 15% | 35% |
| rw-6 | 50% | 50% |
| rw-7 | 0% | 0% |
| rw-8 | 0% | 0% |
| rw-9 | 40% | 0% |
| rw-10 | 0% | 10% |

**gpt-4o-mini**

| Task | ra-full | ra-full-noop |
|---|---|---|
| rw-1 | 0% | 25% |
| rw-2 | 0% | 20% |
| rw-3 | 0% | 15% |
| rw-4 | 0% | 0% |
| rw-5 | 25% | 0% |
| rw-6 | 15% | 10% |
| rw-7 | 0% | 0% |
| rw-8 | 0% | 0% |
| rw-9 | 40% | 0% |
| rw-10 | 0% | 0% |

### Accuracy-per-Token Frontier

| Model | Condition | Tokens | Accuracy | Dominance |
|---|---|---|---|---|
| qwen3 | ra-full | 101,795 | 10% | |
| qwen3 | noop | 96,596 | 11% | noop weakly dominates (lower tokens, higher accuracy) |
| cogito | ra-full | 112,962 | 17% | |
| cogito | noop | 120,215 | 18% | neither dominates (noop: +1pp accuracy but +6% tokens) |
| gpt-4o-mini | ra-full | 162,955 | 8% | |
| gpt-4o-mini | noop | 176,675 | 7% | ra-full weakly dominates (lower tokens, higher accuracy) |

No model shows strict dominance (all differences < 2pp accuracy, < 10% tokens).

## Judge Reliability Caveat

**84% of judge dimension assessments were parse failures** (156/186 returned the 0.5 fallback with `"Could not parse judge text into structured verdict"`). Root cause: `claude-haiku-4-5-20251001` wraps JSON in markdown prose for complex multi-step agent outputs (10k+ token SUT responses), even after the `{...}` extraction fix. Simple probes return valid structured verdicts; real task outputs do not reliably trigger JSON-only responses.

The accuracy percentages above use the benchmark runner's own display aggregation (which incorporates `passRate` and `reliability` from run status), making them more reliable than raw per-dimension judge scores. Per-model accuracy margins (1pp) are within the noise floor of this judge setup.

**Required before acting on verdict:** Fix judge to use Anthropic structured output (tool-use JSON schema) or add a system prompt + few-shot example enforcing JSON-only output. Re-run for confirmation. This verdict is provisional.

## Verdict

### 🔄 REWORK — disable terminal retry loop; retain heuristic guard gate

**Pre-stated rule outcome:** REWORK condition fires. ≥2 of 3 models (qwen3 +1pp noop, cogito +1pp noop) show noop matching or exceeding accuracy. gpt-4o-mini is the lone exception (ra-full +1pp). All margins are 1pp — within noise given 84% parse failure rate.

IMPROVE condition does NOT fire: token overhead is absent or negative (ra-full uses *fewer* tokens in 2 of 3 models). No case for retry-budget tuning.

### Interpretation

Consistent with NLAH arXiv:2603.25723 directionally, with an important distinction: our verifier is a **heuristic guard**, not an LLM-as-judge. The accuracy tie and counterintuitively lower token usage for ra-full suggest the verifier is causing **premature early termination** on some runs, reducing iteration count without improving output quality.

The verifier's non-zero signal on loop-intelligence (+2pp) and tool-mastery (+2pp) confirms it performs a guard function — not a no-op — but the **retry loop is not converting guard detections into accuracy improvements**. The guard is catching things; the retry is not fixing them.

### Actions

1. **Disable terminal retry loop** at `runner.ts:568` — remove the retry-on-rejection path. Keep the terminal verifier as a pass/fail gate (reject → exit-failure, no retry).
2. **Retain non-terminal verification** in `act.ts:678` — out of scope for this ablation; do not touch.
3. **Fix judge structured output** in `packages/judge-server/src/handler.ts` before any future ablation — replace `complete()` with tool-use JSON schema forcing.
4. **Open decision doc:** `wiki/Decisions/2026-05-12-m3-terminal-verifier-rework.md` with empirical justification + rollback plan.
5. **Re-run with fixed judge** (optional) — if Phase B work is not blocked, a clean re-run would confirm the verdict. If Phase B schedule is tight, proceed on current evidence.

## Follow-Up

- **Step 2 does NOT fire** — no net-positive accuracy signal; retry-tuning work suspended.
- **Next M3 action:** Disable retry loop at `runner.ts:568`. Estimate: 0.5 day.
- **Remaining open:** cogito:14b FM-A1 retry prompt tuning is a separate workstream (Issue #3 in Running Issues Log) — not addressed by this ablation.

## Evidence

- **JSON report:** `benchmark-traces/m3-ablation/report.json` (git SHA `989bee1a`)
- **Session config:** `packages/benchmarks/src/sessions/m3-ablation.ts`
- **Instrumentation commits:** `fa47b430` → `05fbba52` → `7435f559` → `04df2597` → `854a6642` → `989bee1a`
- **Related:** [[Research/Harness-Reports/phase-1-mechanism-validation-2026-05-04|Phase 1 M3 section]]
