# Framework Gap Assessment — v0.6.3

> **Date**: 2026-03-08
> **Scope**: All 20 packages + 2 apps — strengthening existing systems, integration polish, performance/accuracy optimization
> **Method**: Automated audit of all source files, tests, TODO/FIXME search, cross-package integration tracing
> **Test baseline**: 1,588 passing / 2 failing / 30 skipped across 190 files

---

## Priority Tiers

- **P0 — Critical**: Feature is broken, silently fails, or produces incorrect results
- **P1 — High**: Feature exists but is disconnected/unused, blocking real-world value
- **P2 — Medium**: Feature works but has significant quality or performance gaps
- **P3 — Low**: Polish, missing tests, documentation, or minor inconsistencies

---

## P0 — Critical (Broken / Silently Failing)

### GAP-01: Memory Embeddings Never Generated
**Package**: `@reactive-agents/memory`
**Files**: `packages/memory/src/types.ts:55`, `packages/memory/src/extraction/memory-extractor.ts`
**Issue**: `SemanticEntry.embedding` field exists and vector search (`searchVector()`) is implemented, but **no code ever generates embeddings**. `MemoryLLM` interface has `complete()` but no `embed()` method. The LLM provider's `embed()` is never bridged to the memory layer.
**Impact**: Vector search always returns 0 results. Zettelkasten auto-linking uses FTS5 text matching instead of semantic similarity. The entire Tier 2 semantic search path is non-functional.
**Fix**: Bridge `LLMService.embed()` into memory layer. Generate embeddings on `storeSemantic()`. Wire into `MemoryExtractor`.
**Effort**: Medium (2-3 hours)

### GAP-02: Cost Budget Enforcement Never Called
**Package**: `@reactive-agents/cost`, `@reactive-agents/runtime`
**Files**: `packages/cost/src/cost-service.ts` (defines `checkBudget()`), `packages/runtime/src/execution-engine.ts` (never calls it)
**Issue**: `.withCostTracking()` builder option accepts budget limits (per-request, per-session, daily, monthly). The `checkBudget()` method exists and would throw `BudgetExceededError`. But it is **never invoked** before or during execution. Budget limits are recorded but not enforced.
**Impact**: Users configure budget limits thinking they have protection, but agents can spend unlimited tokens. Cost tracking is record-only.
**Fix**: Add `checkBudget()` call before think phase. Add per-iteration budget check in kernel runner.
**Effort**: Small (1-2 hours)

### GAP-03: Vector Search Uses In-Memory Full Scan
**Package**: `@reactive-agents/memory`
**Files**: `packages/memory/src/search.ts:123-183`
**Issue**: `searchVector()` fetches **all** embeddings from DB into memory, computes cosine similarity in JS, then sorts. No sqlite-vec extension. Comments say "Tier 2 (sqlite-vec)" but actual implementation is brute-force.
**Impact**: O(n) memory and CPU per search. At 10K+ entries, this becomes a performance bottleneck. Blocks production use of semantic memory at scale.
**Fix**: Either integrate sqlite-vec (requires native module), or implement HNSW in-process, or use chunked retrieval with pre-filtering. Short-term: add result count limit to DB query.
**Effort**: Medium-Large (depends on approach)

---

## P1 — High (Disconnected / Unused Features)

### GAP-04: MemoryConsolidator Never Called Automatically
**Package**: `@reactive-agents/memory`
**Files**: `packages/memory/src/extraction/memory-consolidator.ts`, `packages/memory/src/runtime.ts`
**Issue**: `MemoryConsolidator` with `consolidate()`, `decayUnused()`, `promoteActive()` is exported but **not instantiated** in `createMemoryLayer()` and **never called** during execution or by the gateway heartbeat system.
**Impact**: Memory entries never decay, never get promoted by usage patterns, never get consolidated. Unbounded growth of stale entries. This is the single biggest gap vs. Google ADK's "always-on memory" pattern, which runs background consolidation automatically.
**Fix**: Wire into memory layer. Add automatic consolidation trigger after memory-flush phase. Optionally integrate with gateway heartbeat for periodic consolidation.
**Effort**: Medium (2-3 hours)

### GAP-05: CompactionService Not Wired Into Layer
**Package**: `@reactive-agents/memory`
**Files**: `packages/memory/src/compaction/compaction-service.ts`, `packages/memory/src/runtime.ts`
**Issue**: CompactionService has 4 strategies (count, time, semantic, progressive) but is **not included** in `createMemoryLayer()`.
**Impact**: Memory never compacts old entries. Combined with GAP-04, this means memory grows indefinitely.
**Fix**: Add to `createMemoryLayer()`. Wire into execution engine memory-flush phase.
**Effort**: Small (1 hour)

### GAP-06: Interaction Layer Registered But Never Invoked
**Package**: `@reactive-agents/interaction`, `@reactive-agents/runtime`
**Files**: `packages/runtime/src/runtime.ts:829-835`, `packages/runtime/src/execution-engine.ts`
**Issue**: `.withInteraction()` builder option creates the layer and merges it into runtime. But `ExecutionEngine` **never references** InteractionService. Features like checkpoints, collaboration prompts, and user preferences are dead code at runtime.
**Impact**: Entire interaction package (5 modes, preferences, checkpoints) is effectively unreachable through normal agent execution.
**Fix**: Wire InteractionService into execution engine phases where user input is needed (think phase for HITL, act phase for approval).
**Effort**: Medium (3-4 hours)

### GAP-07: Verification Result Not Used for Quality Gating
**Package**: `@reactive-agents/runtime`
**Files**: `packages/runtime/src/execution-engine.ts:1549-1593`
**Issue**: Verification phase runs, scores the response, stores result in metadata — but `result.passed` is **never checked**. Agent completes regardless of verification score. No retry/rejection path.
**Impact**: Verification is purely informational. Quality gates don't actually gate anything.
**Fix**: Add conditional: if `!result.passed && result.recommendation === "reject"`, retry think phase (up to configurable retry limit).
**Effort**: Small-Medium (1-2 hours)

### GAP-08: Kill Switch Not Honored in Execution Loop
**Package**: `@reactive-agents/runtime`
**Files**: `packages/runtime/src/execution-engine.ts`
**Issue**: KillSwitchService is available via `Effect.serviceOption()` and `ReactiveAgent.pause()/stop()` wrappers exist. But the inner execution loop **never checks** kill switch state. A paused agent continues executing.
**Impact**: External pause/stop calls are fire-and-forget. Agent may complete or fail before the signal takes effect.
**Fix**: Add kill switch state check at the start of each `guardedPhase()` call. If paused, wait. If stopped/terminated, abort.
**Effort**: Small (1 hour)

### GAP-09: Sub-Agent Context Forwarding Missing
**Package**: `@reactive-agents/tools`
**Files**: `packages/tools/src/adapters/agent-tool-adapter.ts:50-119`
**Issue**: Sub-agents receive only the task string. No parent context (working memory, prior tool results, semantic memory) is forwarded.
**Impact**: Sub-agents re-fetch data the parent already has. In testing, delegate mode was 4x slower than solo mode (35 steps/25K tokens vs 7 steps/6.4K tokens) because sub-agents repeat work.
**Fix**: Pass parent's relevant context (last N tool results, working memory summary) as systemPrompt prefix or context parameter to sub-agent runtime.
**Effort**: Medium (2-3 hours)

### GAP-10: Semantic Memory Extraction Not Automatic
**Package**: `@reactive-agents/memory`
**Files**: `packages/memory/src/extraction/memory-extractor.ts`
**Issue**: `MemoryExtractor` exists and can extract semantic knowledge from agent interactions, but is **never called** in the execution pipeline. Episodic memory is logged automatically but semantic long-term knowledge extraction doesn't happen.
**Impact**: Agents don't build long-term knowledge from interactions. Each run starts with only bootstrapped semantic memory from prior explicit stores.
**Fix**: Call `MemoryExtractor.extract()` during memory-flush phase. Filter for high-value content.
**Effort**: Medium (2-3 hours)

---

## P2 — Medium (Quality / Performance Gaps)

### GAP-11: Cost Routing Only Works for Anthropic Provider
**Package**: `@reactive-agents/runtime`
**Files**: `packages/runtime/src/execution-engine.ts:512-517`
**Issue**: The complexity router returns Anthropic model names (claude-haiku, claude-sonnet). Code explicitly checks `config.provider === "anthropic"` and only applies routing for that provider. Other providers always use their configured default model.
**Impact**: Cost optimization via complexity routing doesn't work for OpenAI, Gemini, Ollama, or LiteLLM users.
**Fix**: Add provider-specific model tier mappings to the complexity router.
**Effort**: Medium (2-3 hours)

### GAP-12: Audit Phase is a Stub
**Package**: `@reactive-agents/runtime`
**Files**: `packages/runtime/src/execution-engine.ts:1667-1685`
**Issue**: Phase 9 (AUDIT) only logs an execution summary via observability. No actual audit trail creation, no access logging, no security checks. The `enableAudit` flag doesn't trigger meaningful behavior.
**Impact**: CLAUDE.md claims "Full compliance trail" but audit phase does nothing beyond logging.
**Fix**: Wire identity/audit-logger into this phase. Record execution summary, tool calls, and data access patterns.
**Effort**: Small-Medium (2 hours)

### GAP-13: Duplicate PromptLayer Registration
**Package**: `@reactive-agents/runtime`
**Files**: `packages/runtime/src/runtime.ts:792-794` and `packages/runtime/src/runtime.ts:837-839`
**Issue**: When `enablePrompts=true`, `createPromptLayer()` is registered twice — once in `reasoningDeps` and again in the main runtime.
**Impact**: Two PromptService instances created. Potential layer composition conflict. Templates registered in one may not be visible in the other.
**Fix**: Remove duplicate registration. Keep only the one in `reasoningDeps`.
**Effort**: Small (30 minutes)

### GAP-14: No Zettelkasten Auto-Link Test Coverage
**Package**: `@reactive-agents/memory`
**Files**: `packages/memory/tests/zettelkasten.test.ts`
**Issue**: `autoLinkText()` is implemented and called from `MemoryService.storeSemantic()`, but there are zero tests validating auto-linking behavior.
**Impact**: Auto-linking could silently break with no regression detection. Current implementation uses FTS5 rank instead of semantic similarity — correctness unknown.
**Fix**: Add integration tests for auto-linking.
**Effort**: Small (1 hour)

### GAP-15: Gateway Does Not Interact with Memory
**Package**: `@reactive-agents/gateway`
**Issue**: Persistent autonomous agent harness (heartbeats, crons, webhooks) has zero imports from the memory package. Heartbeat intervals don't trigger memory consolidation. Cron-based agents don't benefit from cross-invocation memory synthesis.
**Impact**: Long-running gateway agents accumulate stale memory without cleanup. Missed opportunity for background consolidation (the key insight from Google ADK's always-on memory).
**Fix**: Add optional memory consolidation to heartbeat cycle. Add memory cleanup to gateway shutdown.
**Effort**: Medium (2-3 hours)

### GAP-16: Sub-Agent maxIterations Not Scoped
**Package**: `@reactive-agents/tools`, `@reactive-agents/runtime`
**Issue**: Sub-agents inherit default maxIterations (10). For focused sub-tasks (fetch one thing, summarize one thing), this allows excessive iteration. Small models especially tend to loop.
**Fix**: Default sub-agent maxIterations to 5 (or configurable per agent-tool definition). Add early termination heuristics.
**Effort**: Small (1 hour)

### GAP-17: No Reasoning Strategy Fallback
**Package**: `@reactive-agents/runtime`
**Files**: `packages/runtime/src/execution-engine.ts:790`
**Issue**: If `ReasoningService.execute()` throws an unhandled error, execution fails immediately. No fallback to direct LLM completion.
**Impact**: Strategy selection becomes a single point of failure. A misconfigured strategy (e.g., plan-execute with a model that can't produce JSON plans) crashes the entire run.
**Fix**: Catch strategy execution errors, fall back to direct LLM.complete() with the original task.
**Effort**: Small (1 hour)

### GAP-18: 2 Failing Tests (Model Tier Classification)
**Package**: `@reactive-agents/runtime`
**Files**: `packages/runtime/tests/builder-profile-resolution.test.ts:49`
**Issue**: `cogito:14b` is classified as "mid" tier after recent reclassification, but tests still expect "local".
**Fix**: Update test expectations.
**Effort**: Trivial (10 minutes)

---

## P3 — Low (Polish / Documentation / Minor)

### GAP-19: No Cross-Session Persistence Integration Test
**Package**: `@reactive-agents/memory`
**Issue**: Bootstrap works and SQLite persists data, but no test verifies that data from run A is available in run B with the same agentId.
**Effort**: Small (1 hour)

### GAP-20: Missing EventBus Events for Cost/Verification
**Package**: `@reactive-agents/runtime`
**Issue**: No EventBus events for budget checks, cost tracking milestones, or verification scores. Dashboard can't show cost warnings.
**Effort**: Small (1 hour)

### GAP-21: LiteLLM/Gemini Structured Output Limitations
**Package**: `@reactive-agents/llm-provider`
**Issue**: LiteLLM has no native JSON mode. Gemini has JSON mode but no schema enforcement. Both fall back to parse-retry.
**Impact**: Structured output is slower and less reliable for these providers.
**Effort**: Low (provider SDK limitation — document clearly)

### GAP-22: Benchmarks Package Minimal Test Coverage
**Package**: `@reactive-agents/benchmarks`
**Issue**: Only 1 test file (42 lines). Tasks, runner, and report generation have minimal coverage.
**Effort**: Small (1-2 hours)

### GAP-23: Builder Options Silently Ignored Without Enable Flags
**Package**: `@reactive-agents/runtime`
**Issue**: `.withVerificationOptions()` does nothing without `.withVerification()`. No warning emitted.
**Fix**: Add builder validation that warns on orphaned options.
**Effort**: Small (1 hour)

---

## Competitive Analysis: Memory System vs. Industry

| Capability | Reactive Agents | Google ADK | CrewAI | Mem0 | Zep |
|---|---|---|---|---|---|
| Working Memory | ✅ Ref-based | ✅ Session state | ✅ Short-term | ❌ | ✅ Thread state |
| Semantic/Long-term | ✅ SQLite+FTS5 | ✅ Vertex AI Search | ✅ 4 types | ✅ Graph | ✅ Knowledge graph |
| Episodic Memory | ✅ Daily logs | ❌ | ❌ | ✅ | ✅ Temporal |
| Procedural Memory | ✅ Workflows | ❌ | ❌ | ❌ | ❌ |
| **Auto Consolidation** | ❌ Manual only | ✅ Background agents | ❌ | ✅ Auto | ✅ Auto |
| **Embedding Generation** | ❌ Broken | ✅ Vertex embeddings | ✅ | ✅ | ✅ |
| **Entity Memory** | ❌ | ❌ | ✅ Entities | ✅ Graph nodes | ✅ Entities |
| **Composite Recall** | ❌ | ❌ | ✅ Multi-source scoring | ❌ | ✅ Hybrid |
| Vector Search | ❌ In-memory scan | ✅ Vertex Vector | ✅ | ✅ | ✅ |
| Cross-Session | ✅ SQLite | ✅ Cloud store | ✅ | ✅ | ✅ |

**Key Insight**: Our memory system has the richest type diversity (4 types vs. industry 1-2), but the pipeline is disconnected. Embeddings aren't generated, consolidation never runs, and vector search doesn't scale. The foundation is excellent — it just needs wiring.

---

## Recommended Implementation Order

### Sprint 1: Critical Fixes (P0) — Foundation Integrity
1. **GAP-01**: Bridge embeddings into memory layer
2. **GAP-02**: Wire budget enforcement into execution
3. **GAP-18**: Fix failing tests

### Sprint 2: Memory Pipeline (P1) — Unlock Memory Value
4. **GAP-04**: Wire MemoryConsolidator with auto-trigger
5. **GAP-05**: Wire CompactionService into layer
6. **GAP-10**: Auto-extract semantic memories
7. **GAP-15**: Gateway memory integration

### Sprint 3: Execution Quality (P1) — Enforce Quality Gates
8. **GAP-07**: Verification quality gating
9. **GAP-08**: Kill switch in execution loop
10. **GAP-13**: Fix duplicate PromptLayer

### Sprint 4: Sub-Agent Performance (P1-P2)
11. **GAP-09**: Context forwarding
12. **GAP-16**: Scoped maxIterations
13. **GAP-17**: Strategy fallback

### Sprint 5: Integration Polish (P2-P3)
14. **GAP-06**: Wire interaction layer
15. **GAP-11**: Multi-provider cost routing
16. **GAP-12**: Real audit phase
17. **GAP-20**: Cost/verification EventBus events
18. **GAP-14**: Auto-link test coverage

---

## Summary

| Priority | Count | Status |
|----------|-------|--------|
| P0 Critical | 3 | Features silently broken |
| P1 High | 7 | Features exist but disconnected |
| P2 Medium | 8 | Quality/performance gaps |
| P3 Low | 5 | Polish/documentation |
| **Total** | **23** | |

**Assessment**: The framework's architecture is excellent — all 20 packages are fully implemented with 1,588 passing tests. The reasoning system (5 strategies, kernel architecture) is production-grade with zero technical debt. The primary issue pattern is **disconnected wiring**: features are built and exported but never called from the execution pipeline. Memory system has the richest foundation in the industry but needs its pipeline connected. Fixing the P0 and P1 issues (~15-20 hours of work) would make this a genuinely production-ready framework.
