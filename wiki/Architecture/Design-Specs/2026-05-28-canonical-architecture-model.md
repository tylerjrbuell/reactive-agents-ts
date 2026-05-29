---
title: Canonical Architecture Model — Reactive Agents (North Star Structural Design)
date: 2026-05-28
status: AUTHORITATIVE design spec — companion to 00-VISION, 06-MISSION-STATEMENTS, 07-OPTIMAL-EXECUTION-ALGORITHM
relationship-to-canon:
  - 00-VISION.md says WHY (8 pillars; stable, unchanged)
  - 06-MISSION-STATEMENTS.md says HOW IT BEHAVES at full realization (per-pillar / per-capability / per-trait)
  - 07-OPTIMAL-EXECUTION-ALGORITHM.md says THE PER-ITER STEPS (10-step canonical loop + 10 invariants)
  - THIS document says THE STRUCTURAL SHAPE (files, modules, types, contracts, dependency rules)
authority-source:
  - Mission statements demand the contracts
  - Verified-working code embodies the patterns (createLightRuntime, arbitrator.ts, CapabilityRegistry, kernel-state.ts)
  - Nothing in this document invents architecture not already present in canon or verified code
companion-refactor-plan:
  - wiki/Planning/Implementation-Plans/2026-05-28-canonical-refactor.md (gap analysis + workstream sequence to reach this model)
---

# Canonical Architecture Model — Reactive Agents

> **One sentence.** The structural shape of Reactive Agents as a four-layer, capability-leafed, Tag-composed, Arbitrator-terminated, registry-driven harness — where every file's role, every dependency's direction, and every advertised surface's wiring is specified, falsifiable, and anchored to the canon.

---

## 0. Frame

### 0.1 What this document is

The **structural blueprint** the framework is targeting. Stated as positive, falsifiable invariants. Each section says "this IS the canonical shape" — not "this would be nice."

The relationship to the existing canon:

| Doc | Question it answers |
|---|---|
| `00-VISION.md` | Why does Reactive Agents exist? (8 pillars) |
| `06-MISSION-STATEMENTS.md` | How does the runtime behave at full realization? (per-pillar / per-capability / per-trait positive declarations) |
| `07-OPTIMAL-EXECUTION-ALGORITHM.md` | What are the per-iter steps? (10-step canonical loop + 10 algorithmic invariants) |
| **THIS doc** | What is the canonical structural shape? (file layout, dependency rules, type contracts, Tag patterns, emit/consume law) |

The vision says we want control. The missions say what control looks like in behavior. The algorithm says what control looks like per iter. This document says what control looks like in the code itself — the modules, the boundaries, the contracts.

### 0.2 What this document is NOT

- **Not a roadmap.** Sequencing of changes lives in the refactor plan, not here.
- **Not aspirational.** Every statement is realizable today; gaps are documented in the refactor plan.
- **Not invented.** Each pattern below is either (a) already working in verified code, (b) demanded by an existing mission statement, or (c) implied by an algorithmic invariant. Nothing here originates outside those three sources.
- **Not soft.** Statements are imperative ("MUST", "SHALL", "is"), not advisory ("should consider", "may").

### 0.3 How to use this document

- **For new code:** does it match the shape this document specifies? If not, document why or change the code.
- **For PR review:** point reviewers at the section the change touches.
- **For onboarding:** read end-to-end. The framework's mental model lives here.
- **For refactor decisions:** the gap between current code and this model IS the refactor scope. The refactor plan operates on that delta.
- **For external comparison:** when another framework ships a feature, locate the corresponding section here. If absent, the model has a gap (file a finding, not an issue).

---

## 1. The Layered Model

### 1.1 Four layers (canonical)

The framework is organized in four layers. Each layer has one job. Each layer may only depend on layers below it. This is non-negotiable.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  L4 — SURFACE          (consumer-visible APIs)                          │
│                                                                         │
│      reactive-agents  · runtime  · gateway  · channels  · a2a          │
│      react · svelte · vue  ·  create-reactive-agent · diagnose         │
│      eval · observe · replay · benchmarks · scenarios                   │
└───────────────────────────────────────┬─────────────────────────────────┘
                                        │
┌───────────────────────────────────────▼─────────────────────────────────┐
│  L3 — DOMAIN           (cognitive concerns)                             │
│                                                                         │
│      reasoning  ·  reactive-intelligence  ·  interaction                │
│      memory · cost · identity · guardrails · verification               │
│      tools · prompts · orchestration                                    │
└───────────────────────────────────────┬─────────────────────────────────┘
                                        │
┌───────────────────────────────────────▼─────────────────────────────────┐
│  L2 — SUBSTRATE        (cross-cutting capabilities)                     │
│                                                                         │
│      llm-provider · observability · trace · testing                     │
│      compose · health · judge-server                                    │
└───────────────────────────────────────┬─────────────────────────────────┘
                                        │
┌───────────────────────────────────────▼─────────────────────────────────┐
│  L1 — FOUNDATION       (no agent semantics)                             │
│                                                                         │
│      core · runtime-shim                                                │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 The dependency rule

For any two packages P_n (layer n) and P_m (layer m):

- `P_n` MAY depend on `P_m` iff **m < n** (strictly lower layer)
- `P_n` MAY depend on `P_o` (same layer) iff the dependency goes through a published Tag in L1 or L2
- `P_n` MUST NOT depend on `P_q` (strictly higher layer) under any circumstance

Cycles are forbidden. CI lint walks the package import graph and fails on any L_n → L_m where m ≥ n.

### 1.3 What goes in each layer

**L1 — Foundation.** No agent semantics. No cognitive concerns. Pure type definitions, primitives, runtime-shim utilities. Two packages: `core` (types + EventBus + service Tags), `runtime-shim` (Bun/Node cross-runtime primitives).

**L2 — Substrate.** Cross-cutting capabilities consumed by every cognitive concern: LLM provider abstraction, observability, trace recording, test fixtures, killswitch compose, health, judge-server. **Do not** consume any L3 package. Do not contain cognitive semantics.

**L3 — Domain.** The 10 cognitive capabilities and their adjacent specialized domains: reasoning (the kernel), memory, tools, cost, identity, guardrails, verification, prompts, orchestration, interaction, reactive-intelligence. **Each owns one concern.** Cross-domain dependency MUST go through L1/L2 Tags.

**L4 — Surface.** The user-facing surface area: builder + agent class (runtime), umbrella facade (reactive-agents), gateway, channels, framework adapters (react/svelte/vue), CLI scaffolds, observation exporters, replay, benchmarks/scenarios. **Composes** lower layers; **does not define** new domain concerns.

---

## 2. The Kernel Architecture

The kernel lives at `packages/reasoning/src/kernel/`. It is the heart of the framework. Its structural shape is the framework's most load-bearing design decision.

### 2.1 Canonical file layout

```
packages/reasoning/src/kernel/
├── state/                          ← State concern owner
│   ├── kernel-state.ts             ← KernelState + transitionState() + KernelMessage + KernelMeta
│   ├── kernel-hooks.ts             ← KernelHooks construction from EventBus
│   └── kernel-constants.ts         ← META_TOOLS, INTROSPECTION_META_TOOLS, etc.
│
├── loop/                           ← Loop controller (the ONLY state mutator at runtime)
│   ├── runner.ts                   ← The main per-iter loop body
│   ├── react-kernel.ts             ← Default ReAct kernel; other strategies may register custom kernels
│   ├── terminate.ts                ← Single-owner terminal status writer
│   ├── auto-checkpoint.ts          ← Auto-checkpoint scheduling
│   └── output-{assembly,synthesis}.ts  ← Output assembly + synthesis utilities
│
├── capabilities/                   ← The 10 cognitive capabilities — each is a leaf
│   ├── sense/
│   ├── attend/
│   ├── comprehend/
│   ├── recall/
│   ├── reason/
│   ├── decide/                     ← arbitrator.ts is canonical single-owner termination decision
│   ├── act/
│   ├── verify/
│   ├── reflect/
│   └── learn/
│
├── substrate/                      ← Primitive utilities consumed by multiple capabilities
│   ├── tools/                      ← Tool dispatch + parsing + gating (extracted from act/)
│   └── (other substrate dirs as needed; see §6)
│
└── utils/                          ← Pure cross-cutting helpers
    ├── diagnostics.ts              ← emit* helpers (emitKernelStateSnapshot, emitVerifierVerdict, ...)
    ├── ics-coordinator.ts
    ├── lane-controller.ts
    ├── service-utils.ts
    └── (other pure helpers)
```

### 2.2 What each subdirectory MUST and MUST NOT do

| Subdir | MUST | MUST NOT |
|---|---|---|
| `state/` | Define KernelState shape; export `transitionState()`; export typed messages + meta | Mutate state directly; depend on capability dirs |
| `loop/` | Be the only place state mutates; call capabilities in canonical order; emit per-iter snapshots | Implement cognitive logic; reach into capability internals |
| `capabilities/<cap>/` | Own that capability's logic; export Tag if it has cross-cap consumers; emit at boundary | Import from sibling capability's internal modules; mutate state outside `transitionState()` |
| `substrate/` | Provide primitives consumed by multiple capabilities; be pure or kernel-state-coupled (declared) | Be a capability; emit capability-level events; have cross-capability semantics |
| `utils/` | Be pure helpers + emit* wrappers + diagnostic surface | Have business logic; hold state |

### 2.3 The leaf principle for capabilities

Each capability directory under `kernel/capabilities/` is a **leaf** in the kernel's internal dependency graph:

- It MAY import from `core`, `llm-provider`, `tools`, `memory`, `observability`, `trace` (L1/L2 packages)
- It MAY import from `kernel/state/` (the state shape)
- It MAY import from `kernel/substrate/` (shared primitives)
- It MAY import from `kernel/utils/` (pure helpers + emit wrappers)
- It MAY consume sibling capability's services **via a published Tag from `core/services/`**
- It MUST NOT import from sibling capability's internal modules (no `from "../<other-cap>/internal.js"`)

Violation = lint failure. CI enforces.

### 2.4 The substrate distinction (introduced)

`kernel/substrate/` is the canonical home for primitives that:

- Are consumed by **multiple** capabilities
- Encode primitive operations (tool dispatch, regex parsing, prompt utilities) rather than cognitive decisions
- May couple to kernel state but do NOT make capability-level decisions

This subdirectory does NOT exist in current code as a top-level entry. It is introduced by this model. The refactor plan WS-3 creates it.

Substrate MUST be consumed by capabilities, never the reverse. A capability cannot be "demoted" to substrate by being imported broadly — substrate has its own boundary contract (pure-or-state-coupled, no cognitive decision logic).

---

## 3. The Runtime Composition Pattern

### 3.1 The canonical shape

The runtime is composed declaratively via `Layer.mergeAll`. The pattern is already in production at `packages/runtime/src/runtime.ts:1061` (`createLightRuntime`). It IS the canonical pattern.

```typescript
// Canonical shape (verified working at createLightRuntime)
const layers: Array<ComposableLayer> = [
  coreLayer,
  eventBusLayer,
  llmLayer,
  memoryLayer,
  hookLayer,
  engineLayer,
  CapabilityRegistryLive,
];
if (options.enableTools) layers.push(toolsLayer);
if (options.enableReasoning) layers.push(reasoningLayer);
if (options.enableIdentity) layers.push(identityLayer);
// ... etc — one append per conditional layer

const runtime: ComposableLayer = Layer.mergeAll(...layers) as ComposableLayer;
return runtime;
```

### 3.2 The `ComposableLayer` erasure boundary (preserved)

Effect's `Layer<Out, Err, In>` union types blow up under ~25 optional layers ("type instantiation excessively deep"). The framework deliberately uses `ComposableLayer = Layer.Layer<unknown, unknown, unknown>` as the single erasure boundary. This is a **documented engineering decision**, not a debt.

The canonical pattern has **exactly one** `as ComposableLayer` cast: at the terminal `Layer.mergeAll(...)` call. The downstream `BuildBaseRuntimeResult` boundary in `builder/build-effect/runtime-construction.ts` re-narrows to concrete services. No cast anywhere else.

### 3.3 Two runtime constructors

| Constructor | Where | Purpose |
|---|---|---|
| `createRuntime(options)` | `packages/runtime/src/runtime.ts` | Full runtime — all optional layers |
| `createLightRuntime(options)` | `packages/runtime/src/runtime.ts` | Sub-agent runtime — minimum viable substrate |

Both MUST use the `Layer.mergeAll` pattern. Both share the conditional-append pattern for optional layers.

### 3.4 Forbidden patterns

- **Mutation chain.** `let runtime = baseLayer; runtime = Layer.merge(runtime, X) as ComposableLayer; runtime = Layer.merge(runtime, Y) as ComposableLayer; ...` — replaced by collected-array + terminal `mergeAll`.
- **Per-link casts.** `Layer.merge(a, b) as ComposableLayer` followed by `Layer.merge(merged, c) as ComposableLayer` — replaced by one terminal cast.
- **Implicit Layer ordering dependence.** Each layer's dependencies are made explicit via `.pipe(Layer.provide(depLayer))` at the layer's construction site, not by relying on merge order.

---

## 4. The State Model

### 4.1 The immutability law

`KernelState` is immutable. Every iter produces a **new** state via `transitionState()`. No code outside `kernel/loop/` may write to state directly.

```typescript
// Canonical (verified at kernel-state.ts)
const nextState = transitionState(state, { status: "acting", iteration: state.iteration + 1 });
// NOT: state.status = "acting"; state.iteration++;
```

### 4.2 The `transitionState()` canonical mutator

Single function. Single signature. Single owner of all mutation. Lives at `packages/reasoning/src/kernel/state/kernel-state.ts`.

```typescript
export function transitionState(
  state: KernelState,
  patch: Partial<KernelState>,
): KernelState;
```

Every status transition flows through this function. Every meta update flows through this function. Every step append flows through this function. No exceptions in production code.

### 4.3 The ≤10 mutation site invariant (Mission Pillar 4)

In the entire kernel, the number of code locations where state is mutated MUST be ≤10 total. These are:

1. `runner.ts` per-iter state update (1 site)
2. `runner.ts` terminal state finalization (1 site)
3. `loop/terminate.ts` single-owner terminal status writer (1 site)
4. `kernel/capabilities/decide/arbitrator.ts` Verdict-application (via `arbitrateAndApply`) — 1 site
5. `loop/auto-checkpoint.ts` checkpoint write (1 site)
6. (4 reserved for canonical phase transitions)

Everything else mutating state is a lint violation. Capabilities MAY return patches; the loop controller applies them. No capability writes state.

### 4.4 The KernelStatus state machine

```typescript
type KernelStatus = "thinking" | "acting" | "observing" | "done" | "failed" | "evaluating";
```

Allowed transitions (canonical):

```
START
  ↓
thinking → acting → observing → thinking → ... (loop)
  ↓                                ↓
evaluating ← arbitrator ←─────────┘
  ↓
done | failed
```

Other transitions (e.g. `done → thinking`) are forbidden by `transitionState()` validation. `done` and `failed` are terminal.

### 4.5 The message + meta shapes

```typescript
type KernelMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: readonly ToolCallSpec[] }
  | { role: "tool_result"; toolCallId: string; toolName: string; content: string; isError?: boolean; storedKey?: string };

interface KernelMeta {
  readonly entropy?: KernelEntropyMeta;          // RI signal cache
  readonly controllerDecisions?: readonly ControllerDecisionLike[];  // intervention history
  readonly maxIterations?: number;
  readonly requiredTools?: readonly string[];
  readonly pendingGuidance?: PendingGuidance;    // typed harness signals
  readonly budgetLimits?: BudgetLimits;          // Pillar 6 declarative budgets
  // ... etc; every field optional; every field typed
}
```

`PendingGuidance` is typed (no string-bag pattern). Every harness signal MUST be a named optional field, never a free-form payload.

---

## 5. The Arbitrator

### 5.1 Single-owner termination decision (with one emergency escape valve)

`packages/reasoning/src/kernel/capabilities/decide/arbitrator.ts` exports `evaluateTermination(ctx, evaluators)` returning `TerminationDecision`. **This is the canonical termination decision function for normal exits** — every `done` or `failed` Verdict driven by reasoning, verifier, controller, or entropy MUST flow through here.

**One acknowledged escape valve:** killswitch abort paths in `act.ts` + `runner.ts` write `status` directly when a compose-API killswitch (`maxIterations`, `timeoutAfter`, `watchdog`, etc.) fires `abort: 'stop' | 'terminate'`. This bypasses the Arbitrator deliberately — killswitches are emergency cutoffs for user-declared invariants (budget exceeded, wall-clock exhausted), not reasoning decisions. The runtime stamps `state.terminatedBy` so observability can distinguish "killswitch-fired" from "arbitrator-decided."

Verified working today — no rework required for arbitrator.ts itself. The 27 raw `state.status =` mutation count surfaced in §3.6 F10 includes BOTH this legitimate killswitch escape valve AND illegitimate ad-hoc writes (the lint rule WS-3 Phase 4 ships distinguishes them via an allowlist on `terminate.ts` + killswitch-abort sites).

### 5.2 The Verdict shape

```typescript
interface SignalVerdict {
  readonly action: "exit" | "redirect" | "continue" | "fail";
  readonly confidence: "high" | "medium" | "low";
  readonly reason: string;
  // ... evaluator-specific fields
}

interface TerminationDecision {
  readonly shouldExit: boolean;
  readonly action: SignalVerdict["action"];
  readonly confidence: "high" | "medium" | "low";
  readonly reason: string;
  readonly evaluator: string;
  readonly allVerdicts: ReadonlyArray<{ evaluator: string; verdict: SignalVerdict }>;
}
```

Action maps to canonical mission verdicts:

| arbitrator.ts action | Canon mission verdict |
|---|---|
| `continue` | `continue` |
| `exit` | `exit-success` |
| `fail` | `exit-failure` |
| `redirect` | `escalate` (strategy switch / HITL) |

### 5.3 The signal pipeline — canonical 6-category abstraction with concrete evaluators

Per `07-OPTIMAL-EXECUTION-ALGORITHM` §1 step 6, the Arbitrator is **abstractly** characterized by six signal categories:

| Canonical category | Concrete `TerminationSignalEvaluator`(s) in `arbitrator.ts` (verified) |
|---|---|
| `EntropySignal` (from `reactive-intelligence/sensor`) | `entropyConvergenceEvaluator`, `contentStabilityEvaluator` |
| `VerifierSignal` (from `kernel/capabilities/verify`) | `completionGapEvaluator` |
| `HealingSignal` (from substrate tools healing pipeline) | (implicit via failure streak feeding `controllerSignalVetoEvaluator`) |
| `KillswitchSignal` (from `compose/killswitches`) | (escape valve — bypasses arbitrator; see §5.1) |
| `LoopDetectorSignal` (from `kernel/capabilities/reflect`) | `controllerSignalVetoEvaluator` (consumes controller decision log) |
| `BudgetSignal` (from `cost/budgets`) | (currently routes through KillswitchSignal; G-A gap per fresh-lens audit) |
| **Agent-intent signals (not in canon 6 but currently present)** | `pendingToolCallEvaluator`, `finalAnswerToolEvaluator`, `finalAnswerRegexEvaluator`, `llmEndTurnEvaluator`, `reactiveControllerEarlyStopEvaluator` |

**Verified inventory:** 9 concrete `TerminationSignalEvaluator` exports in arbitrator.ts (`defaultEvaluators` array). The 6-category canon is the conceptual model; the 9 evaluators are concrete refinements (multiple evaluators per category) PLUS 5 agent-intent evaluators that interpret the model's own exit signals (`final-answer` tool call, end-turn signal, etc.) which canon implicitly treats as "agent says done" pre-arbitration.

**Gap (logged for §17 mapping):** `BudgetSignal` currently does NOT have a dedicated evaluator — budget enforcement routes through compose-killswitch abort. Fresh-lens gap G-A; refactor candidate.

Each evaluator returns `SignalVerdict | null`; `evaluateTermination` short-circuits on first high-confidence FAIL/EXIT/REDIRECT, then aggregates remaining medium/low. Exactly one `TerminationDecision` per iter.

### 5.4 The Verdict-Override pattern (anti-mission #4 enforcement)

The Arbitrator may override a positive Verdict from one evaluator with a FAIL verdict from another when controller activity contradicts agent success. Specifically: if the agent's `final-answer` says exit-success but controller decisions show persistent failure pattern (high entropy + tool-failure streak + escalations), the FAIL veto fires. Status becomes `failed`, output becomes `null`. This is the trust differentiator: honest fail over fake success.

---

## 6. The Capability Boundary Contract

### 6.1 What every capability IS

A capability is:

- A directory under `kernel/capabilities/<name>/`
- One concern (Sense, Attend, Comprehend, Recall, Reason, Decide, Act, Verify, Reflect, Learn)
- A set of pure-where-possible functions consumed by the Loop Controller
- A boundary that emits its own observation events
- A leaf in the kernel dependency graph

### 6.2 The 10 capability boundary contracts

| Capability | Purity class (see §6.3-6.5) | Owns | Emits | Reads from | Returns to loop |
|---|---|---|---|---|---|
| **Sense** | PURE | Observation construction | `observation-emitted` × N | state, env | `Observation[]` |
| **Attend** | PURE | Salience + curation + prompt assembly | `curator-decision` per fragment | observations, history, budget | `CuratedContext` |
| **Comprehend** | PURE | Task intent + soft-required-tools + format hints | `comprehend-result` | task text, state | `ComprehendResult` |
| **Recall** | EFFECTFUL (memory IO) | Memory + skill + calibration lookup | `memory-recall` × type | query, modelId, taskCategory | `RecallResult` |
| **Reason** | EFFECTFUL (LLM IO) | LLM invocation + provider abstraction | `llm-exchange` per round-trip | curatedContext, tools, calibration | `LLMResponse` |
| **Decide** | PURE | Signal integration → Verdict | `arbitrator-verdict` (1 per iter) | 6 signal categories + state | `TerminationDecision` |
| **Act** | EFFECTFUL (tool IO) | Tool dispatch via `executeToolCall()` | `tool-call-start/end`, `observation.tool-result` | Verdict, pending calls | `Observation[]` |
| **Verify** | PURE-DECISION + EFFECTFUL-EMIT | Per-check severity ladder | `verifier-verdict` (with checks array) | output, intent, observations | `VerifierVerdict` |
| **Reflect** | PURE-DECISION + EFFECTFUL-EMIT | Loop / trajectory / evidence signals | `reflection-signals` | history, observations, verdict | `ReflectionSignals` |
| **Learn** | EFFECTFUL (memory IO, async) | Skill + calibration + memory writes | `learn-write` × target | observations, decisions, outcomes | (none — fire-and-forget) |

### 6.3 The pure-by-default capabilities (Sense, Attend, Comprehend, Decide)

These capabilities own pure decision logic:

- Take only input + state + observations
- Return a result derived deterministically (same input → same output)
- Are testable with no Layer setup
- Declare `Effect.Effect<Result, never, never>` for decision logic (zero error channel, zero requirement)
- MAY use Effect monad for composition — using Effect is not the same as being effectful

**First-hand verification:** sense, attend, comprehend, decide directories import ZERO IO-bearing services (LLMService, ToolService, MemoryService). Pure ✅.

### 6.4 The pure-decision-effectful-emit capabilities (Verify, Reflect)

These capabilities have **pure decision logic + side-effecting emit obligations**:

- Decision functions (`verify()`, `reflect()`) are pure: same input → same severity ladder / signal output
- Emit wrappers use `Effect` for trace event publication via `ObservableLogger` / `EventBus`
- The emit is the side effect; the decision is not

**First-hand verification:** `verify/` imports `Effect` + `ObservableLogger` (2 IO-bearing imports); `reflect/` imports `Effect` + `ObservableLogger` + `EventBus` (3). These are for emit, not for decision IO.

The boundary contract: each public function in verify/reflect MUST be split into:
- A pure inner function (`computeVerifierVerdict(state) → VerifierVerdict`) — testable with no Layer
- A public effectful wrapper (`verify(state) → Effect.Effect<VerifierVerdict, never, ObservabilityService>`) — handles emit

This split is partially present today; WS-3 + WS-5 codify it.

### 6.5 The effectful capabilities (Recall, Reason, Act, Learn)

These capabilities do real IO:

- Declare typed errors via Effect's error channel (e.g. `Effect.Effect<Result, ToolError, LLMService | ToolService>`)
- Never `Effect.runPromise` internally — the runtime controls execution
- Never throw — errors flow through the typed channel
- Never `catchAll(() => {})` — errors are routed through `emitErrorSwallowed` if intentionally absorbed, or propagated

### 6.5 Capability emit obligation

Every capability emits at its boundary. The Loop Controller (`runner.ts`) emits ONLY:

- `kernel-state-snapshot` at iter start (1 per iter)
- `phase-started` / `phase-completed` at canonical phase boundaries

All other emits live in capabilities. The audit at `runner.ts:39 emit-related lines` MUST shrink to ≤10 after the refactor. The other 29+ relocate to their owning capability.

---

## 7. The Strategy Primitive

### 7.1 The Pillar 3 mission

> "Strategies are declarative compositions of capabilities, not parallel loop reimplementations. New algorithmic shapes are first-class primitives; new strategies are array literals."

### 7.2 The canonical Strategy contract

```typescript
type Strategy = (ctx: StrategyContext) => Effect.Effect<ReasoningResult, ExecutionError | IterationLimitError, LLMService>;
```

`StrategyContext` is **≤15 fields** total. Substrate-derived; not a god-input.

```typescript
interface StrategyContext {
  // ── Identity ──
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly taskId?: string;

  // ── Task ──
  readonly task: TaskInput;                     // taskDescription + taskType + initialMessages
  readonly intent: ComprehendResult;            // softRequiredTools + formatHints + complexity

  // ── Substrate ──
  readonly tools: ToolSubstrate;                // availableTools + schemas + healing + gating
  readonly memory: MemorySubstrate;             // memoryContext + briefResolvedSkills
  readonly calibration: CalibrationSubstrate;   // contextProfile + modelId + temperature + tier

  // ── Composition ──
  readonly config: ReasoningConfig;             // strategy-specific config block
  readonly harnessPipeline?: HarnessPipeline;   // compose API access

  // ── Runtime ──
  readonly resultCompression?: ResultCompressionConfig;
  readonly metaTools?: KernelMetaToolsConfig;
  readonly synthesisConfig?: SynthesisConfig;
  readonly verifier?: Verifier;
  readonly budgetLimits?: BudgetLimits;

  // ── Adaptive ──
  readonly strategySwitching?: StrategySwitchingConfig;
}
```

Each grouping is a substrate object that the runtime derives once + threads through. Strategies pick out what they need; they do not need to know about 30+ scattered fields.

### 7.3 Strategy combinators (the declarative primitive)

```typescript
// Combinators (the substrate strategies compose over)
const iterateUntil: <S>(
  step: (ctx: StrategyContext, state: S) => Effect.Effect<S>,
  condition: (state: S) => boolean,
  options?: { maxIter?: number }
) => (ctx: StrategyContext) => Effect.Effect<S>;

const branchAndPick: <S>(
  branches: ReadonlyArray<(ctx: StrategyContext) => Effect.Effect<S>>,
  picker: (results: readonly S[]) => S
) => Strategy;

const routedDispatch: (
  routes: Readonly<Record<string, Strategy>>,
  router: (ctx: StrategyContext) => string
) => Strategy;
```

These three combinators cover the algorithmic shapes of all six current strategies:

| Strategy | Combinator composition |
|---|---|
| `reactive` | `iterateUntil(thinkActObserve, doneOrMaxIter)` |
| `direct` | `iterateUntil(thinkActObserve, doneOrMaxIter, { maxIter: 1 })` |
| `reflexion` | `iterateUntil(initialThenCritique, convergedOrMaxIter)` |
| `plan-execute-reflect` | `iterateUntil(plan ▷ executeWaves ▷ reflect ▷ refine, doneOrMaxIter)` |
| `tree-of-thought` | `branchAndPick(bfsExplore × N, scoreAndSelect)` ▷ `iterateUntil(executeBest)` |
| `code-action` | own substrate (Worker sandbox); does not use kernel loop |

### 7.4 The ≤200 LOC strategy ceiling

After refactoring to combinators, each strategy file MUST be ≤200 LOC. The current 774 LOC (reflexion), 727 LOC (tree-of-thought), 1548 LOC (plan-execute) implementations are all combinator candidates; their LOC budget shrinks because loop control is inherited.

---

## 8. The Service Tag Pattern

### 8.1 The canonical Tag definition

Every cross-package service is defined via Effect's `Context.Tag` pattern.

```typescript
// In core (or owning package)
export class MyService extends Context.Tag("MyService")<
  MyService,
  {
    readonly doThing: (input: Input) => Effect.Effect<Output, MyServiceError>;
    readonly listThings: () => Effect.Effect<readonly Thing[]>;
  }
>() {}
```

### 8.2 The Live layer

```typescript
export const MyServiceLive = Layer.effect(
  MyService,
  Effect.gen(function* () {
    const dep = yield* SomeOtherService;
    return {
      doThing: (input) => /* impl using dep */,
      listThings: () => /* impl */,
    };
  })
);
```

### 8.3 The Test layer

```typescript
export const MyServiceTest = (overrides?: Partial<MyServiceShape>) =>
  Layer.succeed(
    MyService,
    {
      doThing: () => Effect.succeed(defaultOutput),
      listThings: () => Effect.succeed([]),
      ...overrides,
    }
  );
```

### 8.4 When to publish a Tag (cross-package consumption)

A service Tag is published in `@reactive-agents/core/services/` (or the owning L2 package) iff:

- It is consumed by ≥2 different L3 or L4 packages
- Its consumers cannot reasonably be re-rooted into the owning package
- The Tag exposes a stable contract (rare schema changes)

If only one consumer exists, keep the service local. If consumers proliferate, publish the Tag — never reach into a package's internals.

### 8.5 The Tag-based cross-capability contract

Inside the kernel, sibling capabilities consume each other ONLY via published Tags:

- `act` exposes `ToolExecutionService` Tag from `core/services/`
- `verify` exposes `VerificationService` Tag from `core/services/`
- `reason` consumes those Tags; does not `import "../act/tool-execution.js"` directly

This is the leaf principle enforcement.

---

## 9. The Emit/Consume Contract (Anti-Scaffold Law)

### 9.1 The invariant

**No declared surface element ships without a live emit site AND a live consumer site in the same commit.**

Surface elements include:

- TagMap entries (Compose API tags)
- ControllerDecision union variants
- CapabilityRegistry entries
- Calibration fields
- Public event types
- Public service methods

### 9.2 CI enforcement

A CI lint walks the type graph at PR time:

- For every TagMap entry: confirm ≥1 `emit(...)` call site exists for that tag
- For every TagMap entry: confirm ≥1 `pipeline.transform(...)` consumer site exists
- For every ControllerDecision variant: confirm ≥1 emitter + ≥1 dispatcher handler
- For every CapabilityRegistry entry: confirm the registered name is referenced by ≥1 consumer (HarnessProfile, runtime decision logic, etc.)
- For every calibration field: confirm ≥1 reader exists in production code

Failure = PR blocked.

### 9.3 The deliberate-sentinel exception

A registry entry MAY ship with `liftEvidence: null` IFF the entry is documented as a load-bearing CI signal — i.e., the absence of evidence is the ablation-warden's gate input. Currently exactly one entry uses this (`strategy-switching`). Documented in `capability-registry.ts:218–229`.

Any other case is a violation.

### 9.4 The retroactive sweep rule

Existing surface elements without emit + consumer pairs ARE in violation. They must be either:

- **Wired** — emit site + consumer site shipped in the next commit touching the area
- **Deleted** — surface removed, type union pruned, registry entry deleted

There is no "deprecate later" path. Surface lives or dies.

---

## 10. The CapabilityRegistry & HarnessProfile

### 10.1 CapabilityRegistry as single source of truth for defaults

`packages/runtime/src/capabilities/registry.ts` is the canonical registry of default-on capabilities. Every default-on toggle in the runtime MUST have a CapabilityRegistry entry. No `_enableX: true =` literal in `runtime.ts` or `builder.ts` without a corresponding registry entry that explains why.

Verified shape:

```typescript
interface CapabilityEntry {
  readonly name: string;
  readonly description: string;
  readonly defaultOn: boolean;
  readonly costSignature: CostSignature;          // tokens + latency + extraLLMCalls + tier
  readonly liftEvidence: LiftEvidence | null;     // measuredOn + delta + evidence path + date
  readonly riskNotes: string;
  readonly rationale: string;
  readonly ownerWarden: WardenOwner;
  readonly lastAblation: string | null;
}
```

Audit method returns:

```typescript
interface CapabilityAuditReport {
  readonly totalEntries: number;
  readonly defaultOnCount: number;
  readonly entries: readonly CapabilityEntry[];
  readonly byWarden: Readonly<Partial<Record<WardenOwner, readonly CapabilityEntry[]>>>;
  readonly staleEntries: readonly CapabilityEntry[];           // > 90 days since last ablation
  readonly violations: readonly CapabilityEntry[];             // defaultOn && liftEvidence === null
}
```

### 10.2 HarnessProfile presets derive from registry

`HarnessProfilePatch` MUST derive its field shape from the registry, not hard-code booleans:

```typescript
// Canonical (target)
type HarnessProfilePatch = {
  readonly name: HarnessProfileName;
} & Partial<Record<RegisteredCapabilityName, boolean>>;

// NOT canonical (current — F7 finding)
interface HarnessProfilePatch {
  readonly name: HarnessProfileName;
  readonly enableMemory?: boolean;
  readonly enableReactiveIntelligence?: boolean;
  readonly enableVerifier?: boolean;
  readonly enableStrategySwitching?: boolean;
  readonly enableSkillPersistence?: boolean;
}
```

Adding a new registry entry MUST NOT require touching `profile.ts`. Anti-mission #3 (preset proliferation) is prevented structurally.

### 10.3 The three canonical presets

| Preset | Capability set | Use case |
|---|---|---|
| `HarnessProfile.lean()` | All registry defaults OFF | Benchmark ablation cells; latency-critical paths; "model is the whole harness" |
| `HarnessProfile.balanced()` | Registry defaults (no patch) | Today's production defaults |
| `HarnessProfile.intelligent()` | Balanced + cross-session learning | Compounding intelligence; long-lived agents |

`HarnessProfile.research()` MAY be added in future; the contract is stable at 3 named presets minimum.

### 10.4 The ablation-warden gate

Every default-on registry entry MUST have `liftEvidence !== null` (or the deliberate-sentinel exception). The ablation-warden CI gate (cf-25 in `packages/testing/`) fails the build if a default-on entry lacks evidence. This is the structural enforcement of Mission Pillar 6 (Efficiency — defaults justified empirically).

---

## 11. The User Surface

### 11.1 The composition layers (preference order)

1. **`HarnessProfile.lean()/balanced()/intelligent()`** — primary. Quickstart docs use this.
2. **`.compose(harness => ...)`** — advanced. For users overriding specific tags / phases / hooks.
3. **`.withX()` methods** — backward compat. Marked `@deprecated alias for HarnessProfile.X` when redundant.

### 11.2 The ≤24 builder method ceiling (anti-mission #3)

Mission anti-mission #3: "24 named override methods IS the failure mode." The current `builder.ts` has 59 withers (2.4× threshold). Target:

- ≤24 builder methods total
- Each remaining wither has a justification (no preset covers the case AND `.compose()` is too low-level)
- Withers with redundant preset coverage are `@deprecated alias`

The runtime API surface gets smaller, not bigger, as capability set grows. New defaults go to registry + presets; new methods do NOT.

### 11.3 The compose harness API

`compose` (L2 package) provides the typed harness chokepoints. Users override defaults by composing a `Harness` value:

```typescript
import { ReactiveAgents } from "reactive-agents";
import { HarnessProfile } from "@reactive-agents/runtime";

const agent = await ReactiveAgents
  .create()
  .withProfile(HarnessProfile.balanced())
  .compose(harness => {
    harness.on("prompt.system", () => "You are a helpful tax-prep assistant.");
    harness.tap("observation.tool-result", (obs) => log(obs));
    harness.before("act", (ctx) => guardrailCheck(ctx));
  })
  .build();
```

Every chokepoint is typed via TagMap. Every tag has a payload type via `PayloadFor<Tag>`. Wildcard + predicate patterns are supported. The full chokepoint catalog lives in `compose/src/harness-tag-catalog.generated.ts`.

### 11.4 The killswitch set (frozen at 6)

`compose/killswitches/` exports exactly 6 canonical killswitches:

`budgetLimit · maxIterations · timeoutAfter · watchdog · requireApprovalFor · confidenceFloor`

Adding a 7th requires architectural review (does it belong as a registry-driven capability instead?).

---

## 12. The Observability Architecture

### 12.1 The four observation packages

| Package | Layer | Role |
|---|---|---|
| `core/event-bus.ts` | L1 | The EventBus implementation; AgentEvent union |
| `trace` | L2 | Trace event types + JSONL recorder + reader |
| `observability` | L2 | Tracing service + metrics collector + logger |
| `observe` | L4 | OpenTelemetry / OpenInference span exporter (consumes EventBus) |

These compose:

- `EventBus` publishes typed `AgentEvent` records
- `trace` records to JSONL for replay
- `observability` aggregates metrics + structured logs
- `observe` bridges to external OTel sinks

### 12.2a Runner.ts legitimate emit surface (amendment 1)

The Loop Controller (`runner.ts`) is allowed to emit ALL of the following:

1. **Per-iter snapshots** — `emitKernelStateSnapshot` at iter-start and at terminal transitions (~3 sites)
2. **Phase boundaries** — `emitLog({ _tag: "phase_started", phase: "..." })` at canonical phase transitions (~1 site)
3. **Orchestration-decision injections** — `emitHarnessSignalInjected` when the runner COMBINES multi-capability signals (required-tools + loop-detection + recovery-state) into a guidance message it injects into the LLM thread. These are NOT capability-owned because the *decision-to-inject* is the loop's, not any single capability's. (~4 sites)
4. **Observability warnings** — `emitLog({ _tag: "warning", message: "..." })` documenting orchestration decisions (harness-deliverable, output-gate, oracle-gate, auto-checkpoint, synthesis fallback). These are the LOG SURFACE, not capability events. (~15 sites)
5. **Auto-checkpoint diagnostics** — emit when the runner saves observation state pre-pressure-gate (~1 site)

Capability-event emits (`verifier-verdict`, `arbitrator-verdict`, `tool-call-*`, `memory-recall`, `learn-write`, etc.) MUST fire from the capability boundary, NOT from runner. WS-3 Phase 5a (verifier-verdict) + Phase 5b (BudgetSignalCollected) shipped this migration.

**Canonical target for runner.ts emit-line count: ≤30** (revised from prior ≤15 aspiration). The lower target was unachievable without splitting orchestration-decision logic across capabilities — which would have FOUGHT the canonical loop's role as state mutator and signal integrator (architecture model §4.5 + Mission Pillar 4).

### 12.2 What every iter MUST emit (Pillar 2 enforcement)

Per `07-OPTIMAL-EXECUTION-ALGORITHM` §3:

| Iter step | Required emit |
|---|---|
| 0. Setup | `kernel-state-snapshot { iter, status: "entering" }` |
| 1. Sense | `observation-emitted` × N |
| 2. Attend | `curator-decision` per kept/dropped fragment |
| 3. Comprehend | `comprehend-result { softRequiredTools, formatHints, complexity }` |
| 4. Recall | `memory-recall` × { type, hits } |
| 5. Reason | `llm-exchange { promptHash, responsePreview, tokens, latency }` |
| 6. Decide | `arbitrator-verdict { verdict, signalSources }` (exactly 1) |
| 7. Act | `tool-call-start/end` × N + `observation.tool-result` × N |
| 8. Verify | `verifier-verdict { checks: [{name, severity, reason}] }` |
| 9. Reflect | `reflection-signals` (for next iter's Arbitrator) |
| 10. Learn | `learn-write` × { target, success, durationMs } |

A run trace is complete iff every iter has all 10 required emits. Replay determinism requires this.

### 12.3 The replay determinism property

`packages/replay/` records every emit + every LLM round-trip + every tool result. `replay(traceId, overrides)` reproduces the run:

- Same tool results: bytewise replay of observations
- Same LLM responses (via cassette layer): bytewise replay of provider calls
- With overrides: re-run prompts / tools / strategies on the same task and compare

Replay is a **property**, not a feature. The trace IS the run.

---

## 13. The Verification Model

### 13.1 Multi-severity ladder

`VerifierVerdict` is NOT a boolean. It is:

```typescript
interface VerifierVerdict {
  readonly checks: ReadonlyArray<{
    readonly name: string;
    readonly severity: "pass" | "warn" | "reject" | "escalate";
    readonly reason: string;
  }>;
  readonly computedVerified: boolean;            // derived: all severities ∈ {pass, warn}
}
```

The Arbitrator interprets severity:

- `pass` → no impact on Verdict
- `warn` → surface in trace; do not block exit
- `reject` → block exit-success; force redirect or retry
- `escalate` → force escalate Verdict (HITL or strategy switch)

### 13.2 Output sanitization at exit-success

Every `exit-success` Verdict MUST pass `state.output` through `output-assembly.ts:sanitizeOutput` before persisting. The sanitizer strips:

- `<rationale>...</rationale>` XML (M2a leak)
- `[CRITIQUE N] SATISFIED:` prefixes (M2b leak)
- `[find result — compressed preview]` markers (M2c leak)
- Any tag-injection from upstream context

Output that fails sanitization triggers verifier severity `reject`; the Arbitrator converts the Verdict to `redirect` (re-synthesize).

### 13.3 The honest-fail invariant

```
status === "failed"  ⇒  output === null
status === "done"    ⇒  output !== null && output.length > 0 && output === sanitize(output)
```

Anti-mission #4 enforced structurally. No fallback string. No "I'm sorry, I couldn't complete..." synthesized text. Failure is honest or it is a bug.

---

## 14. The Performance Model

### 14.1 The per-iter framework overhead budget

Sum of non-LLM, non-tool time per iter MUST be ≤59ms:

```
Setup    ≤ 0.5ms
Sense    ≤ 1ms
Attend   ≤ 5ms
Comprehend ≤ 2ms
Recall   ≤ 10ms
Decide   ≤ 5ms
Verify   ≤ 10ms
Reflect  ≤ 5ms
Learn    ≤ 20ms (async, non-blocking)
─────────────
Total    ≤ 58.5ms
```

Anything above this is symptomatic of drift. Profiling identifies the offending capability.

### 14.2 Tier-specific defaults

Calibration drives tier-specific defaults:

| Tier | Strategy default | Verifier | RI mode | LLM-exchange capture |
|---|---|---|---|---|
| Frontier | adaptive | warn-only | minimal | preview only |
| Local Large | adaptive | warn → reject | full | full prompt+completion |
| Local Mid | reactive | warn → reject → escalate | full + aggressive healing | full + reasoning trace |
| Local Small | direct/reactive | escalate-fast | minimal | full |

Tier is detected from capability snapshot (`packages/llm-provider/src/calibrations/`).

### 14.3 Token + cost aggregation

`AgentResult.metadata.tokensUsed` MUST aggregate from real per-call data (every `LLMRequestCompleted` event). Never declared as 0 when calls happened. Never fabricated. Invariant 8 of `07-OPTIMAL-EXECUTION-ALGORITHM`.

---

## 15. The Multi-Agent Composition

### 15.1 A2A as the inter-agent substrate

`@reactive-agents/a2a` (L4) provides AgentCard + JSON-RPC 2.0 + SSE streaming. Agents discover + invoke each other via A2A. The framework is **single-agent + A2A**, not a workflow DAG framework (LangGraph-style). Workflow composition is the user's domain.

### 15.2 Sub-agent delegation contract

When an agent invokes a sub-agent (via tool call to spawn-sub-agent or via A2A):

- `createLightRuntime` constructs the sub-agent's runtime (minimum substrate)
- Identity propagates through the call (auth claims, capability delegation)
- Trace context propagates (parent runId, span IDs)
- Memory scopes:
  - Working memory (per-run): NOT shared
  - Semantic memory (cross-session): MAY be shared (configurable)
  - Episodic memory (trajectory log): NOT shared

### 15.3 Identity propagation

Identity context (auth claims) propagates through:

- A2A messages: `Message.metadata.identity` preserves the caller's claims
- Sub-agent spawning: child inherits parent's identity unless explicit re-auth
- Tool calls: identity is checked at `executeToolCall()` boundary, not at tool implementation

Identity is enforced at substrate boundaries, NOT advisory at L4. Verified by `packages/identity/` audit.

### 15.4 What this framework does NOT ship

- **Workflow DAG primitive (LangGraph-style `StateGraph`).** Out of scope. Compose externally.
- **Manager-worker hierarchies (AutoGen-style `GroupChat`).** Out of scope. Use A2A + custom orchestration.
- **Browser / computer-use primitive.** Out of scope today (G-K fresh-lens gap; decision deferred).

---

## 16. Non-Goals (what this model explicitly does NOT include)

- **Multi-agent declarative graph language.** A2A + orchestration package is the multi-agent surface.
- **A new strategy beyond the 6 canonical ones.** Code-action is the 7th; future strategies require architectural review.
- **A second composition layer above HarnessProfile.** Three named presets is the cap; advanced users use `.compose()`.
- **Audio / video / PDF modality blocks.** Text + image only. Multimodal expansion is demand-driven.
- **A second LLM service Tag beyond `LLMService`.** Provider variations live inside the LLMService Layer.
- **A second EventBus.** Single bus per run; subscribers are services, not parallel buses.
- **A second canonical loop.** `react-kernel.ts` is the canonical kernel; custom kernels register via StrategyRegistry but obey the same structure.
- **Inheritance hierarchies among capabilities.** Capabilities are functions, not classes; composition is the only relationship.

---

## 17. Mapping This Model to Current State

This is the gap analysis at a glance. Full evidence + workstream sequencing lives in `wiki/Planning/Implementation-Plans/2026-05-28-canonical-refactor.md`.

| Section | Current state | Gap | Refactor workstream |
|---|---|---|---|
| §1 Layered Model | 4 layers respected with some drift | AGENTS.md tree omits ~12 packages | WS-5 doc-drift |
| §2 Kernel arch — capabilities | 10 dirs ✅ | `act/` 3053 LOC contains tool substrate; 3 cycles | **WS-3** |
| §2 Kernel arch — substrate | `kernel/substrate/` does not exist | Create it; extract tool-parsing | **WS-3 Phase 1** |
| §3 Runtime composition | `createLightRuntime` ✅ canonical; `createRuntime` mutation chain | 40× Layer.merge → 1× Layer.mergeAll | **WS-2** |
| §4 State model | KernelState ✅ immutable; `transitionState()` exists | 27 raw `state.status =` violations | **WS-3 Phase 4 lint** |
| §5 Arbitrator | ✅ verified canonical single-owner | none (some signal pipeline gaps) | (covered by WS-7 §1.6 of canon doc) |
| §6 Capability contract | Capabilities exist; some emit at boundary | 38 cross-capability internal imports; `runner.ts` has 39 emit lines that belong at boundaries | **WS-3 Phase 4/5** |
| §7 Strategy primitive | 8 strategies registered; `StrategyFn` has 30+ field input | Refactor to `StrategyContext` ≤15 fields; introduce combinators | **WS-3 Phase 6 (new)** + future combinator work |
| §8 Service Tag pattern | Tags exist for major services | Cross-cap dep enforcement needs lint | **WS-3 Phase 4 lint** |
| §9 Emit/Consume contract | `confidenceFloor` doc lies; observe pkg 0 callers; 4 dead Compose tags | Wire or delete; add CI lint | **WS-4** |
| §10 CapabilityRegistry + HarnessProfile | Registry clean ✅; HarnessProfilePatch hard-coded fields | Generalize patch type | **WS-4** |
| §11 User surface | 59 builder methods (2.4× threshold) | Reduce to ≤24; mark redundant as `@deprecated alias` | **WS-2 Phase 3** |
| §12 Observability | EventBus ✅; trace ✅; observability ✅; observe (0 callers) | Wire or delete observe pkg | **WS-4** |
| §13 Verification | Verifier exists; severity ladder partial | Multi-severity ladder formalization | **WS-7** |
| §14 Performance | Per-iter budget unmeasured today | Stage telemetry bus (was MOVE-1) | (deferred to post-refactor) |
| §15 Multi-agent | A2A ✅; sub-agent contract working | Identity propagation through A2A unaudited (G-J) | (separate spike) |

---

## 18. How This Model Evolves

Strict rule: this document gets **stricter** over time, never vaguer.

Amendment process:

1. Empirical evidence the current statement is wrong OR aspirational target has changed
2. Reference to the failure mode or capability gap motivating the change
3. Updated invariant — declarative, not aspirational fog
4. Cross-reference to the verified-working code that newly embodies the change

Statements are added (as missions stricten). Statements are not removed except when they conflict with verified-working code that improves on them.

---

## 19. Cross-References

- `00-VISION.md` — 8 pillars (the WHY)
- `06-MISSION-STATEMENTS.md` — per-pillar / per-capability / per-trait missions (the BEHAVIOR)
- `07-OPTIMAL-EXECUTION-ALGORITHM.md` — 10-step canonical loop + 10 invariants (the ITERATION)
- `05-DESIGN-NORTH-STAR.md v5.0` — historic architecture target + roadmap (this doc supersedes §4-5 structural content)
- `2026-05-28-canonical-refactor.md` — gap analysis + workstream sequence to reach this model
- `2026-05-23-harness-convergence.md` — 22-issue convergence morph plan (subsumed by refactor plan WS-4 + WS-7)
- `packages/reasoning/src/kernel/state/kernel-state.ts` — verified embodiment of §4
- `packages/reasoning/src/kernel/capabilities/decide/arbitrator.ts` — verified embodiment of §5
- `packages/runtime/src/runtime.ts:1061` (`createLightRuntime`) — verified embodiment of §3 canonical pattern
- `packages/runtime/src/capabilities/registry.ts` — verified embodiment of §10.1
- `packages/runtime/src/capabilities/profile.ts` — embodiment of §11.1 (with §10.2 growth-risk noted)

---

*This document is the structural north star. The vision says why. The missions say how it behaves. The algorithm says the per-iter steps. This document says what the code looks like. Every refactor decision is judged against this model. Every new feature is placed within it. Drift is measured against it. It does not move.*
