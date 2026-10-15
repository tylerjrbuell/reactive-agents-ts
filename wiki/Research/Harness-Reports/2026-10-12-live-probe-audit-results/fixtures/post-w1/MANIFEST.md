# post-w1 — first LIFT measurement after Wave 1 (W1.5, 2026-10-13)

Captured with `scripts/lift/bench.ts` (gained `--out`/`--n` flags + additive
forensics fields: `thinkingCharsSum`, `thinkingExchangeCount`, `maxThinkContentChars`,
`traceBytes`) at HEAD a44952626, after rebuilding `packages/**` dist (the checked-out
dist predated eb0f42a0c; capture would otherwise have measured a mixed provider/kernel state).
`REACTIVE-AGENTS` baseline root files untouched — traces + `post-w1-metrics.jsonl` land here.

## Rows (scenario | arm | model | runId | date | signature counts)

| scenario | arm | model | runId | date (UTC) | measurements |
|---|---|---|---|---|---|
| S2 | s2-qwen34b | qwen3:4b | 01M4T3HP0GT5T5BGSCTS1XP0BJ | 2026-10-13 07:45 | success/end_turn; content '3052' (4ch); thinkingChars 9459 (1/1 exchanges); tokensOut 2866; tok 3176; trace 9720 B; **OUTPUT REGRESSION: 1915-chars of raw reasoning tail replaced '3052'** |
| S2 | s2-qwen34b | qwen3:4b | 01M4T3J97KXCTT67MEM9WN9PZ5 | 2026-10-13 07:45 | same shape; thinkingChars 7798; OUTPUT 1025 ch reasoning tail |
| S2 | s2-qwen34b | qwen3:4b | 01M4T3JRKNFXK8SQF40NQPRSN4 | 2026-10-13 07:45 | same shape; thinkingChars 9171; OUTPUT 538 ch |
| S2 | s2-qwen34b | qwen3:4b | 01M4T3K9BG85ZAF4T5FNQJ8PHZ | 2026-10-13 07:46 | same shape; thinkingChars 7689; OUTPUT 690 ch |
| S2 | s2-qwen34b | qwen3:4b | 01M4T3KQQAAQ5GK1BFZG5X35K9 | 2026-10-13 07:46 | same shape; thinkingChars 6019; OUTPUT 525 ch (contains 'answer is 3052' inside prose) |
| S1 | s1-qwen34b | qwen3:4b | 01M4T3MW3FXV5EFFGJ96MFDHCQ | 2026-10-13 07:47 | DRIFT GUARD — no drift: abstained/failure, 7 calls (6 think + 1 classify), evidenceDelta all-zero, loop_resolution terminate, falseSuccess 0; thinkingChars 18333 across 7 exchanges; tok 3322; trace 31985 B |
| S1 | s1-qwen34b | qwen3:4b | 01M4T3NRVDAV2B12SXKG2Q8MF9 | 2026-10-13 07:48 | same shape (thinkingChars 17217; tok 3203; trace 30243 B) |

## Trace-size delta (trace JSONL bytes/run; the ~2.6K step-metadata claim is NOT observable in
traces — W1.4 caps `thinkingPreview` at PREVIEW_MAX=240 ch/exchange, full reasoning never rides the trace)

| arm | baseline mean | post-W1 mean | delta |
|---|---|---|---|
| s2-qwen34b | 7,051 B | 8,754 B | **+24%** (+1,703 B/run — 1×240 ch preview + forensics fields) |
| s1-qwen34b | 28,977 B | 31,114 B | **+7%** (+2,137 B/run — 7×240 ch previews + fields) |

Redaction disclosure (same protocol as baseline): model-fabricated dummy Slack token
(`xoxp-YourSlackTokenHere`) replaced with `REDACTED-FABRICATED-SLACK-TOKEN` in
`01M4T3MW3FXV5EFFGJ96MFDHCQ.jsonl` (1 occurrence, response content) — the recorded
`traceBytes` for that run predates the +8-byte widening; size table unaffected at the
mean level.

## Cut-test citation

Sever-local-`thinking_delta`-emission → consumption tests red: executed by kernel-warden W1.3,
recorded in commit eb0f42a0c ("severing the wiring turns the rescue arms red") and
`wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md` (W1.3-1.4 dispatch, 7c48eb3f5).
Not re-run here (per brief).

## DEFECT observed (file-ready, NOT fixed — zero packages/** edits)

**thinking-rescue overrides concise correct final answers.** `think.ts:1362`
(`thought.trim().length < 50 && thinking && thinking.length > 100` → `rescueFromThinking`) +
`stream-parser.ts:246-249` branch 4 (last 1-2 substantive paragraphs of thinking) fires on EVERY
task spec that requests a terse answer: post-W1 S2 5/5 runs shipped 525–1915 chars of raw
internal-reasoning prose as `run-completed.output` while the model's actual visible answer was
`'3052'` (llm-exchange content_len 4; same '3052' on all 10 baseline+post runs — model behavior
identical, only harness output selection changed). Pre-W1 the same guard never fired because
`thinking` was null (channel dropped upstream) — W1 didn't introduce the heuristic; it supplied
the input that makes it fire on correct terse answers.
(Checked + ruled out thinking re-injection into next-turn message context on S1 post traces:
the recorded thinkingPreview prefix appears in 0 subsequent exchanges' messages.)
Suggested fix owner: kernel-warden (rescue must not fire when cleanContent is non-empty and
passes the FA-shape/verdict check; or branch 4 must not replace an explicit answer).
