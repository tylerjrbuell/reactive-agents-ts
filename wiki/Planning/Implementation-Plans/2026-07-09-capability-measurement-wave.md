# Capability Measurement Wave — 2026-07-09

**The question this wave exists to answer:** *are the agents getting more capable, and more efficient?*

**The honest answer today: we cannot tell.** Not "the numbers are flat" — we have never recorded the series that would show a trend. This document is the evidence for that claim and the ordered work to fix it.

Every finding below is source- or execution-verified at HEAD `69c4ef9e`.

---

## The measurement system cannot answer the question

### F1 — There is no longitudinal series. The machinery exists and was never used.

`--save-baseline`, `--baseline`, `--ci`, `saveBaseline`, `loadBaseline`, `computeDrift`, `exceedsThreshold` all exist (`run.ts:23,187-189,251,273`; `ci.ts`).

- `benchmark-baselines/` **does not exist**. Zero baselines have ever been committed (`git ls-files | grep baseline` returns only a 2026-04-07 markdown snapshot and an unrelated probe script).
- `eval.yml` and `regression-gate.yml` are **both `workflow_dispatch`-only**. `eval.yml` self-describes as *"Disabled auto-triggers (always failing)."*
- So `computeDrift` — the one function whose entire purpose is "did we get better or worse than last time" — has **never run against a stored baseline**.

This is the *built-never-wired* disease, in the instrument we would use to detect the disease. It is the reason the question has no answer, and it is P0.

### F2 — Most of the suite is Bernoulli, which makes improvement undetectable at any affordable n

| scoring | tasks | per-run score | sd |
|---|---|---|---|
| `llm-judge` | 7 (rw-1,2,3,5,6,10, cs-dishonest-bait) | 0/1 in practice | ~0.50 |
| `regex` | 3 (cs-overflow-×2, cs-recall) | 0/1 | ~0.50 |
| `verifiable` + `partialCredit` | 3 (rw-4, rw-8, rw-9) | graded | ~0.257 (measured) |

The gate's own `runsNeeded = ceil(2·K²·sd²/δ²)` at a 3pp lift:

- sd 0.500 → **556 runs/arm** (20,016 live cells for one 2-arm verdict)
- sd 0.257 → **147 runs/arm** (5,292 cells)

**10 of 13 tasks are still at the worst-case variance.** The lift rule was never unmet — it was *unmeasurable*. This is why `ImprovementLedger` holds 4 entries and **zero `adopted`** (3 `opt-in`, 1 `rejected`).

### F3 — Exactly ONE task exercises the entire adaptive chain

`shouldUseLongHorizon(task) = task.tags?.includes("horizon:long")` (`runner.ts:96-98`).

Tagged `horizon:long`: **`lh-1`. That is the complete list.**

Everything gated behind the long-horizon profile is therefore measured by a single Bernoulli cell:

- `RunAssessment` → phase inference → projector emphasis (incl. the `verify` phase, reachable as of `f466eb13`)
- the F3 error-recovery control seam (`a102bcc9`)
- the stall control seam (`69c4ef9e`)
- `.withAdaptiveHarness()` / the policy compiler's only live lever
- every `evidenceProgress` / arg-variety suppression in `emitters.ts`

**Consequence:** the last two weeks of harness work is unmeasurable *by construction*, regardless of how many runs we buy. Adding runs cannot fix a coverage hole.

### F4 — The bench reports success when it runs nothing

Executed today: `run.ts --provider ollama --model cogito:8b --task rw-4,rw-8,rw-9 --variant ...` **without `--session`**.

Result: `Tasks 0` → `✨ All 0 tasks completed in 0.0s` → a Results box of zeros → a written report → **exit code 0**.

`--task`, `--variant`, and `--gate` are only honored on the *session* path (`run.ts:205+`); the legacy path silently selected zero tasks. There is no `tasks.length === 0` guard anywhere in `run.ts` or `runner.ts`.

A measurement instrument that passes green while measuring nothing will eventually certify a regression as a win.

### F5 — What IS now sound

Not everything is broken, and the recent fixes are load-bearing here:

- The lift gate decides by **effect**, not sample count: SE-of-difference bar, Agresti-smoothed spread, a reachable `underpowered` verdict, `minRuns: 3` (`8407e955`).
- `powerWarningFor(report)` runs **unconditionally** on every multi-variant session (`run.ts:259`), so an underpowered claim announces itself.
- `evaluateLiftGate` has a production caller at last (`--gate`, `on-path.ts`).
- All 8 invariant scripts execute, in a test and in CI (`385bb686`).

So the *verdict* machinery is trustworthy. The *evidence* feeding it is not.

---

## What "more capable" and "more efficient" must mean

Two numbers, reported side by side, **never blended into one scalar** (a single score invites tuning to it — see `feedback_no_metric_gaming_refactor`):

- **Capability** — mean graded score on a frozen task set, per model tier. Deterministic where possible; the judge only where deterministic grading is genuinely impossible.
- **Efficiency** — *tokens per unit of score* and *iterations to first success*. Aggregate accuracy hides the case where `ra-full` beats `manual-react` on quality while costing 3× the tokens. That trade is the product decision; hiding it is not.

A change is an improvement only if capability rises without efficiency regressing, or efficiency rises without capability regressing. Anything else is a trade to be argued explicitly, in the ledger.

---

## The wave, in order

Each item carries the owner's completion rule: **a non-test consumer reads it and behavior changes; a test fails when the wiring is cut; if a script guards it, something runs the script.**

### P0 — The instrument must not lie (hours)

1. `run.ts` / `runner.ts`: **hard-fail on zero resolved tasks or zero variants** (non-zero exit, no report written).
2. Make `--task` / `--variant` / `--gate` either work on the legacy path or **reject with a usage error** rather than degrade to a 0-task run.
3. Pin: a test invoking the CLI with an unmatched `--task` asserts a non-zero exit. Cut the guard → red.

*Why first: every number produced after this point depends on it.*

### P1 — Record the series (hours)

1. Create `benchmark-baselines/` and commit a first snapshot per frozen session, keyed by git SHA.
2. Wire `--ci` + `computeDrift` into a workflow that runs on demand **and stores its artifact**, so run N+1 can diff run N.
3. Pin: `computeDrift` gets a real caller; a test drives baseline → candidate → drift and asserts the regression verdict. Cut it → red.

*This is the single change that converts "we shipped things" into "we got better."*

### P2 — Make lift affordable: finish the graded conversion (days)

Convert the 7 `llm-judge` tasks to deterministic graded checks wherever the deliverable admits it (`rw-3` is already `verifiable`, just not graded — cheapest first). Precedent and harness: `graded-check.ts`, `gradedCheckHarness()`, `parsePartialCreditScore`.

Target: **suite-wide sd ≤ 0.30**, taking a 3pp verdict from ~20k cells to ~5k.

Rule carried from the rw-9 conversion: **a metric change is declared in the commit and invalidates prior comparisons.** No silent re-baselining.

Where a judge is unavoidable (open-ended research quality), keep it — but mark those tasks as *not eligible for lift verdicts*, and say so in the report rather than averaging them in.

### P3 — Close the long-horizon coverage hole (days)

Tag or author enough `horizon:long` tasks that the assessment → control → projector chain is exercised by **more than one cell**. Without this, P1 and P2 still cannot see any of the 2026-07 harness work.

Acceptance: a bench arm that flips `horizon:long` shows a *measurable* difference on at least one deterministic task, or we have learned the chain does nothing — which is itself the verdict we need, and would justify deleting it.

### P4 — Then, and only then, resume harness improvement

With P0–P3 done, the two control-seam fixes and the verify-phase fix get a real gate verdict, and `ImprovementLedger` can record its first `adopted` entry on evidence.

---

## Explicitly deferred (and why)

- **The remaining 4 control emitters** — verified no-delta (`grounded-terminal` already single-owner; `dispatcher` measured as already abstaining; `veto` is priority 0; `budget` is sole-proposal by design). Wiring them would be write-only. Do not.
- **`verifierTier`'s 4 tiers vs 2 verifier implementations** — a design job, not wiring. Needs a decision: build the tiers, or delete the lever.
- **5 unminted ledger kinds** (`requirement`, `handoff`, `contract-amended`, `checkpoint-marker`, `deliverable-commit`). `handoff` may be a *deletion* candidate: `strategy-switch.ts` already carries the summary via `priorContext`, so an emitter would double-render. Verify before wiring.
- **`check-control-plane.sh`'s grandfathered list has not shrunk.** Its own comment says it must. The script is green *because* of the exemptions — a fourth form of the disease: *checked, but exempted*.

## Non-goals (carried)

- No new benchmark tasks authored for publication/marketing. Self-built benches are internal tooling, not public claims.
- No hitting a target by redefining it.
- No blended capability×efficiency scalar.
