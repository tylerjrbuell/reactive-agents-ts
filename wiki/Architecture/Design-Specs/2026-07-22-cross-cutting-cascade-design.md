# Cross-Cutting Cascade — design spec

**Date:** 2026-07-22
**Status:** APPROVED direction (owner, 2026-07-22) — amended same day after adversarial self-review (§12); plan next
**Authority:** subordinate to [[../Specs/09-UNIFIED-PROGRAM|09 — The Unified Program]]. Implements convergence ruling **C3 (one trust spine)** and consumes **C1 (one event store)**, which landed as Wave C.1 on 2026-07-22.
**Supersedes:** nothing. Amends the open `CrossCuttingInput` enforcement gap noted in `kernel/state/build-kernel-input.ts:80`.

---

## 1. The problem, stated as a defect class

A cross-cutting harness feature added today must be named by hand at N sites. Miss one and the feature is silently absent — accepted by the builder, forwarded by the engine, discarded before it reaches its consumer. No error, no warning, no test failure.

This is not a hypothesis. It is the root cause of every P0 shipped in the last four days:

| date | defect | boundary that dropped it |
|---|---|---|
| 2026-07-22 `fe5dc93b` | HITL approval gate bypassed on 7 of 8 strategies | strategy → `KernelInput` |
| 2026-07-22 `d6f8ef15` | paused run served from semantic cache; `approveRun()` a no-op | wither enables hidden subsystem |
| 2026-07-22 `8e5f49e6` | `OLLAMA_HOST` ignored; capability probe hit localhost | 4 sites read one env var |
| 2026-07-22 Wave C.1 | `runLedger` died before reaching the trust receipt | `ReasoningResult.metadata` → `TaskResult.metadata` |

Boundary-first doctrine says the second instance of a class fixes the boundary. This is the fifth.

### 1.1 Live, unshipped instances of the same class

Measured 2026-07-22 by direct grep, not inferred:

`reactive.ts` is the **only** strategy that reads `grounding`, `fabricationGuard`, and `stallPolicy` into `KernelInput`.

| strategy | `grounding` | `fabricationGuard` | `stallPolicy` | `taskContract` |
|---|---|---|---|---|
| `reactive` | ✅ | ✅ | ✅ | ✅ |
| `adaptive`, `blueprint` | ✅ inherited (delegate to `executeReactive`) | ✅ | ✅ | ✅ |
| `reflexion`, `tree-of-thought`, `direct` | ✗ | ✗ | ✗ | ✗ |
| `plan-execute`, `code-action` | ✗ | ✗ | ✗ | deny-list only, no terminal gate |

`reasoning-think.ts:333-341` forwards all four to whichever strategy runs. The strategies simply do not declare them.

**User-visible consequence, stated plainly:** on `reflexion`, `tree-of-thought`, `direct`, `plan-execute`, and `code-action`, the calls `.withFabricationGuard()`, `.withGrounding()`, and `.withStallPolicy()` are accepted, forwarded, and silently discarded. The user configures a safety guard and does not get one. `.withContract()` reaches three strategies as a forbidden-tools list only; the terminal contract gate never runs there.

Additionally, `reflexion` and `tree-of-thought` build a `CrossCuttingInput` bundle that omits 12 of its 26 fields (`providerName`, `requiredToolQuantities`, `maxCallsPerTool`, `environmentContext`, `allowedTools`, `toolElaboration`, `nextMovesPlanning`, `observationSummary`, plus the four above).

### 1.2 Why the existing boundary does not hold

`build-kernel-input.ts` was built (FM-I / GH #195) to be exactly this boundary, and its own docstring records why it fails:

> "The `Pick`-derived fields are all OPTIONAL on `KernelInput`, so omitting one from a bundle is silently legal — the compile-error promise in this file's header only holds for fields a caller cannot leave out."

It enforces 3 of 26 fields (the HITL rails, made required-but-nullable after `fe5dc93b`). Adoption is 2 of 8 strategies.

### 1.3 The three hand-enumerated re-projections

The class is not confined to strategies. A run's configuration is re-projected by hand three times:

| # | boundary | site | how a field dies |
|---|---|---|---|
| 1 | runtime config → strategy input | `packages/runtime/src/engine/phases/agent-loop/reasoning-think.ts` ~300-345 | strategy input interface does not declare it |
| 2 | strategy → `KernelInput` | 6 entry points (below) | bundle literal omits it |
| 3 | `ReasoningResult.metadata` → `TaskResult.metadata` | `packages/runtime/src/execution-engine.ts` ~1295-1335 | not enumerated in the literal |

Boundary 3 is already recorded in `DEBT-REGISTER.md` §3: *"Any future `extraMetadata` field silently dies at that boundary unless explicitly enumerated there — pre-existing precedent (`reasoningSteps` / `receiptToolCalls` / `confidence` / `runLedger` all had to be added by name)."*

---

## 2. Why the obvious fixes are wrong

### 2.1 "One funnel — force every strategy through `runKernel`"

There are six entry points into execution:

| strategy | entry |
|---|---|
| `reactive` | `runPass(reactKernel, …)` |
| `reflexion` | `runPass` + `buildKernelInput` |
| `tree-of-thought` | `runKernel` + `buildKernelInput` |
| `direct` | `runKernel` + hand-built literal |
| `adaptive`, `blueprint` | delegate to `executeReactive` |
| `plan-execute` | `executeReActKernel` (composite steps) · `executeToolAndObserve` (tool steps) · `gatewayComplete` (analysis steps) |
| `code-action` | `gatewayComplete` + sandboxed program |

Collapsing these is not possible without destroying capability:

- **`code-action` cannot be a kernel loop.** Its actuation is an LLM-generated TypeScript program executed in a Worker sandbox, performing N tool calls with arbitrary control flow inside one turn. The kernel's model is one tool call per iteration. Absorbing it means deleting the strategy.
- **`plan-execute`'s cheap leaves exist on purpose.** `tool_call` steps dispatch with no LLM call; `analysis` steps make one LLM call with no tools. Forcing them through a ReAct loop is a token and latency regression on the strategy built to avoid ReAct overhead.

Estimated cost ~2,500 lines across the two most complex files, with capability loss and a performance regression — and the debt register would read "fixed."

### 2.2 "Declare the gaps and move on"

Cheaper (~600 lines), but `unsupported: ["fabricationGuard"]` on `plan-execute` makes the hole official and permanent. A user selecting `plan-execute` still loses the guard, with a nicer error. This documents the class instead of closing it.

### 2.3 "Ambient config at the seams"

Better, but incomplete on its own: each execution path still has to *implement* the check (`if (envelope.fabricationGuard) …`). Adding a cross-cutting feature still edits every consumer. Necessary, not sufficient.

---

## 3. The design: three universal boundaries, judgment split from repair

### 3.1 The measurement this rests on

Every strategy already crosses three primitives. Adoption measured 2026-07-22:

| boundary | primitive | adoption |
|---|---|---|
| LLM | `kernel/llm-gateway.ts` → `gatewayComplete` | 8/8 strategies + kernel |
| tool | `kernel/capabilities/act/tool-observe.ts` → `executeToolAndObserve` / `evaluateToolPolicy` | 8/8 |
| terminal | `kernel/capabilities/sense/step-utils.ts` → `buildStrategyResult` | 8/8 |

The **loop** is the only non-universal boundary — `plan-execute`'s tool/analysis leaves and `code-action`'s sandbox have no iteration to hook.

The terminal boundary already enforces two cross-cutting invariants, and its docstring already states the doctrine:

> "Supplying it forwards the durable pause rails automatically — see `pauseRailMetadata` for **why this must not be left to each strategy**."

The pattern is proven in-place. It was never generalized.

### 3.2 The split

**Judgment — at the terminal boundary. Universal, un-bypassable.**

`buildStrategyResult` evaluates the compiled `RunContract` against the `RunLedger` and produces a verdict. Fabrication guard, grounding sufficiency, contract satisfaction, deliverable honesty.

This requires **zero cooperation from the execution path**. It judges evidence after the fact. A strategy cannot return a `ReasoningResult` without crossing it. Adding a new judgment touches one file and covers all 8 strategies permanently.

This is C3 — evidence (ledger) → decision (gate) → record (receipt). Wave C.1 made the ledger universal across all strategies on 2026-07-22, which is what makes the evidence side available here. This spec is the payoff for that work.

**Repair — at the actuator seams. Ambient.**

Concerns that must act *before* the fact, and therefore cannot be terminal:

| concern | seam | universal? |
|---|---|---|
| HITL approval (must pause before the tool runs) | tool | ✅ |
| tool policy / forbidden tools | tool | ✅ |
| prompt/context shaping, calibration, budget class | LLM | ✅ |
| grounding **redirect** (retry with a hint) | loop | ✗ |
| stall nudge / no-progress steering | loop | ✗ |

Carried as an Effect service — `RunEnvelope` — provided once by the runtime and read by the seams. Strategies never accept, declare, or forward these fields.

### 3.3 The invariant this buys

> **A strategy cannot drop a cross-cutting concern, because it never carries one.**

And for the one non-universal boundary:

> **A path missing loop-scoped repair degrades to more expensive, never to unsafe** — the terminal boundary still judges it.

That inverts today's failure mode. Today, a missing field means the guard does not exist. After this, a missing loop hook means the guard fires later and costs more tokens.

### 3.4 What this does NOT fix

Stated so the register does not over-count:

- `plan-execute` and `code-action` get no **per-iteration** repair (grounding redirect, stall steer). They are judged at the terminal, not repaired per-step. **The gap is narrower than "no loop to hook" (amendment #5):** both have coarser loops — plan-execute's refinement loop (`plan-execute.ts:632`) and wave loop (`:708`), code-action's plan→execute→reflect cycle — and repair checks can later be hosted at those phase boundaries without kernel absorption. Spec the gap as "per-iteration repair, narrowable via phase-boundary hooks," declared and tested — the test pins that the gap is *reported*, it does not defend the gap as permanent.
- Terminal judgment can only reject, not repair. A run rejected at the terminal has already spent its tokens; on the two non-kernel strategies a guarded run can cost *more* than an unguarded one (full run + verdict) and still fail. That is the honest price of un-bypassable judgment — mitigated where the coarse loops allow phase-boundary early exit.
- Ambient context is implicit: absent from call signatures, and tests must provide the layer (§4.2b contains the worst case).
- Boundary 3 (`TaskResult.metadata`) is a *projection* problem, not a config problem. It gets a different fix (§4.3).

---

## 4. Components

### 4.1 `RunEnvelope` — the run-wide cross-cutting carrier

A `Context.Tag` service holding every run-wide field currently threaded through strategy inputs. Provided once, in `reasoning-think.ts`, from `ReactiveAgentsConfig`. Read by the three seams.

Strategy input interfaces **drop** these fields entirely. The `StrategyHitlRails` interface and the HITL half of `CrossCuttingInput` are targeted for deletion — the rails move into the envelope; the final planning pass decides whether any thin local alias survives migration.

`CrossCuttingInput` / `buildKernelInput` survive for genuinely kernel-shaped per-run input (task, prompts, tool schemas). Fields that move to the envelope are removed from it, shrinking it rather than making all 26 required.

### 4.2 The terminal verdict — structurally un-bypassable

`buildStrategyResult` gains a verdict step: read the `RunContract` and `RunLedger` from the envelope + params, evaluate, and stamp the result. Existing invariants (HS-106 output/status coherence, pause-rail forwarding) become the first two entries in that verdict chain rather than ad-hoc code.

Reuses `kernel/contract/run-contract.ts` and the existing `verifier.ts` grounding/fabrication logic — this relocates enforcement, it does not write a second implementation.

**Branded result (amendment #1).** "Un-bypassable" must be a compiler fact, not a grep-gate promise — a strategy has many exits (early `return executeReactive(...)`, catch paths, pause paths), and spot-checking that the primitive "is called somewhere" is exactly the shape of the original defect one level up. Therefore `ReasoningResult` is **branded**: its constructor is unexported and `buildStrategyResult` (plus its pause/failure siblings in `step-utils.ts`, which route through the same verdict chain) is the only mint. Any code path that builds a result literal fails to typecheck. Same move as `ValidatedObservation`'s `_validated` discriminator — already proven in this codebase.

### 4.2b Single provision site (amendment #2)

`RunEnvelope` is provided in **exactly one place**: `reasoning-think.ts`. The gate script bans `provideService(RunEnvelope` / `RunEnvelope.of(` anywhere else. Seams declare the envelope in their Effect `R` channel, so a future execution path that calls a seam without provision is a compile error, not a runtime `Context` miss. The residual risk — a helper that erases `R` too early — is contained by the single-provision rule being grep-able.

### 4.3 Boundary 3 — typed metadata projection (amendment #4)

Neither allow-list nor deny-list. The hand-enumerated allow-list silently *loses* useful fields (`reasoningSteps`, `receiptToolCalls`, `confidence`, `runLedger` each had to be added by name); a naive pass-through-with-deny-list inverts that into silently *leaking* internal fields to the public API surface — a worse failure mode (API-stability + info-leak beats field loss).

Instead: `TaskResultMetadata` becomes a **real schema** with an explicit, typed extension slot for strategy-contributed fields. A new field arrives by extending the type — visible in review, compile-checked, no silent loss, no silent leak. The engine's projection becomes a typed map, not a literal.

Closes the `DEBT-REGISTER` §3 row directly.

### 4.4 The gates

No fix is done without a gate (Program invariant §6).

1. **`scripts/check-cross-cutting.sh`** — fails if: any strategy input interface declares an envelope field; a raw `KernelInput` object literal appears outside `build-kernel-input.ts`; or `provideService(RunEnvelope` / `RunEnvelope.of(` appears outside `reasoning-think.ts` and test layers (§4.2b).
2. **The branded type** (§4.2) — the primary gate. Constructing a `ReasoningResult` outside the terminal mint is a compile error; return-path coverage is total by construction, not by grep.
3. **Red-on-cut tests** — for each of the four withers, a test that runs a *non-reactive* strategy with the wither set and asserts behavior changes. Cutting the threading must turn the test red.
4. **Declared-gap test** — asserts `plan-execute` / `code-action` report their per-iteration-repair gap, so the gap cannot become silent again (it pins *reporting*, not permanence — §3.4).
5. **Boundary-3 test** — a new typed metadata field contributed by a strategy must appear on `TaskResult.metadata` with no engine literal edit; an internal-only field must not.

---

## 5. Data flow

```
builder (.withFabricationGuard, .withGrounding, .withContract, .withApprovalPolicy, …)
  └─► ReactiveAgentsConfig
        └─► reasoning-think.ts ──── provides ───► RunEnvelope (Effect service)
                    │                                    │
                    ▼                                    │ read ambiently
              strategy (8)                               │
                    │                                    │
     ┌──────────────┼──────────────┐                     │
     ▼              ▼              ▼                     │
gatewayComplete  executeTool-   [loop, where one]  ◄─────┘
   (LLM)          AndObserve      exists
                   (tool)
     └──────────────┴──────────────┘
                    │
                    ▼  every strategy, no exceptions
           buildStrategyResult
                    │
                    ├─ evaluate RunContract vs RunLedger  ── judgment
                    ├─ HS-106 output/status coherence
                    ├─ pause-rail forwarding
                    ▼
             ReasoningResult
                    │  pass-through + deny-list  (boundary 3)
                    ▼
              TaskResult
```

Control re-enters as ledger entries only — the meta-loop DAG stays one-directional (Program invariant §6).

---

## 6. Error handling

- **Envelope missing at a seam** — a defect, not a runtime condition. Effect's `Context` makes it a compile-time requirement; a seam cannot be called without it.
- **Verdict rejects a run** — the run terminates with the existing abstention/failure path (`no_substantive_output`, `model-abstained`) and the honest rendering shipped in `fe1ef444`. No new terminal reason.
- **Contract compilation fails** — degrades to no contract requirements, logged. A malformed `.withContract()` must not crash a run.
- **Loop-scoped concern on a path with no loop** — no error. Recorded on the result as a declared gap, judged at the terminal.

---

## 7. Testing strategy

Per `agent-tdd`: every behavioral change is red-on-cut before it is green.

| layer | test |
|---|---|
| envelope | provided once, read at all three seams; a seam call without it is a compile error |
| judgment | each wither, on each non-reactive strategy, changes outcome; cut the wiring ⇒ red |
| declared gap | `plan-execute` / `code-action` report loop-scoped gaps; adding a silent one ⇒ red |
| boundary 3 | novel `extraMetadata` key survives to `TaskResult` with no engine edit |
| gate script | a strategy interface that declares an envelope field ⇒ script exits non-zero |
| regression | full suite (8,294 tests) + `turbo run build --force` then `turbo run typecheck --force` |

**CI parity:** structural tests use the `test` provider; no test may require API keys or a reachable Ollama.

---

## 8. Rollout risk

This is a **behavior change, not a refactor**. Strategies that today silently skip the fabrication guard will begin failing runs they previously passed — which is the point.

**Enforcement sequencing (amendment #3 — the lift rule does not apply here).** The lift rule governs **default-on** changes. All four withers are **opt-in**: the user explicitly called `.withFabricationGuard("block")` / `.withGrounding(...)` / `.withStallPolicy(...)` / `.withContract(...)`. Honoring an explicitly requested guard is a **bug fix**, not a default change — it needs correctness probes, not a 150-run/arm lift campaign:

1. Land the cascade with the verdict computed and recorded on every result.
2. Verify mechanism with the deterministic trap cells (`scoreAbstention`, zero API tokens) per strategy: wither set ⇒ behavior changes; wiring cut ⇒ test red.
3. **Enforce immediately for opt-in users on all 8 strategies.** No configured wither ⇒ verdict stays informational; zero behavior change for users who set nothing.
4. Any future *default-on* proposal for a wither goes through the lift rule + ablation-warden veto as usual.

Per `feedback_bench_bernoulli_underpowered`: a mechanism confirmation is not a lift claim, and no bench-scoring change lands mid-run.

---

## 9. Open questions — RESOLVED (2026-07-22 review)

- `RunEnvelope` is **one service** with two named sub-records (`policy` for judgment inputs, `rails` for repair inputs). A split into two services reinvents this defect class at the join.
- `direct.ts` **opts in**. Minimalism is how it silently lost all four guards; "minimal" describes its per-pass features, not its safety surface.

---

## 10. Success criteria

1. A new cross-cutting concern is added by editing the envelope and one seam. **Zero strategy files touched.** Verified by adding one during implementation.
2. `.withFabricationGuard()`, `.withGrounding()`, `.withStallPolicy()`, `.withContract()` demonstrably change behavior on all 8 strategies, or report a declared, tested gap — **enforced for opt-in users at ship time**, not deferred behind a bench campaign (§8).
3. Constructing a `ReasoningResult` outside the terminal mint fails to compile (branded type verified by a `@ts-expect-error` witness test).
4. `check-cross-cutting.sh` is wired into CI and fails on a reintroduced drop or a second envelope provision site.
5. A new typed metadata field reaches `TaskResult.metadata` with no engine literal edit; internal-only fields do not leak.
6. Suite green; `turbo run build --force` then `turbo run typecheck --force` green.

---

## 12. Why now — the Phase 7 connection

09-UNIFIED-PROGRAM's finale is **Phase 7: Strategy→Policy** — strategies compiled into policies (C6's kernel-side movement). That is unreachable while a strategy is 1,100 lines of bespoke plumbing. After this work a strategy's only remaining content is composition logic — reflexion is "pass, critique, pass again"; ToT is "branch, score, execute best." Policies can only compile what plumbing-free strategies express. This spec is the structural prerequisite for the program's endgame, over and above closing the live defect class.

Supporting evidence from the codebase's own natural experiment: the two strategies that never drifted through a month of defect waves are `adaptive` and `blueprint` — the two that *delegate* instead of re-implementing. Delegation-inheritance is the only pattern here that has survived contact with time; this design generalizes it. Independently, `plan-execute`'s step-executor converged on the same three leaf kinds (`tool_call` / `analysis` / `composite`) as the three universal seams — the algebra was already discovered in-code before it was named here.

---

## 11. Related

- [[../Specs/09-UNIFIED-PROGRAM]] — C1 (consumed), C3 (implemented)
- [[../DEBT-REGISTER]] — §3 metadata-boundary row (closed by §4.3)
- [[2026-07-22-c1-equivalence-invariant]] — the containment invariant this builds on
- `packages/reasoning/src/kernel/state/build-kernel-input.ts:80` — the gap this closes
