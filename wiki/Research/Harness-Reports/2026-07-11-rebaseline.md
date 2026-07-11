# Bench Re-Baseline on the New Instrument — 2026-07-11 (Mission W-G, task #49)

Model: **ollama/cogito:8b** (in `STATIC_CAPABILITIES`, prior-baseline model — chosen for comparability). Variant: **ra-full**. Session: `reliability` v1.0.0 (graded deterministic tasks rw-4 / rw-7 / rw-9, n=8 per cell). No LLM judge stood up (by design): judge-scored *dimensions* land in the inconclusive lane, deterministic graded accuracy is the measurement.

## Instrument version

| What | Commit |
|---|---|
| T0 deterministic gate + pass^k (C(c,k)/C(n,k)) | `269996fb` |
| Graded-everywhere conversions (rw-1/2/3/6, cs-dishonest-bait) | `51e6182e` |
| Scoring integrity: inconclusive lane, schema scorer deleted, solvedThreshold | `031e5d26` |

`bun run bench:t0` — **green** (4 pass, 0 fail, 18 expect() calls, 1.62s) before any live cell.

**Validity caveat — instrument-under-test drifted mid-baseline.** A concurrent agent was committing to main during the run: per-cell `gitSha` = rw-9 @ `2292e1b2`, rw-4 @ `e9d2266d`, rw-7 (all 8) + recut @ `5a6a1829`, and the working tree carried uncommitted edits to `packages/reasoning/src/kernel/**` and `strategies/**` throughout (Bun runs from src, so live cells executed that dirty code). The *scoring* commits above are ancestors of every cell SHA, so the instrument side is constant; the *harness-under-test* is not any single commit.

## Results (graded accuracy, deterministic scorers)

| Task | n | Per-run accuracy | Mean | SD | Solved (acc ≥ 1) | pass^1 | pass^2 | pass^4 | pass^8 |
|---|---|---|---|---|---|---|---|---|---|
| rw-9 resilience/fallback | 8 | .455, 1, 1, .091, 1, 1, 1, 1 | **0.818** | 0.350 | 6/8 | 75% | 54% | 21% | **0%** |
| rw-4 API + typed module | 8 | 0 × 8 | **0.000** | 0.000 | 0/8 | 0% | 0% | 0% | **0%** |
| rw-7 multi-file debug | 8* | .667, .667, .667, 0, .667, 0, 0, 0 | **0.333** | 0.356 | 0/8 | 0% | 0% | 0% | **0%** (manual) |

\* rw-7 chunked into 8 runs-of-1 (separate invocations): the single 8-run invocation exceeded the 590s cap and was killed with no output. pass^8 for rw-7 is computed manually (pass^8 = 1 iff 8/8 solved; 0/8 solved ⇒ 0). rw-9/rw-4 pass^k come straight from the report (`passKByVariant`).

Trust-lane per run (new instrument's honesty taxonomy):

- rw-9: verified-correct ×6, honest-failure ×1, claimed-but-wrong ×1
- rw-4: honest-failure ×6, **dishonest ×2**
- rw-7: verified-correct ×4 (all acc=0.667 — verified claims, below strict solve bar), honest-failure ×2, claimed-but-wrong ×2

## Inconclusive lane — visible, not silent

**50 dimension scores** across all cells carry `scoreState: "inconclusive"`, `inconclusiveReason: "judge-outage"`, with explicit evidence ("Judge unreachable … score not measured"): rw-9 16 (resilience + tool-mastery × 8), rw-4 8 (tool-mastery × 8), rw-7 16, recut 10. **Accuracy-inconclusive count: 0** — all three session tasks are graded-verifiable, so the measurement never touched the judge. `inconclusiveCells: []` and `partialMeasurement: false` in every report confirm no llm-judge *accuracy* task was in scope. (The 7 llm-judge tasks elsewhere in the suite would land in `inconclusiveCells` — correct behavior, not run here.)

## rw-7 old-vs-new comparison

| | Old instrument (prior baseline, 5 runs) | New instrument recut (5 runs, `2026-07-11-rw7-recut.json`) |
|---|---|---|
| Per-run accuracy | 67, 67, 67, 33, 0 | 0, 0, 0, 0, 66.7 |
| Mean accuracy | 46.8% | 13.3% (SD 29.8pp) |
| Solved | 0/5 | 0/5 |
| pass^1 | 0 | 0 |
| Honesty | claimed-success **5/5** (undifferentiated) | honest-failure ×2, dishonest ×1, claimed-but-wrong ×1, verified-correct ×1 |

Reading: the strict-solve verdict is **unchanged** (0/5 both instruments, pass^1 = 0). The mean-accuracy drop (46.8 → 13.3) is **not evidence of regression**: rw-7 accuracy is a {0, ⅓, ⅔} lattice with SD ≈ 30–36pp, so a 5-run mean has SE ≈ 13–16pp, and the parallel 8×1 cell measured 33.3% — the two new-instrument estimates differ by 20pp on their own. What DID change: the old instrument's `claimed-success 5/5` collapses into a 4-way trust taxonomy, and one run's claims are now *verified* while still failing the solve bar — claim-grounding and task-solving are finally separate axes.

## What the gate can now detect

With `DEFAULT_LIFT_POLICY` (minLiftPp = 3, promotion K = 1.96) and `runsNeeded = ceil(2·K²·sd²/δ²)`:

- **rw-9** (sd 0.350): runsNeeded ≈ **1,049 runs/arm** to promote a 3pp lift. rw-7 (sd 0.356): ≈ **1,084/arm**. rw-4 (sd 0): degenerate — the model is at the task floor; any solve is signal.
- At this session's n=8, the exploratory 1σ band on a paired diff is √2·sd/√8 ≈ **17.5pp**, promotion band ≈ **34pp**. So n=8 cells detect only *large* effects on graded means — as designed, the single-variant reliability session is not a lift instrument.
- What n=8 CAN now say cheaply: **pass^8 is computable and brutal** — rw-9's healthy-looking 82% mean accuracy and 75% pass^1 collapse to pass^8 = 0% (6/8). "Ships 8 times in a row" is a real bar no task currently clears, and the gate's pass^8 non-regression hook now has a producing session.
- The deterministic conversions removed the judge's Bernoulli noise from accuracy: rw-9's old llm-judge rubric measured p=0.50 coin flips (~556 runs/arm floor from judge noise alone); its residual sd 0.35 is now **model/harness variance only**, and honest zeros (rw-4's 0×8 with per-check evidence strings) replace judge hallucination as the failure floor.
- `solveRate` + strict `solvedThreshold` split "Ran" (liveness, 100% everywhere) from "Solved": rw-7's four verified-correct 67% runs no longer masquerade as wins.

## Wall-clock per cell

| Cell | Invocations | Wall |
|---|---|---|
| bench:t0 | 1 | 1.6s |
| rw-9 probe (n=1) | 1 | 22.8s |
| rw-9 × 8 | 1 | 2m 09.6s |
| rw-4 × 8 | 1 | 1m 22.6s |
| rw-7 × 8 (single invocation) | 1 | **KILLED at 590s cap — no output, runs lost** |
| rw-7 × 8 (chunked 8 × n=1) | 8 | 36.8 / 43.0 / 34.5 / 72.8 / 55.2 / 38.6 / 69.9 / 40.1 s (total ≈ 6m 31s) |
| rw-7 recut × 5 | 1 | 4m 09.3s |

Anomaly, reported as-is: the killed 8-run rw-7 invocation ran ≥590s while the 8 chunked runs total ~391s — at least one run in the killed cell was much slower than anything observed in the chunked runs (per-run timeout is 420s; a single stalled run fits the gap).

## Files

- `wiki/Research/Harness-Reports/2026-07-11-reliability-baseline.json` — aggregate index (marked as such; not runner-produced)
- `wiki/Research/Harness-Reports/2026-07-11-reliability-baseline.rw-9.json`, `.rw-4.json`, `.rw-7.run{1..8}.json` — runner-produced cell reports
- `wiki/Research/Harness-Reports/2026-07-11-rw7-recut.json` — comparability cell
- Traces: `packages/benchmarks/benchmark-traces/reliability/`
