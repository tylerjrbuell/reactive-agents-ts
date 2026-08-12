---
type: design-spec
status: proposed
created: 2026-08-10
authored-by: opencode
tags: [north-star, architecture, simplification, harness, strategy, context, tools, dx]
related:
  - [[../Specs/09-UNIFIED-PROGRAM]]
  - [[../Specs/08-AGENTIC-OS-NORTH-STAR]]
  - [[2026-08-10-run-supervisor-architecture-deep-dive]]
  - [[../../Research/Harness-Reports/2026-08-10-new-user-adversarial-review]]
---

# Agentic Powerhouse: Simplification and Convergence North Star

## Executive Verdict

Reactive Agents has the ingredients of a leading agent harness, but its
architecture is still organized around historical mechanisms instead of a small
number of canonical authorities.

The codebase does **not** need eight independent reasoning engines. It needs:

- one canonical cognitive executor;
- a small set of genuine outer policies;
- one compiled agent specification;
- one run-scoped context and control carrier;
- one ledger-derived progress model;
- one tool scheduler and policy boundary;
- one context/projector allocator;
- one terminal outcome;
- one validated trace stream.

The core architectural disease is **boundary multiplicity**. The same concept is
represented and reinterpreted in multiple places:

- builder fields, builder state, runtime options, config schemas, and serializers;
- full runtime and light runtime layer graphs;
- kernel state, execution context, reasoning result, task result, and public result;
- EventBus events, trace events, observability log events, spans, and metrics;
- tool surface, discovery state, classifier output, allowed tools, required tools,
  and gate-blocked tools;
- strategy-specific completion, status, ledger, and envelope reconstruction;
- memory extraction, consolidation, experience learning, calibration, and skills.

Each boundary is individually defensible. Together they create silent omission,
stale signals, duplicate work, strategy drift, and costly debugging.

The target is an agent runtime that compounds the framework's strongest ideas:
typed contracts, evidence ledgers, deterministic verification, calibrated model
adaptation, replay, structured concurrency, and Effect-based control. It should
remove the duplicated mechanics that prevent those ideas from operating as one
well-oiled machine.

## Design Law

> **Policies may differ. Mechanics may not.**

A strategy may choose how to reason, plan, search, critique, or generate code. It
may not choose its own meaning of cancellation, evidence, tool authorization,
progress, completion, receipt, or public result construction.

## Current Root-Cause Map

### R1. Runtime ownership is fragmented

The public run path crosses:

```text
ReactiveAgent
  -> ExecutionEngine
  -> runtime phases
  -> ReasoningService
  -> strategy
  -> kernel
  -> TaskResult
  -> public result / receipt
```

Evidence:

- `packages/runtime/src/reactive-agent.ts:730-828` owns public execution,
  cancellation signal acquisition, approval loops, and error normalization.
- `packages/runtime/src/execution-engine.ts:697-1147` owns the outer loop,
  verification, memory, cost, and a separate inline LLM/tool loop.
- `packages/reasoning/src/kernel/loop/runner.ts:161-239` owns the universal
  reasoning loop.
- `packages/runtime/src/reactive-agent.ts:1437-1599` reconstructs public result
  and receipt data after the kernel has already produced terminal evidence.

Streaming adds another owner:

- `packages/runtime/src/reactive-agent.ts:1881-2082` owns a controller, queue,
  consumer fiber, and public stream projection.
- `packages/runtime/src/engine/execute-stream.ts:535-814` owns another terminal
  result, receipt, durability, and EventBus projection path.
- `execute-stream.ts:811-814` daemon-forks correctness-relevant execution.

**Root effect:** cancellation, terminal truth, durability, and stream semantics
can diverge. A cancelled stream can stop being consumed while its underlying work
continues. A new cross-cutting feature must be threaded through several owners.

### R2. The meta-loop exists but is not uniformly authoritative

The intended spine is correct:

```text
RunContract -> RunLedger -> RunAssessment -> Control -> Actuators -> Projector
```

Live foundations:

- `packages/reasoning/src/kernel/ledger/run-ledger.ts:1-25` defines immutable
  append-only evidence.
- `packages/reasoning/src/kernel/assessment/assess.ts:1-19,174-182` computes a
  pure contract x ledger x budget assessment.
- `packages/reasoning/src/assembly/project.ts:78-102` is the staged projector.
- `packages/reasoning/src/kernel/loop/terminate.ts:76-195` owns imperative
  termination and deliverable verification.
- `packages/reasoning/src/kernel/state/completion-envelope.ts:51-197` defines
  the intended cross-boundary honesty signal.

But the live system still has opt-in or partial control behavior. Assessment
computes `iterationsSinceEvidence`, `evidenceDelta`, failure streaks, and health
at `packages/reasoning/src/kernel/assessment/assess.ts:78-98,259-278,400-406`,
while default loop control still relies on separate counters at
`packages/reasoning/src/kernel/loop/iterate-pass.ts:1154-1189`. Compaction is
live, not absent: `compact-history.ts:19-50` attempts it at the configured
window threshold and records `noShrinkEvent` when all remaining blocks are
protected. The defect is that the threshold is late and a no-shrink result does
not itself resolve the control problem.

**Root effect:** the framework knows a run is not progressing but may continue
spending model calls until a different guard or the iteration cap fires.

### R3. Progressive disclosure manufactures its own recovery work

The tool resolver is centralized at
`packages/reasoning/src/kernel/capabilities/reason/tool-surface.ts:243-375`,
but default lazy/classification pruning changes the FC tool list each iteration.
Discovery then becomes an escape hatch for tools that were hidden by the harness.

Live traces showed both `qwen3:4b` and `qwen3.5:latest` repeatedly calling
`discover-tools`, receiving `No tools registered`, and reaching max iterations
with zero evidence progress. In the explicit built-in control arm, tools became
callable but path healing and delivery verification disagreed about the resulting
artifact path.

**Root effect:** tool attention optimization is coupled to tool availability,
provider cache invalidation, and model recovery turns.

### R4. Context management has multiple allocators and dead signals

The staged projector is the correct foundation:

```text
system prompt -> tool selection -> result projection
              -> history compaction -> volatile tail -> finalization
```

Evidence: `packages/reasoning/src/assembly/project.ts:78-102`.

But:

- `tool-surface.ts:276-375` changes FC schemas per iteration by default;
- `compact-history.ts:19-33` waits until approximately the full capability
  window before compacting;
- `compaction.ts:194-217` protects recent evidence and
  `preserveOnCompaction` failures without a second-level structural summary;
- per-result compression at `kernel/capabilities/attend/tool-formatting.ts`
  and thread compaction at `assembly/compaction.ts` have no unified allocator;
- `iterate-pass.ts:630-671` computes recall context and skills, then explicitly
  discards them with `void iterRecallContext` and `void iterRecallSkills`;
- `volatile-tail.ts:26-49` reads `goal_state`, but the live path has no producer;
- stale deleted-path comments remain in `context-engine.ts:1-5,108-109` and
  `context-utils.ts:8-9,175-181`.

**Root effect:** the framework can pay for context work that never reaches the
model, compact too late, and mutate supposedly cacheable request prefixes.

### R5. Strategy count overstates policy diversity

The strategy implementations total thousands of lines:

- `plan-execute.ts`: 1,583 lines;
- `reflexion.ts`: 1,181 lines;
- `tree-of-thought.ts`: 1,090 lines;
- `blueprint.ts`: 754 lines;
- `adaptive.ts`: 733 lines;
- `code-action.ts`: 539 lines;
- `reactive.ts`: 369 lines;
- `direct.ts`: 266 lines.

The actual policy diversity is smaller:

1. **Canonical ReAct execution:** reactive and direct, with direct being a
   constrained ReAct profile.
2. **Critique/refinement:** reflexion.
3. **Observation-driven planning:** plan-execute.
4. **Static deterministic DAG:** blueprint.
5. **Branching search:** tree-of-thought, whose selected path is ReAct.
6. **Alternate actuator:** code-action, whose actuator is sandboxed code.
7. **Router:** adaptive, which selects another strategy.

The duplicate mechanics are input assembly, tool/context setup, pass harvesting,
termination/status mapping, ledger forwarding, completion-envelope propagation,
and result construction.

**Root effect:** strategy choice multiplies lifecycle bugs and local-model cost
without proportionate problem-solving benefit.

### R6. Configuration and runtime composition have parallel authorities

The same agent configuration is represented by:

```text
ReactiveAgentBuilder private fields
  -> BuilderState
  -> BuilderRuntimeStateView
  -> RuntimeOptions
  -> ReactiveAgentsConfig
  -> AgentConfig schema
  -> manual serializer
```

Evidence:

- `packages/runtime/src/builder.ts:313-499`;
- `packages/runtime/src/builder/withers/_state.ts:66-227`;
- `packages/runtime/src/builder/build-effect/runtime-construction.ts:89-220`;
- `packages/runtime/src/runtime-types.ts`;
- `packages/runtime/src/agent-config.ts:21-813`;
- `packages/runtime/src/builder/to-config.ts:105-353`.

Full and light runtimes also use separate layer graphs:

- `packages/runtime/src/runtime.ts:143-1063`;
- `packages/runtime/src/runtime.ts:1066-1385`.

**Root effect:** fields can be accepted, serialized, inherited, or silently
dropped inconsistently. Child runtime creation becomes a second architecture.

### R7. Memory, calibration, and observability overlap

Memory contains more than the public four-layer description suggests:
working, semantic, episodic, procedural, plan, search, Zettelkasten, extraction,
consolidation, compaction, skills, and filesystem projection. Runtime wires two
consolidator concepts:

- `packages/memory/src/extraction/memory-consolidator.ts:8-125`;
- `packages/memory/src/services/memory-consolidator.ts`;
- `packages/runtime/src/runtime.ts:19,688-693`;
- `packages/runtime/src/engine/phases/memory-flush.ts:29-71,228`.

Calibration mixes profile loading, adapter compilation, aliases, and experience
learning at `packages/llm-provider/src/calibration.ts:39-291`; its
`buildCalibratedAdapter()` returns an empty adapter at `:161-184`.

Observability has overlapping EventBus, `TraceEvent`, `LogEvent`, spans, and
metrics models. Trace loading also casts arbitrary JSON directly to `TraceEvent`
at `packages/trace/src/replay.ts:15-28`.

**Root effect:** the framework has several places to store, enrich, and project
the same fact, making future learning and replay difficult to trust.

## Ultimate Canonical Shape

```text
AgentSpec
  -> validate + normalize
  -> RuntimePlan(profile)
  -> ManagedRuntime
  -> RunContext
  -> RunSupervisor
       Contract -> Ledger -> Assessment -> Control
                         -> Policy Executor -> Actuators
                         -> Projector -> Typed RunOutcome
       \-> Canonical TraceEvent stream
```

### 1. `AgentSpec`: one configuration authority

`AgentSpec` is the canonical declarative configuration. The fluent builder is a
mutation facade over it, not a second model.

```ts
AgentSpec {
  identity
  model
  provider
  profile
  policy
  tools
  safety
  execution
  memory
  observability
  durability
  extensions
}
```

Compile it once:

```text
AgentSpec
  -> normalize defaults
  -> validate unknown/inert combinations
  -> resolve provider/model profile
  -> compile RuntimePlan
```

Split serialization explicitly:

- `AgentSpec`: JSON-serializable portable configuration;
- `AgentProgram`: code-bound schemas, handlers, layers, and callbacks.

`toSpec()` must report non-serializable program additions instead of silently
omitting them. `BuilderState`, `BuilderRuntimeStateView`, and hand-written
serializer mirrors should be removed after migration.

### 2. `RuntimePlan`: one compiler, many profiles

Replace separate full/light runtime architectures with one layer compiler:

```text
compileRuntimePlan(spec, profile)
  profile = root | child | replay | test
  -> RuntimePlan
  -> materialize ManagedRuntime
```

Profiles alter capabilities, limits, and persistence. They do not duplicate
wiring. A child uses the parent runtime by default and derives a child context;
a separate runtime is reserved for true isolation such as credentials, process,
database, provider, or sandbox boundaries.

### 3. `RunContext`: one run-scoped carrier

```ts
RunContext {
  rootRunId
  runId
  parentRunId
  depth
  cancellation
  deadline
  budget
  contract
  policy
  modelProfile
  eventSink
  ledger
  toolScope
  memoryScope
}
```

Every child derives a new context from the parent. Every provider call, tool
call, trace event, receipt, durable row, and UI projection receives the same
lineage. Manual cross-cutting inheritance lists become a typed derivation
function.

### 4. `RunSupervisor`: one lifecycle owner

The supervisor owns:

- Effect scope and cancellation;
- provider and tool fibers;
- child process tree;
- deadlines, budgets, and concurrency;
- ledger append and terminal flush;
- policy/control decisions;
- one terminal `RunOutcome`;
- stream, result, durable, trace, and UI projections.

`RunController` becomes a compatibility facade. `run()` and `runStream()` become
two consumers of the same supervised run, not two execution paths.

Correctness-critical execution must not use `Effect.forkDaemon`. Detached work is
allowed only for explicitly non-critical telemetry/debrief work with a documented
join or dispose policy.

### 5. `RunOutcome`: one terminal truth

```text
status: completed | partial | abstained | failed | cancelled | timed_out
output / typed object
terminatedBy + rationale
CompletionEnvelope
terminal RunAssessment
TrustReceipt
ledger reference
usage/cost breakdown
interventions
child outcomes
model/provider profile
```

`AgentResult`, `StreamCompleted`, durable records, trace completion events, and
UI state are projections of `RunOutcome`. No strategy or stream path may
reconstruct completion independently.

## Canonical Agentic Loop

```text
1. Contract
   Compile immutable requirements, deliverables, policy, and budgets.

2. Project
   Render stable prefix, provider-specific tool offer, dynamic tail, and
   evidence references from the stable permitted catalog.

3. Think / Select
   Model proposes a plan or action under the current StrategyPolicy.

4. Validate
   Deterministically normalize arguments and check policy, approval, budget,
   capability, and idempotency before execution.

5. Act
   ToolScheduler executes a single or parallel batch in the supervisor scope.

6. Record
   One ledger sink records invocation, canonical arguments, result, artifact,
   requirement, and cost facts.

7. Assess
   Recompute requirements, deliverables, progress, health, phase, pace, and
   remaining budget from the ledger.

8. Control
   Resolve exactly one typed proposal: continue, redirect, execute deterministic
   action, switch policy, terminate, abstain, fail, or pause.

9. Verify
   Use the same ledger-backed evidence and ground truth to validate completion.

10. Project outcome
    Emit one RunOutcome and derive every public projection from it.
```

The model is not asked to rediscover deterministic facts. After a tool batch,
the supervisor checks completion and deterministic next actions before spending
another LLM call.

## Progress and No-Waste Control

Replace parallel counters with one ledger-derived vector:

```ts
Progress {
  evidenceDelta
  artifactDelta
  requirementDelta
  executionDelta
}

Health {
  noProgressStreak
  repeatedFailureStreak
  repeatedToolStreak
  budgetRatio
}
```

Meaningful progress is:

```text
evidenceDelta > 0
or artifactDelta > 0
or requirementDelta > 0
or executionDelta > 0
```

The default control resolver must act on this signal. It should terminate or
abstain after a bounded no-progress streak, with exceptions only for an active
tool, a bounded synthesis phase with requirements satisfied, or one known
callable required-tool redirect.

Loop detection remains useful for repeated identical calls, but it is not a
replacement for no-progress control. All redirects, nudges, strategy switches,
and suppressed interventions become ledger/receipt facts.

## Progressive Tool Disclosure

### Canonical rule

> **The capability catalog is stable; attention may change; policy must never
> change silently.**

Use three distinct layers:

```text
Tool catalog:
  stable permitted capabilities and canonical schemas for the run

Provider tool offer:
  provider/profile-specific projection of the catalog; may be stable or focused
  when context pressure or model capability requires it

Prompt tool index:
  compact dynamic attention view, based on task relevance and pressure

Execution boundary:
  authoritative allow/deny/approval/budget enforcement
```

Rules:

1. A tool explicitly named in the task or contract is visible immediately.
2. A provider profile may keep the FC schema set stable for cacheability or use a
   focused per-turn offer for local/context-constrained models. In either mode,
   the full permitted catalog remains available to the resolver and execution
   boundary, and visibility changes are traced.
3. Discovery is metadata lookup, not a prerequisite for callability.
4. Discovery returning no tools is a deterministic failure, not a reason for
   another model turn.
5. Repeated identical discovery or meta-tool calls are no-progress evidence.
6. Tool surface decisions include `surfaceVersion`, reasons, and stable hashes.
7. The execution boundary always rechecks policy, regardless of visibility.
8. Provider profiles choose stable or focused offers only from measured cache
   identity, accuracy, and token/cost data. Stable full-surface mode is not a
   universal default: existing evidence shows its lift decision is unresolved
   or negative on some arms.

This resolves the current conflict between lazy disclosure, discovery turns,
FC prefix caching, and security enforcement without forcing every model to see a
large prompt narrative.

## Determinism Leverage Upgrades

The current code already contains a substantial deterministic substrate. The
highest-leverage work is to make those facts authoritative instead of leaving
them as guidance, telemetry, fallback logic, or model proposals.

### Determinism Matrix

| Mechanism | Current deterministic behavior | Remaining model authority or gap | Upgrade |
|---|---|---|---|
| Contract compiler | `compileRunContract()` deterministically freezes required tools, artifact paths, output conditions, forbidden tools, and answer floor at `kernel/contract/run-contract.ts:159-267`; the runner compiles once at `kernel/loop/runner.ts:390-427`. | LLM decomposition creates requirements without deterministic conditions; `SuccessCriterion` regex/predicates are not fully folded into terminal postconditions; output format is only partially enforced. | Compile every typed criterion into machine-checkable conditions. Keep LLM decomposition additive and reject model-only success claims when no deterministic condition exists. |
| Tool catalog and policy | Built-in opt-in, allowed/forbidden filtering, required-tool quotas, and execution policy are deterministic at `runtime/engine/phases/agent-loop/setup/tool-schemas.ts:101-270`, `kernel/capabilities/act/tool-observe.ts:303-358`, and `act.ts:370-399`. | Visible, discoverable, and executable sets have different lifetimes; discovery query and timing are model-controlled. | Introduce one typed `ToolSurface` with catalog, offer, discoverable, callable, required, forbidden, and meta partitions. Discovery may filter deterministic candidates, never expand capability by model authority. |
| Tool healing | Name, parameter, structure, path, and type repair run in a fixed pipeline at `tools/src/healing/healing-pipeline.ts:19-81`; policy checks the healed tool name. | Healing reports success without a final schema decode; healed arguments are used for execution while action/artifact records can retain raw arguments (`act.ts:335-386,908-916`). | Add post-healing schema validation and record `rawArgs`, `canonicalArgs`, healing actions, and validation verdict as one ledger fact. |
| Tool execution | `executeToolAndObserve()` centralizes policy, approval, execution, observation, compression, and ledger behavior at `reasoning/kernel/capabilities/act/tool-observe.ts:246-484`. | Kernel parallel batches still have a separate act-side path; repeated failure facts often become guidance instead of control. | Make a batch-capable `ToolScheduler` the only actuator boundary. Classify errors deterministically into retryable, alternate-tool, denied, unavailable, and terminal classes. |
| Evidence ledger | Immutable append and step/artifact projection are deterministic at `kernel/ledger/run-ledger.ts:173-223`, `step-projection.ts:52-195`, and `artifact-projection.ts:38-92`. | Ledger is still physically projected from steps; raw/healed argument identity can diverge; some declared kinds remain unused. | Make the ledger sink receive canonical execution facts directly. Delete unused kinds and make every artifact/requirement writer red-on-cut. |
| Assessment | Pure `assess(contract, ledger, budget)` computes requirements, deliverables, evidence delta, phase, pace, and health at `kernel/assessment/assess.ts:172-422`. | Attempted tool calls can satisfy assessment coverage while verification expects success; `OutputContains` is deferred; some path/coverage logic is duplicated. | Define one `RequirementEvidence` type with `attempted`, `succeeded`, `failed`, `blocked`, and `evidenceRefs`. Use it in assessment, terminal gate, receipts, and strategies. |
| Control resolver | `resolveControlPlane()` is pure, total, priority-ordered, and tie-stable at `kernel/control/control-plane.ts:118-205`. | Multiple proposal construction/application sites remain; deterministic facts can become model-facing nudges without forcing control; actuators do not universally emit a control ledger fact. | Make the supervisor the only control entry point. Every control result must be applied once and append one `control-decision` fact with winning proposal and evidence. |
| No-progress control | `iterationsSinceEvidence`, failure streaks, and evidence delta are computed at `assessment/assess.ts:358-420`; repeated failures and loop signals are also available. | Default execution still relies on separate stall/loop/nudge paths at `iterate-pass.ts:993-1036,1097-1135,1154-1189`; no-progress does not universally terminate. | Derive one `ProgressVector` and default no-progress policy. Repeated identical discovery, failed calls, and meta-tool calls must deterministically block repetition and select correction, alternate, abstention, or failure. |
| Terminal legitimacy | `terminal-gate.ts:23-31,231-324` and `verifyDelivery()` provide ordered deterministic checks; `terminate.ts:134-164` enforces delivery on imperative exits. | `final-answer` is exempt from grounding/coverage at `terminal-gate.ts:241-246`; loop detection can map to successful termination; forced delivery can promote the last thought; verifier tier is compiled but not dispatched. | Treat model final-answer/lexical completion as proposals only. Require contract/delivery/grounding authority before success. Wire `verifierTier` to an actual verifier or delete it. A no-evidence loop becomes abstention/failure unless delivery is already verified. |
| Error recovery | Healing and error classes provide deterministic facts; recovery guidance is generated around `act.ts:755-771` and `runner-helpers/recovery-steering.ts:84-145`. | The model decides whether to retry, alter args, switch tools, or abandon despite known error classes. | Use a deterministic error policy first. The model may select among explicitly permitted alternatives, but cannot repeat a known impossible call or override a permanent denial. |
| Strategy switching | Nomination and plan compilation are deterministic at `kernel/policy/strategy-nomination.ts:22-65` and `harness-plan.ts:173-252`. | `strategy-evaluator.ts:90-197` lets the model recommend switching; target suitability is only syntactically checked. | Deterministically resolve candidates using task class, model profile, remaining budget, required tools, prior failures, and tried strategies. Model recommendations remain advisory annotations. |
| Budget and cost | Budget limits reach kernel state and pre-iteration guards; cost tracking emits usage and pricing events. | Cost tracking currently records input tokens as zero and hardcodes tier `sonnet` at `runtime/engine/phases/cost-track.ts:20-48`; budget checks can occur after work is reserved/started; service and kernel budget authorities are separate. | Reserve estimated budget before each provider/tool call, settle actual usage afterward, use model-derived pricing/tier, and make one budget authority emit deterministic ledger decisions. |
| Context packing | `project()` is pure and ordered at `assembly/project.ts:78-102`; compaction preserves complete tool blocks and records no-shrink. | Character approximation `window * 4`; protected evidence can leave the request over limit; recall results are captured then discarded at `iterate-pass.ts:630-671`. | Add token estimation with safety margin, second-stage structured result truncation, typed overflow failure, and actual recall injection. Preserve refs, not unlimited raw failures. |
| Structured output | `withOutputSchema()` parse-first and schema validation are deterministic at `reactive-agent.ts:1684-1813`; format validators live in `kernel/loop/output-synthesis.ts:50-193`. | Semantic completeness and entity/numeric matching remain heuristic; structured output is not fully preserved through every resume path. | Compile output fields into contract conditions, require per-entity coverage, bind values to evidence refs, and persist typed object plus validation metadata. |
| Persistence | Kernel codec is versioned; durable resume checks a config hash; terminal paths flush checkpoints before status. | Decoded state is cast without schema validation; checkpoint writes can be best effort; config identity omits behavior-affecting fields; timestamps/UUIDs vary in replay. | Decode with versioned schemas, hash model/tools/policy/schema/runtime/codec, sequence and checksum checkpoints, expose durability status, and inject deterministic clock/IDs in replay. |
| Trace/replay | Trace has per-run sequence numbers, typed event families, LLM/tool replay tables, and strict tool replay. | `trace/src/replay.ts:15-29` silently drops malformed JSON and casts arbitrary values; replay does not control time, IDs, environment, or external side effects. | Validate events at load, report corruption, add request divergence diffs, deterministic runtime providers, and strict side-effect manifests. |
| Child processes | Children use `Effect.forkScoped`/`Fiber.await` at `sub-agent-executor.ts:609-613`, with lineage and shared event bus. | Parent budgets, cancellation provenance, durable lifecycle, and all batch outcomes are not one parent-owned record; children reconstruct a light runtime. | Add `DelegationBudget`, child lifecycle ledger entries, full batch outcomes, parent cancellation causes, and context-derived child execution instead of repeated runtime construction. |

### The Model/Harness Boundary

The model should propose:

- interpretations of ambiguous intent;
- candidate plans and tool choices under the available catalog;
- extraction of facts from unstructured content;
- critique and natural-language synthesis;
- generated code for an explicitly selected code actuator.

The harness should decide:

- what the contract requires;
- which tools exist and may execute;
- whether arguments are valid and safe;
- whether calls may retry or run in parallel;
- whether new evidence exists;
- whether the budget permits another call;
- whether a strategy switch is suitable;
- whether requirements and deliverables are complete;
- whether a run is completed, partial, failed, abstained, cancelled, or timed out;
- what evidence and provenance are returned.

The model may propose a terminal answer. It must never be the authority that makes
an unverified answer complete.

### Deterministic Control Flow

The canonical control sequence should be:

```text
model proposal
  -> schema decode
  -> canonical argument normalization
  -> policy / approval / budget / capability checks
  -> deterministic scheduler
  -> tool execution
  -> ledger append
  -> assessment
  -> deterministic control resolution
  -> terminal verification or next model proposal
```

Before another model call, the supervisor must answer deterministically:

```text
Did a requirement become satisfied?
Did a deliverable land?
Did the call fail permanently or repeat a known failure?
Is the next action deterministic?
Is a verified synthesis now possible?
Is the run blocked, over budget, or out of time?
```

If these answers are known, another LLM turn is wasteful.

## Context Architecture

Use one context allocator with explicit regions:

```text
StablePrefix
  persona, environment, policy, procedural instructions, stable tool schemas

DynamicTail
  contract frame, outstanding requirements, pending guidance, latest evidence,
  recent messages, recall references

EvidenceRefs
  compact ledger-backed references to full tool results/artifacts

SurfaceMetadata
  surface version, visibility reasons, prefix hashes, token accounting
```

Context policy:

- The stable prefix must be byte-stable within a run.
- Iteration-dependent guidance belongs in the dynamic tail.
- Recall output is either injected into the dynamic tail or the recall operation
  is not performed. No `void` recall results.
- `goal_state` is either produced by the live contract/assessment path or deleted.
- Per-result compression and thread compaction use one allocator.
- Protected failures become structured summaries with references, not permanent
  raw-message pins.
- Compaction fires before the entire context window is consumed.
- Every dropped reference is enumerated in the ledger and receipt.
- Stale comments describing deleted context builders are removed in the same
  migration that establishes `project()` as the sole projector.

## Tool Scheduler and Canonical Evidence

Introduce a batch-capable `ToolScheduler` around the current native execution
core:

```text
ToolScheduler
  -> validate normalized call
  -> policy/approval/budget/idempotency
  -> schedule independent calls in parallel
  -> propagate supervisor cancellation
  -> append canonical invocation/result/artifact facts
  -> return ordered results and timing
```

`executeToolAndObserve()` becomes the single-call adapter over this scheduler.
The kernel parallel path must not bypass policy, approval, observation, ledger,
compression, or event semantics.

Path healing must produce a canonical argument/artifact identity. The path used
for execution, the path reported to the model, the ledger artifact path, and the
terminal verifier path must be the same identity. If a path cannot be safely
normalized, reject it before execution with the allowed-root remedy.

Requirement evidence must be shared across strategies. Replace “attempted in the
kernel” versus “completed in plan-execute” caller semantics with one
ledger-backed `RequirementEvidence` result.

## Strategy Convergence

### Retain as policy data

```text
ReactPolicy
  maxIterations, temperature, tool attention, next-move planning

ReflexionPolicy
  React generation + critique + bounded improvement

PlanPolicy
  plan schema + step execution + retry/patch + reflection + synthesis

BlueprintPolicy
  static plan + verification + deterministic DAG worker + bounded patch

SearchPolicy
  branch expansion + scoring + pruning + selected React path

CodeActionPolicy
  code generation + sandbox actuator + verifier/retry

RouterPolicy
  model/task classification + cost profile + fallback selection
```

### Merge

1. Merge `direct` into the ReAct runner as a 1-3 iteration profile. Preserve
   `direct` as an alias, not an implementation.
2. Share plan generation, hydration, verification, patching, step execution, and
   synthesis between plan-execute and blueprint.
3. Require every sub-run to return output, usage, ledger, `CompletionEnvelope`,
   pause/abstention state, and raw termination.
4. Make every policy call `finalizeStrategyResult` once.
5. Make adaptive return a selected policy and router metadata; it must not
   re-mint a completed sub-result.
6. Make tree search return a normal sub-run result from one finalization path.
7. Make code-action return an `ActuatorResult` envelope; do not force its sandbox
   through ReAct.

### Delete or demote

- Duplicate lifecycle/result code in `direct.ts:128-264`.
- Adaptive result reconstruction in `adaptive.ts:338-450`.
- Tree-of-thought’s three finalization branches at `tree-of-thought.ts:281-391,
  782-803,817-918`.
- Blueprint’s manual completion-marker derivation at `blueprint.ts:592-603,
  684-750`.
- Code-action’s independent status authority at `code-action.ts:466-505`.
- Inert `patchStrategy` configuration at `types/config.ts:26-33`.
- Strategy-owned schema resolution, output fallback, ledger forwarding, and
  envelope reimplementation.

Heavy policies remain available, but local/simple tasks default to ReAct or
Blueprint only when the model profile supports the static plan. Reflexion,
plan-execute, and tree search require a cost/complexity justification and an
explicit budget. Tree-of-thought remains opt-in unless its search value clears
the lift gate.

## Memory and Learning Simplification

Reduce the public mental model to three primitives:

```text
WorkingContext
  transient run-scoped state and compact references

EvidenceStore
  observations, episodes, semantic indexes, artifacts, and provenance

ProcedureStore
  reusable workflows, skills, aliases, and validated procedures
```

The current four-layer memory remains a storage/index implementation detail.
Zettelkasten, plan storage, FTS, vector indexes, and filesystem export become
projections or optional indexes.

Converge the two memory consolidator services into one
`MemoryMaintenanceService` with `extract`, `consolidate`, `decay`, and `compact`.

Define one neutral `ToolObservation` type outside provider calibration. Calibration,
experience learning, replay, and telemetry consume the same observation rather
than importing each other’s concepts.

Demote skill evolution and unmeasured learning loops until each has a production
caller, persisted promotion decision, replayable regression evidence, and a lift
gate result. The framework should not make a sophisticated learning subsystem
part of the default architecture before it demonstrably improves runs.

## Observability and Replay Simplification

Make validated `TraceEvent` the canonical append-only event stream:

```text
TraceEvent
  -> console projection
  -> metrics projection
  -> spans/exporters
  -> durable journal
  -> replay table
  -> diagnose/Cortex/UI
```

Keep EventBus as an in-process delivery mechanism, not a second truth model.
Make `ObservabilityService` a projection/export facade over narrow ports:

```text
TraceSink
MetricSink
LogSink
StateSnapshotSink
```

Validate trace JSON at load with a schema decoder. Invalid events must fail or be
reported with line number according to an explicit mode; arbitrary JSON casts in
`packages/trace/src/replay.ts:15-28` are not acceptable for a trust substrate.

Key all run-scoped projections by `rootRunId`. Eliminate global child dashboard
drains or make them a trace projection rather than a side-channel registry.

## Multi-Agent Simplification

Subagent fiber-tree cancellation and lineage are valuable and should remain. The
next step is to stop building a second runtime for every child.

Default model:

```text
Parent ManagedRuntime
  + Child RunContext
  + Child policy scope
  + Child budget scope
  + Child tool scope
  + Child ledger/trace lineage
```

Create a new runtime only for an explicit isolation boundary. Child outcomes are
typed `RunOutcome` values, not metadata reconstructed from `reasoningSteps`.

Batch spawning returns all outcomes:

```text
completed[]
failed[]
interrupted[]
cancelledRemaining
```

It must not collapse concurrent child outcomes to the first failure. MCP tools
should use a scoped parent `ToolView` unless a true process boundary requires
proxy registration.

## DX North Star

The primary API should be profiles and explicit capability configuration:

```ts
const agent = await createAgent({
  model: "qwen3:4b",
  profile: "local-reliable",
  tools: [calculator],
  policy: {
    requiredTools: ["calculator"],
  },
});

const result = await agent.run(task);
if (result.status !== "completed") {
  console.log(result.diagnosis);
}
```

The fluent builder remains supported as an escape hatch and compatibility API,
but it compiles to the same `AgentSpec`.

Required DX behavior:

- `.withTools()` clearly means custom tools only, or defaults to a documented
  safe built-in profile; it must not be ambiguous.
- Build validation identifies required tools that are not registered or opted in.
- Unknown options and inert combinations fail loudly at build time.
- Quiet/library mode suppresses all console output, including provider banners.
- No API-key prefixes are printed.
- `toSpec()` is lossless for declarative config and reports code-bound additions.
- `AgentResult` exposes status, diagnosis, missing requirements, strategy used,
  budget, interventions, receipt, and canonical artifact identities.
- Examples compile against the public result type and assert the telemetry they
  print.
- Profiles communicate latency, tool surface, memory, strategy, and safety
  tradeoffs instead of requiring users to understand dozens of withers.

## Keep / Converge / Demote / Delete

### Keep

- Effect and typed service boundaries;
- immutable kernel state and pure assessment;
- `runKernel()` as the canonical ReAct executor;
- `RunContract`, `RunLedger`, `RunAssessment`, `CompletionEnvelope`;
- `terminate()` and `verifyDelivery()` as completion foundations;
- calibrated model capability profiles;
- deterministic replay;
- parent-scoped child fibers and lineage;
- SQLite/FTS evidence durability;
- fluent builder ergonomics as a compatibility surface.

### Converge

- Builder/config/runtime state into `AgentSpec` and `RuntimePlan`;
- root/child runtime wiring into one profile compiler;
- runtime/kernel lifecycle into `RunSupervisor`;
- stream/result/durable/trace completion into `RunOutcome` projections;
- all tool paths into `ToolScheduler` and one ledger sink;
- all progress signals into assessment and one control resolver;
- all strategies into policy drivers over shared pass/result boundaries;
- memory and learning around `EvidenceStore` and `ProcedureStore`;
- EventBus/observability/replay around validated `TraceEvent`;
- calibration and experience around neutral `ToolObservation`.

### Demote

- expensive strategies for simple/local tasks;
- adaptive as an execution strategy; retain it as a policy router;
- skill evolution until runtime-wired and lift-gated;
- unconsumed calibration fields;
- advanced memory indexes from the default user mental model;
- dynamic child MCP proxying when a scoped tool view is sufficient;
- stable tool-surface mode until provider-specific evidence supports its default.

### Delete or retire

- empty calibrated adapter abstraction;
- duplicate memory consolidator service/tag;
- obsolete adapter-hook terminology and dead calibration fields;
- builder state mirrors after `AgentSpec` migration;
- independent stream terminal/result construction;
- strategy-specific completion-marker and status implementations;
- discarded recall results and unproduced `goal_state` projection;
- stale context-builder comments and dead path names;
- arbitrary JSON casts at trace load;
- global child dashboard drains;
- silent non-serializable `toConfig()` omissions.

## Migration Program

### Wave 0: Freeze and measure

Create characterization tests and replay goldens for:

- no-capability discovery loop;
- repeated discovery no-progress;
- explicit named-tool visibility;
- path-healing plus artifact verification;
- failed-tool honest recovery;
- direct/reactive equivalence;
- strategy result/envelope equivalence;
- run versus stream outcome equivalence;
- child cancellation and batch partial outcomes;
- prompt/surface hash stability;
- config serialization round-trip.

No design change is promoted without a trace prediction and a red-on-cut test.

### Wave 1: Authority seams

Introduce `RunContext`, `RunOutcome`, `RunSupervisor`, `AgentSpec`, and
`RuntimePlan` internally while preserving the public builder. Make stream
execution structured and remove correctness-critical daemon ownership.

### Wave 2: Loop/control convergence

Make assessment-derived progress and no-progress termination default. Merge the
inline runtime loop into the canonical executor profile. Add deterministic
capability failure and repeated-discovery control.

### Wave 3: Tools and evidence

Build `ToolScheduler`, canonical argument normalization, artifact identity, and
shared `RequirementEvidence`. Migrate every strategy and inline path. Ensure
execution, ledger, receipt, and verification use the same canonical facts.

### Wave 4: Strategy reduction

Merge direct into ReAct, replace adaptive execution with routing, share planning
substrates, require `CompletionEnvelope` at every policy boundary, and delete
duplicated finalization branches. Keep only genuine outer policy differences.

### Wave 5: Context/token economy

Introduce the unified allocator, stable prefix/dynamic tail, tool surface hashes,
early compaction, structured failure summaries, and actual recall injection.
Measure cache, input/output tokens, model turns, evidence per turn, and
termination reason by profile.

### Wave 6: Runtime/config/memory convergence

Compile all builder/config forms into `AgentSpec`; unify root/child/replay/test
runtime plans; converge memory maintenance; move observations to the neutral
type; demote unmeasured learning mechanisms.

### Wave 7: Trace/process projections

Make validated trace canonical, project observability/UI/durable/replay views,
and expose the process tree through inspect, attach, fork, Cortex, and A2A.

### Wave 8: Future capability expansion

Only after the convergence gates pass should the framework expand adaptive routing,
skill commons, self-improvement, background teams, or new search policies. New
mechanisms must plug into the canonical supervisor, ledger, assessment, control,
tool scheduler, projector, and outcome interfaces.

## Proof Gates

Every default-on mechanism must satisfy:

1. deterministic replay behavior gate;
2. red-on-cut wiring test;
3. graded capability task;
4. feature-matrix coverage;
5. at least two model tiers with directional agreement;
6. no unacceptable token/cost overhead;
7. no new public authority or serialization drift;
8. trace evidence showing the intended control/result shape.

The project’s existing lift rule remains binding. A structurally elegant change
that does not improve measured behavior should remain opt-in or be removed.

## Future-State Definition of Done

Reactive Agents is an agentic powerhouse when:

- a user can build a reliable local or frontier agent with a small profile-based
  spec and understand every active capability;
- a named tool is available immediately or the build fails clearly;
- no-progress is detected from ledger facts before the iteration budget burns;
- context is compact, cache-aware, reference-safe, and actually includes recall;
- tool execution is parallel when safe and identical in policy/evidence semantics
  when serial;
- strategy selection changes planning behavior without changing lifecycle truth;
- all strategies return the same typed outcome and receipt contract;
- child agents are scoped processes in one observable tree;
- memory, calibration, learning, replay, and telemetry consume shared facts;
- cancellation, pause, resume, and durability are real process controls;
- every failure tells the user what happened, what remains, and how to fix it;
- new capabilities add policy data or a scoped actuator, not another parallel
  execution architecture.

## Verification Corrections

This proposal was re-checked against the current source after the initial
architecture review. The following distinctions are now explicit:

- **Run cancellation:** `agent.run()` does thread the kill-switch signal into
  `ManagedRuntime.runPromise()` at `reactive-agent.ts:759-779`. The remaining
  ownership defect is specifically the streaming path: `executeStream()` does
  not receive the caller's `AbortSignal` as an explicit execution input, and
  `execute-stream.ts:811-814` still daemon-forks the underlying execution while
  `reactive-agent.ts:1999-2019` separately owns the queue consumer.
- **Compaction:** compaction is live. `compact-history.ts:19-50` attempts it and
  records no-shrink events. The verified defect is late thresholding and the lack
  of a control action when protected failures/evidence prevent shrinkage, not a
  completely dead compaction mechanism.
- **Tool surface:** a stable full FC array is not universally proven superior.
  The canonical recommendation is a stable catalog plus provider/profile-
  specific tool offers, with cache-aware stable offers where measured and
  focused offers where local context pressure requires them.
- **Path healing:** the verified mismatch is between raw model arguments stored
  in action steps/artifact projection (`act.ts:335-386,908-916`) and healed
  arguments used for execution (`act.ts:345-347`, `tool-observe.ts:259-286`).
  `file-truth.ts:27-32` then checks the actual filesystem path. The fix is a
  canonical normalized argument/artifact identity, not simply changing the disk
  checker.
- **Subagents:** detached subagent execution is resolved. Current
  `sub-agent-executor.ts:609-613` uses `Effect.forkScoped` and awaits the child.
  The proposed simplification is a future reduction of repeated light-runtime
  construction and manual inheritance, not a claim that child cancellation is
  currently detached.
- **Calibration:** `buildCalibratedAdapter()` intentionally returns an empty
  adapter because live behavior is currently delivered through profile overrides
  and non-adapter channels (`calibration.ts:161-184`). The recommendation is to
  rename/split this into an explicit model-profile compiler or delete the empty
  adapter abstraction, not to restore the removed hooks.
- **Example evidence:** the `.withTools()` and strategy-cost findings remain
  live observations from Ollama traces and are evidence for control/DX work, not
  cross-tier benchmark claims. The directional numbers in the companion report
  must not be promoted to framework performance headlines.

## Final Position

Reactive Agents should stop growing by adding mechanisms beside existing
mechanisms. The framework’s next era should be a convergence program:

```text
less strategy code
less configuration mirroring
less tool-surface mutation
less duplicated context assembly
less detached/background ownership
less metadata reconstruction

more canonical state
more deterministic control
more evidence per model turn
more explicit profiles
more typed outcomes
more replayable behavior
more honest DX
```

The highest-potential design is a small, supervised, evidence-driven runtime
where model intelligence is interchangeable and framework mechanics are stable.
That is how the current cutting-edge pieces compound into a scalable agentic
platform instead of a larger collection of clever subsystems.
