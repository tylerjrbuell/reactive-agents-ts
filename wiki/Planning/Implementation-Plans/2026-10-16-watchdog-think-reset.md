# Bundle: compose-watchdog-think-reset
Date: 2026-10-16
Budget: 45 min
Issues: #248 part 2 (watchdog llm-exchange reset)

## Acceptance criteria
- #248 part 2: `watchdog` killswitch resets its no-progress timer on `after('think')` as well as `after('act')`, so a slow-but-progressing LLM exchange doesn't trigger a false watchdog abort at the next `before('think')` boundary. New test proves reset on after('think'). `bun test packages/compose` green, `bunx turbo run typecheck --filter=@reactive-agents/compose` green, 0 new `as unknown as`.

## GROUND (parent, pre-dispatch — VERIFIED 2026-10-16)
- `packages/compose/src/killswitches/watchdog.ts:16-41`: watchdog resets `lastProgress` only on `after('act')` (line 29-31), checks elapsed on `before('think')` (line 33-39). Comment at lines 24-28 acknowledges the old tool-result tap was dead.
- `Phase` type (`packages/core/src/services/harness-types.ts:12-22`): includes `think` and `act` — both valid phases for `before`/`after` hooks.
- Harness interface (`packages/core/src/services/harness-pipeline.ts:264-274`): `before<Ph extends Phase>(phase, fn)` and `after<Ph extends Phase>(phase, fn)` — `think` is a valid phase.
- Existing watchdog tests (`packages/compose/test/killswitches.test.ts:231-266`): test reset on `after('act')` at line 249. Same pattern applies to `after('think')`.
- No existing test for reset on `after('think')` — that's the gap this fix closes.
- `packages/compose` not in warden table → parent-direct execution.

## Execution units (ordered)
1. **Unit 1 (parent, TDD):**
   - RED: new test in killswitches.test.ts — watchdog with `after('think')` reset does NOT abort when a think phase completes after the threshold would otherwise elapse. Watch it fail (timer not reset on think → abort fires).
   - GREEN: add `harness.after('think', () => { lastProgress = Date.now(); })` to watchdog.ts after the `after('act')` block.
   - REVIEW: verify the reset is placed correctly (after the act block, same pattern).
   - COMMIT.
2. **Unit 2 (parent verifier):** `bun test packages/compose` green; `bunx turbo run typecheck --filter=@reactive-agents/compose` green; new test passes; `grep -c "after('think')" packages/compose/src/killswitches/watchdog.ts` → 1; 0 new `as unknown as`.

## Risk register
- Resetting on every `after('think')` could mask a genuinely stuck think phase → mitigation: watchdog still fires at `before('think')` if NO think has completed recently; a hung think that never returns won't reach `after('think')`, so the next `before('think')`... actually if think never returns there IS no next before('think'). This is a pre-existing limitation (needs `withLlmTimeout`), not introduced by this change. This change only prevents FALSE aborts on slow-but-completing thinks.
- `after('think')` fires on every think including fast ones → harmless, just resets the timer more often.
- The `before('think')` check still runs first on each iteration → correct ordering preserved.

## Verification protocol
- `bun test packages/compose/test/killswitches.test.ts` → green (existing + new test)
- `bun test packages/compose` → green (full package)
- `bunx turbo run typecheck --filter=@reactive-agents/compose` → green
- New test: after('think') reset prevents abort that would otherwise fire

## Out-of-scope (explicit)
- #248 part 1 (shared computeBudgetSignal) — separate design pass needed
- `withLlmTimeout` integration for hung LLM calls — separate concern
- Any change to `packages/reasoning` or `packages/runtime`
- Part 1's cost-semantics collapse

## Baseline
- dev HEAD `35cec513c` (#237 closed). Working on `dev`, 10 commits ahead of `origin/dev`.
- Baseline: `bun test packages/compose` → (record below); `bunx turbo run typecheck --filter=@reactive-agents/compose` → green.
