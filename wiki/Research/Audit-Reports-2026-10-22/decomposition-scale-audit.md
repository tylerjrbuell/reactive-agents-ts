---
type: audit
status: open
created: 2026-10-22
tags: [audit, decomposition, gates, runtime, reasoning]
---

# Decomposition-Scale Audit (2026-10-22)

Scope: the three shipped decompositions (#217 `reactive-agent.ts` → `agent/*`, #218 `builder.ts` → `builder/{build,withers}/*`, #219 `think.ts` → stage modules) plus the remaining p2 seeds (#220, #221, #222). Method: `effect-abstraction-audit` skill, 7-signal pass, evidence re-verified against primary sources.

## Verdict

The decomposition family is structurally sound: shells are thin (builder.ts 2,222; think.ts 676; reactive-agent.ts 2,338), delegates are explicit per-call deps objects, overload/surface changes verified zero, and no regrowth has occurred in the 2 days since merge. The gap is **enforcement, not code**. Per the register's own law (§6: "Prose findings do not discharge debt. Only gates do"), the following rules are currently convention-only and will break at the first busy sprint:

1. **"Never re-monolith the shells"** (kernel-warden manifest §4 + all three debriefs) — no gate exists. History: builder.ts regrew +241→+267 past its W26-B trim; reactive-agent +310 past its sweep cite; think.ts +310 in the same window. The regrowth mechanism was never closed, only the symptom was removed.
2. **Seam coverage.** Zero test files import any of the 21 new modules directly (verified grep). Coverage passes exclusively through the class shells / orchestrator. That is fine for a verbatim move, but it means every future behavior change will be TDD'd against the shell, re-creating the edit-the-giant-file pressure the decompositions just removed. The pre-existing W25 `builder/build-effect/*` modules ARE directly imported by 3 tests — the repo's own precedent shows the healthy end-state.
3. **Type-escape leakage into new module surfaces.** `ManagedRuntime<any, never>` appears in 3 deps interfaces (`agent/durable-facade.ts:67`, `agent/execute-event.ts:45`, `agent/gateway-driver.ts:45`). Carried verbatim from the class field, but now it is the *module* surface, so new consumers inherit the hole. 23 `new Error(` sites also carried into `agent/*` + `builder/build/*` bodies (error algebra: Data.TaggedError epic, deferred by design).
4. **Drift-guard asymmetry (builder).** `_assertRuntimeStateViewShape` compile-guards the build-effect view; the withers `BuilderState` view (`withers/_state.ts`, 134 declared members) has **zero** equivalent guard — silent drift between the 121-field class and its view is possible at every future wither addition.
5. **`safeParseJson` duplicated** in `agent/durable-facade.ts:33` + `agent/run-task-effect.ts:57` (~15 LOC each) — deliberate micro-debt, cheap to internalize.
6. **`dispatch-think-response.ts` (800 LOC, 34 if/switch/case) is itself now the largest file in `capabilities/reason/`** — the future split candidate, and the first file where regrowth should be caught by gate (1).

## Anti-abstraction rulings (do NOT do these)

- **Do not convert facade/wither deps objects to `Context.Tag` + `Layer` now.** The Promise-based class surface is the public API; Layer-ifying is a rewrite, not a decomposition. The deps objects already satisfy signal B's intent (explicit, per-call, reviewable R). Revisit only when the facade-modernization epic runs.
- **Do not add barrel re-exports of the new modules upward** (Bun tree-shaking constraint; shells already re-export what compatibility requires).
- **Do not promote the think stages to kernel Phases.** They are one phase's internal pipeline; `(state, context) => Effect` phase contract is pinned and unchanged.
- **Do not unit-test byte-identical helper modules** (`context-pressure`, `final-answer-heuristics`, `tool-index-disclosure`) — the shell suite pins them through real callers.

## Ordered incremental plan (each independently shippable)

1. **Size-ratchet gate** — new `scripts/check-file-size.sh` riding the auto-globbed CI lane (`ci.yml:85` glob; `enforcement-scripts.test.ts` discovery), ratcheted shrink-only baseline like `check-orphans.sh`: pins LOC ceilings for the 3 shells + remaining giants (#220 arbitrator 1,908, #221 execution-engine 1,807, #222 iterate-pass 1,734 + runner 1,703, dispatch-think-response 800). Baseline set at current values; any addition above a ceiling fails; a completed decomposition must shrink the list (same "baseline may only shrink" law). Red-on-cut fixture test required.
2. **Seam-test seeds** — one direct-import behavioral pin per family: one `wither` apply fn, one `agent` facade method, one think stage. Proves the seam is the new edit surface; future behavior changes extend these, not the shell suite.
3. **Deps-type tightening** — replace `ManagedRuntime<any, never>` with the real `R` unions in the 3 deps interfaces; typecheck-gated, zero behavior change.
4. **Micro-dedup** — internal `agent/_json.ts` for `safeParseJson` (2 importers, no public surface change).
5. **Withers drift guard** — extend the `_assertRuntimeStateViewShape` pattern to `BuilderState` (compile-time only).
6. **#220/#221/#222** executed via the v26/v26b skill rules; gate (1) makes their caps mechanical instead of aspirational.

Tracked as: GH #259 (size ratchet, p1), GH #260 (seam tests, p2), GH #261 (type-escape + dedup + drift guard, p2).
