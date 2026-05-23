---
type: debrief
status: completed
created: 2026-05-23
feature: hs-122-skill-persistence-wire
warden: runtime-warden
verdict: PASS
tags: [harness-convergence, anti-scaffold, m6-graduation, skill-persistence, pilot]
related:
  - "[[2026-05-23-harness-convergence]]"
  - "[[2026-05-23-team-ownership-dev-contract-pilot]]"
  - "[[2026-05-23-hs-115-required-tool-nomination-debrief]]"
  - "[[2026-05-23-hs-116-controller-decision-classification-debrief]]"
---

# Debrief — HS-122 Skill Persistence Runtime Wire (2026-05-23)

## Feature
Single-commit landing (`44e4fbcf`, +299/-1 across 4 files) wiring `SkillStoreServiceLive` into the runtime layer composition. New `RuntimeOptions.skillPersistence?: boolean` field + `.withSkillPersistence(enabled=true)` builder chainable, with forwarding through `BuilderRuntimeStateView`. Gating policy (advisor-corrected from mission-brief pseudocode): `options.enableMemory && options.skillPersistence !== false` — default-on when memory enabled, no force-enable without memory. Mirrors `SessionStoreLive` precedent at `runtime.ts:1354`.

## Motivation
Phase 1 M6 verdict was **IMPROVE**: "learning transfers within session but doesn't persist." Root cause: `SkillStoreServiceLive` had existed at `packages/memory/services/skill-store.ts:73` and was exported via `memory/index.ts:157` since the memory package landed — but it had **zero runtime consumer**. `agent.skills()` always returned `[]` via the `Effect.serviceOption` fallback at `reactive-agent.ts:370`, and the `learning-engine.ts:172` persistence write path was unreachable. Classic North Star §9 anti-scaffold (declared layer, no caller). Issue [#122](https://github.com/tylerjrbuell/reactive-agents-ts/issues/122) tasked closure to graduate M6 IMPROVE → KEEP and unblock HS-116 skill-activate 🟡 UNFIRED variant reachability.

## What Shipped
- **`runtime.ts:16`** — `SkillStoreServiceLive` import
- **`runtime.ts:713-741`** — `RuntimeOptions.skillPersistence?: boolean` field + JSDoc
- **`runtime.ts:1372-1383`** — wire block (`Layer.merge` with `Layer.provide memoryLayer`)
- **`builder.ts:395`** — private `_skillPersistence` field
- **`builder.ts:817-839`** — `.withSkillPersistence(enabled=true)` chainable
- **`runtime-construction.ts:113,354`** — forward through `BuilderRuntimeStateView`
- **`builder-with-skill-persistence.test.ts`** — 7 new tests (chainable, state-field, both-flags-on, default-on-with-memory, explicit-false-disables, absent-without-memory, **cross-session-recall**)

Same-commit emit+consumer per §9: the layer is wired AND consumed by the new cross-session integration test proving `SkillStoreService.listAll()` returns the persisted record after runtime dispose/rebuild with shared `dbPath`.

## Evidence
- `bun test packages/runtime`: **824 pass / 1 skip** (was 817; **+7**, 0 fail)
- Typecheck delta: **0 new errors** (pre-existing `focusedTools` + `ExecutionContext` errors verified unrelated via `git stash` ablation)
- Cross-session recall test green — proves persistence across dispose/rebuild
- runtime-warden confidence **high**, authority-bounds-honored=true, zero cross-package edits, **0 retries**

## Pilot Data (dispatch #8)
- **Warden:** runtime-warden, routed via Agent dispatch, ~95K tokens
- **Autonomous judgments:**
  1. Advisor-driven correction of mission-brief gating pseudocode (`?? options.enableMemory` would have force-enabled without memory; chose `enableMemory && sp !== false` instead — surfaced contradiction with "no force-enable" invariant)
  2. Mirrored `SessionStoreLive` precedent exactly for wire pattern (zero novel composition)
  3. Test suite covers all four `(enableMemory × skillPersistence)` gate cells exhaustively
- **Pilot-positive signal:** warden caught and resolved a mission-brief contradiction *before* committing, via advisor consult — exactly the regression-prevention behavior the pilot doctrine targets. Filed as `regression-prevented: mission-brief-pseudocode-contradiction` in pilot log.

## Invariants Preserved
- **§9 same-commit emit+consumer** — wire site + cross-session test landed together
- **No force-enable without memory** — `skillPersistence: true` alone (without `enableMemory: true`) is a no-op; persistence requires the memory subsystem
- **Default-on policy** — when `enableMemory` is true and `skillPersistence` is unset, persistence wires automatically (the desired ergonomic default for M6 graduation)
- **Authority manifest** — zero edits outside `packages/runtime/**`; no `any` casts in production (existing wire-block `as any` mirrors established pattern; 2 `Layer.Layer<any>` casts in test file mirror `with-skills-runtime-wiring` precedent)

## Followups
- **Parallel `.withSessionPersistence()` gap** — `SessionStoreLive` is wired but has no equivalent builder chainable; symmetry-fix candidate
- **`LightRuntimeOptions` skillPersistence forward** — light-runtime path doesn't expose the new option yet
- **Pre-existing `focusedTools` + `ExecutionContext` typecheck noise** — unrelated to this commit; separate cleanup ticket
- **HS-116 corpus sweep** — skill-activate 🟡 UNFIRED variant is now reachable; re-run controller-decision coverage corpus to confirm firing

## Anchors
- Commit: `44e4fbcf`
- Wire site: `packages/runtime/src/runtime.ts:1372-1383`
- Builder API: `packages/runtime/src/builder.ts:817-839` (`.withSkillPersistence`)
- Options field: `packages/runtime/src/runtime.ts:713-741`
- Forward: `packages/runtime/src/builder/build-effect/runtime-construction.ts:113,354`
- Tests: `packages/runtime/src/__tests__/builder-with-skill-persistence.test.ts` (7 tests, +223 LOC)
- Dead layer pre-wire: `packages/memory/services/skill-store.ts:73`, `packages/memory/index.ts:157`
- Pilot log entry: `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md:38-67`
- UpwardReport confidence: **high** (runtime-warden, dispatch #8)
- Issue: [#122](https://github.com/tylerjrbuell/reactive-agents-ts/issues/122)
