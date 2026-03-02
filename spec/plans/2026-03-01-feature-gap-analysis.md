# Strategy SDK Feature Gap Analysis — v0.5.6 Planning

**Date:** 2026-03-01
**Context:** Post-Strategy SDK refactor — all 5 strategies now tool-aware via shared ReAct kernel

---

## What Was Achieved

The Strategy SDK refactor introduced a shared execution primitive (`packages/reasoning/src/strategies/shared/react-kernel.ts`) that implements the full ReAct Think → Act → Observe loop. All 5 reasoning strategies now delegate to this kernel instead of maintaining their own ad-hoc tool-calling loops:

- **Reflexion** — generation and improvement passes use the kernel; critique pass stays pure LLM (intentionally)
- **Plan-Execute** — each plan step runs through the kernel with its own tool-aware context
- **Tree-of-Thought** — Phase 2 execution uses the kernel on the best BFS branch
- **Adaptive** — passes `availableToolSchemas` through to all dispatched sub-strategies
- **ReAct** — original implementation retained as-is; shared utilities extracted to `shared/`

Six shared utility files were extracted into `packages/reasoning/src/strategies/shared/`:

| File | Responsibility |
|---|---|
| `tool-utils.ts` | ACTION parsing, FINAL ANSWER detection, schema formatting, transform evaluation |
| `quality-utils.ts` | `isSatisfied()`, `isCritiqueStagnant()`, `parseScore()` |
| `context-utils.ts` | `buildCompactedContext()` — progressive 6-step compaction |
| `step-utils.ts` | `makeStep()`, `buildStrategyResult()` |
| `service-utils.ts` | `resolveStrategyServices()`, `compilePromptOrFallback()`, `publishReasoningStep()` |
| `react-kernel.ts` | The full ReAct loop — `executeReActKernel()` |

---

## Remaining Gaps

### 1. Tool Result Compression Is Duplicated

**Where:** `packages/reasoning/src/strategies/reactive.ts` exports `compressToolResult()` (lines 812+). `packages/reasoning/src/strategies/shared/react-kernel.ts` has a near-identical private function `compressKernelToolResult()` (lines 446+).

**Problem:** Both functions implement the same JSON array preview / object key listing / text line preview logic. The kernel version is `function` (private), and reactive.ts exports the same algorithm as a public named export `compressToolResult`. Any future bug fix or improvement must be applied in two places.

**What the code says:** `react-kernel.ts` line 443 explicitly notes: "Structured preview compression — mirrors reactive.ts compressToolResult()."

**Fix:** Move `compressToolResult()` to `@reactive-agents/tools` as a named export from `packages/tools/src/index.ts`, or move it into `shared/tool-utils.ts`. The `ResultCompressionConfig` type is already exported from `@reactive-agents/tools` (`packages/tools/src/types.ts:722`), so the natural home is there. Both reactive.ts and react-kernel.ts import from `@reactive-agents/tools` already.

---

### 2. `StrategyFn` Type Doesn't Include `availableToolSchemas`, `taskId`, or `resultCompression`

**Where:** `packages/reasoning/src/services/strategy-registry.ts` lines 19–30. The `StrategyFn` type is:

```typescript
export type StrategyFn = (input: {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableTools: readonly string[];
  readonly config: ReasoningConfig;
  readonly systemPrompt?: string;
}) => Effect.Effect<ReasoningResult, ExecutionError | IterationLimitError, LLMService>;
```

**Problem:** The `ReasoningService.execute()` params include `availableToolSchemas`, `taskId`, and `resultCompression` (visible in `execution-engine.ts` lines 529–618 and `reasoning-service.ts` lines 31–35). These are spread into strategy calls via `strategyFn({ ...params, config })` in `reasoning-service.ts:92`. Because TypeScript uses structural typing for function parameters, the extra fields on the spread object are silently accepted — but `StrategyFn`'s declared input type doesn't know about them. This means:

1. TypeScript won't error if a new field is added to `ReasoningService.execute()` params but forgotten in `StrategyFn`
2. A strategy author implementing a custom strategy using the `StrategyFn` type won't know that `availableToolSchemas` is available in the input
3. `resultCompression` is passed to reactive.ts (which declares it in `ReactiveInput`) but the `StrategyFn` type doesn't surface it — the extra field is silently dropped for reflexion/plan-execute/tree-of-thought

**Fix:** Extend `StrategyFn` input type to match the full `ReasoningService.execute()` params, including `availableToolSchemas`, `taskId`, and `resultCompression`. This also requires adding `resultCompression` to the `ReflexionInput`, `PlanExecuteInput`, and `TreeOfThoughtInput` interfaces and threading it into their kernel calls.

---

### 3. `resultCompression` Not Threaded Through Reflexion, Plan-Execute, or Tree-of-Thought

**Where:** `packages/reasoning/src/strategies/reflexion.ts` (no `resultCompression` field), `packages/reasoning/src/strategies/plan-execute.ts` (no `resultCompression` field), `packages/reasoning/src/strategies/tree-of-thought.ts` (no `resultCompression` field).

**Problem:** The execution engine passes `resultCompression` config to `ReasoningService.execute()` and the `ReactivInput` interface accepts it, but the three kernel-delegating strategies don't declare or forward it. Their `executeReActKernel()` calls omit the `resultCompression` parameter entirely. This means user-configured compression budgets (e.g., `{ budget: 400, previewItems: 2 }`) are silently ignored for all strategies except `reactive`.

**Affected path:** `execution-engine.ts:618` passes `resultCompression: config.resultCompression`, but only reaches `reactive.ts`. Reflexion, plan-execute, and tree-of-thought each call `executeReActKernel({...})` without forwarding it.

**Fix:** Add `resultCompression?: ResultCompressionConfig` to `ReflexionInput`, `PlanExecuteInput`, `TreeOfThoughtInput`, and forward it in each `executeReActKernel()` call.

---

### 4. `taskId` Not Threaded Through Reflexion or Tree-of-Thought Kernel Calls

**Where:** `packages/reasoning/src/strategies/reflexion.ts` passes `taskId: input.taskId` to its kernel calls correctly. However, `packages/reasoning/src/strategies/tree-of-thought.ts` Phase 2 kernel call (`executeReActKernel`) does not pass `taskId` — it defaults to the strategy name `"tree-of-thought"` inside the kernel instead of the actual task correlation ID from the execution engine.

**Consequence:** EventBus `ToolCallCompleted` and `ReasoningStepCompleted` events emitted by the ToT Phase 2 kernel cannot be correlated back to the originating task via `taskId`. MetricsCollector timeline shows those tool calls under a generic ID rather than the task's real UUID.

**Fix (small):** Find the Phase 2 `executeReActKernel` call in `tree-of-thought.ts` and add `taskId: input.taskId`.

---

### 5. Strategy Configuration Parity — Reflexion Kernel Iterations Hard-Coded

**Where:** `packages/reasoning/src/strategies/reflexion.ts` lines 81–88 and 228–235. Both the initial generation call and each improvement call use `maxIterations: 3` hard-coded. Plan-Execute similarly uses `maxIterations: 2` per step hard-coded.

**Problem:** `ReflexionConfig` (`packages/reasoning/src/types/config.ts:26`) only exposes `maxRetries` (outer loop iterations) and `selfCritiqueDepth`. There is no way for the user to configure how many inner kernel iterations (tool calls) each generation or improvement pass can use. A user who sets `.withReasoning({ strategies: { reflexion: { maxRetries: 5 } } })` controls how many critique-improve cycles happen, but not how many tool calls each generation pass can make.

**Similarly for Plan-Execute:** `PlanExecuteConfig` only exposes `maxRefinements` and `reflectionDepth` — no `kernelMaxIterations` per step.

**Fix:** Add optional fields to config schemas:

```typescript
// ReflexionConfigSchema addition:
kernelMaxIterations: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive()))

// PlanExecuteConfigSchema addition:
stepKernelMaxIterations: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive()))
```

Wire defaults (3 for reflexion, 2 for plan-execute per step) when these are absent.

---

### 6. Kernel Observability — Phase Attribution Gap

**Where:** `packages/reasoning/src/strategies/shared/react-kernel.ts` publishes `ReasoningStepCompleted` events with `strategy: input.parentStrategy ?? "react-kernel"`. The observability dashboard (`packages/observability/src/metrics/metrics-collector.ts`) groups `ToolCallCompleted` events by tool name but does not differentiate between kernel phases from different outer strategies.

**Problem:** When the observability dashboard shows the execution timeline, it shows phases like `[think]`, `[act]`, `[observe]`. But when Reflexion calls the kernel three times (generate → improve → improve again), all three kernel loops emit events tagged with `strategy: "reflexion"`. The dashboard cannot distinguish "which reflexion pass did this tool call come from?" The `parentStrategy` field exists in `ReActKernelInput` but is never surfaced in dashboard output.

**Concrete symptom:** In the `[tool]` section of the metrics dashboard, a tool called by the improvement pass of reflexion looks identical to one called by the generation pass. There's no "pass 1 vs pass 2" distinction in the timeline.

**Fix options:**
- Add a `kernelPass?: number` field to `ReActKernelInput` and include it in `ToolCallCompleted` events
- Or use a composite strategy tag like `"reflexion:generate"` / `"reflexion:improve"` in the kernel calls

---

### 7. Reflexion Critique History Not Written to Episodic Memory

**Where:** `packages/reasoning/src/strategies/reflexion.ts` accumulates `previousCritiques: string[]` in memory during a single run (lines 67, 214). When the run completes, this critique history is discarded — it exists only in the closure.

**Problem:** Lessons learned in one reflexion run (e.g., "this model tends to produce summaries that omit error handling") do not persist to episodic memory. The next run of the same task starts from scratch. This violates the promise of episodic memory: "lessons learned in one run inform the next."

**Contrast:** `adaptive.ts` reads `pastExperience?: readonly StrategyOutcome[]` from its input, which the execution engine populates from episodic memory. Reflexion has no equivalent — there's no way for the outer system to pass prior critique history in.

**Fix (two parts):**
1. Add `readonly priorCritiques?: readonly string[]` to `ReflexionInput` — let the execution engine populate this from episodic memory
2. After each reflexion run, write the critique history to episodic memory via `MemoryService` (either in reflexion.ts itself, or in the execution engine's post-reasoning step)

---

### 8. Hard-Coded agentId / sessionId in Kernel Tool Calls

**Where:** `packages/reasoning/src/strategies/shared/react-kernel.ts` lines 718–719. `packages/reasoning/src/strategies/reactive.ts` lines 436–437.

```typescript
agentId: "reasoning-agent",
sessionId: "reasoning-session",
```

**Problem:** Tool execution (via `ToolService.execute()`) receives a static `agentId: "reasoning-agent"` regardless of which actual agent is running. This means:
- Tool audit logs cannot be attributed to the real agent
- Sandboxed tools that restrict access by `agentId` will fail for real agent IDs
- Multiple concurrent agents running the same tool can't be distinguished in tool metrics

**Fix:** Thread `agentId` and `sessionId` through from the execution engine into `ReActKernelInput` and all strategy input types. The execution engine already has `agentId` from `AgentService` context.

---

## Priority Fixes for v0.5.6

Ranked by impact / lines of code required:

### Priority 1 — Wire `taskId` into Tree-of-Thought Phase 2 kernel call (trivial, 1 line)

`packages/reasoning/src/strategies/tree-of-thought.ts`: add `taskId: input.taskId` to the Phase 2 `executeReActKernel()` call. Fixes event correlation for all ToT tool calls.

### Priority 2 — Wire `resultCompression` through Reflexion, Plan-Execute, Tree-of-Thought

Add `resultCompression?: ResultCompressionConfig` to the three strategy input interfaces and forward to kernel calls. ~20 lines total. Ensures user compression config is respected by all strategies.

### Priority 3 — Extend `StrategyFn` type to match full execute params

`packages/reasoning/src/services/strategy-registry.ts`: add `availableToolSchemas`, `taskId`, `resultCompression` to `StrategyFn` input type. Eliminates silent drop of fields for custom strategy implementors. ~10 lines of type change.

### Priority 4 — Consolidate `compressToolResult` / `compressKernelToolResult`

Move the shared implementation to `shared/tool-utils.ts` or `@reactive-agents/tools`. Export from `shared/index.ts`. Update both `reactive.ts` and `react-kernel.ts` to import from the single location. ~15 lines removed from `react-kernel.ts`.

### Priority 5 — Add `kernelMaxIterations` config fields to ReflexionConfig and PlanExecuteConfig

`packages/reasoning/src/types/config.ts`: extend both schemas. Default to existing hard-coded values. Thread through in both strategy files. ~25 lines total including schema changes and wire-up.

### Priority 6 — Thread real `agentId` / `sessionId` through kernel

Add `agentId?: string` and `sessionId?: string` to `ReActKernelInput`. Default to current static strings when absent. Update execution engine to pass agent context values. ~30 lines total.

### Priority 7 — Reflexion priorCritiques from episodic memory

Add `priorCritiques?: readonly string[]` to `ReflexionInput`. Update execution engine to query episodic memory for prior critiques. Write critiques to episodic memory post-run. ~40 lines total across reasoning-service and execution-engine.

---

## Non-Goals for v0.5.6

The following were considered but are deferred:

- **Kernel observability pass attribution** — Requires changes to the observability dashboard rendering logic and a new event field. Deferred to v0.6.0 when the dashboard gets its next major revision.
- **Streaming kernel results** — The kernel currently accumulates all steps then returns. Adding streaming would require changing the return type from `Effect<ReActKernelResult>` to a streaming `Stream`. Large scope change.
- **Per-strategy EventBus channel** — Currently all strategies share one EventBus channel. Routing strategy-specific events to typed sub-channels is an architecture decision that touches `@reactive-agents/core`.
