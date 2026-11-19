---
type: experiment
status: pre-registered
created: 2026-11-18
tags: [harness, calibration, adaptive, lift-gate, h3]
---

# Adaptive (calibration) lift test: pre-registration

Written BEFORE any measured cell. Question: does the shipped calibration (+ act-or-answer `auto`) beat calibration off, and does a model's OWN calibration beat another model's? Source: [[2026-11-19-adaptive-harness-audit]] section 6.

## Arms (per tier; cogito:8b and qwen3:4b; 12 frozen H3 tasks; k=5)

| arm | `RA_BENCH_CALIBRATION` | `RA_ACT_OR_ANSWER` | builder call |
|---|---|---|---|
| OFF | `skip` | `0` | `.withCalibration("skip")` |
| ON | `auto` | `auto` | `.withCalibration("auto")` (shipped) |
| SWAP | `swap` | `auto` | `.withCalibration(<partner model's shipped ModelCalibration object>)` (cogito gets qwen3:4b's, qwen3:4b gets cogito's) |

Seam added in `packages/benchmarks` only: `HarnessConfig.calibration`, `calibrationArmVariant` (run-h3.ts), consumed in run-internal.ts. Variant id stays `ra-default` so cell ids pair across arms; one results file per arm.

Disclosed SWAP limit: consumer-level only. The kernel adapter still file-loads by modelId under `auto` (profile/adapter hooks keyed on the real model), so SWAP swaps what consumers of the resolved `ModelCalibration` see (act-or-answer mode, parallel hint, result-char cap, etc.), not the adapter's own file-load.

Learned tier off, community tier off (builder defaults). Tasks: `H3_TASKS` (12, frozen, not suite v2). Cell timeout 180 s. Run-major order, arms interleaved per chunk so host drift hits all arms.

## Void rule

Drop and rerun any cell whose `run-started.config.calibration` does not match its arm:
- OFF: `mode == "skip"`, no fields.
- ON: `mode == "auto"`, fields non-empty, each with a provenance `source`.
- SWAP: `mode == "custom"`, `modelId` == the partner model.
Also void: no trace; actOrAnswer source not as designed (OFF default-off; ON/SWAP resolved from calibration). Inconclusive cells (preflight/fallback capability) excluded by the existing `isMeasured` rule.

## Decision rule (existing code, no new statistics)

- ON vs OFF per tier via `h3/verdict.ts` / `h3/paired.ts` `pairedRead` (paired by task, graded accuracy), policy semantics of `DEFAULT_LIFT_POLICY`: >= 2 tiers, >= 3pp aggregate lift, <= 15 % billed-token overhead (tokens per solved run reported as the survivorship guard; Ollama billed tokens reported though free per owner ruling). A tier with a resolvable regression gives REWORK/reject.
- SWAP vs ON: calibration carries model-specific information only if ON beats SWAP by >= 3pp on average AND on both tiers.
- Per-field effects: descriptive only (which fields differed in traces).
- Power: 12 tasks x k=5 = 60 cells per tier-arm; Bernoulli SE about 6pp per arm. Any |lift| < ~10pp per tier is reported as "flat / underpowered", never as "no effect".

## Predictions (from audit evidence)

| # | prediction | basis |
|---|---|---|
| P1 | ON - OFF is inside +/-6pp on both tiers; gate says flat/opt-in, not default-on | 2026-11-11 A/B: -3.0pp cogito, -0.9pp qwen3:4b at n=3; shipped files near-uniform |
| P2 | SWAP ~= ON (|diff| < 5pp) on both tiers | shipped values barely differ (steering hybrid, uses-recall, strong, 2000, native-fc on both) |
| P3 | Only real differences: cogito `actOrAnswer proactive` vs qwen `retry`; `parallelCallCapability` sequential-only vs reliable. cogito SWAP (gets `retry`, `reliable`) is the arm most likely to move, slightly negative | A/B-proven proactive on cogito |
| P4 | Billed-token overhead ON vs OFF <= 15 % (forced tool calls add few tokens) | act-or-answer fires on stall turns only |
| P5 | ON does not beat OFF at the gate bar on both tiers | audit section 6: calibration never passed a lift gate |

## Provenance (start)

HEAD at pre-registration: `76b094960b09f36e9efdd187098af7ea761ee5d9`; last commit touching `packages/reasoning/src`: `02b802193`; reasoning src dirty: no. Each chunk logs HEAD, reasoning-src SHA, dirty flag and `ollama ps` to `chunks.log`.

## Amendment 1: scope cut to cogito:8b only (2026-11-19, before any new measured cell)

- Reason: the two-tier run was too slow. 48 of 360 cells took about 1 h (qwen3:4b cells plus tier model swaps cost about 2 min per cell, about 10 h remaining), and it blocked another session's kernel work on the shared checkout. The owner chose to cut to cogito:8b only.
- New run: cogito:8b only, same 12 frozen H3 tasks, k=5, arms OFF/ON/SWAP, 180 cells, new state dir `/home/tylerbuell/h3-traces-adaptive-lift-cogito`. Arms, void rule, scorer and suite unchanged.
- The 48 earlier cells (36 cogito run-0 + 12 qwen3:4b, dir `/home/tylerbuell/h3-traces-adaptive-lift`) are kept as a pilot and are NOT pooled into any verdict.
- Consequence: the gate's >= 2 tiers rule cannot be met. No default-on or KEEP claim is possible from this run. Verdict language is limited to single-tier: lift / regression / flat-underpowered.
- (Amendment 2, 2026-11-19, before analysis) The cogito run was stopped early at 131/180 cells (off=44, on=44, swap=43) at owner request, to release the shared checkout. Verdicts use only balanced (task, run) triples present in all three arms: 43 per arm (1 off and 1 on cell dropped). Power is reduced (SE about 7pp per arm), single tier, tasks unevenly weighted (7 tasks have 4 runs, 5 have 3). No KEEP, adopt or default-on language is permitted; allowed outcomes: lift / regression / flat-underpowered on cogito:8b only. The supervisor was not resumed after the stop.
- Predictions P1-P5 stand for cogito:8b only; the qwen3:4b halves of P1-P3 are untested. P5 (both tiers) is unmeasurable.
