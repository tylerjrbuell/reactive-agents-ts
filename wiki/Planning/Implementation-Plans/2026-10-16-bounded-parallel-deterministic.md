# Bundle: tools-bounded-parallel-deterministic
Date: 2026-10-16
Budget: 45 min
Issues: #226 (singleton; bounded-parallel.test.ts real setTimeout flake risk)

## Acceptance criteria
- #226: `packages/tools/tests/bounded-parallel.test.ts` no longer relies on real `setTimeout` wall-clock delays for concurrency/order assertions. Replace with deterministic mechanism (Promise.resolve microtask yield or explicit barrier). `bun test packages/tools` green, `bunx turbo run typecheck --filter=@reactive-agents/tools` green, 0 new `as unknown as` sites.

## GROUND (parent, pre-dispatch — VERIFIED 2026-10-16)
- `packages/tools/tests/bounded-parallel.test.ts:12,37,49` — four `await new Promise((r) => setTimeout(r, N))` calls with N∈{5,10-50}, no fake timer/mocked clock.
- `packages/tools/src/research/bounded-parallel.ts` — implementation already deterministic: pre-sized `slots` array indexed by original position, results read back in input order regardless of completion order. Slots guarantee order; test delays don't affect correctness, only introduce timing dependency.
- Test currently passes (4/4) but is susceptible to CI scheduler jitter per issue body.
- No warden needed (packages/tools not in warden table; parent-direct execution).

## Execution units (ordered)
1. **Unit 1 (parent, TDD):**
   - RED: Confirm current test relies on wall-clock `setTimeout` (grep → 4 hits at :12/:37/:49 + one more at :12 context). The 4th is actually :12 (line 12). All 4 are real setTimeout.
   - GREEN: Replace all 4 `setTimeout(r, N)` with `await Promise.resolve()` — deterministic microtask yield. `active++` is synchronous so concurrency test (`maxActive <= 3`) is deterministic; slot-based implementation guarantees order regardless of resolution timing.
   - REVIEW: Check no other timing dependencies in the test file.
   - COMMIT.
2. **Unit 2 (parent verifier):** `bun test packages/tools` green; `bunx turbo run typecheck --filter=@reactive-agents/tools` green; `grep -c "setTimeout" packages/tools/tests/bounded-parallel.test.ts` → 0; `grep -c "as unknown as" packages/tools/src packages/tools/tests` → 0 new.

## Risk register
- Test loses "out-of-order completion" scenario coverage → mitigation: slot-based implementation guarantees order regardless of completion order; the test still validates the guarantee. Add comment explaining this.
- `Promise.resolve()` might resolve too fast for concurrency observation → mitigation: `active++` is synchronous, all workers increment before yielding, so `maxActive` = concurrency deterministically. Verified by reasoning.
- Other setTimeout usages in tools package not under fix → out of scope, only bounded-parallel.test.ts.

## Verification protocol
- `grep -c "setTimeout" packages/tools/tests/bounded-parallel.test.ts` → 0
- `bun test packages/tools` → 1252/0 (baseline)
- `bunx turbo run typecheck --filter=@reactive-agents/tools` → green
- `grep -c "as unknown as" packages/tools/src packages/tools/tests` → 0 new vs baseline

## Out-of-scope (explicit)
- `packages/tools/src/research/bounded-parallel.ts` implementation (already correct, no change needed)
- Other test files in packages/tools using setTimeout
- #214 (cast ceiling premise drifted, pre-existing red), #206 (needs design pass), #248 (needs design pass)

## Baseline
- dev HEAD `896a7c984` (#251 restored via cherry-pick). Working on `dev`, 5 commits ahead of `origin/dev`.
- Baseline: `bun test packages/tools` → 1252 pass / 0 fail across 113 files. `bun test packages/tools/tests/bounded-parallel.test.ts` → 4/0.
