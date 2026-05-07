---
type: implementation-plan
status: active
created: 2026-05-07
completed: null
authored-by: Claude (Opus 4.7)
related: "[[wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md]]"
phase: A
wave: W23
---

# Phase A W23 — Execution-Engine Decomposition

**Goal:** Decompose `packages/runtime/src/execution-engine.ts` (4,663 LOC) using a phase-as-data architecture so each phase is a composable, testable, observable unit.

**Authority:** North Star v4.0 §6 Phase A.

**Baseline (2026-05-07 4:35 PM EDT):** 738 pass / 1 skip / 0 fail across 108 files in `packages/runtime`. This is the regression anchor.

---

## Architectural decision: phase-as-data

The current `ExecutionEngineLive` is one giant `Effect.gen` block (3,800+ LOC of body) where every phase is hardcoded into a sequential closure with shared local variables. The decomposition would otherwise require either:

- Threading 30+ closure variables through phase function signatures (exposes implementation detail), or
- A "god context" object that defeats the point of separation.

**Chosen design — phases as first-class typed values:**

```ts
// engine/phase.ts
export interface Phase {
  readonly name: ExecutionContext["phase"];
  readonly skip?: (ctx: ExecutionContext, deps: PhaseDeps) => boolean;
  readonly run: (ctx: ExecutionContext, deps: PhaseDeps) => Effect.Effect<ExecutionContext, RuntimeErrors>;
}

export interface PhaseDeps {
  readonly config: ReactiveAgentsConfig;
  readonly hooks: LifecycleHookRegistry;
  readonly obs: ObsLike | null;
  readonly eb: EbLike | null;
  readonly tools: ToolService | null;
  readonly memory: MemoryServices;
  readonly cost: CostService | null;
  readonly verification: VerificationService | null;
  // ... (~15 typed fields, one per service tag)
  readonly state: PhaseStateRefs;  // Refs.make<>() values shared across phases
}
```

```ts
// engine/pipeline.ts
export const runPipeline = (
  phases: readonly Phase[],
  initialCtx: ExecutionContext,
  deps: PhaseDeps,
): Effect.Effect<ExecutionContext, RuntimeErrors> =>
  Effect.reduce(phases, initialCtx, (ctx, phase) =>
    phase.skip?.(ctx, deps)
      ? Effect.succeed(ctx)
      : runObservablePhase(phase, ctx, deps),
  );
```

```ts
// execution-engine.ts (target ≤ 600 LOC)
const phases: readonly Phase[] = [
  bootstrap,
  guardrail,           // skip when no GuardrailService
  costRoute,           // skip when no cost router
  strategySelect,
  agentLoop,
  verify,              // skip when no VerificationService
  memoryFlush,
  costTrack,           // skip when no CostService
  audit,
  complete,
];

// Live layer just wires deps + runs the pipeline
const finalCtx = yield* runPipeline(phases, initialCtx, deps);
```

### Why this beats both alternatives

| Concern | Traditional split (closure-threaded) | Phase-as-data (this plan) |
|---|---|---|
| Closure breakage | Every phase signature lists 20+ params | Phases declare `PhaseDeps` once; opaque to phases |
| Adding a new phase | Edit pipeline + edit closures | Append to `phases` array |
| Phase reordering | Edit a 3,800-LOC `Effect.gen` body | Reorder one array literal |
| Compose API (Phase B) prep | Requires new infra layer | `.compose()` injects between phases — substrate already exists |
| Testing | Mock the entire engine | Test `phase.run(ctx, mockDeps)` as a pure function |
| Observability | Wrapping repeated 10× | Single `runObservablePhase` wraps all |

### Module count is incidental to the design

The North Star v4.0 W23 gate said "9 phase modules." That number was an estimate. The empirical structure has 10 named phases, two of which (`agent-loop` ~1,950 LOC, `complete` ~787 LOC) need internal sub-modules. Final layout will be ~13 files, but **the gate that matters** is:

- `execution-engine.ts` ≤ 600 LOC
- Every phase module ≤ 400 LOC
- Phase composition is declarative (one array literal in execution-engine.ts)

North Star §11 will be amended to reflect this refinement before extraction begins.

---

## Final file layout

```
packages/runtime/src/
├── execution-engine.ts                    target ≤ 600 LOC (orchestrator + Live layer wiring)
└── engine/
    ├── phase.ts                           Phase type, PhaseDeps, helper predicates  (~80 LOC)
    ├── pipeline.ts                        runPipeline + runObservablePhase           (~180 LOC, hoisted from current execution-engine.ts:377-510)
    ├── runtime-context.ts                 ExecutionContext utilities + state Refs    (~120 LOC)
    └── phases/
        ├── bootstrap.ts                   BOOTSTRAP — skill load, memory, tips       (~250 LOC)
        ├── guardrail.ts                   GUARDRAIL (optional)                       (~90 LOC)
        ├── cost-route.ts                  COST_ROUTE (optional)                      (~90 LOC)
        ├── strategy-select.ts             STRATEGY_SELECT — tool registry, budget    (~250 LOC)
        ├── agent-loop/
        │   ├── index.ts                   AGENT_LOOP orchestrator (composes sub-pipeline)  (~200 LOC)
        │   ├── tool-classifier.ts         LLM tool classification + literal mention  (~300 LOC)
        │   ├── reasoning-call.ts          Semantic cache + reasoning service execute (~350 LOC)
        │   ├── iteration-handler.ts       Per-iteration LLM call + episodic logging  (~350 LOC)
        │   └── tool-dispatcher.ts         Tool execution + ToolCallStarted/Completed (~400 LOC)
        ├── verify.ts                      VERIFY (optional) — output verification    (~380 LOC)
        ├── memory-flush.ts                MEMORY_FLUSH — episodic compaction         (~200 LOC)
        ├── cost-track.ts                  COST_TRACK (optional)                      (~50 LOC)
        ├── audit.ts                       AUDIT (optional)                           (~50 LOC)
        └── complete/
            ├── index.ts                   COMPLETE orchestrator                      (~200 LOC)
            ├── debrief.ts                 RunReport + AgentDebrief assembly          (~400 LOC)
            └── post-run-update.ts         Calibration + bandit + skill store update  (~300 LOC)
```

**Total:** ~17 files; orchestrator ~600 LOC; every phase module ≤ 400 LOC.

---

## Extraction order (smallest-first, validates the pattern)

Each step: extract → run `bun test` → commit. If LOC budget is exceeded by >50% on any extraction, stop and reassess.

| # | Module | LOC est. | Risk | Adds tests? |
|---|---|---|---|---|
| 1 | Infrastructure: `phase.ts` + `pipeline.ts` + `runtime-context.ts` | ~380 | low | yes (5 pipeline tests) |
| 2 | `audit.ts` (smallest — pattern validator) | ~50 | trivial | no |
| 3 | `cost-track.ts` | ~50 | trivial | no |
| 4 | `cost-route.ts` | ~90 | low | no |
| 5 | `guardrail.ts` | ~90 | low | no |
| 6 | `memory-flush.ts` | ~200 | medium | no |
| 7 | `bootstrap.ts` | ~250 | medium | no |
| 8 | `strategy-select.ts` | ~250 | medium | no |
| 9 | `verify.ts` | ~380 | high (decision logic) | yes (verify decision tree) |
| 10 | `complete/` (orchestrator + debrief + post-run-update) | ~900 across 3 files | high | yes (debrief assembler) |
| 11 | `agent-loop/` (orchestrator + 4 sub-modules) | ~1600 across 5 files | very high | yes (tool-classifier) |

**Stop conditions:**
- If extraction #2 (`audit.ts`) results in >75 LOC: pause, reassess closure-breakage cost.
- If any extraction breaks tests: revert, diagnose, do not advance.
- If `complete/` or `agent-loop/` extraction reveals shared mutable state we missed: stop, document, plan a separate state-extraction step.

---

## Closure-breakage protocol

Every closure variable currently in `ExecutionEngineLive` must be classified as one of:

1. **Config-derived (constant per task):** thread through `PhaseDeps.config` directly. Examples: `config.defaultModel`, `config.requiredTools`.

2. **Service tag (Effect Context):** declared on `PhaseDeps` once. Examples: `obs`, `eb`, `tools`, `memory`.

3. **Cross-phase mutable state:** hoisted to `PhaseStateRefs` via `Ref.make<T>()`. Examples: `cachedToolDefs`, `effectiveRequiredTools`, `runningContexts`. Phases mutate via `Ref.update`.

4. **Phase-local computation:** stays inside the phase. Example: `verifyPrompt` (local to verify phase).

**Rule:** if a value is set in phase X and read in phase Y, it goes in `PhaseStateRefs`. No exceptions. No bag-of-everything `metadata` blob.

---

## Validation gates

### Per-extraction gate (after each commit)

- [ ] `bun test` in `packages/runtime` returns 738+ pass / 0 fail
- [ ] `bunx tsc --noEmit` clean for affected packages
- [ ] LOC for the new module ≤ planned + 50%
- [ ] No new closure capture between phases (grep for `phase X reads variable defined in phase Y`)

### W23 completion gate

- [ ] `execution-engine.ts` ≤ 600 LOC
- [ ] Every phase module ≤ 400 LOC
- [ ] Phase pipeline is declarative: `phases` array literal in `execution-engine.ts`
- [ ] All 738 existing tests pass
- [ ] `bunx tsc --noEmit` clean across all 27 packages
- [ ] N=3 corpus run shows ≤ 5% variance from baseline (no behavioral regression)
- [ ] At least 3 new unit tests added for phases with decision logic (pipeline composition, tool-classifier, verify-or-debrief)

---

## Out of scope for W23

These belong to later waves:

- **W24** — Strategy RI-scaffolding helper extraction (`runStrategyRiScan` for `plan-execute.ts` and `tree-of-thought.ts`).
- **W26** — `builder.ts` decomposition.
- **Phase B** — Compose API integration (the phase pipeline this wave creates is the Phase B substrate).

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| `agent-loop` shared state is too tangled to extract cleanly | Medium | Extract small phases first; use the validated pattern. If `agent-loop` resists, propose a smaller intermediate split. |
| Closure expansion blows phase LOC budgets | Medium | Calibrate on `audit.ts` first. If 50 LOC becomes 90 LOC, recalibrate all targets. |
| Hidden behavioral regression that integration tests miss | Low | N=3 corpus run validates end-to-end behavior. |
| Phase B (Compose API) needs structural changes we didn't anticipate | Low | Phase contract is explicitly designed to support `.compose()` interception between phases. |

---

## Amendment trigger

If the empirical extraction reveals the architecture needs adjustment (e.g., `agent-loop` truly cannot be cleanly decomposed), this plan is amended in place with a `## Amendments` section noting the date and reason. North Star §11 receives a corresponding row.

---

_Author: Claude (Opus 4.7) — 2026-05-07_
_Status: ACTIVE_
_Next action: amend North Star §11, then begin extraction #1 (infrastructure files)._
