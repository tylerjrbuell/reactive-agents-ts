---
type: design-spec
status: draft (for review)
created: 2026-06-17
tags: [multi-agent, orchestration, agentic-teams, command-structure, subagents]
related:
  - "[[2026-05-18-agentic-team-ownership-concepts]]"
  - "wiki/Research/Audit-Reports-2026-06-17/subagent-system-audit.md"
  - "[[05-DESIGN-NORTH-STAR]]"
---

# Agentic Orchestration Strategies — Design Spec

> **One line:** Make *how a team of agents coordinates* a swappable strategy
> (mirroring how reasoning strategies swap *how one agent thinks*), backed by a
> shared **team substrate** that wires RA's compound single-agent systems —
> entropy, loop-detection, memory, verifier, durable/HITL, structured output,
> calibration, A2A — into every strategy for free. The flagship strategy,
> **team-ownership**, implements a SEAL-style chain of command (mission intent
> down, structured reports up, deterministic ownership of delegated failure,
> authority-bounded delegation).

## 1. Why

RA's multi-agent spine today is a **fan-out executor, not a command structure**
(see [[2026-05-18-agentic-team-ownership-concepts]] + the 2026-06-17 subagent
audit): it dispatches sub-agents and contains their failure, but propagates no
mission intent, enforces no authority, reports nothing structured upward, never
owns a delegated failure, and runs workers on a light runtime whose events never
reach the parent. Two structural problems follow:

1. **Coordination is hard-coded.** There is exactly one implicit pattern
   (parallel fan-out via `spawn-agents`). Debate, pipeline, map-reduce,
   orchestrator-workers, blackboard, mixture-of-agents — all require bespoke
   prompt-wrangling per use.
2. **The team is invisible + brittle.** Worker traces don't surface; failure is
   "contained," not owned; there is no shared awareness.

### Research grounding (what "powerful" means here)
- **Anthropic orchestrator-worker:** +90% vs single-agent, but **80% of the
  variance is token usage** — multi-agent's edge is *parallelizing tokens*, and
  it only wins when the task decomposes into **independent** threads. Detailed
  task descriptions prevent duplicate work; externalize the plan to memory
  before context fills. → token-scaling is the lever; decomposition quality is
  the gate; memory externalization is mandatory.
- **MAST failure taxonomy** (arXiv:2503.13657, 1600+ traces, 7 frameworks, 14
  failure modes): the dominant failures are **system-design**, not model
  capability — step-repetition-without-progress (15.7%), fail-to-recognize-
  termination (12.4%), disobey task/role spec (13.3%), inter-agent misalignment
  (32.3%), task-verification gaps. "Better models won't fix it; better system
  design will." → the substrate must *structurally* defend each mode.
- **MoA / multi-agent debate:** real quality gains, but "tyranny of the
  majority," "problem drift," and **"debate only when necessary"** (expensive;
  invoke adaptively under uncertainty). → adaptivity beats always-on collaboration.
- **MetaGPT ("Code = SOP(Team)"):** standardized **structured artifacts** between
  roles cut miscommunication. → typed hand-off is a first-class need.
- **A2A protocol** (Google, 2025) is the cross-framework handoff standard — RA
  already implements it (`withRemoteAgent`).

### The unique edge
No other framework pairs multi-agent orchestration with RA's **compound
single-agent systems**. The substrate wires them in so every strategy inherits:
per-worker reasoning strategy, **entropy/confidence-driven adaptivity**,
loop-detection, 4-tier memory, verifier+grounding, durable+HITL, structured
output, calibration, budget, and A2A — which is precisely the "system-design
layer" MAST says is the real fix. **Entropy-driven adaptive orchestration is the
headline differentiator** (decide *when* to fan-out/debate/escalate from a live
uncertainty signal, not a fixed policy).

## 2. Architecture: substrate + strategy

Mirrors the kernel/strategy split. The reasoning *kernel* (act/think/observe/
decide) is shared substrate; reasoning *strategies* compose it. Here:

```
TEAM SUBSTRATE (shared "team kernel" — every orchestration strategy composes it)
  contracts:   MissionIntent (↓)        UpwardReport (↑)        TeamResult (envelope, itself an UpwardReport)
  primitives:  dispatch(member, intent) → UpwardReport
               aggregate(reports, mode) → AggregateResult        // merge | vote | best-of | reduce | concat
               ownFailure(report, policy) → RecoveryDecision     // DETERMINISTIC FSM (no LLM re-verify)
               escalate(report) → ApprovalDecision               // up the chain via approvalGate()
               workspace: TeamWorkspace                          // shared blackboard (RA memory-backed)
               signal: TeamSignals                               // entropy/confidence/loop/budget — drives adaptivity
  wired-in (automatic at dispatch):
               observability propagation · authority (authorize()) · budget/concurrency · loop-detection · memory

ORCHESTRATION STRATEGY (thin — owns coordination logic only)
  decompose goal → dispatch policy (seq/parallel/dynamic/rounds/auction)
                 → convergence/termination → synthesis choice → recovery policy
  may OVERRIDE a substrate primitive (escape hatch): custom aggregate / report grammar / FSM
```

### 2.1 The OrchestrationStrategy contract

```ts
interface OrchestrationStrategy {
  readonly id: string;                                  // registry key, like ReasoningStrategy.strategyId
  run(ctx: OrchestrationContext): Effect<TeamResult, OrchestrationError>;
}

interface OrchestrationContext {
  readonly goal: MissionIntent;        // from the user OR a superior team (teams nest)
  readonly team: TeamRoster;           // lead + members — agent refs (handles, not full builders)
  readonly substrate: TeamSubstrate;   // the shared primitives below
  readonly config: OrchestrationConfig;// budget, concurrency, maxRounds, recoveryPolicy, adaptivity thresholds
}
```

Registered in an `OrchestrationRegistry` exactly like `StrategyRegistry`
(`["team-ownership", "orchestrator-workers", "map-reduce", "pipeline",
"debate", "moa", "blackboard", "ensemble"]`). Default registered set is small;
custom strategies register by `id`.

### 2.2 Contracts (the down/up grammar)

```ts
// ↓ Commander's intent (USMC MCDP-1 schema). Reuses/extends TaskIntent + ParentContext.
interface MissionIntent {
  readonly endState: string;                 // what "done" looks like (the WHAT, not the HOW)
  readonly purpose?: string;                  // the WHY (commander's intent)
  readonly keyTasks?: readonly string[];      // must-dos
  readonly constraints?: readonly string[];   // bounds (don't do X, budget, deadline)
  readonly inputs?: unknown;                  // TYPED data hand-off (paired with the member's outputSchema)
  readonly parentContext?: ParentContext;     // existing bounded context prefix
}

// ↑ Upward report. Mirrors A2A TaskState (already in a2a/types.ts) — backward-compatible
//   superset of today's SubAgentResult.
interface UpwardReport {
  readonly status: "completed" | "partial" | "failed" | "blocked" | "needs-approval";
  readonly output: unknown;                   // typed when the member declared an outputSchema
  readonly confidence: number;                // 0..1 — sourced from RA entropy/verifier (NOT self-asserted)
  readonly blockers?: readonly string[];      // what stopped me (drives re-dispatch)
  readonly needs?: readonly string[];         // what I need from a superior/peer (lead UP)
  readonly escalationRequired?: boolean;      // authority/judgment beyond my bound
  readonly progress?: { ratio: number; note?: string };   // anti-step-repetition (MAST 15.7%)
  readonly verification?: VerificationResult; // verifier/grounding signal
  readonly tokensUsed: number; readonly toolsUsed?: readonly string[];
}

// Envelope — a team's result IS an UpwardReport (so teams nest into hierarchies).
type TeamResult = UpwardReport & { readonly memberReports: readonly UpwardReport[] };
```

### 2.3 Substrate primitives + RA-compound wiring + MAST defense

| Primitive | Behaviour | RA compound wired in | MAST mode defended |
|---|---|---|---|
| `dispatch(member, intent)` | Run a member agent on its own runtime; return a structured `UpwardReport`. | per-member **reasoning strategy** + **calibration** + **budget**; **event propagation** to the team bus; **authority** (`authorize()`) before tool use; **loop-detector** active. | role/task disobedience; invisible workers; step repetition |
| `aggregate(reports, mode)` | Deterministic reducers + optional LLM `reduce`. `merge\|vote\|best-of\|reduce\|concat`. | **verifier** to score `best-of`; entropy for vote confidence | task-verification; majority-tyranny (diversity-preserving vote) |
| `ownFailure(report, policy)` | **Deterministic FSM** (no LLM): see §3 table. | verifier/grounding + `blockers` drive the transition | error propagation; un-owned failure |
| `escalate(report)` | Pause + ask a superior — **agent or human** — via the durable `approvalGate()` we shipped. | **durable HITL** (approval substrate) | misalignment; unrecoverable authority denials |
| `workspace` | Shared blackboard members read/write (scoped keys). | **4-tier memory** backs it; CAS for concurrent writes | loss of history; inter-agent misalignment (shared awareness) |
| `signal` | Live `{ entropy, confidence, loopRisk, budgetLeft }` the strategy reads to adapt. | **entropy sensor** + **loop-detector** + budget | **enables adaptivity** (debate-only-when-necessary, escalate-on-uncertainty) |
| (envelope) | termination contract + nested observability + team budget cap. | budget/cost; loop-detector at team scope | fail-to-recognize-termination (12.4%) |

**Hard constraint (from the concept doc, load-bearing):** `ownFailure` is a
deterministic FSM on the *structured report* — **never** a parent-side LLM
re-verify (recreates the double-rejection / M3 verify-retry loop the project
killed). The leader owns the outcome via the FSM, not via re-judging prose.

## 3. team-ownership (reference strategy)

The SEAL chain of command. `run(ctx)`:

1. **Plan (decompose).** Lead agent turns `goal` into per-member `MissionIntent`s
   (end-state + key tasks + constraints + typed inputs). Externalize the plan to
   `workspace` immediately (Anthropic lesson; MAST history-loss defense).
2. **Dispatch.** Parallel where threads are independent, sequential where a typed
   hand-off requires it (the lead declares the dependency graph). Concurrency +
   per-member budget bounded.
3. **Collect upward reports.** Each member returns an `UpwardReport`
   (confidence from entropy/verifier, blockers, needs, progress).
4. **Own the outcome (deterministic FSM):**

   | Report state | Leader action (no LLM) |
   |---|---|
   | `failed`, `blockers≠∅`, retries remaining | re-dispatch with blockers injected into intent |
   | `failed`, retries exhausted **OR** `escalationRequired` | `escalate()` (up to superior agent or human) |
   | `denied-by-authority` | escalate (cannot re-plan around an authority bound) |
   | `blocked`, `needs≠∅` satisfiable by a peer | re-dispatch the peer, then resume |
   | `completed`, `confidence < floor` | accept-with-disclosure (annotated, not silent) |
   | all `completed`, `confidence ≥ floor` | aggregate → synthesize team result |

5. **Lead up.** The `TeamResult` is itself an `UpwardReport` to the team's
   superior (user or parent team) — confidence, residual blockers, disclosures.
6. **AAR.** Reuse `synthesizeDebrief()` for the team after-action (no new AAR
   type — concept-doc constraint).

**Adaptivity (the differentiator):** the leader reads `signal.entropy/confidence`
to decide *escalation* and *whether to spin a debate/verification sub-step* —
e.g. low aggregate confidence on a high-stakes key-task → invoke `debate` over
just that sub-task before accepting. "Debate only when necessary," made native.

## 4. Strategy catalog (reuse map — proves the split)

Each is *thin*; the table shows what it reuses vs. owns.

| Strategy | Owns (strategy-specific) | Reuses (substrate) |
|---|---|---|
| **team-ownership** | hierarchical decompose; own-failure FSM policy; adaptivity | dispatch, UpwardReport, escalate, aggregate, workspace, signal |
| **orchestrator-workers** | LLM planner decompose; LLM synthesize | dispatch (parallel), aggregate(`reduce`), workspace |
| **map-reduce** | fixed split over a list; deterministic reduce | dispatch (parallel, high concurrency), aggregate(`merge`/`reduce`) |
| **pipeline** | linear dependency order | dispatch (sequential), **typed inputs hand-off** (MissionIntent.inputs + member outputSchema) |
| **debate** | R rounds; diversity preservation; convergence/drift detect | dispatch (parallel rounds), aggregate(`best-of` via verifier), signal (stop early) |
| **moa (mixture)** | layered aggregation; per-layer model diversity | dispatch (per-worker **model override**), aggregate(`reduce`) per layer |
| **ensemble/vote** | same task ×N diverse; self-consistency | dispatch (parallel), aggregate(`vote`) |
| **blackboard** | opportunistic controller (who acts next) | **workspace** (central), dispatch (dynamic), signal |
| **contract-net** | task auction / bidding | dispatch (dynamic), workspace (bids) |

Common substrate confirmed: **dispatch, the up/down contracts, aggregate,
ownFailure, escalate, workspace, signal**. Strategy-specific: decomposition,
dispatch policy, convergence, synthesis/recovery *choice*. Escape hatch: a
strategy may override `aggregate`, the report grammar, or the FSM.

## 5. Reuse map (no new packages / no new builder method / net type count flat)

| Need | Existing seam reused |
|---|---|
| Run a member | `createSubAgentExecutor` / `buildSubAgentTask` (extend, don't replace) |
| Upward report shape | A2A `TaskState` (`a2a/types.ts`) — mirror into `UpwardReport` |
| Authority | `identity.Delegation` + `IdentityService.authorize()` (currently declared, never called — wire it) |
| Escalation / human-in-chain | the durable `approvalGate()` + approval substrate shipped 2026-06 |
| Typed hand-off | `.withOutputSchema` (the structured-output pipeline) |
| Confidence | entropy sensor + verifier (NOT self-asserted) |
| Anti-loop / termination | loop-detector at team scope; explicit termination contract |
| Shared workspace | 4-tier memory + CAS |
| AAR | `synthesizeDebrief()` |
| Remote members | A2A `withRemoteAgent` |
| Cost bound | budget caps (`.withBudget`) |

Surface decision (API shape: Team primitive vs. agent-extension vs. sugar) is
**deferred to its own decision after this spec** — the contract above is shape-
agnostic. Strawman: `ReactiveAgents.team(roster).withOrchestration(id).run(goal)`
compiled down to the spawn/agent-tool seams (sugar-over-substrate).

## 6. Constraints (carried from the concept doc — do not re-discover)
1. **Own-failure deterministic, never LLM re-verify.**
2. **Mission-intent + adaptivity are empirically unproven** — ship behind the
   **M8 delegation bench** (GH #42) with the project lift rule (≥2 models, ≥3pp
   lift & ≤15% token overhead → default-on; else opt-in; else remove).
3. **No new contract/AAR types; no new package; no new builder method; no
   doctrine vocabulary in code.** Route through existing seams; net type count
   must not rise (additive optional fields on existing contracts are fine).

## 7. Phasing
1. **Substrate foundation:** event propagation (workers visible) + `UpwardReport`
   superset of `SubAgentResult` + per-member overrides (model/budget) + wire
   `authorize()`. *(Observable, bounded, owned-able workers. Ships value alone.)*
2. **OrchestrationRegistry + team-ownership** (deterministic FSM, escalate via
   approvalGate, aggregate). Behind the M8 bench.
3. **Adaptivity** (entropy/confidence → escalate/debate gates).
4. **Catalog breadth** (pipeline/map-reduce/debate/moa) + the API surface
   decision + cortex Workflow Studio exposure.

## 8. Open questions (for review)
- Decomposition: does the lead *agent* decompose (LLM), or can a strategy take a
  declared dependency graph (deterministic)? (Likely: both — strategy choice.)
- `confidence` source of truth: entropy vs verifier vs blend — needs an ablation.
- TeamWorkspace concurrency model (CAS vs last-write-wins vs append-log).
- How members are referenced: live builders, saved-agent ids, or A2A urls — a
  `TeamRoster` union.
- Bench design for M8 (the gate for default-on): scenario set + metrics.

## 9. Non-goals (v1)
- A visual team builder in cortex (separate Workflow Studio track; this spec is
  the engine).
- Cross-process team durability beyond the existing durable single-agent story.
- Learned/self-evolving topologies (MetaGen-style) — future.
