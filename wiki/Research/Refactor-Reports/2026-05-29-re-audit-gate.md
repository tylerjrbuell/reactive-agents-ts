---
tags: [refactor, audit, ws-5, gate]
date: 2026-05-29
status: PARTIAL — 4 PASS / 2 MISS — blocks WS-6
related: [[2026-05-28-canonical-refactor]]
---

# Re-Audit Gate Report — Canonical Refactor Foundation Phase

Per master plan `wiki/Planning/Implementation-Plans/2026-05-28-canonical-refactor.md` §5.5.

## Result: ⚠ PARTIAL — 4 PASS / 2 MISS — **WS-6 blocked**

Two thresholds miss the gate. Per §5.5 doctrine: "**If any threshold misses, WS-6+ does not start.** Stop the line, diagnose, fix-forward."

## Audit table

| Metric | Baseline (2026-05-28) | Target (§5.5) | Current (2026-05-29) | Verdict |
|---|---|---|---|---|
| `as any` (production src/) | ~490 | ≤245 (50% drop) | **106** | ✅ **PASS** (78% drop) |
| `as unknown as` (production src/) | ~80 | ≤40 (50% drop) | **80** | ❌ **MISS** (no change) |
| `as ComposableLayer` (anywhere) | 44 (runtime.ts) | = 1 (runtime.ts terminal) + 0 elsewhere (§8.1) | **6** (all in runtime.ts) | ❌ **MISS** (target 1, actual 6) |
| `Effect<X, unknown>` (priority dirs) | 105 | ≤52 (50% drop) | **35** raw grep / **20** AST-counted (Phase 2 walker) | ✅ **PASS** (67%+ drop) |
| Dead-surface (TagMap+ControllerDecision+Registry) | n/a | 0 | **0** | ✅ **PASS** (Phase 6 gate verifies) |
| Lying-comment | n/a | 0 | **0** | ✅ **PASS** (B-series audited zero) |

**Plus:** Build 38/38 ✅; Tests 5770 pass / 0 fail / 23 skip ✅.

## Miss diagnosis

### Miss #1: `as unknown as` = 80 (no change)

Per-file detail (sites with >=2 occurrences):

```
packages/runtime/src/__tests__/builder-with-skill-persistence.test.ts:4
packages/runtime/src/__tests__/builder-with-budget.test.ts:4
packages/runtime/src/runtime.ts:4 (all 4 are `as unknown as ComposableLayer` — overlap with Miss #2)
packages/runtime/src/errors.ts:4
packages/runtime-shim/src/database.ts:4
packages/runtime/src/reactive-agent.ts:3
packages/runtime/src/execution-engine.ts:3
packages/llm-provider/src/providers/anthropic.ts:3
```

**Root cause hypothesis:** WS-2 Phase 3 (builder withers) reduced `as any` (490→106) but did not target `as unknown as` separately. The `as unknown as` casts are concentrated in:
- Builder runtime widening (`as unknown as BuilderRuntimeStateView` in tests — 8 sites)
- Tagged-error subclass coercion (`errors.ts` — 4 sites)
- ComposableLayer widening (`runtime.ts` — 4 sites, overlap with Miss #2)
- Provider hook boundary casts (`anthropic.ts` — 3 sites)
- Database shim (runtime-shim — 4 sites)

**Fix-forward path:**
1. Test-side `as unknown as BuilderRuntimeStateView` (~8 sites in __tests__) → introduce a test helper `asBuilderState(builder)` that does the cast once with `eslint-disable-next-line` justification.
2. Provider hook boundary casts → see if hook signatures can be tightened to avoid the cast.
3. ComposableLayer (4 sites) → folded into Miss #2 resolution.

Estimated effort: 1 small workstream (~2-3 commits).

### Miss #2: `as ComposableLayer` = 6 (target 1 per §8.1)

Detail in `packages/runtime/src/runtime.ts`:

```
runtime.ts:599  ).pipe(Layer.provide(baseToolsLayer)) as unknown as ComposableLayer;
runtime.ts:603  toolsLayer = baseToolsLayer as unknown as ComposableLayer;
runtime.ts:975  ) as ComposableLayer;
runtime.ts:1148 ).pipe(Layer.provide(baseToolsLayer)) as unknown as ComposableLayer;
runtime.ts:1150 toolsLayer = baseToolsLayer as unknown as ComposableLayer;
runtime.ts:1256 ) as ComposableLayer;
```

**Root cause:** WS-2 Phase 3 reduced from 44 → 6, but did not finish to the §8.1 "terminal site = 1" goal. The 6 sites cluster in two duplicate code paths (lines 599+603+975 vs 1148+1150+1256) — there are TWO copies of the tools-layer composition logic, each emitting 3 casts.

**Fix-forward path:**
1. Extract the duplicate tools-layer composition into a single helper function returning `Layer.Layer<...>`.
2. Cast once at the helper's return → drops to 1 terminal cast.

Estimated effort: 1 small commit, 1 file touched (`runtime.ts`).

## What passed

### `as any` 490 → 106 (78% drop)
Primary driver: WS-2 Phase 3 builder.ts decomposition + WS-2 Phase 2 `this as any` removal via private→public field widening.

### `Effect<X, unknown>` 105 → 35 raw / 20 AST (67%+ drop)
Primary driver: WS-5 Phase 2 AST walker calibration + ContextManagerLike dedupe. Master plan §3 RC-4 count of 105 was inflated — actual surface was always ~20 by AST measure.

### Dead-surface = 0
WS-4 Phase 6 (`packages/compose/test/anti-scaffold-tagmap.test.ts`) pins all 7 TagMap entries with emit + consumer pairs. Phase 2 prune resolved 4 dead ControllerDecision variants. Phase 8 verified CapabilityRegistry entries have wired consumers.

### Lying-comment = 0
Phase 5a (confidenceFloor docstring honesty) closed the last known lying comment. B-series audit historically clean.

## Status: WS-6 blocked

WS-6 cannot start until both misses close. The fixes are surgical (estimated 2-3 commits total, single-day):

1. **WS-5b (new) — `as unknown as` sweep.**
2. **WS-5c (new) — ComposableLayer terminal-site consolidation.**

Both should land as RED/GREEN TDD commits with verified-by counts in PR bodies.

## Coda — what the master plan got right and wrong

**Right:** TagMap/ControllerDecision/Registry coverage gates closed the dead-surface debt. AST-walker pattern (Phase 2+3) is the durable mechanism — counts can't drift back without a test failure.

**Wrong (count inflation):**
- `Effect<X, unknown>` cited 105 → actual was always ~20 (5× inflation, see Phase 2 finding)
- `console.warn` cited 27 + `console.error` cited 24 → actual 9 + 1 = 10 active (5× inflation, see Phase 3 finding)
- `as any` cited 490 → actual was 490 at baseline (this one was accurate)

The pattern: counts derived from grep-without-AST overcount by 4-5× due to docstring examples, comments, and false positives. Future audits should standardize on AST walkers (we now have two: Phase 2 + Phase 3 reusable scaffolds).

---

**Reviewed by:** Tyler Buell (re-audit gate execution 2026-05-29)
**Next action:** Open WS-5b + WS-5c thin specs, dispatch to runtime-warden when pilot window allows.
