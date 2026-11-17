---
type: research
status: current
created: 2026-11-17
tags: [golden-run, docs, receipt, rax-diagnose]
---

# Golden run recapture, 2026-11-17

Live captures on current `dev` (git `v0.11.1-4190-g7c7445dc2`, VERSION `0.18.0`), model `gemma4:e4b` via Ollama server `0.40.15`. Script: `packages/benchmarks/scripts/capture-golden-run.ts`. Builder chain (single source for the displayed snippet): `packages/benchmarks/scripts/golden-run-builder.ts` (`goldenBuilderLines()`); also stored in each run.json under `capture.builderLines`.

Signing: a throwaway Ed25519 key is generated in memory per capture, passed to `.withReceiptSigning({ privateKeyJwk })`, never written or printed. Only the public key appears in the receipt. Grep for `RA_RECEIPT_KEY` and private `"d"` fields across this folder: 0 hits.

## Files

| File | What |
| --- | --- |
| `run.json` | Success capture. runId `01M7NS4FTY0NGVE1G1AF4D4GY1`. |
| `success-trace.jsonl` | Framework trace of the success run (copied from `~/.reactive-agents/traces`). |
| `success-cause.txt` | Verbatim `rax-diagnose cause` for the success trace. |
| `failed-run.json` | Failed capture, same agent plus `.withMaxIterations(2)`. runId `01M7NS6F4M7CRFA059WG18PJWB`. |
| `failed-trace.jsonl` | Framework trace of the failed run. |
| `failed-cause.txt` | Verbatim `rax-diagnose cause`. |
| `failed-attribute.txt` | Verbatim `rax-diagnose attribute`. |

Commands:

```
GOLDEN_OUT=<dir>/run.json bun packages/benchmarks/scripts/capture-golden-run.ts
GOLDEN_MODE=failed GOLDEN_OUT=<dir>/failed-run.json bun packages/benchmarks/scripts/capture-golden-run.ts
bun packages/diagnose/src/cli.ts cause <trace.jsonl>
bun packages/diagnose/src/cli.ts attribute <trace.jsonl>
```

## Attempts (all recorded, none discarded)

1. Success capture, attempt 1 of 1: success=true, wall 56,566 ms, 10 iterations, 9,316 tokens, tools web-search, file-write, file-write. Receipt verdict `tool-grounded`, verifierVerdict `pass`, deliverables report.md and data.json both produced, `terminatedBy=end_turn`, signature `alg=ed25519` present. Diagnose: `cause=none status=success`.
2. Failed capture, attempt 1 of 1: success=false, wall 36,771 ms. Receipt verdict `failed`, verifierVerdict `reject`, terminatedBy `max_iterations`, report.md not produced, data.json produced, signature present (a failed run's receipt is signed too). Diagnose: `cause=budget-cap/cap-cutoff`, attribution `harness:premature-stop` (probable).

## Honest notes

- Model warm-up took about 3 minutes (cold load, measured before the success capture); the success wall time above is a warm run and excludes it.
- The failed run's data.json is lower quality than the success run's: Saturn `moon_count: null`, Jupiter 115 with a note. This is real output from the capped run.
- Failed run: `metadata.iterations` reads 7 although the cap is 2. The trace's guard event says "iteration 2/2"; the two counters measure different things (kernel iterations vs reasoning steps, not verified here). Do not quote 7 as "iterations used" next to the cap without checking.
- `rax-diagnose attribute` blames the harness (`premature-stop`, probable) for a cap that was set deliberately low by the capture; it cannot know the cap was intentional. Show it as the tool's real output, not as a bug in the run.
- The success run's moon counts (Jupiter 115, Saturn 146, Mars 2) come from the model and a web search; this folder makes no claim they are correct.
- A tool-schema-repaired WARN was logged during capture (`file-write` schema); harmless, not saved.
