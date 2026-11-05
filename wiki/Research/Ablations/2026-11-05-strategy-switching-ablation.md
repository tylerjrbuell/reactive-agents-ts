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
3. **Raw `tokens` undercounts switched runs.** On every switched run, `billedTokens` > `tokens`, for example cogito rw-7 run 0: billed 20,144 vs raw 11,195. On non-switched runs the two are equal. The raw counter appears to drop spend from before the switch. This is why the gate shows raw -15.1% but billed +8.2% on cogito. The gate scores billed, so the verdict is unaffected. Any older raw-token claim about switching cost is suspect. Finding for the benchmarks/runtime owner (not fixed here: `packages/**` is outside ablation-warden authority).
4. **Adapter.** `rax eval gate` reads a `SessionReport`, and H3 writes `H3Results`. A scratch adapter (`2026-11-05-strategy-switching/to-session.ts`) maps each H3 cell to a `RunScore`. It maps accuracy to the `accuracy` dimension, timeouts to `scoreState: "inconclusive"`, and computes token means over measured cells only. A first version averaged 0-token timeouts into the means. That biased the arm with more timeouts. It was fixed before the ledger write.
5. **"Switch-heavy" premise.** At this SHA and k=3, qwen3:4b barely switches (1/15). Nearly all the switching signal is on cogito:8b, rw-7 and h3-todo-heavy.

## Recommendation

- **Do not cite this mechanism as earning its default-on slot.** Across 7 firings it shows 0 rescues. Where it costs anything, it is +72% billed tokens with no solve. This matches the 2026-11-05 trace analysis (26/33 switched runs failed).
- **Resolve the power gap only where the arms differ:** cogito:8b rw-7 and h3-todo-heavy at k >= 8 (this also enables the pass^8 check). Run qwen3:4b rw-7 with a longer `--cell-timeout-sec`, or drop it, because 4 of 6 runs are unmeasurable at 150 s. More runs on rw-6 and rw-9 only resample noise: switching does not fire there.
- **Better instrument:** the question is "does a switch rescue runs that would otherwise fail?" Whole-task accuracy dilutes that signal with every run where the switch never fires. Compare the two arms on the runs where switching fires, conditioned on that trigger (a counterfactual replay from the switch point, or a matched comparison). That gives a decisive answer at far lower n.
- If the extended run still shows no lift, the lift rule points to **opt-in** (remove from default). That decision, and the code change, belong to the reasoning/runtime warden and the user.

## Artifacts

`wiki/Research/Ablations/2026-11-05-strategy-switching/`: `default-{qwen3_4b,cogito_8b}.json`, `noswitch-{qwen3_4b,cogito_8b}.json` (H3 results), `session.json` (gate input), `rows.json` (per-run LLM calls, switch counts, calls and tools after the switch), `to-session.ts`, `metrics.ts`. The traces were not archived because of their size. They live in `/home/tylerbuell/.claude/jobs/eaddf328/tmp/ablate-switch/traces-*`, which is ephemeral.
