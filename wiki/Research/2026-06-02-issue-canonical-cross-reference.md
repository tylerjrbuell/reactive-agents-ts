---
title: Issue ↔ Canonical Redesign Cross-Reference (2026-06-02)
date: 2026-06-02
status: synthesis — current state snapshot
purpose: Map every open GH issue + wiki blocker to the canonical-redesign Root Cause (RC) / Workstream (WS) that solves it at the structural seam, or honestly call it out as orthogonal.
inputs:
  - 57 open GH issues (snapshot 2026-06-02)
  - wiki/Issues/Running Issues Log.md (1 open: #4 ToT outer loop)
  - wiki/Architecture/Design-Specs/2026-05-28-canonical-architecture-model.md (the structural target)
  - wiki/Planning/Implementation-Plans/2026-05-28-canonical-refactor.md (RC + WS sequence)
  - wiki/Research/Harness-Reports/sprint1-canonical-collapse/baseline-2026-06-02.md (perf evidence)
  - git log main since 2026-05-28 (Sprint-1 in-flight)
git-state:
  branch: main
  head: 5e08d78e (Sprint-1 exit gate)
  sprint-1-shipped: [A2 RA_ASSEMBLY flag deleted, A3 defaultContextCurator deleted, A4 RA_POST_CONDITIONS flag deleted, B1-B3β TaskContract + DeliverableProvenance + Capability/tier table, #7 PostCondition spine default-on, project() canonical context assembly]
---

# Issue ↔ Canonical Redesign Cross-Reference

> **One sentence.** The canonical redesign addresses ~25 of the 57 open issues at the structural root; the remaining ~32 are orthogonal roadmap / Phase-1.5 / Phase-C-G work the redesign deliberately does not touch — so most of the open backlog lives outside the redesign.

---

## 0. Headline Numbers

| Bucket | Count | What it means |
|---|---|---|
| **Already closed since 2026-05-23** | **24** | 20 harness-convergence (#104–#122 + #126; #104 closed-invalid) + 4 sweep-05-27 closed. Verified via `gh issue list --state closed --search "label:sweep-2026-05-23"`. |
| **Solved-at-root by canonical redesign** | **25** | Open issues mapped to one of RC-1..5 or convergence Phase 3. The WS eliminates the *mechanism*, not just patches the symptom. Counted from §1+§2 tables (23 RC + 2 convergence-only). |
| **Orthogonal (roadmap/feature/gate)** | **32** | Phase 1.5 mechanisms (4) + Phase C-G features (17) + trackers + help-wanted (9) + test debt (2). Redesign is silent on these by design (`05-28-canonical-refactor §0.2`). |
| **TOTAL open** | **57** | Snapshot 2026-06-02. 25 + 32 = 57 (clean partition). |

**Reality check on "highly performant":** Sprint-1 baseline (`baseline-2026-06-02.md`) shows the canonical `project()` arm wins decisively on LOCAL tier (+17pp acc, +23pp reliability), wins acc but loses reliability on MID (-23pp, +63% tokens), and loses acc on FRONTIER summarize (33%→0%). The redesign is structurally correct; perf is a tradeoff-with-open-regressions, not a settled win. WS-6+ decomp + Sprint-2 honesty contracts are pre-conditions for any "performant" claim.

---

## 1. The 5 Root Causes (canonical-refactor §3.4) — Open Issues Per RC

### RC-1 — Mutation-chain Layer composition (WS-2)

**Mechanism:** `runtime.ts` builds via 40× `runtime = Layer.merge(runtime, X) as ComposableLayer` instead of one terminal `Layer.mergeAll([...layers])`. 44 cast points where there should be 1. The pattern leaks into facade casts (`this as any` at handoff sites) and missing discriminated unions on public types.

**WS-2 closes these (mechanical refactor, mirror `createLightRuntime` shape):**

| GH | Title | How RC-1/WS-2 solves at root |
|---|---|---|
| **#167** P1 | runtime.ts uses Effect as service locator — RuntimeAssembly + Layer.mergeAll eliminates 38 Layer.merge + 64 ComposableLayer casts | THIS IS the named WS-2 deliverable. Refactor `createRuntime` to mirror `createLightRuntime` ([runtime.ts:1061](packages/runtime/src/runtime.ts)): collected array + 1 terminal `mergeAll`. |
| **#163** P1 | Public AgentEvent union not narrowing on _tag — 13+ casts in cortex/ui | WS-2 co-located fix per `canonical-refactor §3.4 RC-1`: discriminate AgentEvent on `_tag`. 13 casts disappear when the type narrows. |
| **#151** P1 | ReactiveAgent Gateway helpers cast `this as any` | WS-2 §6.5 F6 finding: 2 sites + 1 `ReactiveAgentInternalView` interface. Mechanical. |
| **#91** P2 | runtime/types.ts + builder/types.ts coupling hotspot — 360+ inbound imports | WS-2 untangles seam types in the same pass. Coupling drops as type erasure boundary moves to one site. |
| **#93** P2 | runtime-construction.ts:337 passes focusedTools to RuntimeOptions literal that doesn't declare it | Hidden by `as any` widening today. WS-2 typed seam surfaces it; either add field or remove call. |

### RC-2 — Kernel mesh has cycles + `act/` monolith conflates capability + tool substrate (WS-3)

**Mechanism:** `act/` directory (3053 LOC) mixes the Act capability (`act.ts` + `guard.ts`, ~1495 LOC) with tool substrate (`tool-execution.ts` + `tool-parsing.ts` + `tool-gating.ts` + `tool-capabilities.ts`, ~1558 LOC, 9 cross-capability inbound). The "leaf principle" is unenforced because no separation exists between "capability" and "primitives capabilities consume."

**WS-3 closes these (extract tool-* → `kernel/substrate/tools/` per architecture-model §2.4):**

| GH | Title | How RC-2/WS-3 solves at root |
|---|---|---|
| **#169** P1 | Kernel capabilities form a mesh with 21 cross-edges + 7 cycles | First-hand audit corrected: 38 edges, 3 cycles. 9 of 38 disappear when tool-* moves to substrate. Leaf principle becomes lint-enforceable. |
| **#77** P2 | HS-20: Seven secondary files >800 LOC | plan-execute.ts (1554), event-bus.ts (1347), think.ts (1283), act.ts (1137), llm-provider/types.ts (1063), arbitrator.ts (992), console-exporter.ts (895) — WS-6 decomp restoration after WS-3 collapses the conflated dirs. |

### RC-3 — Scaffold without callers (WS-4)

**Mechanism:** No enforced ship-time invariant that every declared surface element has a live emit + consumer in the same commit. Architecture-model §9 (Emit/Consume Contract) is the canonical law; WS-4 enforces it via CI lint.

**WS-4 closes these (CI lint: every TagMap/ControllerDecision/Registry/calibration field has emit + consumer site):**

| GH | Title | How RC-3/WS-4 solves at root |
|---|---|---|
| **#170** P1 | @reactive-agents/observe + 5 M12 LocalProviderAdapter hooks — no internal callers | THE named anti-scaffold finding. WS-4 disposition: wire or delete. 301 LOC observe pkg + 270 LOC M12 hooks decide one way or the other. |
| **#160** P1 | confidenceFloor killswitch documented but unshipped 2026-05-19 | Doc references a dead killswitch — re-add risk for fresh agents. WS-4: either ship or strike from AGENTS.md / killswitch catalog. |
| **#154** P1 | HITL example calls agent.onApprovalRequest — method does not exist | Surface example references absent method = anti-scaffold instance. WS-4: align example or implement the method per `interaction/` Pillar contract. |
| **#155** P1 | Surface test gaps: observe exporters, vue package, health pkg, umbrella | Closely tied to #170. Any surface kept must have ≥1 caller AND ≥1 test. WS-4 ships emit+consume invariant + WS-6 ships surface coverage. |
| **#153** P2 | Dead public exports: validateRationale/isRationale/Rationale in @reactive-agents/trace | Direct dead-surface; delete in WS-4 sweep. |
| **#84** P2 | HS-28: 4 @internal OpenAI exports leak through public src/index.ts barrel | Surface-discipline cleanup; aligns to architecture-model §8.4 (publish a Tag iff ≥2 consumers, otherwise keep local). |
| **#79** P2 | HS-23: 4 TODO comments on live code paths — wire or remove | Same anti-scaffold instinct (declared-intent without delivery). WS-4 wires or strikes. |
| **#78** P2 | HS-21: Sweep 5 stale @deprecated annotations (v0.11 targets past) | WS-4 prune cycle — remove deprecated-by-vNothing surfaces. |

### RC-4 — Honesty debt (silent error swallow + lying state) (WS-5)

**Mechanism:** Effect-TS error channel used as `unknown` instead of a tagged-error algebra. Swallow happens at *type level*, not just code level. `console.warn` bypasses ObservabilityService. Lying comments diverge from `.catch(() => {})` behavior.

**WS-5 closes these (tagged-error algebra + active ceiling tests):**

| GH | Title | How RC-4/WS-5 solves at root |
|---|---|---|
| **#168** P1 | 105 Effect<X, unknown> sites — silent swallow at type level; tagged-error algebra needed | THE named WS-5 deliverable. Re-baselined ≤20 AST-counted floor + `no-silent-swallow-floor.test.ts` ceiling (`canonical-refactor §5.5a`). |
| **#152** P1 | Honesty-pass: 3 silent-error sites diverge from established convention | WS-5 Phase 2/3 — route all swallow through `emitErrorSwallowed` convention or kill the swallow. |
| **#157** P2 | memory-service bootstrap: 4 swallow sites missing emitErrorSwallowed convention | Same WS-5 sweep, memory package scope. |
| **#166** P2 | MetricsCollectorTag not wired in test Layers — WARN noise may mask prod under-counting | Adjacent symptom: test-layer hygiene part of WS-5 honesty discipline. |
| **#158** P2 | playground.ts reads private _lastDebrief via (agent as any) cast | RC-4 surface-lie: private state shows as public. Architecture-model §11 fluent-API discipline. Solved when `AgentResult.debrief` public + the cast goes away (#162 in plan §3.5 RC-1). |
| **#164** P1 | create-reactive-agent template ships `as any` cast in scaffolded user code | Same shape — template propagates a lie to every new user repo. WS-5 + WS-2 together fix the source contract; template change is one-line then. |

### RC-5 — Release flow integrity (WS-1)

**REVISED**: Release flow works in steady state per `canonical-refactor §3.4 RC-5 revised`. Workspace pkg.json lag is intentional design (VERSION as single source-of-truth). Residual issues are 4 small fixes, not structural.

| GH | Title | How RC-5/WS-1 solves at root |
|---|---|---|
| **#165** P2 | Orphan v0.10.7 draft GH release with no git tag — release-drafter residue | Trivial delete + investigate why release-drafter ran (likely removed config residue from May 2026 cleanup). |

**Note:** WS-1 also ships F2/F3/F4 fixes (typecheck RED in verification tests, judge-server private flag, release.ts ordering). These are not currently filed as GH issues — they were surfaced in the release-warden audit and live in the plan only.

---

## 2. Convergence Phase 3 — Compounding Intelligence (WS-7)

The last 3 open harness-convergence issues. NOT solved at root by the canonical-architecture-model directly — they are explicitly Pillar 8 "Compounding Intelligence" work that the model enables but does not implement.

| GH | Title | Relation to canonical model |
|---|---|---|
| **#123** P3 | [convergence 3.1] Single Arbitrator (E1) | Architecture-model §5 *already declares* single-owner arbitrator. WS-3 makes it structurally enforced via lint. #123 = ship the lint + sweep residual writers. |
| **#124** P3 | [convergence 3.2] Composite confidence signal (I1) | Architecture-model §5.3 lists 6 canonical signal categories; the composite is the §5 evaluator aggregation work. Solved-at-design; ships as evaluator. |
| **#125** P3 | [convergence 3.3] Capability composition routing (I4) | Enabled by WS-4 §10.2 `HarnessProfilePatch → Partial<Record<RegisteredCapabilityName, boolean>>` generalization. Routing logic ships on top of the generalized patch type. |

---

## 3. Sprint-1 In-Flight: Already Shipping Canonical Structural Seams

The canonical model is not theoretical — Sprint-1 already shipped pieces of it visible in `git log main --since=2026-05-28`:

| Commit | What it implements from canonical model |
|---|---|
| `7b0a089b` phase-a: 7 root-cause fixes + canonical-contracts spec | First pass at architecture-model §4 state contract |
| `6f7bfaf2` Sprint-1 B1 — TaskContract type + bench-task migration | Typed TaskInput per architecture-model §7.2 StrategyContext |
| `b5e32880` Sprint-1 B2 — DeliverableProvenance typed channel | RC-4 anti-honesty-debt: every output traces to its source |
| `92db01bc` Sprint-1 B3α — Capability type + tier table | Architecture-model §6 capability boundary contract + §14.2 tier defaults |
| `099b1b5e` Sprint-1 B3β — resolveCanonical adapter | Single resolution path (architecture-model §3 canonical-shape pattern) |
| `278ad70b` Sprint-1 A2 — delete RA_ASSEMBLY flag | RC-3 closure: project() canonical, no shadow path |
| `c378696b` Sprint-1 A3 — delete defaultContextCurator + curate() module | RC-3 closure: legacy curator removed; one-path assembly |
| `82f53cca` Sprint-1 A4 — delete RA_POST_CONDITIONS flag | RC-3 closure: PostCondition spine unconditional |
| `2c9cb155` fix(kernel): #7 postConditions seed default-on — terminal honesty gate | Mission Invariant 2 (`status=failed → output=null`); architecture-model §13.3 honest-fail invariant |
| `bc5737a1` feat(verify): FLIP RA_POST_CONDITIONS default-on | Architecture-model §13 multi-severity verifier with state-grounded done |

**Implication:** the canonical model is being *executed*, not just authored. The cross-reference is therefore a *current state* document, not a *future state* roadmap.

---

## 4. Orthogonal Bucket — NOT Solved by Canonical Redesign

These are roadmap/feature/gate work. The canonical refactor deliberately does NOT address them (per `canonical-refactor §0.2`: "A new architecture proposal" is explicitly NOT what this plan is).

### 4.1 Phase 1.5 mechanism work (M-series — separate validation gates)

| GH | Phase | Topic |
|---|---|---|
| #41 | 1.5 | M7: wire ≥8 calibration consumers |
| #42 | 1.5 | M8: sub-agent delegation 10-scenario bench |
| #43 | 1.5 | M10: memory multi-session + Tier-2 semantic search |
| #44 | 1.5 | M14: composeNarrowRetry self-evolution |

### 4.2 Phase C-G feature gates and roadmap items

| GH | Phase | Topic |
|---|---|---|
| #30 | C | Replay E2E determinism integration test |
| #31 | C | Langfuse exporter for @reactive-agents/observe |
| #32 | C | Braintrust exporter for @reactive-agents/observe |
| #33 | C | OTel sampling + ReasoningStepCompleted nesting |
| #34 | D | code-action: real LLM benchmark vs reactive on qwen3:14b |
| #35 | D | code-action: audit Effect.runPromise in Worker callbacks |
| #36 | D | Promote code-action from experimental → GA |
| #37 | C | create-reactive-agent: multi-agent template |
| #38 | C | Add Named Users section to README |
| #45 | D | Phase D gate: code-action vs reactive on qwen3:14b |
| #47 | E | Tool-result paging — 50KB/200KB caps with disk spill |
| #48 | E | Phase E gate: qwen3:14B ≥30% of frontier on τ-bench retail |
| #49 | F | τ²-bench retail integration with reproducible methodology |
| #50 | F | Publish reproducibility doc for benchmarks |
| #51 | G | Re-run every Phase A–F gate on integrated codebase |
| #52 | G | Rewrite README — only validated state |
| #53 | G | Snapshot/Replay determinism re-validation |

### 4.3 Tracking issues + help-wanted

| GH | Type | Topic |
|---|---|---|
| #61 | tracker | v0.11.0 — Known issues tracker |
| #62 | tracker | Roadmap — Phase C → G milestone tracker |
| #54-#60 | help-wanted | Cohere/Mistral providers, Cloudflare Workers template, JSON schema, error messages, Snapshot/Replay test, maxTokens killswitch |

### 4.4 Test debt — addressed by WS-5b ceiling tests, not by canonical model

| GH | Topic | Resolution path |
|---|---|---|
| #87 | HS-31: 55 `as unknown as` casts in tests | WS-5b ceiling test `as-unknown-as-ceiling.test.ts` already shipped (≤67 floor, ratchet down over time) |
| #156 | Provider completeStructured duplicated schema-clone across 3 providers | Mostly orthogonal — provider hygiene; could ride WS-2 if scope permits |

---

## 5. Wiki-Local Open Issue

| Source | Issue | Status |
|---|---|---|
| `wiki/Issues/Running Issues Log.md` | Issue #4: ToT outer loop doesn't honor dispatcher-early-stop | Open — Phase 2 work; not solved by current canonical refactor (strategy refactor work, architecture-model §7.4 ≤200 LOC strategy ceiling). |

---

## 6. RC-by-RC Confidence Scoring

| RC | Mechanism named? | Issues mapped? | WS executing? | Lint enforcement? | Confidence root-fix lands |
|---|---|---|---|---|---|
| RC-1 (mutation chain) | ✅ | 5 | WS-2 not started (in plan) | partial (ceiling tests) | High — pattern is mechanical mirror of `createLightRuntime` |
| RC-2 (act/ monolith) | ✅ | 2 + #77 | WS-3 not started | leaf-principle lint to ship | Medium — F2 in plan shows 3 mobility classes need per-file decisions |
| RC-3 (anti-scaffold) | ✅ | 8 | WS-4 not started; convergence Phase 1 closed (#112-#119) | CI lint to ship in WS-4 | High — invariant is simple; sweep is mostly mechanical |
| RC-4 (honesty debt) | ✅ | 6 | WS-5 partial (5b/5c ceiling tests shipped) | active (`no-silent-swallow-floor.test.ts`, console-ceiling) | High — re-baselined thresholds achievable |
| RC-5 (release flow) | ✅ revised | 1 + 3 in-plan-only | WS-1 not started | n/a | High — trivial scope |

---

## 7. Honest Caveats

1. **Perf is not settled.** Sprint-1 baseline shows tier-dependent regressions on frontier-summarize (33%→0%) and mid reliability (-23pp). The redesign is structurally correct; "highly performant" requires Sprint-2+ cross-tier holdout work.

2. **WS-2/3/4/5 not started.** Sprint-1 shipped Phase-A (context-assembly canonicalization) and #7 (PostCondition spine). WS-2 (runtime canonical seam) and WS-3 (kernel DAG) remain in plan only — the canonical model is not yet a single-cast Layer.mergeAll runtime today.

3. **Five RCs collapse 25 issues; 32 remain orthogonal.** The majority of the open backlog is roadmap forward-work (Phase 1.5 mechanisms, Phase C-G features, trackers, help-wanted) — the canonical redesign is necessary but does NOT address most of the open backlog.

4. **Already-closed count (26) is from the prior Phase 0/0.5/1 sweeps**, not from this canonical-refactor cycle. They demonstrate the same approach works; they don't pre-credit WS-2..5.

5. **#7 + Sprint-1 B1/B2/B3 are the actual canonical-model-in-action evidence.** Verified-by: `grep RA_ASSEMBLY packages/*/src` shows comments-only; `grep defaultContextCurator packages/*/src` shows only DELETED markers and historic doc-pointers. The legacy paths are gone.

---

## 8. Recommended Reading Order for a Fresh Session

1. `wiki/Architecture/Design-Specs/2026-05-28-canonical-architecture-model.md` — structural target
2. `wiki/Planning/Implementation-Plans/2026-05-28-canonical-refactor.md` §3-§5 — RCs + WS sequence
3. `wiki/Research/Harness-Reports/sprint1-canonical-collapse/baseline-2026-06-02.md` — perf reality
4. This doc — current state cross-reference
5. `git log main --oneline --since=2026-05-28` — what already shipped

---

## 9. Single Highest-Leverage Next Move

**Start WS-2 (runtime canonical seam).** It is:
- The named mechanism for RC-1 (the biggest cluster: #167 + #163 + #151 + #91 + #93 → 5 issues by direct mapping; >50 cast points)
- Mechanical (mirror `createLightRuntime` shape from `runtime.ts:1061` into `createRuntime`)
- A prerequisite for WS-3 + WS-5 (typed seams enable tagged errors and leaf-principle lint)
- Has its thin spec already written: `wiki/Planning/Implementation-Plans/2026-05-28-ws-2-runtime-canonical-seam.md`

The cost of NOT starting WS-2 is that every WS-3+ touch is forced to widen types through casts that WS-2 would have removed.
