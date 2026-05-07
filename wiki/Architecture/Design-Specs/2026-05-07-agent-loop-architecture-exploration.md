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
