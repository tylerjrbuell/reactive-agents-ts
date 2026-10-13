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

**Wave-4+ red-on-cut pointer:** the canonical false-success/thrash shape for pattern (e)/(c)/(d) cuts is fixture `01M4SXNTN38VM8ZQ0Q85A7FA3E` (s3-llama3.2 run-4), NOT the qwen S1 rows (which abstain honestly at temp 0 — baseline truth, see S1 termination-mix note).
