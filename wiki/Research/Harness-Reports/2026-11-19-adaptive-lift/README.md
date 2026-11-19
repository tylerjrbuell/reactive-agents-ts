---
type: experiment
status: partial-single-tier
created: 2026-11-19
tags: [harness, calibration, adaptive, lift-gate, h3]
---

# Adaptive (calibration) lift, cogito:8b only, partial (131/180)

Pre-registration: [[PREDICTIONS]] (Amendment 1: scope cut to cogito:8b; Amendment 2: stopped early). State dir `/home/tylerbuell/h3-traces-adaptive-lift-cogito` (traces, off/on/swap.json). Spec `drive-spec-cogito.json`. Pilot dir `/home/tylerbuell/h3-traces-adaptive-lift` (48 cells, not pooled).

Stopped at 131/180 by owner request (off=44, on=44, swap=43). Analysis uses balanced (task, run) triples only: 43 per arm. HEAD moved mid-run (docs/cortex commits only; no diff in reasoning, runtime, llm-provider or benchmarks src vs the start SHA 994843dda). The supervisor died once at 131 cells (unexplained, empty supervisor.log); the owner then stopped it, not resumed.

## Void table (every kept cell matched its arm)

| arm | cells | kept | void |
|---|---|---|---|
| off (skip) | 44 | 44 | 0 |
| on (auto) | 44 | 44 | 0 |
| swap (custom, partner qwen3:4b) | 43 | 43 | 0 |

No inconclusive cells. No reruns needed. OFF traces: mode skip, no fields, actOrAnswerSource explicit. ON: auto, 11 fields all source shipped, actOrAnswerSource calibration. SWAP: custom qwen3:4b, source custom, actOrAnswerSource calibration.

## Results (cogito:8b, balanced n=43 per arm, graded accuracy)

| arm | accuracy | solved | total billed tok | tok per cell | tok per solved run |
|---|---|---|---|---|---|
| OFF | 65.7% | 17/43 | 238,235 | 5,540 | 14,014 |
| ON | 76.7% | 20/43 | 256,293 | 5,960 | 12,815 |
| SWAP | 74.3% | 21/43 | 281,457 | 6,546 | 13,403 |

- OFF -> ON (verdict.ts, paired by task): accuracy lift +10.7pp, band +/-9.7, McNemar +3/-0 p=0.25. Tool verdict NO-CHANGE, "within noise". Billed-token overhead +7.6% (under the 15% bar); tokens per solved run -8.6%. Single tier: lift bar 3pp and overhead bar are met numerically, but the gate's >= 2 tiers rule cannot be met. This run cannot support default-on. Honest read: positive lean, underpowered.
- SWAP vs ON: accuracy -1.9pp (band +/-9.8, McNemar +4/-3 p=1.0), tokens +9.8% over ON. ON does not beat SWAP by the 3pp bar: calibration shows no model-specific signal on cogito:8b at this power (flat/underpowered).
- Per task OFF / ON / SWAP accuracy %: rw-2 50/50/42, rw-3 75/71/79, rw-6 48/75/63, rw-7 0/42/33, rw-9 75/100/86, ab-trap-4 and -5 100 all, h3-plan-only 78/61/61, h3-todo-heavy 11/56/67, h3-required-tools 56/67/67, h3-continuation and h3-exact-value 100 all. The ON gain comes from rw-7, rw-6, h3-todo-heavy, rw-9. The one task where ON/SWAP are below OFF: h3-plan-only (-17pp, 3 runs).
- Veto flags (verdict.ts new harness reasons): ON vs OFF: stall-after-work 0->2, false-veto 0->1, tool-call-dropped 0->1. SWAP vs ON: forcing-unused 0->1. Counts are tiny; per-task attribution not resolvable.

## Prediction check (cogito only)

- P1 (ON-OFF within +/-6pp): not held, +10.7pp observed, but within the +/-9.7 band and inside the pre-registered "|lift| < ~10pp is underpowered" zone only at the edge. Treat as unresolved, leaning positive.
- P2 (SWAP ~= ON within 5pp): held (-1.9pp).
- P3 (cogito SWAP slightly negative): not supported (-1.9pp vs ON; +7.7pp vs OFF).
- P4 (overhead <= 15%): held (+7.6%).
- P5: unmeasurable (single tier).

## What differed in traces ON vs OFF (mechanism activity)

Calibration fields (cogito shipped vs OFF skip): steeringCompliance hybrid, parallelCallCapability sequential-only, observationHandling uses-recall, systemPromptAttention strong, optimalToolResultChars 2000, actOrAnswer proactive, toolCallDialect native-fc. Which of these changed behavior in traces: only act-or-answer shows up. guard:act-or-answer:redirect 0/43 -> 32/43; unresolved-tool-call-guard redirects and tool_call_extracted warns 16/43 -> 0/43; grounded-terminal-gate redirects 15/43 -> 4/43; terminal_status_override warns 16/43 -> 10/43; pending_batch warns 2/43 -> 7/43. SWAP (gets `retry`, `reliable`): act-or-answer redirects 32 -> 19, unresolved-tool-call-guard 0 -> 9, tool-gate blocks 0 -> 4.

## Caveats

- The OFF arm bundles two switches: calibration skip AND `RA_ACT_OR_ANSWER=0` (pre-registered). The ON lift cannot be attributed to calibration fields beyond act-or-answer; act-or-answer redirect is the only mechanism that visibly changes.
- Unbalanced task weights (4 vs 3 runs); Ollama load pauses and a foreign Cortex dev server shared the host (pauses logged by the driver, not overridden with allowContention).
- Single tier, partial run, n=43 per arm: SE about 7pp per arm.

Next if pursued: finish the missing cogito cells (49 pending), then the qwen3:4b tier, to allow a gate verdict. Scoring input files for this read were balanced subsets generated in a scratchpad from off/on/swap.json.
