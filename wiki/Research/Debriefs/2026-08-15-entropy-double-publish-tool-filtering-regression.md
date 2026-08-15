# Entropy double-publish: root cause found, fix deferred (tool-filtering regression)

## Status: OPEN — root cause identified, fix NOT shipped (reverted after breaking a test)

## Summary

Move 1 (2026-08-13, `bareReasoningConfig`) made every builder run the kernel arm.
This exposed a pre-existing double-publish of `EntropyScored`: for `reactive`/
`direct`/`tree-of-thought` strategies (the ones using `runKernel`), BOTH of the
following now fire per iteration:

1. Kernel-runner's own inline scoring (`packages/reasoning/src/kernel/capabilities/reflect/reactive-observer.ts`),
   called directly from `runner.ts`/`iterate-pass.ts`.
2. `packages/runtime/src/execution-engine.ts`'s `ReasoningStepCompleted`-driven
   fallback scorer (lines ~402-467), which re-scores via `EntropySensorService`
   and publishes a SECOND `EntropyScored` event. This subscriber's own comment
   says it exists to cover "strategies like plan-execute that bypass
   kernel-runner's inline scoring" — true before Move 1 (those strategies ran
   on the old, now-dead inline arm, which never emitted `ReasoningStepCompleted`
   at all), no longer true after it, since EVERY builder now runs through
   kernel-hooks.ts's `onThought`, which emits `ReasoningStepCompleted`
   regardless of strategy.

Confirmed via the North Star gate (`packages/testing/tests/gate/north-star-gate.test.ts`):
`iterations` on every kernel-arm scenario went from the June baseline's `0`
(inline arm, zero entropy events) to `2` (double-published) once Move 1 landed.
The baseline was never regenerated since Move 1 to catch this.

## The fix that was tried, and why it was reverted

Excluded `reactive`/`direct`/`tree-of-thought` from the fallback subscriber
(`packages/runtime/src/execution-engine.ts`, gate on `event.strategy`). This
correctly brought `iterations` down to `1` (single, real entropy event) — but
broke `packages/runtime/tests/tool-filtering.test.ts` > "should restrict
visible tools to only allowedTools": the run now exhausts `max_iterations`
instead of completing at iteration 3 as before.

**This means something downstream treats the duplicate publish as SIGNAL, not
waste.** The most likely candidate, found by grepping `EntropyScored`
consumers:

`packages/reactive-intelligence/src/sensor/calibration-update-subscriber.ts`
collects every `EntropyScored` event's `composite` score per `taskId` into a
`scores: number[]` array (`taskScores.get(event.taskId).scores.push(...)`),
used for calibration-drift detection (mean/threshold-crossing over the sample
list). **Doubling every sample changes the drift-detection statistics** —
plausibly shifting when/whether a `CalibrationDrift` event fires, which
"observers (controller, alerting systems, etc.) can respond to" per that
file's own docstring. If a controller response to calibration drift changes
intervention behavior (e.g. tool-injection nudges, stall-detection
sensitivity), that would explain why the blocked-tool-redirect scenario in
tool-filtering.test.ts needs more iterations once the duplicate samples are
removed — the controller was, by accident, seeing 2x the entropy signal it
was designed for.

## Not yet done (the real fix)

1. Confirm the mechanism: instrument `calibration-update-subscriber.ts` (or
   whatever the actual consuming controller turns out to be) to show a
   `CalibrationDrift` event firing differently with 1 vs 2 samples per
   iteration for the tool-filtering scenario specifically.
2. Fix the RIGHT side: either (a) dedupe at the subscriber level too (track
   `(taskId, iteration)` pairs in `calibration-update-subscriber.ts` the same
   way the execution-engine fallback tried to, sourced from a shared,
   reliable per-iteration key — NOT `event.step`, which numbers differently
   between the two publishers), or (b) re-verify whether the controller
   response was ever validated against the CORRECT (non-doubled) sample rate
   in the first place, in which case the doubling may have been silently
   masking an intervention-tuning bug rather than the reverse.
3. Once fixed, re-run the North Star gate and re-pin `iterations` to `1`.

## Why this matters for the inline-vs-kernel benchmark

The user's stated precondition for Phase 3 (deleting the old inline arm) is a
benchmark comparing inline-arm vs kernel-arm behavior/cost. As of this note,
the kernel arm pays for entropy sensor computation TWICE per iteration where
the (soon to be deleted) inline arm paid for it ZERO times — a real but
currently-conflated cost difference. Running that comparison before this is
fixed will misattribute part of the kernel arm's overhead to architecture
rather than to this specific double-publish bug, the same "tool-surface
confound" failure mode documented in `feedback_tool_surface_confound`
(4 prior findings retracted to one root cause). Fix this first, or explicitly
control for it in the benchmark's methodology section.

## Baseline state

`wiki/Research/Harness-Reports/integration-control-flow-baseline.json` is
currently pinned to the double-published value (`iterations: 2`) as of
2026-08-15, NOT the fixed value — see the `BASELINE-UPDATE:` commit trailer
on that date for the full reasoning.
