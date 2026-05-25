---
title: Strategy Composability — Composable Strategy System Design
date: 2026-05-24
status: exploratory
owner: Reasoning Team
related:
  - "[[project_composable_strategies]]"
  - "[[project_composable_phases]]"
  - "[[Phase 1 Mechanism Validation Sweep]]"
  - "[[05-DESIGN-NORTH-STAR]]"
target_releases: [v0.12, candidate]
gating: |
  Phase 0 (shared-finalize extraction) ships first and provides the only
  evidence base. Phases 1-5 listed here as candidate next steps; each requires
  fresh lift evidence at its own gate before committing to a plan.
---

# Strategy Composability — Composable Strategy System Design

## Status

**Exploratory.** This spec documents a proposed architecture for unifying how reasoning strategies (reflexion, plan-execute, ToT, reactive, direct, code-action, adaptive) compose shared primitives while preserving their divergent control flows. It is NOT a commitment to build. Phase 0 (a narrowly-scoped dedup extraction) is the only step with a real implementation plan today; everything beyond Phase 0 is gated on Phase 0 outcomes.

This document grew out of the reflexion synthesis-gate fix (commit `0af217c8`, -46% tokens on the spot-test) and a probe of plan-execute showing that strategy code drift, not a shared production bug, is the principal motivation. The fix evidence and the probe results are documented below so future readers can re-evaluate the design as evidence accumulates.

## Motivation

### What we observed

- Reflexion produced placeholder-laden markdown reports (`[Insert BTC Price Here]`) despite tool calls returning real values. Fix (`0af217c8`): thread `initialMessages` into improve passes; reframe synthesis gate as DATA → FORMAT not draft-patcher; wire `validateContentCompleteness`. Lift: tokens -46%, duration -41%, attempts 4 → 2, output filled with real prices.
- Plan-execute does not exhibit the same placeholder bug on the same task shape. Its `finalOutput` derivation already concatenates `[EXEC` observations (raw tool data) before the synthesis gate, so the gate sees real values. A different bug surfaced (tool name normalization, `web_search` vs `web-search`), unrelated to synthesis.
- Three independent `enforceOutputQualityGate` implementations exist (reflexion, plan-execute, and the path through `finalizeOutput` in `kernel/loop/output-synthesis.ts`). Behavior diverges (only reflexion currently checks semantic completeness post-fix).
- `stripThinking` / `extractThinking` / `extractThinkingSafeContent` are three different helpers used at five sites, with no documented contract for when to use which. `stripThinking` silently drops content when the model puts the entire answer inside `<think>` — a model-ceiling failure mode that `extractThinkingSafeContent` recovers from.
- Strategies maintain ad-hoc local state (`currentResponse`, `lastKernelSteps`, `allSideEffectSteps`, `runningMessages`, `previousCritiques`, `totalTokens`, `totalCost`) with no shared "trajectory" abstraction. Each strategy reinvents the wheel; each reinvention drifts.

### What this means

The reflexion bug was a symptom of a missing abstraction at the strategy layer: there is no shared notion of a multi-pass agent trajectory, no canonical finalization step, no convergent primitives. Each strategy is a stand-alone function that re-derives plumbing rules. Bugs in one strategy stay in one strategy; fixes in one stay there too.

The kernel ships a composable pattern for this exact shape — `Phase = (state, ctx) => Effect<state>` dispatched on a status field, assembled via `makeKernel({ phases })`. This pattern stops at the kernel boundary. Strategies do not use it. Extending the same pattern up to the strategy layer is the conceptual move this design proposes.

### What is NOT motivation

- No production bug demonstrated to span both reflexion AND plan-execute. The probe (2026-05-24) showed plan-execute already handles raw-data → synthesis correctly. The shared-finalize case is dedup + future-proofing + invariant centralization, not a shared lift.
- No request from authors of third-party strategies (there are none today).
- No measured DX complaint from current strategy authors.

These are honest gaps. The design proceeds anyway because the duplication is real and the bug class ("strategy forgot to thread X") is recurring. But the evidence base for the larger Phases 1-5 is speculative until Phase 0 ships.

## Design Vision

### Three layers

```
Layer 3: Strategy Machines  — control-flow programs (status → phase tables)
Layer 2: Phases             — typed transitions over Trajectory state
Layer 1: Trajectory         — immutable accumulator (passes, messages, steps, cost)
```

Layer 1 is the data axis. Strategies cannot disagree about what a trajectory contains.

Layer 2 is the verb axis. A `Phase` is a function `(StrategyState, StrategyContext) => Effect<StrategyState, never, LLMService>`. Shared phases (generate, critique, finalize, decompose) live in a library; strategy-private phases live in the strategy file.

Layer 3 is the orchestration axis. A strategy is a `Record<StatusLiteral, Phase>` dispatch table assembled by `makeStrategy()`. The runner loops `machine(state, ctx)` until status reaches a terminal value. Same shape as `runKernel`, one level up.

### Self-similar to kernel

The kernel uses `Phase = (state, ctx) => Effect<state>` with positional dispatch on `state.status ∈ {"thinking","acting"}`. The strategy machine generalizes: arbitrary status union, table-driven dispatch. The kernel's existing positional form is a degenerate case (2-status table). The strategy machine is NEW machinery, not "parallel reuse" of an existing generic — this is an honest concession, flagged by advisor review. The kernel does not pre-justify the strategy machinery; it precedes it as inspiration, not as proof.

### Composition operators (deferred)

A future iteration could add `parallel(machines)`, `race(machines)`, `runSubStrategy(machine)` for combining strategies. These unlock self-consistency, debate, and nested ToT. They are NOT in scope for Phase 0 or Phase 1. Listed here for forward-looking discussion only.

## Open Questions (from advisor review, 2026-05-24)

These must be answered before any Phase 1+ implementation begins:

1. **Phase contract drift.** What enforces shared-phase invariants (cost monotonic, trajectory append-only, status transitions follow declared graph)? Type-system constraints alone are insufficient. Candidate answer: a `PhaseContractTests` suite that runs every shared phase through 5-10 synthetic invariants. Not designed yet.
2. **Status-set cross-strategy reuse.** What prevents `"satisfied"` from meaning different things in reflexion vs plan-execute? Candidate answer: branded literal types per strategy (`type ReflexionStatus = "satisfied" & { __strategy: "reflexion" }`), or per-strategy status namespace. Not designed yet.
3. **Sub-strategy trajectory merge.** If a sub-strategy returns its own Trajectory, how does the parent merge cost / messages / steps without double-counting? Undefined. Probably requires explicit `mergeTrajectory(parent, child, policy)` with caller-chosen policy (concatenate / scope-isolate / replace-output).
4. **Generic `Phase<S, C>` vs parallel structures.** Should kernel-Phase and strategy-Phase share a generic type, or remain parallel-but-isomorphic until a 3rd machine appears? Per §9 anti-scaffold, parallel until 3rd consumer is honest. Generalization is itself a refactor needing evidence.
5. **Migration cost.** 7 strategies, varying complexity (direct: 217 LOC; plan-execute: 1642 LOC on `main`). Estimated cost per migration not measured. Phase 1 / 2 will produce the only real data point.

## Anti-Pattern Tension (§9 acknowledgment)

The North Star §9 Anti-Scaffold Principle rules out "scaffold without callers." Phase 1 as drafted (build Trajectory + StrategyState + makeMachine + runStrategy + 3 core phases, migrate reflexion only) is exactly the shape §9 forbids: one consumer for new infrastructure. The Memory v2 Phase v2.0 design is currently paused for the same reason ([[project_memory_v2_design_drafted]]). Stacking a second instance without recognizing the precedent would be a known-bad pattern.

Resolutions considered:

- **Option A.** Bundle Phase 1 + Phase 2 (migrate reflexion AND plan-execute in one PR). Two-consumer rule satisfied. Cost: larger blast radius per PR.
- **Option B.** Defer Phase 1 entirely until a second consumer is forced by a real bug or third-party request. Cost: shared-primitive insight remains undocumented, drift continues.
- **Option C.** Phase 0 only ships, Phase 1+ documented as candidate-only, no implementation plan written until a triggering event.

This spec recommends **Option C**. Phase 0 is the only evidence-justified step. Phase 1+ is described here as design exploration but does not commit to implementation. If and when plan-execute or a third strategy gains a synthesis-gate-related bug, Option A activates.

## Phase Catalog (proposed, not built)

Each entry is what the phase would do IF built. None exist today.

### Core (multi-consumer candidates)

| Phase | Purpose | Consumers |
|---|---|---|
| `generatePhase(opts)` | Invoke kernel, fold result into trajectory | reflexion, plan-execute, ToT, best-of-N, reactive |
| `critiquePhase(opts)` | Pure-LLM judge against task | reflexion, plan-execute reflect, ToT scoring |
| `finalizePhase()` | Trajectory → ReasoningResult (harvest + gate + synth) | ALL |
| `decomposePhase(opts)` | Task → Plan | plan-execute, ToT, sub-agent delegation |

### Specialized (single consumer today, do not extract)

| Phase | Where | Why solo |
|---|---|---|
| `expandPhase` | ToT | tree-branching specific |
| `sandboxPhase` | code-action | verifier-loop specific |
| `routePhase` | adaptive | classifier specific |

§9 rule: extract only when ≥2 strategies use the same shape.

## Trajectory Shape (proposed)

```ts
interface Trajectory {
  readonly passes:   readonly PassRecord[]      // one per kernel invocation
  readonly messages: readonly KernelMessage[]   // accumulated conversation thread
  readonly steps:    readonly ReasoningStep[]   // accumulated observable steps
  readonly cost:     { tokens: number; usd: number }
}

interface PassRecord {
  readonly label: string                        // e.g. "generate", "improve-1"
  readonly output: string
  readonly tokens: number
  readonly cost: number
  readonly toolsUsed: readonly string[]
  readonly status: "completed" | "failed"
}
```

Derived lenses (pure functions, no new state):
- `toolEvidence(t): readonly ToolResult[]` — messages where role=tool_result
- `blockedTools(t): ReadonlySet<string>` — successful side-effect tool calls
- `lastDraft(t): string` — most recent text answer

## Integration with Existing Systems

- **HarnessPipeline** (`packages/core/src/services/harness-pipeline.ts`) — Add `strategy.*` tags to `ALL_TAGS`. Strategy phases emit through the existing pipeline. External taps see strategy events identically to kernel events. No new bus.
- **KernelHooks** (`packages/reasoning/src/kernel/state/kernel-hooks.ts`) — Either extend the existing `KernelHooks` interface with strategy methods, or introduce a parallel `StrategyHooks`. Decide at Phase 1 design time.
- **Replay package** (`@reactive-agents/replay`) — `StrategyState` is plain data, status is a natural resume anchor. Replay falls out free if Trajectory is serializable from the start.
- **Strategy switching (M2)** — Today implemented ad-hoc inside the kernel runner. Becomes a transition in the strategy machine (status `"switching"` → load new machine + decide carry-over policy). First-class instead of opt-in.

## Authoring Experience (sketch, not measured)

A new strategy in this design would look approximately like:

```ts
type ReflexionStatus = "init" | "generated" | "critiquing" | "satisfied" | "improving" | "stagnant" | "done"

export const reflexion = makeStrategy<ReflexionStatus>({
  init:       seedAndGenerate,
  generated:  critiquePhase(),
  critiquing: classifyCritique,    // strategy-private 5-line transition
  improving:  generatePhase({ temperature: 0.6 }).then(setStatus("critiquing")),
  satisfied:  finalizePhase(),
  stagnant:   finalizePhase(),
  done:       terminal,
})
```

Estimated LOC: ~30-40 for the strategy file, assuming the phase library is in place. **This is a sketch, not measured.** The current reflexion on `main` is 947 LOC; how much survives the migration depends on how much of that LOC was novel logic vs shared plumbing. Phase 1, if it runs, will produce the only real data point.

## Performance Considerations

- Status dispatch is a property lookup: O(1), negligible vs LLM latency.
- Trajectory append is amortized O(1).
- Shared `finalizePhase` likely hotter / cache-friendlier than three divergent implementations.
- HarnessPipeline emit uses an existing fast-path (zero-allocation when no transforms registered).
- Sub-strategy composition adds one Effect frame per nesting level; bounded.

No measured regression; no measured improvement. Both directions are claims pending Phase 1 evidence.

## What This Design Does NOT Do

- Does NOT propose a builder DSL on top. Raw transitions are the authoring surface.
- Does NOT propose JSON/YAML strategy specs.
- Does NOT generalize kernel `Phase` to a shared generic type with strategy `Phase` (parallel structures until 3rd machine).
- Does NOT introduce `Effect.Service` per capability (rejected earlier in design review — function references in a dispatch table are simpler).
- Does NOT add composition operators (parallel/race/sub-strategy) until a real strategy needs them.

## Candidate Roadmap (NOT a commitment)

Listed here for forward-looking context only. Each phase requires its own evidence gate before a plan is written.

| Phase | Scope | Evidence required to commit |
|---|---|---|
| 0 | Extract shared finalize logic to `kernel/loop/finalize.ts`; reflexion + plan-execute consume same-PR. | Already implied by code drift + reflexion fix evidence. Plan exists: [[2026-05-24-strategy-finalize-extraction]]. |
| 1 | Introduce Trajectory + StrategyState + makeMachine + runStrategy + 3 core phases. Migrate reflexion. | Phase 0 must ship; plan-execute must show comparable lift OR a 3rd-party strategy author must materialize. Without one of these, §9 violation. |
| 2 | Migrate plan-execute. Validate shared phases serve both without forced unification. | Phase 1 GREEN on metrics: reflexion LOC ↓≥30%, all tests green, spot-test lift retained. |
| 3 | Opportunistic migration of reactive, direct, ToT, code-action, adaptive when touched. | Per-strategy: no contract drift on shared phases; per-strategy lift or LOC reduction measured. |
| 4 | Composition operators (parallel, race, sub-strategy). | A strategy with a real branching need exists (e.g. self-consistency or debate). |
| 5 | Builder DSL on top of transition table. | ≥10 third-party strategies exist AND authors complain about boilerplate. Probably never. |

## Stop Conditions

The design is wrong if:

- Phase 0 ships and plan-execute shows neither lift nor measurable code-quality improvement.
- Phase 1 reflexion migration regresses on spot-test lift OR test pass rate OR LOC count.
- Phase 2 plan-execute requires a fundamentally different `StrategyState` shape than reflexion — indicates Trajectory is too narrow.
- A 3rd-party strategy proves impossible to express as a transition table.
- The phase-contract test suite never gets written, allowing drift to recur.

Any of these reverts the design and stops further Phases.

## Outstanding Process Gaps

Advisor flagged that the `architecture-audit` and `effect-abstraction-audit` skills exist in this codebase for exactly the scope of this design. Neither was run prior to writing this spec. Both should be invoked before Phase 1 commits any code. Their findings may invalidate or refine this design; if so, this spec is updated rather than discarded.

## References

- Reflexion synthesis-gate fix: commit `0af217c8` (2026-05-24)
- Plan-execute placeholder probe: `/tmp/pe-probe.log` (2026-05-24 — replication: run spot-test with `defaultStrategy: 'plan-execute-reflect'`)
- Kernel composability shipped: [[project_composable_phases]] (Apr 3, 2026)
- Composable strategies V1.1 intent: [[project_composable_strategies]]
- Phase 1 mechanism validation findings: [[project_self_improving_harness]]
- North Star §9 Anti-Scaffold: [[05-DESIGN-NORTH-STAR]]
- Memory v2 §9 precedent: [[project_memory_v2_design_drafted]]
