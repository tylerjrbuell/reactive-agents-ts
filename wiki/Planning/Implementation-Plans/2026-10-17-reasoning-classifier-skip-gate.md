# Bundle: reasoning-classifier-skip-gate
Date: 2026-10-17
Budget: 60 min
Issues: #240

## Acceptance criteria (per issue)
- #240: `adaptive.ts:219` and `decompose.ts:118` ungated `gatewayComplete({purpose:"classify"})` calls are gated on `classifierReliability` low/skip, mirroring the existing `strategy-evaluator.ts` gate (`shouldSkipClassifierEvaluation` + `CLASSIFIER_SKIP_RELIABILITIES = ["low","skip"]`). RED test proves LLM round-trip count goes to 0 on low/skip; GREEN keeps behavior identical for trusted/absent reliability.

## Execution units (ordered)
1. **Unit 1:** #240 — gate adaptive.ts classify site. Thread `input.calibration?.classifierReliability` into `shouldSkipClassifierEvaluation`-style check; when skipped, set `selectedStrategy` deterministically (default to heuristic/fallback) without LLM call. Files: `packages/reasoning/src/strategies/adaptive.ts`. Tests: `packages/reasoning/tests/kernel/classifier-skip-enforcement.test.ts` add adaptive-site cases.
2. **Unit 2:** #240 — gate decompose.ts classify site. `decomposeRequirements` already gates on `shouldDecompose()`; add classifierReliability check to the opt-in so low/skip returns `[]` without LLM call. Files: `packages/reasoning/src/kernel/contract/decompose.ts`, `DecomposeOptions` gains optional `classifierReliability?: string`. Tests: unit for low/skip → no call.

## Risk register
- Skipping classify changes selected-strategy on low/skip models → mitigation: deterministic default preserves prior "no-op classifies but still routes" semantics where reasonable; tests pin trusted/absent behavior unchanged.
- decompose.ts `Effect<_, never>` — catchAll already swallows failures; adding skip is pure behavior narrowing, safe.

## Verification protocol (cross-cutting)
- `bun test packages/reasoning/` — full pass
- `bun run build` — green
- `bunx turbo run typecheck --filter=@reactive-agents/reasoning` — green
- Re-run `classifier-skip-enforcement.test.ts` → all pass (behavioral pin)

## Out-of-scope (explicit)
- Wither batch 2 (#213), oversized-file decompositions (#217-#222) — separate bundles
- Any LLM-call beyond the two classify sites
