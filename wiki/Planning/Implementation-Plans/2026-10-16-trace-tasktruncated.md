# Bundle: trace-run-started-tasktruncated
Date: 2026-10-16
Budget: 45 min
Issues: #237 (singleton; RunStartedEvent lacks taskTruncated marker)

## Acceptance criteria
- #237: `RunStartedEvent` carries `taskTruncated?: boolean` mirroring `RunCompletedEvent.outputTruncated`; normalize.ts AgentStarted case carries raw `taskTruncated`; new test proves `taskTruncated: true` flows through and absent stays absent (historical traces byte-identical). `bun test packages/trace` green, `bunx turbo run typecheck --filter=@reactive-agents/trace` green, 0 new `as unknown as`.

## GROUND (parent, pre-dispatch — VERIFIED 2026-10-16)
- Core `AgentStarted.taskTruncated?: boolean` exists at event-bus.ts:427 ("True iff `task` was clipped to the 64KB publisher cap").
- `RunStartedEvent` interface (events.ts:88-95) lacks `taskTruncated` — field dropped.
- `RunCompletedEvent.outputTruncated?: boolean` (events.ts:103) is the exact precedent to mirror.
- normalize.ts AgentStarted case (lines 47-64) builds RunStartedEvent but doesn't carry raw.taskTruncated; AgentCompleted case (line 89) carries outputTruncated via `...(raw.outputTruncated === true ? { outputTruncated: true } : {})`.
- normalize.test.ts exists with toTraceEvent mapping tests — pattern to follow for the new test.
- No warden needed (packages/trace not in warden table; parent-direct execution).

## Execution units (ordered)
1. **Unit 1 (parent, TDD):**
   - RED: new test in normalize.test.ts — AgentStarted with taskTruncated: true → RunStartedEvent carries taskTruncated: true; AgentStarted without taskTruncated → field absent. Watch it fail (field missing / undefined).
   - GREEN: add `readonly taskTruncated?: boolean` to RunStartedEvent (events.ts); add `...(raw.taskTruncated === true ? { taskTruncated: true } : {})` to normalize.ts AgentStarted case.
   - REVIEW: confirm absent-stays-absent (no field when undefined, not `taskTruncated: false`).
   - COMMIT.
2. **Unit 2 (parent verifier):** `bun test packages/trace` green; `bunx turbo run typecheck --filter=@reactive-agents/trace` green; `grep -c "taskTruncated" packages/trace/src/events.ts packages/trace/src/normalize.ts` → 2 new sites; 0 new as unknown as.

## Risk register
- Test writes `taskTruncated: false` explicitly instead of absent → mitigation: assert field absent when raw doesn't provide it (toMatchObject / key check), mirroring outputTruncated precedent which only sets when `=== true`.
- Other consumers of RunStartedEvent (recorder, replay) need no change — field is optional, additive.
- Historical goldens byte-identical — field absent when not provided.

## Verification protocol
- `bun test packages/trace` → green (baseline + new test)
- `bunx turbo run typecheck --filter=@reactive-agents/trace` → green
- New test: taskTruncated:true flows through; taskTruncated absent → field absent
- 0 new `as unknown as`

## Out-of-scope (explicit)
- Changing the 64KB cap or publisher logic
- Adding taskTruncated to other event types
- #206/#213/#217-#222/#238/#240/#242/#249/#250 (design pass needed or larger than budget)

## Baseline
- dev HEAD `4c62509c` (#226 closed). Working on `dev`, 6 commits ahead of `origin/dev`.
- Baseline: `bun test packages/trace` → (record below); `bunx turbo run typecheck --filter=@reactive-agents/trace` → green.
