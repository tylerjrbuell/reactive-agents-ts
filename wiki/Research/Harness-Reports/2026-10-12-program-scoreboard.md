# Program Scoreboard — Local Tier Reliability (init 2026-10-13, Task 0)

Lift Protocol rung-0 baseline. Every ⚡ wave's lift verdict is measured against
 THESE rows. Measurement is frozen (Doctrine #4) at Wave-0-close HEAD (see
`wiki/Hot.md`). Raw per-run data: `2026-10-12-live-probe-audit-results/fixtures/baseline-metrics.jsonl`
 + one committed trace JSONL per run (`fixtures/<runId>.jsonl`).

Columns (per plan): success rate | tokens/run | llmCalls/run | iterations-to-first-acting |
false-success count | empty-content-iteration rate | schema-tokens/req | classify-calls/req

Definitions:
- **false-success** = run-completed status `success` AND (final assessment requirementsOutstanding>0
  OR deliverablesMissing>0 OR terminatedBy not a final-answer path). Probe-4/T0 signature.
- **empty-content-iteration rate** = think-purpose llm-exchanges with empty content and no toolCalls / think exchanges.
- **classify-calls/req** = classify-purpose llm-exchanges per agent-turn (think) exchange.
- **schema-tokens/req**: MEASUREMENT GAP — the trace records `toolSchemaNames` only, never the
  serialized schema payload, so per-request schema tokens are not extractable without a framework
  edit (forbidden). Static estimate for the full builtin set lives in probe-3 rows below; live
  visible-schema counts per call are in the metrics JSONL (`schemaNamesPerCall`).

## Baseline (rung-0, local Ollama, temperature 0, reactive maxIterations 10, N=5 unless noted)

| arm | scenario | model | success rate | tokens/run | llmCalls/run | iter-first-acting | false-success | empty-content rate | schema-tokens/req | classify/req | wall-clock notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| s1-qwen34b | S1 thrash | qwen3:4b | 0/5 (0%) | 2440, 3061, 2803, 2456, 2632 (mean 2678) | 7, 7, 7, 7, 7 | none called (—) | 0 | 0/6 think ×5 (0%) | GAP (0 schemas visible) | 1/6 = 0.17 (5/5 runs) | 23.5–31.4 s/run, no cold-load stalls |
| s2-qwen34b | S2 thinking-starve | qwen3:4b | 5/5 (100%) | 2620, 2407, 2349, 2132, 2902 (mean 2482) | 1 ×5 | — (no tools; single-turn answer) | 5/5 flagged* | 0% | GAP (no schema sent) | 0 (no classify fired) | 11.0–15.9 s/run; 4-char visible content vs 1.8–2.6K tokensOut — thinking-starve confirmed |
| s3-qwen34b | S3 file task | qwen3:4b | 5/5 (100%) | 5401, 5394, 5987, 5697, 8468 (mean 6229) | 3 ×5 | iter 0 (5/5) | 5/5 flagged (stale tallies: report.md correct, final assessment said outstanding=3/missing=2) | 0% | GAP (4 schema names visible/req; ~1288 tokensIn/req incl. schema+task) | 0 | 9.4–28.7 s/run; schema shape ≠ thrash — S3 defect here is assessment-lag false-success, not loop |
| s3-llama32 | S3 file task | llama3.2:latest | 5/5 (100%) | 3615, 3486, 3960, 7560, 3266 (mean 3917) | 3, 3, 3, 7, 3 | iter 0 (5/5) | 5/5 (run-4 = canonical thrash: discover-tools ×146, all-zero evidenceDelta, success + outstanding=5; runs 1–3,5 = stale-tally false-success; run-2 wrote without reading) | 0% | GAP (3 schema names/req; 2 runs sent 0) | run-4: 1/5 think-calls; others 0 | 1.8–12.8 s/run |
| s1-qwen35 | S1 thrash | qwen3.5:latest | 0/5 (0%) | 3630, 4573, 2591, 1884, 2892 (mean 3114) | 7, 7, 7, 3, 7 | none called (—) | 0 (all failure verdicts) | 0% | GAP (0 schemas visible) | 4/5 runs: 1/6 = 0.17; run-4: 0 | 30.3–148.2 s/run (27B); abstained ×4 + low_delta_guard ×1; evidenceDelta=0 every assessment on every run (stall signature intact, termination honest) |
| s4-phi4mini | S4 no-FC loop | phi4-mini-reasoning:latest | 0/3 (0%) | 11563, 12640, 5493 (mean 9899) | 2, 2, 2 | — (0 tool calls, schemas visible) | 0 (failure verdicts — honest) | 0% | GAP (3 schema names/req) | 0 | 49.5–107.3 s/run; no-FC CONFIRMED: none-class template (see MANIFEST S4 block) → 7–14K tokensOut of visible monologue, nothing acts, end_turn. maxIterations NOT burned (model self-terminates early) — signature partial match |
| haiku-s1 | S1 rung-2 (ra-full mirror) | claude-haiku-4-5-20251001 | rung-2 deferred | — | — | — | — | — | — | — | **BLOCKER (named)**: Anthropic API 400 "credit balance is too low" (2026-10-13 06:17). Wiring proven: 3 error traces committed; rerun `bench.ts haiku-s1` once funded |
| haiku-s3 | S3 rung-2 (ra-full mirror) | claude-haiku-4-5-20251001 | rung-2 deferred | — | — | — | — | — | — | — | **BLOCKER**: same 400 credit error; 3 error traces committed |

## S1 termination-mix note (baseline as shipped, NOT the recorded defect shape)

At temp 0 on qwen3:4b all 5 S1 runs terminate `abstained` / status failure (honest abstention),
with the stall signature intact: every assessment `evidenceDelta=0`, band `green`,
`requirementsOutstanding=1`, zero tool calls, `loop_resolution` guard fires terminate at the
terminal iter. The 2026-10-12 live-trace shape (discover-tools varied-args thrash →
early-stop with success verdict) did NOT reproduce at temp 0 on this arm. Per brief this is
VALID baseline data; success-vs-thrash mix is documented per arm above as captures land.

## Gate lines

- **S1 replay-determinism gate (W0.8 cookbook lane): PASS.** Fixture `01M4SX78BT4RB543SWFP5F4DXS.jsonl`
  (s1-qwen34b run-1): `loadRecordedRun` + `buildSequentialLLMTable` + `makeReplayLLMLayer` +
  `.withReplayLLM` reproduced the recorded terminal output **byte-identical (135 chars)** with
  matching verdict (failure/abstain path), keyless and offline. Runner: `scripts/lift/replay-gate.ts`.
  (Re-verified PASS after the fabricated-token redaction disclosed in fixtures/MANIFEST.md.)
- Probe rows (unit-style, re-run under final code state): see fixtures/MANIFEST.md probe table
  (finding #2 CONFIRMED live; schema payload 11,838 chars ≈ 3,996 tok = 49% of 8K window).

## Caveats / MEASUREMENT GAPs (no framework edits made — Doctrine)

1. **schema-tokens/req**: trace records `toolSchemaNames` only, never serialized schema bytes.
   Estimate from probe-3 per-tool char table × `schemaNamesPerCall` (in baseline-metrics.jsonl).
2. **false-success flag is a heuristic ceiling**: `success AND (final outstanding>0 OR missing>0 OR
   terminatedBy∉final-answer)`. It OVER-fires on 1-turn `end_turn` successes (S2 5/5, S3 tails)
   because the last `assessment` is computed BEFORE the terminal answer lands — deliverable truth
   (e.g. s3-qwen34b run-1 `report.md`: correct 3 sections, grand total 4900) contradicts the stale
   tally. Ground truth = raw `finalRequirementsOutstanding`/`terminatedBy`/trace per run.
   The one UNAMBIGUOUS false-success in the baseline set is **s3-llama32 run-4** (discover-tools
   ×146 thrash, all-zero evidenceDelta, `harness_deliverable` terminate, success verdict,
   outstanding=5/missing=3) — the S1 defect signature reproduced at temp 0, on the S3/llama3.2 arm.
3. **S1 signature mix**: qwen3:4b + qwen3.5 abstain honestly at temp 0 (no thrash); the varied-args
   thrash surface appeared on llama3.2. Loop-detector variant: `loop_resolution` fires terminate at
   iter 6 on S1 (guard NOT silent — differs from the 2026-10-12 live trace where nothing fired).
4. **classify-calls/req**: 1 classify per S1 run on qwen3:4b/3.5 (0.17 per think exchange); 0 on
   S2/S3/S4 arms (concrete builtin set skips the classifier per reliability profile).
5. Haiku arms deferred on account credit (named blocker above); all local arms fully populated.

## Post-W1 lift measurement (W1.5, captured 2026-10-13 07:45–07:48 at HEAD a44952626)

Arms re-captured N=5 (S2) + N=2 drift-guard (S1), temp 0, into `fixtures/post-w1/` (baseline
fixtures untouched). Same extractor definitions as baseline; additively-new forensics fields
(`thinkingCharsSum` etc.) recorded only post-W1 by construction. Traces + rows:
`fixtures/post-w1/MANIFEST.md` + `fixtures/post-w1/post-w1-metrics.jsonl`.

| metric (s2-qwen34b) | PRE (baseline) | POST (W1) | delta |
|---|---|---|---|
| success rate | 5/5 | 5/5 | = |
| empty-content-iteration rate (same def: think exchanges with empty content ∧ no toolCalls / think calls) | 0% | 0% | = (S2 starve ≠ empty by this def; the PRE defect was the 4-char-content-vs-2K-thinking split) |
| thinking retained per run (chars) | 0 — channel DROPPED (probe-2: 0/4 StreamEvents carry thinking) | 6,019–9,459 (5/5 runs; thinkingChars on 100% of think exchanges) | **channel wired** |
| deliverable: run-completed.output | '3052' (4-char spec-compliant answer) ×5 | 525–1,915-char raw reasoning tail ×5 | **REGRESSION (defect below)** |
| llmCalls/run · iterations | 1 ×5 | 1 ×5 | = |
| tokens/run | mean 2,482 (2132–2902) | mean 3,024 (2246–3176) | +22% (temp-0 qwen3 thinking-length variance; tokensIn identical 310) |
| trace bytes/run | mean 7,051 | mean 8,754 | **+24%** — capped 240-ch preview/exchange + forensics fields ride the trace; the "~2.6K full thinking on step metadata" claim is runtime-only, NOT trace-observable (W1.4: full reasoning never rides the trace) |
| s1-qwen34b drift guard (N=2) | baseline: abstained/failure, all-zero evidenceDelta, 7 calls (6 think + 1 classify), loop_resolution terminate | 2/2 shape-identical, no verdict/termination drift; 17.2–18.3K thinkingChars now recorded/run | stable |

**VERDICT: MIXED — channel lift CONFIRMED, quality lift NOT CONFIRMED, + 1 newly-reachable DEFECT.**

1. CONFIRMED (mechanism): thinking flows provider→kernel→trace on 5/5 runs; rescue machinery is
   reachable on capable models. Cut-test (sever local.ts thinking emission → consumption tests red)
   was executed by kernel-warden in W1.3 — cited at eb0f42a0c body + pilot log (7c48eb3f5), not re-run.
2. NOT CONFIRMED (quality): the model's visible answer was ALREADY '3052' pre-W1 on this frozen
   scenario (5/5, temp 0); post-W1 the delivered output got WORSE, not better.
3. DEFECT (file-ready; NOT fixed here — zero packages/** edits, kernel-warden scope):
   `think.ts:1362` rescue heuristic (`thought.trim().length < 50 && thinking.length > 100` →
   `stream-parser.ts:246-249` branch 4 "last 1–2 substantive paragraphs of thinking") fires on every
   task spec that demands a terse answer. Post-W1 it replaced the correct 4-char answer with
   internal-reasoning prose (mid-sentence, truncated) in 5/5 S2 runs. Pre-W1 the same guard never
   fired because `thinking` was null (the channel was dropped upstream) — W1 did not introduce the
   heuristic, it supplied the input that makes it fire on correct terse answers. Suggested fix shape: never rescue over a non-empty cleanContent that passes the
   FA-shape/verdict check; or gate branch-4 on cleanContent being empty.
   Full trace excerpts: fixtures/post-w1/MANIFEST.md.

## Post-W1-FIX re-capture (W1.5 recapture, 2026-10-13 07:59–08:03 at kernel fix af7d1b45f)

Captured into `fixtures/post-w1-fix/` (dist rebuilt first; same prompts/temp/extractor defs;
baseline + post-w1 dirs untouched). Rows + marker-clobber table: `fixtures/post-w1-fix/MANIFEST.md`.

| metric (s2-qwen34b) | PRE (baseline) | POST-W1 (defect) | POST-W1-FIX | Δ |
|---|---|---|---|---|
| delivered output | '3052' ×5 | reasoning tails 525–1,915 ch ×5 | **'3052' ×5** | defect eliminated |
| prose-tail signature rate | 0/5 | 5/5 | **0/5** | fixed-kernel proof |
| marker-clobber (FA/ACTION/code-fence in output) | 0/5 | 0/5 | **0/5** | recorded even at zero (review item) |
| thinkingChars/run | 0 (channel dropped) | 6,019–9,459 | **6,696–10,762 (5/5)** | channel retained |
| success rate / iterations / llmCalls | 5/5 · 1 · 1 | 5/5 · 1 · 1 | 5/5 · 1 · 1 | = |
| tokens/run mean | 2,482 | 3,024 | 2,903 | temp-0 variance band |
| trace bytes mean | 7,051 | 8,754 | 7,355 | forensics fields kept, prose tail gone |
| s1-qwen34b drift guard (N=2) | baseline band | no drift | **no drift** (abstained, 7 calls, 1 classify, all-zero evidenceDelta, loop_resolution ×1, tok 2436/2681 ∈ 2440–3061 band) | stable |

**FINAL WAVE-1 VERDICT: CONFIRMED (channel + quality), defect closed with live proof.**
The thinking channel is wired end-to-end (6.7–10.8K thinkingChars recorded on 5/5 runs, was 0/dropped
pre-W1) AND the S2 deliverable is back to the terse correct answer '3052' on 5/5 runs — the W1.5
reasoning-tail signature measured 5/5 → 0/5 across the fix, marker-clobber 0/5, no S1 behavioral
drift. Wave 1's claim ("thought-continuity unblocked; largest per-run SLM quality win path opened")
is now honestly inheritable: every Wave 4+ S2 number baselines against THESE rows. Residual honesty
note: the S2 answer itself never changed (model already emitted '3052' pre-W1 at temp 0), so the
"quality win" on THIS scenario is defect-free retention of reasoning data + rescue availability —
the answer-accuracy lift itself is only demonstrable on thinking-only-answer tasks (W1.3 unit arms:
rescue thought == answer), not on the frozen S2 prompt.

## Post-W2 close capture (2026-10-13 12:33–12:39 at HEAD 471d7ed8d, dist rebuilt first)

Arms: S1 N=5, S2 N=5, S3-qwen34b N=5, S3-llama32 N=5 (S3 pairs exceeded the N=3 spec — extra
variance rows kept) into `fixtures/post-w2/`. Rows + signal counts: `fixtures/post-w2/MANIFEST.md`.

### Three-point table (baseline PRE → post-w1-fix → post-w2), same extractor definitions

| arm | metric | PRE (Wave 0) | W1-fix | POST-W2 | W2 delta |
|---|---|---|---|---|---|
| s1-qwen34b | success rate | 0/5 | 0/5 | **0/5** (abstained ×5) | = (no drift) |
| s1-qwen34b | tokens/run mean | 2,678 | 2,559 (N=2) | 2,358 (1,859–2,849) | −12% (variance band) |
| s1-qwen34b | llmCalls · classify/run | 7 · 1 | 7 · 1 | **7 · 1** | **0 — by design**: both capture models carry classifierReliability=high (bench calibration lines: qwen3:4b 53–67 samples, llama3.2 5–9), W2d skip correctly never fires; 0 `classifier-skip` signals / 20 runs |
| s2-qwen34b | success · output | 5/5 · '3052' | 5/5 · '3052' | **5/5 · '3052' ×5** | = (quality intact); terminatedBy label end_turn→**llm_end_turn** (label-only rename, semantics unchanged) |
| s2-qwen34b | thinkingChars/run | 0 (dropped) | 6.0–9.5K | 4.1–8.4K ×5 | retained |
| s3-qwen34b | success rate | 5/5 | — | **0/5** | **REGRESSION — see defect** |
| s3-qwen34b | schemas/req | 4 | — | **0** | native FC demoted to text-parse |
| s3-llama32 | success rate (verdict) | 5/5 | — | 5/5 | = verdicts; content degraded (2/5 empty-skeleton reports, 2/5 wrong grand totals — baseline run2 also had a blank total, flakiness pre-existing) |
| s3-llama32 | tokensIn/req mean | 1,084 | — | **~522 (−51%)** | schema-count 3→2 (discover-tools no longer base-visible) + history shape; NOT the W2d names-and-types seam (both models resolve tier=mid on this box — registry holds no rows for them; GH #239 stub-row gap) |
| s3-llama32 | canonical thrash signature (01M4SXNTN38 shape) | 1/5 (run-4: discover-tools ×146 false-success) | — | **0/5** | phenotype gone — discover-tools dropped from the wire; Wave-4 baseline-continuity finding (record, don't fix) |

### WAVE-2 VERDICT: MIXED — cost seams hold or measured-absent honestly; S3 local arm ships a REGRESSION

Per plan clause + four ledged seams, attributed from evidence (not assumed):

1. **Estimator +25% dense (2.3, W2c tokenizer-aware)**: wired — surfaces in the guard's
   `correctedTokensBefore` accounting; no direct wire-side token count available (MEASUREMENT GAP
   unchanged). Not contradicted.
2. **Registry tier → local (2.1/W2b)**: **no live effect on capture arms** — Capability registry on
   this box contains only probe/test-fixture rows (qwen3.5, gemma4, qwen3-14b…); qwen3:4b +
   llama3.2:latest still resolve mid via regex fallback. The mid→local flip that would activate
   W2d compaction is exactly what stub-row issue **#239** exists to fix.
3. **W2d compacted schemas**: **>=3x claim stays unit-pinned only** (`d5ecf6b77` wire-payload-honesty
   shrink pin, local arms); live local tier never engaged (2 above). Classifier-skip enforcement:
   correct **delta-0** (0 skip signals; both models classifier=high — pre-authorized honest row).
4. **W2e head-truncation guard**: **head-truncation incidents 0/20** (system head intact everywhere;
   no `systemPromptTruncated`); guard preflight observable — fired 1/20 (s3-qwen34b r1, conservative
   over-fire direction, dropped none, shipped). File-ready observation: its ceiling reported
   numCtx=32768 while the arm pinned wire num_ctx=8192 → preflight ceiling does not read the
   request-level override.

**DEFECT (headline, file-ready, NOT fixed here)**: S3 qwen3:4b 5/5→**0/5**. W2a (57b6836a) derives
`supportsToolCalling` from the template probe; the shipped prior `calibrations/qwen3-4b.json`
(2026-05-24, runsAveraged=1, probeVersion 1) says `toolCallDialect:"none"` → arm routed to
text-parse: tool-surface-visible/callable ≠ wire schemas (`toolSchemaNames=[]`), model emits the
prompt-taught `<tool_call> tool: …` markup and nothing parses it (0 tool-call-start, no
report.md, success=false). Live Ollama verifies native FC for qwen3:4b (baseline worked) — the 1-run
stale prior contradicts current evidence, and the text-parse parser doesn't accept the harness's own
taught markup shape. Owners: provider-warden (prior refresh/routing) + kernel-warden (markup-parser
contract). Wave 2's S3 before/after clause therefore FAILS on qwen3:4b: Wave 3+ inherits this row
and must re-capture after the fix.

**Wave-4+ red-on-cut pointer:** the canonical false-success/thrash shape for pattern (e)/(c)/(d) cuts is fixture `01M4SXNTN38VM8ZQ0Q85A7FA3E` (s3-llama3.2 run-4), NOT the qwen S1 rows (which abstain honestly at temp 0 — baseline truth, see S1 termination-mix note).

## Post-#243 gate re-capture (R1, 2026-10-13 13:30–13:40 at HEAD 674b6c4f8, dist rebuilt first)

`fixtures/post-243/` — S3 qwen3:4b re-captured N=5 canonical (+2 bonus batch-A rows; see that dir's
MANIFEST for the CLI-flag-slip note), S2 sanity N=2. Fix under test: floor 354b6aef8 + truthful
priors 674b6c4f8; pre-capture verified `qwen3-4b.json` = `native-fc`, probeVersion 2, runsAveraged 3.

**Three-point S3-qwen34b row (identical arm, temp 0, same extractor defs):**

| metric | PRE-regression (baseline) | REGRESSED (post-w2) | POST-FIX (post-243) |
|---|---|---|---|
| success rate | 5/5 | 0/5 | **5/5** (7/7 incl. bonus) |
| schemas on wire / think-exchange | 4 | **0** | **3** (file-read, file-write, recall) |
| tool-call-start events/run | 3 (read×2, write×1) | 0 | **3 ×7/7** (acted iter 0) |
| report.md written (content truth) | 5/5 (4900 correct) | 0/5 | **5/5, grand total 4900 + 3 sections, 5/5 correct** |
| taught-markup-shipped-unparsed signature | 0/5 | 5/5 | **0/5** |
| tokens/run mean | 6,229 | 2,829 (failed early) | 3,962 (3,706–5,042) |
| thinkingChars/run | (pre-W1 era) | 3.6–14.8K | 6.0–12.1K (retained) |
| classify / skip signals / head-trunc incidents | — | 0/0/0 | 0/0/0 (unchanged) |

S2 sanity (N=2): shapes stable — '3052' 4-char visible answer ×2, 1 think call, thinking retained
8.1–9.7K; wall 77.7/82.6 s = box contention, non-hung. Label churn observed: terminatedBy reverted
`llm_end_turn` (post-w2) → `end_turn` (here) across the W2 fixes — semantics identical, docs truth-up
candidate.

**WAVE-3 GATE: PASS.** The #243 un-brick is live-verified on the exact scenario that regressed:
tool-call execution restored 7/7, deliverable-correct 5/5, all four regression signatures gone, no
new signatures. Wave-2 VERDICT MIXED's headline defect is CLOSED; Wave 3 Stage-B claims may build on
this row. Residual inheritable caveat: S3 falseSuccess heuristic still fires 5/5 (stale terminal
tallies — definition unchanged, raw fields ground truth; pattern-(e) cuts unaffected).

## Post-W3 Stage-B promotion data (W3c, 2026-10-13, HEAD ed6241793, 18 runs)

Shadow-soak + act-mode arms on the two text-dialect models (`REACTIVE_AGENTS_TEXT_PARSE` pinned
per-arm in bench.ts). Full batch table + parser-gap attribution: `fixtures/post-w3/MANIFEST.md`.

| seam | measured | attribution |
|---|---|---|
| shadow coder:14b (N=5) | **would-have-executed 0/5**, 0 shadow signals | model emits taught PARAM LINES but drops both wrapper tags at temp 0 → tier-1 regex (wrapped block) + tiers-2/3 (JSON) all miss; shadow gate (`parsed>0 OR markerPresent`) correctly silent — faithful observation, not lost signal |
| shadow phi4-mini (N=3+3 retry) | **1 clean run: 3 calls parsed tier-1, would-have-executed 3/3 by name** (acted=false, shadow respected); 5/6 attempts hung/llm_error | the transition seam WORKS on a model that follows the taught grammar; caveat: parsed argumentKeys were the taught PLACEHOLDER lines (`<param-name>`) — act would need HealingPipeline repair (unproven, batch D hung) |
| act coder:14b (N=5) | **0/5 executed**, 0/5 anomalies | act branch gated `parsed>0`, nudge gated `markerPresent` — both inert for un-wrapped markup; runs fall through to legacy 1-call end_turn failure (byte-identical designed fallback). **Blocker is teach/parse COVERAGE, not the W3a pipeline** |
| act phi4-mini (N=2) | both hung (480 s guard) | box instability (6/8 phi4 attempts hung/errored this window) — act-vs-shadow discriminator not yet measurable on the one model whose markup parses |

**PROMOTION-READINESS LINE: rung-3 PARTIAL (seam proven observable + parsing 3/3 once on phi4;
act-mode end-to-end execution UNMEASURED — phi4 box-blocked, coder parser-gap-blocked);
rung-2 BLOCKED-NOTED (Anthropic credit). Plan-3.5 rung agreement cannot be declared on this data.
Safety watch: no double-dispatch, no budget bypass, no parse-failure loops across 12 completed runs.**

## Post-W3 rung-2 + refix capture (2026-10-15 — SUPERSEDES the line above)

Rung-2 run on gemini-2.5-flash via GOOGLE_API_KEY (replaces credit-blocked haiku) with new
`REACTIVE_AGENTS_FORCE_TEXT_PARSE=1` mechanism (runner.ts single reader; resolver keyed on the
effective value, no 482c11e4 divergence; pinned in tool-routing-triad.test.ts). Rung-3
re-captured post parser-fix chain. Full tables: `fixtures/post-w3-rung2/MANIFEST.md`,
`fixtures/post-w3-refix/MANIFEST.md`.

| rung | measured |
|---|---|
| rung-2 shadow gemini (N=3) | 0 shadow signals, 0 parsed — model emits `<tool_code>` pseudo-code, never the taught `<tool_use>` (deterministic 3/3 at temp 0); shadow correctly silent |
| rung-2 act gemini (N=3) | parsed 0/3, legacy fallback, honest failure — nothing to act on |
| rung-3 shadow coder (N=3) | **parsed 3/3, would-execute 3/3** (was 0/5) — parser coverage FIXED |
| rung-3 act coder (N=5) | parsed 0/5 — model used NATIVE FC instead (6 calls/run); finals honestly failed on empty report (model quality) |
| rung-3 act phi4 (N=1) | hung — box-instability finding persists |

**PROMOTION RECOMMENDATION (controller): DO NOT PROMOTE to default act-mode.**
Parser coverage is fixed and measured, safety watch holds across 17 new runs,
but no run on any model has completed a text-parse execution end to end
(gemini ignores the grammar, coder prefers native FC, phi4 hangs). Keep
default-off with explicit opt-in (`REACTIVE_AGENTS_TEXT_PARSE=act`); the
value of act-mode is for genuinely no-FC situations, which remain unproven.
The taught-grammar compliance finding (≈zero voluntary compliance even on a
frontier model) argues against chasing model-invented dialects (`<tool_code>`).

## Post-W4 close capture (2026-10-13, HEAD 482cbef47, 11 live runs + deterministic detection lane)

Rows/details: `fixtures/post-w4/MANIFEST.md` + `detection-results.jsonl` + `post-w4-metrics.jsonl`.

**WAVE-4 VERDICT (per seam, measured facts):**

1. **DETECTION: PASS** (fixture-replay, no live thrash claimed). Frozen thrash fixture
   `01M4SXNTN38…`: 146/146 non-progress/meta-tool arbiter classifications, loop detector trips
   ((c)/(d)), pattern-(e) precondition (delta=0 ∧ outstanding>0) on every assessment; FP guard
   fully green on a substantive fixture (classify→substantive, loop silent, flail signature does
   not arm). Upstream pins 22/22 pass. Band rule live-verified: green→economize demotion appears
   in 9/9 live stall runs' assessment streams (impossible-task shapes) and in S1 no-regression rows.
2. **EFFICIENT TERMINATION: PARTIAL — honesty sub-claim FAILS on the tools-layer config.**
   Impossible-task (builtins:false, qwen3:4b, N=3): early-stop ships iter 3–4 (vs baseline 6),
   wall 17.0 s vs 26.8 s (−37%); but llmCalls mean 7.3 / tokens 2,704 did NOT reproduce the
   controller's ad-hoc 2-iter/842-tok shape, and **3/3 runs shipped FABRICATED completion claims
   with verdict success=true** (0 tool calls, 0 evidence). Plain S1 (no tools layer) still abstains
   honestly 3/3 — so the fabrication path is specific to the tools-layer early-stop synthesis.
   Inverse of GH #245 (guard silent on actual fabrication) — file-ready, packages/** untouched.
   Wave 4's "terminate efficiently WITH honest abstain" claim must NOT be closed on this capture.
3. **NO-REGRESSION: PASS with two attributed changes.** S1 shape stable (0/5-band, honest abstain
   3/3) with classify 1→0/run (llmCalls 7→6, W4 lane — recorded not assumed); S2 reasoning answers
   3/3 success, terse, thinking retained 5.2–6.4K, GH #245 guard caused no observed FP; S3 N=2
   mixed (run1 honest failure with 68K-ch thinking ramble, run2 success + correct report.md 4900) —
   temp-0 variance, insufficient rows to call drift.
4. **TAIL-BLOAT GUARD (4.4): NO measurable bloat.** S1 tokensIn 1,375→1,275 (−7%), S2 +4%
   (noise-band); tail tokens not separately extractable (named MEASUREMENT GAP — per-section token
   attribution), S3 row contaminated by run1 early-failure (N=2). Cap-8 recitation consistent with
   flat input columns; the classify-drop removes one call's worth, net position non-worse.

**Wave-4 close status: detection + band + tail-cost seams land; the termination seam ships a live
false-success regression (3/3) on the impossible-task+tools-layer shape and is recorded OPEN —
controller decision needed before Wave 4 is marked verified.**

> **PROGRAM-WIDE TRUTH-UP (integrity, W4 close capture):** the "temperature 0" label on every
> baseline/post-* row is aspirational — bench commanded 0, but `llm-exchange.temperature` records
> the provider default on the wire: **0.5 through post-w1-fix, 0.3 from post-w2 onward**
> (crossover within Wave 2's provider changes). Rows remain comparable within each era; the
> recurring temp-0 sampling variance were downstream artifacts of non-zero decoding. Threading fix
> is provider-warden scope (no packages/** edit made here). Details: `fixtures/post-w4/MANIFEST.md`
> disclosure 1.

## WAVE-4 VERDICT RE-RUN at TRUE temp 0 (post-w4-fixed, 2026-10-13; fixes 129fc70be + db7c5e985)

First capture where the commanded temperature actually reaches the wire: **substrate PROVEN —
every llm-exchange across all 9 new traces records temperature=0.** Rows: `fixtures/post-w4-fixed/`.

* **HONESTY: PASS 5/5** on the exact config that minted 3/3 fabricated successes (impossible-task
  + `withTools({builtins:false})`, qwen3:4b). All 5 terminate runs (canonical 3 + probe 2):
  verdict **false / abstained** (was success:true ×3), band green→economize by iter 1–3, 7 calls,
  recall×2 meta only, early-stop at iter 3, tokens mean 2,467 (2,364–3,222), wall 16.1–17.4 s.
  Gate does NOT over-block: grounded S2 runs still succeed 2/2 ('3052' terse).
  **Residual (file-ready, Wave-5/#245-adjacent, unfixed):** abstained runs' OUTPUT TEXT still
  ships the model's "successfully sent…" claim (one credits the `recall` meta-tool). Verdict-level
  honesty achieved; content-claim scrubbing not in the gate's scope.
* **ERA:** terminate numbers barely moved 0.3-era→true-0 (2,704→2,467 tok, −9%; calls/wall equal)
  — the verdict flip is attributable to the honesty GATE, not temperature. NEW at true-0: **shape
  determinism** (5/5 terminate runs identical; S1 pair and S2 pair identical) — the program's
  chronic "sampling variance" was decoding-temp variance all along.
* **NO-REGRESSION at true-0: HOLDS.** S1 2/2 honest refusals ("I cannot directly send…", 6 calls,
  classify 0, honest output); S2 2/2 terse successes.

**WAVE-4 VERDICT (final, true-0 era): detection PASS · termination honesty PASS at verdict level
(content-claim residual filed for Wave 5) · no-regression PASS · tail-cost CLEAN.** Wave 4 is
markable VERIFIED on the verdict-level gate with the residual named. Baseline-era rows keep their
era labels (0.5/0.3); only `post-w4-fixed/**` is true-0.

## POST-W567 capture — Waves 5+6+7 live verdict (2026-10-15, second true-0 capture)

Fixtures: `fixtures/post-w567/` (MANIFEST + `post-w567-metrics.jsonl` 11 live rows +
`w567-spots.jsonl` 5 spots). Dist rebuilt first; substrate PROVEN (temp 0 on every
llm-exchange of all 11 live traces).

**WAVE-5 VERDICT: PASS (honesty), with one filed under-claim observation.**
0/11 fabricated successes: S1 3/3 honest abstain (6 calls, classify 0, tok 2,383,
shape-identical); S2 3/3 terse '3052' successes (grounded, gate does not over-block);
terminate 3/3 honest abstain (7 calls, recall-meta only). S3 N=2: r1 model-side no-act
degenerate failure (honest); r2 correct-report-on-disk yet verdict failure —
final-answer success=false on stale read-requirement tallies (ledger: report.md +
file-write satisfied; sales-q1/q2 stay `declared` despite successful reads).
Direction is under-claim (safe side); cross-era success 0/2 vs post-243 5/5 is NOT
claimed as a Wave-5 regression (N=2; S3 never captured at true-0 before; model
variance and coverage-strictness not separated). S3 false-success seam: inspected
per-run — no success-with-outstanding verdict anywhere.

**WAVE-6 VERDICT: PASS (spots).** Gateway refusal shape: gated tool executed 0×;
guardrail screen: clean passes, 0 violations (PII-fail arm suite-covered, skipped
live per plan); killswitch e2e: `timeout-after:50ms` terminal, 386 ms wall.
(All scripted-provider, live harness execution; spot traces carry the script
default temp 0.7 — disclosed, not a threading issue.)

**WAVE-7 VERDICT: PASS with one recorded non-gating gap.** Tier-1 checks present
on the terminal event (entropy + NLI among 12, verdict untouched). Shadow sampling:
0 JudgmentShadow events on the builder-run shape — structural (only site lives
behind InteractionService.shouldAutoApprove, unwired by the builder), auto-shadow
probe + emission + sink proven by suites (8/8 green on this box). Live end-to-end
shadow observation still open; wave not gated on it per plan.

**NO-REGRESSION vs post-w4-fixed: HOLDS** on all in-era arms (S1/S2/terminate
shape-identical; S3 has no in-era baseline).
