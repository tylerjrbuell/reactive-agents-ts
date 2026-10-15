# post-w2 — Wave-2 close capture (2026-10-13 12:33–12:39 UTC)

Captured at HEAD 471d7ed8d (all W2 seams: 2.1–2.7) with dist rebuilt first. Same bench.ts arms,
same prompts, temp 0, same extractor definitions. Baseline / post-w1 / post-w1-fix dirs untouched.
Arms ran at registry N=5 (S3 pairs captured N=5, exceeding the N=3 spec — extra variance rows kept).

## Rows

| scenario | arm | model | runId | date (UTC) | measurements |
|---|---|---|---|---|---|
| S1 | s1-qwen34b | qwen3:4b | 01M4TM1AFKD5A1SSG7Y1S01G1B | 12:33 | no-drift shape (abstained/failure, 7 calls, 1 classify, evidenceDelta all-zero, loop_resolution terminate); tok 2725; thinkingChars 15823; trace 29351 B; 24.4 s |
| S1 | s1-qwen34b | qwen3:4b | 01M4TM22AYK6K9DFMWTWAHC43H | 12:33 | same; tok 1859 |
| S1 | s1-qwen34b | qwen3:4b | 01M4TM2RR9QM3T0RK99N4VTRXB | 12:34 | same; tok 2344 |
| S1 | s1-qwen34b | qwen3:4b | 01M4TM3BER33MECYR69V1Z5E50 | 12:34 | same; tok 2012 |
| S1 | s1-qwen34b | qwen3:4b | 01M4TM3XACW9H03E1VY3SXD0QJ | 12:34 | same; tok 2849 |
| S2 | s2-qwen34b | qwen3:4b | 01M4TM4JQB3P8S39SXRCBBXZ4Y | 12:35 | success, output '3052' (quality intact), 1 call, thinkingChars 4090; tok 1737; terminatedBy label now **llm_end_turn** (was end_turn) |
| S2 | s2-qwen34b | qwen3:4b | 01M4TM4TS1AH8MYJ3YANB7576Y | 12:35 | same; thinkingChars 8385; tok 3210 |
| S2 | s2-qwen34b | qwen3:4b | 01M4TM5BWE3EHG37KYD88MJ9NP | 12:35 | same; tok 1908 |
| S2 | s2-qwen34b | qwen3:4b | 01M4TM5MZFX5DQ1TN1ZA9CPHGN | 12:35 | same; tok 2982 |
| S2 | s2-qwen34b | qwen3:4b | 01M4TM64MNBAXXN7QHW8BT45EJ | 12:36 | same; tok 1973 |
| S3 | s3-qwen34b | qwen3:4b | 01M4TM6E1J0JMKS3C5B3WQFCC7 | 12:37 | **DEFECT ARM (see below)**: success FALSE, 0 tool calls, wire schemas=[], text-mode markup emitted un-parsed; 1 head-truncation-guard signal (dropped none, stillOverflowing, ceiling reported 32768); tok 3899; 117.9 s |
| S3 | s3-qwen34b | qwen3:4b | 01M4TMA17QGSE3HVRKHCTE6Y0S | 12:38 | same defect shape; tok 2558 |
| S3 | s3-qwen34b | qwen3:4b | 01M4TMADVN3G6HYDQJK7T25JHP | 12:38 | same; tok 1302 |
| S3 | s3-qwen34b | qwen3:4b | 01M4TMAJZ9HDXK7S17YB6SA49G | 12:38 | same; tok 4052 |
| S3 | s3-qwen34b | qwen3:4b | 01M4TMB90AQ14M9C9VBK0YM74G | 12:38 | same; tok 2334 |
| S3 | s3-llama32 | llama3.2:latest | 01M4TMBM8M7GVJ0FPNAMTZXQ7G | 12:38 | success, 3 calls, native FC kept (schemas=[file-read,file-write]), acted iter 0; **no discover-tools thrash**; report.md totals WRONG (Grand Total 4000 vs 4900); tok 1730; tokensIn/req ~516 (baseline ~1084) |
| S3 | s3-llama32 | llama3.2:latest | 01M4TMBPYRH9C7343F418FP1EE | 12:38 | same; report Grand Total 4000 (wrong) |
| S3 | s3-llama32 | llama3.2:latest | 01M4TMBR2YK7HM4DTJ6NGTQXF5 | 12:38 | same; report invents Products A/B/C (wrong products, sum coincidentally 6400) |
| S3 | s3-llama32 | llama3.2:latest | 01M4TMBSKXHTZSNTXKCFRTM2SY | 12:38 | success verdict but report.md = empty 3-heading skeleton |
| S3 | s3-llama32 | llama3.2:latest | 01M4TMBTP0JCWEVVKXRZ3HXG3N | 12:38 | success verdict, report skeleton; 2 calls |

## Wave-2 signal counts (rax-diagnose-visible)

- head-truncation-guard harness signals: **1** (s3-qwen34b r1; metadata: correctedTokensBefore=483,
  numCtx=32768 — arm pinned wire num_ctx=8192, ceiling resolution did not read the request override:
  file-ready observation), dropped none, stillOverflowing → shipped; system prompt head INTACT in
  20/20 runs (no `systemPromptTruncated`, sp lens stable per arm) → **head-truncation incidents 0** ✓.
- classifier-skip signals (`strategy-switch/classifier-skip`): **0/20** — both capture models carry
  classifierReliability=high (prior+local, bench calibration lines: qwen3:4b 53–67 samples,
  llama3.2 5–9 samples), so W2d skip correctly never fires → llmCalls/run classify stays 1/run on
  S1 arms (delta 0, pre-authorized honest outcome).
- W2d local schema compaction NOT exercised live: qwen3:4b + llama3.2:latest both resolve tier=mid
  (regex fallback; Capability registry on this box holds only probe/test fixture rows, no entries
  for these models) → full-detail payloads. llama tokensIn/req −51% is schema-count 3→2
  (discover-tools no longer base-visible) + history/tool-result shape, not the names-and-types seam.
  The >=3x reduction stays unit-proven only (`d5ecf6b77` shrink pin).

## DEFECT (file-ready, NOT fixed — zero packages/** edits)

**qwen3:4b S3 arm regressed 5/5 success (baseline) → 0/5.** Cause chain: W2a (57b6836a) derives
`supportsToolCalling` from the template probe instead of constant-true; the shipped prior
`packages/llm-provider/src/calibrations/qwen3-4b.json` (calibrated 2026-05-24, **runsAveraged: 1**,
probeVersion 1) carries `toolCallDialect: "none"` → routing lands on the text-parse path. Evidence:
tool-surface-resolved shows callable=[file-read, file-write, recall] but llm-exchange
`toolSchemaNames=[]` on every request; system prompt switches to text-mode tool instructions
(sp_len 1446 vs llama 636); model emits the taught markup `<tool_call>\ntool: file-read\npath:
sales-q1.txt\n…` and NOTHING parses it (0 tool-calls-start events, no report.md written,
success=false, outstanding=5). Ollama live-verifies native FC for qwen3:4b (baseline worked), so the
"none" classification is a stale/1-run artifact contradicting live evidence; and the text-parse
parser does not accept the harness's own taught markup shape (YAML-ish lines, not JSON fences) —
either half alone would still ship broken. Owner: provider-warden (prior/routing) + kernel-warden
(markup parser/prompt contract). Also affects the S4 story (Wave 2 accidentally pushed qwen3:4b into
the S4 defect class it was built to measure).
