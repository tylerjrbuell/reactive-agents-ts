# post-243 — R1 wave-3 gate re-capture (2026-10-13 13:30–13:40 UTC)

Proves the GH #243 un-brick (fix floor 354b6aef8 + truthful priors 674b6c4f8) on the EXACT
scenario that regressed: S3 qwen3:4b, temp 0, identical bench arm (file-read/file-write builtins,
num_ctx 8192, same task/workspace setup). HEAD 674b6c4f8 + bookkeeping; dist rebuilt first
(llm-provider dist 09:29:54 > fix 09:28:04). Refreshed prior verified pre-capture:
qwen3-4b.json now `toolCallDialect: "native-fc"`, probeVersion 2, runsAveraged 3.

**GATE: PASS — 7/7 runs (5 canonical + 2 bonus), all four regression signatures GONE.**

Note on batches: a bench CLI flag-order slip (`--n` is global, last-wins) made batch A capture
S3 with N=2 instead of 5; batch A rows are kept as bonus evidence (duplicate runIndex 1–2 labels
in post-243-metrics.jsonl — disambiguate by runId/batch). Batch B is the canonical N=5.
Workspaces run1–2 were re-used by batch B (report.md content = batch B final state).

## Rows

| batch | runId | date (UTC) | schemas/think-exch | tool-call-start | text-mode | markup-unparsed | verdict line |
|---|---|---|---|---|---|---|---|
| A1 | 01M4TQA010DT8RFF8WDQMGHENX | 13:30 | [3,3,3] | 3 (file-read ×2, file-write ×1) | 0 | 0 | success, acted iter 0, tok 3706, thinking 6414 |
| A2 | 01M4TQADYGWSFC3S9SSG5FKRGR | 13:30 | [3,3,3] | 3 | 0 | 0 | success, acted iter 0, tok 5042 |
| B1 | 01M4TQGTFWX46SX7W2BAKCSC82 | 13:36 | [3,3,3] | 3 | 0 | 0 | success, acted iter 0, tok 3735, thinking 6518 |
| B2 | 01M4TQH83JZXG4857MPY3MDHN4 | 13:37 | [3,3,3] | 3 | 0 | 0 | success, acted iter 0, tok 3902 |
| B3 | 01M4TQHMH7F2VS0SXPCG3RK828 | 13:37 | [3,3,3] | 3 | 0 | 0 | success, acted iter 0, tok 4481 |
| B4 | 01M4TQJ4BDPWFBJVH35X8QMP30 | 13:38 | [3,3,3] | 3 | 0 | 0 | success, acted iter 0, tok 3733 |
| B5 | 01M4TQJFWW377T8QEW7BB2NAXJ | 13:39 | [3,3,3] | 3 | 0 | 0 | success, acted iter 0, tok 3948 |

Deliverable truth: **5/5 report.md written, all with correct grand total 4900 + all 3 sections**
(post-w2: 0/5 written). S3 runs 11.7–21.3 s wall, ~12 s typical.

## S2 sanity drift check (N=2)

| runId | date | result |
|---|---|---|
| 01M4TQB2VR7M029CX2P5HDH5ME | 13:32 | success, visible answer '3052' (4 ch), 1 think call, thinkingChars 8076 retained, falseSuccess heuristic flag (stale-tally shape, unchanged definition) |
| 01M4TQDES80A5TQB38FK896MYR | 13:33 | same shape, thinkingChars 9671 |

Shapes stable. Note: terminatedBy label reverted `llm_end_turn` (post-w2) → `end_turn` (here) —
label churn across W2 fixes, semantics identical. Wall clock 77.7 s & 82.6 s (vs 8–20 s at
post-w2): box contention during window (transient EOF noted by controller); non-hung, kept.

## Verdict

PRE-regression 5/5 (baseline) → REGRESSED 0/5 (post-w2) → POST-FIX **7/7 success, tool execution
restored, deliverable-correct 5/5** — **GATE PASS**. The #243 un-brick is live-verified on the
exact failing scenario; Wave 3 Stage-B may proceed on this row.
