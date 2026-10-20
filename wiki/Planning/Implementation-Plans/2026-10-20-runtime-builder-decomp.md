---
type: plan
status: active
created: 2026-10-20
tags: [runtime, decomposition, execute-backlog, warden]
---

# Bundle: runtime-builder-decomp (GH #218 / HS-248)

Date: 2026-10-20 · Budget: 90 min · Issues: #218

## Context

`packages/runtime/src/builder.ts` — the **largest exported-API file in the repo** per the health sweep (3,081 LOC at sweep time 2026-09-23; **regrown to 3,348 LOC on dev at bundle time**). Already trimmed once by 241 LOC (`cc886a1d`, W26-B). Active decomposition precedent inside the package: `builder/{types,to-config,helpers,ri-wiring,contract-tool-set,api-surface,wither-applies}.ts` and the 2026-10-20 #217 factor-out into `agent/*` facades.

## Structure scan (bundle time)

- Lines 1–324: config interfaces (`BudgetLimits`, `QuickOptions`), `QUICK_KEYED_PROVIDERS`, `ReactiveAgents` registry const, type re-exports.
- Line 325: `export class ReactiveAgentBuilder<TOut>` — ~101 public/private methods, dominated by thin `with*` config setters (~70).
- Line 2690: `toConfig()`; 2705: `build()` (~225 LOC); 2958: `warnIfImplicitTestProvider`; 2977: `buildEffect()` (~370 LOC).

## Acceptance criteria (#218)

- `builder.ts` LOC ≤ 2,450 (target band; roughly −900+); top-level exports count and `index.ts` surface unchanged (no symbol added/removed).
- Bodies moved **verbatim** into cohesive `builder/*` modules; class methods delegate via explicit deps objects (the #217 pattern: per-call construction so mutable class state is read live).
- JSDoc carried; zero behavior change; zero new `as any`/`as unknown as` sites (cast-ceiling test must stay green, ceilings untouched).

## Execution units

1. **Unit 1 (warden dispatch, ~60 min):** runtime-warden decomposition — seams expected around (a) builder main-method/delegate regions (`build()` + `buildEffect()` housing per-cluster config assembly), (b) cohesive `with*` families (model/cost, durable/interaction, observability/tracing, harness/profile, tools/documents). Exact seams at warden's discretion per verbatim-move mandate.
2. **Unit 2 (parent, ~20 min):** verifier pass — runtime typecheck, runtime suite vs baseline, cast-ceiling, scope check; review-patterns/effect-ts-patterns pass; fix findings (e.g. type-location canonicalization as in #217's JudgeInput).

## Risk register

- Overloaded `with*` declarations (e.g. `withModel`, `withMCP`, `withHarness`, `withReactiveIntelligence`) need overload signatures preserved on the class — delegate bodies only.
- `withSelfImprovement(): this`-style narrow widenings depend on overload intersection — verbatim signature copy mandatory.
- Regrowth hazard: file regrew 3,031→3,081→3,348 in ~4 weeks; note in debrief that future additions should target `builder/*` modules, not the class file.

## Verification protocol (cross-cutting)

- `bunx tsc --noEmit -p packages/runtime` — clean
- `bun test packages/runtime/ --timeout 20000` — **1,677 pass / 7 skip / 0 fail across 309 files (exact baseline)**
- `bun test packages/runtime/test/as-unknown-as-ceiling.test.ts` — 2/2 green; `as unknown as` flat at 39
- Scope check: only `builder.ts` modified + new `builder/*` modules; `git diff --stat` reviewed
- Full PR CI (Test/Typecheck/Eval/Docs) green before merge to `dev`

## Out of scope

- The async/Promise class-facade pattern modernization (same disposition as #217 — separate epic).
- `withSelfImprovement`-gate behavioral changes.

## Baseline

- Typecheck: clean (rc=0).
- Runtime suite: 1,677 pass / 7 skip / 0 fail / 3,970 expect() across 309 files.
- `builder.ts`: 3,348 LOC.
- Branch: `bundle/runtime-builder-decomp` off origin/dev @ `5682c8cd8`.
