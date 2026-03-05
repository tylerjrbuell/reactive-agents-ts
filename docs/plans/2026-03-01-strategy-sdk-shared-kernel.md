# Strategy SDK: Shared Kernel & Utilities Design

> **Status:** Approved — ready for implementation planning
> **Date:** 2026-03-01
> **Scope:** `packages/reasoning/src/strategies/`

---

## Problem Statement

All 5 reasoning strategies (ReAct, Reflexion, Plan-Execute, Tree-of-Thought, Adaptive) are **algorithmically specialized** but share the same execution infrastructure, which is currently duplicated across every file:

| Duplicated Pattern | Lines Per File | Files Affected |
|---|---|---|
| Service resolution (LLM, ToolService, PromptService, EventBus) | ~20 | All 5 |
| `compilePromptOrFallback()` | ~12 | All 5 |
| EventBus publish boilerplate (`if (ebOpt._tag === "Some")...catchAll`) | 5–8 per call site, ~20–45 total | All 5 |
| `ReasoningStep` creation (`ulid() as StepId`, type, timestamp) | 3–5 per site, ~15–50 total | All 5 |
| Tool parsing (`parseAllToolRequests`, brace-matching) | ~60 | reactive.ts + tree-of-thought.ts |
| `isSatisfied(text)` | ~5 | reflexion.ts + plan-execute.ts |
| Result building (`buildResult()`) | ~20 | reflexion.ts + plan-execute.ts + tree-of-thought.ts |

Beyond duplication, **Reflexion and Plan-Execute cannot use tools** — their "execution" is pure LLM calls where real tool calls should happen. Tree-of-Thought Phase 2 has a ReAct loop inline but with inferior tool handling (head+tail truncation, no scratchpad, no compression).

**Root cause:** The ReAct execution primitive — think → parse action → execute tool → observe — is embedded in `reactive.ts` and partially duplicated in `tree-of-thought.ts` Phase 2. It has never been extracted as a shared capability.

---

## Vision Alignment

From `spec/docs/00-VISION.md`:
> **Composition Over Configuration** — Build complex capabilities from simple, reusable pieces.

The current architecture inverts this: each strategy monolithically reimplements what it needs. The target architecture:

```
Strategies = algorithm (outer loop)
           + ReAct Kernel (inner execution primitive)
           + Shared Utilities (infrastructure)
```

Each strategy specializes in its control flow algorithm. Tool execution, EventBus integration, context management, and quality assessment are infrastructure shared by all.

---

## Target Architecture

### Layer Structure

```
packages/reasoning/src/strategies/
  shared/
    react-kernel.ts      ← THE execution primitive (think→act→observe)
    tool-utils.ts        ← tool parsing, final answer extraction (unified from reactive + ToT)
    service-utils.ts     ← resolveStrategyServices(), compilePromptOrFallback(), publishStep()
    step-utils.ts        ← makeStep(), buildStrategyResult(), withStrategyError()
    quality-utils.ts     ← isSatisfied(), isCritiqueStagnant(), parseScore()
    context-utils.ts     ← compactHistory(), formatToolSchemas()
    index.ts             ← barrel export

  reactive.ts            ← Refactored: uses shared utilities, outer loop unchanged
  reflexion.ts           ← Refactored: generation + improvement via ReActKernel
  plan-execute.ts        ← Refactored: each step execution via ReActKernel
  tree-of-thought.ts     ← Refactored: Phase 2 via ReActKernel (replace inline loop)
  adaptive.ts            ← Minor cleanup only (delegates, doesn't execute)
```

---

## Shared Utilities Specification

### 1. `shared/service-utils.ts`

**Exports:**

```typescript
// Single Effect call that resolves all optional services at once.
// Replaces the identical ~20-line block at the top of every strategy.
export const resolveStrategyServices: Effect.Effect<{
  llm: LLMService["Service"];
  toolService: Option.Option<ToolService["Service"]>;
  promptService: Option.Option<PromptService["Service"]>;
  eventBus: Option.Option<EventBus["Service"]>;
}, never, LLMService>

// Moves the duplicated compilePromptOrFallback() out of all 5 strategy files.
// Signature is unchanged from current per-file version.
export const compilePromptOrFallback: (
  promptServiceOpt: Option.Option<PromptService["Service"]>,
  templateId: string,
  variables: Record<string, unknown>,
  fallback: string,
  tier?: string,
) => Effect.Effect<string, never>

// Collapses the if-._tag === "Some" → publish → catchAll pattern to one line.
export const publishReasoningStep: (
  eventBus: Option.Option<EventBus["Service"]>,
  payload: ReasoningStepPayload,
) => Effect.Effect<void, never>

// Wraps an Effect with the standard LLM error mapping pattern.
export const withStrategyError: <A>(
  effect: Effect.Effect<A, LLMError, never>,
  strategy: string,
  message: string,
  step: number,
) => Effect.Effect<A, ExecutionError, never>
```

---

### 2. `shared/step-utils.ts`

**Exports:**

```typescript
// Replaces the ulid()+timestamp boilerplate at every step creation site.
export const makeStep: (
  type: ReasoningStep["type"],
  content: string,
  metadata?: ReasoningStep["metadata"],
) => ReasoningStep

// Unified result builder. Each strategy currently has its own version.
// Handles the full ReasoningResult shape consistently.
export const buildStrategyResult: (params: {
  strategy: ReasoningStrategy;
  steps: ReasoningStep[];
  output: unknown;
  status: "completed" | "partial" | "failed";
  start: number;  // Date.now() at strategy start
  totalTokens: number;
  totalCost: number;
  extraMetadata?: Record<string, unknown>;  // selectedStrategy, fallbackOccurred, etc.
}) => ReasoningResult
```

---

### 3. `shared/quality-utils.ts`

**Exports:**

```typescript
// Currently duplicated in reflexion.ts and plan-execute.ts.
export const isSatisfied: (text: string) => boolean

// Currently in reflexion.ts only. Useful for any iterative quality loop.
export const isCritiqueStagnant: (
  previousCritiques: string[],
  newCritique: string,
) => boolean

// Currently in tree-of-thought.ts only.
// Handles: "75%", "3/4", "Score: 0.8", "7" (→0.7), <think> tag stripping.
export const parseScore: (text: string) => number
```

---

### 4. `shared/context-utils.ts`

**Exports:**

```typescript
// Unified compaction replacing three near-identical implementations:
// - reactive: buildCompactedContext() — keeps last 4 steps
// - plan-execute: buildCompactedStepContext() — keeps last 5 step results
// - tree-of-thought Phase 2: rawHistory.slice(-8) inline
export const compactHistory: (
  steps: ReasoningStep[],
  keepRecent: number,
  format?: "react" | "summary",
) => string

// Unified tool schema formatter (replaces formatToolSchema in reactive,
// totFormatToolSchema in tree-of-thought).
export const formatToolSchemas: (
  schemas: ToolSchema[],
  verbose?: boolean,
) => string
```

---

### 5. `shared/tool-utils.ts`

**Exports:**

```typescript
// Unified from reactive's parseAllToolRequests + ToT's totParseAllToolRequests.
// Both use near-identical brace-matching logic. One implementation, tested once.
export const parseAllToolRequests: (
  thought: string,
) => Array<{ tool: string; input: Record<string, unknown>; transform?: string }>

// Single-request variant. Replaces parseToolRequest (reactive) and totParseToolRequest (ToT).
export const parseToolRequest: (
  thought: string,
) => { tool: string; input: Record<string, unknown>; transform?: string } | null

// Replaces hasFinalAnswer (reactive) and totHasFinalAnswer (ToT).
export const hasFinalAnswer: (text: string) => boolean

// Replaces extractFinalAnswer (reactive) and totExtractFinalAnswer (ToT).
export const extractFinalAnswer: (text: string) => string

// Resolves tool arguments with the smart remapping logic from reactive
// (JSON parse → first required param fallback → multi-param handling).
// Currently only in reactive.ts — plan-execute and ToT have simpler logic.
export const resolveToolArgs: (
  input: unknown,
  toolParameters: ToolParameter[],
) => Record<string, unknown>
```

---

### 6. `shared/react-kernel.ts` — The Execution Primitive

This is the central contribution. It extracts the ReAct inner loop from `reactive.ts` and makes it available to every strategy.

```typescript
export interface ReActKernelInput {
  /** The task or sub-task to solve in this kernel invocation. */
  task: string;
  /** System prompt for the LLM. */
  systemPrompt?: string;
  /** Full tool schemas (enables tool use; omit for pure-LLM execution). */
  availableToolSchemas?: ToolSchema[];
  /**
   * Prior context injected before the think loop.
   * Used by Reflexion to inject critiques, Plan-Execute to inject step context.
   */
  priorContext?: string;
  /** Max think→act→observe iterations. Defaults to 5. */
  maxIterations?: number;
  /** Context profile for model-adaptive behavior. */
  contextProfile?: ContextProfile;
  /** Tool result compression config (inherited from outer strategy config). */
  resultCompression?: ResultCompressionConfig;
  /** Temperature for the LLM thought generation call. Defaults to 0.7. */
  temperature?: number;
  /** TaskId for EventBus correlation. */
  taskId?: string;
  /** Parent strategy name (for step tagging and EventBus events). */
  parentStrategy?: string;
}

export interface ReActKernelResult {
  output: string;
  steps: ReasoningStep[];
  totalTokens: number;
  totalCost: number;
  toolsUsed: string[];
  iterations: number;
  terminatedBy: "final_answer" | "max_iterations" | "end_turn";
}

// The kernel is an Effect — accesses LLMService (required),
// ToolService + EventBus + PromptService (all optional via serviceOption).
export const executeReActKernel: (
  input: ReActKernelInput,
) => Effect.Effect<ReActKernelResult, ExecutionError, LLMService>
```

**What the kernel owns (extracted from reactive.ts):**
- Think→act→observe loop with configurable `maxIterations`
- Context building with compaction (via `compactHistory`)
- Tool request parsing (via `parseAllToolRequests`)
- Tool execution via optional `ToolService`
- **Full tool result compression pipeline**: pipe transforms → JSON array/object preview → text preview → scratchpad overflow storage
- Completed-action deduplication (prevents repeating successful tool calls)
- Stop sequences `["Observation:", "\nObservation:"]` on thought calls
- Early termination on `end_turn` signal (≥50 chars, no action, iteration ≥1)
- `FINAL ANSWER:` detection and extraction
- EventBus publishing (`ReasoningStepCompleted`, `ToolCallCompleted`, `FinalAnswerProduced`)

**What the kernel does NOT own (stays in each strategy):**
- The outer control loop (how many kernel invocations, when to retry)
- System prompt construction for the kernel call
- Inter-invocation context assembly (e.g., how reflexion injects critiques)
- Quality assessment (satisfaction checking, stagnation detection)

---

## Per-Strategy Refactoring

### Reflexion (reflexion.ts)

**Before:** 3 pure LLM calls per iteration — no tool access in any pass.

**After:**
```
Generation pass:  executeReActKernel(task, {priorContext: critiques, maxIter: 3})
Critique pass:    llm.complete(...)  ← pure LLM, no tools needed for quality judgment
Improvement pass: executeReActKernel(task, {priorContext: critiques+response, maxIter: 3})
```

- `isSatisfied` → imported from `quality-utils`
- `isCritiqueStagnant` → imported from `quality-utils`
- `buildCompactedCritiqueHistory` → stays in reflexion (algorithm-specific)
- `buildResult` → replaced by `buildStrategyResult` from `step-utils`
- `compilePromptOrFallback` → imported from `service-utils`
- Service resolution block → replaced by `resolveStrategyServices()`

### Plan-Execute (plan-execute.ts)

**Before:** Each step is a single LLM call `"Execute this step: ..."` — no tool access.

**After:**
```
Planning pass:    llm.complete(buildPlanPrompt(...))  ← pure LLM
For each step:    executeReActKernel(stepDescription, {priorContext: compactedContext, maxIter: 2})
Reflection pass:  llm.complete(buildReflectPrompt(...))  ← pure LLM
Synthesis pass:   llm.complete(synthesisPrompt)  ← pure LLM
```

- `isSatisfied` → imported from `quality-utils`
- `buildCompactedStepContext` → replaced by `compactHistory` from `context-utils`
- `parsePlanSteps` → stays in plan-execute (algorithm-specific, not a tool utility)
- `buildResult` → replaced by `buildStrategyResult`
- `compilePromptOrFallback` → imported from `service-utils`

### Tree-of-Thought (tree-of-thought.ts)

**Before:** Phase 2 has inline ReAct loop with `totParseAllToolRequests` + `totExecTool` (basic head+tail truncation, no scratchpad).

**After:**
```
Phase 1 (BFS):    unchanged — pure LLM exploration + scoring
Phase 2 (exec):   executeReActKernel(task, {priorContext: bestPath, maxIter: execMaxIter})
```

- `totParseAllToolRequests` + `totParseToolRequest` → deleted; kernel uses shared `tool-utils`
- `totExecTool` → deleted; kernel handles tool execution with full compression pipeline
- `totHasFinalAnswer`, `totExtractFinalAnswer` → deleted; kernel handles these
- `parseScore` → imported from `quality-utils`
- `getAncestorPath` → stays in tree-of-thought (BFS-specific)
- Phase 2 context (history + best path) → assembled by ToT, passed as `priorContext` to kernel

### Reactive (reactive.ts)

The kernel IS reactive's inner loop. Two options:

**Option A (recommended):** Keep `reactive.ts` as-is. The kernel is extracted FROM it, and reactive is refactored to call the kernel internally. This ensures reactive's algorithm is unchanged and its tests keep passing. Net effect: reactive becomes simpler internally but API is identical.

**Option B (stretch):** Reduce reactive to a thin wrapper that just calls `executeReActKernel` with reactive-specific prompt building. Higher risk — defer to separate PR.

### Adaptive (adaptive.ts)

No execution changes. Already delegates to sub-strategies.
- Extract `compilePromptOrFallback` → `service-utils`
- Extract EventBus publish calls → `publishReasoningStep`
- Extract service resolution → `resolveStrategyServices`
- `buildAnalysisPrompt` with examples → stays in adaptive

---

## Test Strategy

### New Tests: `packages/reasoning/tests/shared/`

```
react-kernel.test.ts     ← unit tests for the kernel
  - kernel without tools (pure LLM path)
  - kernel with tools (ToolService present)
  - kernel stops on "FINAL ANSWER:"
  - kernel reaches maxIterations → returns partial
  - kernel respects stop sequences
  - tool result compression (scratchpad overflow)
  - completed action deduplication

tool-utils.test.ts       ← unit tests for shared tool parsing
  - parseAllToolRequests with brace-matching
  - parseToolRequest with transform expression
  - hasFinalAnswer, extractFinalAnswer
  - resolveToolArgs fallback logic

quality-utils.test.ts    ← unit tests for shared quality functions
  - isSatisfied patterns
  - isCritiqueStagnant (exact match, substring match)
  - parseScore all formats (%, ratio, decimal, labeled, <think> stripping)

step-utils.test.ts       ← unit tests for step/result creation
  - makeStep generates valid ulid StepId
  - buildStrategyResult produces valid ReasoningResult shape
```

### Updated Strategy Tests

After refactoring, verify existing strategy tests still pass:
- reflexion tests: add 2 new tests for tool-aware generation + improvement
- plan-execute tests: add 2 new tests for tool-aware step execution
- tree-of-thought tests: existing tests cover Phase 2; verify kernel integration
- All existing tests should pass without modification (behavior preserved)

---

## Acceptance Criteria

- [ ] `shared/` directory contains all 6 files + barrel export
- [ ] `compilePromptOrFallback` deleted from all 5 strategy files; imported from `service-utils`
- [ ] `isSatisfied` deleted from reflexion + plan-execute; imported from `quality-utils`
- [ ] `parseAllToolRequests` / `totParseAllToolRequests` deleted from reactive + ToT; use `tool-utils`
- [ ] Reflexion generation + improvement calls pass through `executeReActKernel`
- [ ] Plan-Execute step execution calls pass through `executeReActKernel`
- [ ] Tree-of-Thought Phase 2 loop replaced with single `executeReActKernel` call
- [ ] Service resolution block replaced in all 5 strategies by `resolveStrategyServices()`
- [ ] All existing 909+ tests pass (no regressions)
- [ ] New shared utility tests added (target: 25+ new tests)
- [ ] Live test: reflexion solves GitHub commits task using tools (was previously impossible)
- [ ] Live test: plan-execute solves multi-step research task with real tool calls per step

---

## Parallelization Plan

**Wave 1 — Independent shared utilities (fully parallel):**
- Agent A: `tool-utils.ts` + `tool-utils.test.ts`
- Agent B: `service-utils.ts` + `step-utils.ts` + `step-utils.test.ts`
- Agent C: `quality-utils.ts` + `context-utils.ts` + `quality-utils.test.ts`

**Wave 2 — ReAct kernel (depends on Wave 1):**
- Single agent: `react-kernel.ts` + `react-kernel.test.ts`

**Wave 3 — Strategy refactoring (parallel, each depends on Wave 2):**
- Agent A: Refactor `reflexion.ts` + update reflexion tests
- Agent B: Refactor `plan-execute.ts` + update plan-execute tests
- Agent C: Refactor `tree-of-thought.ts` + update ToT tests
- Agent D: Clean up `reactive.ts` + clean up `adaptive.ts` (shared utils only, no kernel change)

**Wave 4 — Integration:**
- Full test suite: `bun test`
- Live testing in `main.ts` with each strategy
- Feature gap analysis doc

---

## Feature Gap Analysis (Post-Implementation)

After the kernel and strategy refactoring are complete, evaluate these gaps against the Vision:

| Vision Capability | Current State | Gap |
|---|---|---|
| Tool-aware Reflexion | ❌ Pure LLM | Fixed by this plan |
| Tool-aware Plan-Execute steps | ⚠️ Partial (parseToolFromStep) | Fixed by this plan |
| Tool result compression across all strategies | ❌ Only reactive | Fixed by kernel |
| Voice agent support | ❌ Not started | v0.7.0 scope |
| React/UI hooks (`useAgent`) | ❌ Not started | v0.7.0 scope |
| Edge/WASM deployment | ❌ Not started | v0.7.0 scope |
| Docker code sandbox | ⚠️ Subprocess only | v0.6.0 scope |
| Programmatic tool calling strategy | ❌ Not started | v0.6.0 scope |
| Streaming service wired | ❌ Spec'd not wired | v0.6.0 scope |
| Strategy selection from past experience | ✅ Cross-task self-improvement | Complete |

Small gaps fixable in this session (alongside strategy work):
- `parseToolFromStep` in plan-execute uses a limited regex vs. the full brace-matching in reactive — fixed by using shared `parseAllToolRequests`
- ToT tool result truncation is naive head+tail — fixed by kernel compression pipeline
- Reflexion `buildCompactedCritiqueHistory` could use shared `compactHistory` — easy cleanup
