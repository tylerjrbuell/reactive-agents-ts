---
title: Strategy tool ledger — deliverable receipts stop lying
date: 2026-07-11
type: debrief
status: completed
tags: [harness, receipts, deliverables, blueprint, reflexion, plan-execute, honesty]
---

# Strategy tool ledger — deliverable receipts stop lying (2026-07-11)

**Commit:** `a4c5154d` · **Probe:** `scratch.ts` (gemma4, ollama, `.withLongHorizon()`, adaptive)

## Failure mode

Agent wrote `./show.md` via `file-write` (tool ok, file on disk) yet the receipt said
`deliverables[0].produced: false` beside `success: true`. Reproduced on TWO strategy
paths: adaptive→blueprint (trace `01KX998PS2X3NW7JTAKBJMWPGN`) and reflexion
(trace `01KX99T53WSFS1TW08KAHR89SR`).

## Mechanism — one disease, three strategies

`isArtifactProduced` ([[Failure-Modes]]-relevant: post-conditions.ts) verifies ONLY via
toolCallId linkage: action step with `metadata.toolCall {id,name,arguments}` paired with a
successful observation carrying `toolCallId` + `observationResult`. But:

- **blueprint** flattened worker results into prose (`[EXEC s4] ✓ …`), discarding the
  `obsStep` that `executeToolAndObserve` already returns.
- **plan-execute** did the identical prose flatten in its wave apply-loop.
- **reflexion** accumulated its sub-kernels' canonical steps in `allSideEffectSteps` for
  the completion-gate veto but never merged them into `result.steps`.

⇒ NO strategy-path run could ever verify an artifact deliverable. Only bare react-kernel
runs (act.ts writes the pair) could. Classic [[feedback_wire_and_verify_end_to_end]]:
the verify machinery existed; the ledger it reads was never fed.

## Fix

Canonical ledger pair crosses every strategy boundary:
`BlueprintWorkerResult.ledger` (+ patch-retry merge), `StepExecResult.ledgerSteps`
through plan-execute's wave scheduler, reflexion merges the tool-evidence subset of
`allSideEffectSteps`. Observation keeps legacy `[EXEC sN] ✓ <output>` prose (log
greppability, shell-unwrap pins); action steps use `[DISPATCH sN]` prefix.

Pins: `tests/strategies/strategy-tool-ledger.test.ts` (reflexion + plan-execute),
`blueprint.test.ts` "(f) canonical tool ledger" — each drives
`computeDeliverableReport` end-to-end to `produced:true`.

## Verified

Live re-probe same task/model: `produced: true`, file on disk. reasoning package
tests/ 1834 + src/ 528, 0 fail. `turbo build --force` clean. No bench-gate run: this is
a receipt-truth fix (no behavior/lift claim), recorded here instead of the ledger.

## Same probe surfaced — NOT fixed (open targets)

1. **Fabrication under `verdict:"tool-grounded"`** — gemma4 invented 13 episode
   synopses (literally wrote "(Placeholder for early episode)") off 2 thin web
   searches; receipt heuristic = "tools ran", not "output ⊆ observations". Zero
   `verifier-verdict` events on strategy paths (verify gate never fires outside the
   react kernel).
2. **Blueprint token accounting lies** — reported 6,370 tok vs 18,448 real (len/4
   estimates + uncounted plan retries); `llmCalls: 0` vs 5 real; `inputTokens/
   outputTokens: 0` while the trace has exact per-call `tokensIn/tokensOut`.
3. **`goalAchieved: null`** under `.withLongHorizon()` — goal evaluation never wrote.
4. Minor: `defaultStrategy: ' adaptive'` (leading space) accepted silently — no
   validation on strategy id strings at the builder.
