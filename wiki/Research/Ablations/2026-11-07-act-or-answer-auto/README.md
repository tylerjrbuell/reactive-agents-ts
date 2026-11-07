---
type: ablation
status: complete
created: 2026-11-07
tags: [ablation, lift-gate, act-or-answer, forcing, workstream-h, plan-9, h3, long-horizon, opt-in]
---

# Ablation: `actOrAnswer: "auto"` vs off (5 local tiers) and forced retry on one paid tier. Verdict OPT-IN-ONLY

**Warden:** ablation-warden
**SHA:** `e3009d173368bc4014686b03892787677fd4a3e4` on every results file. That commit is docs-only on top of `e9f762452`, so `packages/**` matches `e9f762452`. The reasoning dist was turbo-cached at that tree. Every chunk checked that `packages/` was clean before it ran.
**Brief:** act-or-answer auto ablation (leverage scan item 2, [[../../Harness-Reports/2026-11-07-leverage-scan]]), with the owner's scope change of 2026-11-07: 3 more local models, a small paid leg, efficiency, and failure diagnosis.
**Placement note:** the brief named `wiki/Research/Harness-Reports/2026-11-07-act-or-answer-auto-ablation.md`. That path belongs to harness-warden (`tools/repo/ownership.json`). ablation-warden may write only under `wiki/Research/Ablations/**`, so the report lives here. The parent can move it or link it. The ledger entries were written to `wiki/Research/Harness-Reports/improvement-ledger.json` by the gate library (`recordGateOutcome`), as the manifest allows.

## Verdict

| Scope | Gate decision | Ledger | Reading |
|---|---|---|---|
| cogito:8b + qwen3:4b (the brief's 2 tiers) | **OPT-IN**, +24.1 pp aggregate, −3.3 % billed tokens | not booked separately (subset of the 5-tier entry) | Only cogito long-horizon (`lh-1`) clears every promotion test |
| 5 local tiers | **OPT-IN**, +16.0 pp, +9.0 % tokens, PARTIAL (llama3.2:3b short INCONCLUSIVE) | booked, `opt-in`, activations 17 | 2 of 5 tiers activate the mechanism. The other 3 tiers are near A/A comparisons |
| gpt-4o-mini, `true` (retry) vs off | gate said **REJECT** (−29.6 pp) | booked **`void`** (activations 0) | Forcing fired in 0 of 6 runs. The "regression" is noise between two identical arms |

**Recommendation: OPT-IN-ONLY. Do not default `auto` on for Ollama yet.** The evidence for a narrower step is strong but rests on one tier. Cogito:8b with proactive forcing moved `rw-7` from 0.00 to 0.56 and `lh-1` from 0.00 to 0.81. Forcing fired in all 6 of those runs, both cells moved the same way, tokens fell 16-28 % and wall time halved. That is a real, mechanism-attributable effect, but on one model. On qwen3:4b, auto (retry) fired in 5/12 runs and gave no measurable lift (−7.4 pp short, +7.4 pp long, both inside noise). On gemma4:e4b, qwen3:14b and llama3.2:3b, auto fired in 1, 1 and 0 of 12 runs. Those models barely stall on this HEAD, so the mechanism had almost nothing to act on. The lift rule needs ≥ 2 tiers passing. One tier passes on one task class.

A defensible next step, for the owner to decide (not a PASS): since `auto` resolves per model, keeping `auto` opt-in costs nothing on the tiers where it never fires. The shipped cogito `proactive` prior is the only measured win. To earn default-on, the matrix needs (a) a second model whose off arm actually stalls (cogito:14b or bonsai-2:27b are candidates; check stall counts in existing traces first, zero tokens), and (b) k ≥ 5 on the cells that activate.

## Design

- **Arms:** `off` = `RA_ACT_OR_ANSWER` unset. `auto` = `RA_ACT_OR_ANSWER=auto`. Paid leg: `off` vs `on` (`RA_ACT_OR_ANSWER=1`, retry), because `auto` resolves to off on paid providers.
- **Cells:** `h3-plan-only` (frozen H3 suite), plus `rw-7`, `lh-1`, `lh-debug-green` (long-horizon suite, `lh-a0` variant). Same runner (`run-h3.ts` → `runSession`) and variants in every arm. k = 3 per (tier, task, arm). Cell timeout 240 s. Foreground passes of at most 585 s (`drive.sh`). One model was resident at a time, and each model I loaded was unloaded when its cells finished.
- **Extra tiers:** `run-h3.ts` knows only qwen3:4b, cogito:8b and bonsai-2:27b. `run-h3-extra.ts` (scratch, no `src` edit) adds gemma4:e4b, qwen3:14b, llama3.2:3b and gpt-4o-mini to the exported `H3_TIERS` record in-process, then calls the unmodified `runH3`.
- **Capability preflight override:** gemma4:e4b and llama3.2:3b are not in `STATIC_CAPABILITIES`. The bench's sync preflight therefore voids them (`source: fallback`, 2048 ctx). They ran with `RA_BENCH_ALLOW_FALLBACK=1`. I checked that the runtime used the probe-cached capability rather than the fallback: `ollama ps` showed CONTEXT 32768 for both during their runs, and `~/.reactive-agents/capabilities/*` holds `recommendedNumCtx: 32768`. qwen3:14b is in the static table.
- **Paid leg:** gemini-2.5-flash was tried first. Its first call returned HTTP 402 ("prepayment credits are depleted"). Both cells had 0 tokens and US$0 spend; they are kept as `void402-*.json`. I then fell back to gpt-4o-mini, as the brief allows. I ran **k = 3, not the brief's k = 2**: at k = 2 every paid cell is `underpowered` by construction (`minRuns: 3`), and the extra cells cost under US$0.03.
- **Gate:** `gate.ts` calls `evaluateLiftGate` under `DEFAULT_LIFT_POLICY`, with `isTokenFreeTier` set for the Ollama tiers (the owner ruling of 2026-11-06, same as `run.ts --gate`). `rax eval gate` cannot pass `isTokenFreeTier`, so the script calls the same library functions, ledger write included.

## Instrument check (done first)

Per arm, `run-started.config.mechanisms` recorded:

| Tier | off | auto (on for paid) |
|---|---|---|
| cogito:8b | `false` / explicit | `"proactive"` / **calibration** |
| qwen3:4b | `false` / explicit | `true` (retry) / **calibration** |
| gemma4:e4b, qwen3:14b, llama3.2:3b | `false` / explicit | `true` (retry) / **default** (no prior, so the Ollama default) |
| gpt-4o-mini | `false` / explicit | `on` arm: `true` / explicit. One `auto` smoke cell: `false` / **default** (paid tier resolves to off, as designed) |

**Instrument gap:** the kernel tally (`result.metadata.extensions.actOrAnswer`: noCallStalls, unforcedToolWorkTurns, forced, forcedCalled, forcedCallSucceeded) is persisted by neither `run-h3` nor the trace. `act.ts` re-derives the counts from trace events. One `guard-fired {guard: "act-or-answer"}` event marks each forced request, and `metadata.result` gives called / answered / no-call. "Call OK" means every named tool has a successful `tool-call-end` later in the same iteration. The exact `noCallStalls` figure cannot be recovered. The "no-call turns" column is a proxy: think turns that offered a domain tool, returned no native call, and were not the last turn. It **over-counts**. On llama3.2:3b, every sampled "no-call" turn was a tool call emitted as text (`{"type":"function",...}`), which `isNoCallStall` rightly does not count. Fix: have run-h3 copy the tally into `H3Cell`, or have the trace record it at run end (bench owner or harness-warden).

## Activations

| Tier | arm | runs | runs with ≥1 forced | forced requests | called | call OK | forced, no call | no-call turns (proxy) / offered |
|---|---|---|---|---|---|---|---|---|
| cogito:8b | off | 12 | 0 | 0 | 0 | 0 | 0 | 72 / 98 |
| cogito:8b | auto | 12 | **10** | 33 | 31 | 28 | 2 | 15 / 80 |
| qwen3:4b | off | 12 | 0 | 0 | 0 | 0 | 0 | 10 / 33 |
| qwen3:4b | auto | 12 | **5** | 7 | 7 | 7 | 0 | 9 / 36 |
| gemma4:e4b | auto | 12 | 1 | 1 | 1 | 1 | 0 | 1 / 108 |
| qwen3:14b | auto | 12 | 1 | 1 | 1 | 1 | 0 | 3 / 34 |
| llama3.2:3b | auto | 13 | 0 | 0 | 0 | 0 | 0 | 9 / 81 (text-emitted calls, not stalls) |
| gpt-4o-mini | on | 6 | 0 | 0 | 0 | 0 | 0 | 0 / 22 |

- Cogito proactive cut its no-call turns from 72 of 98 to 15 of 80. 28 of 31 forced calls ran clean.
- qwen3:4b retry: every one of its 7 forced requests was `file-write`, and all 7 succeeded.
- Activation runs per cell: cogito fired in 3/3 runs on each long-horizon cell and 1/3 on `h3-plan-only`. qwen3:4b fired on `lh-1` (3/3) and `rw-7` (2/3). gemma and qwen3:14b each fired once, on `lh-1` run 2.

## Per-cell results

Accuracy is the mean of the per-run scores. Tokens are mean billed tokens; Ollama tiers are token-free under the gate, and their tokens are listed for efficiency only.

| Tier | Task | off acc (runs) | auto acc (runs) | Δ pp | off tok | auto tok | forced runs (auto) |
|---|---|---|---|---|---|---|---|
| cogito:8b | h3-plan-only | 0.78 (.83,.67,.83) | 0.72 (.83,.67,.67) | −5.6 | 9,861 | 6,626 | 1/3 |
| cogito:8b | rw-7 | **0.00** (0,0,0) | **0.56** (.67,.33,.67) | **+55.6** | 10,003 | 15,510 | 3/3 |
| cogito:8b | lh-1 | **0.00** (0,0,0) | **0.81** (.78,.78,.89) | **+81.5** | 57,911 | 41,606 | 3/3 |
| cogito:8b | lh-debug-green | 0.11 | 0.06 | −5.6 | 30,364 | 19,907 | 3/3 |
| qwen3:4b | h3-plan-only | 1.00 | 1.00 | 0 | 10,889 | 11,856 | 0/3 |
| qwen3:4b | rw-7 | 0.67 (.67×3) | 0.44 (.33,0,1.0) | −22.2 | 14,033 | 20,102 | 2/3 (scores .33, 1.0; the unforced run scored 0) |
| qwen3:4b | lh-1 | 0.93 | 1.00 | +7.4 | 28,442 | 29,760 | 3/3 |
| qwen3:4b | lh-debug-green | 0.28 | 0.28 | 0 | 10,264 | 12,571 | 0/3 |
| gemma4:e4b | h3-plan-only | 0.89 | 0.89 | 0 | 11,811 | 11,880 | 0/3 |
| gemma4:e4b | rw-7 | 1.00 | 1.00 | 0 | 45,488 | 34,961 | 0/3 |
| gemma4:e4b | lh-1 | 1.00 | 0.93 | −7.4 | 35,112 | 42,687 | 1/3 |
| gemma4:e4b | lh-debug-green | 0.39 | 0.83 | +44.4 | 21,646 | 64,354 | **0/3** (not attributable) |
| qwen3:14b | h3-plan-only | 1.00 | 0.94 | −5.6 | 9,456 | 7,668 | 0/3 |
| qwen3:14b | rw-7 | 1.00 | 0.67 (1,1,0) | −33.3 | 8,003 | 11,291 | **0/3** (not attributable) |
| qwen3:14b | lh-1 | 0.48 (.22,1,.22) | 1.00 | +51.9 | 23,474 | 18,719 | 1/3 (runs 0-1 scored 1.0 unforced) |
| qwen3:14b | lh-debug-green | 0.33 | 0.50 | +16.7 | 9,440 | 19,928 | 0/3 |
| llama3.2:3b | h3-plan-only | 0.56 | 0.44 (+1 aborted run, topped up) | −11.1 | 13,241 | 19,559 | 0 |
| llama3.2:3b | rw-7 | 0.00 | 0.22 | +22.2 | 14,300 | 12,113 | 0 |
| llama3.2:3b | lh-1 | 0.07 | 0.04 | −3.7 | 34,491 | 37,204 | 0 |
| llama3.2:3b | lh-debug-green | 0.00 | 0.00 | 0 | 12,614 | 11,905 | 0 |
| gpt-4o-mini | rw-7 | 0.89 | 0.44 (`on`) | −44.4 | 7,709 | 9,924 | 0 |
| gpt-4o-mini | lh-1 | 0.78 | 0.63 (`on`) | −14.8 | 12,388 | 10,687 | 0 |

**Noise, stated plainly.** Per-cell 95 % bands are ±33-40 pp at n = 3. Gaps under about 26 pp are noise. Several large gaps occur where the mechanism never fired: gemma `lh-debug-green` +44, qwen3:14b `rw-7` −33, gpt-4o-mini `rw-7` −44, llama `rw-7` +22. They show the run-to-run spread of identical arms, and none can be credited to or blamed on forcing. The cogito long-horizon gains are the only large gaps that are uniform in direction, with activation in 6/6 runs and an off baseline of 0/6.

## Gate receipts (verbatim excerpts; full text in `gate-local2.txt`, `gate-local5.txt`, `gate-paid.txt`)

```
LIFT GATE · auto vs off   (5 local tiers, token-free)
  cogito:8b            29.6    44.4   +14.8pp    -16.3%  BELOW         (short: h3-plan-only, rw-7, lh-debug-green)
  cogito:8b             0.0    81.5   +81.5pp    -28.2%  PASS          (long-horizon: lh-1)
  qwen3:4b             64.8    57.4    -7.4pp    +26.6%  BELOW
  qwen3:4b             92.6   100.0    +7.4pp     +4.6%  BELOW
  gemma4:e4b           75.9    90.7   +14.8pp    +40.9%  BELOW
  gemma4:e4b          100.0    92.6    -7.4pp    +21.6%  BELOW
  qwen3:14b            77.8    70.4    -7.4pp    +44.6%  BELOW
  qwen3:14b            48.1   100.0   +51.9pp    -20.3%  BELOW
  llama3.2:3b          18.5    22.2    +3.7pp     +8.5%  INCONCLUSIVE
  llama3.2:3b           7.4     3.7    -3.7pp     +7.9%  BELOW
  AGGREGATE  16.0pp · 9.0% billed tok · tiers=5 · PARTIAL
  DECISION: OPT-IN — OPT-IN · 5 tier(s) · 16.0pp lift · 9.0% billed tok — inconclusive tier blocks promotion

LIFT GATE · auto vs off   (cogito:8b + qwen3:4b only)
  AGGREGATE  24.1pp · -3.3% billed tok · tiers=2
  DECISION: OPT-IN — OPT-IN · 2 tier(s) · 24.1pp lift · -3.3% billed tok — below the promotion bar

LIFT GATE · on vs off   (gpt-4o-mini, paid)
  gpt-4o-mini          88.9    44.4   -44.4pp    +62.9%  REGRESS
  gpt-4o-mini          77.8    63.0   -14.8pp    -13.1%  BELOW
  DECISION: REJECT — ... a tier significantly regresses
  activations: 0  ->  ledger status: void (A/A comparison)
```

The paid receipt is a concrete case of the ledger's documented hazard: at n = 3, the 1σ reject band false-rejects an A/A comparison. Without the activation count, this receipt would have booked a reject against a mechanism that never ran.

## Efficiency

Mean over the 12 measured runs per arm (gpt-4o-mini: 6). Ollama tokens cost nothing in money; "tok / acc-pt" = mean billed tokens ÷ mean accuracy (%).

| Tier | arm | acc % | solved | mean tok | wall s | tok / acc-pt |
|---|---|---|---|---|---|---|
| cogito:8b | off | 22.2 | 0 | 27,034 | 62 | 1,217 |
| cogito:8b | auto | **53.7** | 0 | 20,912 (−23 %) | **30** | **389** |
| qwen3:4b | off | 71.8 | 4 | 15,907 | 47 | 222 |
| qwen3:4b | auto | 68.1 | 7 | 18,572 (+17 %) | 54 | 273 |
| gemma4:e4b | off | 81.9 | 7 | 28,514 | 60 | 348 |
| gemma4:e4b | auto | 91.2 | 8 | 38,470 (+35 %) | 70 | 422 |
| qwen3:14b | off | 70.4 | 7 | 12,593 | 86 | 179 |
| qwen3:14b | auto | 77.8 | 7 | 14,402 (+14 %) | 93 | 185 |
| llama3.2:3b | off | 15.7 | 0 | 18,662 | 21 | 1,186 |
| llama3.2:3b | auto | 17.6 | 0 | 20,195 (+8 %) | 19 | 1,148 |
| gpt-4o-mini | off | 83.3 | 2 | 10,048 billed | 58 | US$0.0049 per run ÷ acc |
| gpt-4o-mini | on | 53.7 | 1 | 10,306 billed | 73 | US$0.0090 per run ÷ acc |

Flags:
- **Forcing costs tokens without lift: qwen3:4b.** +17 % tokens and +7 s wall for −3.7 pp, with 5 activations. The forced `file-write` calls all succeeded and `lh-1` reached 3/3, but `rw-7` did not improve. The token cost is free locally, so this flag is about latency, not money.
- **Token deltas on gemma4:e4b (+35 %) and qwen3:14b (+14 %) are not forcing costs.** Forcing fired once in each arm, so those deltas are run-to-run spread of the same scale as the accuracy noise. Do not read them as overhead.
- **Cogito: forcing cuts cost.** −23 % tokens and half the wall time, because proactive forcing replaces prose turns with calls.
- **Paid:** forcing fired 0 times, so on gpt-4o-mini it is free and does nothing on these cells.

**Paid spend:** US$0.0567 estimated from trace `tokensIn × $0.15/M + tokensOut × $0.60/M` (gpt-4o-mini list). This is an upper bound: billed tokens are lower than raw because of cache hits. The framework's own `totalCostUsd` sums to about US$0.048. Gemini: US$0 (402 on the first call). The US$3 cap was never approached; the largest single cell cost US$0.0087.

## Failure diagnosis (`rax-diagnose attribute --json` on every trace; `cause` labels from the results files)

`harness:forcing-unused`, before and after: off arms 5 primary (all cogito: 3 on `rw-7`, 2 on `lh-1`) + 1 alsoMatched (qwen3:14b). auto arms 0 primary + 1 alsoMatched (qwen3:14b). Forcing removes its target class where it fires. **On this HEAD the class is concentrated on cogito.** qwen3:4b's off arm has 0 forcing-unused runs, which differs from the leverage scan's older corpora. The `.json` repair (`cbe218da7`) and refusal fixes moved its failures elsewhere.

Top 3 reasons (primary + alsoMatched) for each arm that did not lift:

| Tier / arm | 1 | 2 | 3 |
|---|---|---|---|
| qwen3:4b auto (12 runs, 5 failed) | model:had-evidence-wrong-output 5 | model:evidence-not-gathered 3 | model:fabrication-vetoed 2 |
| gemma4:e4b auto (4 failed) | model:had-evidence-wrong-output 4 | model:fabrication-vetoed 1 | model:evidence-not-gathered 1 |
| qwen3:14b auto (5 failed) | model:had-evidence-wrong-output 5 | model:evidence-not-gathered 3 | model:fabrication-vetoed 1 (+ harness:forcing-unused 1 also) |
| llama3.2:3b auto (13 failed) | model:had-evidence-wrong-output 7 | model:evidence-not-gathered 6 | model:invalid-content 2 |
| gpt-4o-mini on (5 failed) / off (4 failed) | model:had-evidence-wrong-output 3 / harness:evidence-truncated 3 | harness:evidence-truncated 2 / model:fabrication-vetoed 1 | (none) / model:had-evidence-wrong-output 1 |
| cogito:8b auto (lifted; 12 failed, 0 solved) | model:had-evidence-wrong-output 12 | model:evidence-not-gathered 4 | (none) |

By task, all arms pooled:
- `model:evidence-not-gathered`: 24 on `lh-debug-green`, 6 on `rw-7`.
- `model:had-evidence-wrong-output`: 15 on `h3-plan-only`, 10 on `rw-7`, 7 on `lh-1`.
- `harness:evidence-truncated`: 6, all on `lh-1`, all "only a compressed preview of this web-search result".

Canonical classes and owners:

1. **Per-entity input coverage** (`model:evidence-not-gathered`, 30 runs, mostly `lh-debug-green`). One `file-read` satisfies `tool:file-read`, so the outstanding-work test (`outstandingToolWork`) reports nothing, and forcing cannot reach these runs. Leverage scan item 3; DEBT-REGISTER #39 (generic per-entity coverage still OPEN). Owner: **kernel-warden** (`packages/reasoning/src/kernel/ledger/emit.ts`, `structured-output/infer-required-tools.ts`).
2. **Wrong output despite evidence** (`model:had-evidence-wrong-output`, 32 runs). This is model-attributed. The harness lever is the acceptance check: `rw-7` and `lh-debug-green` demand passing tests but offer no way to run them (leverage scan item 4). `h3-plan-only`'s 15 are arithmetic or summary errors in plan-execute synthesis (e.g. a cogito `summary.md` saying "26 SKUs / 247 units" while its own `totals.json` says 24 / 393). Owners: **kernel-warden** (verify capability, `kernel/capabilities/verify/`). Bench task surface: owner call, no warden. Plan-execute synthesis: kernel-warden.
3. **Fixed tool-result budget truncates fresh evidence** (`harness:evidence-truncated`, 6 runs on `lh-1`, 5 of them on **gpt-4o-mini**, a paid tier). Leverage scan item 8 counted it only on local tiers. This run shows it on a standard-tier model too. Owner: **kernel-warden** (`packages/reasoning/src/context/context-profile.ts`).
4. llama3.2:3b only: tool calls emitted as text and cut at `max_tokens` (`maxTokens` 1200 on think turns; 5 cut turns in the auto arm). This is `model:invalid-content` / stall-after-work. Forcing is correctly gated off here (`isNoCallStall` excludes `max_tokens` replies). Owner if pursued: **provider-warden** (Ollama text-dialect output budget). The count is small.

## Reproduce

```
bash drive.sh <tier> [k] ["off auto" | "off on"]          # resumable; env RA_BENCH_ALLOW_FALLBACK=1 for gemma4:e4b / llama3.2:3b
bun act.ts <arm>-*-<tier>.json ...                       # activations
bun summary.ts off-*.json auto-*.json on-*.json          # per-cell table
bun to-session.ts session-local5.json off-*.json auto-*.json   # (see file list in the receipts)
bun gate.ts session-local5.json off auto 17 cogito:8b,qwen3:4b,gemma4:e4b,qwen3:14b,llama3.2:3b [ledger]
bun cost.ts off-lh-gpt-4o-mini.json on-lh-gpt-4o-mini.json
```

Traces: `/home/tylerbuell/.claude/jobs/eaddf328/tmp/abl-auto/traces-*` (scratch, not in the repo). Per-run attribution: `attr.jsonl` there; tallies in `attribution.txt` here.
