# Svelte binding + Cortex showcase — SDD Progress Ledger
Plan: wiki/Planning/Implementation-Plans/2026-07-03-agentic-ui-kit-svelte-cortex.md
Branch: worktree-cortex-agentic-ui (off main 0a2a253f)
## Tasks
- S1: createRun core + rewire agent-stream/agent — DONE (report: .superpowers/sdd/task-s1-report.md)
- S2: createResumableRun + rewire structured-stream — DONE (report: .superpowers/sdd/task-s2-report.md)
- S3: createInteractions + runCost/runSteps + testing subpath — PENDING
- X1: cortex server — interaction methods + .withUserInteraction() + routes — PENDING
- X2: cortex ui — InteractPanel + interaction-watcher (op A) — PENDING
- X3: cortex ui — chat→connectRunStream convergence (op B) + structured preview (op E) — PENDING
- X4: cursor attach/resume (op C) — SCOPED/optional
## Minor findings
- S1: `packages/ui-core/src/state/run-machine.ts` `reduceRunState`'s `StreamCompleted` case crashed when `event.metadata` was absent (typed required, not guaranteed at runtime) — legacy `smoke.test.ts` fixture omits it. Fixed with a one-line guard (`event.metadata ?? {}`); out-of-scope file touch, flagged in task-s1-report.md.
- S1: `agent.ts`'s pre-existing `smoke.test.ts` mocks a plain single-shot JSON endpoint (non-SSE) — incompatible with `createRun`'s SSE-only wire protocol. Reconciled via a `compatFetch` adapter (passthrough real SSE, synthesize SSE events for legacy JSON) rather than changing the test or dropping the rewire. See task-s1-report.md Deviations.
- S1 LOW (final-review): run.ts drive() theoretical race on rapid run()/cancel() (aborted StreamCancelled could land after new stream starts) — plan-snippet inherited, untested. reduceRunState only guards StreamCompleted.metadata; CostDelta/RunPaused branches still destructure unguarded (not a systemic input boundary).
- S2: the plan's literal `structured-stream.ts` rewire (`run()` returning `Promise.resolve()` immediately) broke the existing `structured-stream.test.ts` — that suite's behavioral tests do `await stream.run(...)` then assert terminal state synchronously (no `settle()`), which only holds if `run()` awaits completion (the pre-rewire implementation drove its own reader loop to completion before returning). Fixed by mirroring `createAgent`'s resolver pattern: `run()` returns a `Promise` resolved when `createRun`'s inner state reaches a terminal status (completed/error/cancelled). No compatFetch shim was needed — the test's mock emits real `data:`-line SSE with `content-type: text/event-stream`, so `connectRunStream` parses it directly.
