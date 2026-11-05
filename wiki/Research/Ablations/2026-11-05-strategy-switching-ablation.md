---
type: ablation
status: complete
created: 2026-11-05
tags: [ablation, lift-gate, strategy-switching, h3, default-on]
---

# Ablation: strategy switching (`enableStrategySwitching`, default on)

**Warden:** ablation-warden
**SHA:** `9535ba7f2` (both arms, all four tier files; HEAD did not move, tree clean throughout)
**Arms:** candidate `ra-default` (switching on, the shipped default) vs baseline `ra-default-noswitch` (`run-h3.ts --no-switch`, added in `3c6fe2b07`)
**Tasks:** rw-2, rw-6, rw-7, rw-9, h3-todo-heavy · **Tiers:** qwen3:4b, cogito:8b · **k = 3** · cell timeout 150 s
**Why:** a trace analysis of 160 H3 runs (2026-11-05) found 33 runs switched strategy. Those runs made 182 LLM calls after the switch, and 26 of the 33 still failed.

## Verdict: UNDERPOWERED (gate). The evidence does not support default-on.

> **Follow-up:** see the k=8 follow-up section below (`b0f7f3f8a`, cogito:8b rw-7 and h3-todo-heavy). Gate: **OPT-IN**. Lift is -6.2pp (within noise) at +28.1% billed tokens. 0 of 14 switched runs solved.

`rax eval gate` decision: **underpowered**. Aggregate lift is -9.9pp at +8.2% billed tokens over 2 tiers. The report is PARTIAL. Ledger entry `35d20e8a-7bb6-47d5-be09-df9723c2c7ee` is in `wiki/Research/Harness-Reports/improvement-ledger.json`.

Underpowered is NOT evidence of no effect. But this run gives no evidence of lift either. Switching does not pass the rule that justifies a default-on mechanism. The default stays as it is: changing it is out of scope for this brief and is a parent/user decision.

## Gate receipt (billed-token leg scored)

| Tier | base (noswitch) acc | cand (default) acc | lift | billed tok overhead | tier verdict |
|---|---|---|---|---|---|
| qwen3:4b | 60.6 | 73.3 | +12.8pp | +15.7% | INCONCLUSIVE |
| cogito:8b | 44.3 | 34.4 | -9.9pp | +8.2% | BELOW |

Per-task lift (pp ± 1σ band):

| Task | qwen3:4b | cogito:8b |
|---|---|---|
| rw-2 | +5.6 ± 39.7 | -11.1 ± 40.6 |
| rw-6 | +0.0 ± 32.7 | -66.7 ± 36.5 |
| rw-7 | +33.3 ± 61.0 | +11.1 ± 34.4 |
| rw-9 | +0.0 ± 32.7 | +39.4 ± 36.8 |
| h3-todo-heavy | +25.0 ± 45.9 | -22.2 ± 39.6 |

Why the gate returned underpowered: on qwen3:4b, rw-7 timed out (execution-timeout, scored inconclusive) in **3 of 3** no-switch runs and 1 of 3 default runs. h3-todo-heavy timed out once per arm. That leaves the no-switch rw-7 cell with 0 measured runs, below the `minRuns: 3` floor. Every other per-task band is 33-61pp wide at n=3. A 3pp promotion bar cannot be resolved at this n.

## Per-arm totals

| Tier | Arm | measured / 15 | mean acc | solved | mean billed tok | mean LLM calls | runs that switched | LLM calls after switch |
|---|---|---|---|---|---|---|---|---|
| qwen3:4b | default | 13 | 0.744 | 8 | 15,521 | 4.69 | 1 | 5 of 61 (8%) |
| qwen3:4b | noswitch | 11 | 0.758 | 7 | 15,598 | 5.73 | 0 | 0 |
| cogito:8b | default | 15 | 0.344 | 3 | 9,944 | 7.53 | 6 | 43 of 113 (38%) |
| cogito:8b | noswitch | 15 | 0.443 | 3 | 9,194 | 7.40 | 0 | 0 |

The no-switch traces record `run-started.config.strategySwitching: false`, and none of them has a `strategy-switched` event. The arm is wired.

## What the mechanism did when it fired (the decisive slice)

The switch fired in 7 of 30 default-arm runs: 1 on qwen3:4b, 6 on cogito:8b. **0 of 7 solved.** In 4 of the 7, the agent never called a tool after the switch.

| Cell | switched runs | acc (default / noswitch) | mean billed (default / noswitch) | mean LLM calls (default / noswitch) |
|---|---|---|---|---|
| cogito rw-7 | 3/3 | 0.11 / 0.00 (0/3 solved both) | 21,523 / 12,494 (**+72%**) | 14.0 / 9.7 |
| cogito h3-todo-heavy | 3/3 | 0.22 / 0.44 | 9,250 / 9,422 (-2%) | 9.7 / 9.7 |
| qwen rw-2 | 1/3 (run 2) | 0.00 on the switched run | 41,943 vs 23,030 mean of its non-switched siblings (~1.8x) | 9 vs 5 |

Where the switch fires on rw-7, it costs about 72% more billed tokens and buys no solve. On h3-todo-heavy it costs nothing extra, but accuracy is 22pp lower (within noise at n=3). The trace-analysis pattern reproduces: the switch spends calls, then the run stalls (`stall-after-work`) or the verifier rejects it (`verifier-reject`).

## Confounds and instrument notes

1. **Most of the per-tier lift is noise, not caused by switching.** On cogito, the -66.7pp on rw-6 and the +39.4pp on rw-9 come from cells where switching **never fired** in the default arm. The run-0 rw-6 traces in the two arms follow the same event path to an identical abstention. Their `run-started.config` differs only in the switching flag. The arms diverge at runs 1 and 2, which fits Ollama sampling variance. The qwen tier lift (+12.8pp) is the same kind of case: switching fired once there, and that run failed.
2. **qwen3:4b rw-7 timeouts.** 3 of 3 no-switch runs and 1 of 3 default runs hit the 150 s cell timeout. Timeouts are scored inconclusive and are not counted as failures. Whether switching shortens rw-7 on qwen cannot be told: the timed-out runs leave no trace. Switching never fired on the 2 default rw-7 runs that finished.
3. **Raw `tokens` undercounts switched runs.** On every switched run, `billedTokens` > `tokens`, for example cogito rw-7 run 0: billed 20,144 vs raw 11,195. On non-switched runs the two are equal. The raw counter appears to drop spend from before the switch. This is why the gate shows raw -15.1% but billed +8.2% on cogito. The gate scores billed, so the verdict is unaffected. Any older raw-token claim about switching cost is suspect. Finding for the benchmarks/runtime owner (not fixed here: `packages/**` is outside ablation-warden authority). (The k=8 follow-up below finds a raw/billed gap on non-switched runs too at `b0f7f3f8a`, so this attribution is incomplete.)
4. **Adapter.** `rax eval gate` reads a `SessionReport`, and H3 writes `H3Results`. A scratch adapter (`2026-11-05-strategy-switching/to-session.ts`) maps each H3 cell to a `RunScore`. It maps accuracy to the `accuracy` dimension, timeouts to `scoreState: "inconclusive"`, and computes token means over measured cells only. A first version averaged 0-token timeouts into the means. That biased the arm with more timeouts. It was fixed before the ledger write.
5. **"Switch-heavy" premise.** At this SHA and k=3, qwen3:4b barely switches (1/15). Nearly all the switching signal is on cogito:8b, rw-7 and h3-todo-heavy.

## Recommendation

- **Do not cite this mechanism as earning its default-on slot.** Across 7 firings it shows 0 rescues. Where it costs anything, it is +72% billed tokens with no solve. This matches the 2026-11-05 trace analysis (26/33 switched runs failed).
- **Resolve the power gap only where the arms differ:** cogito:8b rw-7 and h3-todo-heavy at k >= 8 (this also enables the pass^8 check). Run qwen3:4b rw-7 with a longer `--cell-timeout-sec`, or drop it, because 4 of 6 runs are unmeasurable at 150 s. More runs on rw-6 and rw-9 only resample noise: switching does not fire there.
- **Better instrument:** the question is "does a switch rescue runs that would otherwise fail?" Whole-task accuracy dilutes that signal with every run where the switch never fires. Compare the two arms on the runs where switching fires, conditioned on that trigger (a counterfactual replay from the switch point, or a matched comparison). That gives a decisive answer at far lower n.
- If the extended run still shows no lift, the lift rule points to **opt-in** (remove from default). That decision, and the code change, belong to the reasoning/runtime warden and the user.

## Artifacts

`wiki/Research/Ablations/2026-11-05-strategy-switching/`: `default-{qwen3_4b,cogito_8b}.json`, `noswitch-{qwen3_4b,cogito_8b}.json` (H3 results), `session.json` (gate input), `rows.json` (per-run LLM calls, switch counts, calls and tools after the switch), `to-session.ts`, `metrics.ts`. The traces were not archived because of their size. They live in `/home/tylerbuell/.claude/jobs/eaddf328/tmp/ablate-switch/traces-*`, which is ephemeral.

## k=8 follow-up (2026-11-05, `b0f7f3f8a`)

**SHA:** `b0f7f3f8a` (both results files record `b0f7f3f8a7879cc927c0695aabdc9b0a7507ca6c`; HEAD did not move, tree clean). This SHA includes the fix "a strategy switch keeps the run's spend".
**Scope:** only the two cells where switching fired at k=3: cogito:8b on rw-7 and h3-todo-heavy. **k = 8** per cell, 16 runs per arm, 32 runs total. Cell timeout 150 s. All 32 runs were measured: 0 timeouts, 0 inconclusive.
**Arms:** same as above. Same converter (`to-session.ts`) and metrics script (`metrics.ts`).

### Verdict: OPT-IN (gate). Switching shows no lift on the cells where it fires, and it costs about 28% more billed tokens.

`rax eval gate` decision: **opt-in**. Ledger entry `b7f92f8d-f8bd-4f89-bdbc-8f0da894d6b7`.

```
tier        base   cand   lift    tok     verdict
cogito:8b   22.9   16.7   -6.2pp  +29.7%  BELOW
  tokens raw +29.7% | billed +28.1% (scored: billed)
  rw-7           +4.2pp ± 16.0pp
  h3-todo-heavy  -16.7pp ± 24.3pp
  pass^8 0.0% -> 0.0% (non-regression ok)
DECISION: OPT-IN · 1 tier · -6.2pp lift · 28.1% billed tok · within the noise floor
```

Two separate reasons block default-on here:
- **Accuracy:** -6.2pp, inside the 1σ noise band. This is not significant harm, and it is not lift.
- **Cost:** +28.1% billed tokens, far above the 15% ceiling. This holds whichever accuracy result is true.

This run covers one tier by design. So `minTiers: 2` alone would also have kept the result off default-on.

### Per-arm table

| Arm | runs | mean acc | solved | mean raw tok | mean billed tok | mean LLM calls / run | runs that switched | LLM calls after switch |
|---|---|---|---|---|---|---|---|---|
| default (switch on) | 16 | 0.167 | 0 | 13,502 | 15,243 | 11.75 | 14 / 16 | 92 of 188 (49%) |
| noswitch | 16 | 0.229 | 1 | 10,412 | 11,903 | 9.81 | 0 | 0 |

### Per-cell table

| Cell | Arm | mean acc (sd) | solved | mean raw tok | mean billed tok (sd) | LLM calls / run | switched | calls after switch | switched runs with 0 tool calls after switch |
|---|---|---|---|---|---|---|---|---|---|
| rw-7 | default | 0.042 (0.118) | 0/8 | 16,644 | 19,901 (3,689) | 13.0 | 7/8 | 53 of 104 | 5/7 |
| rw-7 | noswitch | 0.000 (0) | 0/8 | 11,480 | 14,107 (5,772) | 10.0 | 0 | 0 | n/a |
| h3-todo-heavy | default | 0.292 (0.173) | 0/8 | 10,360 | 10,585 (2,458) | 10.5 | 7/8 | 39 of 84 | 4/7 |
| h3-todo-heavy | noswitch | 0.458 (0.231) | 1/8 | 9,344 | 9,698 (3,477) | 9.6 | 0 | 0 | n/a |

The `run-started.config` in every default trace records `strategySwitching: true`. Every no-switch trace records `false` and has no `strategy-switched` event. Both arms are wired.

### Reading, with the confidence n=8 allows

- **rw-7: no lift, a clear cost.** Both arms are at the floor (1 partial run vs 0, no solves). Switching adds about 5,800 billed tokens per run (+41%). Welch t is about 2.4, so the cost is likely real (rough p ≈ 0.03). It also adds 3 LLM calls per run. In 5 of 7 switched runs, the agent made no tool call after the switch.
- **h3-todo-heavy: points to harm, but not significant.** Accuracy is 0.29 with switching vs 0.46 without: -16.7pp ± 24.3pp, Welch t about 1.6. The only solve in the whole matrix is in the no-switch arm. Billed tokens are +9% (t about 0.6, noise). The k=3 run pointed the same way (-22pp).
- **When the switch fires, it rescues nothing.** In the default arm, 14 of 16 runs switched and 0 of 14 solved. The k=3 run had the same result on these cells: 6 of 6 switched cogito runs failed. Across 20 firings on these two cells, there are 0 rescues. Over the same cells, the no-switch arm solved 1 of 22 runs. The base rate is low, so "0 rescues" alone is weak evidence. Still, it means the extra calls bought nothing measurable.
- **Overall:** this is no lift and a real token cost. The evidence is against switching as a default-on mechanism on cogito:8b. It does not show significant accuracy harm.

### Instrument notes

1. **The raw/billed gap is not specific to switching at `b0f7f3f8a`.** Raw tokens are still below billed on most runs in **both** arms. One no-switch example: rw-7 run 2, raw 9,985 vs billed 18,639. One switched run with equal values: h3-todo-heavy run 5, 8,542 vs 8,542. So confound 3 above blamed the switch for a gap with a wider cause. `b0f7f3f8a` may have fixed the switch-specific part, but another raw-token leak (or a deliberate difference between the two legs) remains. Raw and billed overheads agree here (+29.7% vs +28.1%), so the verdict does not depend on it. Finding for the benchmarks/runtime owner; not investigated here.
2. **Switching fires on almost every run of these cells (14/16).** The 2 default runs that did not switch (rw-7 run 6, h3-todo-heavy run 3) gave the best h3 score in the arm (0.67). With n=2 that means nothing, but a conditional comparison is still the better instrument (see Recommendation above).
3. The `H3` runner was auto-backgrounded by the harness after 180 s in each chunk. Each chunk was awaited to completion before the next started, and no chunk was killed. Default ran in 2 chunks (9 + 7 runs), no-switch in 2 chunks (13 + 3 runs).

### Recommendation

- The lift rule now gives a measured basis for **opt-in**. Default-on fails on cost alone (+28% > 15%). Accuracy shows no lift, and switching rescued 0 of 20 firings on the cells where it fires.
- Moving `enableStrategySwitching` to opt-in is a code change in `packages/**`. That belongs to the reasoning/runtime warden and the user. This report does not make that change.
- If anyone wants to keep it on by default, they first need two-tier evidence of lift. That requires a tier and task set where switching fires and rescues runs. None has been seen so far.

### Artifacts (k=8)

In `wiki/Research/Ablations/2026-11-05-strategy-switching/`: `k8-default-cogito.json` and `k8-noswitch-cogito.json` (H3 results), `session-k8.json` (gate input), and `rows-k8.json` (per-run LLM calls, switch count, calls and tools after the switch). The traces (3.6 MB) were not archived. They are in `/home/tylerbuell/.claude/jobs/eaddf328/tmp/ablate-switch-k8/traces-k8-*`, which is ephemeral.
