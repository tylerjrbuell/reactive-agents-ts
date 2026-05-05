> **SUPERSEDED 2026-04-26** by `docs/spec/docs/15-design-north-star.md` (v3.0). This document is preserved as historical evidence; the authoritative architecture lives in the North Star.

---

# Cognitive Kernel — Target Architecture Design (2026-04-26)

**Frame:** Evidence-anchored architectural design, not another "should." Three inputs:
1. **Empirical evidence** from this sprint's diagnostic work (Apr 25 scorecard, Apr 26 diagnosis, CHANGE A validation)
2. **Patterns from biology** that solve the same problem the framework keeps stumbling on
3. **Patterns from successful agent frameworks** that have already converged on cleaner designs

The vision (`docs/spec/docs/00-VISION.md`) names four properties: **Reliability, Control, Security, Performance.** The empirical work this sprint has shown us that the *current* architecture cannot deliver them — not because the components are wrong but because *concerns are mixed* and *contracts are implicit*. This document proposes the cleanest target architecture that delivers the vision properties without reinventing what biology and prior art have already solved.

---

## Part 1 — What the evidence taught us (no opinion, just facts)

### Fact 1 — The kernel has 9 termination paths, only 1 consults the oracle

Empirically confirmed by `grep "status.*\"done\""` in `packages/reasoning/src/strategies/kernel/`. CHANGE A wired the controllerSignalVeto into one of those nine. Three failure-corpus scenarios bypass it entirely via `act.ts:436` (final-answer-tool path).

**What this proves:** "termination" is not a single concern in the codebase — it's nine concerns each making an independent decision. Reliability is impossible when the same property is decided in nine places.

### Fact 2 — Phases conflate integration with decision-making

`think.ts` evaluates the LLM, parses tool calls, *and* decides whether the kernel should stop. `act.ts` executes tools *and* decides whether the kernel should stop. `loop-detector.ts` measures repetition *and* decides whether the kernel should stop. Same code module owns "what happened" and "what to do about it."

**What this proves:** every phase is doing two jobs. The result: nine code paths, each making a "stop" decision based on its local view, with no global reconciliation.

### Fact 3 — Run-to-run variance is 5×

Same scenario, two consecutive corpus runs (cogito:14b): `failure-rate-limit-loop` produced 9 vs 2 controller decisions, peakIter 9 vs 3, status `success` both times. The agent's *behavioral path* through the framework is not deterministic.

**What this proves:** the framework's outcome is dominated by which random path the agent takes, not by what the agent should logically do. Reliability requires fewer paths and tighter coupling between intent and outcome.

### Fact 4 — Three compression systems, two ModelTier definitions, four termination writers

G-4, G-2, G-5 from the architectural-gap audit. Each was created independently by a real need. Each was a sensible local decision. The aggregate is unmaintainable because no single component owns each concern.

**What this proves:** the framework has been growing by *addition* without *consolidation*. Every new feature was a layer on top instead of a refinement of an existing concern. This is exactly what creates the "mixed concerns" the user named.

### Fact 5 — Two patterns we've already validated work

- **Sole Author** (S2.5 ContextCurator): one component owns prompt assembly. Empirically clean — gate-pinned, no parallel paths in the kernel after Slice C.
- **Trust Boundary** (S2.3 + S2.5): observation provenance is part of the data; rendering decisions consult it. Empirically clean — `<tool_output>` wrapping pins prompt-injection defense.

**What this proves:** the framework already knows *how* to do single-concern ownership when it does it deliberately. The pattern works. It just hasn't been applied to termination, compression, or iteration counting yet.

---

## Part 2 — What biology and successful frameworks have converged on

### Biological pattern: sensorimotor loop with arbitrator

Every cognitive architecture in nature — from C. elegans (302 neurons) to the human brain — follows the same three-tier shape:

```
                    Sensors
                       │
                       ▼
                  Integrators
                       │
                       ▼
                  ┌─Arbitrator─┐
                  │   ONE      │     ← Basal ganglia: only ONE motor program
                  │  decision  │       runs at a time. Competing impulses are
                  └─────┬──────┘       arbitrated, then ONE wins.
                        │
                        ▼
                    Effectors
                       │
                       ▼
                    Outcome ──→ back to Sensors
```

Three properties of this design that ALL biological agents share:
1. **Sensors don't act.** Photoreceptors don't move muscles. They just report.
2. **Effectors don't decide.** Muscles don't choose what to contract — they execute commands.
3. **Arbitration is centralized AND fast.** The basal ganglia doesn't run every millisecond consensus protocol; it has a clear winner-take-all topology.

The reason biology converged on this pattern is that **clear separation of perceive → decide → act is the only architecture that scales without combinatorial debug surface.** When everything can decide everything, you get our 9-termination-paths situation.

### Inhibitory control / Verdict-Override (prefrontal cortex)

The prefrontal cortex doesn't add new behaviors — it *vetoes* impulses from older brain regions. This is exactly the Verdict-Override pattern CHANGE A introduced. Biology has been doing it for 200M years. We were on the right track but only added it as ONE veto next to nine impulse-paths instead of *the* veto-layer over a single impulse-emitter.

### Predictive coding (entropy as universal currency)

The brain represents uncertainty as a unified scalar (prediction error) that flows up and down the cortical hierarchy. We have entropy. We compute it. We mostly ignore it during termination. The brain *uses* it to gate every decision. This is the discriminator we've been missing.

### Successful framework pattern: explicit state machine (LangGraph)

LangGraph's whole architecture is "the graph IS the program." Nodes are phases. Edges are transitions. You can SEE the entire control flow as a graph. There is nowhere for hidden termination logic to hide because the only termination point is `END` — every path that wants to terminate must lead there.

We have phases. We don't have an explicit graph. The result: 9 places that secretly route to `END` without going through the graph.

### Successful framework pattern: minimal primitives (OpenAI Swarm)

Swarm is ~200 LOC. It has agents, handoffs, and a loop. That's it. Yet it composes to powerful systems because each primitive does exactly one thing.

We have many primitives. Several do overlapping things (3 compression systems, 4 termination writers). Reliability means *fewer* primitives doing well-defined things, not *more* primitives covering edge cases.

---

## Part 3 — Target architecture: Cognitive Kernel

Synthesizing the empirical evidence with biological and framework patterns: the target is a **three-tier kernel with an arbitrator pivot.**

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Working Memory                              │
│                          KernelState                                │
│  (single source of truth — only the loop controller mutates it)     │
└─────────────────────────────────────────────────────────────────────┘
                                  │
              ┌───────────────────┼────────────────────┐
              │                   │                    │
              ▼                   ▼                    ▼
       ┌──────────────┐   ┌──────────────┐    ┌──────────────┐
       │   Sensors    │   │ Integrators  │    │  Effectors   │
       │              │   │              │    │              │
       │ Read state.  │   │ Pure         │    │ Side-effect  │
       │ Return       │   │ functions.   │    │ functions.   │
       │ structured   │   │ Aggregate    │    │ LLM stream,  │
       │ observations │   │ sensor data  │    │ tool exec,   │
       │              │   │ into decision│    │ memory write │
       │ Examples:    │   │ inputs.      │    │              │
       │ - tokens     │   │              │    │ Examples:    │
       │ - iter count │   │ Examples:    │    │ - llmCall()  │
       │ - tool calls │   │ - Curator    │    │ - toolExec() │
       │ - entropy    │   │ - Aggregator │    │ - memWrite() │
       │ - controller │   │ - Oracle     │    │              │
       │   decisions  │   │              │    │ Effectors    │
       │              │   │ Integrators  │    │ NEVER decide │
       │ Sensors      │   │ NEVER decide │    │ to terminate │
       │ NEVER mutate │   │ to terminate │    │              │
       │ state.       │   │              │    │              │
       └──────┬───────┘   └──────┬───────┘    └──────┬───────┘
              │                  │                   │
              └──────────────────┼───────────────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │      Arbitrator        │
                    │   (single function)    │
                    │                        │
                    │ Inputs:  all signals   │
                    │ Output:  exactly ONE   │
                    │          verdict per   │
                    │          iteration:    │
                    │                        │
                    │  - continue            │
                    │  - exit(success, out)  │
                    │  - exit(failure, err)  │
                    │                        │
                    │ Arbitrator NEVER       │
                    │ executes — it only     │
                    │ decides.               │
                    └───────────┬────────────┘
                                │
                                ▼
                    ┌────────────────────────┐
                    │    Loop Controller     │
                    │                        │
                    │ The ONLY component     │
                    │ that mutates state.    │
                    │                        │
                    │ for each iteration:    │
                    │   1. read sensors      │
                    │   2. run integrators   │
                    │   3. ask arbitrator    │
                    │   4. if continue:      │
                    │       run effector     │
                    │       transition state │
                    │   5. if exit: terminate│
                    │                        │
                    └────────────────────────┘
```

### Contracts (the property this architecture pins)

**Sensors** are pure functions `state → readonly Observation`. They cannot mutate. They return what they see.

**Integrators** are pure functions `Observation[] → Decision-ready data`. They cannot mutate. They synthesize, score, weigh — but produce no actions.

**Arbitrator** is a pure function `(Decision-ready data, state) → Verdict`. It returns exactly one of three verdicts per iteration. It cannot mutate state, cannot execute effects, cannot decide more than once per iteration.

**Effectors** are side-effect functions `(state, Verdict) → Effect<NewState, Error>`. They do real work (LLM, tools, memory) but they cannot decide whether to terminate. The Verdict tells them what to do.

**Loop Controller** is the only state mutator. It owns the iteration cycle. It calls sensors → integrators → arbitrator → effector in a fixed order. Termination is its responsibility alone.

This is the basal ganglia architecture, exactly. Sensors = thalamic relays. Integrators = cortical processing. Arbitrator = striatum. Effectors = motor cortex. Loop = thalamocortical loop. We are not inventing anything — we are *adopting* the architecture that all cognitive systems converge on.

---

## Part 4 — What this preserves vs what changes

### Preserves (everything good we shipped)

- **Effect-TS service composition** — services flow through the loop controller; sensors/integrators/arbitrator can be Effect-typed pure functions
- **Builder API** — DX surface unchanged; complexity moves below the builder
- **EventBus** — sensors emit events; integrators consume events; this becomes more uniform, not less
- **Memory layers** (working/episodic/semantic/procedural) — already conformant; working memory IS KernelState
- **5 reasoning strategies** — each strategy provides its own (Sensors, Integrators, Arbitrator, Effectors) tuple via the kernel SDK; the loop controller is shared
- **ContextCurator (S2.5)** — already an Integrator. Stays exactly as-is.
- **Trust boundaries (S2.3 + S2.5)** — observation provenance is data; integrator + effector contract preserves it
- **Capability port (S1.1-S1.3)** — sensors read it; integrators consult it; effectors honor it
- **All gate scenarios** — cf-04 through cf-21 stay relevant; some get re-pinned at the new boundaries

### Refactors (concrete list)

| Today | Becomes | Why |
|---|---|---|
| 9 sites set `status: "done"` | 1 site (loop controller) handles termination | Sole Termination Authority |
| `think.ts` (1100 LOC, mixed concerns) | think-sensor (~150 LOC) + think-integrator (~100 LOC) + llm-effector (~200 LOC) | Single responsibility |
| `act.ts` (mixed concerns) | tool-call-sensor + tool-result-integrator + tool-effector | Single responsibility |
| Termination oracle (one of many) | Arbitrator (the one) | Inversion: integrators feed it, it decides |
| 3 compression systems | 1 integrator (ContextCurator already does this) | G-4 closure |
| Reactive observer (mixed integration + side effects) | reactive-integrator (pure) + reactive-effector (side effects only) | Separation |
| 4 ModelTier definitions | 1 (already done in S2.2) | Pattern proven |
| Scattered iteration counters | 1 source (KernelState.iteration) | Single Source of Truth |
| ExecutionEngine 4404 LOC | extracted phases mapped onto sensor/integrator/effector tiers | G-6 closure |

### Doesn't change (no panic)

- The 5 reasoning strategies — each becomes a "kernel configuration" of (sensors, integrators, arbitrator, effectors)
- All 6 LLM providers
- The memory system
- The gateway, A2A, identity, guardrails
- The DX surface

The user-facing API does not change. The thing changing is the *internal kernel architecture*. From outside, it looks the same.

---

## Part 5 — Why this delivers the four vision properties

### Reliability
- **Single termination authority** → no more 9-paths-shipping-different-verdicts. Failure detection works because there's only one place it can be tested.
- **Pure integrators** → identical inputs produce identical outputs. Eliminates the "phase has side effects you didn't expect" debugging session.
- **Run-to-run variance** drops because the agent's behavioral path through the framework converges (same inputs → same routing).

### Control
- **Every decision is in the arbitrator.** You can `console.log` one function and see every verdict.
- **Sensors are observable for free** — they're pure functions returning data.
- **Effectors are inspectable** — they receive a Verdict, you can see exactly what the kernel asked them to do.

### Security
- **Trust boundaries propagate naturally** — observation provenance is sensor data; integrators consult it; effectors render it. No surface for prompt-injection content to escape its lane.
- **Effectors are the only side-effect surface** — guardrails wrap effectors, not phases. Single point of policy enforcement.

### Performance
- **Pure functions cache** — sensors and integrators with the same inputs return the same outputs. Memoization becomes trivial.
- **Effectors run in parallel where independent** — Effect-TS fibers compose naturally over the effector tier.
- **No redundant compression** — one Curator, one decision per iteration.

---

## Part 6 — Honest tradeoffs

### Costs
- **Refactor scope is large.** Realistic estimate: 4-6 weeks of focused work, broken into ~10 PRs of ~300-500 LOC each.
- **Some abstractions add overhead** — wrapping a side-effect call in an "effector" adds one function-call layer. Negligible at runtime; non-trivial in code reading until people internalize the pattern.
- **Migration period has both old and new shapes.** During the migration the kernel will have legacy phases AND new sensor/integrator/effector tuples. Need clear migration order to avoid double work.

### Risks
- **We could over-decompose.** Sensors that return single values aren't worth their own module. Need pragmatic minimums (probably 4-6 sensors total, not 20).
- **Effect-TS layering can hide the architecture.** Need disciplined module boundaries so the three tiers stay visible.
- **The Arbitrator becomes a god object** if we don't keep its decision surface small. Mitigation: arbitrator is `(SignalBundle) → Verdict` — its inputs are typed, its outputs are typed, its body is small.

### What we don't know yet
- Exact granularity of sensors/integrators (need a small spike to see what feels right)
- Whether Effect-TS Layer composition cleanly maps to the three tiers (likely yes, but worth proving)
- Whether the strategy abstraction (5 reasoning strategies) stays the right top-level shape, or whether strategies become specific (sensors, integrators, arbitrator, effectors) tuples directly

---

## Part 7 — How to validate this is right BEFORE committing

The user's principle is "facts only, not should/could." So:

**Validation step 1 — paper prototype on the failure corpus.**

Take the 8 corpus scenarios. For each, write down:
- What sensors would fire
- What integrators would aggregate
- What verdict the arbitrator should produce
- What effector would run

If the answers are short, unambiguous, and produce the correct boolean for all 8 scenarios, the architecture is right *for this corpus*. If we have to add ad-hoc rules to make scenarios pass, the architecture is wrong.

**Validation step 2 — trace re-architect on one scenario end-to-end.**

Pick `failure-rate-limit-loop`. Re-implement just its kernel iteration cycle in the new architecture (~500 LOC, throwaway). Run it. If status correctly becomes `failed` *and* the code is shorter than today's path, the pattern works. If we end up writing as much code with as much branching, the pattern is over-engineered.

**Validation step 3 — talk to the corpus runs.**

Run cogito:14b on the new architecture for the corpus, N=3. Aggregate the median:
- Correct booleans: target ≥ 7/8 (vs today's 5/8)
- Run-to-run variance: target ≤ 2× (vs today's 5×)
- Wall time per scenario: target ≤ 90% of today's median

Numbers ≥ these → architecture is delivering. Numbers below → we have new evidence about what the architecture is missing.

**Only after all three validations should we commit to the full refactor.** This is the empirical discipline the diagnostic loop demands.

---

## Part 8 — Decision points for you

Read this as a frame, not an answer. Three decisions I want your read on:

1. **Is the three-tier (sensors/integrators/arbitrator/effectors) target the right shape?** Or do you see a different decomposition that maps biology more accurately?

2. **Should we build the validation steps (paper prototype + single-scenario rebuild) first, or is the diagnostic evidence strong enough to commit to the refactor and let it emerge?** I lean toward validation-first per the lesson from CHANGE A — but it adds ~3-4 days before any production code lands.

3. **What's the correct unit of refactoring?** A single 6-week branch makes architecture coherent but is risky. Ten PRs of 300-500 LOC each lets us measure each step but stretches the timeline. I think 10 PRs is right; you may have a different intuition.

This is the architectural equivalent of the diagnostic methodology we proved this morning: define the target, validate empirically, commit only what the evidence supports. No more "should." Only "the corpus moved from X to Y, the gate scenarios pin it, here's the next step."
