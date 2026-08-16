# Execution Retro: code-action-worker-interruption
Date: 2026-08-16
Budget: 90 min | Actual: ~75 min

## Outcomes
- Issues closed: #35
- Issues descoped: none (in-flight-tool-call cancellation explicitly scoped
  out from the start, in the plan doc, not discovered mid-execution)
- Net test delta: +1 (2707 pass in `packages/reasoning/`, was 2706 baseline
  two bundles ago; workspace 8903, was 8902)
- Net LOC delta: +195 / -21 across 5 files (1 commit: `c010a50e`)

## What worked
- Reading the actual code before trusting the issue's framing paid off
  again: the issue said "Worker postMessage handlers use
  `Effect.runPromise`" as if the bug were inside the Worker thread itself.
  It's actually on the HOST side — `runInSandbox`'s Promise-wrapping is what
  breaks interruption; the `Effect.runPromise(toolSvc.execute(...))` inside
  the tool-handler closures is a second, separate, smaller residual gap.
  Getting this distinction right shaped the whole fix (Worker lifecycle
  tied to Effect interruption) instead of chasing the wrong site.
- The regression test proves the fix BEHAVIORALLY (a tool call that would
  only fire if the Worker kept running past interruption) rather than by
  mocking `Worker.prototype.terminate` — stronger evidence, and it caught a
  real test-scaffolding bug of my own (see below) that a mock-based
  assertion would have hidden.
- RED-confirmed properly: reverted `sandbox.ts` + `code-action.ts` via
  `git stash`, reran the new test against the old Promise-based code, got a
  clean failure (signature mismatch cascaded into every test in the file),
  restored the fix. Per the skill's "RED authority check" section, this
  repo's `packages/reasoning/tsconfig.json` excludes `tests/**` from
  typecheck, so a signature change like this wouldn't have failed the type
  gate on its own — runtime RED was the only real proof available, and it
  was checked, not assumed.

## What didn't
- My first draft of the regression test had its own bug, caught only by
  actually running it: `Effect.runPromise(Effect.fork(effect))` forks into
  the scope of that single `runPromise` call, which closes immediately
  after `fork` returns the `Fiber` handle — so the forked fiber was
  interrupted before the sandboxed code even reached its first tool call,
  and the test's own `expect(started).toBe(true)` failed for a reason
  unrelated to the fix under test. A throwaway debug script surfaced a
  SECOND, different symptom (an Effect dual-package-hazard version
  mismatch between `/tmp`-resolved `effect` and the workspace's own) that
  turned out to be irrelevant to the real bug in the actual test file —
  spent a few minutes chasing that red herring before realizing the fix was
  simpler: keep fork + wait + interrupt inside ONE `Effect.gen`/
  `Effect.runPromise` call, matching how the production code itself
  structures fiber lifecycles.

## Skill improvements (apply on next pass)
- **Phase 4 (new gate, alongside the existing RED authority check)**: when a
  regression test forks a fiber specifically to interrupt it later
  (fiber-supervised cancellation tests, the pattern this issue's ask names
  directly), keep `Effect.fork`, the wait-for-condition, and
  `Fiber.interrupt` inside ONE `Effect.gen`/single `Effect.runPromise` call.
  A bare `Effect.runPromise(Effect.fork(effect))` returns a `Fiber` handle
  but its own ephemeral scope closes immediately after, which can interrupt
  the child before the caller ever gets to observe or interrupt it
  deliberately — a false negative that looks like "the fix doesn't work"
  when it's actually a test-authoring bug. (Reason: this bundle's own
  regression-test construction, caught via a throwaway debug script before
  it made it into the committed test — but cost real time chasing.)

## Process inflation guard (HS-18/22/31 lesson)
No inflation. The residual limitation (in-flight tool-call cancellation not
itself covered) is documented in three places consistently — the plan doc's
risk register, the code's own doc comment on `runInSandbox`, and the
issue-close comment — rather than the fix being framed as complete
fiber-supervised cancellation when it isn't, quite.
