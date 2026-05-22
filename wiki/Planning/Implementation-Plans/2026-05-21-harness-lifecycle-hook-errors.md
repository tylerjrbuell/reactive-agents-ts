# Bundle: harness-lifecycle-hook-errors

Date: 2026-05-21
Budget: 60 min
Issues: #74 (HS-14)

## Acceptance criteria

- **#74:** `builder.ts:794,807` no longer silently discard hook handler errors. When a user lifecycle hook throws (sync or async), the error is routed to `self._errorHandler` if registered, else surfaced via `console.warn`. Test asserts the throw is observable (not swallowed).
- Verified-by recheck: `grep -n '.catch(() => undefined)' packages/runtime/src/builder.ts` → only sites remaining are intentional non-hook ones (lines 2019-style swallow on `Effect.runPromise`, which is unrelated).

## Cross-package descope decision

Issue body's "Fix direction" mentions `AgentEvent.HookFailed`. That would touch `packages/core/src/services/event-bus.ts` (AgentEvent union has no HookFailed variant). Per Phase 2 hard gate (cross-package descope), restrict bundle to `packages/runtime/` only — route to existing `_errorHandler` path. Adding `HookFailed` event = follow-up bundle (own issue, own PR).

## Execution units

1. **Unit 1 — RED test** (`packages/runtime/tests/builder/lifecycle-hook-errors.test.ts`)
   - Hook with `withErrorHandler` registered → hook handler throws → assert error handler invoked with the thrown error and matching phase context
   - Hook without `withErrorHandler` → hook handler throws → assert `console.warn` called (spy)
   - Test covers both timings: `before`/`after` (line 807 site) and `on-error` (line 794 site)
2. **Unit 2 — GREEN fix** in `builder.ts:786-810`
   - Replace `.catch(() => undefined)` + outer `try{}catch{}` with a single helper that resolves the promise, catches any error, and routes to `self._errorHandler ?? console.warn`
   - Synthetic ctx: `{ taskId: '', phase: hook.phase, iteration: ctx.iteration }`
3. **Unit 3 — REVIEW** via review-patterns; commit

## Risk register

- **Risk:** test races on async hook resolution → use `await Promise.resolve()` discipline in fix + `vi.waitFor`/explicit await in test
- **Risk:** existing tests assert silent-swallow behavior → if any break, they encoded the bug; update them to assert routing instead
- **Risk:** `_errorHandler` is `undefined` at the time `withHook` runs but set later via `withErrorHandler` → fix must read `self._errorHandler` *at fire time*, not at registration time (closure must capture `self`, not the field value)

## Verification protocol

- `rtk bun test packages/runtime/ --timeout 30000` — full pass, no net-new fail vs baseline
- `rtk bun run build` — green
- `rtk bunx turbo run typecheck --filter=@reactive-agents/runtime` — green
- `rtk grep -c '.catch(() => undefined)' packages/runtime/src/builder.ts` — count drops to baseline-2

## Out of scope (explicit)

- Adding `AgentEvent.HookFailed` to core — follow-up bundle
- Cleaning up the parallel `as any` cast on line 794/807 hook ctx — separate typing concern, file as next-bundle candidate
- Other `.catch(() => undefined)` sites in builder.ts (e.g., line 2019 build error path) — different semantic, out of scope

## Baseline (captured 2026-05-21 pre-EXECUTE)

- `rtk bunx turbo run build` → **38/38 successful** (37 cached)
- `rtk bun test packages/runtime/` → **792 pass / 0 fail / 1 skip** (793 across 115 files, 25.65s)
- `grep -c '.catch(() => undefined)' packages/runtime/src/builder.ts` → 3 (lines 794, 807, 2019 — only 794+807 are hook sites)
