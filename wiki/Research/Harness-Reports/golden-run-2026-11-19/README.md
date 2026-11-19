---
type: research
status: current
created: 2026-11-19
tags: [golden-run, docs, receipt, rax-diagnose, tool-surface]
---

# Golden run recapture with a lean tool surface, 2026-11-19

Live captures on HEAD `4afc09f5e` (git `v0.11.1-4419-g4afc09f5e`, VERSION `0.18.0`), model `gemma4:e4b` via Ollama server `0.40.15`, same task and provider as [[golden-run-2026-11-17/README|the 2026-11-17 capture]]. Script: `packages/benchmarks/scripts/capture-golden-run.ts`. Builder chain: `packages/benchmarks/scripts/golden-run-builder.ts` (`goldenBuilderLines()`), also stored in each run.json under `capture.builderLines`.

## What changed

One line of the builder chain, in `golden-run-builder.ts` STEPS (so the snippet shown on the docs home page changes with it):

```diff
-  .withTools({ builtins: true })
+  .withTools({ builtins: ["file-write", "web-search"] })
```

This matches `scratch.ts`. Everything else the docs explain stays: `.withReasoning()`, `.withObservability()`, `.withThinking(true)`, `.withMemory()` (debrief synthesis is memory-gated) and `.withReceiptSigning({ privateKeyJwk })`. The [[2026-11-18-extra-iterations/README|extra-iterations report]] shows none of them costs a turn. `.withMemory()` costs one post-run LLM call (memory extraction). It is not a turn, it took 2.9 s in the chosen run, and it powers the debrief section, so it stays.

The model now sees 3 tool schemas per turn instead of 10: `web-search`, `file-write`, and `recall`. The kernel injects `recall` as a meta-tool, and it was never called. The harness between the two captures also changed (today's repetition, replay and recall fixes, and the `metadata.iterations` fix from the extra-iterations report). The comparison below is therefore old harness plus all builtins versus new harness plus a lean tool set. It is not a single-variable ablation.

## Old vs new (chosen runs)

| | 2026-11-17 (`builtins: true`) | 2026-11-19 (lean) |
| --- | --- | --- |
| runId | `01M7NS4FTY0NGVE1G1AF4D4GY1` | `01M7T6207HZS3HFRQTSB41G4B7` |
| success / verdict | true / `tool-grounded`, verifier `pass` | true / `tool-grounded`, verifier `pass` |
| wall time | 56,566 ms | **14,130 ms** |
| `metadata.iterations` (displayed) | 10 | **4** |
| kernel think turns | 4 | 4 |
| `stepsCount` / `llmCalls` | 10 / 5 | 10 / 5 |
| tool calls | web-search, file-write, file-write (3 ok) | web-search, file-write, file-write (3 ok) |
| tool schemas per turn | 10 | 3 |
| tokens (in / out) | 9,316 (5,421 / 3,895) | **7,137 (4,138 / 2,999)** |
| turn-0 input tokens | 727 | 361 |
| memory extraction call | 17.8 s | 2.9 s |
| deliverables | report.md, data.json | report.md, data.json |
| `rax-diagnose cause` | `cause=none status=success` | `cause=none status=success` |
| receipt signature | ed25519 | ed25519 |

Failed variant (same agent plus `.withMaxIterations(2)`):

| | 2026-11-17 | 2026-11-19 |
| --- | --- | --- |
| runId | `01M7NS6F4M7CRFA059WG18PJWB` | `01M7T6506ZZY6SVMR826JPDZZ7` |
| wall time | 36,771 ms | **6,565 ms** |
| `metadata.iterations` vs cap 2 | 7 (step count, misleading) | **2** |
| tool calls | web-search, file-write | web-search, file-write |
| tokens | 5,146 | 2,668 |
| deliverables | report.md missing, data.json produced | report.md produced, data.json missing |
| verdict / terminatedBy | `failed` / `max_iterations` | `failed` / `max_iterations` |
| `rax-diagnose cause` | `budget-cap/cap-cutoff` | `budget-cap/cap-cutoff` |
| `rax-diagnose attribute` | `harness:premature-stop` (probable) | `harness:premature-stop` (probable) |

## How much of 56 s to 14 s is the tool change? Less than it looks

- **The 11-17 wall time was partly contended or cold.** Its per-turn throughput was 15.5, 191, 58, 214 and 60 tok/s. Every clean run today holds 140-260 tok/s on every turn. Its turn 0 (251 output tokens in 16.2 s) and memory extraction (1,063 tokens in 17.8 s) match the contention signature measured today. At a clean ~200 tok/s, the old run's 3,895 output tokens alone would take about 20 s. So a like-for-like old run is about 20-25 s, not 56 s. That is an estimate, not a measurement.
- **What the lean surface does change:** input tokens drop by about half on turn 0 (727 to 361) and by about 24% per run (5,421 to 4,138). Output tokens dropped from 3,895 to 2,999, mostly less thinking. That is one run per arm, so treat it as within model variance.
- **Same turn shape:** search, write, write, final answer. The tool change did not remove a turn. The drop in displayed iterations (10 to 4) comes from the `metadata.iterations` fix, not from the tool change.
- **Tool calls did not fall below 3.** One search plus two writes is the minimum for this task (one search, two files). The "fewer tool calls" criterion cannot be met honestly here. The real win is zero wasted calls, which both runs already had.

## Attempts (all recorded, none discarded)

Success captures. "Clean" means a 2 s `/api/ps` sampler saw no other Ollama model resident during the run. Captures 1 to 4 ran while another agent was driving `qwen3:4b`, `qwen3:14b` and `cogito:14b` on the same GPU.

| # | runId | wall ms | clean? | iterations | tokens | tool calls (ok/failed) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `01M7T4DCDPVH4W6AVB287HA9AS` | 25,257 | n/a | 8 | 11,762 | 4x web-search, 2x file-write (2/4) | **Not eligible: environment fault.** The worktree had no `.env`, so web-search fell back to keyless DuckDuckGo and returned no results 4 times. Recovery steering fired twice, loop guidance warned twice, and the exit gate denied an early final answer. The run ended on `dispatcher_early_stop`. data.json used Jupiter = 95 from model memory, yet the receipt says `tool-grounded` (see Findings). |
| 2 | `01M7T4FTC3F34H5EG6Q32KSFXJ` | 139,960 | no (qwen3:4b earlier) | 4 | 6,798 | search, write, write (3/0) | Right shape; 8-29 tok/s, turn 2 alone 61.8 s |
| 3 | `01M7T4N8CEYAEYP6JR5YRP82M4` | 197,334 | no (qwen3:14b) | 4 | 7,369 | search, write, write (3/0) | Right shape; 5-37 tok/s. data.json put Saturn at 95 (the fact sheet's Jupiter figure). |
| 4 | none | killed at 170 s | no (cogito:14b) | - | - | - | Aborted by `timeout` while contended; nothing written |
| 5 | `01M7T6113E8XMDYCHVH7WFK4E6` | 22,489 | yes | 4 | 6,765 | search, write, write (3/0) | Turn 0 9.5 s at 20 tok/s: gemma reloading after cogito was evicted |
| **6** | **`01M7T6207HZS3HFRQTSB41G4B7`** | **14,130** | yes | 4 | 7,137 | search, write, write (3/0) | **Chosen** |
| 7 | `01M7T62M6ZT94KXSCCX77G5PGT` | 14,688 | yes | 4 | 7,039 | search, write, write (3/0) | Same as 6 within 0.6 s |

Run 6 is representative, not cherry-picked: runs 6 and 7 are 0.6 s apart. Run 5 is slower only because of the model reload on turn 0. All three clean runs have the same shape: 4 turns, 3 tool calls, no failures, Jupiter 115 and Saturn 274.

Failed captures (`GOLDEN_MODE=failed`, cap 2):

| # | runId | wall ms | clean? | Notes |
| --- | --- | --- | --- | --- |
| F1 | `01M7T63KMENGQPKCRYSB67DCDY` | 33,797 | yes | **Not chosen: unrepresentative.** The web-search timed out (`Tool execution timed out after 30000ms`, network), so no file was written. `cause=budget-cap/no-progress-at-cap`, attribution `harness:honest-decline-mislabeled` (decisive). The showcase is meant to show a cap cutoff, not a network timeout. |
| **F2** | **`01M7T6506ZZY6SVMR826JPDZZ7`** | **6,565** | yes | **Chosen.** Search, then report.md, then the cap. data.json missing. `cause=budget-cap/cap-cutoff`. |

## Checks on the chosen runs

- Tools called: `web-search` (1) and `file-write` (2) only. No calls to any other tool, and `recall` was offered but never called.
- No guard refusals. 13 of the 14 `guard-fired` events in the success trace have outcome `pass`. The 14th is the normal `terminal_decision terminate end_turn`. The receipt has no interventions. There are no duplicate fetches (1 search) and no repeated identical calls.
- Grounding: Jupiter 115 ("Jupiter, for instance, has 115 known moons (as of April 2026)") and Saturn 274 (NASA fact-sheet row) both appear in the web-search result (`tool-call-end#38`). This folder makes no claim that the numbers are astronomically current.
- Signing: a throwaway Ed25519 key is generated in memory per capture and never written or printed. The leak check over every file in this folder found 0 private `"d"` JWK fields, 0 `RA_RECEIPT_KEY` mentions and 0 `.env` values.

## Findings (not fixed here; for the owning wardens)

1. **The receipt says `tool-grounded` when every evidence call failed** (capture 1). 4 of 4 web-search calls failed and the numbers came from model memory. The 2 file-writes succeeded and `goalAchieved` was true, so `computeTrustReceipt` returned `tool-grounded` at `packages/core/src/types/receipt.ts:322-323`. The unresolved-failure cap applies only when `goalAchieved !== true`. A successful file-write is not evidence for the facts written into the file. Owner: core-warden. Pin it with a unit test: failed web-search plus ok file-write plus `goalAchieved: true` should give a verdict of at most `partially-grounded`. This is a design question, so the owner should decide.
2. **Keyless web-search found nothing for a basic factual query** (capture 1: DuckDuckGo instant-answer fallback, 4 queries). A docs reader who copies the showcase snippet without a search key gets the degraded run. The docs page or snippet should say a search key (Tavily, Brave, Serper or Keenable) is needed for the run shown. Owner: docs-warden, plus tools-warden if the fallback should do better.
3. **`rax-diagnose attribute` calls a network timeout plus the cap an "honest decline mislabeled"** (F1, decisive). The run did not decline. It hit a 30 s tool timeout and then the cap. This is in my own instrument (`packages/diagnose`). Confirm it against F1's trace before changing anything; I have not fixed it in this mission.

## Regenerate the docs data (docs-warden)

`apps/docs/scripts/generate-golden-run.ts` picks the newest complete `golden-run-*` folder. **It runs in `apps/docs` `predev` and `prebuild`**, so once this folder is committed, the next docs build reads it automatically. The explicit command:

```
bun run apps/docs/scripts/generate-golden-run.ts --dir wiki/Research/Harness-Reports/golden-run-2026-11-19
# writes apps/docs/src/data/golden-run.json and apps/docs/src/data/golden-run-failed.json
```

After regenerating, check `apps/docs/tests/golden-run*` against the new numbers. Also check any prose that quotes the old run (56 s, 10 iterations, 9,316 tokens, `builtins: true`).

## Reproduce the captures

Run from the repo root. Ollama must have `gemma4:e4b` pulled and **no other model generating**, or the timings are meaningless (see captures 2 to 4). A web-search key must be in the environment. Bun auto-loads `.env` from the cwd; in a worktree, pass `--env-file=<main checkout>/.env`.

```
bunx turbo run build --filter=@reactive-agents/reasoning   # reasoning exports dist
GOLDEN_OUT=wiki/Research/Harness-Reports/golden-run-2026-11-19/run.json \
  bun packages/benchmarks/scripts/capture-golden-run.ts
GOLDEN_MODE=failed GOLDEN_OUT=wiki/Research/Harness-Reports/golden-run-2026-11-19/failed-run.json \
  bun packages/benchmarks/scripts/capture-golden-run.ts
cp ~/.reactive-agents/traces/<success runId>.jsonl success-trace.jsonl   # likewise failed-trace.jsonl
bun packages/diagnose/src/cli.ts cause success-trace.jsonl > success-cause.txt
bun packages/diagnose/src/cli.ts cause failed-trace.jsonl > failed-cause.txt
bun packages/diagnose/src/cli.ts attribute failed-trace.jsonl > failed-attribute.txt
```

## Files

| File | What |
| --- | --- |
| `run.json` | Success capture, runId `01M7T6207HZS3HFRQTSB41G4B7` (attempt 6) |
| `success-trace.jsonl` | Its framework trace |
| `success-cause.txt` | Verbatim `rax-diagnose cause` |
| `failed-run.json` | Failed capture, runId `01M7T6506ZZY6SVMR826JPDZZ7` (attempt F2) |
| `failed-trace.jsonl` | Its framework trace |
| `failed-cause.txt`, `failed-attribute.txt` | Verbatim `rax-diagnose cause` and `attribute` |

The traces for the attempts that were not chosen stay in `~/.reactive-agents/traces/<runId>.jsonl` and are not committed.
