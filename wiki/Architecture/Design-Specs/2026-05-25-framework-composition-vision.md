---
title: Framework Composition Vision — Unified Capability Composition
date: 2026-05-25
status: vision draft — pre-design, awaiting prototype evidence
owner: Architecture
related:
  - "[[2026-05-24-strategy-composability-design]]"
  - "[[05-DESIGN-NORTH-STAR]]"
  - "[[project_composable_phases]]"
  - "[[project_v011_1_shipped]]"
gating: |
  This is a VISION document. NOT a commitment to build. Every section below
  requires its own design spec, ≥2-consumer evidence, and live LLM probe
  before any implementation. Use this to align direction, not to authorize
  work. The bottom-up methodology codified in
  [[2026-05-24-strategy-composability-design]] applies to every piece
  proposed here.
---

# Framework Composition Vision — Unified Capability Composition

## Status

**Vision draft.** Surveys the existing framework architecture (35 packages, ~110K LOC) and proposes a unified composition model that would make reasoning systems follow the same patterns as the rest of the framework, unlocking strategy composition + cross-domain agent reliability + per-capability trust contracts.

NOT a build commitment. Anchors what direction is worth investing in, given existing investment patterns + the goals stated by the project owner on 2026-05-25:

> "control, trust, reliability, DX, performance ... our reasoning systems to follow the same patterns and composition to allow for robust reasoning algorithms to be composed."

## Where we sit (objective survey, 2026-05-25)

### Framework size

```
Top 8 packages by LOC:
  reasoning              24,493 LOC, 89 files
  runtime                22,505 LOC, 99 files     ← agent builder + execution engine
  tools                  10,999 LOC, 63 files
  llm-provider            9,155 LOC, 33 files
  reactive-intelligence   5,818 LOC, 69 files
  memory                  5,288 LOC, 26 files
  observability           5,055 LOC, 30 files
  core                    3,915 LOC, 33 files
```

35 packages total, ~110K LOC framework code.

### Reasoning subsystem (post primitive-extraction branch)

8 strategies, 4,070 LOC. 4 reusable primitives, ~440 LOC of shared infrastructure. 4 CI-enforced drift contracts. Strategy thinning: reflexion -18.3%, total strategies -6.7%.

## Pattern languages observed (consistent + inconsistent)

### Consistent patterns (the spine)

| Pattern | Usage | Quality |
|---|---|---|
| **Effect-TS Services + Layers** | Every major package: `Context.GenericTag<Service>`, `Layer.effect(Service, impl)`, `Effect.gen(function*() { ... })` | Sound substrate — clean DI, typed, composable |
| **`XService` + `XServiceLive` convention** | MemoryService/Live, AgentService/Live, ToolService/Live, LLMService, etc. | Consistent — predictable shape across packages |
| **`makeX()` factories** | `makeKernel({phases})`, `makeToolRegistry()`, `makeMCPClient()`, `makeSandbox()`, `makeStrategyEmitLog()` | Hybrid of constructor + light composition |
| **`Phase = (state, ctx) => Effect<state>`** | `kernel/loop/react-kernel.ts:makeKernel` — composable phase pipeline dispatched on `state.status` | **The good model. Shipped Apr 2026. Proven.** |
| **Killswitch as composable function** | `packages/compose/src/killswitches/*` — `budgetLimit`, `timeoutAfter`, `maxIterations`, `requireApprovalFor`, `watchdog` | **The best model in the framework today.** Narrow, typed, composable. |

### Inconsistent patterns (the friction)

| Friction | Where | Cost |
|---|---|---|
| **Builder vs Compose composition tension** | runtime: 75 `withX()` methods (mutating fluent chain); compose: functional `composeAgent(killswitches.budgetLimit({...}), ...)` | Two competing composition models for the same conceptual thing |
| **Kernel uses `Phase`, strategies don't** | Kernel composability stops at the kernel boundary. Strategies are hand-written Effect.gen programs reinventing control flow. | Asymmetry already flagged in [[2026-05-24-strategy-composability-design]]. Current bottom-up PR makes incremental progress; doesn't close the gap. |
| **No "what's an agent" abstraction** | Runtime has builder. Reasoning has strategies. Compose has killswitches. Each layer reinvents composition. | No single mental model = harder to onboard, harder to compose at scale |
| **75 builder methods** | `packages/runtime/src/builder.ts` | Surface bloat. `withReactiveIntelligence` declared TWICE (overload). Discoverability + cognitive load problem. |
| **Multiple tool-definition styles** | `define-tool.ts`, `define-tool-simple.ts`, `tool-builder.ts` | Three+ ways to define a tool. Choice paralysis. |
| **Multiple competing observability layers** | `emitLog` (strategy), `publishReasoningStep` (EventBus), `emitKernelStateSnapshot` (outer-loop), `HarnessPipeline` (compose) | Same event might fire through multiple paths. Hard to know which to use. |

### What works architecturally (today)

- **Effect-TS + Layer** as the foundation. Sound. Don't break.
- **Composable Phases at kernel layer.** Proven. Should extend up.
- **Compose API killswitch pattern.** Elegant, narrow, type-safe. **This is the model the rest of the framework should converge on.**
- **Service + Live convention.** Consistent DI everywhere.
- **Per-(provider, model) capability resolution.** Hard-won, works.

### What doesn't work as well

- **Strategies as hand-written control flow programs.** No composition primitive at strategy layer. Even with current PR's 4 primitives, strategies are 200-1548 LOC of orchestration each.
- **Builder pattern has reached complexity ceiling.** 75 methods means most users never discover most options.
- **No uniform composition primitive across layers.** Tools compose differently than strategies which compose differently than killswitches which compose differently than phases.

## Vision: unified capability composition

The proposal: **every framework layer that produces composable behavior should use the same composition primitive** — modeled after the compose-API killswitch pattern, generalized to all capability categories.

### Capability categories (proposed taxonomy)

```ts
// Each is a "capability" — a typed value that contributes behavior to an agent
type Capability =
  | Provider     // LLMService binding (anthropic, openai, ollama, ...)
  | Tool         // ToolDefinition (web-search, crypto-price, MCP server, ...)
  | Strategy     // ReasoningStrategy (reflexion, plan-execute, ...)
  | Phase        // Kernel phase (think, act, custom)
  | Combinator   // Higher-order patterns (iterateUntil, branchAndPick, ...)
  | Killswitch   // Compose API today (budget, timeout, approval, ...)
  | Hook         // Lifecycle hook
  | Memory       // Memory tier binding
  | Guardrail    // Input/output guardrail
```

### Unified composition primitive (sketch)

```ts
// Today: scattered across builder, compose, define-*, make-*
// Tomorrow: one mental model
export function defineCapability<K extends CapabilityKind, S>(
  kind: K,
  spec: S,
): Capability<K, S>

export function composeAgent(
  ...capabilities: readonly Capability[]
): Agent
```

Equivalence proof:

```ts
// Today (fluent builder):
ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("qwen3.5:latest")
  .withTools({ allowedTools: ["crypto-price"] })
  .withReasoning({ defaultStrategy: "reflexion" })
  .withBudget({ tokensMax: 50000 })
  .build()

// Tomorrow (uniform composition):
composeAgent(
  providers.ollama({ model: "qwen3.5:latest" }),
  tools.allow("crypto-price"),
  strategies.reflexion(),
  killswitches.budgetLimit({ tokensMax: 50000 }),
)
```

Builder stays as the **convenience layer** on top — every `withX()` resolves to attaching the corresponding capability. Power users compose directly. Beginners use builder. **Same underlying model.**

### How reasoning systems would follow the same patterns

Today: strategies are hand-written Effect.gen programs. Each one different shape. Reflexion = 774 LOC of orchestration.

Tomorrow:

```ts
// Strategy as composition of capabilities, not hand-written control flow
export const reflexion = strategies.compose({
  initial: phases.generate({ temperature: 0.7 }),
  loop: combinators.iterateUntil({
    step: capabilities.compose(phases.critique(), phases.improve()),
    terminate: (s) => s.satisfied || s.stagnant,
    maxIters: 3,
  }),
  finalize: phases.finalize(),
})
```

~30-50 LOC per strategy vs 200-1500 LOC today. **Same composition model as the rest of the framework.** Strategy authoring becomes "pick combinator + provide phases" instead of "write 500 lines of Effect.gen."

This is the **combinator layer** proposed in chat 2026-05-25. It's specifically a generalization of the existing kernel `Phase` pattern (proven) lifted one level up to strategy layer, plus the killswitch-style composition pattern (proven) generalized to all capability kinds.

### What this unlocks (the vision payoff)

If reasoning systems follow the same composition pattern as the rest of the framework:

1. **Per-domain strategies authored by 3rd parties become trivial.** Same shape as defining a tool. No "learn the kernel internals" tax.
2. **Strategy mixing.** `composeStrategy(reflexion.withCritiqueDepth(2), branchAndPick({...}))`. Composable like Lego.
3. **Cross-cutting concerns apply uniformly.** Budget, approval, verification work on ANY capability, not just agents. `composeStrategy(reflexion(), killswitches.budgetLimit({...}))`.
4. **Replay / snapshot fall out of capability composition.** Every capability is a typed value with serializable spec. `JSON.stringify(agent.capabilities)` captures behavior.
5. **Trust + reliability.** Capability composition enforces invariants at COMPOSE time, not runtime. Conflicting capabilities caught before LLM bill.
6. **Performance.** Capabilities can be pre-resolved, cached, parallelized. Builder's mutating chain prevents this today.
7. **DX.** One mental model: "compose capabilities to define behavior." Replaces 75-method builder + 7 strategy archetypes + 6 killswitches + 11 tool-define styles with ONE compose function.

### Unlocked future capabilities (envisioned, not designed)

These become natural in the unified model. None designed yet.

- **Strategy A/B testing** via capability swap: `composeAgent(...base, strategies.experimentalVariant())`
- **Domain-specific reasoning packages**: `@reactive-agents-medical/strategies`, `@reactive-agents-legal/strategies` — each a set of capability-defining functions
- **Self-modifying agents**: agent emits new capabilities at runtime; replayable via capability log
- **Composable observability**: `composeAgent(..., observability.otel(), observability.console())` — multiple observability layers as capabilities
- **Multi-agent orchestration**: agents themselves become capabilities (`agents.delegate({ skill: "research" })`)
- **Per-tenant capability boundaries**: capability sets enforced as security perimeter
- **Capability-level cost accounting**: each capability declares its cost contribution; rollup is automatic

## Risks (honest)

1. **Builder pattern is heavily entrenched.** 75 methods, used in every example, in every doc. Migration is non-trivial. Plan: builder STAYS as convenience layer, never deprecate.
2. **Capability-kind taxonomy might not survive contact with reality.** Some real things don't fit neatly: hooks vs phases vs killswitches have overlap. May need refinement after 2-3 prototypes.
3. **Type system challenges.** Capability composition with full type inference across kinds requires careful generic design. Effect-TS handles this well but the surface needs care.
4. **§9 anti-scaffold applies at framework scale.** This vision is speculative. No single 3rd-party author has asked for it. Implementing all of it without consumer pressure = scaffolding.
5. **Tension with running [[2026-05-24-strategy-composability-design]] bottom-up plan.** That plan is intentionally narrow. This vision is broad. They must reconcile: vision sets direction; bottom-up is HOW we get there incrementally.
6. **Performance unknowns.** Composition resolution per agent creation; needs to be cheap. Likely O(n) capabilities, n = small. But measure before claiming.

## Implementation order (honest, per §9, evidence-gated)

Each step requires its own design spec + ≥2 consumer prototype + live LLM probe. None of these are committed today.

### Phase A — combinator layer above primitives (PROVEN VALUE FIRST)

This is the immediate next step. Builds on the 4 primitives shipped in [[2026-05-24-strategy-composability-design]].

**Order:**
1. Prototype `iterateUntil<S>` against reflexion alone. Verify shape. Measure LOC delta. Live probe.
2. If reflexion lift ≥300 LOC saved AND parity preserved, migrate plan-execute-reflect + code-action.
3. Iff combinator gets 3 real consumers, generalize. Otherwise STOP — accept that bottom-up primitives are sufficient.
4. Then consider `branchAndPick` (ToT) and `routedDispatch` (adaptive).

**Evidence gate:** Each combinator needs the same 6-gate template as primitives (≥2 consumers same PR, deterministic tests, drift contract, live LLM probe, tool probe, LOC + test delta logged).

### Phase B — Strategy as composition (CONSUMER-FORCED)

Only triggered if Phase A combinators land cleanly AND a third-party author requests an authoring surface OR a new strategy type appears that doesn't fit existing shapes.

**Order:**
1. Define `defineStrategy(spec)` shape against the reflexion + plan-execute prototypes from Phase A.
2. Ship as additive — old strategies (hand-written) keep working; new strategies CAN use defineStrategy.
3. Old strategies migrate only when adjacent code touches them.

**Stop condition:** if `defineStrategy` requires escape hatches for ≥2 strategies, the abstraction is wrong.

### Phase C — Unified capability composition (FRAMEWORK-WIDE)

Far future. Only triggered when ≥2 capability kinds (e.g., Strategy + Tool) genuinely want the same composition primitive.

**Order:**
1. Define `defineCapability<K, S>` taxonomy + `composeAgent(...)` against existing builder calls.
2. Builder methods become `withX → composeAgent(..., x)` internally. Public API unchanged.
3. New users can compose directly. Builder stays for convenience.
4. Eventually, opportunistically migrate complex builder configurations to composeAgent for readability.

**Stop condition:** if compose model can't represent ≥80% of builder configurations without escape hatches, the unification is incomplete.

### Phase D — Future capability ecosystem (DOMAIN UNLOCK)

Only after Phase C is stable. Domain-specific packages start defining capability sets:
- `@reactive-agents-medical/strategies`
- Self-modifying agents
- Multi-agent capability composition

**These are payoff phases.** Not designed today.

## Non-goals

- **Replace builder.** Never. Builder is the convenience layer; capability composition is the underlying model.
- **Build a DSL.** No JSON/YAML specs. TS types are the spec.
- **Force migration.** All existing strategies / tools / hooks keep working. Composition is additive.
- **Top-down framework.** No Trajectory + makeMachine speculation. Combinators emerge from primitives empirically.
- **Replace the kernel `Phase` pattern.** It works. Combinator layer composes ABOVE kernel, not instead of.
- **Replace Effect-TS.** Foundation is sound. Build on it.

## Methodology (carries forward from [[2026-05-24-strategy-composability-design]])

Every step in this vision must honor the bottom-up evidence rules already proven:

1. **≥2 consumers in same PR** (no scaffold without callers, §9)
2. **Deterministic tests** for pure-logic surface
3. **Drift contract** CI-enforced
4. **Live LLM probe** per primitive/combinator/capability
5. **Live tool probe** when applicable
6. **LOC + test delta logged** honestly (don't overclaim)

Catalog candidates must be verified empirically BEFORE design spec is written (lesson from primitive #4 `decompose` skip).

## Open questions

1. **Should `Phase` and `Combinator` unify?** Both are `(state, ctx) => Effect<state>`. May be same shape with different scope. Verify empirically.
2. **Where does `runPass` fit in the new model?** It's a primitive today. In capability model, it's the bridge from `Strategy.Effect` to `Kernel.Effect`. May become invisible to users.
3. **How do capabilities declare conflicts?** Two strategies attached = error? Two budget killswitches = sum or override? Needs design.
4. **Static vs dynamic capability composition?** Some capabilities (`require-approval-for`) depend on runtime state. Compose-time vs run-time decision boundary needs clarity.
5. **Multi-tenant capability boundaries.** Future use case. Don't design until consumer arrives.

## What to do with this document

- **Use it for direction.** It articulates where the framework can go.
- **Do NOT use it as a build plan.** Each phase needs its own design spec + evidence gate.
- **Re-evaluate after each Phase A combinator ships.** Vision updates with empirical learning.
- **Sunset 2026-09-01** unless a Phase A combinator has landed.

## References

- Bottom-up primitive extraction (current branch): [[2026-05-24-strategy-composability-design]]
- Kernel composability shipped Apr 2026: [[project_composable_phases]]
- North Star §9 Anti-Scaffold: [[05-DESIGN-NORTH-STAR]]
- Compose API + killswitches: `packages/compose/src/killswitches/`
- Builder API (75 methods): `packages/runtime/src/builder.ts`
- Phase = (state, ctx) => Effect<state>: `packages/reasoning/src/kernel/loop/react-kernel.ts`
- v0.11.1 shipped state: [[project_v011_1_shipped]]
