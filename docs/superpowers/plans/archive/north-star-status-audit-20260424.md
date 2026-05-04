# North Star Status Audit — 2026-04-24

> **Purpose:** Single reference for the gap between current code reality and the North Star v2.3 vision. Combines findings from the four-agent audit (Apr 23), harness improvement loop pass `20260424-north-star-1`, and direct source reads. Designed as a standing brief — update whenever a phase closes or a probe reveals new evidence.
>
> **Governs:** `docs/spec/docs/15-design-north-star.md` v2.3 is the architectural authority. This doc is its _status layer_ — what's done, what's not, what's blocking what. The North Star doc does not change here; this doc changes when code does.
>
> **Branch:** `feat/phase-0-foundations` (3 commits ahead of `main`, ~51 modified files uncommitted)

---

## 1. TL;DR

The **kernel is sound.** The **entropy detection system is a perfect classifier** (AUC = 1.000 in corpus validation). **Most infrastructure exists.** The gaps are almost entirely **wiring failures, not architectural missing pieces**.

The framework's core promise — reactive, self-improving, model-adaptive intelligence — is structurally achievable with surgical changes. What blocks it is not vision or architecture but five wiring gaps and two evaluator logic bugs that can be fixed in order, each one unblocking the next.

```
TODAY                           UNLOCK SEQUENCE
─────────────────────────────   ────────────────────────────────────────
Detection works (AUC=1.000)  → Wire early-stop overflow (IC-13, 5 lines)
Action broken (AUC=0.750)    → Fix dispatch threshold for local (IC-14)
Kernel overruns maxIter       → Early-stop overflow fixes this too
Memory exists, never wired    → forkDaemon + storeMemory wiring (IC-15)
num_ctx always 2048           → Capability port (Phase 1, 3 weeks)
4 termination writers         → Decision Rules pipeline (Phase 2)
```

---

## 2. Current State

### Branch / Commit Status

| Story | Pts | Status | Commit |
|-------|-----|--------|--------|
| S0.1 — Typed framework error taxonomy | 5 | ✅ DONE | `93ff6793` |
| S0.2 — `ErrorSwallowed` + 36-file migration | 3 | 🟡 90% DONE (uncommitted) | working tree |
| S0.3 — Default log redactor | 3 | ⬜ PENDING | — |
| S0.4 — CI probe suite + 4 new scaffolds | 5 | ⬜ PENDING | — |
| S0.5 — Microbench baseline harness | 2 | ⬜ PENDING | — |
| S0.6 — MEMORY.md / code reconciliation | 1 | ⬜ PENDING | — |
| S0.7 — Debrief quality spike | 2 | ⬜ PENDING | — |
| Sprint close (PR + retro) | — | ⬜ PENDING | — |

**Test baseline:** 4,353 pass / 23 skip / 0 fail (494 files, post typecheck-fix Apr 22)

**Harness signal (Apr 24, cogito:14b):**
- Entropy AUC = **1.000** — perfect failure predictor
- Dispatch AUC = **0.750** — fires on 2 of 4 failure scenarios
- `result.success` accuracy = **4/8** — all 4 failure-labeled runs return `success: true`
- `maxIterations` overrun confirmed: 16/12 and 5/4

---

## 3. The 6 Architectural Gaps — Code Reality

### G-1: `num_ctx` never set on Ollama

**Gap:** Ollama models silently cap context at 2048 tokens regardless of model capability.

**Code reality:**
- `packages/llm-provider/src/providers/local.ts` — zero occurrences of `num_ctx`
- `packages/llm-provider/src/capabilities.ts` — `ProviderCapabilities` has 4 fields; no `recommendedNumCtx`
- North Star calls for a 12-field `Capability` struct per-model backed by calibration store

**Harness evidence:**
- No probe yet confirms truncation (needs long-context task on cogito:8b or qwen3:14b)
- Scaffolded probe `num-ctx-sanity` will gate this in Phase 1

**Phase that fixes it:** Phase 1 (Capability port — 3 weeks)

**Files to change:**
```
packages/llm-provider/src/capabilities.ts          ← add 12-field Capability struct
packages/llm-provider/src/providers/local.ts       ← wire options.num_ctx
packages/reactive-intelligence/src/calibration/   ← extend store schema
```

---

### G-2: Two divergent `ModelTier` schemas

**Gap:** Tier classification is incoherent between reasoning and observability layers.

**Code reality:**
- `packages/reasoning/src/context/context-profile.ts:6` → `"local" | "mid" | "large" | "frontier"` (4 values)
- `packages/observability/src/telemetry/telemetry-schema.ts:17` → `"local" | "small" | "medium" | "large" | "frontier"` (5 values, different names)
- No cross-references; each subsystem classifies independently

**Impact:** Tier-adaptive behavior diverges between layers. Stall detection uses `"local"` tier window hardcoded as fallback string (`evaluators/stall-detect.ts:28`).

**Phase that fixes it:** Phase 1 (both schemas consume `Capability.tier` as derived source of truth)

---

### G-3: Tool observations never populate semantic memory

**Gap:** The "4-layer memory system" pitch fails because the semantic layer is never populated from tool results.

**Code reality:**
- `packages/memory/src/services/semantic-memory.ts` — fully implemented (FTS5, 7.7KB)
- `packages/reasoning/src/strategies/kernel/utils/tool-execution.ts` — only writes to scratchpad `Map<string, string>`; never calls `AgentMemory.store`
- `packages/memory/src/services/memory-service.ts:183` — `storeMemory("semantic")` exists but is called from episodic consolidation, not tool execution

**Harness evidence:**
- `memory-retrieval-fidelity` probe: W7 — recall invoked ✅ but task-intent misread → incomplete output
- `memory-recall-invocation` probe: W8 — recall invoked but `memory-flush` takes 8–12s blocking the hot path

**The W9/W16 chain:**
```
tool-execution.ts  →  scratchpad only  (memory never populated)
memory-service.ts  →  storeMemory called synchronously  (8–12s block)
fix A: wire storeMemory("semantic") from tool-execution.ts
fix B: wrap in Effect.forkDaemon (non-blocking)
combined: 3 lines of code, 8–12s hot-path savings
```

**Phase that fixes it:** Phase 1 (`AgentMemory.store` from `tool-execution.ts` via `Effect.forkDaemon`)

---

### G-4: Three uncoordinated compression systems

**Gap:** Compression fires from 3 independent code paths; no coordinator.

**Code reality:**
- Path A: Per-result compression in `packages/reasoning/src/strategies/kernel/utils/tool-formatting.ts:221-340` (tier-budget driven, always-on)
- Path B: Advisory `compress` decision in `packages/reactive-intelligence/src/controller/context-compressor.ts:10` (entropy-threshold driven, advisory)
- Path C: Message-slicing patch in `packages/reactive-intelligence/src/controller/patch-applier.ts` (applied by RI dispatcher)

**Impact:** Double-compression on same iteration possible. Count-based token estimate (~200 tok/msg) has no real token counts at kernel state layer.

**Harness evidence:**
- `savings-below-cost` suppressions observed in corpus run (RI compression path correctly suppressed when not cost-effective)
- No probe yet confirms double-compression scenario

**Phase that fixes it:** Phase 2 (`compress: Rule<CompressDecision>[]` pipeline; `ContextCurator` becomes sole caller)

---

### G-5: Termination scattered across 4 writers

**Gap:** No single ordered termination pipeline; 4 independent writers can conflict.

**Code reality:**
- `termination-oracle.ts:92-300` — ordered chain of 8 evaluators (correct pattern ✅)
- `packages/reasoning/src/strategies/kernel/phases/think.ts:551,681` — sets `terminatedBy` directly
- `packages/reasoning/src/strategies/kernel/phases/act.ts:440` — sets `terminatedBy` on final-answer accept
- `packages/reasoning/src/strategies/kernel/kernel-runner.ts:636,925,1125,1165` — 4 additional exit gates

**Harness evidence — confirmed W4:**
- `failure-rate-limit-loop`: 16 iters vs `maxIterations=12`
- `success-typescript-paradigm`: 5 iters vs `maxIterations=4`
- `trivial-1step`: 2 iters vs baseline expectation of 1 (W6 regression)

**Root causes confirmed:**
- **W4 (maxIterations not enforced):** Kernel exit gate in `kernel-runner.ts` checks iteration count but early-stop RI intervention never fires (W13 connection)
- **W6 (trivial-1step regression):** `think.ts:551` fires `terminatedBy = "end_turn"` after oracle exit, adding iter=2

**Phase that fixes it:** Phase 2 (`termination: Rule<TerminationDecision>[]` pipeline; 4 writers retire)

**Immediate fix available (pre-Phase 2):**
- IC-13: Add overflow branch to `evaluateEarlyStop` (5 lines) — fires when `iteration >= maxIterations - 2` regardless of trajectory shape. Fixes W4 + W13 simultaneously.

---

### G-6: `ExecutionEngine` is a 4,404 LOC monolith

**Gap:** Optional concerns are hard-wired into the execution engine, blocking extensibility.

**Code reality:**
- `packages/runtime/src/execution-engine.ts` — 4,404 LOC embedding: telemetry enrichment, debrief synthesis, classifier accuracy diff, RI skill loading, output sanitization
- All concerns always-on, no disable path, no extension seams

**Phase that fixes it:** Phase 3 (extract to optional layers; engine targets ~1,500 LOC)

---

## 4. Evaluator Registry — All 11 Wired, 4 Handlers Missing

All 11 evaluators fire from `controller-service.ts`. Handler status:

| Evaluator | Trigger Condition | Handler Status |
|-----------|-------------------|----------------|
| `evaluateEarlyStop` | Last N entropy entries `shape="converging"` AND `composite ≤ convergenceThreshold` | ✅ Wired (`defaultMode: "dispatch"`) **but convergence-only — no overflow branch** |
| `evaluateStrategySwitch` | Entropy flat (≥3 entries), `composite ≥ 0.35`, `behavioralLoopScore > 0.45` | ✅ Wired |
| `evaluateCompression` | `contextPressure > compressionThreshold (0.80)` | ✅ Wired (advisory, frequently suppressed `savings-below-cost`) |
| `evaluateTempAdjust` | Last 3 entries `shape="diverging"` OR `derivative > 0.05` | ✅ Wired (`delta = -0.1`) |
| `evaluateToolInject` | Entropy ≥ 0.5 for last 2 entries AND not converging | ✅ Wired — **most-fired handler in corpus** (5/5 dispatches = `inject-tool-guidance`) |
| `evaluateToolFailureStreak` | `consecutiveToolFailures ≥ 2` AND `iteration ≥ 2` | ✅ Wired → `append-system-nudge` patch |
| `evaluateStallDetect` | Entropy flat ≤ 0.20 for window AND no tool failures | ✅ Wired → stall signal; escalates on re-fire |
| `evaluateSkillActivate` | Entropy ≥ 0.5 AND trusted/expert skill not active | ❌ **Handler is stub** — evaluator fires, nothing dispatched |
| `evaluateMemoryBoost` | Entropy ≥ 0.6 AND `activeRetrievalMode != "semantic"` | ❌ **Handler is stub** |
| `evaluatePromptSwitch` | Last 4 entries flat AND `activePromptVariantId` set | ❌ **Handler is stub** |
| `evaluateHumanEscalate` | Entropy ≥ 0.7 AND ≥3 prior decisions AND ≥3 unique types | ❌ **Handler is stub** |

**Critical finding on `evaluateEarlyStop`:**
The handler is correctly registered (`defaultMode: "dispatch"`) and the dispatcher correctly exempts it from the entropy floor (`dispatcher.ts:61`). The handler never fires in failure scenarios because `evaluateEarlyStop` (`controller/early-stop.ts:19`) is a **convergence detector** — it fires only when entropy trajectory shape is `"converging"`. In all failure scenarios the trajectory is ascending/flat, so `allConverging` is always `false`. The fix is an overflow branch:

```typescript
// controller/early-stop.ts — add BEFORE the convergence check
if (maxIterations && iteration >= maxIterations - 2) {
  return {
    decision: "early-stop",
    reason: `Approaching maxIterations (iter=${iteration}, max=${maxIterations})`,
    iterationsSaved: maxIterations - iteration,
  };
}
```

This 5-line change simultaneously fixes W4 (maxIterations not enforced) and W13 (early-stop never fires in failure loops).

---

## 5. Harness Weakness Registry — Full Map to Architecture

| ID | Title | Severity | NS Gap | Phase | Status | Fix |
|----|-------|----------|--------|-------|--------|-----|
| W1 | cogito:8b generates text-format tool calls | High | G-1 (capability) | P1 | OPEN | Adaptive tool calling (shipped) + calibration resolver |
| W2 | ICS nudges reset loop-detector streak | High | G-5 (termination) | P2 | OPEN | Ordered termination pipeline |
| W4 | `maxIterations` not enforced | Medium | G-5 | P0 fix / P2 | CONFIRMED | IC-13 overflow branch (5 lines) |
| W6 | trivial-1step regression (2 iters, was 1) | Medium | G-5 | P2 prereq | OPEN | IC-16: bisect `think.ts:551` |
| W7 | Model fails to invoke recall | Low | G-3 | P1 | IMPROVED | Recall now invoked; completeness remaining |
| W8 | Task-intent misread "list N items" | Medium | G-6 | P3 | OPEN | ExecutionEngine extraction |
| W9 | Tool observations blocking hot path | Medium | G-3 | P1 | UPGRADED | `Effect.forkDaemon` (IC-15, 3 lines) |
| W11 | `result.success` always `true` | Critical | G-5 | P2 | CONFIRMED NEW | IC-17: add `result.goalAchieved: boolean\|null` |
| W12 | Success scenarios over-iterating | Medium | G-5 | P2 prereq | CONFIRMED NEW | IC-13 overflow + IC-16 regression fix |
| W13 | RI dispatcher only fires `inject-tool-guidance` | High | G-5 | P0 fix | CONFIRMED NEW | IC-13: overflow branch in `evaluateEarlyStop` |
| W14 | Dispatch threshold too tight (0.55) for local models | Medium | G-1, P2 | P2 | CONFIRMED NEW | IC-14: lower to ~0.45 for local tier |
| W16 | memory-flush blocking hot path (8–12s) | Medium | G-3 | P1 | CONFIRMED NEW | IC-15: `Effect.forkDaemon` |
| W17 | Auto-checkpoint never fires | Low | Probe design | P0 | CONFIRMED NEW | New probe with real context pressure |
| W18 | PER entropy spike on reflect phase | Low | Expected | — | OBSERVATION | Not a bug |

**AUC signal summary:**
```
Entropy AUC        = 1.000  (perfect — entropy alone classifies all 8 correctly)
Dispatch AUC       = 0.750  (imperfect — 2/4 failure scenarios dispatched)
maxEntropy gap     = 0.340  (success avg 0.207 vs failure avg 0.547)
result.success acc = 4/8    (all 4 failure runs return success=true)
```

**The core problem in one sentence:** The framework can _detect_ failure perfectly but only _terminates_ 50% of failure runs — `inject-tool-guidance` nudges are helpless against forced loops; early-stop is wired but has no trigger condition for overflow.

---

## 6. Improvement Candidates — Ordered by ROI

These are immediately actionable changes, independent of phase sequencing:

| IC | Change | Files | Effort | Fixes | Unlocks |
|----|--------|-------|--------|-------|---------|
| IC-13 | Add `iteration >= maxIterations - 2` overflow branch to `evaluateEarlyStop` | `controller/early-stop.ts` | 5 lines | W4, W13, W12 | Dispatch AUC → 1.000 on corpus |
| IC-15 | Wrap `storeMemory` call in `Effect.forkDaemon` | `tool-execution.ts` | 3 lines | W9, W16 | 8–12s hot-path savings per research probe |
| IC-16 | Bisect why `think.ts:551` fires after oracle exit → fix trivial-1step | `think.ts:551`, `termination-oracle.ts` | 1 day | W6, W12 | trivial-1step → 1 iter; early-stop proof |
| IC-14 | Lower dispatch threshold: 0.55 → 0.45 for local tier | `dispatcher.ts:60` | 1 line | W14 | save-loop + contradictory-data get dispatches |
| IC-17 | Add `result.goalAchieved: boolean\|null` to AgentResult | `execution-engine.ts` | ~20 lines | W11 | Users can distinguish "ran" vs "succeeded" |
| IC-18 | Add `num-ctx-truncation` probe + `compression-coordination` probe | new probe files | 1 day | — | Gates G-1 and G-4 fixes |
| IC-19 | Fix loop-state.json doubled "WW" prefix, empty descriptions | `harness-reports/loop-state.json` | 15 min | — | Harness state readable again |

**Sequencing note:** IC-13 has zero risk (overflow branch only fires near `maxIterations`; success scenarios stop well before), is 5 lines, and fixes the most-confirmed critical weakness. This is the single highest-leverage immediate change in the entire codebase.

---

## 7. Phase Roadmap with Dependencies

```
P0 ── FOUNDATIONS (current sprint, 1 week)
│     S0.1 ✅ Typed error taxonomy
│     S0.2 🟡 ErrorSwallowed + 36-file migration
│     S0.3 ⬜ Default log redactor
│     S0.4 ⬜ CI probe suite (4 new probes)
│     S0.5 ⬜ Microbench baseline
│     S0.6 ⬜ MEMORY.md reconciliation
│     S0.7 ⬜ Debrief quality spike
│
│     ← Phase 1 blocks here until P0 closes
│
P1 ── INVARIANT + CAPABILITY + CURATOR (3 weeks)
│     • Capability port: 12-field struct, calibration-backed
│     • Ollama num_ctx wired (ends silent 2048 truncation)
│     • ModelTier unified across reasoning + observability
│     • AgentMemory.store from tool-execution (forkDaemon)
│     • trustLevel on ObservationResultSchema
│     • ContextCurator absorbs all prompt construction
│     • Task primitive (typed intent, criteria, deliverables)
│     • Phase 4a passive skill capture begins
│
│     Probes now real: num-ctx-sanity, semantic-memory-population,
│     capability-probe-on-boot, W4 maxIterations test
│
│     ← Phase 2 blocks until P1 Capability + Task land
│
P2 ── DECISION RULES + RELIABILITY (2 weeks)
│     • termination: Rule<TerminationDecision>[] pipeline
│       → retires think.ts:551,681 + act.ts:440 + kernel-runner.ts gates
│       → trivial-1step regression (W6) fixed by construction
│       → W4 fixed by construction (overflow branch closes gap before P2)
│     • compress: Rule<CompressDecision>[] — 3 systems collapse to 1
│     • retry: Rule<RetryDecision>[] — per-error-type retry
│     • Named circuit breakers per (provider, model) + per-MCP-server
│     • Verification port (§4.5) — typed VerificationResult
│     • Claim + Evidence primitives
│     • Typed Skill schema
│     • Fixture recording (record once, replay in CI)
│     • result.goalAchieved (IC-17 formalized here)
│
│     ← Phase 3 blocks until P2 Rule pipelines + Budget design land
│
P3 ── THIN ORCHESTRATOR + CONTROL SURFACE (2 weeks)
│     • ExecutionEngine extraction → ~1,500 LOC (from 4,404)
│     • Budget<T> primitive (unified cost/tokens/iters/time)
│     • Invariant primitive (~10 default invariants)
│     • RI enabledInterventions allowlist (no half-implemented advisories)
│     • 4 stub handlers either complete or deleted
│     • Tool capabilities scope enforcement
│     • CI lint: no behavior in builder.ts, no module-level constants
│
P4 ── CLOSED LEARNING LOOP (2 weeks)
      GATE: Phase 0 debrief quality spike must return POSITIVE
      • 4a: passive skill capture (already started in P1)
      • 4b: active retrieval via ContextCurator trigger matching
      • same task twice → fewer iterations on second run
```

---

## 8. Critical Path — What Each Phase Actually Requires to Start

| Phase | Hard Prerequisites |
|-------|-------------------|
| P0 close | S0.2 committed; redactor tests green; `bun run probes` exits 0; microbench baseline captured; debrief spike answered |
| P1 start | P0 closed. `AgentConfig × Capability → ResolvedRuntime` invariant designed (Q5 resolved). |
| P2 start | Capability port shipped (P1). `Task` primitive landed (P1). Q8 and Q9 resolved. |
| P3 start | Rule pipelines stable (P2). `Budget<T>` design locked (Q7 resolved). Q6 resolved. |
| P4 start | Debrief spike (P0) = POSITIVE. Skills accumulating from P1 passive capture. |

---

## 9. Open Questions That Must Be Answered

From North Star §15. Answers required before the indicated phase starts:

| Q | Question | Blocks | Recommendation |
|---|----------|--------|----------------|
| Q5 | Trust-level default for internal meta-tools: grandfather with `justification: "grandfather-phase-1"` tag, or full audit? | Phase 1 | Grandfather with tagged justification; CI lint fails build in P3 if justification not replaced |
| Q6 | Capability scope enforcement: warn-only one release, then enforce? Or enforce from day one? | Phase 3 | Warn-only for one minor release; breaking for custom tools reading arbitrary `process.env` |
| Q7 | Budget-exceeded default: `fail` \| `degrade-model` \| `warn`? | Phase 3 | `warn` for opted-in users; no change for users not using `withCostTracking` |
| Q8 | Top-10 developer control items — any priority overrides? | Phase 2+ | Default ordering stands until a specific use case demands change |
| Q9 | Hooks (`onBefore*`/`onAfter*`) or just Rules? | Phase 2 | Rules cover it; hooks are redundant unless a concrete use case emerges |
| Q10 | Error-swallowing migration timing: is any of the 10 sites hiding a production bug needing immediate fix? | Phase 0 close-out | Audit all 10 site names from `KNOWN_SWALLOW_SITES` before committing S0.2 |
| Q11 | `Task.requireVerification` default: `true` for tasks with `successCriteria`, `false` otherwise? | Phase 2 | Recommended default confirmed |
| Q12 | `ClaimExtractor` always-on vs. opt-in? | Phase 2 | Opt-in initially; flip to always-on when Phase 4b proves value |
| Q13 | Default invariant enforcement map (halt/log/telemetry-only)? | Phase 3 | Recommended map confirmed: security = halt, correctness = halt, soft = log |
| Q14 | `Budget<T>` default limits per tier? | Phase 3 | Local 50k/15iter/10min; Mid 100k/20iter/$1; Frontier 200k/25iter/$5 |

---

## 10. Success Metrics Per Phase

These are the exact probe-verified gates from North Star §14:

### Phase 0 Gates (in progress)
- [ ] Unit test forces each of the N `KNOWN_SWALLOW_SITES` to throw → `ErrorSwallowed` event emitted with correct `site` tag
- [ ] Redaction test suite: zero leakage on 8-secret corpus
- [ ] `FrameworkError` types importable from `@reactive-agents/core/errors` (✅ done)
- [ ] `bun run probes` exits 0 with JSONL artifact
- [ ] Microbench baseline captured in `harness-reports/benchmarks/baseline-<date>.json`
- [ ] Debrief spike binary answer: POSITIVE or NEGATIVE for Phase 4 scope

### Phase 1 Gates
- [ ] `memory-recall-invocation` passes without explicit `recall: true`
- [ ] `num-ctx-sanity` passes on qwen3:14b (Ollama sets `num_ctx > 2048`)
- [ ] `semantic-memory-population` passes (cross-session tool result retrieval)
- [ ] W4 test passes: probe with `maxIterations: 10` runs ≤10 iterations
- [ ] `Task` primitive round-trip: `string → Task → serialize → Task` structurally identical
- [ ] ≥5 skills captured per week on a running agent

### Phase 2 Gates
- [ ] `trivial-1step` iterations = 1 (W6 regression closed by construction)
- [ ] Zero `catchAll(() => Effect.void)` sites remaining
- [ ] Termination-quality probe passes without burning budget
- [ ] Circuit breaker opens under simulated outage
- [ ] `verifyBeforeFinalize` rule fires on probe output and retries-with-nudge on failure
- [ ] `ClaimExtractor` identifies ≥1 grounded claim per multi-step probe
- [ ] 10 recorded fixtures replay deterministically in <5s total

### Phase 3 Gates
- [ ] `builder.ts` behavior-free
- [ ] `execution-engine.ts` under 1,800 LOC
- [ ] Zero module-level numeric constants outside `/constants`
- [ ] All 10 default invariants pass on `trivial-1step` and `memory-retrieval-fidelity`
- [ ] Invariant-check perf overhead <1% vs Phase 0 baseline

### Phase 4 Gate
- [ ] Same task run twice → second run uses fewer iterations with same answer quality

---

## 11. Most-Impactful Single Changes (Ordered)

If only 5 things happen before v1.0, these are them:

1. **`evaluateEarlyStop` overflow branch** (`controller/early-stop.ts`, 5 lines) — Fixes W4 + W13 simultaneously. Dispatch AUC goes from 0.750 → 1.000. The single highest-ROI change in the codebase. Zero regression risk.

2. **Wire `AgentMemory.store("semantic")` from `tool-execution.ts` via `Effect.forkDaemon`** (3 lines in two files) — Fixes W9 + W16. Enables the "memory that learns" pitch for the first time. 8–12s probe duration savings.

3. **Capability port + `num_ctx` wiring** (`capabilities.ts`, `local.ts`, ~150 LOC) — Ends silent 2048-token truncation for every Ollama user. Single biggest local-model UX fix.

4. **Unified `ModelTier`** (delete one enum, reference the other, ~5 files) — Tier-adaptive behavior becomes coherent. Prerequisite for per-tier dispatch thresholds (IC-14) and per-tier budget limits.

5. **`result.goalAchieved: boolean | null`** (`execution-engine.ts`, ~20 lines) — First user-visible signal that the agent knows it failed vs. just terminated. Non-breaking (additive field). Enables harness to write meaningful pass/fail assertions.

---

## 12. Architecture Anti-Goals (What We Are NOT Doing)

From North Star §13 — enforced through Phase 0–3:

- **Not a rewrite.** No `v2/` branch. The kernel is correctly factored.
- **Not microservices.** Monorepo stays one process composed of Effect layers.
- **Not a new strategy.** Five exist. No sixth during this sequence.
- **Not a plugin marketplace.** Deferred to v1.2 (Q4 2026 resolution).
- **Not an observability product.** We emit telemetry; we don't build viewers.
- **Not a benchmarking shop.** Probes gate regressions; benchmark results are not marketing.
- **Not a DSL.** TypeScript-native config, not YAML grammars.

---

## 13. Immediate Next Actions

In priority order:

```bash
# 1. Commit the harness-evolve.ts fix (discoveredMetricNames → discoveredEventKinds)
git add .agents/skills/harness-improvement-loop/scripts/harness-evolve.ts
git commit -m "fix(harness): discoveredMetricNames → discoveredEventKinds in harness-evolve.ts"

# 2. IC-13: Add overflow branch to evaluateEarlyStop
# File: packages/reactive-intelligence/src/controller/early-stop.ts
# Add before convergence check:
#   if (maxIterations && iteration >= maxIterations - 2) { return early-stop decision }
# TDD: failing test first → implement → re-run failure-corpus → confirm dispatch AUC = 1.000

# 3. IC-15: forkDaemon for memory flush
# File: packages/reasoning/src/strategies/kernel/utils/tool-execution.ts
# Change: yield* memory.store(...) → yield* Effect.forkDaemon(memory.store(...))
# (And wire storeMemory("semantic") call if not already present)

# 4. Close S0.2: commit the 36-file migration with KNOWN_SWALLOW_SITES + wiring test
# Follow Task 1 in 2026-04-23-north-star-phase-0.md step-by-step

# 5. Execute S0.3–S0.7 per the Phase 0 plan to close the sprint
```

---

_Updated: 2026-04-24. Next update: after Phase 0 closes or new harness evidence surfaces._
_Source of truth: `docs/spec/docs/15-design-north-star.md` v2.3_
