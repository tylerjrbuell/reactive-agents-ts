# Spec Review: Issues, Gaps & Contradictions

**Date:** February 18–19, 2026  
**Scope:** Full review of all 15 spec files + cross-reference with inception vision docs (`00-VISION.md`, `02-CORE-PILLARS.md`, `09-ROADMAP.md`)  
**Impact levels:** 🔴 Blocker (will break build) | 🟠 Major (wrong behavior) | 🟡 Minor (inconsistency/polish)

> **Resolution Status (February 19, 2026):** All 35 issues have been resolved across the spec files.  
> Additionally, `spec/docs/00-monorepo-setup.md` was created (G2).  
> Each issue below is marked ✅ Applied with the spec files that were modified.

---

## Summary Table

| #   | Category                                                                                | Severity | Status | Files Modified                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------- | -------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | ContextWindowManager defined in two places                                              | 🟠       | ✅     | `11-missing-capabilities-enhancement.md`                                                                                                              |
| C2  | ReasoningStrategy exported from two packages                                            | 🟠       | ✅     | `03-layer-reasoning.md`                                                                                                                               |
| C3  | Strategy name "plan-execute" vs "plan-execute-reflect"                                  | 🔴       | ✅     | `FRAMEWORK_USAGE_GUIDE.md`, `03-layer-reasoning.md`, `CLAUDE.md`                                                                                      |
| C4  | Core build order step count mismatch (13 vs 14)                                         | 🟡       | ✅     | `DOCUMENT_INDEX.md`                                                                                                                                   |
| C5  | Interaction package Phase placement conflict                                            | 🟠       | ✅     | `layer-10-interaction-revolutionary-design.md`, `implementation-guide-complete.md`                                                                    |
| A1  | `llm.complete()` called with `prompt:` field that doesn't exist                         | 🔴       | ✅     | `03-layer-reasoning.md`                                                                                                                               |
| A2  | `thoughtResponse.text` — field doesn't exist on CompletionResponse                      | 🔴       | ✅     | `03-layer-reasoning.md`                                                                                                                               |
| A3  | `LifecycleHook.handler` typed `never` error but examples use `Effect.fail()`            | 🔴       | ✅     | `layer-01b-execution-engine.md`                                                                                                                       |
| A4  | `builder.ts` provider config ignores OpenAI/Ollama at createRuntime level               | 🟠       | ✅     | `layer-01b-execution-engine.md`, `FRAMEWORK_USAGE_GUIDE.md`                                                                                           |
| D1  | `@reactive-agents/reasoning` missing `llm-provider` dependency                          | 🔴       | ✅     | `03-layer-reasoning.md`                                                                                                                               |
| D2  | `@reactive-agents/tools` depends on `identity` but identity builds in Phase 3           | 🔴       | ✅     | `08-layer-tools.md`                                                                                                                                   |
| D3  | `@reactive-agents/guardrails` missing `llm-provider` in package.json                    | 🟠       | ✅     | `11-missing-capabilities-enhancement.md`                                                                                                              |
| D4  | `@reactive-agents/verification` references non-existent `FactualMemory` type            | 🔴       | ✅     | `04-layer-verification.md`                                                                                                                            |
| G1  | `ReasoningService` never called from `ExecutionEngine` — dead package wire              | 🔴       | ✅     | `layer-01b-execution-engine.md`                                                                                                                       |
| G2  | No monorepo setup spec (root package.json, tsconfig, bun workspaces)                    | 🔴       | ✅     | Created `00-monorepo-setup.md`                                                                                                                        |
| G3  | `GuardrailService.killAgent()` promises EventBus emit but uses console.error            | 🟠       | ✅     | `11-missing-capabilities-enhancement.md`                                                                                                              |
| G4  | `builder.ts` missing from runtime Build Order                                           | 🟠       | ✅     | Verified already present in `layer-01b-execution-engine.md`                                                                                           |
| G5  | "6 Anthropic workflow patterns" claimed but only 5 in WorkflowPattern schema            | 🟡       | ✅     | `07-layer-orchestration.md`                                                                                                                           |
| G6  | Most layer specs missing package.json section                                           | 🟠       | ✅     | `04-layer-verification.md`, `05-layer-cost.md`, `06-layer-identity.md`, `07-layer-orchestration.md`, `09-layer-observability.md`                      |
| G7  | `createRuntime()` accepts only `anthropicApiKey` — no OpenAI/Ollama option              | 🟠       | ✅     | `layer-01b-execution-engine.md` (merged with A4)                                                                                                      |
| G8  | `ReactiveAgentsConfig.agentId` makes each runtime single-agent; undocumented            | 🟠       | ✅     | `FRAMEWORK_USAGE_GUIDE.md`                                                                                                                            |
| G9  | `StreamingService` extension purpose not defined vs `LLMService.stream()`               | 🟡       | ✅     | `11-missing-capabilities-enhancement.md`                                                                                                              |
| M1  | EventBus contract uses `fact: Fact` — `Fact` type was removed                           | 🟡       | ✅     | `00-master-architecture.md`                                                                                                                           |
| M2  | `importanceThreshold` default: 0.6 in spec vs 0.7 in architecture table                 | 🟡       | ✅     | `02-layer-memory.md`                                                                                                                                  |
| M3  | Model name inconsistency across examples                                                | 🟡       | ✅     | `01.5-layer-llm-provider.md`                                                                                                                          |
| M4  | `LogLevel` defined in both `@reactive-agents/core` and `@reactive-agents/observability` | 🟡       | ✅     | `09-layer-observability.md`                                                                                                                           |
| V1  | `withReasoningController()` / `withContextController()` absent from builder             | 🟠       | ✅     | `FRAMEWORK_USAGE_GUIDE.md`, `03-layer-reasoning.md`, `layer-01-core-detailed-design.md`                                                               |
| V2  | Middleware / plugin system not specced; claimed as ✅ in competitive analysis           | 🟡       | ✅     | `FRAMEWORK_USAGE_GUIDE.md` (AgentPlugin + withPlugin)                                                                                                 |
| V3  | `agent.metrics()` real-time stream absent from `ReactiveAgent` API                      | 🟠       | ✅     | `FRAMEWORK_USAGE_GUIDE.md`                                                                                                                            |
| V4  | `onUncertainty()` / `onDecision()` not instance methods on `ReactiveAgent`              | 🟡       | ✅     | `FRAMEWORK_USAGE_GUIDE.md`                                                                                                                            |
| V5  | Time-travel debugging claimed in competitive analysis but unspecced                     | 🟡       | ✅     | `FRAMEWORK_USAGE_GUIDE.md` (DebugSession type + debugger() method added). Competitive analysis correctly attributes time-travel to LangGraph, not RA. |
| V6  | `withCircuitBreaker()` builder method absent; only in llm-provider retry                | 🟡       | ✅     | `FRAMEWORK_USAGE_GUIDE.md`, `layer-01-core-detailed-design.md`                                                                                        |
| V7  | Graceful degradation levels not specced anywhere                                        | 🟡       | ✅     | `05-layer-cost.md`                                                                                                                                    |
| V8  | `withTokenBudget()` builder method not in spec; cost spec has no per-task budget        | 🟠       | ✅     | `FRAMEWORK_USAGE_GUIDE.md`, `layer-01-core-detailed-design.md`                                                                                        |
| V9  | Secret management absent from `@reactive-agents/identity` spec                          | 🟡       | ✅     | `06-layer-identity.md`                                                                                                                                |
| V10 | `ReactiveAgent` instance method surface incomplete (getTrace, metrics, debugger etc.)   | 🟠       | ✅     | `FRAMEWORK_USAGE_GUIDE.md`                                                                                                                            |

---

## Detailed Findings

---

### C1 — ContextWindowManager Defined Twice 🟠 ✅ RESOLVED

**Files:** `layer-01-core-detailed-design.md` (build step 11), `11-missing-capabilities-enhancement.md` (Extension 5)

**Problem:** `layer-01-core-detailed-design.md` already specifies `ContextWindowManager` as step 11 of the core build order, with full service/layer code. `11-missing-capabilities-enhancement.md` Extension 5 says "Add `ContextWindowManager` → to `@reactive-agents/core`" as if it doesn't exist yet.

`implementation-guide-complete.md` partially addresses this with a NOTE: "ContextWindowManager was formerly deferred to Phase 3; it's now required in Phase 1" — but `11-missing-capabilities-enhancement.md` was never updated.

**Fix:** In `11-missing-capabilities-enhancement.md`, update Extension 5 to read:

> "~~ContextWindowManager~~ — **Already included in `@reactive-agents/core` Phase 1 (build step 11).** No action required."

---

### C2 — `ReasoningStrategy` Exported from Two Packages 🟠 ✅ RESOLVED

**Files:** `layer-01-core-detailed-design.md` (`src/types/agent.ts`), `03-layer-reasoning.md` (`src/types/reasoning.ts`)

**Problem:** Both `@reactive-agents/core` and `@reactive-agents/reasoning` export an identical `ReasoningStrategy` literal union. The reasoning spec notes this:

> "NOTE: ReasoningStrategy is also exported from @reactive-agents/core as a CapabilityType sub-enum. This is the authoritative, detailed version."

But since `@reactive-agents/reasoning` depends on `@reactive-agents/core`, and both re-export the same type, consumers and other packages (like `@reactive-agents/runtime`) face ambiguity about which import to use.

**Fix:** In `layer-01-core-detailed-design.md`, change the `ReasoningStrategy` literal in `src/types/agent.ts` to import-and-re-export from `@reactive-agents/reasoning` — BUT this creates a circular dependency since reasoning depends on core.

Correct approach: Keep `ReasoningStrategy` only in core (it has no circular dep there). Remove it from `@reactive-agents/reasoning/src/types/reasoning.ts` and import it from `@reactive-agents/core` instead. Update `03-layer-reasoning.md` accordingly:

```typescript
// In @reactive-agents/reasoning/src/types/reasoning.ts
import { ReasoningStrategy } from "@reactive-agents/core";
export { ReasoningStrategy }; // re-export for convenience
```

---

### C3 — Strategy Name: `"plan-execute"` vs `"plan-execute-reflect"` 🔴 ✅ RESOLVED

**Files:** `FRAMEWORK_USAGE_GUIDE.md` (builder.ts method and examples), `CLAUDE.md`, `03-layer-reasoning.md`, `00-master-architecture.md`, `layer-01-core-detailed-design.md`

**Problem:** `ReactiveAgentBuilder.withReasoningStrategy()` in `FRAMEWORK_USAGE_GUIDE.md` accepts `"plan-execute"`:

```typescript
.withReasoningStrategy('plan-execute')
```

But the canonical `ReasoningStrategy` literal across all specs is `"plan-execute-reflect"`. This will cause a TypeScript type error at runtime.

Also, `CLAUDE.md` uses both forms inconsistently:

- Architecture overview: `"PlanExec"`, `"PlanExecuteReflect"`
- Strategy selector examples: `"plan-execute-reflect"`

**Fix:** Standardize to `"plan-execute-reflect"` everywhere:

1. In `FRAMEWORK_USAGE_GUIDE.md` builder method signature:

```typescript
withReasoningStrategy(
  strategy: "reactive" | "plan-execute-reflect" | "reflexion" | "tree-of-thought" | "adaptive",
): this
```

2. Update all builder usage examples in `FRAMEWORK_USAGE_GUIDE.md`
3. Update `CLAUDE.md` FRAMEWORK_USAGE_GUIDE section

---

### C4 — Core Build Order Step Count: 13 vs 14 🟡 ✅ RESOLVED

**Files:** `DOCUMENT_INDEX.md` (says "Build Order: 13 steps"), `layer-01-core-detailed-design.md` (has 14 steps)

**Fix:** Update `DOCUMENT_INDEX.md` row for layer 1: "Build Order: 14 steps."

---

### C5 — Interaction Package Phase Placement Conflict 🟠 ✅ RESOLVED

**Files:** `START_HERE_AI_AGENTS.md` (Phase 1, step 6), `implementation-guide-complete.md` (P3 W13-14), `layer-10-interaction-revolutionary-design.md` ("Phase: 3 (Weeks 9-10)")

**Problem:**

- `START_HERE_AI_AGENTS.md` step 6 says: build `@reactive-agents/interaction` (Autonomous only) in Phase 1 alongside runtime
- `implementation-guide-complete.md` package map maps the entire `interaction` package to `P3 W13-14`
- The interaction spec itself says "Phase: 3 (Weeks 9-10)"

This creates confusion about when to build the interaction package.

**Fix:** Align all three docs to the clarified intent:

- In `layer-10-interaction-revolutionary-design.md`: "**Phase:** 1C (Autonomous mode only, Week 4); Phase 3 (all 5 modes, Weeks 13-14)"
- In `implementation-guide-complete.md` package map: Add a row note "Autonomous mode: P1 W4; All modes: P3 W13-14"
- `START_HERE_AI_AGENTS.md` already correctly states this split — no change needed there

---

### A1 — `llm.complete()` Called With Non-Existent `prompt:` Field 🔴 ✅ RESOLVED

**Files:** `03-layer-reasoning.md` (`src/strategies/reactive.ts`), `01.5-layer-llm-provider.md`

**Problem:** `executeReactive` calls:

```typescript
const thoughtResponse = yield* Effect.tryPromise({
  try: () =>
    llm.complete({
      prompt: buildThoughtPrompt(context, steps),  // ← WRONG: no 'prompt' field
      maxTokens: 300,
      temperature: temp,
    }),
  ...
});
```

But `LLMService.complete()` takes `CompletionRequest`, which has a `messages: readonly LLMMessage[]` array, not a `prompt: string`. The call will fail TypeScript compilation.

**Fix:** Update `executeReactive` to use the correct `CompletionRequest` shape:

```typescript
const thoughtResponse =
  yield *
  llm.complete({
    messages: [{ role: "user", content: buildThoughtPrompt(context, steps) }],
    maxTokens: 300,
    temperature: temp,
  });
```

And if a system prompt is needed:

```typescript
const thoughtResponse =
  yield *
  llm.complete({
    messages: [{ role: "user", content: buildThoughtPrompt(context, steps) }],
    systemPrompt: `You are a reasoning agent. Task: ${input.taskDescription}`,
    maxTokens: 300,
    temperature: temp,
  });
```

Apply the same correction to all other strategy functions (`plan-execute.ts`, `tree-of-thought.ts`, `reflexion.ts`).

---

### A2 — `thoughtResponse.text` / `.usage.confidence` Don't Exist 🔴 ✅ RESOLVED

**Files:** `03-layer-reasoning.md` (`src/strategies/reactive.ts`)

**Problem:** After the LLM call, the strategy accesses:

```typescript
const thought = thoughtResponse.text; // ← WRONG: CompletionResponse has 'content'
totalTokens += thoughtResponse.usage.totalTokens;
totalCost += thoughtResponse.usage.cost; // ← OK, 'cost' exists
metadata: {
  confidence: thoughtResponse.usage.confidence;
} // ← WRONG: no 'confidence' in TokenUsage
```

`CompletionResponse` from `01.5-layer-llm-provider.md`:

```typescript
interface CompletionResponse {
  readonly content: string; // ← use this, not .text
  readonly stopReason: StopReason;
  readonly usage: TokenUsage;
  readonly model: string;
  readonly toolCalls?: readonly ToolCall[];
}

interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedCost: number; // ← use this for cost
  // no 'cost' field, no 'confidence' field
}
```

**Fix:** Update `executeReactive` (and other strategies):

```typescript
const thought = thoughtResponse.content; // was .text
totalTokens += thoughtResponse.usage.totalTokens;
totalCost += thoughtResponse.usage.estimatedCost; // was .cost
// Remove: metadata: { confidence: thoughtResponse.usage.confidence }
// Optionally derive confidence heuristically or omit from step metadata
```

---

### A3 — `LifecycleHook.handler` Return Type `never` Conflicts With Examples 🔴 ✅ RESOLVED

**Files:** `layer-01b-execution-engine.md` (types.ts), `FRAMEWORK_USAGE_GUIDE.md`

**Problem:** The `LifecycleHook` interface is defined as:

```typescript
export interface LifecycleHook {
  readonly handler: (
    ctx: ExecutionContext,
  ) => Effect.Effect<ExecutionContext, never>; // ← 'never' for error
}
```

But the usage guide shows hooks that fail:

```typescript
// Budget guard hook:
handler: (ctx) => ctx.cost > 0.50
  ? Effect.fail(new ExecutionError({ ... }))  // ← Error is ExecutionError, not never
  : Effect.succeed(ctx),

// Human-in-the-loop hook:
handler: (ctx) => Effect.gen(function* () {
  ...
  return yield* Effect.fail(new ExecutionError({ ... }));  // ← same issue
})
```

TypeScript will reject these as type errors because `ExecutionError` is not assignable to `never`.

**Fix:** Change the handler signature to allow `ExecutionError`:

```typescript
import type { ExecutionError } from "./errors.js";

export interface LifecycleHook {
  readonly handler: (
    ctx: ExecutionContext,
  ) => Effect.Effect<ExecutionContext, ExecutionError | never>;
}
// Or more practically:
export interface LifecycleHook {
  readonly handler: (
    ctx: ExecutionContext,
  ) => Effect.Effect<ExecutionContext, ExecutionError>;
}
```

Update `LifecycleHookRegistry.run()` signature accordingly:

```typescript
readonly run: (
  phase: LifecyclePhase,
  timing: HookTiming,
  ctx: ExecutionContext,
) => Effect.Effect<ExecutionContext, HookError | ExecutionError>;
```

---

### A4 — `createRuntime()` Only Accepts `anthropicApiKey` 🟠 ✅ RESOLVED

**Files:** `layer-01b-execution-engine.md` (`src/runtime.ts`), `FRAMEWORK_USAGE_GUIDE.md`

**Problem:** `createRuntime()` accepts only:

```typescript
export const createRuntime = (options: {
  agentId: string;
  anthropicApiKey: string;
  ...
}) => { ... }
```

But `FRAMEWORK_USAGE_GUIDE.md` shows builders using `withProvider('openai', ...)` and `withProvider('ollama', ...)`. The builder calls `createRuntime()` internally, but there's no way to pass OpenAI/Ollama credentials down.

**Fix:** Expand `createRuntime()` options:

```typescript
export const createRuntime = (options: {
  agentId: string;
  provider?: "anthropic" | "openai" | "ollama";
  apiKey?: string;           // replaces anthropicApiKey
  baseUrl?: string;          // for Ollama
  anthropicApiKey?: string;  // kept for backward compat
  openaiApiKey?: string;     // convenience alias
  ...
}) => { ... }
```

Update `builder.ts` to forward the resolved provider/key down to `createRuntime()`.

---

### D1 — `@reactive-agents/reasoning` Missing `llm-provider` Dependency 🔴 ✅ RESOLVED

**Files:** `03-layer-reasoning.md` (Package header, package.json)

**Problem:** The spec declares:

> **Dependencies:** `effect@^3.10`, `@reactive-agents/core`

But every strategy function imports and uses `LLMService` from `@reactive-agents/llm-provider`:

```typescript
import { LLMService } from "@reactive-agents/llm-provider";
```

This will fail with a module-not-found error.

**Fix:** Update the dependencies section in `03-layer-reasoning.md`:

> **Dependencies:** `effect@^3.10`, `@reactive-agents/core`, `@reactive-agents/llm-provider`

And add to package.json:

```json
{
  "dependencies": {
    "effect": "^3.10.0",
    "@reactive-agents/core": "workspace:*",
    "@reactive-agents/llm-provider": "workspace:*"
  }
}
```

---

### D2 — `@reactive-agents/tools` Depends on `@reactive-agents/identity` (Phase 3) But Is Built in Phase 1 🔴 ✅ RESOLVED

**Files:** `08-layer-tools.md` (Dependencies section), `START_HERE_AI_AGENTS.md` (build order step 4)

**Problem:** `08-layer-tools.md` declares:

> **Dependencies:** `@reactive-agents/core` (EventBus, types), `@reactive-agents/identity` (authorization for tool execution)

`@reactive-agents/identity` is built in Phase 3 (step 14), but `@reactive-agents/tools` is built in Phase 1 (step 4). This circular phase dependency means tools cannot import identity at build time.

**Fix:** Split the dependency:

- Phase 1: `tools` depends only on `@reactive-agents/core`. Authorization enforcement is stubbed/skipped (all tools `requiresApproval: false` by default).
- Phase 3 extension: After identity is built, add an optional `IdentityService` dependency to tools. Tool execution checks authorization only if `IdentityService` is provided.

Update `08-layer-tools.md`:

> **Dependencies:** `@reactive-agents/core` (EventBus, types)  
> **Optional (Phase 3):** `@reactive-agents/identity` (authorization for tool execution — enabled after Phase 3)

---

### D3 — `@reactive-agents/guardrails` Missing `llm-provider` in package.json 🟠 ✅ RESOLVED

**Files:** `11-missing-capabilities-enhancement.md` (guardrails Package Config)

**Problem:** The package.json for guardrails shows:

```json
{
  "dependencies": {
    "effect": "^3.10.0",
    "@reactive-agents/core": "workspace:*"
  }
}
```

But `src/detectors/content-filter.ts` is described as "LLM-based toxicity scoring" which calls `LLMService`. The `prompt-injection.ts` heuristic-only detector is fine without it, but content filtering requires LLM.

**Fix:** Update guardrails `package.json`:

```json
{
  "dependencies": {
    "effect": "^3.10.0",
    "@reactive-agents/core": "workspace:*",
    "@reactive-agents/llm-provider": "workspace:*"
  }
}
```

Mark `llm-provider` as an optional dependency in the `GuardrailService` implementation (use `Effect.serviceOption(LLMService)` for the LLM-based checks, fall back to heuristics-only if not provided).

---

### D4 — `@reactive-agents/verification` References Non-Existent `FactualMemory` 🔴 ✅ RESOLVED

**Files:** `04-layer-verification.md` (Dependencies section)

**Problem:**

> **Dependencies:** `@reactive-agents/core` (EventBus, types), `@reactive-agents/llm-provider` (LLMService), `@reactive-agents/memory` (FactualMemory for fact-checking)

There is no `FactualMemory` exported from `@reactive-agents/memory`. The memory package exports `SemanticMemoryService`, `EpisodicMemoryService`, `ProceduralMemoryService`, `WorkingMemoryService`, and the top-level `MemoryService`. This name is vestigial from an earlier design.

**Fix:** Update `04-layer-verification.md` dependencies to:

> `@reactive-agents/memory` (MemoryService — for fact lookup in semantic memory during fact-decomposition layer)

And update the `fact-decomposition.ts` layer to import `MemoryService` (or specifically `SemanticMemoryService`) for fact cross-referencing.

---

### G1 — `ReasoningService` Is Never Called from `ExecutionEngine` 🔴 ✅ RESOLVED

**Files:** `layer-01b-execution-engine.md` (Phase 4 + Phase 5), `03-layer-reasoning.md`

**Problem:** This is the most significant architectural gap. The execution engine does two things wrong:

1. **Phase 4 (STRATEGY_SELECT):** Hardcodes `selectedStrategy: "reactive"` instead of calling `StrategySelector.select()`:

   ```typescript
   ctx =
     yield *
     runPhase(
       ctx,
       "strategy-select",
       (c) => Effect.succeed({ ...c, selectedStrategy: "reactive" }), // ← hardcoded!
     );
   ```

2. **Phase 5 (AGENT_LOOP):** Implements its own minimal LLM loop directly instead of delegating to `ReasoningService.execute(strategy, input)`. The entire `@reactive-agents/reasoning` package — strategies, registry, selector, effectiveness tracker — is never invoked by the engine.

This means:

- Strategy selection (`StrategySelector`) is bypassed
- Strategy-specific behavior (`executeReactive`, `executePlanExecuteReflect`, etc.) is bypassed
- Effectiveness learning (`EffectivenessTracker`) never runs
- The reasoning package is effectively dead code in the Phase 1 build

**Fix:** Phase 4 should optionally call `StrategySelector`:

```typescript
// Phase 4: STRATEGY_SELECT
ctx =
  yield *
  runPhase(ctx, "strategy-select", (c) =>
    Effect.gen(function* () {
      const selectorOpt = yield* Effect.serviceOption(
        Context.GenericTag<{
          select: (ctx: unknown, mem: unknown) => Effect.Effect<string>;
        }>("StrategySelector"),
      );
      const strategy =
        selectorOpt._tag === "Some"
          ? yield* selectorOpt.value.select(
              selectionContextFrom(task),
              c.memoryContext,
            )
          : "reactive"; // default fallback
      return { ...c, selectedStrategy: strategy };
    }),
  );
```

Phase 5 should optionally call `ReasoningService`:

```typescript
// Phase 5: AGENT_LOOP — delegate to ReasoningService when available
ctx =
  yield *
  runPhase(ctx, "think", (c) =>
    Effect.gen(function* () {
      const reasoningOpt = yield* Effect.serviceOption(
        Context.GenericTag<{
          execute: (strategy: string, input: unknown) => Effect.Effect<unknown>;
        }>("ReasoningService"),
      );
      if (reasoningOpt._tag === "Some") {
        // Full path: use ReasoningService (requires @reactive-agents/reasoning)
        const result = yield* reasoningOpt.value.execute(
          c.selectedStrategy ?? "reactive",
          {
            taskDescription: JSON.stringify(task.input),
            taskType: task.type,
            memoryContext: String(
              (c.memoryContext as any)?.semanticContext ?? "",
            ),
            availableTools: [],
            config: defaultReasoningConfig,
          },
        );
        return {
          ...c,
          metadata: {
            ...c.metadata,
            reasoningResult: result,
            isComplete: true,
          },
        };
      } else {
        // Minimal path: direct LLM call (Phase 1 bootstrap, no reasoning package)
        // ... existing direct LLM logic
      }
    }),
  );
```

Add `ReasoningService` and `StrategySelector` as optional services in `createRuntime()`.

---

### G2 — No Monorepo Setup Spec 🔴 ✅ RESOLVED

**Files:** None (gap)

**Problem:** The specs reference a Bun workspaces monorepo but no spec defines:

- Root `package.json` (workspaces array, name, scripts)
- Root `tsconfig.json` (references, paths, module settings)
- Per-package `tsconfig.json` pattern
- `bun.workspaces` configuration
- How packages reference each other (`workspace:*`)
- Build scripts and test scripts

Without this, an AI agent starting the build has no template for the monorepo scaffolding.

**Fix:** Add a new spec file `spec/docs/00-monorepo-setup.md` (or a section to `START_HERE_AI_AGENTS.md`) with:

```bash
# Directory structure creation
mkdir -p packages/{core,llm-provider,memory,reasoning,verification,cost,identity,orchestration,tools,observability,interaction,runtime,guardrails,eval,prompts}
mkdir -p apps/cli
```

Root `package.json`:

```json
{
  "name": "reactive-agents",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "build": "bun run --filter '*' build",
    "test": "bun test",
    "typecheck": "bun run --filter '*' typecheck"
  },
  "devDependencies": {
    "typescript": "^5.7",
    "bun-types": "latest"
  }
}
```

Root `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "verbatimModuleSyntax": true,
    "noEmit": true
  }
}
```

Per-package `tsconfig.json` pattern:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "paths": {}
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

---

### G3 — `GuardrailService.killAgent()` Comments vs Implementation 🟠 ✅ RESOLVED

**Files:** `11-missing-capabilities-enhancement.md` (`src/services/guardrail-service.ts`)

**Problem:**

```typescript
killAgent: (agentId, reason) =>
  Effect.sync(() => {
    // Emit kill event via EventBus — caller is responsible for halting agent
    console.error(`[GUARDRAIL KILL] Agent ${agentId}: ${reason}`);
  }),
```

The comment promises EventBus emission but uses `console.error`. This means agent kill events are not observable, cannot be subscribed to, and leave no audit trail.

**Fix:** Add `EventBus` from `@reactive-agents/core` as a dependency in `GuardrailServiceLive`:

```typescript
export const GuardrailServiceLive = Layer.effect(
  GuardrailService,
  Effect.gen(function* () {
    const policyEngine = yield* PolicyEngine;
    const eventBus = yield* EventBus;  // ← add this
    ...
    killAgent: (agentId, reason) =>
      eventBus.publish({ _tag: "GuardrailKill", agentId, reason, timestamp: new Date() }),
  }),
);
```

Add `GuardrailKill` to the `AgentEvent` union in `@reactive-agents/core` (or use the EventBus's generic publish if it supports arbitrary events).

---

### G4 — `builder.ts` Missing from Runtime Build Order 🟠 ✅ RESOLVED

**Files:** `layer-01b-execution-engine.md` (Build Order), `FRAMEWORK_USAGE_GUIDE.md`

**Problem:** `layer-01b-execution-engine.md` has a 7-step build order ending at `src/index.ts`. But `FRAMEWORK_USAGE_GUIDE.md` defines `builder.ts` and says:

> "Add it to the Build Order between current steps 5 and 6 in `layer-01b-execution-engine.md`."

The spec was never updated. An AI agent following the spec's build order would miss building the primary user-facing API.

**Fix:** Update `layer-01b-execution-engine.md` Build Order to 8 steps:

1. `src/types.ts`
2. `src/errors.ts`
3. `src/hooks.ts`
4. `src/execution-engine.ts`
5. `src/runtime.ts`
6. **`src/builder.ts` — ReactiveAgentBuilder + ReactiveAgent + ReactiveAgents namespace (see `FRAMEWORK_USAGE_GUIDE.md` §2 for full implementation spec)**
7. `src/index.ts`
8. Tests

---

### G5 — "6 Anthropic Workflow Patterns" But Only 5 in Schema 🟡 ✅ RESOLVED

**Files:** `07-layer-orchestration.md` (`WorkflowPattern` schema), `00-master-architecture.md`, `DOCUMENT_INDEX.md`

**Problem:** Three docs claim "6 Anthropic workflow patterns" but `WorkflowPattern` only defines 5:

```typescript
export const WorkflowPattern = Schema.Literal(
  "sequential",
  "parallel",
  "orchestrator-workers",
  "map-reduce",
  "pipeline",
  // ← missing 6th pattern
);
```

The common Anthropic patterns for multi-agent systems are: sequential, parallel, orchestrator-workers, map-reduce, pipeline, and **evaluator-optimizer**.

**Fix:** Add the missing pattern to `07-layer-orchestration.md`:

```typescript
export const WorkflowPattern = Schema.Literal(
  "sequential",
  "parallel",
  "orchestrator-workers",
  "map-reduce",
  "pipeline",
  "evaluator-optimizer", // ← add this
);
```

Update `workflow-patterns.ts` to implement the evaluator-optimizer pattern.

---

### G6 — Most Layer Specs Missing `package.json` Section 🟠 ✅ RESOLVED

**Files:** `03-layer-reasoning.md`, `04-layer-verification.md`, `05-layer-cost.md`, `06-layer-identity.md`, `07-layer-orchestration.md`, `09-layer-observability.md`, `layer-10-interaction-revolutionary-design.md`

**Problem:** Only `@reactive-agents/core`, `@reactive-agents/guardrails`, and `@reactive-agents/memory` include explicit `package.json` templates. All other specs are missing them.

Without explicit package.json, an AI agent must infer dependencies — risking missing transitive deps, wrong version ranges, or wrong `"type": "module"` settings.

**Fix:** Add package.json to each missing spec. Reference table:

| Package                          | Key Deps                                                          |
| -------------------------------- | ----------------------------------------------------------------- |
| `@reactive-agents/reasoning`     | `effect`, `core`, `llm-provider`, `ulid`                          |
| `@reactive-agents/verification`  | `effect`, `core`, `llm-provider`, `memory`                        |
| `@reactive-agents/cost`          | `effect`, `core`, `llm-provider`, `memory`                        |
| `@reactive-agents/identity`      | `effect`, `core`, `@noble/ed25519` (for Ed25519)                  |
| `@reactive-agents/orchestration` | `effect`, `core`, `llm-provider`, `identity`, `reasoning`, `cost` |
| `@reactive-agents/observability` | `effect`, `core`, `@opentelemetry/api`, `@opentelemetry/sdk-node` |
| `@reactive-agents/interaction`   | `effect`, `core`, `reasoning`, `observability`                    |

Each should include:

```json
{
  "name": "@reactive-agents/PACKAGE",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "dependencies": { ... }
}
```

---

### G7 — `createRuntime()` Hard-Coded to Anthropic Only 🟠 ✅ RESOLVED

_(See also A4)_

`createRuntime()` in `layer-01b-execution-engine.md` accepts `anthropicApiKey: string` as the sole provider credential, but the framework supports Anthropic, OpenAI, and Ollama. The builder's `withProvider()` method doesn't wire down to `createRuntime()`.

See fix in A4 above.

---

### G8 — `ReactiveAgentsConfig.agentId` Makes Runtime Single-Agent; Undocumented 🟠 ✅ RESOLVED

**Files:** `layer-01b-execution-engine.md` (types.ts), `FRAMEWORK_USAGE_GUIDE.md`

**Problem:** `ReactiveAgentsConfig` includes `agentId: Schema.String`. The `createRuntime()` function takes `{ agentId, ... }`. This means the entire runtime (memory layer, execution engine) is initialized for one specific agent.

But the public API examples show:

```typescript
const agent1 = await ReactiveAgents.create().withName("researcher").build();
const agent2 = await ReactiveAgents.create().withName("writer").build();
```

This implies each `build()` call creates a separate runtime. This is valid but:

- It means N agents = N SQLite databases = N everything
- Cross-agent communication via the EventBus is not possible (different layer graphs)
- There's no shared memory/cost tracking across agents

This is a design decision that is completely undocumented.

**Fix:** Add a section to `FRAMEWORK_USAGE_GUIDE.md` documenting the one-runtime-per-agent model, its tradeoffs, and the recommended multi-agent pattern using `@reactive-agents/orchestration` for cross-agent coordination (which has its own shared state layer).

Alternatively, consider removing `agentId` from `ReactiveAgentsConfig` and passing it per-execution in `execute(task)` — since `task.agentId` already carries it.

---

### G9 — `StreamingService` Extension Scope Not Defined 🟡 ✅ RESOLVED

**Files:** `11-missing-capabilities-enhancement.md` (Extension 6)

**Problem:** Extension 6 says "StreamingService → add to `@reactive-agents/core`" but:

- `@reactive-agents/llm-provider` already provides `LLMService.stream()` which returns `Effect.Stream<StreamEvent>`
- It's unclear what a separate `StreamingService` in core would add

**Fix:** Either:

1. Remove Extension 6 entirely if `LLMService.stream()` is sufficient
2. Define a clear scope: "StreamingService manages SSE/WebSocket connections to stream agent outputs to end users (UI layer), built on top of `LLMService.stream()` from llm-provider"

---

### M1 — EventBus Contract References `Fact` Type (Removed) 🟡 ✅ RESOLVED

**Files:** `00-master-architecture.md` (Event Bus Contract section)

**Problem:**

```typescript
type SystemEvent = { type: "memory.stored"; fact: Fact }; // ← 'Fact' type was removed
```

`Fact` was a type from an earlier architecture (replaced by `MemoryEntry` when the memory system was redesigned).

**Fix:** Update to:

```typescript
| { type: "memory.stored"; entry: MemoryEntry }
```

---

### M2 — `importanceThreshold` Default: 0.6 vs 0.7 🟡 ✅ RESOLVED

**Files:** `02-layer-memory.md` (`defaultMemoryConfig`), `00-master-architecture.md` (Configuration table)

**Problem:**

- `defaultMemoryConfig` in `02-layer-memory.md`: `importanceThreshold: 0.6`
- `00-master-architecture.md` config table: "Semantic memory importance: 0.7 threshold"

**Fix:** Pick one value and align both files. Recommend `0.7` (higher quality threshold); update `defaultMemoryConfig` in `02-layer-memory.md`.

---

### M3 — Model Names Inconsistent Across Examples 🟡 ✅ RESOLVED

**Files:** `FRAMEWORK_USAGE_GUIDE.md` (examples), `01.5-layer-llm-provider.md` (ModelPresets), `CLAUDE.md`

**Problem:** Examples use `claude-sonnet-4-5-20250929` but `ModelPresets` defines `claude-sonnet-4-20250514`. These aren't the same model. The usage guide uses model names not in the presets dictionary.

**Fix:** Either:

1. Add the `claude-sonnet-4-5-20250929` model to `ModelPresets` in `01.5-layer-llm-provider.md`
2. Or update all examples to use the canonical preset name `"claude-sonnet"` (which maps to `claude-sonnet-4-20250514`)

Also update `CLAUDE.md` `LLM_DEFAULT_MODEL=claude-sonnet-4-20250514` to be consistent.

---

### M4 — `LogLevel` Defined in Both Core and Observability 🟡 ✅ RESOLVED

**Files:** `layer-01-core-detailed-design.md` (`src/types/config.ts`), `09-layer-observability.md` (`src/types.ts`)

**Problem:** Both packages define a `LogLevel` Schema.Literal. If a consumer imports from both packages and TypeScript uses structural typing, this works fine — but if a consumer tries to pass a core `LogLevel` to an observability function, they get confusing type errors.

**Fix:** Have observability import `LogLevel` from `@reactive-agents/core` instead of redefining it, since observability already depends on core.

---

## Priority Fix Order

Address in this sequence for a clean build path:

### Must fix before starting build (Blockers):

1. ✅ **G2** — Create monorepo setup spec first → created `00-monorepo-setup.md`
2. ✅ **C3** — Align `"plan-execute-reflect"` everywhere
3. ✅ **D1** — Add `llm-provider` to reasoning dependencies
4. ✅ **D2** — Make identity optional in tools for Phase 1
5. ✅ **A1** — Fix `llm.complete({ prompt })` → `llm.complete({ messages })`
6. ✅ **A2** — Fix `thoughtResponse.text` → `thoughtResponse.content`, `.estimatedCost`
7. ✅ **A3** — Fix `LifecycleHook.handler` error type from `never` → `ExecutionError`
8. ✅ **D4** — Fix `FactualMemory` → `MemoryService` / `SemanticMemoryService`
9. ✅ **G1** — Wire `ReasoningService` into `ExecutionEngine` via `Effect.serviceOption` dual-path
10. ✅ **G4** — Verified `builder.ts` already present as build step 6 in runtime spec

### Fix before Phase 2 build:

11. ✅ **C1** — Annotated ContextWindowManager in enhancement extensions as already in core
12. ✅ **C2** — Canonicalized `ReasoningStrategy` import from core in reasoning spec
13. ✅ **D3** — Added `llm-provider` to guardrails dependencies
14. ✅ **A4 / G7** — Expanded `createRuntime()` with `provider`/`apiKey`/`baseUrl` + backward compat
15. ✅ **G6** — Added package.json to verification, cost, identity, orchestration, observability specs

### Cleanup / consistency:

16. ✅ **C4** — Fix DOCUMENT_INDEX step count
17. ✅ **C5** — Align interaction package phase across docs
18. ✅ **G3** — Wire EventBus into `killAgent()`
19. ✅ **G5** — Add 6th workflow pattern
20. ✅ **G8** — Document one-runtime-per-agent constraint
21. ✅ **G9** — Clarify or remove StreamingService extension
22. ✅ **M1** — Fix `fact: Fact` in EventBus contract
23. ✅ **M2** — Align importance threshold default
24. ✅ **M3** — Align model names
25. ✅ **M4** — Import `LogLevel` in observability from core

### Vision gaps (original pillars missing from current specs):

26. ✅ **V1** — `withReasoningController()` / `withContextController()` added to builder + types in core/reasoning
27. ✅ **V2** — AgentPlugin interface + `withPlugin()` added to builder
28. ✅ **V3** — `agent.metrics()` real-time stream added to `ReactiveAgent` API
29. ✅ **V4** — `onUncertainty()` / `onDecision()` added as instance methods on `ReactiveAgent`
30. ✅ **V5** — DebugSession type + `debugger()` method added to ReactiveAgent. Competitive analysis correctly attributes time-travel to LangGraph, not RA — no correction needed.
31. ✅ **V6** — `withCircuitBreaker()` builder method + CircuitBreakerConfig type added
32. ✅ **V7** — DegradationPolicy + DegradationLevel types added to cost spec
33. ✅ **V8** — `withTokenBudget()` builder method + TokenBudgetConfig type added
34. ✅ **V9** — SecretManagerService + SecretManagerEnvLive added to identity spec
35. ✅ **V10** — ReactiveAgent expanded: getTrace, metrics, debugger, onDecision, onUncertainty + all supporting types

---

## Vision Gap Findings

_Added: February 19, 2026. Source: Cross-reference of `00-VISION.md`, `02-CORE-PILLARS.md`, `09-ROADMAP.md` against all current spec files._

The eight pillars of the original vision are **Control, Observability, Flexibility, Reliability, Efficiency, Scalability, Security, Speed**. The items below represent original pillar promises that have unique value and fit the current architecture, but lack spec coverage.

---

### V1 — `withReasoningController()` / `withContextController()` Absent from Builder 🟠 ✅ RESOLVED

**Files:** `FRAMEWORK_USAGE_GUIDE.md` (builder), `03-layer-reasoning.md`, `layer-01-core-detailed-design.md`

**Problem:** The "Control" pillar's primary API surface was `ReactiveAgentBuilder.withReasoningController()` and `.withContextController()`. These appear in the older design docs (`04-API-DESIGN.md`, `03-WHAT-IT-UNLOCKS.md`) but are **completely absent** from the current `FRAMEWORK_USAGE_GUIDE.md` `ReactiveAgentBuilder` implementation spec. The builder's `private` fields contain no `_reasoningController` or `_contextController`. The framework's core differentiating promise — "you can control every reasoning step" — has no public API expression.

`ContextWindowManager` exists in `@reactive-agents/core` but cannot be configured by users; its prioritization, pruning strategy, and retention list are hardcoded defaults. `LifecycleHooks` operate at the coarse 10-phase `ExecutionEngine` level, not inside the per-step reasoning loop.

**Fix:** Add `withReasoningController()` and `withContextController()` to the `ReactiveAgentBuilder` spec in `FRAMEWORK_USAGE_GUIDE.md`:

```typescript
// In ReactiveAgentBuilder (FRAMEWORK_USAGE_GUIDE.md §2):
private _reasoningController?: ReasoningController;
private _contextController?: ContextController;

withReasoningController(controller: ReasoningController): this {
  this._reasoningController = controller;
  return this;
}
withContextController(controller: ContextController): this {
  this._contextController = controller;
  return this;
}
```

Define `ReasoningController` and `ContextController` types in `@reactive-agents/reasoning` and `@reactive-agents/core` respectively:

```typescript
// In @reactive-agents/reasoning/src/types/reasoning.ts
export interface ReasoningController {
  readonly beforeReasoning?: (
    context: ReasoningInput,
  ) => Effect.Effect<ReasoningInput, ReasoningError>;
  readonly duringStep?: (
    step: ReasoningStep,
  ) => Effect.Effect<ReasoningStep, ReasoningError>;
  readonly afterStep?: (
    step: ReasoningStep,
  ) => Effect.Effect<ReasoningStep, ReasoningError>;
  readonly onUncertainty?: (
    signal: UncertaintySignal,
  ) => Effect.Effect<"continue" | "abort" | "escalate", never>;
  readonly onAdapt?: (
    context: ReasoningInput,
  ) => Effect.Effect<ReasoningStrategy, never>;
}

// In @reactive-agents/core/src/types/context.ts
export interface ContextController {
  readonly prioritization?: "semantic" | "recency" | "importance";
  readonly pruning?: "adaptive" | "sliding-window" | "fifo";
  readonly retention?: readonly string[]; // message types to always retain
  readonly compression?: "none" | "aggressive" | "adaptive";
}
```

Wire `ReasoningController` into each strategy function in `03-layer-reasoning.md` so hooks fire at appropriate points within the loop. Wire `ContextController` into `ContextWindowManager` in `layer-01-core-detailed-design.md`.

---

### V2 — Middleware / Plugin System Not Specced 🟡 ✅ RESOLVED

**Files:** None (gap). Referenced in `reactive-agents-complete-competitive-analysis-2026.md` (line 484) and `12-market-validation-feb-2026.md` as claimed features.

**Problem:** Both the original vision docs and the competitive analysis claim "Plugin architecture" as a ✅ feature. No spec file defines:

- A middleware pipeline (`.use(fn)` on builder or agent)
- A plugin lifecycle (`Plugin` interface: `onInit`, `onAgentCreated`, etc.)
- Plugin registration / discovery

The current extension mechanism is `withLayers(extraLayers)` — a raw Effect Layer escape hatch. This is powerful but requires consumers to understand Effect-TS internals; it is not a documented extension API.

**Note:** Do NOT implement a full plugin system in Phase 1. However, the competitive analysis is currently claiming this as a working feature. Either:

**Option A (Preferred):** Add a lightweight `withMiddleware()` / plugin wrapper around `withLayers()` that accepts a simpler callback interface, defined in `FRAMEWORK_USAGE_GUIDE.md`:

```typescript
export interface AgentPlugin {
  readonly name: string;
  readonly layer: Layer.Layer<unknown, unknown>;
}

// Builder method:
withPlugin(plugin: AgentPlugin): this {
  return this.withLayers(plugin.layer);
}
```

**Option B:** Update the competitive analysis to mark plugin architecture as "planned" rather than ✅ available.

---

### V3 — `agent.metrics()` Real-Time Stream Missing from `ReactiveAgent` API 🟠 ✅ RESOLVED

**Files:** `FRAMEWORK_USAGE_GUIDE.md` (ReactiveAgent class), `09-layer-observability.md`

**Problem:** The "Observability" pillar specifies a first-class `agent.metrics()` method returning a real-time async stream:

```typescript
const metricsStream = agent.metrics();
for await (const metric of metricsStream) {
  console.log({
    reasoning_duration: metric.reasoningTime,
    cost: metric.estimatedCost,
  });
}
```

The observability spec (`09-layer-observability.md`) has excellent OTEL tracing and `AgentStateSnapshot`, but the `ReactiveAgent` class in `FRAMEWORK_USAGE_GUIDE.md` exposes no observable metrics surface. Users have no way to stream live cost, latency, or token metrics from a running agent without instrumenting it externally.

**Fix:** Add a `metrics()` method to `ReactiveAgent` in `FRAMEWORK_USAGE_GUIDE.md`:

```typescript
export class ReactiveAgent {
  // ... existing methods

  /**
   * Stream real-time metrics from this agent.
   * Requires @reactive-agents/observability layer to be active.
   * Returns an Effect.Stream; convert to AsyncIterable with Stream.toAsyncIterable().
   */
  metrics(): Effect.Stream.Stream<AgentMetricEvent, never>;
}

export interface AgentMetricEvent {
  readonly timestamp: Date;
  readonly phase: string;
  readonly reasoningTimeMs?: number;
  readonly toolCallCount?: number;
  readonly tokensUsed?: number;
  readonly estimatedCost?: number;
  readonly qualityScore?: number;
}
```

Implement by subscribing to the `EventBus` in `@reactive-agents/core` and filtering for metric events emitted by the `ExecutionEngine` during its 10 phases. This requires adding metric event emissions in `execution-engine.ts` at phase boundaries.

---

### V4 — `onUncertainty()` / `onDecision()` Not Instance Methods on `ReactiveAgent` 🟡 ✅ RESOLVED

**Files:** `FRAMEWORK_USAGE_GUIDE.md` (ReactiveAgent class), `layer-10-interaction-revolutionary-design.md`

**Problem:** The vision documents describe runtime decision interception as first-class DX:

```typescript
agent.onDecision((decision, context) => {
  if (decision.importance > 0.9) return requestHumanApproval(decision);
  return decision;
});
agent.onUncertainty(async (signal) => {
  if (signal.confidence < 0.5) return await requestHumanInput(signal);
  return "continue";
});
```

Currently, uncertainty escalation is only a static config option in `InteractionModeConfig` (`escalateOnUncertainty: { threshold, targetMode }`). There is no dynamic callback API on the `ReactiveAgent` instance.

This matters for HITL workflows where the callback logic needs access to runtime context (e.g., current UI session, WebSocket connection) that can't be serialized into a static config at build time.

**Fix:** Add `onUncertainty()` and `onDecision()` as dynamic hook registration methods on `ReactiveAgent`:

```typescript
export class ReactiveAgent {
  /**
   * Register a callback invoked when the agent reaches an uncertainty signal.
   * Return 'continue' to proceed, 'abort' to stop, or a modified Decision.
   */
  onUncertainty(
    handler: (
      signal: UncertaintySignal,
    ) => Promise<"continue" | "abort"> | "continue" | "abort",
  ): void;

  /**
   * Register a callback invoked before any high-importance decision is executed.
   * Return the original or a modified Decision.
   */
  onDecision(
    handler: (
      decision: AgentDecision,
      ctx: ExecutionContext,
    ) => Promise<AgentDecision> | AgentDecision,
  ): void;
}
```

Wire these into the `LifecycleHookRegistry` as dynamic hooks registered after build time. Define `UncertaintySignal` and `AgentDecision` types in `@reactive-agents/core`.

---

### V5 — Time-Travel Debugging Claimed in Competitive Analysis But Unspecced 🟡 ✅ RESOLVED

**Files:** `reactive-agents-complete-competitive-analysis-2026.md` (line 222), `09-layer-observability.md`

**Problem:** The competitive analysis marks "Time-travel debugging (rollback to any state)" as a ✅ feature of Reactive Agents. However:

- `09-layer-observability.md` defines `AgentStateSnapshot` and `getSnapshots()` — snapshots exist
- No spec defines _replay_, _rewind_, or _modification_ of a past snapshot
- The `ReactiveAgent` class has no `.debugger()` method

The "time-travel" claim is therefore inaccurate. The current state is "snapshot capture" only.

**Fix (two options):**

**Option A (Spec the feature):** Add a `DebugSession` type and `ReactiveAgent.debugger()` method to `FRAMEWORK_USAGE_GUIDE.md` and build it in `09-layer-observability.md`:

```typescript
// Requires @reactive-agents/observability layer
export interface DebugSession {
  readonly rewindTo: (snapshotIndex: number) => Effect.Effect<AgentStateSnapshot, ObservabilityError>;
  readonly replay: (options?: { fromIndex?: number }) => Effect.Effect<TaskResult, ExecutionError>;
}

// On ReactiveAgent:
debugger(): Effect.Effect<DebugSession, ObservabilityError>;
```

**Option B (Correct the claim):** Update `reactive-agents-complete-competitive-analysis-2026.md` line 222 from `✅ Time-travel debugging (rollback to any state)` to `🔄 Snapshot-based debugging (rollback planned — Phase 3)`.

Option B is lower risk for the Phase 1-2 build. Option A should only be implemented if the observability spec is extended.

---

### V6 — `withCircuitBreaker()` Builder Method Absent 🟡 ✅ RESOLVED

**Files:** `FRAMEWORK_USAGE_GUIDE.md` (builder), `01.5-layer-llm-provider.md` (`src/retry.ts`)

**Problem:** `@reactive-agents/llm-provider` has a circuit breaker specifically for LLM API calls (preventing cascading failures to Anthropic/OpenAI). But there is no agent-level circuit breaker in the builder: a mechanism to stop agent execution and return a controlled error after N consecutive task failures or after timeout thresholds.

The "Reliability" pillar promises:

```typescript
AgentBuilder().withCircuitBreaker({
  errorThreshold: 0.5,
  timeout: 10000,
  resetTimeout: 60000,
});
```

**Fix:** Add `withCircuitBreaker()` to `ReactiveAgentBuilder` in `FRAMEWORK_USAGE_GUIDE.md`:

```typescript
private _circuitBreaker?: CircuitBreakerConfig;

withCircuitBreaker(config: CircuitBreakerConfig): this {
  this._circuitBreaker = config;
  return this;
}
```

Define `CircuitBreakerConfig` in `@reactive-agents/core/src/types/config.ts`:

```typescript
export const CircuitBreakerConfigSchema = Schema.Struct({
  errorThreshold: Schema.Number, // 0.0–1.0: error rate to open circuit
  timeout: Schema.Number, // ms: max execution time before trip
  resetTimeout: Schema.Number, // ms: time before attempting reset
});
export type CircuitBreakerConfig = typeof CircuitBreakerConfigSchema.Type;
```

Implement in `ExecutionEngine` as a wrapper around the execution loop that counts failures and short-circuits when the threshold is reached. This re-uses the existing `CircuitBreakerState` logic from `01.5-layer-llm-provider.md` but at the task-execution level.

---

### V7 — Graceful Degradation Levels Not Specced 🟡 ✅ RESOLVED

**Files:** None (gap). Mentioned in `02-CORE-PILLARS.md` Reliability section.

**Problem:** The "Reliability" pillar defines a degradation framework:

```typescript
agent.withDegradation({
  levels: [
    { trigger: "high_load", actions: ["reduce_context"] },
    { trigger: "critical", actions: ["use_cache_only"] },
  ],
});
```

No spec defines this. The memory spec has a single Tier 2 → Tier 1 fallback, but there is no general framework for agents to degrade gracefully under load (reduce context window, skip verification, use cached results).

This is a production-readiness gap: deployed agents under heavy load currently have no spec-defined fallback behavior other than erroring out.

**Fix:** This is lower priority than the blockers but fits naturally into `@reactive-agents/cost` (Phase 2). Add a `DegradationPolicy` type to `05-layer-cost.md` and wire it into `CostRouter`:

```typescript
// In @reactive-agents/cost/src/types.ts
export const DegradationLevel = Schema.Literal(
  "normal",
  "reduced",
  "minimal",
  "cache-only",
);
export type DegradationLevel = typeof DegradationLevel.Type;

export const DegradationPolicySchema = Schema.Struct({
  triggers: Schema.Array(
    Schema.Struct({
      condition: Schema.Literal("high_cost", "high_latency", "high_error_rate"),
      threshold: Schema.Number,
      level: DegradationLevel,
    }),
  ),
});
```

The `ExecutionEngine` should query `CostRouter` for the current degradation level before Phase 3 (cost routing) and adjust subsequent phases accordingly.

---

### V8 — `withTokenBudget()` Builder Method Not in Spec 🟠 ✅ RESOLVED

**Files:** `FRAMEWORK_USAGE_GUIDE.md` (builder), `05-layer-cost.md`

**Problem:** The "Efficiency" pillar features a `withTokenBudget()` builder method as a primary API for controlling per-invocation spend:

```typescript
agent.withTokenBudget({
  total: 10000,
  allocation: { system: 0.1, context: 0.4, reasoning: 0.2, output: 0.3 },
  enforcement: "hard",
});
```

`@reactive-agents/cost` (Phase 2) defines cost tracking and model routing, but NOT a per-request token budget with allocation splits and hard/soft enforcement. The builder has no `withTokenBudget()` method. This means there is currently no spec-defined way for users to set a hard token ceiling on a task.

**Fix:** Add `withTokenBudget()` to `ReactiveAgentBuilder` in `FRAMEWORK_USAGE_GUIDE.md`:

```typescript
private _tokenBudget?: TokenBudgetConfig;

withTokenBudget(config: TokenBudgetConfig): this {
  this._tokenBudget = config;
  return this;
}
```

Define `TokenBudgetConfig` in `@reactive-agents/core/src/types/config.ts`:

```typescript
export const TokenBudgetConfigSchema = Schema.Struct({
  total: Schema.Number,
  allocation: Schema.optional(
    Schema.Struct({
      system: Schema.optional(Schema.Number),
      context: Schema.optional(Schema.Number),
      reasoning: Schema.optional(Schema.Number),
      output: Schema.optional(Schema.Number),
    }),
  ),
  enforcement: Schema.Literal("hard", "soft"), // hard = abort; soft = warn
});
```

Implement in `ExecutionEngine`: after Phase 8 (COST_TRACK), check cumulative tokens against budget. On `hard` enforcement, abort with a `BudgetExceededError`. On `soft`, emit a warning event and continue. Also thread the `allocation` config down to `ContextWindowManager` so it can pre-allocate context space.

---

### V9 — Secret Management Absent from `@reactive-agents/identity` 🟡 ✅ RESOLVED

**Files:** `06-layer-identity.md`

**Problem:** The "Security" pillar lists secret management as a core security feature:

> `withSecrets({ provider: 'vault', path: '/secrets/agents', rotation: '90d', encryption: 'aes-256' })`

`@reactive-agents/identity` (`06-layer-identity.md`) is built entirely around **authentication** (Ed25519 X.509 certificates), **authorization** (RBAC), and **audit logging**. Secret management (fetching/rotating/encrypting application secrets such as API keys during runtime) is architecturally distinct from identity and is not covered anywhere in the specs.

This is not a Phase 1 blocker, but the security story is materially weaker without it.

**Fix:** Add a `SecretManager` service to `06-layer-identity.md` as an optional extension (can be phased in alongside the main identity build):

```typescript
export class SecretManagerService extends Context.Tag("SecretManagerService")<
  SecretManagerService,
  {
    readonly get: (key: string) => Effect.Effect<string, IdentityError>;
    readonly rotate: (key: string) => Effect.Effect<void, IdentityError>;
    readonly list: () => Effect.Effect<readonly string[], IdentityError>;
  }
>() {}
```

Provide a `SecretManagerLive` backed by environment variables (Phase 3 default) with a documented extension point for Vault/AWS Secrets Manager integration. Add `withSecrets()` to the builder in `FRAMEWORK_USAGE_GUIDE.md`:

```typescript
withSecrets(config: SecretsConfig): this { ... }
```

---

### V10 — `ReactiveAgent` Instance Method Surface Incomplete 🟠 ✅ RESOLVED

**Files:** `FRAMEWORK_USAGE_GUIDE.md` (ReactiveAgent class definition)

**Problem:** The `ReactiveAgent` class returned by `.build()` is defined in `FRAMEWORK_USAGE_GUIDE.md` but its full method surface is not specified. The original vision describes several methods that are absent:

| Method                    | Source                | Status in Spec      |
| ------------------------- | --------------------- | ------------------- |
| `agent.run(task)`         | FRAMEWORK_USAGE_GUIDE | ✅ Specified        |
| `agent.stop()`            | Various               | ✅ Specified        |
| `agent.getTrace(taskId)`  | `00-VISION.md`        | ❌ Missing          |
| `agent.debugger()`        | `02-CORE-PILLARS.md`  | ❌ Missing (see V5) |
| `agent.metrics()`         | `02-CORE-PILLARS.md`  | ❌ Missing (see V3) |
| `agent.onDecision(cb)`    | `02-CORE-PILLARS.md`  | ❌ Missing (see V4) |
| `agent.onUncertainty(cb)` | `02-CORE-PILLARS.md`  | ❌ Missing (see V4) |

`agent.getTrace(taskId)` is particularly important: it gives users a structured execution trace after a task run — the "why did it do that?" answer. The observability spec has `ObservabilityService.getTrace()` but this isn't surfaced on the `ReactiveAgent` object, requiring users to wire up the observability layer manually.

**Fix:** Add the full method surface to the `ReactiveAgent` class spec in `FRAMEWORK_USAGE_GUIDE.md`:

```typescript
export class ReactiveAgent {
  readonly id: string;
  readonly name: string;

  // ─── Core ────────────────────────────────────────────────────────────────
  run(input: string | TaskInput): Promise<AgentResult>;
  runEffect(
    input: string | TaskInput,
  ): Effect.Effect<AgentResult, ExecutionError>;
  stop(): Promise<void>;

  // ─── Observability ────────────────────────────────────────────────────────
  /** Get structured execution trace. Requires @reactive-agents/observability. */
  getTrace(taskId: string): Promise<ExecutionTrace | null>;

  /** Stream live metrics. Requires @reactive-agents/observability. */
  metrics(): AsyncIterable<AgentMetricEvent>;

  /** Create a debug session from captured snapshots. */
  debugger(): Promise<DebugSession>;

  // ─── Runtime Control ──────────────────────────────────────────────────────
  /** Register a decision intercept handler. */
  onDecision(handler: DecisionHandler): void;

  /** Register an uncertainty escalation handler. */
  onUncertainty(handler: UncertaintyHandler): void;
}
```

Methods that require optional packages (`getTrace`, `metrics`, `debugger`) return `null` / empty stream gracefully when the required layer is not active.
