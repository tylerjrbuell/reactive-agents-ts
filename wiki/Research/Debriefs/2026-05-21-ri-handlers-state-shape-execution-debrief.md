# Execution Retro: ri-handlers-state-shape
Date: 2026-05-21
Budget: 90 min | Actual: ~35 min

## Outcomes
- Issues closed (pending merge): #71 (HS-06)
- Issues descoped: none
- Net test delta: +0 / -0 (workspace stays at 455/0/3 baseline for reactive-intelligence)
- Net LOC delta: +103 / -10 (one new file `handler-state.ts` + 7 small handler edits + plan)

## What worked
- **`PatchedState` precedent at `patch-applier.ts:4` made the architectural call easy** — local widening type was already the established pattern for handling KernelStateLike's intentional under-specification. Issue body's "OR define `ExtendedControllerState`" lined up exactly.
- **Single named boundary cast** — `asHandlerState()` is the only place `as` appears post-fix. Each handler reads typed fields. Inflation impossible.
- **`context-compress.ts` discovery** — `(state as any).tokens` was a *dead* cast: `tokens: number` is already on `KernelStateLike`. Removed entirely (no widening needed). Reduces site count without adding a cast.
- **v2 SKILL.md amendment paid off immediately** — prior session's Hot.md had blanket-deferred #68/#69/#71 with the cross-package gate. v2 clarified the gate is per-bundle, not per-cohort, which is exactly what unblocked #71 (single-package, single-file `handler-state.ts` widening).

## What didn't
- **Initial drift check nearly false-positived** — grepped `(state as any)` only, got 3 sites vs the issue's claim of 7. Almost flagged `🟡 drift detected`. Re-grepping with `(state as any)` PLUS `as unknown as {` revealed the real total of 7 (3 raw + 4 narrowing-variant). Drift logic in SKILL.md only checks line-number movement, not semantic-equivalent pattern variants.
- **`context-compress.ts` was already partially-fixed** — `tokens` reachable via clean `state.tokens`. Issue body listed it among "5 missing fields" but it isn't missing. Issue authors over-counted by 1. Saved ~3 min by reading the type before adding to widening.
- **Field name `currentStrategy` is fixture-only** — production state uses `strategy` (KernelStateLike canonical). Kept `currentStrategy?` in `HandlerState` for legacy test fixtures, but it's worth deleting once tests are normalized. Adjacent cleanup, not in scope.

## Skill improvements (apply on next pass)
1. **Phase 1 SCAN — broaden the drift check to semantic-equivalent patterns.** Today's drift gate only compares line numbers. But site counts can mismatch when the same anti-pattern shows up in two syntactic forms (`(x as any)` ↔ `(x as unknown as {…})`). When `grep -c <claimed-pattern>` returns FEWER hits than the issue body claims, additionally grep for known equivalents before declaring drift. Suggested equivalence pairs:
   - `as any` ↔ `as unknown as`
   - `: any` ↔ `: unknown` (intentional rejections) ↔ `: Record<string, any>`
   - `Function` ↔ `(...args: any[]) => any`

   Codify as: "If claim says N sites and primary grep returns <N, run the equivalence-class grep too. Sum the matches. If sum matches claim, proceed (no drift). If sum is still off, mark drift and re-read."

## Process inflation guard (HS-18/22/31 lesson)
- **No inflation detected.** Site count exactly matched (7) once the narrowing-variant pattern was included. Field count was inflated by 1 in the issue body (`tokens` is on `KernelStateLike`, not "missing") — that's a *minor* claim inflation, but it shrunk the fix (one fewer field to widen), not grew it. The verified-by command form (grep-counting) caught the architectural lie before code touched.
