# post-w1-fix — W1.5 RE-CAPTURE against the fixed kernel (2026-10-13)

Mission: settle the Wave 1 verdict. Captured at HEAD 406e7b62 (kernel fix af7d1b45f
`fix(reasoning): gate thinking-rescue prose fallback over terse visible answers`),
dist rebuilt first (reasoning dist 04:14 > commit 04:06). Same bench.ts arms, same task
prompts, same extractor definitions, temp 0. Baseline + post-w1 directories untouched.

## Rows (scenario | arm | model | runId | date | signature counts)

| scenario | arm | model | runId | date (UTC) | measurements |
|---|---|---|---|---|---|
| S2 | s2-qwen34b | qwen3:4b | 01M4T57QRFVRY8GFM31YHK1YZE | 2026-10-13 07:59 | DEFECT ELIMINATED: output '3052' (4 ch, == visible content, stop end_turn); reasoning-tail 0; marker-clobber 0; thinkingChars 8889 retained; tok 3120; trace 7325 B; 19.3 s |
| S2 | s2-qwen34b | qwen3:4b | 01M4T58ANX0X8JTXA1SYMK9PTM | 2026-10-13 08:00 | output '3052'; thinkingChars 7356; tok 2640; 7328 B; 14.2 s |
| S2 | s2-qwen34b | qwen3:4b | 01M4T58RJTWCJ835PXYGJA0D46 | 2026-10-13 08:00 | output '3052'; thinkingChars 10762; tok 3624; 7337 B; 20.5 s |
| S2 | s2-qwen34b | qwen3:4b | 01M4T59CNS50A3DYNSBVYB8HD2 | 2026-10-13 08:00 | output '3052'; thinkingChars 6696; tok 2482; 7343 B; 13.2 s |
| S2 | s2-qwen34b | qwen3:4b | 01M4T59SKZY7R14MQ40RF6HMSE | 2026-10-13 08:00 | output '3052'; thinkingChars 7254; tok 2627; 7343 B; 14.1 s |
| S1 | s1-qwen34b | qwen3:4b | 01M4T5B6F9QENWR06H6VD3WG20 | 2026-10-13 08:02 | DRIFT GUARD no drift: abstained/failure, 7 calls (6 think + 1 classify), evidenceDelta all-zero, loop_resolution ×1, falseSuccess 0; thinkingChars 19282; tok 2681; 31066 B*; 30.5 s |
| S1 | s1-qwen34b | qwen3:4b | 01M4T5C49YRV7NCQ4VJE29RA2W | 2026-10-13 08:03 | same shape; thinkingChars 18335; tok 2436; 30609 B; 29.4 s |

\* traceBytes recorded pre-redaction (see hygiene note).

## Marker-clobber count (per kernel review item; FA / ACTION / code-fence shapes in run-completed.output)

S2: **0/5** (all outputs exactly '3052'). S1: not applicable (no rescue-eligible terse terminal).
Rescue branches 1-3 are ungated by the fix — zero live clobber shapes observed, consistent with
the fix's design claim; unit proof lives in `terse-answer-rescue-guard.test.ts` (af7d1b45f, 2 RED
arms at pre-fix HEAD reproducing the live signature, green post-fix, cut-test severing the gate
turns exactly those 2 arms red — kernel-warden's own TDD, cited not re-run).

## PRE / POST / POST-FIX (s2-qwen34b, temp 0, N=5 each)

| metric | PRE (baseline) | POST-W1 (defect) | POST-W1-FIX |
|---|---|---|---|
| output delivered | '3052' ×5 | 525–1,915-ch reasoning tails ×5 | **'3052' ×5** |
| prose-tail signature rate | 0/5 | 5/5 | **0/5** |
| marker-clobber rate | 0/5 | 0/5 | **0/5** |
| thinkingChars/run | 0 (dropped) | 6,019–9,459 | **6,696–10,762** |
| success rate | 5/5 | 5/5 | 5/5 |
| trace bytes mean | 7,051 | 8,754 | 7,355 (forensics kept, prose tail gone) |

## Hygiene notes

- Model-fabricated dummy token (`xoxp-1234…`, sequential digits, 2 occurrences) redacted to
  `REDACTED-FABRICATED-SLACK-TOKEN` in `01M4T5B6F9QENWR06H6VD3WG20.jsonl` for the pre-commit
  secret backstop; recorded traceBytes for that run predates the -10 B net change.
- S1 wall-clock 29–31 s, tokens 2436/2681 — inside baseline band (23.5–31.4 s, 2440–3061). No drift.
