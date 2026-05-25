# Bundle: ri-handler-types-and-skill-resolver-tests
Date: 2026-05-25
Budget: 60 min
Issues: #85, #81

## Context

Both fixes live in `packages/reactive-intelligence/`. Same-package cohesion.

### #85 (HS-29 — 9 sites in handlers/index.ts)

`packages/reactive-intelligence/src/controller/handlers/index.ts:16-24` — 9 `as unknown as InterventionHandler` casts at registry construction. Root: `InterventionHandler<TDecision>`'s `execute` takes contravariant `Extract<ControllerDecision, {decision: TDecision}>`; `InterventionHandler<"early-stop">` is NOT assignable to `InterventionHandler<full-union>` because narrowing-input-functions aren't assignable to widening-input-functions.

**Drift:** 0 (exact 9 sites at exact lines 16-24).

### #81 (HS-25 — 2 skipped tests in skill-resolver.test.ts)

`packages/reactive-intelligence/tests/skills/skill-resolver.test.ts:253,280` — 2 `it.skip` blocks. Root: tests call `makeLayer([])` with `projectRoot: TMP_DIR`, but `discoverSkills` ALSO scans `~/.agents/skills` and `~/.reactive-agents/skills` (the `skipGlobalPaths` param exists at `skill-registry.ts:194` but is never plumbed through `SkillResolverConfig`). User's HOME globally-installed skills pollute the test.

**Drift:** +5 lines on both (248→253, 269→280); semantic intact.

## Acceptance criteria

- **#85**: `rtk grep -c 'as unknown as InterventionHandler' packages/reactive-intelligence/src/controller/handlers/index.ts` → 0. A typed `asInterventionHandler<T>` helper exported from `intervention.ts` is the single named cast site.
- **#81**: Both previously-skipped tests pass with `it(...)` (un-skipped). `SkillResolverConfig.skipGlobalPaths?: boolean` plumbed through to `discoverSkills`.

## Baseline (2026-05-25, branch bundle/ri-handler-types-and-skill-resolver-tests)

- `bun test packages/reactive-intelligence/` → **474 pass / 2 skip / 0 fail** / 1192 expect calls / 69 files
- `bunx turbo run typecheck --filter=@reactive-agents/reactive-intelligence` → **RED (pre-existing)**:
  - 5 sites in `tests/controller/dispatcher-compose-bridge.test.ts` (lines 103,128,129,130,153) — `InterventionHandler<"specific">` not assignable to `InterventionHandler<full-union>` at `registerHandler(dispatcher, handler)` calls. **Adjacent to #85** — my helper will resolve these as a side-effect.
  - Pre-existing unrelated reds: `EntropyScore.token`, `payload: any`, `number → void | Promise<void>` in same file. Out-of-scope; will document in PR body.

## Adjacent improvement found

`tests/controller/dispatcher-compose-bridge.test.ts:103,128,129,130,153` exhibit the exact same `InterventionHandler<TDecision>` contravariance issue as the 9 sites in `handlers/index.ts`. The new `asInterventionHandler` helper from Unit 1 should be applied to these 5 test sites too — same root cause, identical fix shape, no scope creep (still single package, single fix concept).

## Execution units (ordered)

1. **Unit 1 (#85)**: Add `asInterventionHandler<T>(handler: InterventionHandler<T>): InterventionHandler` helper in `intervention.ts`. Replace 9 cast sites in `handlers/index.ts` with helper calls. RED: existing `bun test packages/reactive-intelligence/` should remain green; type-level RED is weak per SKILL.md v10 (tests excluded from typecheck).
2. **Unit 2 (#81)**: Add `skipGlobalPaths?: boolean` to `SkillResolverConfig`; plumb to `discoverSkills(...)` call at skill-resolver.ts:176. Update tests' `makeLayer` to pass `skipGlobalPaths: true`. Un-skip both `it.skip` blocks. Remove the HS-25 rationale comments.

## Risk register

- **Risk #85:** Production typechecking may catch a mismatched handler shape (e.g., a future handler with wrong `type` discriminant slipped through the cast). → **Mitigation:** the helper's generic constraint `<T extends ControllerDecision["decision"]>` keeps per-handler type safety; only the outer assignment to `InterventionHandler<full-union>` is erased.
- **Risk #81:** `skipGlobalPaths: true` may hide a legitimate production scenario where global skills SHOULD merge into resolver output. → **Mitigation:** flag defaults to `false`; tests opt-in; no production-config change.

## Verification protocol

- `rtk bun test packages/reactive-intelligence/` — full pass, +2 un-skipped tests
- `rtk bun run build` — green
- `rtk bunx turbo run typecheck --filter=@reactive-agents/reactive-intelligence` — green
- Re-grep #85: `rtk grep -c 'as unknown as InterventionHandler' packages/reactive-intelligence/src/controller/handlers/index.ts` → 0
- Re-grep #81: `rtk grep -c 'it.skip' packages/reactive-intelligence/tests/skills/skill-resolver.test.ts` → 0

## Out-of-scope

- Cross-package `as unknown as` sweep (HS-31) — separate bundle, cross-package descope gate.
- Removing the `defaultInterventionConfig` modes hardcoding — pre-existing pattern; not in HS-29.
