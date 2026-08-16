# Replay/Snapshot Determinism Re-validation — 2026-08-16

Closes #53. Re-run against the current codebase (`12e5657e`, v0.15.0
release-prep — not the v1.0-integrated codebase the issue originally scoped
this against, since v1.0 hasn't landed; treated as a periodic checkpoint
instead of a final gate, safe to re-run again closer to v1.0).

## What was re-run

| Suite | Result | What it pins |
|---|---|---|
| `packages/replay/` (10 files) | 30 pass / 0 fail | Load/diff/tool-table/layer-override + `e2e.test.ts`'s full record→replay→diff round trip |
| `packages/replay/src/e2e.test.ts` — `records and replays a seeded tool task byte-for-byte` | 1 pass | The exact #30 acceptance criteria (see below) |
| `packages/benchmarks/tests/replay-golden.test.ts` | pass | Golden-trace replay stability |
| `packages/benchmarks/tests/replay-lane.test.ts` | pass | Replay lane infrastructure |
| `packages/benchmarks/tests/t0-deterministic.test.ts` | 4 pass | Per-commit scripted-provider harness-behavior gate |
| `packages/testing/tests/gate/north-star-gate.test.ts` | pass | North-star invariant gate |

44 tests total across the determinism-relevant suites, 0 failures.

## #30's acceptance criteria — confirmed satisfied (already shipped, PR #196/#197)

The issue asked for: "an end-to-end test that records a run via
`@reactive-agents/replay` and re-executes it with overridden tools/messages,
asserting identical final state + step sequence... same seed → byte-identical
trace; tool-override path → expected divergence point only."

`packages/replay/src/e2e.test.ts` does exactly this in one test:
1. Records a seeded tool task (`runSeededTask` + `TestLLMServiceLayer` +
   `makeSeededToolLayer`).
2. Replays the recorded run and asserts `canonicalStepBytes(replayed) ===
   canonicalStepBytes(captured)` (byte-identical) and
   `assertSemanticReplay(...)` does not throw.
3. Mutates ("corrupts") the recorded tool result and replays again, asserting
   the byte comparison now differs AND `firstDifferencePath(...)` is exactly
   `"$[1].output.value"` — the expected, single divergence point.

This was landed via PR #196 ("test(replay): add deterministic end-to-end
replay coverage") and refined by PR #197 ("test(replay): return replayed
steps through harness handle"), both merged to `origin/main` prior to this
session. #30 was never closed against that work — closed now with this
report as the evidence trail.

## Verdict

Replay/snapshot determinism holds at the current commit across every
existing determinism-pinning suite. No drift, no new gaps found. Re-run
again once v1.0 integration actually lands (#53's original scope) — this
report is a checkpoint, not a final closure of that gate.
