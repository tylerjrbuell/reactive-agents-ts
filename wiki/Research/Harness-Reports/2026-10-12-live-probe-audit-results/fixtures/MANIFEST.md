# MANIFEST — rung-0 baseline fixtures (Task 0, 2026-10-13)

Schema per plan: `scenario | model | runId | date | defect signature counts`.
One line per captured run. Full per-run metric rows (assessments, guard fires,
token sums, rates) live in `baseline-metrics.jsonl` (one JSON object per run,
same order as this table). The trace JSONL for each run is committed here as
`<runId>.jsonl`. Regeneration + naming: see `README.md` in this directory.

Pre-existing tracked fixture `01M4RTC37R52BKE05KGG3YD7E6.jsonl` came with the
2026-10-12 live-probe audit (not Task 0); kept as historical reference.

Redaction disclosure: model-fabricated dummy Slack-style tokens (`xoxb-…`/`xoxp-…`
sequential-digit / "YourSlackTokenHere" strings hallucinated into think-exchange
response content — not real credentials) were replaced with
`REDACTED-FABRICATED-SLACK-TOKEN` in 3 traces (s1-qwen34b runs 1, 2, 4; 1 occurrence
each, response content only) to pass the repo's pre-commit secret backstop. The S1
replay gate was re-run after redaction and still PASSES byte-identical. No metric
field changed.

## Captured runs

| scenario | arm | model | runId | date (UTC) | defect signature counts |
|---|---|---|---|---|---|
| S1 | s1-qwen34b-1 | qwen3:4b | 01M4SX78BT4RB543SWFP5F4DXS | 2026-10-13 05:54 | evidenceDelta=0 ×3 assessments (band green, outstanding=1); tool-calls 0; loop_resolution terminate ×1; terminated abstained/failure; llm-calls 7 (6 think + 1 classify); tok 2440 |
| S1 | s1-qwen34b-2 | qwen3:4b | 01M4SX82PAM7TB6HC4A72V6ARG | 2026-10-13 05:55 | same shape; tok 3061 |
| S1 | s1-qwen34b-3 | qwen3:4b | 01M4SX8XK4VEJ8STS8AK8FASJV | 2026-10-13 05:55 | same shape; tok 2803 |
| S1 | s1-qwen34b-4 | qwen3:4b | 01M4SX9WA8BS27CJ2NJSZ8Y8JB | 2026-10-13 05:56 | same shape; tok 2456 |
| S1 | s1-qwen34b-5 | qwen3:4b | 01M4SXAM740NGEBZY2MSDDVYGY | 2026-10-13 05:56 | same shape; tok 2632 |

| S2 | arm | model | runId | date (UTC) | defect signature counts |
|---|---|---|---|---|---|
| S2 | s2-qwen34b-1 | qwen3:4b | 01M4SXDMMFFVA5T276CPX0CP7E | 2026-10-13 05:58 | thinking-starve CONFIRMED: 1 think call, visible content 4 chars vs tokensOut 2310 (thinking dropped by stream path, finding #2 live); evidenceDelta=0 ×1 (green, outstanding=1); success/end_turn; tok 2620; 11–16 s/run |
| S2 | s2-qwen34b-2 | qwen3:4b | 01M4SXE2KEJ8XTR8CBSXZSX534 | 2026-10-13 05:58 | same shape; tokensOut 2097 vs 4-char content; tok 2407 |
| S2 | s2-qwen34b-3 | qwen3:4b | 01M4SXEF5JFNDRKH7W76SRD7T5 | 2026-10-13 05:58 | same shape; tokensOut 2039; tok 2349 |
| S2 | s2-qwen34b-4 | qwen3:4b | 01M4SXEVD11W10E10TSD7SA803 | 2026-10-13 05:58 | same shape; tokensOut 1822; tok 2132 |
| S2 | s2-qwen34b-5 | qwen3:4b | 01M4SXF686YDYABPZHK1WY8P5Y | 2026-10-13 05:59 | same shape; tokensOut 2592; tok 2902 |

| S3 | arm | model | runId | date (UTC) | defect signature counts |
|---|---|---|---|---|---|
| S3 | s3-qwen34b-1 | qwen3:4b | 01M4SXHNXFB819HZRFFRX796X3 | 2026-10-13 06:00 | acted iter 0 (file-read ×2, file-write ×1, report.md correct: 3 sections, grand total 4900) BUT final assessment stale: outstanding=3, deliverablesMissing=2 → false-success shape (success/end_turn); evidenceDelta 0,0,2,2,1; 4 schema names/call; tok 5401 |
| S3 | s3-qwen34b-2 | qwen3:4b | 01M4SXJ2SD3H89T58TFKKNPCKA | 2026-10-13 06:00 | same shape; tok 5394; 9.4 s |
| S3 | s3-qwen34b-3 | qwen3:4b | 01M4SXJC1EHDE316DVX9FQZA66 | 2026-10-13 06:00 | same shape; tok 5987 |
| S3 | s3-qwen34b-4 | qwen3:4b | 01M4SXJRWNNRGXHQMTSM77V5XY | 2026-10-13 06:00 | same shape; tok 5697 |
| S3 | s3-qwen34b-5 | qwen3:4b | 01M4SXK41TDE04VA7W5RTNT5AV | 2026-10-13 06:01 | same shape; tok 8468 (tokensOut 4598 — thinking-heavy tail); 28.7 s |

| S3 | arm | model | runId | date (UTC) | defect signature counts |
|---|---|---|---|---|---|
| S3 | s3-llama32-1 | llama3.2:latest | 01M4SXNJCHS46D162H9F9S1N4B | 2026-10-13 06:02 | acted iter 0 (discover-tools ×2, file-read ×2, file-write ×2); stale final tally (outstanding=3/missing=2) + success → false-success shape; tok 3615; 3.6 s |
| S3 | s3-llama32-2 | llama3.2:latest | 01M4SXNNXX3JE1BFV0EQJDBYAR | 2026-10-13 06:02 | same shape; discover-tools ×4 + file-write ×2, NO file-read (wrote without reading inputs); tok 3486; 2.1 s |
| S3 | s3-llama32-3 | llama3.2:latest | 01M4SXNR1YZHCJE6PQ8ZRP5B2X | 2026-10-13 06:02 | same stale-tally shape; 11 tool calls (file-write ×5); tok 3960; 2.6 s |
| S3 | s3-llama32-4 | llama3.2:latest | 01M4SXNTN38VM8ZQ0Q85A7FA3E | 2026-10-13 06:02 | **THASH ARM**: discover-tools ×146 varied-args, evidenceDelta=0 every assessment, stall_deliverable terminate, terminatedBy harness_deliverable with success verdict + outstanding=5/missing=3 → canonical false-success signature reproduced at temp 0; tok 7560; 12.8 s |
| S3 | s3-llama32-5 | llama3.2:latest | 01M4SXP779DC2G3Y1YQMB7WF7J | 2026-10-13 06:02 | same stale-tally shape; tok 3266; 1.8 s |

| S1 | arm | model | runId | date (UTC) | defect signature counts |
|---|---|---|---|---|---|
| S1 | s1-qwen35-1 | qwen3.5:latest | 01M4SXQK8SAP1VN785S2BCFXDE | 2026-10-13 06:05 | evidenceDelta=0 ×3 (green, outstanding=1); tool-calls 0; loop_resolution terminate; abstained/failure; llm-calls 7 (6 think + 1 classify); tok 3630; 113.0 s (cold-load) |
| S1 | s1-qwen35-2 | qwen3.5:latest | 01M4SXV1N095EJN076E8GYSQ3P | 2026-10-13 06:07 | same shape; tok 4573; 148.2 s |
| S1 | s1-qwen35-3 | qwen3.5:latest | 01M4SXZJEHYNQZNQ4A5YW9HTG6 | 2026-10-13 06:09 | same shape; tok 2591; 89.8 s |
| S1 | s1-qwen35-4 | qwen3.5:latest | 01M4SY2A5ZE5EKF001P576221P | 2026-10-13 06:09 | same stall shape but EARLY-STOP variant: low_delta_guard terminate at iter 3, 3 llm-calls, no classify; tok 1884; 30.3 s |
| S1 | s1-qwen35-5 | qwen3.5:latest | 01M4SY37WDS2JN8RQYCXB5SABK | 2026-10-13 06:11 | abstained/failure again; tok 2892; 116.8 s |

| S4 | arm | model | runId | date (UTC) | defect signature counts |
|---|---|---|---|---|---|
| S4 | s4-phi4mini-1 | phi4-mini-reasoning:latest | 01M4SY7WJ6HVS4V2KX10GW00KH | 2026-10-13 06:14 | NO-FC CONFIRMED: 3 file schemas visible, 0 tool calls; 2 think exchanges burned 13295 tokensOut of visible monologue (content truncated at recorder cap), no tool markup emitted, end_turn with failure verdict (honest, not false-success); outstanding=5/missing=3; tok 11563; 101.6 s |
| S4 | s4-phi4mini-2 | phi4-mini-reasoning:latest | 01M4SYAZVTR33YHEDV5QCQ4PW2 | 2026-10-13 06:15 | same shape; tokensOut 14372; 107.3 s |
| S4 | s4-phi4mini-3 | phi4-mini-reasoning:latest | 01M4SYE8PCFW17Q0JBVWW2VAPN | 2026-10-13 06:16 | same shape; tokensOut 7225; 49.5 s |

Template-probe verdict (S4 model selection, /api/show): phi4-mini-reasoning embeds tool defs in the system prompt (`<\|tool\|>` injection) but its chat template has NO assistant tool-call emission format → none-class arm. llama3.1 + deepseek-r1 templates DO emit tool calls (excluded); gpt-oss template empty (server-side harmony, excluded). Live capture confirms the prediction.

| S1-haiku | haiku-s1-1..3 | claude-haiku-4-5-20251001 | 01M4SYHG6J74ZWFA17513Z4V59, 01M4SYHGXSS471WQ1GK6QFAZZH, 01M4SYHH522REMEW71X1PPZKBB | 2026-10-13 06:17 | **BLOCKER EVIDENCE, not baseline runs**: ra-full-mirror wiring works (built, streamed, recorded) but Anthropic returns 400 "credit balance is too low" at iteration 0 → terminatedBy llm_error. Row marked rung-2 deferred. |
| S3-haiku | haiku-s3-1..3 | claude-haiku-4-5-20251001 | 01M4SYHHBHGME1YWPCQ9C55NAV, 01M4SYHHJ7NE3ZW639VBXSX0M5, 01M4SYHHSN4K6GCP5KCTG0JXWX | 2026-10-13 06:17 | same 400 credit blocker. |

## Post-W1 measurement sets (lift protocol, added 2026-10-13)

Baseline tables above are frozen. Lift measurements live in sibling directories with their own
row files: `post-w1/` (W1.5 first measurement — MIXED, defect surfaced) and `post-w1-fix/`
(W1.5 re-capture at kernel fix af7d1b45f — **FINAL WAVE-1 VERDICT CONFIRMED**; prose-tail 5/5→0/5,
marker-clobber 0/5, thinking retained 5/5, S1 drift clean). PRE/POST/POST-FIX deltas + verdict:
`../../2026-10-12-program-scoreboard.md`.

## Probe rows (unit-style, re-run under final Wave-0 code state)

Full stdout captured at `probes/probe-2-final.txt` + `probes/probe-3-final.txt` (re-run 2026-10-13 under Wave-0-close HEAD):

| probe | measurement | value |
|---|---|---|
| probe-2 thinking-loss | raw Ollama stream chunks carrying thinking (398 chunks, 1229 chars) vs framework StreamEvents carrying a `thinking` field (0 of 4 events) | finding #2 CONFIRMED live: complete() surfaces thinking (len 1289) but the kernel's ONLY path (stream()) drops it — providerThinking rescue dead |
| probe-3 context-math (a) | 12 builtin tool schemas wire payload | 11,838 chars ≈ 3,996 BPE-adjusted tokens = 49% of an 8192 window; descriptions are 80% of payload |
| probe-3 context-math (b) | tier cliff: qwen3:4b, llama3.1:8b, phi4-mini-reasoning classify `mid`; only llama3.2:3b classifies `local` | classification drives the (c) inversion: mid keeps toolResultMaxChars=1200 vs local 4000 |
| S3 live corroboration | schema-tokens/req is a MEASUREMENT GAP in traces (names-only); live S3 runs sent 4 visible schema names (qwen3:4b) / 3 (llama3.2) per think call vs 12 in the probe's full set (builtins opt-in subset + meta) | use probe-3 per-tool char table + `schemaNamesPerCall` in baseline-metrics.jsonl for later-wave estimates |
