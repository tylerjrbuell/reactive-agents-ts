---
type: implementation-plan
status: completed
created: 2026-09-28
completed: 2026-09-28
tags: [execute-backlog, health-sweep, runtime, subscribe, observability, dead-code, bundle]
---

# Bundle: runtime-subscribe-silent-fallback

Date: 2026-09-28
Budget: 60 min
Issues: #224
Branch: `bundle/runtime-subscribe-silent-fallback` (off local `dev`)
Warden: `runtime-warden` (scope: `packages/runtime/**`)

## Why this bundle

`ReactiveAgent.subscribe()` (both overloads) ends with
`Effect.catchAll(() => Effect.succeed(() => {}))` — a no-op unsubscribe
fallback that the issue describes as a silent degradation when `EventBus`
resolution fails.

## SCAN finding — the issue's premise is false (proven, not inferred)

1. `EventBus.subscribe` / `EventBus.on` are typed `Effect.Effect<() => void, never>`
   (`packages/core/src/services/event-bus.ts:1446,1473`). Their error channel is
   `never`, so `Effect.catchAll` **cannot fire**.
2. Requesting the `EventBus` tag when the service is absent produces a **defect**
   ("Service not found: EventBus"), and `Effect.catchAll` does not catch defects.
   Empirical probe (`/tmp/opencode/probe-subscribe.ts`, bun):
   `EventBus.pipe(flatMap(eb => eb.subscribe(...)), catchAll(() => succeed(() => {})))`
   run with no EventBus supplied → **REJECTED**: `(FiberFailure) Error: Service not
   found: EventBus`. It did **not** resolve to the no-op.
3. `EventBus` is a **mandatory** runtime layer: `createRuntime` always merges
   `eventBusLayer` (`runtime.ts:1125-1140`, `Layer.mergeAll(coreLayer, eventBusLayer, …)`;
   `createLightRuntime` likewise at `runtime.ts:1305`). Resolution does not fail in practice.

**Conclusion:** the two `catchAll(() => Effect.succeed(() => {}))` clauses are
**unreachable dead code** that misrepresents the failure mode. There was never a
silent no-op; a missing EventBus would already surface loudly as a defect. The
honest root fix is to delete the dead misdirection and document the invariant —
not to wire `emitErrorSwallowed` into an unreachable branch.

## Acceptance criteria (per issue)

- **#224:** both dead `catchAll(() => Effect.succeed(() => {}))` clauses are removed;
  a comment records that `EventBus` is a mandatory runtime layer and that
  `subscribe`/`on` are `never`-error, so a missing service surfaces as a defect
  rather than a silent no-op; end-to-end tests pin real delivery + unsubscribe for
  the catch-all and tag-filtered overloads; runtime suite unchanged
  (1635 pass / 3 skip / 2 known-#214 fail); typecheck + build green; 0 new casts.

## Execution units (ordered)

1. **Unit 1 — delete dead fallback + pin behavior (single warden pass, ≤40 min).**
   - File: `packages/runtime/src/reactive-agent.ts` (`subscribe` overloads, ~3138-3170).
   - Delete both `Effect.catchAll(() => Effect.succeed(() => {}))` clauses. Remove the
     now-unnecessary `as Effect.Effect<() => void>` cast **only if** it compiles without it;
     otherwise keep (it's a plain `as`, not `as unknown as`).
   - Add an explanatory comment at the shared site (invariant + why no fallback).
   - New test: `packages/runtime/tests/subscribe-delivery.test.ts` — real built agent,
     real run, asserting:
     (a) catch-all `subscribe(handler)` receives run events and `unsub()` is a function;
     (b) after `unsub()`, no further events are delivered;
     (c) tag-filtered `subscribe("AgentCompleted", handler)` receives only matching events;
     (d) `agent.on("AgentCompleted", cb)` delivers equivalently.
     Mirror the event-collection pattern in `packages/runtime/tests/error-reporting.test.ts`.

## Gate: runtime-warden routing

Primary scope is `packages/runtime/**` → per AGENTS.md team-ownership contract,
dispatch `runtime-warden` with MissionBrief (MissionBrief-in → UpwardReport-out).
Parent verifies; no self-review re-prompt.

## Risk register

- **Removing the cast breaks types** → keep the cast if typecheck objects; it is not a
  cast-ceiling site (`as`, not `as unknown as`).
- **Behavior change** → none expected: the removed branch was unreachable (probe-proven).
  Tests confirm delivery/unsubscribe.
- **Cast ceiling** (`#214`) → new test must add 0 `as unknown as` sites; baseline reds
  are the two ceiling tests, tracked separately.
- **`Effect.succeed` import pruning** → still used elsewhere in the file (141 `Effect.`
  references); no import change expected.

## Verification protocol (cross-cutting)

- `bun test packages/runtime` — 1635 pass / 3 skip / **2 known-#214 fail** (no net-new)
- `bun test packages/runtime/tests/subscribe-delivery.test.ts` — green
- `bun test packages/runtime/tests/error-reporting.test.ts` — green (existing subscribe net)
- `bunx turbo run typecheck --filter=@reactive-agents/runtime` — green
- `bun test packages/runtime/test/as-unknown-as-ceiling.test.ts` — new test contributes 0
- `bun run build` — 38/38
- Re-run #224 verified-by: `grep -rn "catchAll(() => Effect.succeed(() => {})" packages/runtime/src` → 0

## Baseline

- `bun test packages/runtime` → 1635 pass, 3 skip, **2 fail** (both `as unknown as`
  ceiling tests, pre-existing #214)
- `bun run build` → verified at bundle verify step (cached green)

## Out-of-scope (explicit)

- `#214` cast-ceiling sweep (the 2 baseline reds)
- Any edit outside `packages/runtime/**`
- Adding a new runtime-wide EventBus invariant test (the delivery tests pin it behaviorally)

## Outcome

- Commit `31fe0689` (deletion + invariant comment + test) merged to local `dev`.
- Both dead `catchAll(() => Effect.succeed(() => {}))` clauses removed; redundant
  `as Effect.Effect<() => void>` casts removed (typecheck clean).
- Verified-by recheck: `grep -rn "catchAll(() => Effect.succeed(() => {})" packages/runtime/src` → **0**.
- runtime `1639 pass / 3 skip / 2 fail` (baseline 1635 + 4 new; the 2 fails are the
  pre-existing `#214` ceiling tests, not this bundle); targeted `11/0`;
  runtime typecheck `21/21`; workspace typecheck `68/68`; build `38/38`.
- New test contributes **0** `as unknown as` sites (tests-scope ratchet unchanged at 266).
- Workspace `bun run test` red is the pre-existing `#230` North Star cwd-relative
  baseline artifact (`bun test packages/testing` from root → `53/0`).
- Retro: [[Research/Debriefs/2026-09-28-runtime-subscribe-silent-fallback-execution-debrief]]
- **Note:** the issue's premise was falsified (probe-proven); it closed as
  "premise falsified / dead code removed", not by implementing its suggested
  `emitErrorSwallowed` fallback.
