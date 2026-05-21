# Bundle: ri-handlers-state-shape
Date: 2026-05-21
Budget: 90 min
Issues: #71

## Acceptance criteria (per issue)
- **#71 HS-06:** `grep -c '(state as any)' packages/reactive-intelligence/src/controller/handlers/` returns 0; `grep -c 'as unknown as {' packages/reactive-intelligence/src/controller/handlers/` returns 0; all 7 untyped reads (`currentOptions`, `tokens`, `activatedSkills`, `controllerDecisionLog`, `currentStrategy`) go through a single named `HandlerState` widening type; tests + typecheck stay green.

## Baseline (pre-execute)
- `bun test packages/reactive-intelligence/` → **455 pass / 3 skip / 0 fail**
- `bunx turbo run typecheck --filter=@reactive-agents/reactive-intelligence` → **6/6 successful**
- `grep -rn '(state as any)' …/handlers/` → 3 sites (temp-adjust.ts:9, context-compress.ts:11, skill-activate.ts:22)
- `grep -rn 'as unknown as {' …/handlers/` → 4 sites (switch-strategy.ts:12 partial, harness-harm-detector.ts:31, stall-detector.ts:41, tool-failure-redirect.ts:15)
- Total: **7 sites**, matches issue body exactly.

## Architectural decision
Cross-package extension of `KernelStateLike` (in `@reactive-agents/core`) is forbidden by Phase 2 hard gate. Local widening type in `reactive-intelligence` is the issue body's stated alternative ("OR define `ExtendedControllerState`"). Pattern mirrors `PatchedState` already used at `patch-applier.ts:4`.

## Execution units (ordered)
1. **Unit 1 — Define `HandlerState` widening + `asHandlerState` boundary** (≤10 min)
   - New file: `packages/reactive-intelligence/src/controller/handler-state.ts`
   - Exports `HandlerState = Readonly<KernelStateLike> & { currentOptions?, activatedSkills?, controllerDecisionLog?, currentStrategy? }` and `asHandlerState(state)` helper (single named cast point).
2. **Unit 2 — Migrate 7 handler files** (≤25 min)
   - `temp-adjust.ts:9` → `const s = asHandlerState(state); s.currentOptions?.temperature`
   - `context-compress.ts:11` → `state.tokens` (already on KernelStateLike — drop cast entirely)
   - `skill-activate.ts:22` → `asHandlerState(state).activatedSkills`
   - `switch-strategy.ts:12` → `const s = asHandlerState(state); s.strategy ?? s.currentStrategy`
   - `stall-detector.ts:41` → `asHandlerState(state).controllerDecisionLog ?? []`
   - `harness-harm-detector.ts:31` → same as above
   - `tool-failure-redirect.ts:15` → same as above
3. **Unit 3 — Verify** (≤5 min)
   - Grep counts → 0; reactive-intelligence tests 455/0; build green.

## Risk register
- **Risk:** `context-compress.ts` access `state.tokens` is required on `KernelStateLike` but tests pass partial fixtures (`{} as any`) where it's `undefined`. **Mitigation:** keep the `?? 0` defensive coalesce; TS allows it on `number` (no warning under current config) and runtime stays safe.
- **Risk:** Test fixtures cast `as any` (e.g. `skill-activate.test.ts:9`) — typing the production code stricter could expose stale fixture shapes. **Mitigation:** tests remain `as any` (out of scope per issue); production cast moves behind named boundary.
- **Risk:** `index.ts` has 9 `as unknown as InterventionHandler` lines for handler registry — that's a separate concern (TDecision parametrization), not HS-06. **Mitigation:** explicitly out of scope; verified-by greps target handler files only.

## Verification protocol (cross-cutting)
- `rtk bun test packages/reactive-intelligence/` — no net-new failures vs 455/0 baseline
- `rtk bun run build` — full monorepo green
- `rtk bunx turbo run typecheck --filter=@reactive-agents/reactive-intelligence` — green
- `{ rtk grep -rn '(state as any)' packages/reactive-intelligence/src/controller/handlers/ || true; }` — returns 0 lines
- `{ rtk grep -rn 'as unknown as {' packages/reactive-intelligence/src/controller/handlers/ || true; }` — returns 0 lines

## Out-of-scope (explicit)
- Extending `KernelStateLike` in `@reactive-agents/core` — cross-package, forbidden by gate; revisit when next bundle takes core changes.
- `handlers/index.ts` `as unknown as InterventionHandler` — registry-level concern, not state-shape.
- Test fixture `as any` casts — production typing is the contract; tests intentionally pass partial shapes.
- Other `as any` outside `controller/handlers/` (separate HS-NN findings).
