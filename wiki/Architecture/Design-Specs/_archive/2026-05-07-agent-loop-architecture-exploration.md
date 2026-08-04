---
type: design-exploration
status: draft
created: 2026-05-07
authored-by: Claude (Opus 4.7) + Tyler
related:
  - "[[wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md]]"
  - "[[wiki/Architecture/Design-Specs/2026-05-06-compose-harness-api.md]]"
  - "[[wiki/Planning/Implementation-Plans/2026-05-07-phase-a-w23-execution-engine-decomposition.md]]"
phase: A (W23 continuation)
---

# Agent-Loop Architecture Exploration

**Question:** Before extracting the 1,950-LOC agent-loop, what's the IDEAL architecture given everything we have planned for it? What enhancements should we design for now so we don't redo the work later?

**Answer (TL;DR):** Keep the agent-loop as a single `Phase` value at the engine level, decomposed internally into sub-modules. Most planned enhancements (sub-agents, code-as-action, snapshot/replay) don't require structural changes to the engine's agent-loop — they live in other packages. The two structural changes that DO matter and should be designed in now: (1) unify the dual LLM-call paths, (2) make compose API injection points explicit per sub-module.

---

## 1. The two LLM-call paths (the real source of 1,950 LOC)

The current agent-loop has **two parallel implementations** of the same logical loop:

| Path | When used | Lines |
|---|---|---|
| **ReasoningService path** | When `ReasoningService` is wired (most production runs) | ~600 LOC (1271–1928) — delegates to kernel runner |
| **Inline LLM-call path** | Cortex run-tab chat, streaming runStream, no-reasoning fallback | ~600 LOC (2250–2835) — direct LLM call + tool dispatch |

These share concerns (LLM call, tool execution, observation handling, hook firing) but live in two places. **Unifying them is the single highest-leverage architectural improvement** for the agent-loop.

The unifying abstraction already exists conceptually: both paths are "execute one or more iterations of (LLM → tool dispatch → observation)." The kernel runner does this with a phase composition; the inline path does it with imperative code.

**Recommendation:** the inline path should delegate to a shared "iteration kernel" — either the existing `runner.ts` in some configurable form, or a simpler shared sub-module. This deduplicates ~600 LOC.

---

## 2. Inventory of planned/desired enhancements that touch the agent-loop

### Phase 1.5 (Mechanism Improvements)

| Mech | Enhancement | Touches agent-loop? |
|---|---|---|
| **M3** Verifier retry tuning for cogito:14b | Content (retry context strings, temperature) | No structural change |
| **M6** SQLite skill persistence | Bootstrap reads persisted skills | Bootstrap, not agent-loop |
| **M7** ≥8 calibration field consumers | Wire more `ModelCalibration` fields into decisions | Yes — content, but in sub-modules |
| **M8** Sub-agent real-LLM metrics | Measure delegation effectiveness | No structural change |
| **M10** Multi-session memory recall | Memory service multi-session support | No agent-loop change |

### Phase B (Compose API)

24 injection points across 5 namespaces. Most live INSIDE the agent-loop:

| Tag namespace | Examples | Where in agent-loop |
|---|---|---|
| `prompt.*` | `prompt.system`, `prompt.task` | Setup (system prompt build), kernel-call (task formatting) |
| `message.*` | `message.tool-result` | Tool dispatch (after tool returns) |
| `nudge.*` | `nudge.loop-detected`, `nudge.healing-failure` | Inside kernel runner, not engine agent-loop |
| `tool.*` | `tool.call-started`, `tool.transform-args`, `tool.transform-result` | Tool dispatch |
| `observation.*` | `observation.tool-result`, `observation.verifier-retry` | Tool dispatch (post-process), verify (retry path) |

**Implication:** the agent-loop's sub-modules need to be designed with **explicit instrumentation points** — places where the harness pipeline is consulted for any registered interceptors. Phase B's `.compose()` work then becomes "wire the pipeline call at the marked point" rather than "find the right line to hook into."

### Phase D (Code-as-Action Strategy)

- Adds 6th reasoning strategy (`packages/reasoning/src/strategies/code-action.ts`)
- Strategy emits Python code blocks that compose tools as function calls
- Sandbox execution via Bun.spawn or E2B

**Where the work lives:** entirely in `packages/reasoning`. The engine agent-loop calls `ReasoningService.execute(...)` with the strategy ID; the reasoning package handles the rest. Tool dispatch is the same shape (parsed tool calls).

**No engine agent-loop changes needed.**

### Phase E (Local Model Engineering)

- **Per-provider tool-call parser** — `ProviderAdapter.parseToolCalls(rawResponse, modelId, runtimeVersion)` in `packages/llm-provider`. Engine's tool-dispatch module just calls the adapter.
- **Calibration consumer activation** — wire `parallelCallCapability`, `interventionResponseRate`, `tokenEfficiency`, etc. into agent-loop decisions. **Content** changes within sub-modules.
- **Tool-result paging** — 50KB per-tool / 200KB per-message caps. Lives in `kernel/capabilities/attend/context-utils.ts`.

**Implication for agent-loop refactor:** sub-modules should declare typed dependencies on specific calibration fields. Then "activating field N" becomes a one-line wiring change in the relevant sub-module, not a hunt through 1,950 LOC.

### Phase 6 / Snapshot/Replay (Phase C)

- `agent.replay(traceId, overrides)` — replay a recorded trace with modified prompts/models, holding tool results constant
- Uses existing `packages/trace` + service injection

**The mechanism:** at replay time, the engine is constructed with mocked services:
- `LLMServiceMock` — returns recorded responses, optionally with prompt/model overrides causing re-execution
- `ToolServiceMock` — returns recorded tool results

The pipeline runs unchanged. The phase-as-data architecture already supports this because each phase reads its services from `PhaseDeps` (which the engine builds from whatever services are wired).

**No engine agent-loop changes needed.**

### Sub-agent enhancements (mostly Phase 1.5 + future)

Old roadmap items, re-stated against the current architecture:

| Enhancement | What it is | Touches agent-loop? |
|---|---|---|
| **Result passthrough** | Sub-agent returns raw value, not wrapped narrative | Tool-dispatch result handling |
| **Tool scoping** | Parent specifies child's tools via `spawn-agent` args | Spawn-agent tool implementation |
| **Directive prompts** | Child gets more explicit prompts | Spawn-agent tool implementation |
| **Iteration optimization** | Child has smarter iteration cap | Spawn-agent config |
| **First-class capability** | `delegate(task)` instead of `spawn-agent` tool | **Yes — bigger refactor** |

The first four are content/config concerns inside the spawn-agent tool. The fifth (making sub-agents a first-class capability rather than a tool) is a v0.13+ migration that requires:
- New phase type or capability for delegation
- DelegationResult typed return
- Recursive engine instantiation as a first-class operation

**Recommendation: defer first-class sub-agents to v0.13.** For W23, sub-agents stay as tools. The agent-loop's tool-dispatch sub-module should mark sub-agent invocations in traces (`isSubagentCall`) for telemetry.

---

## 3. The ideal agent-loop architecture

```
packages/runtime/src/engine/phases/agent-loop/
├── index.ts                  ← AgentLoopPhase: orchestrator
│                                run(): setup → cache-check → kernel-call → finalize
├── state.ts                  ← AgentLoopState: typed bundle for cross-iteration mutable state
│                                (entropyLog, toolCallLog, classifiedTools, calibration, cacheHit)
├── setup/
│   ├── calibration.ts        ← Resolve ModelCalibration from config + observations
│   ├── classifier.ts         ← LLM tool classification (parallelCallCapability, classifierReliability)
│   ├── budget.ts             ← Auto per-tool budget derivation
│   └── tools-registry.ts     ← Single tool-defs fetch, allowedTools mismatch warn
├── cache-check.ts            ← Semantic cache check; can short-circuit to finalize
├── kernel-call.ts            ← Build ReasoningService options + invoke
│                                (UNIFIES the two paths — see §1)
├── post-kernel.ts            ← Capture final state from kernel result
└── finalize.ts               ← Build context summary, prepare for VERIFY phase

Compose API instrumentation points (Phase B prep):
├── INJECT prompt.system        — setup/tools-registry.ts (system prompt assembly)
├── INJECT prompt.task          — kernel-call.ts (task formatting)
├── INJECT message.tool-result  — kernel-call.ts (post tool execution; also kernel runner)
├── INJECT tool.transform-args  — kernel-call.ts (before tool dispatch)
├── INJECT tool.transform-result — kernel-call.ts (after tool dispatch)
└── INJECT observation.tool-result — kernel-call.ts (observation building)

Calibration consumers (Phase E activation targets):
├── setup/classifier.ts         reads: classifierReliability, parallelCallCapability
├── setup/budget.ts             reads: minCalls, retryBuffer
├── kernel-call.ts              reads: reasoningDepth, interventionResponseRate
└── (other phases): cost-track  reads: tokenEfficiency
                    verify      reads: verificationFidelity, verificationConfidenceThreshold
```

**Total estimate: ~900 LOC across 8 sub-modules**, replacing 1,950 LOC of inline code. The reduction comes mainly from unifying the dual LLM-call paths.

---

## 4. What this refactor enables

| Future work | Without ideal architecture | With ideal architecture |
|---|---|---|
| **Phase B (Compose API)** | Hunt 1,950 LOC for hook points; risk of inconsistent wiring | Each sub-module has marked instrumentation points; wiring is mechanical |
| **Phase E (Calibration consumers)** | Find right place to read field; thread through closures | Sub-module declares typed calibration deps; activation = wire the field |
| **Phase D (Code-as-Action)** | No change needed | No change needed |
| **Snapshot/Replay** | No change needed | No change needed |
| **Sub-agent improvements (M8)** | Spawn-agent tool changes; mark traces | Same; sub-agent depth tracking is in `state.ts` |
| **First-class sub-agents (v0.13+)** | Bigger refactor needed | Easier — `act` is one sub-module that can be extended |

---

## 5. Pre-extraction prerequisites

Before code moves, three preparation steps that pay rent across all future enhancements:

### 5.1 Cross-phase state inventory

Read the entire current agent-loop and classify every closure variable:

| Variable | Classification | Lives where |
|---|---|---|
| `cachedToolDefs` | Cross-phase state | `state.ts` |
| `effectiveRequiredTools` | Cross-phase state | `state.ts` |
| `effectiveRequiredToolQuantities` | Cross-phase state | `state.ts` |
| `classifiedRelevantTools` | Cross-phase state | `state.ts` |
| `resolvedCalibration` | Cross-phase state | `state.ts` |
| `cacheHit` | Cross-phase state | `state.ts` (currently on ctx.metadata as forward-compat shim) |
| `entropyLog` | Cross-phase state | `state.ts` |
| `toolCallLog` | Cross-phase state | `state.ts` |
| `complexity` | Phase-local in setup | inline |
| `taskCategory` | Per-task constant | `PhaseDeps` |
| `sessionId` | Per-task constant | already on ctx |
| (others — TBD during inventory pass) | | |

### 5.2 Compose API injection-point map

For each sub-module, document which Phase B tag fires there. The map above (§3) is the starting point; refine during extraction.

### 5.3 Cache-hit integration test

The current `ctx.metadata.cacheHit` forward-compat shim is unverified — no test exercises an actual cache-hit path. Add an integration test BEFORE refactoring agent-loop:

```ts
// packages/runtime/tests/semantic-cache-hit.test.ts
test("cache hit short-circuits agent-loop and propagates to cost-track", async () => {
  // Pre-populate semantic cache with a known task → response mapping
  // Run agent with that exact task
  // Assert: no LLM call, no tool calls, response is from cache, cost-track records cachedHit=true
});
```

This locks in the cache-hit behavior so the refactor can't silently break it.

---

## 6. Recommendation

**For W23 continuation (next session):**

1. ✅ Write this exploration doc (DONE — this file)
2. Add cache-hit integration test (1 test, ~50 LOC)
3. Read agent-loop body, complete the cross-phase state inventory in §5.1
4. Decide unification approach for the dual LLM-call paths (delegate inline path to kernel runner with config flag, OR extract shared "iteration kernel" sub-module)
5. Extract setup sub-modules (calibration, classifier, budget, tools-registry) — relatively independent, can use TDD
6. Extract cache-check (with cache-hit short-circuit explicit)
7. Extract kernel-call (the big one — unifies dual paths)
8. Extract post-kernel + finalize
9. Wire `agent-loop/index.ts` Phase value
10. Run full test suite + cross-package typecheck + N=3 corpus

**Estimated effort:** 2-3 focused sessions. Materially harder than the 9 phases extracted so far.

**Deferred to later phases:**
- First-class sub-agents (v0.13)
- Phase B compose-pipeline wiring (Phase B's job; this refactor just marks injection points)
- Phase E calibration field activation (Phase E's job; this refactor just declares typed deps)
- Phase D code-as-action (lives in reasoning package)
- Snapshot/Replay (Phase C; uses existing pipeline)

---

## 7. Decision points for the user

Before next session begins, two open questions:

1. **Unification approach for the dual LLM-call paths.** Two options:
   - (a) **Delegate inline path to kernel runner** with a "no-strategy" config flag. Simpler. The kernel runner becomes the single iteration loop. Possible drawback: the inline path was added because the kernel runner was too heavyweight for chat/streaming use cases.
   - (b) **Extract a shared "iteration-kernel" sub-module** that both `ReasoningService.execute` and the inline path can call. More work but preserves separation.

2. **Sub-agent enhancement scope for v0.11/v0.12.** The four "content/config" improvements (result passthrough, tool scoping, directive prompts, iteration optimization) can ship without architectural changes. Should they be folded into the agent-loop refactor work, or scheduled separately?

These decisions inform the W23 next-session tactical plan.

---

_Status: DRAFT — pending user feedback on §7 decision points._
_Authored: 2026-05-07 by Claude (Opus 4.7) at Tyler's request to explore agent-loop architecture before extraction._

---

## 8. Decisions resolved (2026-05-07)

### 8.1 Dual LLM-call path unification → "direct" reasoning strategy

**Decision:** Add a `direct` strategy to `packages/reasoning/src/strategies/direct.ts` that performs single-shot LLM call with optional one-round tool dispatch. Engine ALWAYS goes through `ReasoningService.execute(strategyId)`. The current inline LLM-call path is removed.

**Rationale:**
- Single uniform engine code path
- Strategy abstraction becomes complete — any LLM-driven flow is a strategy
- Streaming still works (kernel already supports it via callbacks)
- Cortex chat / runStream / no-reasoning use cases get `direct` strategy with `streamingEnabled: true, maxIterations: 1`
- Eliminates the ~600 LOC inline duplication

**Implementation note:** `direct` strategy can early-return after the single LLM call to skip kernel runner's full options-validation overhead. The strategy module is probably ~150-200 LOC.

**Consequences:**
- Engine's `agent-loop/kernel-call.ts` becomes simpler — no `if (reasoningOpt._tag === "Some")` branch
- The "no-reasoning fallback" in execution-engine becomes "use `direct` strategy"
- Strategy registry now has 6 strategies (5 existing + `direct`); 7 after Phase D ships `code-action`

### 8.2 Sub-agents as first-class capability — design inspired by Claude Code

**Decision:** Promote sub-agents from `spawn-agent` tool to first-class `DelegateCapability`. Inspired by Claude Code's `Agent` tool model (typed personalities, tool scoping per type, isolation modes, background execution, parallelization).

**Three new constructs:**

1. **`AgentTypeDefinition`** — registered, reusable personality with curated tool subset, system prompt, default model. Registered via `.withAgentType({ name, tools, systemPrompt, ... })`. Examples: `Explore` (read-only research), `Plan` (architect), `Reviewer` (code review).

2. **`DelegateCapability`** — Effect service with `delegate()`, `delegateBackground()`, `delegateAll()` methods. Returns typed `DelegationResult` with raw `output`, `summary`, `traceId`, and metadata.

3. **Typed `Action` sum type in agent-loop's act sub-module** — `{kind: "tool" | "delegate" | "delegate-parallel" | "final-answer"}`. Dispatched explicitly rather than via implicit tool-name matching.

**From the LLM's perspective**, sub-agents still appear as tool calls (familiar pattern) — but internal dispatch goes through `DelegateCapability`, giving raw result passthrough, enforced tool scoping, recorded parent depth, and replay-safe traceIds.

**Phased implementation:**

| Phase | Scope | Phase target |
|---|---|---|
| **P1** | act sub-module dispatches typed `Action`; sub-agents still use `spawn-agent` tool (no break); traces mark sub-agent depth + parent traceId | This refactor (W23) |
| **P2** | `DelegateCapability` service; `.withAgentType()` builder API; `spawn-agent` tool migrated to use the capability internally; result passthrough + tool scoping live | v0.12 (Phase E parallel) |
| **P3** | Background delegation handles, parallel delegation, filesystem isolation (worktree/tmpdir), per-call model override, ship multiple agent types (`Explore`, `Plan`, `Reviewer`) | v0.13 |

**For W23 (this refactor):** the agent-loop's act sub-module must dispatch a typed `Action`, not raw tool calls. Tracing must capture sub-agent depth and parent traceId. That's the only structural change W23 needs to enable P2/P3. Everything else is additive.

**Future enhancements P3+ may include:**
- Continuation via persistent agent IDs (Claude Code's `SendMessage` pattern) — resume a previously-spawned sub-agent
- Per-agent-type recursion limits (currently hardcoded depth 3)
- Sub-agent telemetry separation (`noTelemetry` option for sensitive contexts)
- Sub-agent budget escrow (parent reserves tokens for child)

---

## 9. Updated W23 next-session plan

Building on the resolutions:

1. **Cache-hit integration test** (~50 LOC) — locks in current behavior before refactor
2. **Cross-phase state inventory** — read agent-loop body, classify every closure variable
3. **Add `direct` strategy to reasoning package** — extracted from inline LLM-call path; ~150-200 LOC
4. **Extract setup sub-modules** — calibration, classifier, budget, tools-registry (with TDD on classifier — has decision logic)
5. **Extract cache-check** — explicit short-circuit
6. **Extract kernel-call** — now simpler, only one path (always via ReasoningService)
7. **Refactor act sub-module to dispatch typed `Action`** — sub-agents still go through `spawn-agent` tool (no break) but dispatch is now type-discriminated; sub-agent traces capture depth + parent traceId
8. **Extract post-kernel + finalize**
9. **Wire `agent-loop/index.ts` Phase value**
10. Full validation: tests, cross-package typecheck, N=3 corpus

**Estimated effort:** 3-4 focused sessions (vs original 2-3 estimate; the `direct` strategy + typed Action additions add scope but pay rent for v0.12+).

---

_Status: DECISIONS RESOLVED 2026-05-07. Ready for W23 next-session execution._

---

## 10. Calibration-aware sub-agent stability

**Constraint:** Sub-agents may use smaller models (Haiku, Llama-3-8B, qwen3:14b, gemma4:e4b, cogito:8b). The architecture must make small-model sub-agents stable, leveraging the existing `ModelCalibration` system.

### 10.1 Why this matters

Smaller models have well-documented failure modes that the calibration system already encodes:

| Calibration field | What it captures | Sub-agent impact |
|---|---|---|
| `systemPromptAttention` | weak/moderate/strong | Sub-agent system prompt must be trimmed/repeated for weak-attention models |
| `toolCallDialect` | native-fc / fenced-json / pseudo-code / none | Sub-agent tool dispatch uses the right parser per model |
| `parallelCallCapability` | reliable/unreliable | Sub-agent batch tool calls gated when unreliable |
| `interventionResponseRate` | high/medium/low | Sub-agent oracle nudge escalation rate tuned per model |
| `optimalToolResultChars` | int | Sub-agent tool-result paging caps tighter for small-context models |
| `classifierReliability` | high/medium/low/skip | Sub-agent skips classifier when unreliable; falls back to literal mention |
| `observationHandling` | uses-recall / inlines-facts / ignores | Sub-agent observation injection strategy adapts |

The Layer 1 builders we shipped (`buildFinalAnswerDescription`, `buildOracleNudge`) already consume these. **The architecture must extend that pattern to sub-agents: each sub-agent run resolves its own calibration based on its own model.**

### 10.2 Design implications

#### `AgentTypeDefinition.defaultModel` triggers per-sub-agent calibration

When an agent type defines a default model, that model's calibration resolves at delegation time — independent of the parent's model. Layer 1 builders consult the sub-agent's calibration, not the parent's.

```typescript
interface AgentTypeDefinition {
  // ...
  readonly defaultModel?: string;           // Calibration resolves from this
  readonly modelTier?: "small" | "medium" | "large" | "frontier";  // Optional explicit tier
}
```

**The DelegateCapability internally:**
1. Receives `DelegationSpec`
2. Resolves model: `spec.model` || `agentType.defaultModel` || parent's model
3. Resolves calibration via existing `resolveModelCalibration(model, ...)`
4. Constructs child `PhaseDeps` with the child's calibration in `state` refs
5. Spawns child engine

This means sub-agents automatically benefit from the existing calibration cascade.

#### Stability presets for small-model agent types

Built-in agent types should ship with conservative defaults proven on small models:

```typescript
// Built-in: read-only research agent, small-model-safe defaults
const ExploreAgentType: AgentTypeDefinition = {
  name: "Explore",
  tools: { profile: "read-only" },
  defaultModel: "claude-haiku-4-5",        // Or specified per-deployment
  defaultMaxIterations: 5,                 // Tight cap; small models loop
  defaultTimeoutMs: 60_000,
  systemPrompt: /* curated, short, repeats key instructions for weak-attention models */,
  contextIsolation: "fresh",
  stabilityPreset: "small-model-strict",   // See §10.3
};
```

#### Stability presets — the contract

```typescript
type StabilityPreset = 
  | "permissive"             // Frontier-model defaults
  | "small-model-strict"     // Tight caps, mandatory final-answer, strict verifier
  | "tiny-model-bounded"     // Single-tool subset, minimal iterations, NLI verification
  | "custom";                // Use raw fields

interface StabilityPresetEffects {
  maxIterations: number;                   // Cap
  mandatoryFinalAnswerTool: boolean;       // Don't trust loose stop signals
  verifier: "off" | "soft" | "strict";     // Tighter for smaller models
  toolHealingPolicy: "lenient" | "strict"; // Reject hallucinated tool names harder
  resultSchemaEnforced: boolean;           // Validate output shape
  oracleNudgeAggression: "low" | "med" | "high"; // Per calibration interventionResponseRate
  toolResultMaxChars: number | "auto";     // From calibration optimalToolResultChars
}
```

The preset translates a high-level intent into a bundle of calibration-derived runtime settings. Custom users can still override individual fields.

#### Optional model escalation on sub-agent failure

```typescript
interface DelegationSpec {
  // ...
  readonly fallbackOnFailure?: {
    readonly model: string;                // Larger model
    readonly maxRetries: number;           // 1 default
    readonly tokenBudgetCap: number;       // Don't blow budget
    readonly conditions: readonly ("verifier-fail" | "loop-spiral" | "tool-error-burst")[];
  };
}
```

If the sub-agent fails one of the named conditions, the capability auto-retries with the fallback model. Telemetry captures which model produced the final result. This delivers the "right model for right task, with safety net" promise that motivates small-model sub-agents in the first place.

#### Sub-agent telemetry separated by calibration tier

For Phase E (calibration consumer activation), per-tier metrics are essential:
- Sub-agent success rate by model tier
- Tool-call reliability by `toolCallDialect`
- Termination by `interventionResponseRate`

The `DelegationResult.metadata` should include `modelId` and resolved calibration tier, so observability dashboards can slice by sub-agent characteristics.

### 10.3 Phased delivery — calibration-aware additions

| Phase | Scope | Phase target |
|---|---|---|
| **P1** | Action dispatch in act sub-module records sub-agent depth + model + parent traceId in trace. No behavior change. | This refactor (W23) |
| **P2** | `DelegateCapability` resolves child calibration from `agentType.defaultModel || spec.model`. Layer 1 builders consume child calibration. `StabilityPreset` field on `AgentTypeDefinition` (initially just `permissive` and `small-model-strict`). | v0.12 |
| **P3** | Optional escalation (`fallbackOnFailure`). `tiny-model-bounded` preset. Per-tier sub-agent telemetry dashboards. | v0.13 |

### 10.4 Failure-mode catalog for small-model sub-agents

To inform stability presets, the small-model failure modes (already in `02-FAILURE-MODES.md` for the parent agent) need to be re-validated for sub-agents:

| FM | Manifestation in sub-agent | Mitigation |
|---|---|---|
| FM-A1 | Hallucinated tool calls | Strict toolHealingPolicy + mandatory final-answer |
| FM-A2 | Tool-call format failures | Per-provider parser (Phase E); calibration `toolCallDialect` |
| FM-B | Loop spirals | Tight `maxIterations` cap; oracle nudge from `interventionResponseRate` |
| FM-C | Output drift / unstructured returns | `resultSchemaEnforced` + verifier strict mode |
| FM-D | Context bloat | Tool-result paging (Phase E); from `optimalToolResultChars` |
| FM-E | Confident fabrication | Verifier `agent-took-action` gate (already exists; activate per sub-agent) |

P3+ work should ship a sub-agent-specific failure-mode validation harness — run a 10-task suite across {haiku, qwen3:14b, gemma4:e4b, llama3-8b} for each agent type and validate the stability preset holds.

---

_Calibration-aware sub-agent design added 2026-05-07 to support smaller-model sub-agents._
