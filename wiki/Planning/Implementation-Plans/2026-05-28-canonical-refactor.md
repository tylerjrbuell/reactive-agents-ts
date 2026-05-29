---
title: Canonical Refactor — Reactive Agents (Fresh-Start)
date: 2026-05-28
status: MASTER PLAN (single source of truth for this refactor cycle)
supersedes: none (prior master plans 2026-05-26/27 treated as reference, NOT authority)
authoritative-canon:
  - wiki/Architecture/Specs/00-VISION.md
  - wiki/Architecture/Specs/06-MISSION-STATEMENTS.md
  - wiki/Architecture/Specs/07-OPTIMAL-EXECUTION-ALGORITHM.md
  - wiki/Architecture/Design-Specs/2026-05-28-canonical-architecture-model.md   # THE STRUCTURAL NORTH STAR — what we are refactoring TOWARD
authoritative-evidence:
  - wiki/Research/Audit-Reports-2026-05-27/health-sweep.md   # 126 findings across 4 iters — VERIFIED + CORRECTED numerically in §3.4 below
  - wiki/Research/2026-05-23-primitive-audit-fresh-lens.md   # 11 fresh-lens gaps G-A..G-K
  - GH issues #151–#171 (post-audit) + #104–#125 (convergence backlog)
  - First-hand audit 2026-05-28 (recorded inline §3.4) — supersedes prior-audit numbers where they diverge
companion-thin-specs:
  - 2026-05-28-ws-1-release-flow-integrity.md
  - 2026-05-28-ws-2-runtime-canonical-seam.md
  - 2026-05-28-ws-3-kernel-capability-dag.md
  - 2026-05-28-ws-4-anti-scaffold-purge.md
  - 2026-05-28-ws-5-honesty-pass.md
---

# Canonical Refactor — Reactive Agents (Fresh-Start)

> **One sentence.** Bring the runtime in line with the canonical architecture already specified in `00-VISION` / `06-MISSION-STATEMENTS` / `07-OPTIMAL-EXECUTION-ALGORITHM`, by closing the five structural root causes the 2026-05-27 audit revealed, in a priority-ordered sequence where every workstream has a falsifiable verification gate.

---

## 0. Frame

### 0.1 Why this plan exists

Three things are simultaneously true today:

1. **The canonical architecture target is fully specified.** Eight pillars, ten capabilities, five traits, a ten-step canonical loop, ten algorithmic invariants, eight anti-missions. We are not redesigning anything in this plan.
2. **The runtime has drifted from that target.** The 2026-05-27 four-iter audit produced 126 findings (60 type/bug, 27 apps/docs, 19 CI/test, 20 effect-ts/arch) and filed 21 GH issues (#151–#171). Build is green; tests pass; the architecture is structurally wrong on the seams where Builder → Runtime → ReactiveAgent → Kernel meet.
3. **Past master plans have themselves contributed to the drift.** Documents shipped, code did not. Surfaces shipped, callers did not. We treat prior plans as reference, NOT as authority. The only authoritative documents are the canon anchors and the audit evidence cited above.

### 0.2 What this plan IS and is NOT

| This plan IS | This plan is NOT |
|---|---|
| A priority-ordered execution sequence over five root causes | A new architecture proposal |
| Anchored to the canonical missions + algorithm | An amendment to vision or pillars |
| Falsifiable: every workstream has a verification gate that can fail | An aspirational manifesto |
| Subsuming: in-flight convergence work (#104–#125) routes through here | A parallel stream that ignores existing GH issues |
| Forensic: every claim is tied to a file:line or a GH issue | A new theory about how the framework should work |

### 0.3 Status entering this refactor

- **Branch:** `main`. All prior overhaul work merged.
- **Build:** ✅ green (38/38 turbo tasks, 27 cached).
- **Tests:** ✅ 3219/3219 across the six most-changed packages (iter-3 audit baseline).
- **Version:** `VERSION=0.11.1` declared; `packages/*/package.json` drift at 0.10.6 (HS-H root-caused, #159 P0).
- **Open issues:** #104–#125 convergence backlog (Phase 0 closed; Phases 0.5/1/2/3 ahead). #151–#171 post-audit (1 P0 + 15 P1 + 8 P2).
- **Dirty state at session start:** 3 modified files (`.agents/MEMORY.md`, `apps/examples/spot-test.ts`, `wiki/Issues/Running Issues Log.md`) + 2 untracked artifacts in `wiki/Research/`.

---

## 1. Canon Anchors (NOT reopened in this plan)

These are stated as anchors to avoid re-derivation cost. Every workstream cites the anchor it serves.

### 1.1 The Vision (Pillars 1–8)

`Control · Observability · Flexibility · Scalability · Reliability · Efficiency · Security · Speed`

### 1.2 The Capability Set (10)

`Sense → Attend → Comprehend → Recall → Reason → Decide → Act → Verify → Reflect → Learn`

Each capability is owned by one directory under `packages/reasoning/src/kernel/capabilities/`. The directory is the canonical seam; logic for that capability lives nowhere else.

### 1.3 The Trait Set (5)

`Comprehension · Strategic-intent · Effective-action · Self-monitoring · Compounding-intelligence`

### 1.4 The Canonical Per-Iter Algorithm

10 steps with a 59ms framework-overhead budget per iter:

```
Setup → Sense → Attend → Comprehend → Recall → Reason → DECIDE (Arbitrator)
                                                             ↓
                                            Act → Verify → Reflect → Learn → loop
```

### 1.5 The 10 Algorithmic Invariants

1. Single Arbitrator per iter — exactly one verdict
2. `status=failed → output=null` (trust differentiator)
3. `status=done → output≠null AND sanitized` (no M2a/b/c leak)
4. Every emit site has ≥1 consumer (anti-scaffold)
5. `state.status =` outside `transitionState()` = lint failure
6. Verifier check failure → severity ≠ pass (no boolean collapse)
7. Tool execution flows through `executeToolCall()` capability regardless of caller
8. Token + cost metadata aggregates from real per-call data
9. `success === true` IFF `output !== null && output.length > 0 && status === 'done'`
10. Capability emit events fire from capability code, never from strategy code

### 1.6 The 8 Anti-Missions

`NOT magic black box · NOT frontier-only · NOT config menu · NOT hides failure · NOT instrumentation-late · NOT scaffold-without-callers · NOT owns app loop · NOT unitary intelligence`

---

## 2. The Canonical System Model (intent layer)

This is the **purpose-and-boundary description** the user requested. Each system, what it owns, what it does not own, how it composes with the rest.

### 2.1 What the framework IS

> A **composable agent harness**: a layered runtime that turns a Builder spec into an Effect program that runs the ten-capability loop against any provider, where every default is justified, every surface is observable, every action is verified, every iter is one Arbitrator decision, and every advertised capability is backed by a live wired runtime.

The framework is NOT the agent. The user owns the agent. The framework offers the loop.

### 2.2 The four canonical layers

Every package belongs to exactly one of four layers. The layer determines what it is allowed to depend on and what it is allowed to expose.

```
┌───────────────────────────────────────────────────────────────────────┐
│  L4 — SURFACE          (consumer-visible)                             │
│      reactive-agents · runtime · gateway · channels · a2a            │
│      react · svelte · vue · create-reactive-agent · diagnose         │
│      eval · observe · replay · benchmarks · scenarios                │
└───────────────────────────────────────────────────────────────────────┘
                            ▲
                            │ depends on
┌───────────────────────────────────────────────────────────────────────┐
│  L3 — DOMAIN           (cognitive concerns)                           │
│      reasoning · reactive-intelligence · interaction                  │
│      memory · cost · identity · guardrails · verification             │
│      tools · prompts · orchestration                                  │
└───────────────────────────────────────────────────────────────────────┘
                            ▲
                            │ depends on
┌───────────────────────────────────────────────────────────────────────┐
│  L2 — SUBSTRATE        (cross-cutting capabilities)                   │
│      llm-provider · observability · trace · testing                   │
│      compose · health · judge-server                                  │
└───────────────────────────────────────────────────────────────────────┘
                            ▲
                            │ depends on
┌───────────────────────────────────────────────────────────────────────┐
│  L1 — FOUNDATION       (no agent semantics)                           │
│      core · runtime-shim                                              │
└───────────────────────────────────────────────────────────────────────┘
```

**The dependency rule (must hold):** L_n may only depend on L_m where m ≤ n. Within a layer, packages may depend on each other only via explicit Tag-based Layer wiring (no transitive import-graph cycles).

### 2.3 The 35 packages by canonical role

| Package | Layer | Role (one sentence) | Owns (what only it gets to do) |
|---|---|---|---|
| **core** | L1 | Shared types + EventBus + AgentService + TaskService | Type definitions, event bus implementation, shared service Tags |
| **runtime-shim** | L1 | Bun/Node unified primitives | Cross-runtime filesystem/DB/HTTP primitives |
| **llm-provider** | L2 | `LLMService` + 6 provider adapters + streaming + native FC | Provider semantics, response shape normalization, 7-hook adapter contract |
| **observability** | L2 | Tracing + metrics + structured logging + MetricsCollector | Sink-agnostic observation pipeline |
| **trace** | L2 | Trace event types + recorder + reader | Trace event schema + JSONL recording |
| **testing** | L2 | Mock LLM + tool + bus + assertion helpers | Test fixture surface for downstream packages |
| **compose** | L2 | Harness composition pipeline + 6 killswitches | Tag→callback registry, phase-hook injection, killswitch lifecycle |
| **health** | L2 | Readiness/liveness primitives | Health endpoint shapes (consolidation candidate — see §2.4) |
| **judge-server** | L2 | Internal judge HTTP wrapper for eval | LLM-as-judge endpoint isolation |
| **tools** | L3 | `ToolService` + registry + 11 builtins + MCP + sandbox | Tool definition, dispatch, registry, MCP client, healing |
| **memory** | L3 | 4-layer memory + SQLite/FTS5 + sqlite-vec + Zettelkasten | Memory persistence, recall, skill store, calibration store |
| **reasoning** | L3 | Kernel + 6 strategies + 10 capability dirs | `runKernel`, capability emit, Arbitrator, every strategy primitive |
| **reactive-intelligence** | L3 | Adaptive dispatcher + bandit + skill synthesis + calibration | Cross-iter control decisions, dispatcher FSM, RI policy |
| **interaction** | L3 | 5 autonomy modes + checkpoints + approval gates + preference learning | HITL surface, checkpoint state machine, approval routing |
| **cost** | L3 | Router + budget enforcer + semantic cache + pricing | Complexity routing, budget tracking, cost calculation |
| **identity** | L3 | Ed25519 certs + RBAC + delegation + audit trail | Identity verification, capability delegation, audit append |
| **guardrails** | L3 | Injection/PII/toxicity + KillSwitch + BehavioralContracts | Input/output filter pipeline |
| **verification** | L3 | Semantic entropy + fact decomposition + NLI hallucination | Hallucination detection primitives (consolidation candidate — see §2.4) |
| **prompts** | L3 | Template engine + version control + tier-adaptive variants | Prompt template surface (consolidation candidate — see §2.4) |
| **orchestration** | L3 | Sequential/parallel/pipeline/map-reduce workflows | Multi-agent workflow primitives |
| **a2a** | L4 | Agent Cards + JSON-RPC 2.0 + SSE streaming | Inter-agent transport |
| **gateway** | L4 | Persistent harness + heartbeats + crons + webhooks + policy | Long-running gateway loop |
| **channels** | L4 | Multi-transport I/O adapters | Channel adapters + bus shim |
| **eval** | L4 | LLM-as-judge + EvalStore + scoring dimensions + regression | Eval suite execution + persistence |
| **observe** | L4 | OTel/OpenInference span exporter | EventBus → OTel bridge (dead-surface candidate — see §3.5) |
| **replay** | L4 | Deterministic trace replay + diff | Snapshot + replay tool layer + diffing |
| **benchmarks** | L4 | Benchmark suites + sessions | Benchmark scaffolds (consolidation candidate — see §2.4) |
| **scenarios** | L4 | Scenario fixtures | Scenario corpus (consolidation candidate — see §2.4) |
| **diagnose** | L4 | `rax-diagnose` CLI | CLI for trace + run inspection |
| **runtime** | L4 | `ExecutionEngine` + `ReactiveAgentBuilder` + `createRuntime()` | The runtime facade + builder API |
| **reactive-agents** | L4 | Public umbrella façade + re-exports | Public API surface (single import point) |
| **create-reactive-agent** | L4 | Scaffolding CLI | Template-driven onboarding |
| **react** | L4 | React adapter (hooks + stream) | React-native consumer integration |
| **svelte** | L4 | Svelte adapter | Svelte-native consumer integration |
| **vue** | L4 | Vue adapter | Vue-native consumer integration |

### 2.4 Documented consolidation candidates (NOT executed in this refactor cycle)

`05-DESIGN-NORTH-STAR §5.4` proposed five consolidations that have NOT shipped: `verification → reasoning/kernel/capabilities/verify`, `prompts → reasoning/context`, `interaction → runtime`, `benchmarks + scenarios → testing`, `health → observability`. Net package count goal: 35 → 22.

**Decision for this plan:** Consolidations are explicitly **deferred** to a later cycle. They are not in scope for the foundation-canonical refactor. Reason: consolidation is a value-extraction move, not a structural-correctness move. Structural correctness comes first.

### 2.5 The 10-capability → kernel-dir canonical map

Verified against current code state. ✅ = directory exists with primary owner file.

| Capability | Kernel directory | Primary owner file | Status |
|---|---|---|---|
| Sense | `kernel/capabilities/sense/` | `step-utils.ts` | ✅ |
| Attend | `kernel/capabilities/attend/` | `context-utils.ts`, `tool-formatting.ts` | ✅ |
| Comprehend | `kernel/capabilities/comprehend/` | `task-intent.ts` | ✅ |
| Recall | `kernel/capabilities/recall/` | `recall-service.ts` | ✅ |
| Reason | `kernel/capabilities/reason/` | `think.ts`, `stream-parser.ts`, `think-guards.ts` | ✅ |
| Decide | `kernel/capabilities/decide/` | `arbitrator.ts`, `oracle-nudge.ts` | ✅ |
| Act | `kernel/capabilities/act/` | `act.ts`, `tool-execution.ts`, `guard.ts` | ✅ |
| Verify | `kernel/capabilities/verify/` | `verifier.ts`, `evidence-grounding.ts`, `quality-utils.ts` | ✅ |
| Reflect | `kernel/capabilities/reflect/` | `loop-detector.ts`, `reactive-observer.ts`, `strategy-evaluator.ts` | ✅ |
| Learn | `kernel/capabilities/learn/` | `learning-pipeline.ts` | ✅ |

**Structural completeness ✅.** All 10 directories exist with primary owner files. The remaining work is to ensure the mesh edges between them respect the leaf principle (no cycles) — see RC-2 / WS-3.

### 2.6 The 5 cross-cutting concerns (where they live)

| Concern | Owner location | Consumed by |
|---|---|---|
| State | `kernel/state/` (kernel-state.ts, kernel-hooks.ts, kernel-constants.ts) | Loop controller only mutates; all capability code reads |
| Telemetry | `core/event-bus.ts` + `trace/` + `observability/` | Every capability emits via boundary helper |
| Safety | `guardrails/` + `cost/` + `identity/` | Verifier consults; Arbitrator weighs |
| Time | `core/` (mockable clock) | Sense + Reflect for budget/latency signals |
| Provenance | `ObservationResult.trustLevel` + tool risk levels | Verify + Decide |

### 2.7 The emit/consume contract (anti-scaffold law)

This is the single load-bearing law for this refactor. Stated three ways for clarity:

- **Imperative:** No declared surface element ships without an emit site and a consumer in the same commit.
- **Compositional:** Every entry in `TagMap` / `ControllerDecision union` / `CapabilityRegistry` / calibration field set has a matching `emit(...)` call site AND a matching `on(...)` / read site shipped in the same commit.
- **Lint:** A future CI lint rule (WS-4 deliverable) walks the type graph and flags entries without paired sites.

---

## 3. Current Drift From Canon (evidence-grounded)

Each item below is tied to a GH issue or audit finding. No claims without citations.

### 3.1 L1-metric drift (structural — auto-checkable in CI)

| Mission L1 metric | Target | Current | Gap | Evidence |
|---|---|---|---|---|
| Workspace test pass rate | ≥99% | ~99.8% (3219/3219 audited) | ✅ on target | iter-3 audit |
| `state.status=` mutation sites | ≤10 | not measured (lint rule unshipped) | unknown | #114 convergence backlog |
| Declared TagMap entries with ≥1 emit site | 100% | < 100% (4 dead Compose tags audited) | -4 | G-9 / #112 |
| Capability dirs match canonical 10 list | 100% | 100% (10/10 ✅) | 0 | §2.5 verified |
| Type-checks clean | clean | clean | ✅ on target | turbo build green |

### 3.2 L2-metric drift (observability — automatable per-run)

| Mission L2 metric | Target | Current | Gap | Evidence |
|---|---|---|---|---|
| `kernel-state-snapshot` per `state.status` transition | 100% | partial; outer-loop strategies miss | ↓ | G-10 / #113 |
| `llm-exchange` per LLM round-trip | 100% | provider-side wire present; full coverage gap | partial | #117 |
| Trace duplication rate | ≤1% | known E5 duplications exist | unknown % | E5 in failure catalog |
| Trace-to-replay determinism | ≥99% bytewise | tool-layer replay shipped; no LLM cassette | partial | G-F fresh-lens |

### 3.3 L3-metric drift (outcome — out of scope for this refactor)

The plan does NOT relitigate L3 outcomes. Outcome work routes through Phase 1.5 mechanisms (M3/M6/M7/M8/M10/M14) which proceed in parallel. The refactor's job is to make L1 + L2 hold structurally so L3 measurements are trustworthy.

### 3.4 Failure pattern inventory (the five clusters)

The 126 audit findings collapse into five mechanism-level root causes. Symptoms cluster on each:

#### **RC-1 — Mutation-chain Layer composition adds N cast points instead of 1**

**Reframed from prior-audit "service-locator anti-pattern."** First-hand read of `runtime.ts` (lines 55-76 + 215-870) shows the team made a **deliberate, documented engineering choice:** Effect's `Layer<Out,Err,In>` union types blow up at ~25 optional layers ("type instantiation excessively deep"), so `ComposableLayer = Layer.Layer<unknown,unknown,unknown>` is used as a single erasure boundary, with `BuildBaseRuntimeResult` as the re-narrowing site. The pattern has merit — Effect's compiler-perf problem is real.

**The actual structural issue:** the runtime is built via **40+ mutations** of `let runtime` with `runtime = Layer.merge(runtime, X) as ComposableLayer` in conditional blocks. The pattern adds **44 cast points** (one per merge) instead of **one** (collected `Layer.mergeAll([...layers])` at the end).

- 44× `as ComposableLayer` in `runtime.ts` alone (verified `grep -c`)
- 40× `Layer.merge(runtime, X)` calls forming the mutation chain
- Only 2× `Layer.mergeAll` calls (so the declarative-array primitive is known but underused)
- 4× `as Context.Tag.Service` (prior audit said 64; **wrong by 16×**)
- 74× `as unknown as` total in `packages/*/src/` (prior audit said 80; close)
- `AgentResult.debrief` not on public type → casts at CLI/cortex/playground (real, #162)
- `AgentEvent` union not discriminated on `_tag` → casts at cortex/ui (real, #163)

**Mechanism:** chain pattern + per-link erasure. The fix is mechanical: collect every conditional layer into an `Array<ComposableLayer>`, terminal `Layer.mergeAll(layers)`, one cast at the boundary. Same type-erasure semantic; cleaner code; 44 casts → 1.

**Cited:** #167, #162, #163, runtime.ts:55-76 (the team's own documentation of the tradeoff), runtime.ts:693-885 (the mutation chain), HS-A-01/04/05/07/15/16/19, HS-D-07/08/09.

#### **RC-2 — Kernel mesh has cycles AND `act/` is a 3053-LOC monolith conflating capability + tool substrate**

**Reframed from prior-audit "21 edges + 7 cycles."** First-hand walk (formal all-pairs grep of `import from ../$other/`) shows:

- **38 cross-edges total** (prior audit said 21 — undercount by ~45%)
- **3 confirmed cycles** (prior audit said 7 — overcount by ~2×):
  - `act` ↔ `decide` (`act/act.ts` ↔ `decide/arbitrator.ts`)
  - `act` ↔ `reason` (`act/{act,tool-execution}.ts` ↔ `reason/{think,think-guards}.ts`)
  - `reason` ↔ `verify` (`reason/{think,think-guards}.ts` ↔ `verify/...`)

**Root mechanism (the structural insight prior audits missed): `act/` conflates two distinct concerns** — the Act capability AND tool substrate (execution, parsing, gating). At 3053 LOC across 6 files:

| File | LOC | Inbound from OTHER capabilities | Concern |
|---|---|---|---|
| `act/act.ts` | 1208 | 0 | Act capability (correct home) |
| `act/tool-execution.ts` | 893 | **3** | Tool substrate (wrong home) |
| `act/tool-parsing.ts` | 255 | **2** | Tool substrate (wrong home) |
| `act/tool-gating.ts` | 270 | **4** | Tool substrate (wrong home) |
| `act/tool-capabilities.ts` | 140 | 0 | Tool substrate (wrong home) |
| `act/guard.ts` | 287 | 0 | Act capability (correct home) |

**9 of the 38 cross-edges go into `act/tool-*.ts`** — these are NOT capabilities consuming Act; they are capabilities consuming tool primitives that happen to live in `act/`'s directory.

**Fix mechanism:** extract `tool-execution.ts` + `tool-parsing.ts` + `tool-gating.ts` + `tool-capabilities.ts` into `kernel/substrate/tools/` (or back into `@reactive-agents/tools` package). Capabilities consume via Tag-based contract; not via direct file imports. Predicted collapse:

- 9 cross-edges → 0 (substrate consumption is allowed; capability↔capability internal imports become impossible)
- 3 cycles → 0–1 (act↔decide may persist as a true cross-capability cycle worth its own analysis; act↔reason and reason↔verify collapse because they're routed through tool/verify primitives)
- `act/` LOC: 3053 → ~1495 (just `act.ts` + `guard.ts`)

**Cited:** #169 (with corrected numbers), first-hand all-pairs cycle walk 2026-05-28, file LOC measurements.

#### **RC-3 — Scaffold without callers (declared-surface drift)**

- `@reactive-agents/observe` package: zero internal callers; only docs reference it (#170 / K-02).
- 5 of 6 M12 `LocalProviderAdapter` hooks ship 270 LOC with zero call sites (K-08).
- 4 Compose tags declared but no emit site (G-9 — partially closed by convergence Phase 1 #112).
- `confidenceFloor` killswitch: documented + tested, **unshipped** per 2026-05-19 audit (#160).
- `strategy-switching` registry entry: `defaultOn: true` but `liftEvidence: null` (deliberate per cf-25 gate).

**Cited:** #170, #160, G-9 cluster, K-02, K-08.

#### **RC-4 — Honesty debt (silent error swallow + lying state)**

**Reframed with first-hand counts.** Prior audit was directionally right but materially overstated:

- **34× `Effect<X, unknown>`** in `packages/*/src/` (prior audit said 105 — **wrong by ~3×**)
- **27× `console.warn`** sites bypassing ObservabilityService (prior audit said "3 sites" — **understated**)
- **24× `console.error`** sites in production code
- **28× `Effect.runPromise`** — async boundary violations (matches prior count)
- **113× `as any`** in `packages/*/src/` excluding tests (prior audit said ~490 — **wrong by ~4×**)
- Lying comment at `gateway-bootstrap.ts:236`: claims "propagate" but actually `.catch(() => {})` (HS-B-02 confirmed)
- Leftover `DEBUG_VERIFIER console.error` at `runner.ts:1740–1742` (HS-B-01 confirmed)
- 4× memory-service bootstrap swallows missing `emitErrorSwallowed` (HS-B-04 confirmed)
- Doc-drift: AGENTS.md tree omits some packages (per-package listing TBD verify); `04-PROJECT-STATE.md` 30+ days stale (#161, #171)

The honesty debt is **real but smaller than reported**. The audit's count-inflation pattern (`grep -c` matching multiple times per line; missing test/non-test split) explains most of the gap. RC-4 work proceeds; thresholds in §8.1 are calibrated to corrected baselines.

**Cited:** #168, #161, #171, HS-B-01..09, first-hand counts 2026-05-28.

#### **RC-5 — REVISED (audit-driven correction, 2026-05-28 evening)**

**Original framing INVALID.** The release-warden Phase 0 audit (`wiki/Research/Release-Audits/0.11.1-current-drift-2026-05-28.md`) corrected three premises this plan and the prior health-sweep had wrong:

| Original claim | Reality |
|---|---|
| Workspace `packages/*/package.json` at 0.10.6 = drift defect | **Intentional steady-state per `release.ts:205-208` comment** — "so `cat VERSION` always matches npm @latest (repo package.json stays unbumped by the tag-driven flow)" |
| Git tags max at v0.9.0; no v0.10.x or v0.11.x | **v0.10.0–v0.10.6 + v0.11.0–v0.11.1 tags exist locally AND on origin**, deref'ing to the exact npm `gitHead` SHAs (cross-package verified) |
| Release flow structurally broken | **Release flow works in steady state.** Four secondary defects exist but no structural rebuild needed |

**Actual issues (P1, not P0):**

- **F2 (NEW):** Typecheck RED at HEAD. `@reactive-agents/verification` test files reference stale `VerificationLLM` shape missing `embed`. 8 TS2345 errors across `tests/hallucination-detection.test.ts:145,162,176,192` + `tests/layers.test.ts:76,97,118,139`. Same pattern: mock objects declare `complete` but not `embed`. Blocks any future v0.12.0 tag-cut under release-warden gate.
- **F3 (NEW):** `@reactive-agents/judge-server` at workspace version 0.9.5; never published to npm (404); not lockstep with other packages. User adjudication 2026-05-28: mark `private: true` + stamp to 0.10.6.
- **F4 (NEW):** `release.ts` bails at `npm whoami` (line 65-66) BEFORE drift inspection logic runs. Cannot function as drift gate without `npm login`. Either run after login OR refactor script (drift check before auth).
- **#165:** Orphan v0.10.7 GH draft release residue. Trivial delete.
- **#159:** Invalid as framed — workspace lag is intentional steady-state. Close with comment.

**Cited:** Release-warden audit 2026-05-28 (`wiki/Research/Release-Audits/0.11.1-current-drift-2026-05-28.md`); first-hand reproduction of F2 (`bun run typecheck` in `packages/verification`) + F3 (`npm view @reactive-agents/judge-server` → 404) + F1 (`git ls-remote --tags origin v0.10.6 v0.11.1` → both present).

**Implication:** RC-5 was overstated in priority (P0 → P1 in reality) and overscoped in mechanism (structural rebuild → 4 small fixes). The CI ephemeral-runner stamping pattern at `release.ts:197-208` IS the design — the tag-driven flow leaves workspace pkg.jsons unbumped on purpose so `VERSION` is the source-of-truth single field. This was specified in the comment block all along; prior audits read the symptom without reading the rationale.

### 3.6 First-Hand Deep-Audit Findings (2026-05-28 amendment 2)

Deep-read of `runtime.ts` (full createRuntime body) + `act/{act,tool-execution,tool-parsing,tool-gating}.ts` + `reactive-agent.ts` + `runner.ts` emit sites + `arbitrator.ts` + `builder.ts` public surface produced six structural facts that materially shape the workstream scope.

#### F1 — `createRuntime` is the holdout; `createLightRuntime` already uses the target pattern

`runtime.ts:1061` (`createLightRuntime`):
```ts
let runtime: ComposableLayer = Layer.mergeAll(
  coreLayer, eventBusLayer, llmLayer, memoryLayer, hookLayer, engineLayer, CapabilityRegistryLive,
) as ComposableLayer;
```

`runtime.ts:215–940` (`createRuntime` — the main entry): 40× `runtime = Layer.merge(runtime, X) as ComposableLayer` mutation chain.

**Implication:** WS-2 is purely mechanical. The team already knows + uses the declarative pattern; `createRuntime` is the holdout. Refactor scope = mirror `createLightRuntime` shape for `createRuntime`. No new patterns invented.

#### F2 — `act/` files have differential mobility (NOT a 1:1 substrate extraction)

| File | LOC | Inbound | Concern | Right home |
|---|---|---|---|---|
| `act/act.ts` | 1208 | 0 | Act capability orchestration | **stays in `act/`** |
| `act/guard.ts` | 287 | 0 | Pre-act guard | **stays in `act/`** |
| `act/tool-execution.ts` | 893 | 3 (reason) | Tool dispatch — kernel-state coupled; imports `kernel/state` + tools/memory pkgs | **stays in `act/` as canonical Act owner; expose via Tag to other capabilities** |
| `act/tool-parsing.ts` | 255 | 2 (decide, reason) | Pure regex helpers (`FINAL_ANSWER_RE`, `extractFinalAnswer`, `evaluateTransform`) — no state coupling | **move to `kernel/utils/tool-parsing.ts`** (substrate) |
| `act/tool-gating.ts` | 270 | 4 (reason) | Tool selection logic (`planNextMoveBatches`, `gateNativeToolCallsForRequiredTools`, `isParallelBatchSafeTool`) | **architectural decision required** — belongs to Comprehend (filter what's permitted) OR Decide (which to fire) OR stay Act with Tag |
| `act/tool-capabilities.ts` | 140 | 0 | Tool capability declarations | stays in `act/` |

**Implication:** WS-3 is a multi-phase architectural-review task, NOT a single mechanical move. Three distinct mobility classes. The thin spec needs a per-file disposition decision documented before any move.

#### F3 — Emit is happening at capabilities AND at runner.ts (mission violation specific)

| Location | Emit-related lines |
|---|---|
| `runner.ts` | 39 |
| `act/` | **30** (most among capabilities) |
| `reflect/` | 18 |
| `reason/` | 15 |
| `decide/` | 14 |
| `comprehend/` | 5 |
| `verify/` | 4 |
| `attend/` | 2 |
| `sense/` | 1 |
| `recall/` | 1 |
| `learn/` | 1 |

**Implication:** Audit's claim "emit lives at runner.ts not at capability boundary" is **partially refuted**. Capabilities DO emit. The G-10 / #113 work is partially done. Remaining work: the 39 runner.ts emit calls are candidates for relocation to capability boundaries (mission invariant 10: "Capability emit events fire from capability code, never from strategy code"). Many of runner.ts's emit calls are likely legitimate (loop start/end, phase boundary) — needs per-call audit, not blanket move.

#### F4 — `arbitrator.ts` IS canonical single-owner; mission invariant 1 holds

`evaluateTermination(ctx, evaluators[])` + `TerminationDecision { action: 'exit' | 'redirect' | 'continue' | 'fail', ... }`. Action enum maps cleanly to canon's `continue | exit-success | exit-failure | escalate`. Verdict-Override pattern present (controller signal can override agent's apparent success — anti-mission #4 enforced). **No refactor needed for arbitrator.ts itself.** WS-3 + WS-5 may sharpen the emit + error shapes around it.

#### F5 — `builder.ts` has 59 `withX()` methods ~~(2.4× anti-mission #3 threshold)~~

> **AMENDED 2026-05-29 (CORRECTION 1+2).** Original framing treated method COUNT as the failure mode and prescribed marking redundant withers `@deprecated alias for HarnessProfile.X`. **This was reverted** — it subtracted value from the documented happy path (IDE strikethrough + doc-gen warnings + lint noise) without simplifying code. The failure mode is redundant/confusing API with no canonical path, NOT count. Corrected discipline (see architecture-model §11.2 AMENDED): fluent `.withX()` methods stay first-class + non-deprecated; HarnessProfile presets + `.compose()` are ADDITIVE shortcuts documented as alternatives; each fluent method carries a `@see`/"Composable equivalent:" pointer. Gate `builder-wither-discipline.test.ts` now locks the happy path first-class instead of capping count.

~~Anti-mission #3: "24 named override methods IS the failure mode." Current: 59. HarnessProfile presets shipped but withers proliferated alongside (not replaced). **Implication:** WS-2 co-located cleanup should mark redundant withers `@deprecated alias for HarnessProfile.X` and document HarnessProfile as primary API path.~~ (Superseded by amendment above.)

#### F6 — `reactive-agent.ts` casts are concentrated at internal-handoff sites

`gatewayStatus()` line 1385: `queryGatewayStatus(this as any)`. `start()` line 1413: `startGateway(this as any)`. Pattern: handoff to extracted module functions that need the full `ReactiveAgent` instance. **Implication:** WS-2 co-located cleanup adds a `ReactiveAgentInternalView` interface OR types the receiver in `gateway-runner.ts` to accept the relevant subset. Mechanical, ~2 sites + 1 type.

#### F7 — `CapabilityRegistry` (308 LOC) is well-designed; HarnessProfile (103 LOC) has a growth risk

`packages/runtime/src/capabilities/registry.ts` ships a canonical schema (name + description + defaultOn + costSignature + liftEvidence + riskNotes + rationale + ownerWarden + lastAblation) with 4 bootstrap entries (memory ✅, reactive-intelligence ✅, verifier ✅, strategy-switching ⚠️ deliberately null `liftEvidence`). `audit()` returns `CapabilityAuditReport { totalEntries, defaultOnCount, entries, byWarden, staleEntries, violations }`. ✅ Anti-mission #6 wired (every default has rationale + cost + owner).

`packages/runtime/src/capabilities/profile.ts` (`HarnessProfile.lean()/balanced()/intelligent()`) ships clean presets. **But `HarnessProfilePatch` hard-codes 5 boolean fields** (enableMemory / enableReactiveIntelligence / enableVerifier / enableStrategySwitching / enableSkillPersistence). As registry grows, patch type must grow in lockstep — risks the same anti-mission #3 pattern at the preset layer.

**Implication for plan:** WS-4 (anti-scaffold purge) should generalize `HarnessProfilePatch` to derive from registry (e.g., `Partial<Record<RegisteredCapabilityName, boolean>>`) so adding a registry entry doesn't require touching profile.ts.

**Update 2026-05-29 (WS-4 Phase 5b):** **DEFERRED.** Audit confirms the existing test gate `packages/runtime/tests/harness-profile.test.ts:174-198` ("HarnessProfile registry-drift guard (MOVE-6)") already pins `lean()` patch field count at 5 — any new registry default-on entry without a matching patch field surfaces immediately as a test failure. This is sufficient mitigation: the *risk* of silent drift is closed by the drift detector. The structural refactor (Partial<Record<RegisteredCapabilityName, …>>) would add type-level complexity for zero runtime improvement until the registry actually grows. Re-open when the registry adds its 5th default-on entry (MOVE-2 adaptive-routing being the most likely trigger).

#### F8 — `@reactive-agents/reactive-intelligence` is a substantial framework piece (50+ exports)

`packages/reactive-intelligence/src/index.ts` re-exports across 8 sub-domains: calibration (entropy sensor priors, conformal threshold), controller (dispatcher FSM, intervention handlers, patch applier), learning (bandit, task classifier, skill synthesis, learning engine), sensor (token/structural/semantic/behavioral/context entropies + composite + trajectory), skills (resolver, distiller, registry, injection, compression), telemetry (install ID, signing, telemetry client), runtime (createReactiveIntelligenceLayer), events. **50+ public symbols.**

**Implication for plan:** RI is NOT a peripheral concern. Its 15-caller heavy-use surface (verified earlier) is well-justified by the surface area shipped. WS-3 + WS-4 must treat RI as a peer of `@reactive-agents/reasoning`, not as a candidate for consolidation.

#### F9 — Strategy input has 30+ fields; the real API surface is `StrategyFn`'s input shape, not just builder methods

`packages/reasoning/src/services/strategy-registry.ts:StrategyFn` takes an input object with 30+ optional fields: taskDescription, taskType, memoryContext, availableTools, availableToolSchemas, allToolSchemas, config, systemPrompt, taskId, resultCompression, contextProfile, providerName, agentId, sessionId, requiredTools, requiredToolQuantities, relevantTools, maxCallsPerTool, maxRequiredToolRetries, strategySwitching, modelId, taskCategory, temperature, environmentContext, metaTools, briefResolvedSkills, initialMessages, synthesisConfig, observationSummary, verifier, harnessPipeline, budgetLimits.

8 registered strategies: reactive, react (alias), reflexion, plan-execute-reflect, tree-of-thought, adaptive, direct, code-action + 1 kernel: `react`.

**Implication for plan:** Mission Pillar 3 says "Strategies are declarative compositions of capabilities, not parallel loop reimplementations. New algorithmic shapes are first-class primitives; new strategies are array literals." A 30-field strategy input is the OPPOSITE of declarative — it's a god-input that every strategy must understand. **This is a Pillar 3 violation the audit missed.** WS-3 Phase 6 (new) or a later workstream should refactor `StrategyFn` input into a substrate-derived context object (most fields come from kernel context, not strategy choice).

#### F10 — State mutation discipline: 27 raw `state.status=` sites violate Mission Pillar 4 by ~2.7×

Mission Pillar 4 (Scalability): "≤10 mutation sites total across the kernel. `state.status =` outside `transitionState()` helper = lint failure."

First-hand counts:
- `state.status =` raw assignments: **27** (target: ≤10; violation 2.7×)
- `transitionState()` callsites: **100** (the canonical helper is being USED)
- Other raw `state.X =` assignments: ~33

**Implication for plan:** WS-3 Phase 4 ESLint rule (`transitionState()` discipline + #114) is more urgent than ranked — 27 sites need migration to `transitionState()`. Add to §8.1 done-criteria.

### 3.5 Package-role drift (where things live wrong — first-hand verified)

| Drift | Evidence (first-hand 2026-05-28) | Disposition |
|---|---|---|
| `runner.ts` **1986 LOC** (regrown from 1739 baseline post-Stage-5) | `wc -l packages/reasoning/src/kernel/loop/runner.ts` | WS-6 re-decomp (post-foundation) |
| `builder.ts` **2027 LOC** (post-W26 from 2407; > ≤500 target) | `wc -l packages/runtime/src/builder.ts` | WS-6 |
| `runtime.ts` **1261 LOC** with 40× `Layer.merge` chain + 44× ComposableLayer casts | `wc -l + grep -c` | **WS-2** |
| `act/` capability dir **3053 LOC** — conflates capability + tool substrate | `find ... wc -l + grep import` | **WS-3** (extract tool-* to substrate) |
| `@reactive-agents/observe` **0 internal callers** (confirmed) | `grep -r "from .@reactive-agents/observe" packages apps` = 0 matches | **WS-4** delete or wire |
| `@reactive-agents/compose` **2 callers** total (both in `apps/examples/`) | `grep -r "from .@reactive-agents/compose" packages apps` | **WS-4** investigate; surface barely consumed |
| `@reactive-agents/reactive-intelligence` **15 callers** (heavy consumer surface) | `grep -r "from .@reactive-agents/reactive-intelligence"` | not drift — heavy use confirmed |
| 9 production files >1000 LOC | HS-C-01..10 + first-hand confirmed for runner/builder/runtime/act.ts | WS-6 |
| `compose/src/index.ts` **2 LOC** + 7 killswitch files (~186 LOC) is the entire package | `wc -l packages/compose/src/*` | WS-4 |
| `observe/src/` **301 LOC, 3 files** (tracer.ts, otlp.ts, index.ts) shipping zero callers | `wc -l + grep` | **WS-4** |
| Workspace pkg.json versions **all 0.10.6**; root VERSION **0.11.1**; tags max **v0.9.0** | `grep + git tag` | **WS-1** P0 |
| `interaction/services/interaction-manager.ts` canonical HITL but "under-advertised" | fresh-lens audit | WS-4 docs surface |
| `M12 LocalProviderAdapter` 5/6 hooks unused | K-08 | WS-4 prune |

---

## 4. Root Causes — Mechanism, Not Symptom

The five clusters above each have a **single structural mechanism** that generates the symptoms. Naming the mechanism is the lever; fixing the mechanism collapses the symptoms.

| RC | Mechanism (the lever) | Symptoms collapse when fixed |
|---|---|---|
| **RC-1** | **`runtime.ts` builds the runtime via mutation chain: 40× `runtime = Layer.merge(runtime, X) as ComposableLayer`. The `ComposableLayer` erasure boundary is a deliberate documented choice (Effect union explosion at scale); the chain pattern adds the cast at every link instead of one terminal cast.** | 44 ComposableLayer casts → 1. Pattern is mechanical: collect conditional layers into `Array<ComposableLayer>`, one terminal `Layer.mergeAll(layers) as ComposableLayer`. AgentResult/AgentEvent type cleanup is a separate but co-located concern. |
| **RC-2** | **`act/` capability dir conflates the Act capability (`act.ts` + `guard.ts`, ~1495 LOC) with tool substrate (`tool-execution.ts` + `tool-parsing.ts` + `tool-gating.ts` + `tool-capabilities.ts`, ~1558 LOC, 9 cross-capability inbound).** Other capabilities import tool primitives by reaching into `act/`'s directory — that's what creates the mesh edges. The `leaf principle` is unenforced because there's no separation between "capability" and "primitives capabilities consume." | Extracting tool-* → `kernel/substrate/tools/` (or back into `@reactive-agents/tools`): `act/` 3053→~1495 LOC; 9 of 38 cross-edges disappear; act↔reason and reason↔verify cycles likely collapse; act↔decide may remain as one legitimate cross-capability dependency worth its own structural analysis. |
| **RC-3** | **There is no enforced ship-time invariant that every declared surface element has a live emit + consumer in the same commit.** | Compose tags get callers (verified). `observe` (zero callers verified) either gets a caller or is deleted. M12 hooks get wired or removed. `confidenceFloor` ships or unships. |
| **RC-4** | **The Effect-TS error channel is used as `unknown` instead of a tagged-error algebra; swallow happens at type level, not at code level.** Lying comments and `console.warn` bypasses are the same disease in different syntax. | 34 silent-swallow sites (corrected count) become explicit `Effect<X, KnownError>` declarations. 27 `console.warn` bypass sites route through ObservabilityService. Doc-drift gets a CI gate. |
| **RC-5 (REVISED)** | **Premise was wrong; release flow works in steady state.** Workspace pkg.json lag at 0.10.6 is intentional design per `release.ts:205-208` comment (so `VERSION` is sole source of truth matching npm @latest). Tags v0.10.x and v0.11.x exist on origin already. Actual residual issues: typecheck RED at HEAD (F2 — verification test files missing `embed` stub), judge-server inconsistency (F3 — mark `private: true` + stamp to 0.10.6), `release.ts` ordering (F4 — `npm whoami` gate trips before drift logic), #165 orphan v0.10.7 draft. | F2/F3/F4 + #165 fixes ship as small bundle; #159 closes as invalid; release flow continues to work as designed. |

---

## 5. Workstream Sequence (priority-ordered execution path)

The sequence is anchored to one principle: **fix the constraint that makes every other touch cheaper.**

```
Pre-flight: commit dirty state                     (15 min)
   ↓
WS-1: Release-Flow Integrity        (closes RC-5)  (1 day)   ← unblocks shipping
   ↓
WS-2: Runtime/Agent-Facade Seam     (closes RC-1)  (1 wk)    ← highest leverage
   ↓
WS-3: Kernel Capability DAG         (closes RC-2)  (1 wk)    ← unlocks parallel capability work
   ↓
WS-4: Anti-Scaffold Purge           (closes RC-3)  (3 days)  ← subsumes convergence Phase 1
   ↓
WS-5: Honesty Pass                  (closes RC-4)  (3 days)  ← surface lies become typed truth
   ↓
RE-AUDIT GATE                                                ← measurement: counts must drop ≥50%
   ↓
WS-6: Decomposition Restoration                    (1 wk)    ← re-measure after seam fix
   ↓
WS-7: Convergence Phases 0.5/2/3                   (2 wks)   ← #110–125 in flight
   ↓
WS-8: Fresh-Lens Primitives                        (2 wks)   ← G-A cost→Arbitrator, G-B, G-F
```

Total wall-clock estimate at one workstream-per-session-week cadence: ~8 weeks. Compressible to ~5 weeks with parallel WS-3+WS-4 after WS-2 lands.

### 5.1 Why WS-1 is first (despite WS-2 being highest-leverage)

WS-1 is small, isolated, and unblocks shipping. WS-2 is large and high-risk. If WS-2 reveals problems that need a release-cycle to fix, WS-1 must already be done. Order is sequencing not priority.

### 5.2 Why WS-2 before WS-3

The 30+ casts in the runtime/agent-facade seam currently force every kernel touch to widen types through casts. Fixing the seam first means WS-3's import-graph cleanup doesn't have to fight type debt simultaneously.

### 5.3 Why WS-3 before WS-4

WS-4 enforces the emit/consume invariant. WS-3 makes capability emit live at boundaries (not at runner.ts). The invariant cannot be enforced until the boundaries are real.

### 5.4 Why WS-5 (honesty) last among foundation work

WS-5 needs WS-2's typed seams in place to define tagged errors. Without WS-2, `Effect<X, KnownError>` declarations have nowhere clean to live (they'd ride on top of `as ComposableLayer` casts).

### 5.5 Re-audit gate (REQUIRED before WS-6+)

After WS-5 ships, re-run the audit (codebase-health-sweep skill v3) and confirm:

- `as any` count drops ≥50% (current ~490 in production)
- `as unknown as` count drops ≥50% (current ~80 in production)
- `as ComposableLayer` count = 0
- `Effect<X, unknown>` count drops ≥50% (current 105)
- Dead-surface count = 0 (every declared TagMap/ControllerDecision/CapabilityRegistry entry has emit+consumer)
- Lying-comment count = 0 (B-series audited zero)

**If any threshold misses, WS-6+ does not start.** Stop the line, diagnose, fix-forward.

---

#### 5.5a — Re-baselined thresholds (2026-05-29; Branch A decision)

After WS-5b + WS-5c shipped the residual sweep, the original §5.5 thresholds proved unreachable without out-of-scope structural work in 6 different domains. Per re-audit gate report (`wiki/Research/Refactor-Reports/2026-05-29-re-audit-gate.md`) and user adjudication, the gate is re-baselined against **AST-counted floors + ceiling tests**:

| Metric | Original target | Re-baselined target | Locked by |
|---|---|---|---|
| `as any` | ≤245 | ≤106 (current actual) | none yet — candidate for follow-up ceiling test |
| `as unknown as` | ≤40 | ≤67 | `packages/runtime/test/as-unknown-as-ceiling.test.ts` (WS-5b) |
| `as ComposableLayer` | = 0 | ≤3 (2 terminal mergeAll + 1 residual) | `packages/runtime/test/composable-layer-ceiling.test.ts` (WS-5c) |
| `Effect<X, unknown>` | ≤52 | ≤20 (AST-counted) | `packages/runtime/test/no-silent-swallow-floor.test.ts` (WS-5 Phase 2) |
| `console.warn` (active) | n/a | ≤9 | `packages/observability/.../console-ceiling.test.ts` (WS-5 Phase 3) |
| `console.error` (active) | n/a | ≤0 | (same) |
| Dead-surface (TagMap/ControllerDecision/Registry) | 0 | 0 | `packages/compose/test/anti-scaffold-tagmap.test.ts` (WS-4 Phase 6) + `decision-coverage.test.ts` (WS-4 Phase 2) + `harness-profile.test.ts` registry-drift guard |
| Lying-comment | 0 | 0 | manual audit (B-series clean) |
| AGENTS.md package-tree drift | 0 | 0 | `packages/core/tests/doc-drift.test.ts` (WS-5 Phase 4) |

**Rationale:** The original §5.5 thresholds were grep-derived and overcounted by 5× for `Effect<X,unknown>` and `console.*` (docstring + comment contamination). For `as unknown as` and `as ComposableLayer`, the residual is structurally legitimate type-widening at module/shim/dynamic-import boundaries — not silent swallow. The **4 active ceiling tests** (Phase 2/3 + WS-5b/5c) provide durable anti-regression mechanism replacing the one-time threshold gate.

**WS-6 status: UNBLOCKED 2026-05-29.** Follow-up structural work tracked separately:
- AgentEvent union expansion (channels owner)
- LLMConfig schema extension (llm-provider owner)
- ReasoningExecuteRequest typing (kernel owner)
- Anthropic SDK typings shim
- Effect.Cause refactor for errors.ts:355
- createLightRuntime ↔ createRuntime convergence (path to `as ComposableLayer` = 1)

---

## 6. Per-Workstream Anatomy

Each workstream gets a **thin spec doc** under `wiki/Planning/Implementation-Plans/2026-05-28-ws-N-<name>.md` with a uniform shape. The master plan does not duplicate per-WS detail.

### 6.1 Thin spec template

```markdown
---
title: WS-N — <name>
date: 2026-05-28
status: pending | in-progress | shipped | reverted
master-plan: 2026-05-28-canonical-refactor.md
root-cause-closed: RC-X
gh-issues-closed: [#N, #M, ...]
authoritative-anchor: <mission/algorithm citation>
owner-warden: <kernel-warden | runtime-warden | compose-warden | release-warden | none>
session-budget: <N hours / N days>
---

# WS-N — <name>

## Goal (one sentence — what is structurally different after this ships)
## Anchor (which mission statement / invariant this serves)
## Scope IN (exact file paths + exact change shapes)
## Scope OUT (explicit non-goals to prevent creep)
## Pre-conditions (what must be true before starting)
## Tests (RED before any code; specific assertions; existing-tests-that-must-still-pass)
## Verification protocol (commands run, counts asserted, evidence captured)
## Done criteria (falsifiable — each line is yes/no)
## Rollback plan (one revert commit or N reverts; what gets re-opened)
## Evidence artifact (where the post-ship report lives)
```

### 6.2 Workstream summaries (one paragraph each)

#### WS-1 — Release-Flow Residual Fixes (RC-5 REVISED — small bundle)

**Scope revised after warden audit 2026-05-28** (original premise invalidated; see §3.4 RC-5 REVISED). New scope:

1. **F2 typecheck fix** — add `embed: () => Effect.succeed([])` (or matching stub) to 8 mock `VerificationLLM` objects in `packages/verification/tests/{hallucination-detection,layers}.test.ts`
2. **F3 judge-server lockstep** — set `"private": true` in `packages/judge-server/package.json` + bump version 0.9.5 → 0.10.6
3. **F4 release.ts ordering** — move drift inspection BEFORE `npm whoami` gate in `scripts/release.ts:42-66` so `release:dry` functions without auth
4. **#165 cleanup** — `gh release delete v0.10.7 --yes`
5. **#159 close** — comment + close as invalid framing

NOT in WS-1 scope (premise invalidated): pkg.json stamping (intentional steady-state); tag backfill (already exists); publish.yml rebuild (not broken).

Owner: claude main thread + user authorization (release-warden's manifest is GATE/AUDIT only — refused execution dispatch with cause). Risk: LOW. Budget: ~30 min execution.

#### WS-2 — Runtime Layer Composition + Agent-Facade Type Truth (RC-1)

**Phase 1 — Mechanical pattern alignment:** Refactor `runtime.ts:215–940` (`createRuntime`) from mutation chain `let runtime; runtime = Layer.merge(runtime, X) as ComposableLayer` to collected array + terminal `Layer.mergeAll(layers) as ComposableLayer`. **The target shape already exists at `runtime.ts:1061` in `createLightRuntime`** — mirror that pattern. Preserves the team's deliberate `ComposableLayer` type-erasure decision (lines 55-76 document why). Predicted impact: 44 ComposableLayer casts → 1.

**Phase 2 — Co-located public type truth:**
- Surface `AgentResult.debrief: AgentDebrief | undefined` on public type (closes #162 + collapses 4+ casts at CLI/cortex/playground)
- Discriminate `AgentEvent` union on `_tag` for narrowing in user code (closes #163 + collapses 13+ casts at cortex/ui)
- Add `ReactiveAgentInternalView` interface OR re-type `queryGatewayStatus`/`startGateway` receivers in `agent/gateway-runner.ts` to remove the 2× `this as any` casts at reactive-agent.ts:1385,1413 (HS-A-01)

**Phase 3 — Builder API discipline (AMENDED 2026-05-29; original @deprecated approach REVERTED via CORRECTION 1+2):** ~~Mark redundant withers `@deprecated alias for HarnessProfile.{lean,balanced,intelligent}()`.~~ Fluent `.withX()` methods stay first-class + non-deprecated (documented happy path). HarnessProfile presets + `.compose()` are additive shortcuts. Each fluent method carries a `@see`/"Composable equivalent:" pointer to the composable path. Quickstart docs present BOTH the fluent path AND HarnessProfile, framed as complementary. Withers stay fully supported, not deprecated.

**Scope explicitly OUT of WS-2:**
- Rewriting layer construction logic (each individual layer's internals)
- Decomposing `runtime.ts` further (WS-6 territory)
- Touching `kernel/` capabilities (WS-3 territory)

Owner: runtime-warden. Estimated 1 session for Phase 1; 1 session for Phase 2+3.

#### WS-3 — Kernel `act/` Decomposition + Capability DAG (RC-2)

**Phase 1 — Mechanical substrate move (high-confidence, low-risk):** Move `act/tool-parsing.ts` (255 LOC, 2 inbound) → `kernel/utils/tool-parsing.ts`. It is pure regex + parsing helpers (`FINAL_ANSWER_RE`, `extractFinalAnswer`, `evaluateTransform`) with zero state coupling. Update 2 import sites in `decide/arbitrator.ts` + `reason/think.ts`. Predicted impact: 2 cross-edges eliminated; no behavior change.

**Phase 2 — Architectural-review decision (`act/tool-gating.ts`):** Tool gating is `planNextMoveBatches` + `gateNativeToolCallsForRequiredTools` + `isParallelBatchSafeTool`. The architectural question: gating is "which subset of permitted tools to fire" — that's a **Decide** concern (pre-Act filter), NOT an Act concern (Act executes what Decide selected). Three candidate dispositions:
- **(a)** Move to `decide/tool-gating.ts` — semantically cleanest; mission Decide owns "select exactly ONE action."
- **(b)** Move to `comprehend/tool-gating.ts` — gating reads required-tools (a Comprehend signal); could co-locate.
- **(c)** Keep in `act/`, expose via `ToolGatingService` Tag — minimal file movement.
Thin spec resolves via short ADR. Predicted impact: 4 cross-edges either eliminated or routed through Tag.

**Phase 3 — `act/tool-execution.ts` Tag-based contract:** Tool-execution.ts is kernel-state-coupled and IS the canonical Act capability owner per mission. Do NOT relocate. Instead: introduce `ToolExecutionService` Tag in `core/services/`; other capabilities (3 inbound from `reason/think-guards.ts` for `makeObservationResult`, `extractObservationFacts`) consume the Tag, not the file path. Predicted impact: 3 file-path imports → 0; leaf principle restored.

**Phase 4 — Cycle audit + ESLint boundary rule:** After Phase 1–3, re-walk cross-import graph. Document any remaining cycles in `wiki/Research/Refactor-Reports/2026-05-28-ws-3-import-graph.md` (first-hand evidence). Add ESLint rule banning capability-to-capability internal imports (cross-cap imports must route through `core/services/` Tag or `kernel/utils/`). Predicted impact: 3 confirmed cycles (act↔decide, act↔reason, reason↔verify) collapse to ≤1 (act↔decide may remain as a true cross-cap dep worth analysis).

**Phase 5 — runner.ts emit relocation:** Audit the 39 emit-related lines in `runner.ts`. For each: is the emit a loop-control concern (legitimate at runner) or a capability concern (belongs at capability boundary)? Move capability-concern emits to the owning capability. Predicted impact: ~20–30 of 39 emit calls relocate; runner.ts LOC drops to ~1800 (still oversized; full WS-6 re-decomp later).

**Evidence prerequisite:** import-graph dump committed to `wiki/Research/Refactor-Reports/2026-05-28-ws-3-import-graph.md` BEFORE Phase 1 begins. Already partially captured in §3.6 F2 above.

Owner: kernel-warden. Estimated 2 sessions (Phase 1+2 = session 1; Phase 3+4+5 = session 2).

#### WS-4 — Anti-Scaffold Purge (RC-3)

For every declared surface element without paired live emit + consumer: ship the wiring in this WS, OR delete the declaration. Disposition table:

- ~~`@reactive-agents/observe` package (#170): wire one demo consumer in `examples/` + add to umbrella, OR remove from monorepo.~~ **✅ DONE 2026-05-29 (commits `7ff68084` RED + `5c6f5fa1` GREEN)** — wired umbrella sub-export + apps/examples/src/observe/otel-export.ts (O29) + bonus extraOptLayer EventBus wiring fix at `runtime.ts:926`.
- ~~5 unused M12 hooks (K-08): wire or remove (commit by commit).~~ **✅ ALREADY DONE 2026-05-24** — spec premise stale. Per `packages/llm-provider/tests/m12-provider-adapter-hooks.test.ts` header (HEAD): the original 7 numbered M12 hooks were audited 2026-05-24; 6 declarations with zero call sites + zero impls were removed from `ProviderAdapter`; `parseToolCalls` is the surviving numbered hook (wired across all 5 providers via `selectAdapter`). The 7 named ProviderAdapter methods on `localModelAdapter` (systemPromptPatch / taskFraming / toolGuidance / continuationHint / errorRecovery / synthesisPrompt / qualityCheck) all retain ≥1 production call site under `packages/reasoning/src/` (verified-by `grep adapter\\.<hook>` 2026-05-29). No Phase 4 production code required.
- ~~4 dead Compose tags (G-9 / #112): wire in capability emit (depends on WS-3 boundaries).~~ **✅ DONE in WS-4 Phase 1 (2026-05-28 verified) + Phase 6 (2026-05-29)** — 7/7 TagMap entries have emit+consumer pairs; Phase 6 plugged 2 emits firing into void (`nudge.loop-detected`, `lifecycle.failure`) with documented consumers in `apps/examples/src/advanced/20-compose-harness.ts`. Gate pinned at `packages/compose/test/anti-scaffold-tagmap.test.ts` (commit `9f99afda`).
- ~~`confidenceFloor` killswitch (#160): ship or unship + docs delta.~~ **✅ DONE in WS-4 Phase 5a (2026-05-29 commit `baf459b8`)** — unship-mode confirmed; docstring at `builder.ts:1362-1370` no longer lists confidenceFloor in the killswitch set; honesty footnote added citing `compose/test/killswitches.test.ts` un-registration assertion.
- `strategy-switching` registry entry with null liftEvidence (cf-25): gather evidence OR convert to opt-in.
- **Verifier severity ladder (#121)** ~~severity-ladder scaffold~~ **✅ ALREADY SHIPPED (issue CLOSED on GH; verified 2026-05-29)**. Severity contract typed at `packages/reasoning/src/kernel/capabilities/verify/verifier.ts:126` (`VerificationSeverity = "pass" | "warn" | "reject" | "escalate"`); helpers `checkSeverity()` (line 159) + `resolveResultSeverity()` (line 229); 4 producer sites (lines 280, 295, 322, 500); aggregation `hasEscalate` → `overallSeverity` (lines 582-587); arbitrator escalate consumption at `decide/arbitrator.ts:491,939,1052`. F4 reproduction success metric pinned at `packages/reasoning/tests/kernel/capabilities/verify/verifier.test.ts:335` ("rationale XML leak → output-not-harness-parrot severity=reject"). No production code required.
- **Cross-session skill persistence default-on (#122)** ~~verify default+evidence pair~~ **✅ ALREADY SHIPPED (issue CLOSED on GH; verified 2026-05-29)**. Per `packages/runtime/src/builder.ts:185,309,667`: `_enableMemory: boolean = true` + `_skillPersistence?: boolean = undefined` ⇒ default-on policy. Test coverage: `packages/runtime/src/__tests__/builder-with-skill-persistence.test.ts` invariants (a)(b)(c)(d) — invariant (d) explicitly pins "skillPersistence unset + enableMemory:true → wired". Cross-session lift evidence: `packages/memory/tests/skill-cross-session-recall.test.ts` ("M6 acceptance: >70%"). Memory ref [[project_v011_1_shipped]] confirms HS-122 graduated 2026-05-22 via commit `44e4fbcf`. No production code required.

Owner: compose-warden (Compose) + ablation-warden (registry).

#### WS-5 — Honesty Pass (RC-4)

Define tagged-error algebra under `core/errors/` (or appropriate canonical location). Migrate 105× `Effect<X, unknown>` to `Effect<X, TaggedError>` in priority order (runtime first, then reasoning, then RI). Replace `console.warn` bypass sites with ObservabilityService routes. Remove leftover `DEBUG_VERIFIER console.error`. Fix lying comments at `gateway-bootstrap.ts:236`. Add CI doc-drift gate: AGENTS.md tree diff against `ls packages/*/package.json` (#171 K-04 recommendation). Owner: cross-cutting (multiple wardens).

---

## 7. Verification Discipline

This section is non-negotiable. It applies to every workstream.

### 7.1 TDD (RED → GREEN → ANALYSIS)

Per `agent-tdd` skill discipline:

1. **RED first.** Before any production code, write a test that fails for the right reason. No code without a red test.
2. **GREEN minimal.** Write only enough to make the red test green. No "while I'm here" additions.
3. **ANALYSIS.** Run the broader test suite. Run the verification commands declared in the thin spec. Confirm verified-by counts. No completion claim without the recheck output captured.

### 7.2 Verified-by counts

Every WS thin spec MUST cite `verified-by:` evidence for each "Done criterion" line, using the same convention as `codebase-health-sweep`: `grep -ro pattern packages/ | wc -l` produces a count; the PR body shows before/after.

### 7.3 No silent swallow during refactor

Refactor commits MUST NOT introduce new `Effect<X, unknown>` declarations or new `console.warn` bypass sites. If a refactor surfaces a swallow that pre-existed, it is fixed in the same commit OR documented as a follow-up issue with explicit `verified-by` cite.

### 7.4 Cross-tier ablation on default-on changes

If a WS changes a default-on capability (registry entry flip, behavior change visible to users), it MUST route through `ablation-warden` per pilot discipline:

- ≥2 model tiers probed (frontier + local large minimum)
- ≥3pp lift required to default-on; ≤15% token overhead ceiling
- Failure → opt-in only or removal

### 7.5 Branch + PR + warden ownership

- Each WS = own branch off `origin/main`: `refactor/ws-N-<short-name>`
- Each WS = one PR with `Closes #X, #Y, #Z` + verified-by table + evidence-artifact link
- Wardens dispatch with MissionBrief; deliver with UpwardReport
- No direct-to-main pushes

### 7.6 Stop-the-line conditions

Halt the sequence if any of:

- Build goes red on `main` (fix-forward in a hotfix, do not push WS work over a broken main)
- A WS verification gate fails after best-effort fix (diagnose; do NOT proceed to next WS)
- Re-audit gate after WS-5 misses threshold (do NOT start WS-6; rework whichever upstream WS underdelivered)

### 7.7 Evidence artifacts

Every WS produces an artifact under `wiki/Research/Refactor-Reports/2026-05-28-ws-N-<name>.md` containing:

- Before/after verified-by counts
- N=1 (or N=3 if ablation) probe results
- Cross-cutting test deltas
- Any newly discovered issues filed with GH numbers

---

## 8. Done = ? (foundation canonical end-state)

The refactor's foundation is declared canonical when ALL of the following hold simultaneously:

### 8.1 Structural (auto-checkable — ABSOLUTE thresholds; baselines first-hand 2026-05-28)

- [ ] `as ComposableLayer` count = **1** in `runtime.ts` (terminal cast at `Layer.mergeAll`); = **0** elsewhere (from baseline 44 in runtime.ts; 0 elsewhere)
- [ ] `as any` count in `packages/*/src/` (production, excluding tests) ≤ **50** (from baseline 113)
- [ ] `as any` count in `packages/runtime/src/` ≤ **15** (from baseline ~30+)
- [ ] `as unknown as` count in `packages/*/src/` ≤ **20** (from baseline 74)
- [ ] `as Context.Tag.Service` count ≤ **2** (from baseline 4)
- [ ] `Effect<X, unknown>` count in `packages/*/src/` ≤ **15** (from baseline 34)
- [ ] `Effect<X, unknown>` count in `packages/runtime/src/` = **0** (no silent swallow at the seam)
- [ ] `console.warn` bypassing ObservabilityService in `packages/*/src/` = **0** (from baseline 27)
- [ ] `console.error` in `packages/*/src/` = **0** (from baseline 24; all routed through ObservabilityService or removed)
- [ ] `act/` capability dir LOC ≤ **1900** (from baseline 3053; tool-parsing extracted, tool-gating ADR resolved, tool-execution stays with Tag contract — net est. 1495-1900 LOC depending on Phase 2 disposition)
- [ ] Kernel capability dirs form DAG (zero cycles; first-hand walk + CI lint; baseline 3 cycles)
- [ ] `state.status =` raw assignment sites ≤ **10** (from baseline 27; migrate to `transitionState()`)
- [ ] Other raw `state.X =` mutations ≤ **10** (from baseline ~33)
- [x] ~~`builder.ts` `withX()` method count ≤ **30**~~ **AMENDED 2026-05-29 (CORRECTION 1+2): count is not the metric.** Instead: documented happy-path withers EXIST + are NOT `@deprecated`; HarnessProfile/`.compose()` additive; gate `builder-wither-discipline.test.ts` locks happy-path first-class. LOC ceiling tests removed (cohesion over line-count).
- [ ] `HarnessProfilePatch` type derives from CapabilityRegistry entries (no hard-coded boolean fields)
- [ ] `StrategyFn` input shape ≤ **15 fields** (from baseline 30+; substrate-derived context object)
- [ ] Every entry in TagMap / ControllerDecision union / CapabilityRegistry has paired emit + consumer (CI lint)
- [ ] All 35 packages appear in AGENTS.md package tree (CI diff)
- [ ] ~~No production file >1500 LOC~~ **AMENDED 2026-05-29: LOC ceiling tests removed (CORRECTION 4). File health judged by COHESION, not line count.** WS-6 decomposes only where a genuine cohesive sub-unit exists; a single cohesive unit is left large rather than split to satisfy a number. (LOC stays a soft signal for "look here for cohesion opportunities," never a gate.)
- [ ] `runner.ts` emit-related line count ≤ **30** (architecture model §12.2a amendment; runner-orchestrated emits legitimate; WS-3 Phase 5a+5b shipped capability-event migrations for verifier-verdict + BudgetSignal)

### 8.2 Behavioral (test-checkable)

- [ ] Workspace test pass rate ≥99% (current baseline: 3219/3219)
- [ ] Build green (38/38 turbo tasks)
- [ ] Type-check clean across all packages
- [ ] At least N=3 cross-tier ablation on any default-on change passes ≥3pp lift gate

### 8.3 Surface (consumer-checkable)

- [ ] `AgentResult.debrief` on public type; zero `as` casts to access it
- [ ] `AgentEvent` discriminates on `_tag` in TypeScript inference; zero casts to narrow
- [ ] `withLeanHarness()` and `HarnessProfile.*()` semantics match registry truth
- [ ] Every documented capability in README has a live wired runtime path
- [ ] Version-drift impossible (WS-1 release-flow structurally enforces stamping pre-tag)

### 8.4 Documentary (writer-checkable)

- [ ] AGENTS.md package tree matches actual `packages/*/`
- [ ] `04-PROJECT-STATE.md` reflects current shipped state (not 30+ days stale)
- [ ] North Star §4.3 capability-dir list verified against code
- [ ] No "@deprecated v0.10.0 — Removed in v0.11.0" zombie comments

---

## 9. What This Plan Explicitly DOES NOT Do

Out of scope. Each has its own existing or proposed home; not blurring into this refactor:

- **Memory v2 design** (`2026-05-23-memory-v2-design.md`) — not blocked by this refactor; separate track.
- **HeavyDream multi-iter L4 harness** — speculative, no PR substrate.
- **HITL bridge IX1** — separate roadmap item.
- **τ²-bench external publication** — Phase F gate.
- **Browser/computer-use primitive (G-K)** — decision pending; not refactor work.
- **Audio/video/PDF modality (G-E)** — demand-driven.
- **Consolidation of verification/prompts/interaction/benchmarks/scenarios/health** — value-extraction; not structural; deferred.
- **New strategies (7th, 8th)** — capability set is complete enough; new strategies come after combinator substrate (separate effort).
- **Multi-agent orchestration depth (G-G)** — needs spike before this refactor's foundations matter to it.
- **L3 outcome metrics (gate-corpus runs)** — measured separately; this refactor makes the measurement trustworthy.

---

## 10. How This Plan Interacts With Existing GH Issues

| Issue cluster | Disposition |
|---|---|
| #104–#109 (Phase 0 convergence) | ✅ Already closed |
| #110–#111 (Phase 0.5 cost gates) | Folded into **WS-7** |
| #112 (RI→Compose bridge — light 4 dead tags) | **WS-4** (dead-surface — emit source missing) |
| #113 (capability-scoped emit, closes F1) | **WS-3** (emit-at-boundary mechanism) |
| #114 (transitionState() discipline + ESLint rule) | **WS-3** (boundary lint) |
| #115 (required-tool nomination via comprehend emit) | **WS-3** (capability emit) |
| #116 (ControllerDecision union prune — 8 dead variants) | **WS-4** (scaffold purge) |
| #117 (emitLLMExchange at provider boundary) | **WS-3** (reason boundary) |
| #118 (plan-execute synthetic kernel state contract test) | **WS-3** (boundary contract) |
| #119 (triple compression coordination) | **WS-4** (consumer-side coordination) |
| #120 (open `learn/` capability) | **WS-4** (verify wiring; dir already exists) |
| #121 (multi-severity verifier) | **WS-4** (severity-ladder scaffold) |
| #122 (cross-session default-on) | **WS-4** (verify default+evidence pair) |
| #123–#125 (Phase 3 compounding) | Folded into **WS-7** |
| #151–#158 (audit iter 1) | Folded into **WS-4** + **WS-5** by category |
| #159 (P0 release flow) | **CLOSE AS INVALID** (warden audit 2026-05-28: workspace lag is intentional steady-state per release.ts:205-208 comment; tags exist on origin) |
| #160 (confidenceFloor docs lie) | **WS-4** |
| #161 (doc-drift bundle) | **WS-5** |
| #162 (AgentResult.debrief gap) | **WS-2** |
| #163 (AgentEvent narrowing) | **WS-2** |
| #164 (CLI template `as any`) | **WS-2** (downstream effect) |
| #165 (orphan v0.10.7 draft) | **WS-1** |
| #166 (MetricsCollectorTag in tests) | **WS-5** |
| #167 (RuntimeAssembly refactor) | **WS-2** |
| #168 (105 Effect<X, unknown>) | **WS-5** |
| #169 (kernel mesh + 7 cycles) | **WS-3** |
| #170 (dead surfaces — observe + M12) | **WS-4** |
| #171 (manifest/doc drift) | **WS-5** |

---

## 11. Amendment Log

| Date | Change | Reason |
|---|---|---|
| 2026-05-28 | Initial draft. | Replace prior master plans (treated as reference); plan from current main + 2026-05-27 audit + canon anchors. |
| 2026-05-28 (amend 1) | First-hand audit pass corrected numerical baselines + reframed RC-1 + reframed RC-2 around `act/` monolith finding. | Prior-audit numbers were 2–4× inflated; runtime.ts `ComposableLayer` is a documented engineering choice (Effect union explosion), not service-locator anti-pattern; `act/` conflates capability + tool substrate which is the actual mesh generator. |
| 2026-05-28 (amend 2) | Deep-audit of runtime.ts + act/* + reactive-agent.ts + runner.ts + arbitrator.ts + builder.ts. Added §3.6 (six structural facts F1-F6). Refined WS-2 + WS-3 with phased + differential-mobility decisions. | User-directed deep read of the seams to "fully understand the problem space before designing the ideal architecture." Found: (F1) `createLightRuntime` already uses target pattern; (F2) `act/tool-*` files have differential mobility — not all are substrate; (F3) capabilities DO emit; runner.ts emit calls need per-call audit; (F4) arbitrator.ts canonical owner intact; (F5) builder.ts 59 withers; (F6) reactive-agent.ts `this as any` casts have a 1-line fix. |
| 2026-05-28 (amend 3) | Read CapabilityRegistry + HarnessProfile + RI package surface + StrategyRegistry + state-mutation counts. Added §3.6 F7-F11 + extended §8.1 done-criteria. | Both audit tracks per user. Found: (F7) CapabilityRegistry clean; HarnessProfile patch has growth risk; (F8) RI is 50+ exports framework piece; (F9) StrategyFn input has 30+ fields — Pillar 3 violation; (F10) 27 raw `state.status=` mutations vs ≤10 target = 2.7× Pillar 4 violation. |
| 2026-05-28 (amend 4) | RC-5 reversal. Release-warden Phase 0 audit invalidated original framing; workspace pkg.json lag is intentional steady-state. WS-1 scope reduced from "structural release flow rebuild" to small bundle: F2 (typecheck embed stubs) + F3 (judge-server private+lockstep) + F4 (release.ts ordering) + #165 delete + #159 close-invalid. | First-hand reproduction of warden findings (`git ls-remote --tags origin v0.10.6 v0.11.1` returns both, `npm view @reactive-agents/judge-server` returns 404, `cd packages/verification && bun run typecheck` shows 8 TS2345 errors). Prior audit (HS-F-04 + HS-H + #159) read symptoms without reading `release.ts:205-208` rationale comment. |

---

## 12. Acceptance

This plan is accepted when:

1. The user approves the sequence (Pre-flight → WS-1 → WS-2 → WS-3 → WS-4 → WS-5 → re-audit → WS-6+).
2. Each thin per-WS spec (WS-1..5) is authored and reviewed before its execution begins.
3. The first execution begins (Pre-flight commit) only after the above two conditions hold.

Until the user accepts, no production code changes. Plans and thin specs are written, that is all.

---

*The framework's canon is already correct. This plan exists to bring the runtime to canon, in a sequence whose first move makes every subsequent move cheaper, with a verification gate at every step, and an auditable evidence artifact after every workstream.*
