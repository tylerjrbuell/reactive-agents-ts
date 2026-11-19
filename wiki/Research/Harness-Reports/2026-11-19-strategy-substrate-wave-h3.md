---
type: experiment
status: complete
created: 2026-11-19
tags: [harness, h3, regression-check, strategy-substrate, repetition-guard, reflexion, code-action]
---

# Strategy-substrate wave: H3 no-regression check (cogito:8b + gemini-2.5-flash)

**Call: ship-with-caveat.** No tier shows an H3 regression.

- **cogito:8b improved.** Pass rate went from 20/60 to 27/60. The run-paired McNemar is +7/-0 (p=0.016), yet verdict.ts's lift band still calls it "within noise".
- **gemini-2.5-flash is unchanged.** Pass rate is 46/60 in both arms (McNemar +3/-3, p=1.0).
- **The `REGRESSED` labels are artifacts of choosing the target reason.** verdict.ts printed `REGRESSED` because `harness:false-veto` rose 1 to 3 pooled. Every one of those runs is rw-6, vetoed by the `output-not-fabricated-measurement` verifier, which this wave did not touch. The candidate reaches that verifier more often because it now solves rw-6 more often.
- **The caveat is one new defect, in G4.** Reflexion's empty-generate fallback now goes through `enforceQualityGate`. That function defaults the output format to `prose` when the format detector finds no cue. The detector misses "render it in a markdown report", so the shared synthesis tells the model "Write as flowing prose paragraphs" on a markdown task. Details and anchors are under Findings, F1.

## Setup

| | Before (baseline) | After (candidate) |
|---|---|---|
| code | `dd5b069b8`, the parent of `d38edf88a`; worktree `/home/tylerbuell/h3-ssw-base` | dev HEAD `6df9c621f`; worktree `/home/tylerbuell/h3-ssw-cand` (pinned, because the shared checkout moves) |
| reasoning dist | rebuilt in the worktree (`turbo build --filter=@reactive-agents/reasoning...`) | same |
| commits between | `d38edf88a` repetitionGuard yield; `8815b8a22` resumeRun newRun; `747b05e5f` G1/G2; `fcd71f6e1`, `96d4b5750` Cortex UI; `ee18ee5b2` G3/G4; `02b802193` G6; `6df9c621f` strategySwitched telemetry | |

- **Suite.** The frozen 12 H3 tasks, arm `ra-default`, k=5. Flags: `--budget-sec 585 --cell-timeout-sec 180 --start-margin-sec 100` (same as the 2026-11-18 ledger). That gives 60 cells per arm per tier, 240 cells in total. The suite hash is identical in both checkouts.
- **Tiers.** cogito:8b is the local tier, the bench's standing local baseline. gemini-2.5-flash is the API tier; its key is in `.env`, passed with `bun --env-file`.
- **Scratch-only edit.** H3_TIERS has no gemini entry, so I added `"gemini-2.5-flash": { provider: "gemini", model: "gemini-2.5-flash", contextTier: "standard" }` to `run-h3.ts` in both worktrees only. I did not edit the shared checkout. If this tier should stay, the edit belongs in `packages/benchmarks/src/h3/run-h3.ts` H3_TIERS.
- **Contention.**
  - The first cogito chunk ran while another session had qwen3:4b loaded and 5 Ollama clients connected. cogito never loaded, and that chunk was killed with **0 cells recorded**. None of the cells below come from it.
  - All 120 cogito cells ran after that session freed Ollama, with only cogito:8b loaded. The preflight still flagged two things, so cells ran with `--allow-contention`, recorded in provenance. One was an idle keep-alive connection from the Cortex dev server (pid 38953, no model, no requests). The other was host CPU load of 0.9 to 1.3 per CPU on some chunks.
  - Arms alternated chunk by chunk, so both saw the same host state.
- **Gemini timing.** The gemini cells ran first, both arms back to back. They do not touch the GPU.
- **Traces (local, not committed).** `/home/tylerbuell/h3-traces-ssw/{base,cand}-{cogito-8b,gemini-2-5-flash}/` and `strat-{base,cand}/`.

## verdict.ts output (before = baseline, after = candidate; run from the candidate worktree)

cogito:8b:

```
SHIFTED · harness:premature-stop 1→0 · pass 20/60 → 27/60 (pooled +12pp; accuracy lift +9.5pp, within noise (cogito:8b +9.5pp ±8.2 McNemar +7/-0 p=0.016)); timeouts 1→0; tokens unknown for 5+5 cells (mean not cost-complete); new harness reasons: harness:false-veto 0→1
  activity changed: guard:tool_call_extracted:warn 19/60→13/60; signal:redirect@unresolved-tool-call-guard 19/60→13/60; guard:stall_deliverable:block 1/60→3/60; guard:tool-gate:block 5/60→7/60; signal:redirect@runner.ts 0/60→2/60; guard:exit_gate:block 3/60→5/60
```

gemini-2.5-flash:

```
REGRESSED · harness:false-veto 1→2 · pass 46/60 → 46/60 (pooled +0pp; accuracy lift -0.8pp, within noise (gemini-2.5-flash -0.8pp ±7.1 McNemar +3/-3 p=1.000)); timeouts 0→1; tokens unknown for 5+5 cells (mean not cost-complete)
  activity changed: guard:terminal_decision:terminate 60/60→59/60
```

Pooled:

```
REGRESSED · harness:false-veto 1→3 · pass 66/120 → 73/120 (pooled +6pp; accuracy lift +4.4pp, within noise (cogito:8b +9.5pp ±8.2 McNemar +7/-0 p=0.016 | gemini-2.5-flash -0.8pp ±7.1 McNemar +3/-3 p=1.000)); timeouts 1→1; tokens unknown for 10+10 cells (mean not cost-complete)
```

How to read these:

- **The `harness:false-veto` rise is not this wave.** All 3 candidate runs and the 1 baseline run are rw-6, blocked by `deliverable_decision` `output-not-fabricated-measurement` ("350ms", "5x faster", "0.5ms"). Those runs are `01M7S1RW2PRQ46GJWWXQY1F3FR`, `01M7S24J01D9J0A420ANREX0K8`, `01M7S3KJVSR05KG1YRW26YFA73`, and baseline `01M7S268TFBGV1XJRRYC21K0RR`. The verifier is not in the wave's diff.
- **The `--mechanism repetition` check reads 0/60 in both arms, and that is an instrument blind spot.** repetitionGuard's block is an `observation` only and emits no `guard-fired`, so `mechanismActivity` cannot see it (F4). I counted the guard by its nudge text instead (next section).

## Per-arm metrics (all measured cells)

| tier | arm | solved | Wilson 95% | mean billed tok (sd) | mean iterations | mean tool calls |
|---|---|---|---|---|---|---|
| cogito:8b | base | 20/59 (1 inconclusive: timeout) | 23-47% | 6338 (4833) | 4.12 | 3.29 |
| cogito:8b | cand | 27/60 | 33-58% | 7028 (6283) | 4.32 | 3.08 |
| gemini-2.5-flash | base | 46/60 | 65-86% | 6758 (4083) | 2.43 | 3.35 |
| gemini-2.5-flash | cand | 46/59 (1 inconclusive: timeout) | 66-87% | 6459 (3647) | 2.51 | 3.29 |

**Noise.** Each cell is Bernoulli, and n=60 per arm gives an SE of about 6pp. Only cogito's run-paired McNemar (7 discordant pairs, all favoring the candidate, p=0.016) is a resolvable effect. The Wilson intervals overlap on both tiers, so neither tier supports an unpaired pass-rate claim. Token deltas are inside one sd: cogito +11% mean, driven by rw-7 (below); gemini -4%.

Per task (solved base to cand; mean billed tokens base to cand; mean iterations base to cand):

| task | cogito solved | cogito tok | cogito iter | gemini solved | gemini tok | gemini iter |
|---|---|---|---|---|---|---|
| rw-2 | 0 to 0 | 8962 to 8220 | 5.2 to 5.2 | 0 to 0 | 8125 to 8341 | 3 to 3 |
| rw-3 | 0 to 0 | 6550 to 6671 | 0 to 0 | 3 to 3 | 8632 to 8786 | 0 to 0 |
| rw-6 | 0 to 2 | 7240 to 7504 | 5.6 to 5.8 | 3 to 4 | 9822 to 9042 | 3 to 3 |
| rw-7 | 0 to 0 | 8221 to 18229 | 6.4 to 10.4 | 5 to 4 (1 timeout) | 13873 to 11711 | 3 to 5 |
| rw-9 | 3 to 4 | 4863 to 5705 | 4.8 to 5.2 | 5 to 5 | 6196 to 5517 | 4 to 4 |
| ab-trap-4 | 5 to 5 | 0 to 0 | 0 to 0 | 5 to 5 | 0 to 0 | 0 to 0 |
| ab-trap-5 | 4 to 5 | 1604 to 1579 | 3.8 to 3.6 | 5 to 5 | 1981 to 1725 | 3 to 3 |
| h3-plan-only | 0 to 0 | 5543 to 5699 | 0 to 0 | 0 to 0 | 6289 to 6351 | 0 to 0 |
| h3-todo-heavy | 0 to 2 | 17881 to 16061 | 11.2 to 11.0 | 5 to 5 | 6976 to 6582 | 4 to 4 |
| h3-required-tools | 0 to 0 | 3854 to 4160 | 4.6 to 5.0 | 5 to 5 | 7650 to 7314 | 4 to 4 |
| h3-continuation | 5 to 5 | 1452 to 1412 | 2.6 to 2.4 | 5 to 5 | 2258 to 2256 | 2 to 2 |
| h3-exact-value | 3 to 4 | 3519 to 2067 | 5.4 to 3.2 | 5 to 5 | 2535 to 2529 | 2 to 2 |

**Timeouts are environment, not harness.**

- **Gemini candidate, rw-7 run2** (`01M7S1VTMP09JC5RGY4PZYY4SW`): 3 file-reads, then one stream call stalled for 179 s until the cell wall hit. This is `environment:run-aborted`.
- **cogito baseline, rw-6 run1:** an execution timeout, scored inconclusive.

## Attribution (`rax-diagnose attribute --all`)

| reason | cogito base | cogito cand | gemini base | gemini cand |
|---|---|---|---|---|
| not-failed | 20 | 26 | 45 | 44 |
| model:had-evidence-wrong-output | 19 | 16 | 10 | 9 |
| model:ignored-guidance | 8 | 5 | 0 | 0 |
| model:fabrication-vetoed | 5 | 7 | 1 | 2 |
| model:evidence-not-gathered | 3 | 3 | 0 | 0 |
| harness:premature-stop | 1 | 0 | 0 | 0 |
| harness:evidence-truncated | 1 | 0 | 0 | 0 |
| harness:false-veto | 0 | 1 | 1 | 2 |
| environment:* | 2 | 0 | 0 | 1 |
| unattributed | 1 | 2 | 3 | 2 |

Harness-attributed failures: 3 before, 3 after. Every harness reason after the wave is the pre-existing rw-6 measurement verifier.

## Repetition-guard risk check (d38edf88a)

Instrument: `.agents/skills/harness-improvement-loop/scripts/repetition-risk-scan.ts`. It flags any non-meta tool that ran more than 4 times in one run. For each flagged tool it reports distinct args, distinct results, repeated results and failed calls (blocked calls count as failed). It also counts repetitionGuard nudges by their text.

| traces | runs | runs with a tool >4 | guard nudges | `UNEXPECTED_TOOL_CALL` |
|---|---|---|---|---|
| cogito base | 60 | 9 | **43** | 0 |
| cogito cand | 60 | 8 | **0** | 0 |
| gemini base | 60 | 10 | 0 | 0 |
| gemini cand | 60 | 11 | 3 | 0 |
| strategy probe base / cand | 10 / 10 | 0 / 0 | 0 / 0 | 0 / 0 |

- **Gemini: every flagged run made distinct calls and got distinct results.** h3-todo-heavy has 6 file-read and 6 file-write calls on 6 targets in both arms. rw-7 cand run4 shows 5 file-writes. No candidate run repeats.
  - The candidate's 3 nudges are all one run, rw-7 run4 (`01M7S254WMG3M5NH578WZJPDSG`). It blocked a 3rd `code-execute` after the first two returned the same "filters did not match any test files" output. The guard stopped a real no-yield repeat, which is correct, and the run passed.
- **cogito: the old count-based guard was the runaway source, and the candidate removes it.**
  - In the baseline, h3-todo-heavy kept hitting the guard. Run3 (`01M7S4EAZ0HVJ3EK13M7EE6G37`) made 25 `file-write` calls; 19 were blocked or failed and 18 repeated a result. Run1 made 14 calls with 8 blocked.
  - The model kept retrying the target the guard refused, which burned iterations.
  - In the candidate, the same task has 7 to 12 writes with 1 to 6 failures, 0 nudges, and 2/5 solved instead of 0/5.
- **The longest candidate run is not a runaway: rw-7 on cogito** (tokens 8.2k to 18.2k, iterations 6.4 to 10.4).
  - Those runs now do the work: 3 to 4 file-reads, up to 3 file-writes, and 1 to 3 `code-execute` calls. The `code-execute` calls failed inside the sandbox, which is a tool failure, not a guard block, and there were 0 nudges.
  - The baseline mostly abstained or stopped before any tool call (`abstained`, `tool_call_unresolved`).
  - It is still 0/5 for cogito in both arms. The extra spend is the model attempting the task. The old guard would not have stopped it: these are distinct targets, below the backstop.
  - Not exercised: the 0.75 x maxIterations backstop. No run reached it. H3 is offline, so no web-search fan-out occurred. In the crypto probe, web-search ran at most 4 times per run.

**Gemini critique follow-up (`UNEXPECTED_TOOL_CALL`).** Across the 4 reflexion runs, 10 tool-less `complete` calls ran (synthesis, critique and verify). All ended `end_turn`, and `UNEXPECTED_TOOL_CALL` appears 0 times in any trace. G4's meta-tool exclusion holds on this sample. The candidate's shared-synthesis prompt carries no `todo(` text; the baseline's fallback prompt carried the todo scaffold. n is small.

## Per-strategy live before/after: owner's Cortex crypto-report shape (gemini-2.5-flash, n=2)

**Probe.** `.agents/skills/harness-improvement-loop/scripts/probe-strategy-crypto-report.ts`, run in each worktree.

- **Task:** the corpus prompt verbatim: "Find the current price of the major crypto currencies (BTC ,XRP, ETH, XLM) and research each currency market trends then render it in a markdown report".
- **Config:** mirrors the corpus `run-started.config`: maxIterations 16, temperature 0.7, switching off, `todo` + `recall` meta-tools, `.withDurableRuns()` + `.withApprovalPolicy({ mode: "detach" })`. Tools are crypto-price and web-search (Keenable backend).
- **Columns:** "coins" counts the coins named next to a number in the output; "md" means a markdown heading is present. Neither is a grader.

| strategy | base run0 | base run1 | cand run0 | cand run1 |
|---|---|---|---|---|
| reflexion | fail/partial, `terminal-mislabel/status-override`, 60k tok | fail/partial, `budget-cap`, 22k | fail/partial, `bookkeeping-loop`, 9.6k, **md=no** | **success**, verified, 65k |
| tree-of-thought | success, 32k | success, 31k | success, 48k | fail, `bookkeeping-loop` (10/15 calls todo), cap 16, 60k |
| code-action | **fail: `config-refused`** (0 tok) | **fail: `config-refused`** | **success**, 1 LLM call, crypto-price + 4 web-search in sandbox, 1.0k | **success**, 1.0k |
| direct | success, 4.9k | success, 4.8k | success, 4.3k | success, 3.5k |
| plan-execute-reflect | success, 14.5k (coins 1/4) | success, 14.8k | success, 14.4k | success, 15.8k |

`rax-diagnose cause` per run IDs:

- base: reflexion `01M7S2BDCQF87X5KDM3YYV5WYS`, `01M7S2DG5NJK94SRE9F0PC1KPA`; ToT `01M7S2C2RNFDMMR0PHS20V301D`, `01M7S2DT8SB3A1WWC0XE46A235`; code-action `01M7S2CX2GERSMPSKPBRCVKBGG`, `01M7S2ENFTZT6W0QBBFTMXCQ21`; direct `01M7S2CXMJQZ6C15ZBJBX6HRJ9`, `01M7S2EP3M68KRQBRWC9EPBJXJ`; PER `01M7S2D3ZJEBYGBW4P0ZJRSY4Q`, `01M7S2EVK768E8JSM16SWY2PY7`.
- cand: reflexion `01M7S270TSHQ3PHV9CF8Y8VXV9`, `01M7S28RK76JSD3PRHTB7M542J`; ToT `01M7S2776T6FRDDK8FBPZRCAP9`, `01M7S29FXP6AMB9SJND37DNV14`; code-action `01M7S282Y3CBF1AP9M646MMPPD`, `01M7S2ACD6Z3M88P9SK19S263Z`; direct `01M7S287GSET8Y0TFE5VMK1578`, `01M7S2AFVEB723NMVEZ4YTNDXA`; PER `01M7S28D8S3W18R57CPCCFMZ89`, `01M7S2ANCM6PW4P3G0Y91EFAMP`.

What the table shows (n=2, so direction only):

- **G6 works live.** The baseline reproduces audit E5: code-action is refused under Cortex's `{mode:"detach"}`. The candidate runs it, and it is the cheapest strategy at about 1k tokens.
- **G1 is visible.** reflexion and ToT `llm-exchange` events now carry `provider: gemini`.
- **G3 helps once.** The candidate's reflexion run1 ships a verified answer. The baseline's run0 vetoed a verified answer (the E6 shape, `terminal_status_override completed -> partial`).
- **Reflexion still fails half its runs, from G5, which is not in this wave.** Both arms' generate pass gets cap 4 = ceil(16/4). Two of its first four turns go to `todo`, and the pass caps out with one crypto-price result.
- **ToT candidate run1 is the known E3 todo churn**, at the inherited cap 16. One run out of 2 is not separable from noise; the baseline todo counts were 4 to 6 versus 8 to 10 in the candidate.

## Findings

**F1 (new, from G4; owner kernel-warden). The shared synthesis forces prose on a markdown task.** The candidate's reflexion run0 (`01M7S270TSHQ3PHV9CF8Y8VXV9`) shows it.

1. The generate pass is identical in both arms: todo, todo, crypto-price, then the cap-4 exit.
2. In the candidate, the synthesis prompt reads "They requested the output as: prose / Instruction: Write as flowing prose paragraphs."
3. The model wrote prose (no markdown) and filled "market trends" from parametric memory; no web-search had run.
4. The critique then said `SATISFIED`, which is false: "researched their market trends ... rendered in a markdown report". So no improve pass ran, and the run ended `partial`.
5. The baseline's old fallback passed the raw task. It produced markdown, the critique said UNSATISFIED, and improve passes ran web-search.

Root cause, two parts:

- `packages/reasoning/src/kernel/loop/finalize.ts:149` has `const synthesisFormat = intent.format ?? "prose";`. A null format becomes a positive "write prose" instruction, which overrides the task's own words. This line predates the wave. G4 made reflexion a new caller (`packages/reasoning/src/strategies/reflexion.ts:279`, `force: true`). plan-execute uses the same gate (`plan-execute.ts:674`, `plan-execute/single-analysis.ts:119`).
- `packages/reasoning/src/kernel/capabilities/comprehend/task-intent.ts:57` matches `/(?:as|in|using)\s+markdown/i`. `extractOutputFormat` returns null for "render it in a markdown report" and for "Write a markdown report on X" (checked).

Suggested boundary fix: one site, in `buildSynthesisPrompt`/`enforceQualityGate`. When the format is null, say "use the format the task asks for" rather than "prose". Widen the markdown cue to `markdown (report|document|summary|file)` and `in a markdown`. Pin it with a test on this prompt.

**F2 (pre-existing, G5 still open).** Reflexion's even per-pass split (cap 4 of 16) caused both arms' reflexion failures on this task. The baseline also has the E6 veto. This is outside this wave's scope; ablation-warden owns G5 per the audit.

**F3 (pre-existing).** The rw-6 `output-not-fabricated-measurement` verifier vetoes answers that pass the hidden check: 4 runs across both arms and tiers. This is the only `harness:*` reason left after the wave.

**F4 (instrument gap; owner kernel-warden for the emit, harness-warden for the reader).** repetitionGuard blocks emit no `guard-fired` (`packages/reasoning/src/kernel/capabilities/act/guard.ts:673-676` returns only `{ pass: false, observation }`). So `mechanismActivity` and `verdict.ts --mechanism` cannot see a default-on guard this wave changed. I had to count it by its nudge text. Please emit `guard-fired repetition_guard:block` with `{ tool, priorCalls, noNewInformation, backstop }` from the act phase, or the shared guard runner.

## Code-action approval probe (fixed)

`bun .agents/skills/harness-improvement-loop/scripts/probe-code-action-approval-scope.ts` (TestLLMService, 0 tokens, run on dev HEAD src):

```
A gated-not-callable	refused=false	expect=false	OK	status=completed
B empty-policy      	refused=false	expect=false	OK	status=completed
C no-policy         	refused=false	expect=false	OK	status=completed
D gated-callable    	refused=true	expect=true	OK	status=failed error=Strategy execution failed (code-action): code-action cannot honor .withApprovalP
```

Changes to the probe:

- It now reads the post-G2 contract: a failed result whose `result.error` contains `code-action cannot honor` (the substrate prefixes it with `Strategy execution failed (code-action): `). An Effect `Left` is reported as an instrument fault.
- The stub answers in the async-IIFE form that the plan prompt requires.
- It adds arm D (gated-callable).
- It exits 1 on any mismatch.

## Spend

- **gemini-2.5-flash (H3, both arms):** 376 calls, 646,301 input and 132,673 output tokens. At list price ($0.30/M in, $2.50/M out) that is about **$0.53**. The trace `costUsd` sum is $0.17; the framework's estimate is about 3x below list (not investigated).
- **gemini-2.5-flash (strategy probe, both arms):** 168 calls, 376,509 in and 29,967 out, about **$0.19** at list price. The trace sum is $0.06. One deleted smoke run (direct, 3,989 tokens) is not included.
- **cogito:8b (local, $0):** 342,225 + 386,541 billed tokens.
- **Total API: about 1.19M tokens, about $0.72 at list price.**

## Artifacts

- Results: `wiki/Research/Harness-Reports/2026-11-19-strategy-substrate-wave-h3/{base,cand}-{cogito-8b,gemini-2-5-flash}.json`, `strategy-{base,cand}.json`
- Scripts: `.agents/skills/harness-improvement-loop/scripts/probe-code-action-approval-scope.ts` (fixed), `probe-strategy-crypto-report.ts` (new), `repetition-risk-scan.ts` (new)
