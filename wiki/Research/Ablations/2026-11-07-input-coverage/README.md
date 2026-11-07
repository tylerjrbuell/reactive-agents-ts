---
type: ablation
status: complete
created: 2026-11-07
tags: [ablation, lift-gate, input-coverage, act-or-answer, debt-39, workstream-h, plan-9, long-horizon, opt-in]
---

# Ablation: `inputCoverage` on top of `actOrAnswer: "auto"` (3 local tiers), plus a gpt-4o-mini `lh-1` re-measure after the literal-`\n` heal. Verdict OPT-IN-ONLY

**Warden:** ablation-warden
**SHA:** `9bea8bc45506fb49b3435bc656f6a324a37ed7b6` on every results file. `packages/` was clean before every pass (`drive.sh` refuses otherwise). The reasoning `dist` was turbo-cached at this tree, and I checked that it contains the `inputCoverage` code (`read the listed input ${entity}`).
**Brief:** an input-coverage ablation over the 3 tiers, then a paid re-measure (US$1 cap). It follows [[../2026-11-07-act-or-answer-auto/README]], whose top failure class was `model:evidence-not-gathered`.
**Ledger:** one entry booked by `recordGateOutcome` (`gate.ts`) in `wiki/Research/Harness-Reports/improvement-ledger.json`: decision `opt-in`, 27 activations. The paid leg is a single-arm re-measure against an earlier SHA, so it is not a gate comparison and is not booked.

## Verdict

| Scope | Gate decision | Reading |
|---|---|---|
| cogito:8b + qwen3:4b + qwen3:14b, `ic` vs `auto` | **OPT-IN**: −5.3 pp aggregate (2 conclusive tiers), +101 % billed tokens, PARTIAL. qwen3:4b is INCONCLUSIVE | No tier regresses beyond the noise band, and no tier passes. On the tasks that list many inputs, the mechanism does what it was built for: listed inputs read went from 40 % to 93 %. Accuracy did not follow. On cogito:8b it causes a regression on `rw-7`, and the trace shows the mechanism. |
| gpt-4o-mini `lh-1`, default harness, HEAD vs the last ablation's off arm | not gated (single arm, different SHA) | 0.93 vs 0.78. The old failure (literal `\n` in `sources.md`, 3/3 runs) is gone. The heal fired in only 1 of 3 runs, and that run still failed for another reason. So the +15 pp is mostly model spread, not the heal. |

**Recommendation: OPT-IN-ONLY. Do not default `inputCoverage` on. Rework the interaction with proactive forcing before re-measuring.**

- The mechanism removes the failure class it targets. Of the 18 measured runs on the two multi-input tasks, 14 auto runs and 3 ic runs ended with a listed input unread. Every one of those runs failed. Attribution's primary `model:evidence-not-gathered` fell from 14 to 6 of the failed runs. But it moved the failures to `model:had-evidence-wrong-output` rather than removing them: auto had 22 failed measured runs, ic had 23.
- **Reading the inputs is necessary but not enough.** On cogito:8b `lh-debug-green`, ic read 36 of 36 inputs and still scored 0.00, the same as auto. The reads came after the writes. Cogito writes `clamp.ts` after one read, and proactive forcing then makes it read the other 11 inputs. The requirement is "read before exit", but what matters is "read before writing what depends on it". `rax-diagnose` agrees: "11/12 task-listed input(s) not read before the divergence turn".
- **Mechanism-caused regression on cogito:8b `rw-7` (0.67 to 0.33 in all 3 runs).** Proactive forcing builds its outstanding list from unread inputs. `tool:file-write` was already credited by the first write, so after `processor.ts` was read the only outstanding item was "read pipeline.ts". The forced turn read `pipeline.ts`, and the `processor.ts` fix was never written. Trace: iter 3, `act-or-answer {outstanding:["pipeline.ts"], tools:["file-read"]}`. One write counting as all writes is the write-side twin of DEBT #39. Turning on per-input reads without per-target writes pulls forcing away from the work that is still missing.
- Cost: billed tokens +131 % (cogito), +243 % (qwen3:4b), +71 % (qwen3:14b). qwen3:4b wall time went from 76 s to 232 s, and 2 of its ic runs hit the 480 s cell timeout. Ollama tokens are free under the gate, but this is a real latency cost, and it would be real money on a paid tier.

What could earn a re-measure (owner and kernel-warden decide; this is not a PASS):
1. Order: bind each input to the write that depends on it, or surface unread inputs before the first write rather than only at exit.
2. Interaction: either exclude `input:` items from proactive forcing's outstanding list, or add per-target write coverage so "fix processor.ts" stays outstanding.
3. Scope: `lh-debug-green` counts the 6 test files as inputs, which doubles the forced reads. A narrower rule, such as files the task asks to fix, would cut tokens. This needs an owner call on whether reading the tests is part of the requirement.

## Design

- **Arms:** A = `auto` (`RA_ACT_OR_ANSWER=auto`). B = `ic` (`RA_ACT_OR_ANSWER=auto RA_INPUT_COVERAGE=1`). Paid: `def` (both unset).
- **Cells:** long-horizon suite, variant `lh-a0`. `rw-7` lists 3 inputs. `lh-debug-green` lists 12 (6 src + 6 tests). `lh-enumerate-audit` lists 12 invoices; it exists, so no substitute was needed. k = 3 per (tier, task, arm). k = 5 on `lh-debug-green` was **not run**: the 480 s reruns took the time budget.
- **Cell timeout, a change made mid-run and stated here:** at 240 s, 8 cells were wall-clock censored (`aborted`). The models were still making progress at about 20 s per iteration, and the 12-input tasks need more than 12 iterations. Censoring hit ic harder (6 vs 2). I reran the three affected (tier, task) pairs in **both arms** at 480 s (`*-lt-*.json`): qwen3:4b `lh-debug-green` and `lh-enumerate-audit`, and qwen3:14b `lh-enumerate-audit`. The gate uses the 480 s cells for those pairs and the 240 s cells everywhere else (`sel.ts`), so each A/B pair shares one timeout. qwen3:4b ic was topped up to run index 3 on `lh-debug-green` (480 s) and `rw-7` (240 s) to reach 3 measured runs. Each of those cells still has one aborted run, which is why the gate marks qwen3:4b INCONCLUSIVE.
- **Runner:** `run-h3.ts` (qwen3:4b, cogito:8b) and `run-h3-extra.ts` (qwen3:14b, gpt-4o-mini; adds tiers to `H3_TIERS` in process, no `src` edit). Every pass ran under `timeout 590`. One model was resident at a time. A qwen3:4b instance that I had not loaded (8192 ctx) was resident at start. I did not stop it, and it expired on its own. I stopped each model I loaded when its tier finished.
- **Gate:** `gate.ts` calls `evaluateLiftGate` under `DEFAULT_LIFT_POLICY`, with `isTokenFreeTier` for the Ollama tiers (owner ruling 2026-11-06). The ledger write goes through `recordGateOutcome`.

## Instrument check (done first)

- `run-started.config.mechanisms`: `inputCoverage` is `false` in every auto run and `true` in every ic run. `actOrAnswer` / `actOrAnswerSource`: cogito:8b `proactive/calibration`; qwen3:4b `true/calibration`; qwen3:14b `true/default`. Both arms match per tier. Paid: `false/explicit`, `inputCoverage: false`, which matches the last ablation's off arm.
- `contract-compiled` carries the `input-coverage` requirements: 3 / 12 / 12 per run in ic, 0 in auto.
- **Act-or-answer tally:** reconstructed the same way as last time (`act.ts`, unchanged). One `guard-fired {guard:"act-or-answer"}` marks each forced request. `metadata.result` gives called / answered / no-call. "Call OK" means a successful `tool-call-end` for every named tool in the same iteration. The kernel tally is still not persisted (gap reported last time, still open).
- **Input-coverage counts (`ic-act.ts`, new):** "listed" comes from the ic contract, normalized to bench-relative paths (`listed.json`), so both arms are scored against the same set. "Read" applies the `isInputRead` rule recomputed from the ledger: a non-write, non-meta `tool-invocation` that names the input and has a non-refused `tool-result`. "Gate deny" is an `exit_gate` deny or deny-once whose `outstanding` names an input. "Forcing" is an `act-or-answer` event whose `outstanding` names an input. "Forced read" is an input first read *after* one of those named it.
- **Third activation channel:** the unmet `input:` refs are also rendered in the prompt's outstanding section (`projection-rendered.refs`) on every turn. That is why qwen3:14b went from 8/36 to 36/36 reads on `lh-debug-green` with zero gate or forcing events. So I counted activations two ways. Inclusive: a measured ic run with ≥1 requirement compiled, 27 of 27; this is the number booked to the ledger. Strict: a run where the gate or forcing named an input, 14 of 27 (cogito 9/9, qwen3:4b 5/9, qwen3:14b 0/9).

## Activations and coverage (measured runs, gate set)

| Tier | Task | auto read / listed | ic read / listed | ic gate denials (runs) | ic forcing naming an input | ic forced reads |
|---|---|---|---|---|---|---|
| cogito:8b | rw-7 | 9/9 | 9/9 | 0 | 12 | 9 |
| cogito:8b | lh-debug-green | 6/36 | 36/36 | 2 (2) | 32 | 36 |
| cogito:8b | lh-enumerate-audit | 7/36 | 25/36 | 1 (1) | 22 | 25 |
| qwen3:4b | rw-7 | 9/9 | 9/9 | 0 | 0 | 0 |
| qwen3:4b | lh-debug-green (480 s) | 14/36 | 32/36 | 12 (3) | 0 | 22 |
| qwen3:4b | lh-enumerate-audit (480 s) | 16/36 | 36/36 | 2 (1) | 1 | 10 |
| qwen3:14b | rw-7 | 9/9 | 9/9 | 0 | 0 | 0 |
| qwen3:14b | lh-debug-green | 8/36 | 36/36 | 0 | 0 | 0 |
| qwen3:14b | lh-enumerate-audit (480 s) | 36/36 | 36/36 | 0 | 0 | 0 |

Multi-input tasks, pooled: reads 87/216 (40 %) in auto vs 201/216 (93 %) in ic. Runs ending under-read: 14/18 vs 3/18, and all 17 of those runs failed. Act-or-answer forced requests: cogito 22 to 66, qwen3:4b 5 to 3, qwen3:14b 0 to 0. On `rw-7` every arm already read all 3 inputs, so there the mechanism only changes what forcing points at.

## Per-cell results (gate set)

| Tier | Task | auto acc (runs) | ic acc (runs) | Δ pp | auto tok | ic tok | auto s | ic s |
|---|---|---|---|---|---|---|---|---|
| cogito:8b | rw-7 | 0.67 (.67×3) | **0.33 (.33×3)** | −33.3 | 20,567 | 15,087 | 15 | 17 |
| cogito:8b | lh-debug-green | 0.00 | 0.00 | 0 | 11,313 | 49,404 | 37 | 19 |
| cogito:8b | lh-enumerate-audit | 0.07 | 0.05 | −2.4 | 15,209 | 44,417 | 14 | 18 |
| qwen3:4b | rw-7 | 0.67 (1,.67,.33) | 0.67 (.33,1,.67; +1 aborted) | 0 | 20,306 | 19,091 | 83 | 79 |
| qwen3:4b | lh-debug-green (480 s) | 0.22 | 0.39 (.33,.17,.67; +1 aborted) | +16.7 | 21,977 | 107,049 | 79 | 374 |
| qwen3:4b | lh-enumerate-audit (480 s) | 0.33 (.07,.79,.14) | 0.60 (.64,.50,.64) | +26.2 | 22,494 | 95,751 | 65 | 244 |
| qwen3:14b | rw-7 | 1.00 | 0.67 (1,0,1) | −33.3 | 12,173 | 13,513 | 90 | 83 |
| qwen3:14b | lh-debug-green | 0.22 | 0.50 (.67,.67,.17) | +27.8 | 11,053 | 21,228 | 79 | 151 |
| qwen3:14b | lh-enumerate-audit (480 s) | 0.38 (.07,.07,1) | 0.48 (.07,.36,1) | +9.5 | 16,397 | 32,808 | 120 | 176 |

**Noise:** the per-cell 95 % bands are ±33-41 pp at n = 3, and no single cell clears them. The qwen3:14b `rw-7` drop is one run at 0.00, where the model wrote `validator.test.ts` instead of fixing anything; the forcing and gate events there are identical to auto. I read it as spread. The cogito `rw-7` drop is different: it is uniform (3/3 at 0.33, against 3/3 at 0.67), and the trace shows the mechanism (Verdict section). The positive cells on qwen3:4b and qwen3:14b go the right way on both multi-input tasks, but none is significant.

## Gate receipt (`gate-local3.txt`)

```
LIFT GATE · ic vs auto
  cogito:8b            24.6    12.7   -11.9pp   +131.3%  BELOW
  qwen3:14b            53.4    54.8    +1.3pp    +70.5%  BELOW
  qwen3:4b             40.7    55.0   +14.3pp   +242.5%  INCONCLUSIVE
  AGGREGATE  -5.3pp · 100.9% billed tok · tiers=3 · PARTIAL
  DECISION: OPT-IN — OPT-IN · 3 tier(s) · -5.3pp lift · 100.9% billed tok — inconclusive tier blocks promotion
Recorded to improvement ledger: .../improvement-ledger.json (36 entries)
```

## Efficiency (measured runs, gate set)

| Tier | arm | acc % | solved | mean tok | wall s | tok / acc-pt | aborted cells |
|---|---|---|---|---|---|---|---|
| cogito:8b | auto | 24.6 | 0 | 15,696 | 22 | 638 | 0 |
| cogito:8b | ic | 12.7 | 0 | 36,302 (+131 %) | 18 | 2,859 | 0 |
| qwen3:4b | auto | 40.7 | 1 | 21,592 | 76 | 530 | 0 |
| qwen3:4b | ic | 55.0 | 1 | 73,964 (+243 %) | 232 | 1,344 | 2 |
| qwen3:14b | auto | 53.4 | 4 | 13,208 | 96 | 247 | 0 |
| qwen3:14b | ic | 54.8 | 3 | 22,516 (+71 %) | 137 | 411 | 0 |

Flags:
- **Tokens without lift: cogito:8b** (+131 % tokens, −11.9 pp) and **qwen3:14b** (+71 %, +1.3 pp).
- **qwen3:4b:** the +14 pp is inside the noise band, and it costs 3.4× the tokens and 3× the wall time.
- The extra tokens come from re-sending the whole thread after each extra read. On a paid tier, a 12-input task under ic would cost about 2-3× per run.

## Paid leg: gpt-4o-mini `lh-1`, default harness

| | runs | acc | solved | billed tok | wall s | spend |
|---|---|---|---|---|---|---|
| last ablation, off arm (`e3009d17`) | 3 | 0.78 (.78×3) | 0 | 12,388 | 73 | US$0.0143 est. (framework US$0.0129) |
| this run (`9bea8bc4`) | 3 | **0.93** (1, .78, 1) | 2 | 12,044 | 53 | **US$0.0131** est. (framework US$0.0121) |

- Before: all 3 runs wrote `sources.md` with literal `\n`, which put the file on one line. All 3 failed the same 2 checks: the source-URL floor and "no orphan citations".
- Now: runs 0 and 2 emitted real newlines in the raw tool call, so the heal had nothing to do, and both runs scored 1.00. Run 1 emitted literal `\n`. The ledger args show real newlines, so the heal ran. But the model's own call was cut short (`"…what-is-wasi\n- https://"`, 187 chars), and the run failed the same 2 checks. `rax-diagnose`: `model:had-evidence-wrong-output`; 4 results cut before the turn, and 4 of the 12 URLs it uses appear in no recorded result.
- Reading: the class that failed every run before (literal-`\n` text writes) caused no failure here. The heal works mechanically (1/1 fired). The lift cannot be credited to it at n = 3, because 2 of 3 runs never needed it.
- **Total paid spend: US$0.013**, under the US$1 cap. No Anthropic calls.

## Failure diagnosis (`rax-diagnose attribute --json` per measured trace; `attribution.txt`, `attr.jsonl`)

Primary reason, failed runs only, before (auto) → after (ic):

| Class | auto | ic |
|---|---|---|
| `model:evidence-not-gathered` | 14 | 6 |
| `model:had-evidence-wrong-output` | 8 | 12 |
| `model:fabrication-vetoed` | 0 | 3 |
| `model:invalid-content` / unattributed | 0 | 1 / 1 |

Top 3 per tier, ic arm (primary + alsoMatched):
- cogito:8b: had-evidence-wrong-output 5 (+3 also), evidence-not-gathered 3, invalid-content 1.
- qwen3:4b: had-evidence-wrong-output 3 (+4 also), evidence-not-gathered 3, fabrication-vetoed 1.
- qwen3:14b: had-evidence-wrong-output 4 (+2 also), fabrication-vetoed 2, evidence-not-gathered 1 (also).

The ic arm's remaining `evidence-not-gathered` runs are mostly about **order**: inputs read after the divergence turn. Examples: cogito `lh-debug-green`, "11/12 not read before the divergence turn", although all 12 were read by exit; qwen3:4b `lh-enumerate-audit`, "4/12 not read before the divergence turn (invalid.txt)".

Shortfall classes, canonical home and owner:
1. **Read-before-dependent-write ordering** (`model:evidence-not-gathered`, now mostly late reads; 6 ic runs). `inputCoverage` checks reads at exit, not before the write that depends on them. Owner: **kernel-warden** (`packages/reasoning/src/kernel/capabilities/verify/derive-inputs.ts`, `contract/run-contract.ts`). DEBT #39.
2. **Write coverage is not per target. With input coverage on, it pulls proactive forcing toward reads** (cogito `rw-7`, 3/3). One `file-write` credits `tool:file-write` for every target, so `outstandingToolWork` lists only unread inputs, and forcing goes after those. Owner: **kernel-warden** (`kernel/capabilities/reason/act-or-answer.ts` `outstandingToolWork`; per-entity cardinality is still not modeled per `kernel/ledger/emit.ts`).
3. **Wrong output despite evidence** (`model:had-evidence-wrong-output`, 12 ic runs; the largest class once reads are fixed). Wrong fixes in `lh-debug-green` / `rw-7`, and wrong valid/invalid calls in `lh-enumerate-audit`. The harness lever is an acceptance check the agent can run. The tasks demand passing tests or a correct audit but offer no self-check (leverage scan item 4). Owner: **kernel-warden** (verify capability). Bench task surface: owner call.
4. Paid tier only: **evidence truncated before synthesis** (gpt-4o-mini `lh-1` run 1: 4 results cut, 4 of the 12 URLs it uses appear in no recorded result). This is the `harness:evidence-truncated` family from last time, on the same task. Owner: **kernel-warden** (`packages/reasoning/src/context/context-profile.ts`).

Unchanged instrument gap: the act-or-answer kernel tally is not persisted (bench owner or harness-warden). New, minor: with `inputCoverage` on, the exit-gate `outstanding` and act-or-answer `outstanding` carry absolute paths, which made trace matching path-dependent. `ic-act.ts` matches on bench-relative suffixes.

## Reproduce

```
TAG=lh CELL_T=240 bash loop.sh "qwen3:4b cogito:8b qwen3:14b" 3                            # local, 240 s
TAG=lt CELL_T=480 bash loop.sh "qwen3:4b" 3 "auto ic" lh-debug-green,lh-enumerate-audit     # censored pairs, 480 s
TAG=lt CELL_T=480 bash loop.sh "qwen3:14b" 3 "auto ic" lh-enumerate-audit
TAG=paid bash loop.sh gpt-4o-mini 3 def lh-1                                               # paid
bun sel.ts && bun to-session.ts session-local3.json sel/auto-sel-*.json sel/ic-sel-*.json
bun gate.ts session-local3.json auto ic 27 cogito:8b,qwen3:4b,qwen3:14b [ledger]
bun ic-act.ts sel/*.json ; bun act.ts sel/*.json ; bun summary.ts sel/*.json ; bun attr-tally.ts attr.jsonl ; bun cost.ts def-paid-gpt-4o-mini.json
```

Scripts expect to run from the scratch dir `/home/tylerbuell/.claude/jobs/eaddf328/tmp/abl-ic/`, which also holds the traces and the `sel/` set. Results files here keep `traceFile` paths into that directory.
