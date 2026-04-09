# Parallel Tool Execution Analysis

## Current State: Mixed Architecture

Your observation is **correct**—the Reactive Agents framework currently has **two different tool execution models**, and they operate at different strategy levels:

### 1. **ReAct Kernel (Sequential, Per-Iteration)**
- **Current location**: `packages/reasoning/src/strategies/kernel/phases/act.ts`
- **Behavior**: Iterates through `pendingNativeToolCalls` in a **sequential `for` loop** (line 143)
- **Impact**: **One tool per iteration**, even if the LLM returns multiple native function calls
- **Code** (line 138-143):
  ```typescript
  for (const tc of pendingNativeCalls) {
    // ... execute tc, wait for result, add to allSteps
    // ... then proceed to next tc
  }
  ```

### 2. **Plan-Execute Strategy (Parallel via Wave Scheduling)**
- **Current location**: `packages/reasoning/src/strategies/plan-execute.ts`
- **Behavior**: Uses **dependency-aware wave scheduling** with actual parallelism
- **Concurrency Cap**: Up to **4 concurrent tool calls** per wave
- **Code** (line 338):
  ```typescript
  const waveResults = yield* Effect.all(waveEffects, { concurrency: wave.length > 1 ? 4 : 1 });
  ```
- **Features**:
  - `computeWaves()` groups steps by dependency DAG → independent steps run in parallel
  - Waves run sequentially (dependencies respected), but steps within a wave run concurrently
  - Result aggregation maintains state consistency

---

## Why the Asymmetry?

### ReAct (Sequential)
- **Design philosophy**: Think → Act → Observe → repeat
- **Each iteration is atomic**: LLM thinks, issues ONE action, observes the result
- **Rationale**:
  - Clearer observability—each action shows up as a distinct iteration in logs
  - Easier to debug—one tool call fails → immediate feedback
  - Lower cognitive load—agent re-plans after each tool result

### Plan-Execute (Parallel)
- **Design philosophy**: Plan → Execute (with dependencies) → Evaluate → Refine
- **Structured planning upfront**: Agent creates a **dependency graph** of steps
- **Parallelism unlocked**:
  - Steps with no dependencies can run simultaneously
  - Total execution time = longest chain in DAG (not sum of all chains)
  - Example: 10 steps with max depth 3 → ~3-4 waves instead of 10 iterations

---

## Performance Impact: Estimated Wins

### Scenario: Research Task (10-20 independent API calls)
- **Current ReAct**: 20 iterations × (think + API call) = **20 LLM calls**
- **With parallel batching**: ~5 waves × (think + 4 parallel calls) = **Maybe 5-7 LLM calls**
- **Token savings**: 60–75% reduction in repeated thinking/context passages

### Scenario: File I/O (5 independent file reads, then 1 aggregation)
- **Current ReAct**: 5 iterations + 1 final = **6 iterations**
- **With wave scheduling**: 1 wave (5 parallel reads) + 1 wave (aggregation) = **2 iterations**
- **Time savings**: Near-linear speedup (reads are I/O-bound)

---

## Architecture Constraints & Why Parallel is Hard in ReAct

### Fundamental Issue: Token Economy
In ReAct, **every tool result requires re-context**. The LLM gets:
```
[CONTEXT]
System prompt, tool schemas, working memory, ...
[HISTORY]
Thought 1 → Action 1 → Observation 1
Thought 2 → Action 2 → Observation 2
...
```

If you parallel 4 tools from a single thought:
```
Thought 1 → [Action 1, Action 2, Action 3, Action 4] → [Obs 1, Obs 2, Obs 3, Obs 4]
```

**Problem:** The LLM then needs to process 4 observations at once. But:
1. It can't know ahead of time which observations will be relevant
2. It might need to take a 5th action based on result #2, not result #4
3. The full context window grows **4×** (4× the tool schemas, 4× the observations)

### Solution Plan-Execute Uses
1. **Upfront planning**: LLM creates the full DAG once (big context hit, but amortized)
2. **Deterministic scheduling**: Dependencies force an order; no need to re-plan after each result
3. **Batch results**: All results in a wave come back together → one re-context cycle

---

## Opportunity: Parallel Tool Batching in ReAct

### Three strategies to unlock parallelism in ReAct:

#### **Option 1: Native FC Tool Batching** (Easiest, Partial Win)
- **Idea**: Collect all tool calls from the LLM's native FC response before acting
- **Current flow**:
  ```
  LLM returns: [{ name: "web-search", args: {...} }, { name: "http-get", args: {...} }]
             ↓ (handled in act.ts line 143 as sequential for loop)
  Execute web-search (wait)
  Execute http-get (wait)
  Observe both
  ```
- **Proposed flow**:
  ```
  LLM returns: [{ name: "web-search", args: {...} }, { name: "http-get", args: {...} }]
             ↓ (new: detect concurrent-safe tools)
  Execute BOTH in parallel (Effect.all with concurrency: 2–4)
  Observe both together
             ↓ (final context rebuild with all results)
  Next thought
  ```
- **Concurrency safety**: Mark tools as `concurrencySafe` (e.g. read-only queries, file-reads, API calls)
  - **Safe to parallel**: `web-search`, `http-get`, `file-read`, `code-execute` (no side effects)
  - **Unsafe**: `file-write`, `docker-exec` (mutations can conflict)
- **Implementation**: 
  - Add `concurrencySafe: boolean` to `ToolDefinition`
  - Modify act.ts to use `Effect.all(..., { concurrency: safeBatch.length > 1 ? 4 : 1 })`
  - Filter `pendingNativeCalls` into `safeBatch` vs `unsafeBatch`
  - Execute safe batch in parallel, then unsafeBatch sequentially

---

#### **Option 2: Greedy Tool Batching** (Medium Complexity, Moderate Win)
- **Idea**: After LLM issues a tool call, check if we can "greedily" issue related calls before observing
- **Use case**: "Here are 5 URLs to fetch, please get all of them"
- **Process**:
  1. LLM: `ACTION: web-search query=...` 
     ↓
  2. Agent: "I see one tool call. Can I batch more similar calls without LLM re-planning?"
     ↓
  3. Heuristic: If we're in iteration N and max_iterations >> N, and we have high confidence the results are independent,
     issue a synthetic batch: `[web-search(url1), web-search(url2), web-search(url3)]`
     ↓
  4. Execute all three in parallel, collect results, observe as one
- **Risk**: Hallucination (agent invents calls the LLM didn't ask for) → needs careful guardrails
- **Benefit**: Huge for data-parallel tasks (100 URLs → 4 waves instead of 100 iterations)

---

#### **Option 3: Async Tool Result Pipelining** (Highest Complexity, Largest Win)
- **Idea**: Don't wait for all tool results before next thought—pipeline them
- **Process**:
  ```
  Thought 1
  Issue Tools 1–4 (parallelized)
  └─ Tool 1 completes → immediately compute next thought in parallel
  └─ Tool 2 completes → add to context
  └─ Tool 3 completes → add to context
  └─ Tool 4 completes → finalize observation
  Thought 2 (with all results ready)
  ```
- **Complexity**: Requires **full rewrite** of act.ts phase and kernel loop
  - Tools become async streams, not blocking operations
  - Context rebuilds on-the-fly as results arrive
  - State machine becomes more complex (interleaved thinking/acting)
- **Benefit**: Near-linear speedup on I/O-bound tasks (wall-clock time ≈ longest IO + constant thinking overhead)

---

## Recommended Approach

### Phase 1 (Quick Win, 2–3 days)
Implement **Option 1: Native FC Tool Batching**
- Add `concurrencySafe` flag to `ToolDefinition`
- Modify `act.ts` line 138-143 to batch concurrent-safe tools with `Effect.all(..., { concurrency: 4 })`
- Wire through LLMService to mark built-ins (web-search, http-get, file-read, code-execute)
- Test with multi-tool scenarios (e.g., 3 web-searches, then observe all together)
- **Expected benefit**: 25–40% fewer iterations on API-heavy tasks

### Phase 2 (Medium Effort, 1 week)
Implement **Option 2: Greedy Batching** (optional heuristic)
- Add `agent.batchSimilarToolCalls(toolName, argsVariations)` unsafe-only method
- Builder flag: `.withReasoning({ greedyToolBatching: { enabled: true, maxBatchSize: 5 } })`
- Apply only when `iteration < maxIterations / 2` to leave "undo budget"
- Measure on benchmarks—estimate 15–30% iteration reduction

### Phase 3 (Major Refactor, 2–4 weeks)
Implement **Option 3: Async Pipelining** (if needed)
- Requires kernel architecture review
- Consider only if Phase 1 + 2 don't meet performance goals

---

## Code Locations to Modify

| Component | File | Change |
|-----------|------|--------|
| **Tool Definition** | `packages/tools/src/types.ts` | Add `concurrencySafe?: boolean` to `ToolDefinition` |
| **Built-in Tools** | `packages/tools/src/definitions.ts` | Mark web-search, http-get, etc. as `concurrencySafe: true` |
| **Act Phase** | `packages/reasoning/src/strategies/kernel/phases/act.ts` | Lines 138–180: Partition `pendingNativeCalls` into safe/unsafe batches; use `Effect.all` for safe batch |
| **Tool Execution** | `packages/reasoning/src/strategies/kernel/utils/tool-execution.ts` | Add `executeBatchedToolCalls(toolService, batch)` Effect helper |
| **Builder** | `packages/runtime/src/builder.ts` | New `.withReasoning({ toolBatchingEnabled: true, ...})` option |
| **Tests** | `packages/reasoning/tests/kernel-parallel-tools.test.ts` | New test file: parallel tool execution scenarios |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| **Mutual exclusion failures** (two writes conflict) | Mark tools as `concurrencySafe: false` by default; opt-in only for read-only tools |
| **Observation order ambiguity** | Always return results in the same order as tool calls; tag each with call index |
| **Token bloat** (4× observations in context) | Use result compression per tool to keep observations small |
| **Debug difficulty** (parallel tool traces harder to follow) | Always log tool order, start time, end time, duration per tool in trace |
| **Subtly different behavior** (parallel vs sequential semantics) | Can add `.withReasoning({ strictSequentialTools: true })` escape hatch |

---

## Estimated Impact on Your Use Cases

### Research Automation (20 parallel web queries)
- **Current**: 20 iterations × 3s per iteration = **60s**
- **With Phase 1**: 5 waves × 3s per wave = **15s** (4× faster)

### DevOps (10 independent file reads + 1 aggregation)
- **Current**: 11 iterations × 500ms = **5.5s**
- **With Phase 1**: 2 waves × 500ms = **1s** (5× faster)

### Source Code Analysis (5 parallel code executions)
- **Current**: 5 iterations × 2s = **10s**
- **With Phase 1**: 1 wave × 2s (all parallel) + 1 iteration (aggregate) = **4s** (2.5× faster)

---

## Summary

**Your intuition is spot on.** The architecture *does* allow for parallel tool execution in `plan-execute`, but ReAct strategy specifically uses *sequential* per-iteration execution by design. However, **Option 1 (Native FC Batching) is a straightforward win** that would unlock 25–40% iteration reduction with minimal risk and maximum compatibility.

This would be an excellent **Phase 1 performance optimization** for v0.10 or v1.1, and it aligns with the "Adoption Readiness" theme of recent releases.

