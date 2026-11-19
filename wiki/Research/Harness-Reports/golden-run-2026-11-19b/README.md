---
type: research
status: current
created: 2026-11-19
tags: [golden-run, docs, receipt, rax-diagnose, thinking, memory, debrief]
---

# Golden run recapture with the scratch.ts settings, 2026-11-19 (b)

Live captures on HEAD `83fd1b700` (git `v0.11.1-4430-g83fd1b700`, VERSION `0.18.0`), model `gemma4:e4b` via Ollama server `0.40.15`, same task as [[golden-run-2026-11-19/README|the earlier 2026-11-19 capture]]. Script: `packages/benchmarks/scripts/capture-golden-run.ts`. Builder chain: `packages/benchmarks/scripts/golden-run-builder.ts` (`goldenBuilderLines()`), also stored in each run.json under `capture.builderLines`.

## What changed in the builder chain

```diff
   .withProvider("ollama")
-  .withModel("gemma4:e4b")
+  .withModel({ model: "gemma4:e4b", numCtx: 8000 })
   .withReasoning()
   .withTools({ builtins: ["file-write", "web-search"] })
   .withObservability()
-  .withThinking(true)
-  .withMemory()
+  .withThinking(false)
+  .withDebrief()
   .withReceiptSigning({ privateKeyJwk })
```

- **`numCtx` uses the object form.** `scratch.ts` writes `.withModel("gemma4:e4b", { numCtx: 8000 })`. That is not an overload: `withModel` takes a string or a params object (`packages/runtime/src/builder.ts:863-865`). At runtime the second argument is dropped. Without it, Ollama loaded `gemma4:e4b` at context 32,768 (arm E below, `ollama ps`). So the owner's scratch run most likely used 32,768, not 8,000. A type-checked caller would get a compile error. See Findings.
- **Thinking off**, as in `scratch.ts`.
- **`.withDebrief()` replaces `.withMemory()`.** The debrief is the same with either (measured below). Memory adds about 0.9 s and the page uses nothing else from it.
- Receipt signing stays. Every capture has an `ed25519` signature.

## Old vs new (chosen runs)

| | 2026-11-19 (thinking on, memory) | 2026-11-19b (scratch settings) |
| --- | --- | --- |
| runId | `01M7T6207HZS3HFRQTSB41G4B7` | `01M7T77KT3A1APCESSWRAHPFT1` |
| success / verdict | true / `tool-grounded`, verifier `pass` | true / `tool-grounded`, verifier `pass` |
| **wall time** | 14,130 ms | **5,171 ms** |
| `metadata.iterations` (kernel turns) | 4 | 5 (one turn is a premature final answer, see below) |
| `llmCalls` | 5 | 5 |
| tool calls | web-search, file-write, file-write | web-search, file-write, file-write |
| tokens (in / out) | 7,137 (4,138 / 2,999) | **5,167 (4,107 / 1,060)** |
| summed `think` phase time | 10,520 ms (4 turns) | 4,666 ms (5 turns) |
| `memory-flush` phase | 2,965 ms | 4 ms |
| Ollama context | capability default | 8,000 |
| thought steps with text | 4 of 4 | 3 of 5 (turns 0 and 3 are empty) |
| debrief | yes (deterministic, local tier) | yes, same shape |
| receipt signature | ed25519 | ed25519 |
| `rax-diagnose cause` | `cause=none status=success` | `cause=none status=success` |

Failed variant (same agent plus `.withMaxIterations(2)`):

| | 2026-11-19 | 2026-11-19b |
| --- | --- | --- |
| runId | `01M7T6506ZZY6SVMR826JPDZZ7` | `01M7T791J3QFABX4P6400QH0QG` |
| wall time | 6,565 ms | **4,807 ms** |
| `metadata.iterations` vs cap 2 | 2 | 2 |
| tool calls | web-search, file-write | web-search, file-write |
| tokens | 2,668 | 2,202 |
| deliverables | report.md produced, data.json missing | data.json produced, report.md missing |
| verdict / terminatedBy | `failed` / `max_iterations` | `failed` / `max_iterations` |
| `rax-diagnose cause` | `budget-cap/cap-cutoff` | `budget-cap/cap-cutoff` |
| `rax-diagnose attribute` | `harness:premature-stop` (probable) | `harness:premature-stop` (probable) |

## What the docs page gains and loses

- **Gains:** a 5.2 s run instead of 14.1 s, and 1,060 output tokens instead of 2,999. The builder snippet matches what `scratch.ts` means to do.
- **Loses the thought on turn 0.** With thinking off, `gemma4:e4b` calls `web-search` on turn 0 with no visible text. This held in all 10 thinking-off success runs. The first trace row (the search) will have no thought to expand. With thinking on, every turn had text (arm D: 4 or 5 of 5).
- **Loses most thought text on write turns.** The thoughts that do appear are visible reasoning, not hidden thinking. The chosen run has three: the analysis of the search results before `data.json` (922 chars), a premature final answer (1,345 chars), and the final summary (419 chars).
- **Keeps the debrief.** On the local tier the engine skips the LLM debrief synthesis (`packages/runtime/src/engine/finalize/debrief-synthesis.ts:249-257`, `isLocalTier`). The debrief is the deterministic fallback with or without memory. Arms A and C produce the same keys, the same `toolsUsed` and a 946-char markdown body. `debriefRich` equals `debrief` in both.
- **Keeps the receipt** (signed, `tool-grounded`).

### The chosen run shows the exit gate catching a premature answer

On turn 2 the model wrote data.json, then answered with a report in the reply text instead of writing `./report.md`. The harness denied the exit with "Not finished yet. Still outstanding: write the file ./report.md". The model then wrote the file on turn 3 and finished on turn 4. This is why the run has 5 turns, not 4. I picked this run by the median rule (below), not for this behavior. The docs can show it as harness value or the docs-warden can ask for a different run. Runs C1 and C3 have no premature answer but used 3 searches each.

## Per-component cost (all on a clean GPU, same task, same HEAD)

Each arm changes one line against the final chain. Wall time is `agent.run()` only.

| Arm | Change vs final chain | Runs: wall ms (searches, total tokens) | Notes |
| --- | --- | --- | --- |
| **C (final)** | none: `.withDebrief()` | 5,138 (3, 7,214) · **5,171 (1, 5,167)** · 5,346 (3, 8,828) | Debrief present. Post-loop tail 5-20 ms. |
| A | `.withMemory()` instead of `.withDebrief()` | 5,585 (1, 4,274) · 5,521 (1, 5,188) · 5,939 (3, 8,295) | `memory-flush` phase **809, 905, 984 ms** on the critical path. Same debrief. |
| B | neither memory nor debrief | 4,993 (3, 7,149) · 5,411 (1, 4,438) · 4,983 (1, 4,526) | `result.debrief` is null, so the page's debrief section would be empty. |
| D | `.withThinking(true)` | 11,689 (2, 7,943) · 8,484 (1, 5,295) · 7,098 (1, 4,734) | Output tokens 1,511-2,670 vs 935-1,060 in C. Every thought step has text. |
| E | `.withModel("gemma4:e4b")`, no `numCtx` | 12,389 (3, 7,181) · 4,747 (2, 4,898) | Ollama reloads at context 32,768. E1 includes that reload (the sampler saw no model for about 6 s). Warm, E2 is as fast as C. |

Reading:

- **Debrief: about 0 ms.** The arm C tail after the last turn is 5-20 ms. The debrief's cost is far below the 1.5 s bar, so it stays.
- **Memory: 0.8-1.0 s** of memory extraction per run, and nothing on the page uses it. It is dropped in favor of `.withDebrief()`. This changes the brief's either/or slightly: the debrief stays and memory goes.
- **Thinking: about 2-3 s and 500-1,600 output tokens** on runs with 1 search (D2 8,484 and D3 7,098 vs C2 5,171). It is the largest single cost.
- **`numCtx: 8000` does not change warm speed** (E2 4,747 vs C 5,1xx). It keeps the KV cache smaller (total GPU memory in use about 5.9 GB vs 6.5 GB in `nvidia-smi`). Switching between 8,000 and 32,768 forces a model reload of several seconds.
- **Wall time spread comes from the model's search count** (1 to 3 searches) more than from any config line. That is model variance.
- **The old 14.1 s breaks down as** about 5.9 s of extra `think` time (thinking tokens) plus 3.0 s of memory extraction. Together that is 8.9 s of the 9.0 s gap.

On the owner's 11 s scratch run: every warm run here takes 4.7-5.9 s. E1 (12.4 s) shows that a model reload alone adds about 7 s. So the 11 s scratch run most likely included a cold load or a context switch. I did not observe that run, so this is an inference.

## Attempts (all recorded, none discarded)

GPU check: at the start, another client's `mimo-v2.6:latest` (6.7 GB, 7.5 GB VRAM) was resident. I waited until it unloaded (10:34). A `gemma4:e4b` load at context 8,000 appeared at 10:32:29 from another client (source unknown). Its `expires_at` did not move before my first capture, so it was idle. A 2 s `/api/ps` sampler ran during every capture. It saw only `gemma4:e4b` in all of them. `nvidia-smi` utilization before the first capture of each batch read 0-27%. Before back-to-back captures it read 79-87%, right after the previous capture exited. Those captures were not slower than the first of their batch (C1 5,138 vs C2 5,171), so I see no contention signature. All runs below count as clean.

| Arm | # | runId | wall ms | turns | tokens | tool calls | cause |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | 1 | `01M7T75J28BR4ZT1FCFCRZCH57` | 5,585 | 3 | 4,274 | search, write, write | none |
| A | 2 | `01M7T7623704Y7RCQ708ZEK3ZD` | 5,521 | 4 | 5,188 | search, write, write | none |
| A | 3 | `01M7T76830JBCJP4214T17H4ES` | 5,939 | 5 | 8,295 | 3x search, write, write | none |
| B | 1 | `01M7T76RSZPC9YGAZRDVRZB8VS` | 4,993 | 5 | 7,149 | 3x search, write, write | none |
| B | 2 | `01M7T76Y5Y1MGRA8AMMCPYHZ8S` | 5,411 | 4 | 4,438 | search, write, write | none |
| B | 3 | `01M7T773ZVMEZN8EMC4A4T37ZP` | 4,983 | 4 | 4,526 | search, write, write | none |
| C | 1 | `01M7T77E7KPD5XP8ZE7WGJMC2D` | 5,138 | 5 | 7,214 | 3x search, write, write | none |
| **C** | **2** | **`01M7T77KT3A1APCESSWRAHPFT1`** | **5,171** | 5 | 5,167 | search, write, write | none (**chosen**) |
| C | 3 | `01M7T77SE0C5TDQXHHP8QA2ZG3` | 5,346 | 6 | 8,828 | 3x search, write, write | none (authority `guard:dispatcher_early_stop`) |
| C-failed | F1 | `01M7T791J3QFABX4P6400QH0QG` | 4,807 | 2 | 2,202 | search, write | `budget-cap/cap-cutoff` (**chosen**) |
| D | 1 | `01M7T7A8CW4EKZNFA2352AZ1GY` | 11,689 | 5 | 7,943 | 2x search, write, write | not run |
| D | 2 | `01M7T7AMGE58NCQ29EGZHK7CMM` | 8,484 | 4 | 5,295 | search, write, write | not run |
| D | 3 | `01M7T7AXCFG0YGTKN49NCVA6TV` | 7,098 | 4 | 4,734 | search, write, write | not run |
| E | 1 | `01M7T7BFV88DQNZPJGY93JK8W7` | 12,389 | 5 | 7,181 | 3x search, write, write | not run |
| E | 2 | `01M7T7BWHXPYNABTXX5QJ3XYH5` | 4,747 | 4 | 4,898 | 2x search, write, write | not run |

**Choice rule:** median wall time of the three final-config (arm C) runs, because the success criterion is wall time. C2 is the median (5,138 / 5,171 / 5,346 ms). By tokens C1 would be the median (5,167 / 7,214 / 8,828). All three C runs are within 0.21 s. The failed variant was captured once (F1); it showed the intended cap cutoff, so no second attempt was needed.

## Checks on the chosen runs

- Tools called: `web-search` (1) and `file-write` (2) only. The failed run: `web-search` (1) and `file-write` (1).
- Numbers written: Jupiter 115, Saturn 274, Mars 2. The turn-1 thought cites the search results for each. This folder makes no claim that the numbers are astronomically current.
- Each turn has a `head-truncation-guard` harness signal ("output budget clamped to ~7,000 tok ... num_ctx 8000"). That is the guard sizing the output budget to the 8,000 context. It is informational and truncated nothing. The docs timeline renders only thought, action and observation steps.
- Signing: a throwaway Ed25519 key is generated in memory per capture and never written or printed. The leak check over every file in this folder found 0 private `"d"` JWK fields, 0 `RA_RECEIPT_KEY` mentions and 0 `.env` values.

## Findings (not fixed here; for the owning wardens)

1. **`.withModel("id", { numCtx })` drops `numCtx` with no warning** (`packages/runtime/src/builder.ts:863-865`, body `packages/runtime/src/builder/withers/model-budget.ts:20-37`). `scratch.ts` uses this form, and the owner's run used Ollama's 32,768 default instead of 8,000. TypeScript rejects the call, but untyped JS, `bun` scripts that skip type checks, and LLM-written code do not. A two-argument overload `withModel(model: string, params?: Omit<ModelParamsInput, "model">)` would make the guessable form work (developer-first API rule). Owner: runtime-warden. This is an API decision, so the owner should decide.
2. **With thinking off, `gemma4:e4b` never writes text before its first tool call** (10 of 10 runs). The docs trace's first row has no thought. This is model behavior, not a harness defect. The docs-warden should make sure the page handles a null thought cleanly (the generator already maps empty content to `null`).
3. The earlier capture's findings (receipt `tool-grounded` with all evidence calls failed; keyless web-search; `attribute` on a network timeout) are unchanged and not retested here.

## Regenerate the docs data (docs-warden)

`apps/docs/scripts/generate-golden-run.ts` picks the newest complete `golden-run-*` folder by name. `golden-run-2026-11-19b` sorts after `golden-run-2026-11-19`, so the next `apps/docs` `predev`/`prebuild` reads this folder once it is committed. The `_source` string will name `golden-run-2026-11-19b`. The explicit command:

```
bun run apps/docs/scripts/generate-golden-run.ts --dir wiki/Research/Harness-Reports/golden-run-2026-11-19b
```

Check prose and tests that quote the old run (14.1 s, 7,137 tokens, `.withThinking(true)`, `.withMemory()`, 4 iterations). The new run has 5 iterations.

## Reproduce the captures

Run from the repo root. Ollama must have `gemma4:e4b` pulled and no other model generating. A web-search key must be in the environment; in a worktree, pass `--env-file=<main checkout>/.env`.

```
bunx turbo run build --filter=@reactive-agents/reasoning   # reasoning exports dist
GOLDEN_OUT=wiki/Research/Harness-Reports/golden-run-2026-11-19b/run.json \
  bun packages/benchmarks/scripts/capture-golden-run.ts
GOLDEN_MODE=failed GOLDEN_OUT=wiki/Research/Harness-Reports/golden-run-2026-11-19b/failed-run.json \
  bun packages/benchmarks/scripts/capture-golden-run.ts
cp ~/.reactive-agents/traces/<success runId>.jsonl success-trace.jsonl   # likewise failed-trace.jsonl
bun packages/diagnose/src/cli.ts cause success-trace.jsonl > success-cause.txt
bun packages/diagnose/src/cli.ts cause failed-trace.jsonl > failed-cause.txt
bun packages/diagnose/src/cli.ts attribute failed-trace.jsonl > failed-attribute.txt
```

Arms A, B, D and E were captured by temporarily editing one STEPS line in `golden-run-builder.ts`, then restoring it. Their run JSON files are not committed. Their traces stay in `~/.reactive-agents/traces/<runId>.jsonl`.

## Files

| File | What |
| --- | --- |
| `run.json` | Success capture, runId `01M7T77KT3A1APCESSWRAHPFT1` (arm C, run 2) |
| `success-trace.jsonl` | Its framework trace |
| `success-cause.txt` | Verbatim `rax-diagnose cause` |
| `failed-run.json` | Failed capture, runId `01M7T791J3QFABX4P6400QH0QG` (F1) |
| `failed-trace.jsonl` | Its framework trace |
| `failed-cause.txt`, `failed-attribute.txt` | Verbatim `rax-diagnose cause` and `attribute` |
