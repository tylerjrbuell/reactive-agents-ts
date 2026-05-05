> **SUPERSEDED 2026-04-26** by `docs/spec/docs/15-design-north-star.md` (v3.0). This document is preserved as historical evidence; the authoritative architecture lives in the North Star.

---

# What Makes a Good AI Agent — and What the Harness Must Deliver

**Frame:** Step away from the codebase. Imagine an agent succeeding at a hard task. What did it just *do*? What systems made each step reliable? Now reverse-engineer: what must the harness guarantee for each capability?

This is the **launchpad doc** for redefining Reactive Agents. It is intentionally not a refactor plan. It's the prerequisite — the model of what we're trying to build *toward* — without which any architectural change is just shuffling code.

---

## Part 1 — The Inner Life of a Good Agent

Watch a competent human solve a hard task. Watch a good agent. What's happening, in order, every cycle?

### The 10 Capabilities (what an agent must DO)

Every agent — biological or artificial, simple or complex — performs the same loop. The names are mine; the underlying loop is universal:

1. **Sense** — observe the world and the self ("what just happened?")
2. **Attend** — filter sensed signal to what matters now ("what should I focus on?")
3. **Comprehend** — parse meaning from signal ("what is being asked? what does this mean?")
4. **Recall** — retrieve relevant prior knowledge ("what do I already know about this?")
5. **Reason** — generate candidate next actions ("what could I do?")
6. **Decide** — select exactly one action ("what *will* I do?")
7. **Act** — execute the chosen action in the world ("do it")
8. **Verify** — check whether the action achieved its purpose ("did it work?")
9. **Reflect** — evaluate the trajectory and adjust strategy ("am I making progress?")
10. **Learn** — consolidate the experience for future use ("what did I learn?")

These are not stages of a workflow. They are *concerns* — cognitive functions that may run sequentially in one iteration or in parallel across iterations. The harness's job is to make each one **reliable, observable, controllable, and learnable**.

### The five "trait clusters" these capabilities deliver

Across the 10 capabilities, the agent develops five traits. Each trait must be visibly present in a competent agent:

| Trait | Capabilities involved | What failure looks like |
|---|---|---|
| **Comprehension** | Sense, Attend, Comprehend | Misreads the task; uses wrong tools; answers a different question |
| **Strategic intent** | Reason, Decide | Picks bad actions; loops on the same approach; fails to escalate |
| **Effective action** | Act, Verify | Wrong tool args; ignores tool errors; declares success when failing |
| **Self-monitoring** | Reflect | Doesn't notice it's stuck; can't tell if it's progressing |
| **Compounding intelligence** | Recall, Learn | Repeats prior mistakes; never accumulates expertise across runs |

These five traits are exactly what `00-VISION.md` promises (Reliability, Control, Performance, etc.) but mapped to *agent behavior* instead of *framework features*. **The vision is delivered when each trait is empirically visible in agent runs.**

---

## Part 2 — What the Harness Must Provide

For each agent capability, the harness must provide **one clear system that owns it**. Not seven. Not three. One.

### Capability → Required Harness System

| Agent capability | Harness system needed | Empirical contract |
|---|---|---|
| **Sense** | Observation Sensor — pure read of state + tool results + time + entropy + tokens | Same input → same output. Observable via EventBus. |
| **Attend** | Salience Curator — filters observations to per-iteration relevance | One author per iteration. Trust labels propagated. Per-tier compression policy. |
| **Comprehend** | Task Comprehender — parses intent, decomposes goals, identifies constraints | Idempotent. Output is structured (typed). Constraints feed Decide and Verify. |
| **Recall** | Memory Service — 4 layers: working / episodic / semantic / procedural | Each layer has one writer + one reader interface. Calibrated retrieval relevance. |
| **Reason** | Reasoning Engine — strategy-pluggable: ReAct, Plan-Execute, ToT, Reflexion, Adaptive | Strategy is data, not code paths. Switch is observable. |
| **Decide** | Arbitrator — single function, one verdict per iteration: continue / exit-success / exit-failure / escalate | The ONLY component that decides termination or strategy switch. |
| **Act** | Effector Pool — tool execution, LLM calls, memory writes, sandboxed | Side effects only. Receives Verdict, never decides. Parallelizable when independent. |
| **Verify** | Verification Gate — completion check, evidence grounding, quality oracle | Reads action result + task; emits pass/fail with reason. Wraps every effector output. |
| **Reflect** | Reflection Engine — entropy + progress + dispatcher activity → self-state assessment | Pure function over recent state. Output feeds Arbitrator and Reason. |
| **Learn** | Learning Pipeline — debrief synthesis, calibration update, experience capture | Runs at session boundaries; never blocks the inner loop. Closes the cycle. |

### The five cross-cutting concerns

Beyond the 10 capability-systems, the harness needs five concerns that flow *through* every layer:

- **State** — single source of truth (KernelState as working memory)
- **Telemetry** — every event observable (EventBus + Trace)
- **Safety** — guardrails wrap effectors; budgets bound resources; identity authenticates
- **Time** — explicit clocking; iteration counter; no implicit time-since
- **Provenance** — every observation carries trust label + origin

These cross-cutting concerns must NOT be re-implemented in each system. They are framework primitives.

---

## Part 3 — Inspiration from Systems That Already Work

### Inspiration #1 — The brain (sensorimotor loop)

The brain didn't evolve nine termination paths. It evolved exactly one arbitrator (basal ganglia), with a clean upstream (sensory cortex → integration cortex) and downstream (motor cortex → muscles). Why? Because **competing decisions create deadlock; centralized arbitration creates coherence.** This is the architecture every cognitive system from C. elegans to humans converged on. We are not inventing — we are *adopting*.

The brain also has:
- **Inhibitory control** (prefrontal cortex vetoes lower-brain impulses) → Verdict-Override pattern
- **Predictive coding** (uncertainty as universal currency, propagates up + down) → entropy as a signal everywhere
- **Hippocampal consolidation** (working memory → long-term memory in sleep) → Learn capability runs at session boundary
- **Default mode network** (reflection happens between tasks, not during) → Reflect runs *between* iterations, not within Act

### Inspiration #2 — Established cognitive architectures

**ACT-R** (Anderson, Carnegie Mellon, ~30 years of research) decomposes cognition into:
- Goal module (current task)
- Procedural module (rules)
- Declarative module (facts)
- Perceptual modules (sensors)
- Motor module (effectors)
- Central pattern matcher (one rule fires per cycle)

**SOAR** (Newell, Laird, ~40 years) uses problem-space search with:
- Working memory
- Long-term memory
- Decision cycle (proposal → selection → application)
- Impasse-driven subgoaling

**Both converged on:** working memory + perception + decision + action + learning, with one decision per cycle. **Both predate transformers by decades and arrived at the same shape.** This is the cognitive architecture pattern, not a guess.

### Inspiration #3 — Two systems thinking (Kahneman)

System 1 (fast, intuitive, parallel) vs System 2 (slow, deliberative, serial). For an agent:
- **System 1**: cached responses, recognized patterns, simple tool calls (skill-based)
- **System 2**: novel reasoning, multi-step planning, escalation (rule-based)

The harness needs both modes. Today's reactive strategy is mostly System 1; plan-execute is mostly System 2. The harness should **route** between them based on signal (entropy, complexity), not force one for everything.

### Inspiration #4 — LangGraph (explicit state machine)

LangGraph's whole architecture: the graph IS the program. Every transition is a labeled edge. Every termination flows to one `END` node. There is nowhere for hidden control flow to hide. **Reliability comes from making the control flow visible.**

### Inspiration #5 — OpenAI Swarm (~200 LOC)

Swarm trades features for primitives. Three primitives (agent, handoff, tool); everything else is composition. **Reliability comes from minimum primitives done well.**

### Inspiration #6 — Anthropic's Claude Code

Opaque inner loop, but: explicit observability via tool-call events, explicit context management (sub-agents, /clear, /compact), explicit termination (the model says when it's done OR `<tool>final_answer</tool>` path). **Single termination path even in an "opaque" system. The opacity is implementation; the contract is sharp.**

---

## Part 4 — The Convergent Architecture: Cognitive Services

Synthesizing the 10 capabilities + 5 cross-cutting concerns + biology + cognitive architectures + framework patterns:

**Reactive Agents should be a Cognitive Services architecture organized around the agent loop.**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CROSS-CUTTING (always available)                     │
│  State (KernelState)  |  Telemetry (EventBus)  |  Safety (Guardrails+      │
│  Budgets+Identity)    |  Time (Clock)          |  Provenance (TrustLabels) │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
       ┌─────────────────────────────┼─────────────────────────────┐
       │                             │                             │
       ▼                             ▼                             ▼
┌─────────────┐                ┌─────────────┐               ┌─────────────┐
│  PERCEIVE   │                │  REASON     │               │   ACT       │
│             │                │             │               │             │
│  Observation│                │  Reasoning  │               │  Effector   │
│  Sensor     │   ┌───────►    │  Engine     │   ┌───────►   │  Pool       │
│             │   │            │             │   │           │             │
│  Salience   │   │            │  Reflection │   │           │  Verifier   │
│  Curator    │   │            │  Engine     │   │           │             │
│             │   │            │             │   │           │             │
│  Task       │   │            └──────┬──────┘   │           └──────┬──────┘
│  Comprehend │   │                   │          │                  │
└──────┬──────┘   │                   ▼          │                  │
       │          │            ┌─────────────┐   │                  │
       │          │            │             │   │                  │
       │          │            │ ARBITRATOR  │───┘                  │
       │          │            │             │                      │
       │          │            │ ONE verdict │                      │
       │          │            │ per iter    │                      │
       │          │            │             │                      │
       │          │            │ continue    │                      │
       │          │            │ exit-ok     │                      │
       │          │            │ exit-fail   │                      │
       │          │            │ escalate    │                      │
       │          │            └─────────────┘                      │
       │          │                                                 │
       └──────────┴─────────────────────────────────────────────────┘
       ▲                                                            │
       │                                                            │
       │                                                            ▼
       │                                                     ┌─────────────┐
       │                                                     │   LEARN     │
       │                                                     │             │
       │                                                     │  Memory     │
       │                                                     │  Service    │
       └─────────────────────────────────────────────────────┤             │
                                                             │  Calibration│
                                                             │             │
                                                             │  Experience │
                                                             └─────────────┘

Loop Controller orchestrates: Perceive → Reason → Decide (Arbitrator) → Act → Learn → repeat
```

### The 10 services + 5 concerns mapping

| Service | Capability | Lives where (proposed) | Today's analog |
|---|---|---|---|
| ObservationSensor | Sense | `packages/cognition/sensor` | scattered (kernel-state reads, trace events) |
| SalienceCurator | Attend | `packages/cognition/curator` | ✅ ContextCurator (S2.5) — keep |
| TaskComprehender | Comprehend | `packages/cognition/comprehender` | task-intent.ts (partial) |
| MemoryService | Recall | `packages/memory` | ✅ Already cohesive — keep |
| ReasoningEngine | Reason | `packages/reasoning` | ✅ 5 strategies — refactor to remove decision-making |
| Arbitrator | Decide | `packages/cognition/arbitrator` (NEW) | termination-oracle (one of nine) |
| EffectorPool | Act | `packages/cognition/effectors` | think.ts/act.ts effector parts |
| Verifier | Verify | `packages/cognition/verifier` | quality-utils, evidence-grounding (scattered) |
| ReflectionEngine | Reflect | `packages/cognition/reflection` | reactive-observer (mixed concerns today) |
| LearningPipeline | Learn | `packages/cognition/learning` | learning-engine, debrief, calibration (loosely connected) |

| Cross-cutting concern | Lives where (today) | Status |
|---|---|---|
| State | `packages/reasoning/.../kernel-state` | ✅ keep |
| Telemetry | `packages/core/event-bus` + `packages/trace` | ✅ keep |
| Safety | `packages/guardrails` + `packages/cost` + `packages/identity` | ✅ keep |
| Time | implicit | ⚠ extract |
| Provenance | `ObservationResult.trustLevel` (S2.3) | ✅ extend to all observations |

**The proposed `packages/cognition/` is where the missing single-owner services land.** Reasoning, memory, guardrails — those packages stay as they are and are *consumed* by cognition services. The cognition layer is the orchestration layer that makes the agent loop coherent.

---

## Part 5 — How this delivers the five traits

### Comprehension trait (Sense + Attend + Comprehend)
- ObservationSensor returns structured data, not strings to parse
- SalienceCurator (already shipped) is the single author of the prompt
- TaskComprehender produces a typed Task object with goal + constraints + decomposition
- **Result:** the model receives a coherent picture every iteration; we can pin "did the agent comprehend?" via gate scenarios on TaskComprehender output

### Strategic intent trait (Reason + Decide)
- ReasoningEngine generates candidates (multiple if appropriate, e.g. ToT)
- Arbitrator picks one and decides whether to continue
- The Decision Ladder pattern lives inside the Arbitrator (tactical → strategic → terminal)
- **Result:** one decision per iteration, observable at one point; escalation is in the data, not in nine code paths

### Effective action trait (Act + Verify)
- Effectors only execute; they don't decide
- Verifier wraps every effector output and reports pass/fail with structured reason
- **Result:** "did the action work?" is answerable for every action by reading the verifier's emit; "did the agent declare success when failing?" is answerable by the arbitrator reading the verifier's history

### Self-monitoring trait (Reflect)
- ReflectionEngine is a pure function over recent state
- Outputs feed the Arbitrator (so reflection actually changes behavior, unlike today where it observes-but-can't-act in some cases)
- **Result:** entropy + progress + dispatcher signal all enter Arbitrator's decision

### Compounding intelligence trait (Recall + Learn)
- Memory Service is already 4-layer (good)
- Learning Pipeline runs at session boundary (post-iteration), writing to memory + calibration + experience
- The agent loop reads from memory at Recall; never blocks waiting for write
- **Result:** every session's outcomes feed the next session's priors. Compounding is structural, not aspirational.

---

## Part 6 — Honest assessment: where Reactive Agents stands today

### What we already have that fits the model (preserve)

- **Memory Service** — four layers, well-organized, single owner. Map directly to Recall.
- **ContextCurator (S2.5)** — single author, trust-aware. Map directly to Attend (SalienceCurator).
- **Capability port (S1.1-S1.3)** — clean owner of model capabilities. Used by Reasoning, Effectors, Curator.
- **5 reasoning strategies** — pluggable Reason implementations.
- **EventBus** — telemetry concern, well-shaped.
- **Guardrails / cost / identity** — safety concern, well-shaped.
- **Trust labels (S2.3)** — provenance concern, just needs to extend to all observations.

### What we have but is mixed (decompose)

- **think.ts** — does Sense + Comprehend + Reason + Decide + Act in one phase. Decompose into ObservationSensor + ReasoningEngine + Arbitrator + Effector calls.
- **act.ts** — does Act + Verify + Decide. Decompose into Effectors + Verifier; remove the termination decision.
- **reactive-observer.ts** — does Sense (entropy) + Reflect + Decide (which intervention) + Act (dispatch patches). Decompose into Reflection (pure) + Effector (dispatch); decision moves to Arbitrator.
- **termination-oracle.ts** — is the partial Arbitrator. Promote to THE Arbitrator; consolidate the 9 termination paths into it.
- **3 compression systems** — collapse into SalienceCurator (already the right home).
- **Multiple iteration counters** — collapse into State.iteration (single source of truth).

### What's missing (build)

- **TaskComprehender** as a first-class service (today's task-intent.ts is a fragment)
- **Verifier** as a first-class service (today's quality-utils is partial)
- **Arbitrator** as a single function (today scattered across 9 termination sites)
- **Time service** (today implicit; should be explicit and mockable)
- **Cognition package** to host the new services

### What this means honestly

We have **~70% of the right pieces.** The framework's architectural sin isn't missing capability — it's *concerns mixed together in the same module.* The refactor doesn't add features; it *extracts and clarifies* what's already there. Lines of code shrinks, doesn't grow. New code is small (Arbitrator, TaskComprehender, Verifier); existing code is split, not rewritten.

---

## Part 7 — Properties this architecture delivers

### Reliability (vision pillar)
- One Arbitrator → no contradictory termination decisions
- Pure sensors + integrators → reproducible behavior
- Verifier wraps every action → no silent failures
- Typed errors throughout (Effect-TS) → no uncaught exceptions

### Control (vision pillar)
- Every cognitive function has one owner; you can swap it
- Every decision flows through one function; you can log/trace/override it
- Strategy is data; you can switch at runtime without restarting

### Performance (vision pillar)
- Pure functions cache trivially
- Effectors parallelize when independent
- Memory service runs async (W16) without blocking the loop
- One curator → one prompt → no re-compression in three places

### Observability (vision pillar)
- Each service emits domain events on EventBus
- Trace replay shows: which sensor fired, which integrator integrated, which verdict the arbitrator returned, which effector executed
- Today's "where did the agent decide to stop?" becomes a trivial trace question

### Compounding intelligence (vision pillar)
- Learning runs at session boundary
- Calibration updates per-(provider, model) on every run
- Experience accumulates cross-agent
- Memory consolidation is asynchronous from the inner loop

### Developer Experience (vision pillar)
- Builder API unchanged (cognition is below the builder)
- Each service is independently testable
- Adding a new capability = adding a new service, not patching 9 sites
- "Where does termination happen?" → `packages/cognition/arbitrator` (single answer)

---

## Part 8 — The unifying principle

**Every cognitive function in the agent must be implemented as a service with: one owner, typed contract, observable events, replaceable strategy, and isolated tests.**

This is the rule that converts the vision into architecture. It's the rule that the brain follows (one basal ganglia, one prefrontal cortex, one hippocampus — never seven of each). It's the rule that ACT-R, SOAR, LangGraph, and Swarm all converged on. It's the rule that — when violated, as in our 9 termination paths — produces the failure modes we just spent two days diagnosing.

The Cognitive Services architecture is the *minimum viable structure* that delivers all 10 agent capabilities reliably. Anything simpler omits a capability. Anything more complex over-engineers the relationship between them.

---

## Part 9 — From here, three questions only you can answer

1. **Does this capability model resonate?** Did I miss a capability an agent needs that doesn't fit the 10? (e.g., "communicate" — I folded it into Effector, but it might warrant its own service)

2. **Is "cognition" the right package name** for the new home, or do you prefer something less neuroscience-flavored (e.g., `packages/kernel-core`, `packages/agent-loop`)?

3. **Should each service map 1:1 to a package** (10+5 packages, very explicit) or **should related services bundle** (e.g., `packages/cognition/{sensor, curator, comprehender}` as one package with submodules)? Bundling is faster to ship; 1:1 is more enforceable.

---

## What this is and isn't

This is **the model of the agent we're trying to build.** It's the foundation that lets us judge any future architectural change by asking "does this make one of the 10 capabilities cleaner / more reliable / more observable?"

It is *not* a refactor plan. The refactor plan comes after we agree on the model. The model is the contract; the refactor is the implementation.

It is *not* a rejection of what we've shipped. It's the framework that says "S2.5 ContextCurator was the SalienceCurator pattern; S2.3 trust labels are the Provenance concern; S1.x Capability port is what every service consumes." We've been building toward this picture without naming it. **Naming it is what makes the next phase coherent.**
