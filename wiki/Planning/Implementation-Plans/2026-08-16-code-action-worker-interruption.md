# Bundle: code-action-worker-interruption
Date: 2026-08-16
Budget: 90 min
Issues: #35

## Baseline
- `bun test packages/reasoning/src/strategies/code-action/`: 36 pass / 0 fail

## Re-verification (#35 had no `verified-by:` evidence)

Issue asked to "audit whether fiber context ... is correctly captured across
the Worker boundary" and "add a regression test for fiber-supervised
cancellation." Read the actual code:

- `packages/reasoning/src/strategies/code-action/sandbox.ts`'s `runInSandbox`
  spawns a real `node:worker_threads` Worker and returns a plain `Promise`.
- `packages/reasoning/src/strategies/code-action.ts:257` wraps it with
  `Effect.tryPromise({ try: () => runInSandbox(...), catch })`.
- `Effect.tryPromise` DOES respect fiber interruption (the `yield*` abandons
  waiting on the promise when interrupted) — but a JS `Promise` isn't
  natively cancelable, so the underlying `Worker` and any in-flight tool call
  it triggered (`toolHandlers`' closures, each doing
  `await Effect.runPromise(toolSvc.execute(...))` from inside the Worker's
  `"message"` event-listener callback — itself outside any Effect fiber,
  since Node's EventEmitter callbacks aren't part of Effect's structured
  concurrency) keep running after the strategy's fiber is interrupted.

Confirmed real and current: a killed/interrupted code-action run can leave a
live Worker thread and an already-dispatched, still-executing tool call
(e.g. `shell-execute`, `file-write`) running unsupervised to completion,
producing side effects after the run was supposed to have stopped.

Fiber context capture itself (the OTHER half of the issue's ask) is fine —
`toolSvc` is captured by a plain JS closure, not looked up via Effect
`Context` inside the callback, so there's no context-loss bug there. The
real gap is purely the interruption-to-Worker-lifecycle link.

## Acceptance criteria
- Interrupting the Effect fiber running `runInSandbox` terminates the
  underlying Worker (verified via `Worker.prototype.terminate` being called,
  observable through a spy/mock or an actually-running Worker exiting).
- Regression test pins this: start `runInSandbox` in a forked fiber, wait for
  it to reach the "tool-call in flight" state, interrupt the fiber, assert
  the Worker was terminated.
- No behavior change to the non-interrupted path (existing 36 tests stay
  green).

## Execution units (ordered)
1. **Unit 1 (~40 min):** refactor `runInSandbox` to return an
   `Effect.Effect<SandboxResult, Error>` via `Effect.async`, whose register
   callback returns an interrupt-finalizer Effect that calls
   `worker.terminate()`. Update `code-action.ts`'s call site (drop the
   `Effect.tryPromise` wrapper — it's already an Effect now).
2. **Unit 2 (~20 min):** update the 8 existing tests in `sandbox.test.ts` +
   the code-action integration tests that exercise the sandbox, since
   `runInSandbox` changes from Promise-returning to Effect-returning.
3. **Unit 3 (~25 min):** new regression test for fiber-supervised
   cancellation (the issue's explicit ask).

## Risk register
- Changing `runInSandbox`'s return type from `Promise` to `Effect` is a
  signature-breaking change for its 2 real consumers (`code-action.ts` +
  its own tests) — mitigated by grepping all consumers first (confirmed:
  exactly those two, no other package imports it) and updating both in the
  same commit.
- An already-in-flight tool call's own `Effect.runPromise(toolSvc.execute)`
  (dispatched from the Worker's message-listener callback) is NOT itself
  interrupted by this fix — only the Worker thread is terminated, which
  stops it from making further calls or completing its overall run. A tool
  call already mid-execution when interruption happens may still finish in
  the background; its result is simply discarded (no listener left to
  receive it). Documenting this as a known residual limitation rather than
  overclaiming full fiber-supervised cancellation of in-flight tool calls
  specifically — out of scope for this bundle's budget.

## Verification protocol (cross-cutting)
- `bun test packages/reasoning/` — full pass, no net-new failures
- `bun run build` — green
- `bunx tsc --noEmit -p packages/reasoning/tsconfig.json` — clean

## Out-of-scope (explicit)
- True cancellation of an already-dispatched in-flight tool call (would
  require threading an interrupt signal into `toolSvc.execute` itself,
  cross-cutting beyond code-action) — documented as a residual limitation,
  not silently left unstated.
