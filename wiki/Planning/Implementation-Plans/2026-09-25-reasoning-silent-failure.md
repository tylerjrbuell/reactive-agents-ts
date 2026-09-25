---
type: implementation-plan
status: completed
created: 2026-09-25
completed: 2026-09-25
tags: [execute-backlog, health-sweep, kernel, observability, error-swallowed, bundle]
---

# Bundle: reasoning-silent-failure

Date: 2026-09-25
Budget: 90 min
Issues: #223
Tracker: none (singleton bundle)
Branch: `bundle/reasoning-silent-failure` (off local `dev`)
Warden: `kernel-warden` (scope: `packages/reasoning/src/kernel/**`)

## Why this bundle

`packages/reasoning/src/kernel/capabilities/reflect/reactive-observer.ts` is the
kernel's inline entropy-scoring / reactive-controller path (`runReactiveObserver`).
It contains **8** bare `Effect.catchAll(() => Effect.void)` sites that swallow
failures with no diagnostic trail. Line 169 swallows failures of
`entropySensor.score(...)` itself — the load-bearing input for the Reactive
Controller and calibration/drift detection ("one entropy scorer per thought",
AGENTS.md pitfall #10). A failed score degrades the controller silently; there is
no way to diagnose why calibration stopped updating.

The package already uses `emitErrorSwallowed` from `@reactive-agents/core` in
~18 other files (issue said 60 — see drift note), so the fix is a wiring change,
not a new mechanism.

## SCAN drift note (recorded before bundling)

| Claim | Issue says | Actual | Verdict |
|---|---|---|---|
| catchAll sites + lines | 8 @ 135/169/214/328/434/485/562/615 | 8 @ exact same lines | ✅ no drift |
| `emitErrorSwallowed` files in `packages/reasoning/src` | 60 | 18 | 🟡 supporting claim stale; fix shape unaffected |

## Acceptance criteria (per issue)

- **#223:** All 8 bare `Effect.catchAll(() => Effect.void)` sites in
  `reactive-observer.ts` are replaced with `Effect.catchAll((err) =>
  emitErrorSwallowed({ site, tag: errorTag(err) }))`; a regression test proves the
  line-169 score-failure path publishes an `ErrorSwallowed` event; reasoning
  package suite green; workspace typecheck green; build green.

## Execution units (ordered)

1. **Unit 1 — wire + pin (single warden pass, ≤45 min).**
   - File: `packages/reasoning/src/kernel/capabilities/reflect/reactive-observer.ts`
   - Test: `packages/reasoning/tests/kernel/capabilities/reflect/reactive-observer-error-swallowed.test.ts`
   - Sites: 135 (ObservableLogger emit), 169 (score pipeline — critical),
     214 (CalibrationDrift), 328 (ReactiveDecision), 434 (InterventionDispatched),
     485 + 615 (CompressionRecommendation, 2 sources), 562 (InterventionSuppressed).
   - Import `{ emitErrorSwallowed, errorTag }` from `@reactive-agents/core`.
   - `site` strings must be unique + match
     `<package>/<path>.ts:<line>` (enforced by
     `packages/runtime/tests/error-swallowed-wiring.test.ts`).

## Gate: kernel-warden routing

Primary scope is `packages/reasoning/src/kernel/**` → per AGENTS.md
team-ownership contract, dispatch `kernel-warden` with MissionBrief
(MissionBrief-in → UpwardReport-out). Parent verifies; no self-review re-prompt.

## Risk register

- **Ambient `EventBus` not in kernel effect context** → `emitErrorSwallowed` is a
  no-op. Mitigation: `StrategyServices.eventBus` is itself resolved from the
  ambient `EventBus` service (`service-utils.ts:192`), so any run that passes
  `Some(eventBus)` has it in context. Test provides `EventBusLive` explicitly.
- **Behaviour change** → none expected: the fallback value stays `void`; the
  helper never throws and never changes the requirements set.
- **Site-string collision** → guard against by using distinct line anchors;
  the runtime wiring test fails on duplicates.
- **Scope creep** into the 3 `catchAll(() => Effect.succeed(...))` fallback sites
  (195/222/394) → explicitly OUT OF SCOPE; those are recovery-with-default, not
  silent swallows.

## Verification protocol (cross-cutting)

- `bun test packages/reasoning` — full pass (baseline 2888 pass / 4 todo / 0 fail)
- `bunx turbo run typecheck --filter=@reactive-agents/reasoning` — green
- `bun test packages/runtime/tests/error-swallowed-wiring.test.ts` — site conventions green
- `bun test packages/runtime/test/as-unknown-as-ceiling.test.ts` — new test contributes **0** `as unknown as` sites (tests-scope count unchanged at 266)
- `bun run build` — 38/38 successful (baseline)
- Re-run #223 verified-by: `grep -c "Effect.catchAll(() => Effect.void)" <file>` → 0

## Baseline

Captured on `bundle/reasoning-silent-failure` before edits:

- `bun run build` → 38 successful, 38 total
- `bun test packages/reasoning` → 2888 pass, 4 todo, 0 fail (2892 tests, 331 files)
- Full-suite reference (Hot.md, 2026-09-25): 9592 pass / 21 fail (pre-existing
  workspace-order logger flake + 2 cast-ceiling checks + 18 Docker timeouts)

## Out-of-scope (explicit)

- The 3 `Effect.catchAll(() => Effect.succeed(...))` recovery sites (195/222/394)
- Any edit outside `packages/reasoning/src/kernel/**`
- Decomposition chores #219/#220/#222 (over-budget, separate bundles)

## Outcome

- Commit `ad8427f6` (code + test) merged to local `dev`.
- `#223` verified-by recheck: 8 bare sites → **0**; 8 `emitErrorSwallowed` sites wired (anchors 136/170/215/329/435/486/563/616).
- reasoning `2890 pass / 4 todo / 0 fail`; targeted `2/0`; typecheck `9/9`;
  workspace typecheck `68/68`; build `38/38`; wiring test `4/0`.
- Cast ceiling: tests-scope pristine `266` preserved (net 0); src `80` unchanged.
- Follow-up filed: **#230** — North Star gate resolves baseline relative to cwd
  (pre-existing; surfaced by turbo cache invalidation, not caused by this bundle).
- Retro: [[Research/Debriefs/2026-09-25-reasoning-silent-failure-execution-debrief]]
