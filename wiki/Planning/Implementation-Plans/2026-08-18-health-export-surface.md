# Bundle: health-export-surface
Date: 2026-08-18
Budget: 45 min
Issues: #155 (HS-D-17 sub-item only)

## Drift note
Issue #155 also claimed HS-D-01 (observe) and HS-D-02 (vue) — both re-verified
DEAD: observe now has `umbrella-wire.test.ts` covering both symbols; vue now
has 3 test files. Not touched by this bundle. HS-D-19 (umbrella) split into
its own bundle per cross-package gate — see
`2026-08-18-umbrella-export-surface.md`.

## Acceptance criteria
- #155 (HS-D-17 portion): `Health` (Context.Tag) and `HealthServerError`
  exported from `packages/health/src/index.ts` get direct test coverage
  asserting shape, matching existing `makeHealthService`/`HealthConfig`
  coverage in `health-service.test.ts`.

## Execution units
1. **Unit 1:** add cases to `packages/health/tests/health-service.test.ts`
   asserting `Health` is a valid Context.Tag and `HealthServerError` produces
   a tagged error with `message`/`cause` fields. ~15 min.

## Baseline
- `bun test packages/health/` → (captured pre-edit below)

## Risk register
- None — pure additive test file, no src changes.

## Verification protocol
- `bun test packages/health/`
- `bunx turbo run typecheck --filter=@reactive-agents/health`

## Out-of-scope
- HS-D-01, HS-D-02 — already resolved, not reopened.
- HS-D-19 — separate bundle (different package).
