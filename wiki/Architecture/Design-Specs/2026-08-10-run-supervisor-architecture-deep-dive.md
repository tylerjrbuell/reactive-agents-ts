---
type: design-spec
status: proposed
created: 2026-08-10
authored-by: opencode
tags: [architecture, harness, runtime, reasoning, performance, structured-concurrency, dx]
related:
  - [[../Specs/09-UNIFIED-PROGRAM]]
  - [[../Specs/08-AGENTIC-OS-NORTH-STAR]]
  - [[2026-07-11-harness-north-star-architecture]]
  - [[../../Research/Harness-Reports/2026-08-10-new-user-adversarial-review]]
---

# Run Supervisor Architecture: Deep Dive and Refactor Direction

## Executive Summary

The proposed architecture is substantially present in the reasoning kernel but
not yet unified at the runtime boundary.

The live code already contains the most important conceptual assets:

- `runKernel()` is the universal reasoning loop.
- `RunContract -> RunLedger -> RunAssessment -> Projector` exists as a typed,
  one-directional spine.
- `CompletionEnvelope` defines the intended cross-strategy honesty boundary.
- `terminate()` and `verifyDelivery()` provide centralized kernel completion and
  deliverable authority.
- Subagents now use parent-scoped fibers and ledger propagation.

The highest-potential refactor is therefore **not a new strategy, planner, or
agent abstraction**. It is a runtime-level `RunSupervisor` that becomes the
single owner of run lifetime, cancellation, child scopes, terminal result
construction, stream projection, budgets, and durable completion.

This closes the remaining gap between the project's canonical vision and its
actual execution topology. Today a run is jointly owned by `ReactiveAgent`,
`ExecutionEngine`, `RunController`, `execute-stream.ts`, the kernel loop, and
strategy-specific result adapters. That split creates duplicated lifecycle
logic, delayed cancellation, stream/result divergence risk, and repeated
context/model turns.

## Canonical Alignment

This direction is a direct implementation of existing authority, not a new
north star:

- `09-UNIFIED-PROGRAM.md` states: one contract, one ledger, one assessment,
  one control plane, one projector.
- `2026-07-11-harness-north-star-architecture.md` states: one completion
  authority, `CompletionEnvelope` across every strategy boundary, criteria-based
  termination, stable-prefix context discipline, and profiles-first DX.
- `08-AGENTIC-OS-NORTH-STAR.md` defines the process model: runs as processes,
  the ledger as execution history, receipts as trust, and structured teams.

The refactor should preserve these rulings and remove implementation seams that
still allow separate authorities to emerge.

## Current Live Topology

### Public run path

The current non-stream path is:

```text
ReactiveAgent.run()
  -> acquireRunSignal()
  -> ManagedRuntime.runPromise()
  -> buildRunTaskEffect()
  -> ExecutionEngine.execute()
  -> outer runtime phases
  -> runReasoningThink()
  -> ReasoningService.execute()
  -> selected strategy
  -> runKernel()
  -> kernel terminal state
  -> ExecutionEngine TaskResult
  -> ReactiveAgent AgentResult + receipt
```

Evidence:

- `packages/runtime/src/reactive-agent.ts:730-828` owns the public run promise,
  run-signal acquisition, durable approval loop, error normalization, and
  termination compensation.
- `packages/runtime/src/reactive-agent.ts:1402-1437` creates the `Task` and
  invokes `ExecutionEngine.execute()`.
- `packages/runtime/src/execution-engine.ts:697-1147` owns the outer lifecycle
  and has both the full reasoning path and a separate inline LLM/tool loop.
- `packages/runtime/src/engine/phases/agent-loop/reasoning-think.ts:76-369`
  assembles the reasoning request and normalizes strategy output.
- `packages/reasoning/src/services/reasoning-service.ts:188-237` selects and
  provisions the strategy.
- `packages/reasoning/src/strategies/reactive.ts:149-277` maps into the kernel.
- `packages/reasoning/src/kernel/loop/runner.ts:161-239` runs the universal
  kernel.
- `packages/runtime/src/reactive-agent.ts:1437-1599` reconstructs the public
  result, derives tool calls/deliverables, computes the receipt, and exposes the
  final `AgentResult`.

### Stream path

The stream path introduces additional ownership:

```text
ReactiveAgent.runStream()
  -> RunController + internal AbortController
  -> ExecutionEngine.executeStream()
  -> execute(task)
  -> Effect.forkDaemon
  -> EventBus/Queue projection
  -> JS queue consumer fiber
  -> AsyncGenerator events
```

Evidence:

- `packages/runtime/src/reactive-agent.ts:1881-2019` creates a controller,
  starts `executeStream()`, then creates a separate queue-consumer fiber.
- `packages/runtime/src/engine/execute-stream.ts:535-814` independently builds
  `StreamCompleted`, receipts, durability completion, EventBus completion, and
  stream error events.
- `packages/runtime/src/engine/execute-stream.ts:811-814` terminates the
  execution effect with `Effect.forkDaemon`.

This is the clearest remaining structured-concurrency violation. The public
consumer can stop observing the stream while the daemonized execution continues.
The framework's stream API therefore has two meanings of cancellation: stop
consuming events and stop the underlying run. They are not yet structurally the
same operation.

### Kernel topology

The kernel has already converged much further:

```text
RunEnvelope merge
  -> capability resolution
  -> context projection
  -> think
  -> guard
  -> act
  -> observe / ledger growth
  -> assessment / reflection / control
  -> terminal gate
  -> terminate()
  -> CompletionEnvelope / KernelState
```

Evidence:

- `packages/reasoning/src/kernel/loop/runner.ts:161-215` merges the run-wide
  envelope and resolves provider capability once.
- `packages/reasoning/src/kernel/loop/iterate-pass.ts:707-789` executes the
  kernel pass and records inspection/checkpoint state.
- `packages/reasoning/src/kernel/loop/terminate.ts:76-195` applies the terminal
  post-condition gate and funnels output through `commitDeliverable()`.
- `packages/reasoning/src/kernel/state/completion-envelope.ts:51-197` defines
  the cross-strategy completion signal and worst-of join.
- `packages/reasoning/src/kernel/assessment/assess.ts:1-19,174-182` implements
  a pure contract x ledger x budget assessment.
- `packages/reasoning/src/kernel/ledger/run-ledger.ts:1-25,173-213` defines the
  immutable append-only evidence substrate.

The kernel should be treated as the canonical cognitive engine. The runtime
refactor should wrap and simplify its ownership boundary, not replace it.

## Confirmed Architectural Gaps

### 1. Runtime lifecycle has multiple authorities

The same concern is represented in several layers:

- `ReactiveAgent` handles public cancellation, durable approval loops, result
  normalization, and result projection.
- `ExecutionEngine` handles phase entry, cancellation checks, verification,
  memory, cost, audit, and `TaskResult` assembly.
- `RunController` owns pause/stop/terminate state and checkpoint callbacks.
- `execute-stream.ts` owns another terminal/result/durability path.
- The kernel owns terminal meaning through `terminate()` and its arbitrator.

This is not merely organizational duplication. It means a new lifecycle feature
must be threaded through several hand-written boundaries, and a failure can be
handled at one layer without being reflected at another.

### 2. Streaming execution is detached from its caller

`runStream()` interrupts the queue consumer at
`packages/runtime/src/reactive-agent.ts:2011-2019`, but the underlying stream
execution is daemon-forked at `packages/runtime/src/engine/execute-stream.ts:811-814`.

`RunController.terminate()` aborts its controller at
`packages/runtime/src/run-controller.ts:247-251`; however, the execution API
does not receive the signal as an explicit execution input. Provider cancellation
therefore depends on indirect FiberRef/controller propagation rather than one
supervisor-owned interruption scope.

The adversarial probe observed a cancelled stream and a second run overlapping
the first. This is a resource and correctness issue for local inference, tool
side effects, concurrency limits, and cost accounting.

### 3. There are two runtime agent loops

`packages/runtime/src/execution-engine.ts:741-861` dispatches the full
`ReasoningService`/kernel path. When that service is absent,
`packages/runtime/src/execution-engine.ts:862-1100` runs a separate inline
think/act/observe loop.

Both paths perform model calls, tool exposure, lifecycle checks, iteration
management, progress logging, and terminal handling. Even where behavior is
intentionally different, they are two execution authorities that can drift.

The target should retain a lightweight direct profile, but it should be an
implementation of the same `RunSupervisor`/execution request contract, not a
second uncoordinated loop.

### 4. Terminal truth is unified inside the kernel but re-derived outside it

The kernel returns terminal state and completion evidence. The runtime then
re-derives public tool calls, deliverables, goal achievement, and receipts in
`reactive-agent.ts:1447-1568`. The stream path repeats much of this work in
`execute-stream.ts:545-749`.

The two sites currently try to share helper functions, but the architecture still
has two result-construction pipelines. The durable terminal event, `run()` result,
receipt, and stream completion should be projections of one supervisor-owned
`RunOutcome`.

### 5. The ledger is canonical in the kernel, but not yet the whole event store

`RunLedger` is explicitly documented as the eventual substrate for trace JSONL,
EventBus, `run_events`, and `steps[]` in `run-ledger.ts:1-25`. Current code has
already moved tool facts, requirements, artifacts, verdicts, and subagent
provenance onto it.

However, engine phase lifecycle events and raw LLM exchanges still have separate
publication/storage paths. This means the ledger is the canonical evidence
substrate for reasoning facts, but not yet the complete run journal.

The correct next step is not to put raw prompts into the ledger. Raw LLM I/O is
byte-sensitive replay data and should remain a typed projection/reference linked
to ledger entries. The supervisor should own the correlation and lifecycle for
both stores, with one run ID and explicit sequence/order semantics.

### 6. Context projection is staged, but tool-surface churn remains

`packages/reasoning/src/assembly/project.ts:78-102` has the desired staged
projector:

```text
system prompt
-> tool selection
-> result projection
-> history compaction
-> volatile tail
-> finalization
```

The F10 work correctly moved volatile content out of the system prompt. The
remaining problem is that `resolveToolSurface()` changes visible/callable tool
schemas per iteration when stable mode is disabled:

- `packages/reasoning/src/kernel/capabilities/reason/tool-surface.ts:276-375`
  supports a stable full surface, but `stableToolSurfaceEnabled()` is opt-in.
- Lazy disclosure and gate narrowing mutate the FC `tools` array and can break
  provider prefix caching.

The architecture should make prompt-prefix identity explicit and measurable. It
should not promote stable surfaces by assertion: the existing lift evidence says
the stable-surface mechanism has not cleared the default-on gate. Instead, the
supervisor should choose a provider/profile-specific surface policy and record
surface/prompt hashes so every cache hit or miss is explainable.

### 7. Tool execution is mostly centralized, with one important bypass

`executeToolAndObserve()` is the canonical execution/observation primitive for
single calls and non-kernel strategies. It owns policy, approval, execution,
observation, events, and recovery guidance at
`packages/reasoning/src/kernel/capabilities/act/tool-observe.ts:246-484`.

The kernel parallel batch path intentionally bypasses it and calls
`executeNativeToolCall()` directly, as documented at
`tool-observe.ts:362-370` and implemented in `act.ts:621-703`.

This is a valid performance optimization only if it shares the same boundary
semantics. Today it is a drift risk for policy, approval, observation, ledger,
events, compression, and recovery. The right abstraction is a batch-capable
execution core, not forcing every call through a serial helper.

### 8. Requirement semantics still have a strategy-specific seam

`terminal-gate.ts:26-35` explicitly documents that kernel coverage treats a
required tool as covered when attempted, while plan-execute uses completed tool
steps. The gate is centralized, but callers supply different meanings of
`coveredTools`.

The supervisor should pass one typed `RequirementEvidence` result derived from
the ledger and delivery verifier. Strategy-specific policies may downgrade or
request another attempt, but they should not redefine whether evidence exists.

### 9. Subagent ownership is now substantially correct

The previous detached-subagent disease is closed. Current code uses parent-scoped
fibers and merges child ledger provenance:

- `packages/runtime/src/builder/build-effect/sub-agent-executor.ts:285-299`
  and `:609-673` scope children, join outcomes, and contain failure.
- `packages/runtime/src/builder/build-effect/spawn-handlers.ts:84-127`
  propagates parent context and shared event ownership.

This should be preserved. The remaining improvement is a typed immutable
`ChildExecutionEnvelope` so cross-cutting inheritance is derived in one place
instead of manually enumerated across child configuration construction.

## Ideal Target Architecture

```text
Public API
  -> AgentHandle
      -> RunSupervisor (one instance per run)
          owns: scope, signal, deadline, budgets, run ID, child tree
          owns: ledger writer, event projector, terminal outcome
          owns: provider/tool task scopes and durable finish
              |
              +-> RunContract (immutable acceptance criteria)
              +-> Control Plane (assessment -> policy decision)
              +-> Cognitive Kernel (strategy -> actions)
              +-> Tool Scheduler (parallel, cancellable, policy checked)
              +-> Context Projector (stable prefix + dynamic suffix)
              +-> Evidence Ledger (append-only facts)
              +-> Verifier (requirements + deliverables + grounding)
              +-> Public Projectors (run result, stream, trace, receipt, UI)
```

### RunSupervisor responsibilities

The supervisor should expose an explicit Effect-based service or internal
execution object with these operations:

```ts
interface RunSupervisor {
  readonly execute: (
    request: RunRequest,
  ) => Effect.Effect<RunOutcome, RunErrors>;
  readonly cancel: (reason: CancelReason) => Effect.Effect<void, never>;
  readonly stop: (reason: StopReason) => Effect.Effect<void, never>;
  readonly pause: () => Effect.Effect<void, PauseError>;
  readonly resume: () => Effect.Effect<void, ResumeError>;
  readonly inspect: () => Effect.Effect<RunSnapshot, never>;
  readonly events: () => Stream.Stream<RunEvent, RunStreamError>;
}
```

The exact public shape may differ. The invariant is that `execute`, `events`,
and control operations all address the same run scope and terminal outcome.

### RunRequest

`RunRequest` should contain the already-resolved run envelope:

```text
run identity and lineage
RunContract
provider/model capability profile
tool policy and approval policy
budget/deadline/iteration limits
memory and context profile
strategy/kernel selection
durability configuration
observability handles
```

The builder compiles configuration into this request once. Child agents derive
their request from a typed child envelope. No later phase should reconstruct
policy from a loose config bag.

### RunOutcome

There should be one terminal object from which every consumer projects:

```text
status: completed | partial | abstained | failed | cancelled | timed_out
output / typed object
terminatedBy + rationale
CompletionEnvelope
RunAssessment at terminal
TrustReceipt
RunLedger reference/query handle
usage and cost breakdown
interventions and warnings
model/provider identity
child outcomes
```

`AgentResult`, `StreamCompleted`, durable run rows, trace events, and UI state
must be projections, not independently reconstructed terminal decisions.

## Performance Architecture

### Prompt and context

The projector should return a typed `ProjectedRequest` with explicit regions:

```text
stablePrefix
  system prompt, identity, policy, stable tool schemas, skills
dynamicSuffix
  standing frame, outstanding criteria, new evidence, recent messages
surfaceMetadata
  surfaceVersion, visible/callable sets, reasons, hashes
```

Provider adapters remain responsible for final wire formatting. The projector
must provide stable identity metadata so adapters and benchmarks can measure:

- stable-prefix hash per iteration;
- tool-surface hash per iteration;
- dynamic token count;
- cache-read/cache-write tokens where providers expose them;
- context compaction and dropped-reference counts.

This directly addresses F10 without assuming stable tool disclosure is always
better. Stable tool schemas can be selected for providers with prefix caching;
local models can use attention/narrowing policies where measurements support it.

### Deterministic post-tool control

After a batch completes, the supervisor should run deterministic checks before
calling the model again:

```text
append tool facts
recompute assessment
verify requirement/deliverable deltas
apply policy and budget
if contract complete -> terminal gate
if deterministic next action exists -> schedule it
otherwise -> project context and call model
```

This is the main route to reduce the observed 9-step / 4,507-token local
calculator run without weakening reasoning quality. The model remains necessary
for selecting uncertain actions and synthesizing prose, not for re-discovering
facts already represented by the ledger.

### Tool scheduling

Create a batch-capable `ToolScheduler` around the existing execution core:

- accepts a typed batch of calls;
- evaluates policy and approval for every call;
- schedules independent calls in parallel;
- inherits the supervisor cancellation scope;
- records start/completion/failure facts atomically through the ledger sink;
- returns ordered results plus per-call timing and cost;
- preserves deterministic ordering for replay.

`executeToolAndObserve()` should become the single-call adapter over this core,
not the other way around.

## Refactor Sequence

### Wave 0: characterization and ownership pins

Before behavior changes, add red-on-cut tests for:

- stream termination interrupts an in-flight provider call;
- generator early return terminates the underlying run;
- no second run starts until the terminated run's scope has closed, unless
  explicit concurrent execution is requested;
- `run()` and `runStream()` produce equivalent terminal receipts;
- all child fibers terminate with the parent;
- prompt/surface hashes are recorded per iteration;
- batch and single tool execution produce equivalent policy/ledger facts.

Use deterministic replay first, then local non-reasoning tool-calling models,
then frontier directional validation. Do not use a live run as the only proof.

### Wave 1: introduce the supervisor without changing public behavior

Add `RunSupervisor` internally at the `ReactiveAgent`/`ExecutionEngine`
boundary. Thread an explicit cancellation scope and `RunRequest` into
`ExecutionEngine.execute()` and `executeStream()`.

Replace `execute-stream.ts:811-814` daemon ownership with a supervisor-owned
scoped fiber. The stream generator should be a projection of the supervisor's
event stream, and generator cleanup should call supervisor cancellation.

Keep `RunController` as a compatibility facade initially, delegating state to the
supervisor rather than owning another cancellation mechanism.

### Wave 2: unify terminal outcome construction

Move terminal result assembly into the supervisor around the kernel's
`CompletionEnvelope`, `RunAssessment`, `RunLedger`, and trust receipt. Make
`ReactiveAgent.run()` and `execute-stream.ts` thin projectors.

The stream path must no longer independently compute a different receipt or
terminal status. It should receive the same `RunOutcome` that `run()` would
return, with events preceding the terminal projection.

### Wave 3: remove the duplicate inline loop

Represent the current direct path as a lightweight kernel profile or shared
execution driver. Preserve its low setup cost, but move iteration lifecycle,
tool scheduling, cancellation, ledger growth, and terminal handling into the
supervisor/kernel interfaces.

Delete the second lifecycle implementation only after replay and live probes
show byte-equivalent behavior for the intended direct profile.

### Wave 4: unify tool scheduling and requirement evidence

Introduce the batch scheduler and `RequirementEvidence`. Migrate kernel batch,
plan-execute, blueprint, code-action, and inline execution. Keep strategy
differences in planning and policy, not in evidence or execution safety.

### Wave 5: optimize context and local execution

Add stable-prefix/surface diagnostics, then evaluate provider-specific policies.
Optimize deterministic post-tool completion and local profile turn budgets only
after the measurement substrate is trustworthy.

### Wave 6: child envelope and process projections

Replace manually enumerated child inheritance with a typed child execution
envelope. Project the same supervisor process tree into RunHandle inspection,
durable storage, traces, Cortex, and A2A.

## Non-Goals and Guardrails

- Do not add another reasoning strategy as the answer to runtime ownership debt.
- Do not merge raw LLM prompts into the factual ledger; link replay records to
  ledger/run IDs instead.
- Do not make stable tool surfaces default solely because they sound cacheable;
  require the existing lift rule and provider-specific evidence.
- Do not make the supervisor opaque. Its state transitions, control decisions,
  cancellation, and projections must remain typed and traceable.
- Do not delete the kernel's pure functions or immutable state model. Those are
  strengths and should become the supervisor's deterministic core.
- Do not introduce unstructured global state or detached background fibers for
  correctness-critical work. Background debrief/telemetry may remain detached
  only when explicitly classified as non-critical and joined by `dispose()` when
  necessary.

## Success Criteria

The refactor is successful when all of the following are proven:

1. One run has one supervisor scope and one terminal `RunOutcome`.
2. Cancellation interrupts provider, tool, and child fibers and leaves no active
   run work after the terminal cancellation event.
3. `run()` and `runStream()` agree on status, output, receipt, ledger identity,
   and usage.
4. Every tool path shares one policy, approval, observation, ledger, and
   cancellation boundary while retaining parallel scheduling.
5. Requirement satisfaction is derived from one ledger-backed evidence model.
6. Prompt/surface churn is observable, replayable, and attributable to a
   provider/profile policy.
7. Local tool tasks reduce unnecessary model turns without a cross-tier
   accuracy regression under the lift gate.
8. Child agents remain attributable, cancellable, policy-inheriting, and
   ledger-linked.
9. The public API becomes simpler: profiles and one run handle are primary;
   low-level withers and compose phases remain the escape hatch.

## Expected Capability After Convergence

If the supervisor and boundary-convergence work is implemented successfully,
Reactive Agents should behave like a process-oriented agent runtime rather than
a collection of reasoning strategies.

The framework should be capable of:

- Hard cancellation that stops provider requests, tools, child agents, and
  correctness-critical background work.
- Reliable pause, resume, fork, replay, inspect, and attach semantics.
- One terminal result shared by `run()`, streaming, durable storage, traces, and
  UI projections.
- Multi-agent process trees with inherited policy, budgets, cancellation,
  lineage, and receipts.
- Requirement-aware completion based on acceptance criteria instead of model
  self-declaration.
- Deterministic post-tool progression without unnecessary LLM calls.
- Provider-specific execution profiles for local, mid-tier, and frontier models.
- Replayable debugging where every intervention, tool action, model exchange,
  and terminal decision is explainable.
- Policy, approval, budget, and verification enforcement at one execution
  boundary.
- Evidence-backed self-improvement through replay and the public lift gate.

Strategies should become interchangeable planning policies over this shared
substrate. Changing a strategy, model, or tool surface should not change the
fundamental lifecycle, safety, evidence, or cancellation semantics.

## Expected Performance Impact

These are directional hypotheses, not performance claims. Each must be measured
against deterministic replay, a fast local tool-calling model, and a frontier or
mid-tier model before being used in public documentation or defaults.

Expected improvements include:

- **Simple tool workflows:** potentially 20-40% lower latency if deterministic
  post-tool checks eliminate one redundant model generation.
- **Tool-heavy local runs:** potentially 15-35% lower token usage through fewer
  repeated reasoning turns and compact evidence deltas.
- **Prompt-caching providers:** potentially material billed-input reduction if
  stable-prefix and tool-surface hashes produce real cache hits. The gain depends
  on provider cache rules and task length.
- **Cancellation:** near-zero residual provider/tool work after termination,
  improving GPU utilization and concurrency predictability.
- **Multi-agent runs:** lower coordination overhead because child state, events,
  and ledgers are inherited structurally rather than reconstructed manually.
- **Debugging and replay:** much lower engineering cost even when inference
  latency is unchanged.

The principal optimization is avoiding unnecessary model calls and repeated full
context reconstruction, not making TypeScript execution faster. No optimization
should become default-on without the project's cross-tier accuracy and token
lift gate.

## Mechanism Maturity Scorecard

The grades below describe the current implementation relative to mature agent
harness engineering practices. They are architectural assessments, not benchmark
scores. The target column describes the state required for the framework to scale
well as agentic workloads become longer, more concurrent, and more autonomous.

| Mechanism | Current | Target | Changes required |
|---|---:|---:|---|
| Cognitive kernel | A- | A | Keep `runKernel()` canonical; make every strategy consume the same envelope, evidence, and terminal outcome; delete strategy-specific lifecycle authority. |
| Run contract | B+ | A | Compile immutable acceptance criteria at intake; add per-entity requirements; make all self-stop proposals re-check the original contract. |
| RunLedger | B+ | A | Finish convergence of lifecycle events and projections; retain raw LLM I/O as linked replay data rather than duplicate truth; enforce one write seam. |
| RunAssessment | B | A- | Make assessment the sole source of progress counters, pace, outstanding requirements, and health signals; migrate private guard counters onto it. |
| Control plane | B- | A- | Make control decisions typed proposals with authority classes; deterministic facts may override, heuristics may advise only; record every intervention in the receipt. |
| Projector/context | B | A | Return stable-prefix, dynamic-suffix, and surface metadata explicitly; expose prompt/surface hashes and cache accounting; make compaction ledger-backed and reference-safe. |
| Tool execution | B | A | Build a batch-capable `ToolScheduler`; unify policy, approval, cancellation, ledger, events, and observation for single and parallel calls. |
| Requirement verification | B | A | Replace strategy-specific attempted/completed semantics with shared ledger-backed `RequirementEvidence`; make deliverable and output completeness terminal checks. |
| Completion/receipts | B+ | A | Make `RunOutcome` the sole terminal source; project `AgentResult`, `StreamCompleted`, trace, and durable records from it; preserve graded rather than absolute trust claims. |
| Run lifecycle | C+ | A | Introduce `RunSupervisor` as the sole owner of scope, cancellation, deadlines, budgets, child fibers, durable finish, and terminal state. |
| Streaming | C+ | A- | Remove correctness-critical `forkDaemon` ownership; make streams projections of the supervised event channel and guarantee generator-close cancellation. |
| Structured concurrency | B- | A | Keep parent-scoped subagents; add a typed `ChildExecutionEnvelope`; ensure all provider/tool/child fibers join or are interrupted before terminal cancellation. |
| Provider adaptation | B+ | A- | Keep calibration and healing behind the provider gateway; expose capability/profile decisions and request cache identity; avoid per-provider lifecycle forks. |
| Memory and learning | B- | B+/A- | Make recall/learn evidence and latency visible in the run ledger; move learning decisions from opaque finalization into measured, lift-gated control inputs. |
| Observability/replay | B | A | Make ledger, trace, EventBus, stream, and durable journal projections of one run identity; add exact replay and divergence diagnostics as CI gates. |
| Multi-agent process model | B- | A- | Project the scoped process tree into inspect/attach/Cortex/A2A; verify child receipts and enforce per-worker budgets and policy at the scheduler boundary. |
| Public DX | B- | A- | Make profiles the primary API, freeze/reduce top-level withers, reject unknown/inert configuration, provide a true quiet mode, and return typed actionable provider errors. |
| Measurement discipline | B+ | A | Require deterministic replay, graded capability tasks, feature-matrix coverage, and cross-tier lift evidence for every default-on mechanism. |

## Scaling Guardrails

The refactor must preserve these properties as the framework grows:

1. **One run identity.** Every event, ledger entry, provider exchange, child,
   durable row, trace, and UI projection carries the same root run identity and
   explicit lineage.
2. **One owner per authority.** Contract compilation, ledger growth, assessment,
   control, tool execution policy, terminal meaning, and public result projection
   each have one owner module.
3. **Structured concurrency by default.** Correctness-critical work is scoped to
   the run. Detached work is allowed only for explicitly non-critical telemetry
   or debrief tasks and must have a documented join/dispose policy.
4. **No hand-copied cross-cutting configuration.** Provider, policy, budget,
   contract, observability, and cancellation fields cross boundaries through
   typed envelopes or derived types.
5. **Stable hot paths.** Context projection, tool scheduling, ledger append, and
   terminal verification must remain deterministic and independently measurable.
6. **Bounded state.** Long runs must compact by ledger-backed reference, retain
   failures and requirements, and expose dropped references rather than silently
   deleting evidence.
7. **Provider isolation.** Provider adapters own wire formatting and quirks;
   they must not own framework lifecycle or completion semantics.
8. **Capability coverage ratchets upward.** A mechanism is not shipped merely
   because its declaration exists. It needs a deterministic wiring test, a graded
   capability task, and a feature-matrix entry.
9. **Public defaults require evidence.** New default behavior must clear the
   cross-tier lift rule; otherwise it remains opt-in or is removed.
10. **Profiles over API expansion.** New user capability should normally be a
    profile, policy, or compose phase, not another top-level builder method.

## Architecture Grade After Refactor

The current framework is strongest in its kernel, evidence direction, local-model
adaptation, and verification ambition. It is weakest in runtime lifecycle
ownership, streaming structured concurrency, context/cost efficiency, and public
configuration ergonomics.

Current overall architecture is approximately **B-** relative to leading agent
harness practices:

- **A-** kernel composition;
- **B+** evidence and verification direction;
- **B+** local-model adaptation;
- **C+** runtime lifecycle and streaming ownership;
- **C+/B-** context and cost efficiency;
- **B** observability and replay;
- **B-** public DX and mechanism surfacing.

The target is an overall **A-/A** architecture, but only if the runtime boundary
is brought up to the standard already established inside the kernel. The framework
does not primarily need more intelligence mechanisms. It needs fewer competing
owners, one supervised process scope, one terminal outcome, stable evidence
projections, and measured control over model calls.

## Live Follow-up Evidence

The continued Ollama and example-suite campaign sharpened the highest-leverage
work:

- Warm no-tool runs showed non-LLM framework work at roughly 1-2% of runtime;
  the dominant cost is model calls and repeated loop turns, not Effect phase
  scheduling.
- Both `qwen3:4b` and `qwen3.5:latest` exhausted 6-10 iterations and 6,691-8,397
  tokens on a file task when `.withTools()` exposed no built-ins. Traces showed
  repeated `discover-tools` calls, `No tools registered`, zero evidence delta,
  and no harness signal. No-capability/no-progress detection is therefore a
  control-plane requirement, not merely a prompt improvement.
- Explicitly exposing `file-write` and `file-read` allowed both tools to succeed,
  but path healing remapped `/tmp/reactive-agents-scratch.txt` to a confined
  working-directory path while terminal delivery verification checked the
  original path. The run failed after successful execution. Canonical healed
  arguments and artifact identity must cross the ledger and verifier boundary.
- Reactive was materially cheaper than reflexion for the same one-tool task on
  `qwen3.5:latest` (2,538 vs 4,006 tokens; 4.0s vs 17.7s). On `qwen3:4b`, the
  reflexion arm took 136.3s and 4,506 tokens. Strategy selection needs explicit
  model/task cost profiles and budgets before heavy strategies are selected.
- The example suite contained a stale public-result read (`run-pass-probe.ts`
  reported `status=unknown` and `steps=0`). Example success criteria must be
  type-checked against the public API and assert the telemetry they display.

These results reinforce the supervisor design: deterministic capability facts,
canonical tool arguments, assessment deltas, strategy budgets, and remediation
must all reach one control/terminal boundary. Fixing individual prompts or
raising iteration limits would amplify cost without fixing the authority split.

## Final Recommendation

Adopt the `RunSupervisor` as the next major architecture seam. Treat it as a
boundary-convergence project, not a greenfield rewrite. The kernel already
contains the right cognitive and evidence primitives; the highest leverage comes
from making runtime ownership match those primitives, then using the resulting
single scope and single outcome to optimize context, tool scheduling, and local
model turn count safely.
