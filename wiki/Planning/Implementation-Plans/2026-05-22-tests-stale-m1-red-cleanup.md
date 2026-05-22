# Bundle: tests-stale-m1-red-cleanup

Date: 2026-05-22
Budget: 30 min
Issues: #80 (HS-24)

## Acceptance criteria

- **#80:** `packages/reactive-intelligence/tests/m1-dispatcher-validation.test.ts` no longer contains the `test.skip("RED phase: ...")` placeholder (L65–174), the `computeEntropyStdDev` helper (L246–257), or the dead interfaces `RIDispatchMetrics` / `M1DispatcherValidationResult` (used only by the deleted test).

## Cross-package descope

Singleton, single-file. No descope needed.

## Execution units

1. **Unit 1 — rewrite the test file.** Strip the stale RED block + dead helpers/interfaces; keep the two surviving smoke tests (`processes entropy signals without errors`, `RI disabled produces zero dispatch events`) and the `EntropyScore` import. Add a top-of-file note pointing at the Phase 1 mechanism validation evidence (`harness-reports/phase-1-mechanism-validation-2026-05-04.md`) so future readers know why RED is gone.

## Verification protocol

- `rtk bun test packages/reactive-intelligence/ --timeout 30000` — pass/fail same as baseline, skip count -1
- `rtk bunx turbo run build` — 38/38 green
- Verified-by recheck: `grep -n 'test.skip\|computeEntropyStdDev\|RIDispatchMetrics\|M1DispatcherValidationResult' …` → 0

## Out of scope

- The two remaining smoke tests are extremely thin (`expect(0).toBe(0)`). Hardening them with a real dispatcher invocation is a meaningful follow-up but exceeds #80's "delete dead code" scope.
- `packages/reactive-intelligence/src/measurement.ts:5` comment mentions `RIDispatchMetrics` — comment-only reference; deleting the interface doesn't break it. Comment cleanup deferred.

## Baseline (pre-EXECUTE)

- `rtk bun test packages/reactive-intelligence/` → **455 pass / 0 fail / 3 skip** (458 across 65 files)
- File LOC: 257
- `grep -n 'test.skip' m1-dispatcher-validation.test.ts` → 1 match (L65)
