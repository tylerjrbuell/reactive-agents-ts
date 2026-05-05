# V1.0 Harness Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the ReAct kernel from text-based ACTION: parsing to native function calling, eliminate 5 proven inefficiencies, and clean up ~700 LOC of parsing/repair heuristics — making agents faster, cheaper, and more reliable across all providers.

**Architecture:** Native function calling becomes the primary tool invocation path. A ToolCallResolver in the tools package bridges LLM responses to structured tool calls via two strategies: NativeFCStrategy (reads response.toolCalls) and StructuredOutputStrategy (JSON schema fallback). The kernel becomes a pure orchestrator — no text parsing, no JSON repair, no scratchpad storage keys.

**Tech Stack:** Effect-TS services, bun:test, TypeScript (strict), existing LLM provider SDK integrations (Anthropic, OpenAI, Gemini, Ollama)

**Spec:** `docs/superpowers/specs/2026-03-26-v1-harness-optimization-design.md`

---

## File Map

### Phase 1 (Surgical Fixes — modify only)
| File | Change |
|------|--------|
| `packages/runtime/src/execution-engine.ts` | Memory-flush guard (1.1) |
| `packages/reasoning/src/strategies/shared/react-kernel.ts` | Fast-path early exit (1.2), observation auto-forward (1.5) |
| `packages/reasoning/src/strategies/shared/tool-execution.ts` | Remove scratchpad-read compat (1.3) |
| `packages/reasoning/src/strategies/shared/kernel-runner.ts` | Remove scratchpad from UTILITY_TOOLS (1.3) |
| `packages/reasoning/src/context/context-engine.ts` | Remove scratchpad-read references (1.3) |
| `packages/reasoning/src/types/observation.ts` | Remove scratchpad mapping (1.3) |
| `packages/runtime/src/execution-engine.ts:825` | Remove scratchpad from filter set (1.3) |
| `packages/tools/src/skills/brief.ts` | Add iteration-aware grading (1.4) |
| `packages/reactive-intelligence/src/sensor/composite.ts` | Short-run bypass (1.4) |
| `test.ts:207-215` | Update scratchpad test to recall (1.3) |

### Phase 2 (Native FC — new files + major modifications)
| File | Change |
|------|--------|
| **NEW** `packages/llm-provider/src/capabilities.ts` | ProviderCapabilities interface (2.1) |
| `packages/llm-provider/src/llm-service.ts` | Add capabilities() method (2.1) |
| `packages/llm-provider/src/providers/anthropic.ts` | Capabilities + stream() tools fix (2.1, 2.2) |
| `packages/llm-provider/src/providers/openai.ts` | Capabilities declaration (2.1) |
| `packages/llm-provider/src/providers/gemini.ts` | Capabilities declaration (2.1) |
| `packages/llm-provider/src/providers/local.ts` | Capabilities declaration (2.1) |
| `packages/llm-provider/src/providers/litellm.ts` | Capabilities declaration (2.1) |
| `packages/llm-provider/src/testing.ts` | Capabilities declaration (2.1) |
| **NEW** `packages/tools/src/tool-calling/types.ts` | ToolCallResult, ToolCallSpec, ToolCallResolver types (2.3) |
| **NEW** `packages/tools/src/tool-calling/resolver.ts` | ToolCallResolver factory (2.3) |
| **NEW** `packages/tools/src/tool-calling/native-fc-strategy.ts` | NativeFCStrategy (2.3) |
| **NEW** `packages/tools/src/tool-calling/structured-strategy.ts` | StructuredOutputStrategy (2.3) |
| **NEW** `packages/tools/src/tool-calling/tool-call-schema.ts` | Schema generation from ToolDefinition[] (2.3) |
| `packages/reasoning/src/strategies/shared/react-kernel.ts` | Kernel rewrite — FC loop (2.4) |
| `packages/reasoning/src/strategies/shared/kernel-state.ts` | KernelMessage type, toolCall metadata on steps (2.5) |
| `packages/reasoning/src/strategies/shared/tool-execution.ts` | Simplify to FC dispatch (2.4, 2.6) |
| `packages/reasoning/src/context/compaction.ts` | Handle structured metadata (2.7) |
| `packages/reactive-intelligence/src/sensor/behavioral-entropy.ts` | Read metadata.toolCall.name (2.5) |
| `packages/tools/src/skills/completion-gaps.ts` | Use metadata instead of text (2.9) |
| `packages/runtime/assets/harness.skill.md` | Remove ACTION: instructions (2.12) |
| `packages/runtime/assets/harness.skill.condensed.md` | Remove ACTION: instructions (2.12) |

---

## Phase 1: Surgical Fixes

Each task is independent. Ship in any order. Run `bun test` after each to confirm no regressions.

---

### Task 1: Conditional Memory-Flush Guard

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts:2257-2370`
- Test: `packages/runtime/tests/execution-engine.test.ts`

- [ ] **Step 1: Locate the memory-flush phase**

Open `packages/runtime/src/execution-engine.ts`. Find line ~2257 where `guardedPhase(ctx, "memory-flush", ...)` starts. The phase calls `MemoryService.snapshot()`, `MemoryService.flush()`, `MemoryConsolidator.decayUnused()`, and optionally `MemoryExtractor.extractFromConversation()`.

- [ ] **Step 2: Write the failing test**

In `packages/runtime/tests/execution-engine.test.ts`, add a test that verifies the memory-flush phase is skipped when no MemoryService is available:

```typescript
it("skips memory-flush when no MemoryService is in context", async () => {
  // Build agent WITHOUT .withMemory()
  const agent = await ReactiveAgents.create()
    .withProvider("test")
    .withTestScenario([{ text: "Paris" }])
    .withReasoning()
    .build();
  const result = await agent.run("What is the capital of France?");
  // Check that memory-flush phase took ~0ms
  const memFlushSpan = result.metadata?.spans?.find(
    (s: any) => s.name?.includes("memory-flush")
  );
  // Should either not exist or be <50ms
  expect(!memFlushSpan || memFlushSpan.durationMs < 50).toBe(true);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test packages/runtime/tests/execution-engine.test.ts -t "skips memory-flush"`
Expected: FAIL — currently memory-flush always runs

- [ ] **Step 4: Add the guard**

At the top of the memory-flush phase callback (line ~2258), add:

```typescript
// Skip memory-flush when no memory services are available
const memoryOpt = yield* Effect.serviceOption(MemoryService);
if (memoryOpt._tag === "None") return;

// Skip on trivial runs: ≤1 iteration AND no tool calls
const hadToolCalls = c.toolCallStats && c.toolCallStats.length > 0;
if (c.iteration <= 1 && !hadToolCalls) return;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/runtime/tests/execution-engine.test.ts -t "skips memory-flush"`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `bun test`
Expected: All existing tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/execution-engine.ts packages/runtime/tests/execution-engine.test.ts
git commit -m "perf: skip memory-flush phase when no MemoryService or trivial run"
```

---

### Task 2: Trivial Task Fast-Path

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts:~400-450`
- Test: `packages/reasoning/tests/strategies/shared/react-kernel.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("exits in 1 iteration when model provides a complete answer with no tool call", async () => {
  // Test scenario: model answers directly, stopReason = "end_turn", no toolCalls
  const agent = await ReactiveAgents.create()
    .withProvider("test")
    .withTestScenario([{ text: "The capital of France is Paris." }])
    .withTools()
    .withReasoning()
    .build();
  const result = await agent.run("What is the capital of France?");
  expect(result.output).toContain("Paris");
  expect(result.metadata.stepsCount).toBeLessThanOrEqual(2); // 1 thought + final
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — currently takes multiple iterations with tools enabled

- [ ] **Step 3: Implement the fast-path**

In `react-kernel.ts`, after the first LLM stream is consumed and `thought` content is extracted (~line 400), before `parseAllToolRequests()` is called, add:

```typescript
// Fast-path: if first iteration, no tool calls in response, model signaled end_turn,
// and content is substantial — exit immediately without further iteration
if (
  state.iteration === 0 &&
  !thought.match(/ACTION:/i) &&  // text-mode check (removed in Phase 2)
  thought.length > 20 &&
  stopReason === "end_turn"
) {
  const output = thought.trim();
  return transitionState(state, {
    output,
    status: "completed" as const,
    steps: [...state.steps, makeStep("thought", output)],
  });
}
```

Note: In Phase 2, the `!thought.match(/ACTION:/i)` check becomes `!response.toolCalls?.length` (native FC). For now, this works with the text-based path.

- [ ] **Step 4: Run tests**

Run: `bun test packages/reasoning/tests/strategies/shared/react-kernel.test.ts`
Expected: PASS (new + existing)

- [ ] **Step 5: Run full suite**

Run: `bun test`

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/strategies/shared/react-kernel.ts packages/reasoning/tests/strategies/shared/react-kernel.test.ts
git commit -m "perf: fast-path exit for trivial tasks with tools enabled"
```

---

### Task 3: Complete Scratchpad→Recall Migration

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/tool-execution.ts:354-387`
- Modify: `packages/reasoning/src/strategies/shared/kernel-runner.ts:280`
- Modify: `packages/reasoning/src/types/observation.ts:44-45`
- Modify: `packages/reasoning/src/context/context-engine.ts` (scratchpad-read references)
- Modify: `packages/runtime/src/execution-engine.ts:825`
- Modify: `packages/tools/src/skills/pulse.ts:51`
- Modify: `packages/tools/src/adapters/agent-tool-adapter.ts:16`
- Modify: `test.ts:207-215`
- Test: existing test suite + `test.ts` scratchpad scenario

- [ ] **Step 1: Update test.ts scratchpad test case**

In `test.ts`, line 208-210, change:

```typescript
// BEFORE:
name: "Scratchpad tool usage",
input: "Use the scratchpad tool to write a note with key 'answer' containing 'The capital of France is Paris', then read it back and include it in your final answer.",

// AFTER:
name: "Recall tool usage",
input: "Use the recall tool to write a note with key 'answer' and content 'The capital of France is Paris', then read it back and include it in your final answer.",
```

- [ ] **Step 2: Remove backward-compat scratchpad-read branch in tool-execution.ts**

In `packages/reasoning/src/strategies/shared/tool-execution.ts`, lines 354-387, the short-circuit currently checks for both `"recall"` and `"scratchpad-read"`. Remove the `"scratchpad-read"` check:

```typescript
// BEFORE:
(toolRequest.tool === "recall" || toolRequest.tool === "scratchpad-read")

// AFTER:
toolRequest.tool === "recall"
```

- [ ] **Step 3: Remove scratchpad from utility tool sets**

In `kernel-runner.ts:280`, remove `"scratchpad-write"` and `"scratchpad-read"` from UTILITY_TOOLS Set (keep `"recall"`).

In `execution-engine.ts:825`, remove `"scratchpad-write"`, `"scratchpad-read"` from the filter set.

In `pulse.ts:51`, remove `"scratchpad-write"`, `"scratchpad-read"` from META_TOOLS set.

In `agent-tool-adapter.ts:16`, update ALWAYS_INCLUDE_TOOLS to `["recall"]` instead of `["scratchpad-read", "scratchpad-write"]`. Also audit the sub-agent scratchpad forwarding logic (lines ~151, 155, 195, 199, 236-240 — `result.scratchpadEntries` and `parentScratchpadWriter` references) to ensure it works with recall instead of scratchpad tools. The forwarding mechanism may need to reference the recall store instead of scratchpad-specific plumbing.

- [ ] **Step 4: Remove scratchpad mapping in observation.ts**

In `packages/reasoning/src/types/observation.ts:44-45`, remove the `"scratchpad-read": "scratchpad"` mapping.

- [ ] **Step 5: Run tests**

Run: `bun test`
Expected: All pass. The scratchpad tools were already removed from `builtinTools` — we're just cleaning up references.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix: complete scratchpad→recall migration, remove all legacy references"
```

---

### Task 4: Entropy Sensor Short-Run Calibration

**Files:**
- Modify: `packages/tools/src/skills/brief.ts:47-54`
- Modify: `packages/reactive-intelligence/src/sensor/composite.ts`
- Test: `packages/reactive-intelligence/tests/sensor/composite.test.ts`
- Test: `packages/tools/tests/brief.test.ts`

- [ ] **Step 1: Write the failing test for grade computation**

In `packages/tools/tests/brief.test.ts` (or create if needed):

```typescript
import { computeEntropyGrade } from "../../tools/src/skills/brief.js";

it("returns 'A' for short successful runs regardless of composite score", () => {
  // A 1-iteration successful run with composite 0.6 should be A, not C
  expect(computeEntropyGrade(0.6, { iterationCount: 1, success: true })).toBe("A");
  expect(computeEntropyGrade(0.5, { iterationCount: 2, success: true })).toBe("A");
});

it("uses standard grading for longer runs", () => {
  expect(computeEntropyGrade(0.6, { iterationCount: 5 })).toBe("C"); // unchanged
  expect(computeEntropyGrade(0.3, { iterationCount: 5 })).toBe("A"); // unchanged
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — current `computeEntropyGrade` doesn't accept iteration context

- [ ] **Step 3: Update computeEntropyGrade signature**

In `packages/tools/src/skills/brief.ts:47-54`:

```typescript
export function computeEntropyGrade(
  composite: number | undefined,
  context?: { iterationCount?: number; success?: boolean },
): string {
  if (composite === undefined) return "unknown";
  // Short successful runs get A — no trajectory to analyze, task was completed
  if (context?.iterationCount !== undefined && context.iterationCount <= 2 && context.success !== false) {
    return "A";
  }
  if (composite <= 0.3) return "A";
  if (composite <= 0.45) return "B";
  if (composite <= 0.65) return "C";
  if (composite <= 0.75) return "D";
  return "F";
}
```

- [ ] **Step 4: Update composite scorer for short-run bypass**

In `packages/reactive-intelligence/src/sensor/composite.ts`, in the composite scoring function, add an early gate:

```typescript
// Short-run bypass: ≤2 iterations with a completed task shouldn't be scored for trajectory
if (input.iterationCount !== undefined && input.iterationCount <= 2) {
  // Return a low-entropy score indicating clean completion
  return { ...baseScore, composite: 0.15, confidence: "high" as const };
}
```

This ensures the Reactive Controller (which reads composite scores for early-stop and strategy-switch decisions) also gets clean signals for short runs, not just the display layer.

- [ ] **Step 5: Update all computeEntropyGrade call sites to pass context**

Search for `computeEntropyGrade(` across the codebase and add iteration context where available. Key locations:
- `brief.ts:93` and `brief.ts:136` — pass `{ iterationCount, success }` from the BriefInput
- Any other callers (check via grep)

- [ ] **Step 6: Run tests**

Run: `bun test packages/tools/tests packages/reactive-intelligence/tests`

- [ ] **Step 7: Run full suite**

Run: `bun test`

- [ ] **Step 7: Commit**

```bash
git add packages/tools/src/skills/brief.ts packages/reactive-intelligence/src/sensor/composite.ts
git commit -m "fix: entropy grade A for short successful runs, eliminate false 'stalled' alerts"
```

---

### Task 5: Observation Auto-Forwarding

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts` (context builder)
- Modify: `packages/reasoning/src/strategies/shared/tool-utils.ts` (remove STORED hints)
- Test: `packages/reasoning/tests/strategies/shared/react-kernel.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("auto-forwards last stored tool result into next iteration context", async () => {
  // Scenario: tool returns large result → stored → next iteration should see data
  const agent = await ReactiveAgents.create()
    .withProvider("test")
    .withTestScenario([
      { toolCall: { name: "web-search", args: { query: "test" } } },
      { text: "Based on the search results, the answer is 42." },
    ])
    .withTools({ tools: [webSearchTool] })
    .withReasoning()
    .build();
  const result = await agent.run("Search for test data");
  // Agent should NOT have called recall — data was auto-forwarded
  const recallSteps = result.steps?.filter(
    (s: any) => s.type === "action" && s.content.includes("recall")
  );
  expect(recallSteps?.length ?? 0).toBe(0);
});
```

- [ ] **Step 2: Implement auto-forwarding in the kernel**

In `react-kernel.ts`, in the section where the dynamic context/thought prompt is built for the next iteration (around the `buildDynamicContext` call), after a tool observation step:

```typescript
// Auto-forward: inject full stored result into next iteration context
const lastObs = state.steps.filter(s => s.type === "observation").pop();
const storedKey = lastObs?.metadata?.storedKey as string | undefined;
if (storedKey && state.scratchpad.has(storedKey)) {
  const fullResult = state.scratchpad.get(storedKey)!;
  const autoForwardBudget = compression?.autoForwardBudget ?? 2_000;
  const injected = fullResult.length <= autoForwardBudget
    ? fullResult
    : fullResult.slice(0, autoForwardBudget) + `\n[...${fullResult.length - autoForwardBudget} chars truncated]`;
  // Append to observation content so model sees it
  // This replaces the STORED hint with actual data
}
```

- [ ] **Step 3: Update compressToolResult to set storedKey metadata**

In `tool-execution.ts`, when building the observation step after compression, add `storedKey` to metadata if the result was stored.

- [ ] **Step 4: Run tests**

Run: `bun test packages/reasoning/tests`

- [ ] **Step 5: Run full suite**

Run: `bun test`

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/strategies/shared/react-kernel.ts packages/reasoning/src/strategies/shared/tool-execution.ts
git commit -m "perf: auto-forward stored tool results into next iteration context"
```

---

### Task 6: Phase 1 Verification

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: All 2993+ tests pass

- [ ] **Step 2: Run cross-provider smoke test**

Run: `PROVIDER=gemini MODEL=gemini-2.5-flash bun run test.ts`
Verify: Tools grade improves from C/D to A, trivial tasks complete in ≤2 iterations

- [ ] **Step 3: Run with Anthropic**

Run: `PROVIDER=anthropic MODEL=claude-sonnet-4-20250514 bun run test.ts`
Verify: Recall test passes (was the only failure), all other tests still pass

- [ ] **Step 4: Commit any test adjustments**

---

## Phase 2: Native Function Calling Architecture

These tasks must be implemented in dependency order. Tasks 7-9 are prerequisites. Tasks 10-14 form the atomic unit that ships together.

---

### Task 7: Provider Capability Declaration

**Files:**
- Create: `packages/llm-provider/src/capabilities.ts`
- Modify: `packages/llm-provider/src/llm-service.ts:17-74`
- Modify: `packages/llm-provider/src/types.ts`
- Modify: `packages/llm-provider/src/providers/anthropic.ts`
- Modify: `packages/llm-provider/src/providers/openai.ts`
- Modify: `packages/llm-provider/src/providers/gemini.ts`
- Modify: `packages/llm-provider/src/providers/local.ts` (Ollama)
- Modify: `packages/llm-provider/src/providers/litellm.ts`
- Modify: `packages/llm-provider/src/testing.ts`
- Test: `packages/llm-provider/tests/capabilities.test.ts`

- [ ] **Step 1: Create the ProviderCapabilities type**

Create `packages/llm-provider/src/capabilities.ts`:

```typescript
export interface ProviderCapabilities {
  readonly supportsToolCalling: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsStructuredOutput: boolean;
  readonly supportsLogprobs: boolean;
}

/** Default capabilities for providers that haven't declared their own */
export const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  supportsToolCalling: false,
  supportsStreaming: true,
  supportsStructuredOutput: false,
  supportsLogprobs: false,
};
```

- [ ] **Step 2: Add capabilities() to LLMService interface**

In `packages/llm-provider/src/llm-service.ts`, add to the LLMService shape:

```typescript
capabilities: () => Effect.Effect<ProviderCapabilities, never>;
```

- [ ] **Step 3: Write tests for each provider's capabilities**

```typescript
describe("ProviderCapabilities", () => {
  it("anthropic declares tool calling support", () => {
    const caps = anthropicProvider.capabilities;
    expect(caps.supportsToolCalling).toBe(true);
    expect(caps.supportsStreaming).toBe(true);
  });
  // repeat for openai, gemini, ollama, litellm, test
});
```

- [ ] **Step 4: Address overlap with getStructuredOutputCapabilities()**

`LLMService` already has a `getStructuredOutputCapabilities()` method (line 74). The new `capabilities()` method subsumes it — `ProviderCapabilities.supportsStructuredOutput` covers the same information. For backward compat, keep `getStructuredOutputCapabilities()` but have it internally delegate to `capabilities().supportsStructuredOutput`. Document in a code comment that it's superseded.

- [ ] **Step 5: Declare capabilities in each provider**

Each provider file gets a static capabilities object and the `capabilities()` method returns it. All current providers declare `supportsToolCalling: true`.

- [ ] **Step 5: Export from package index**

Add `ProviderCapabilities`, `DEFAULT_CAPABILITIES` to `packages/llm-provider/src/index.ts`.

- [ ] **Step 6: Run tests**

Run: `bun test packages/llm-provider/tests`

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(llm-provider): add ProviderCapabilities interface and declarations for all providers"
```

---

### Task 8: Anthropic stream() Tool Fix

**Files:**
- Modify: `packages/llm-provider/src/providers/anthropic.ts:190-196`
- Test: `packages/llm-provider/tests/providers/anthropic.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("stream() passes tools parameter when provided", () => {
  // Verify the stream options include tools
  // This may require mocking the Anthropic SDK client
});
```

- [ ] **Step 2: Fix stream() to pass tools**

In `packages/llm-provider/src/providers/anthropic.ts`, at line ~190, the `client.messages.stream()` call is missing the `tools` parameter. Add it:

```typescript
const stream = client.messages.stream({
  model,
  max_tokens: request.maxTokens ?? config.defaultMaxTokens,
  temperature: request.temperature ?? config.defaultTemperature,
  system: buildSystemParam(request.systemPrompt),
  messages: toAnthropicMessages(request.messages),
  // ADD THIS:
  tools: request.tools?.map((t, i) =>
    toAnthropicTool(t, i === (request.tools?.length ?? 0) - 1),
  ),
});
```

- [ ] **Step 3: Run tests**

Run: `bun test packages/llm-provider/tests`

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(anthropic): pass tools parameter in stream() to enable native FC during streaming"
```

---

### Task 9: ToolCallResolver — Types and Native FC Strategy

**Files:**
- Create: `packages/tools/src/tool-calling/types.ts`
- Create: `packages/tools/src/tool-calling/native-fc-strategy.ts`
- Create: `packages/tools/src/tool-calling/resolver.ts`
- Test: `packages/tools/tests/tool-calling/native-fc-strategy.test.ts`
- Test: `packages/tools/tests/tool-calling/resolver.test.ts`

- [ ] **Step 1: Create types**

Create `packages/tools/src/tool-calling/types.ts`:

```typescript
import type { Effect } from "effect";

export interface ToolCallSpec {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export type ToolCallResult =
  | { readonly _tag: "tool_calls"; readonly calls: readonly ToolCallSpec[]; readonly thinking?: string }
  | { readonly _tag: "final_answer"; readonly content: string }
  | { readonly _tag: "thinking"; readonly content: string };

export interface ToolCallResolver {
  resolve(
    response: { content?: string; toolCalls?: readonly { id: string; name: string; input: unknown }[]; stopReason?: string },
    availableTools: readonly { name: string }[],
  ): Effect.Effect<ToolCallResult, never>;
}
```

- [ ] **Step 2: Write NativeFCStrategy tests**

Create `packages/tools/tests/tool-calling/native-fc-strategy.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { NativeFCStrategy } from "../../src/tool-calling/native-fc-strategy.js";

describe("NativeFCStrategy", () => {
  const strategy = new NativeFCStrategy();
  const tools = [{ name: "web-search" }, { name: "file-write" }];

  it("extracts tool calls from response.toolCalls", () => {
    const result = Effect.runSync(strategy.resolve({
      content: "Let me search for that.",
      toolCalls: [{ id: "tc_1", name: "web-search", input: { query: "AI trends" } }],
      stopReason: "tool_use",
    }, tools));
    expect(result._tag).toBe("tool_calls");
    if (result._tag === "tool_calls") {
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0].name).toBe("web-search");
      expect(result.calls[0].arguments).toEqual({ query: "AI trends" });
      expect(result.thinking).toBe("Let me search for that.");
    }
  });

  it("returns final_answer when no tool calls and end_turn", () => {
    const result = Effect.runSync(strategy.resolve({
      content: "The capital of France is Paris.",
      stopReason: "end_turn",
    }, tools));
    expect(result._tag).toBe("final_answer");
    if (result._tag === "final_answer") {
      expect(result.content).toContain("Paris");
    }
  });

  it("returns thinking when no tool calls and not end_turn", () => {
    const result = Effect.runSync(strategy.resolve({
      content: "Let me think about this...",
      stopReason: "max_tokens",
    }, tools));
    expect(result._tag).toBe("thinking");
  });

  it("handles multiple tool calls", () => {
    const result = Effect.runSync(strategy.resolve({
      toolCalls: [
        { id: "tc_1", name: "web-search", input: { query: "a" } },
        { id: "tc_2", name: "file-write", input: { path: "out.txt", content: "data" } },
      ],
      stopReason: "tool_use",
    }, tools));
    expect(result._tag).toBe("tool_calls");
    if (result._tag === "tool_calls") {
      expect(result.calls).toHaveLength(2);
    }
  });
});
```

- [ ] **Step 3: Implement NativeFCStrategy**

Create `packages/tools/src/tool-calling/native-fc-strategy.ts`:

```typescript
import { Effect } from "effect";
import type { ToolCallResolver, ToolCallResult, ToolCallSpec } from "./types.js";

export class NativeFCStrategy implements ToolCallResolver {
  resolve(
    response: { content?: string; toolCalls?: readonly { id: string; name: string; input: unknown }[]; stopReason?: string },
    _availableTools: readonly { name: string }[],
  ): Effect.Effect<ToolCallResult, never> {
    return Effect.succeed(this.extract(response));
  }

  private extract(response: {
    content?: string;
    toolCalls?: readonly { id: string; name: string; input: unknown }[];
    stopReason?: string;
  }): ToolCallResult {
    const calls = response.toolCalls;
    if (calls && calls.length > 0) {
      const specs: ToolCallSpec[] = calls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: (typeof tc.input === "object" && tc.input !== null ? tc.input : {}) as Record<string, unknown>,
      }));
      return { _tag: "tool_calls", calls: specs, thinking: response.content || undefined };
    }
    if (response.stopReason === "end_turn" || response.stopReason === "stop") {
      return { _tag: "final_answer", content: response.content ?? "" };
    }
    return { _tag: "thinking", content: response.content ?? "" };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test packages/tools/tests/tool-calling/native-fc-strategy.test.ts`

- [ ] **Step 5: Create resolver factory**

Create `packages/tools/src/tool-calling/resolver.ts`:

```typescript
import type { ProviderCapabilities } from "@reactive-agents/llm-provider";
import { NativeFCStrategy } from "./native-fc-strategy.js";
import { StructuredOutputStrategy } from "./structured-strategy.js";
import type { ToolCallResolver } from "./types.js";

export function createToolCallResolver(
  capabilities: ProviderCapabilities,
  structuredOutputEngine?: StructuredOutputEngine,
): ToolCallResolver {
  if (capabilities.supportsToolCalling) {
    return new NativeFCStrategy();
  }
  if (structuredOutputEngine) {
    return new StructuredOutputStrategy(structuredOutputEngine);
  }
  throw new Error(
    "Provider supports neither native tool calling nor structured output. " +
    "Tool use requires at least one of these capabilities."
  );
}
```

- [ ] **Step 6: Export from tools package index**

Add exports to `packages/tools/src/index.ts`.

- [ ] **Step 7: Run all tool tests**

Run: `bun test packages/tools/tests`

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(tools): add ToolCallResolver with NativeFCStrategy for native function calling"
```

---

### Task 10: KernelMessage Type and Step Metadata Evolution

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/kernel-state.ts`
- Modify: `packages/reasoning/src/types/index.ts` (ReasoningStep metadata)
- Test: `packages/reasoning/tests/strategies/shared/kernel-state.test.ts`

- [ ] **Step 1: Add KernelMessage type**

In `packages/reasoning/src/strategies/shared/kernel-state.ts`, add:

```typescript
import type { ToolCallSpec } from "@reactive-agents/tools";

/** Provider-agnostic conversation message for the kernel */
export type KernelMessage =
  | { role: "assistant"; content: string; toolCalls?: readonly ToolCallSpec[] }
  | { role: "tool_result"; toolCallId: string; content: string; isError?: boolean }
  | { role: "user"; content: string };
```

- [ ] **Step 2: Add toolCall to ReasoningStep metadata**

Ensure `ReasoningStep.metadata` can carry `toolCall?: ToolCallSpec` for action steps. Check existing type in `packages/reasoning/src/types/index.ts` — the metadata field is likely `Record<string, unknown>` already, so no type change needed, just document the convention.

- [ ] **Step 3: Add `useNativeFunctionCalling` flag to KernelRunOptions**

In `kernel-state.ts`, add to `KernelRunOptions`:

```typescript
/** Feature flag: use native function calling instead of text-based ACTION: parsing */
useNativeFunctionCalling?: boolean;
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(reasoning): add KernelMessage type, toolCall metadata, and FC feature flag"
```

---

### Task 11: Kernel Rewrite — Native FC Loop (ATOMIC UNIT START)

This is the core change. The kernel's tool interaction switches from text-parsing to native FC.

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts`
- Modify: `packages/reasoning/src/strategies/shared/tool-execution.ts`
- Test: `packages/reasoning/tests/strategies/shared/react-kernel.test.ts`

- [ ] **Step 1: Add ToolCallResolver to kernel input**

In `react-kernel.ts`, add to `ReActKernelInput`:

```typescript
toolCallResolver?: import("@reactive-agents/tools").ToolCallResolver;
useNativeFunctionCalling?: boolean;
```

- [ ] **Step 2: Implement the native FC branch in the kernel transition**

In the kernel's transition function (the `reactKernel` ThoughtKernel), add a branch gated by `useNativeFunctionCalling`:

```typescript
if (input.useNativeFunctionCalling && input.toolCallResolver) {
  // NEW PATH: Native FC
  // 1. Call LLM with tools parameter
  // 2. Pass response to resolver
  // 3. Match result tag → execute tools / return answer / continue
} else {
  // EXISTING PATH: Text-based parsing (unchanged, behind flag)
}
```

The new path:
1. Builds the LLM request with `tools` parameter (from `input.availableToolSchemas` converted to FC format)
2. Calls `llm.stream()` WITH tools
3. Collects the response (content + toolCalls + stopReason)
4. Passes to `toolCallResolver.resolve()`
5. On `tool_calls`: execute each via ToolService, build observation steps
6. On `final_answer`: return with output
7. On `thinking`: add thought step, continue loop

- [ ] **Step 3: Build action/observation steps with metadata**

When building action steps from native FC:

```typescript
const actionStep = makeStep("action", `${tc.name}(${JSON.stringify(tc.arguments)})`, {
  toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments },
});
```

Observation steps stay the same — `makeStep("observation", resultText, { observationResult })`.

- [ ] **Step 4: Simplify tool-execution.ts for FC path**

When native FC is active, `executeToolCall` no longer needs:
- `resolveToolArgs()` (args come typed from the resolver)
- `normalizeObservation()` switch (move to tool output contracts in Phase 2b)
- The recall short-circuit (tool results are in conversation history)
- Scratchpad dual-write (in the FC branch only — the text-based fallback behind the feature flag still uses scratchpadStoreRef until Task 16 deletes it)

**Note on scratchpadStoreRef lifecycle:** The module-level Ref stays in code during Phase 2 because the text-based path (behind the `useNativeFunctionCalling: false` flag) still uses it. Only the native FC branch skips the dual-write. Full deletion of `scratchpadStoreRef` happens in Task 16 (Phase 2b) when the text-based path is removed.

Create a simplified `executeNativeToolCall()`:

```typescript
export function executeNativeToolCall(
  toolService: ToolServiceInstance,
  toolCall: ToolCallSpec,
  config: ToolExecutionConfig,
): Effect.Effect<ToolExecutionResult, never> {
  return toolService.execute({
    toolName: toolCall.name,
    arguments: toolCall.arguments,
    agentId: config.agentId ?? "agent",
    sessionId: config.sessionId ?? "session",
  }).pipe(
    Effect.map((r) => {
      const raw = typeof r.result === "string" ? r.result : JSON.stringify(r.result);
      return { content: raw, observationResult: makeObservationResult(toolCall.name, true, raw) };
    }),
    Effect.catchAll((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      return Effect.succeed({
        content: `[Tool error: ${msg}]`,
        observationResult: makeObservationResult(toolCall.name, false, msg),
      });
    }),
  );
}
```

- [ ] **Step 5: Wire resolver into executeReActKernel**

In `executeReActKernel()`, before calling `runKernel()`, get the resolver:

```typescript
const capabilities = yield* llm.capabilities();
const resolver = capabilities.supportsToolCalling
  ? createToolCallResolver(capabilities)
  : undefined; // Fall back to text-based for now
```

Pass `toolCallResolver: resolver` and `useNativeFunctionCalling: !!resolver` to the kernel input.

- [ ] **Step 6: Write comprehensive tests**

Test the new FC path:
- Single tool call → execute → observe → answer
- Multiple tool calls in one response → parallel execution
- No tool call → direct answer (fast path)
- Tool error → error observation → recovery
- final-answer tool call → clean exit
- Feature flag false → text-based path unchanged

- [ ] **Step 7: Run full test suite**

Run: `bun test`
This is the critical moment — all existing tests must still pass (text path is default until proven).

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(reasoning): native function calling kernel path with ToolCallResolver integration"
```

---

### Task 12: Compaction, Streaming, and Sub-Agent Updates (ATOMIC UNIT CONT.)

**Files:**
- Modify: `packages/reasoning/src/context/compaction.ts:23-41`
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts` (streaming)
- Modify: `packages/reactive-intelligence/src/sensor/behavioral-entropy.ts:59-62`
- Modify: `packages/tools/src/skills/completion-gaps.ts:72-82`
- Test: existing tests for each file

- [ ] **Step 1: Update compaction formatStepFull()**

In `packages/reasoning/src/context/compaction.ts:23`:

```typescript
export function formatStepFull(step: ReasoningStep): string {
  if (step.type === "action" && step.metadata?.toolCall) {
    const tc = step.metadata.toolCall as { name: string; arguments: unknown };
    return `Action: ${tc.name}(${JSON.stringify(tc.arguments)})`;
  }
  if (step.type === "observation") return `Observation: ${step.content}`;
  if (step.type === "action") return `Action: ${step.content}`; // legacy compat
  return step.content;
}
```

- [ ] **Step 2: Update behavioral-entropy tool name extraction**

In `packages/reactive-intelligence/src/sensor/behavioral-entropy.ts:59-62`, ensure tool name is read from metadata first:

```typescript
const toolNames = new Set(actionSteps.map((s) => {
  const tc = s.metadata?.toolCall as { name: string } | undefined;
  return tc?.name ?? (s.metadata?.toolUsed as string) ?? "unknown";
}));
```

- [ ] **Step 3: Update completion-gaps to use metadata**

In `packages/tools/src/skills/completion-gaps.ts`, update the tool verification to check `step.metadata.toolCall.name` in addition to the existing text-based checks (keep text checks for backward compat during rollout).

- [ ] **Step 4: Streaming — filter tool_use from TextDelta**

In the kernel's stream consumption section, when collecting the LLM stream response, ensure that `tool_use` events are NOT emitted as `TextDelta`:

```typescript
// During stream collection:
for await (const event of llmStream) {
  if (event.type === "text_delta") {
    yield* streamCallback(event.text); // Emit to user
  }
  // tool_use events are collected but NOT streamed as text
  if (event.type === "tool_use_start" || event.type === "tool_use_delta") {
    // Accumulate tool call data, don't stream
  }
}
```

- [ ] **Step 5: Run tests for all modified files**

Run: `bun test packages/reasoning/tests packages/reactive-intelligence/tests packages/tools/tests`

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: update compaction, streaming, entropy, and completion guard for native FC metadata"
```

---

### Task 12b: Structured Output Strategy and Engine Extraction (Spec 2.11)

**Files:**
- Create: `packages/tools/src/structured-output/engine.ts` (extracted from reasoning)
- Create: `packages/tools/src/structured-output/types.ts`
- Create: `packages/tools/src/tool-calling/structured-strategy.ts`
- Create: `packages/tools/src/tool-calling/tool-call-schema.ts`
- Modify: `packages/reasoning/src/structured-output/pipeline.ts` (re-export from tools)
- Test: `packages/tools/tests/tool-calling/structured-strategy.test.ts`

- [ ] **Step 1: Extract structured output pipeline into tools**

The pipeline currently lives at `packages/reasoning/src/structured-output/pipeline.ts`. It is a general-purpose utility (JSON schema validation + LLM retry) with no reasoning-specific dependencies. Extract it into `packages/tools/src/structured-output/engine.ts`. Leave a re-export in the reasoning package so existing consumers don't break:

```typescript
// packages/reasoning/src/structured-output/pipeline.ts (becomes thin re-export)
export { extractStructuredOutput, type StructuredOutputEngine } from "@reactive-agents/tools";
```

- [ ] **Step 2: Create tool-call schema generator**

Create `packages/tools/src/tool-calling/tool-call-schema.ts` — generates the JSON schema for tool call selection from available ToolDefinition[]:

```typescript
export function buildToolCallSchema(tools: readonly ToolDefinition[]): object {
  const toolNames = tools.map(t => t.name);
  return {
    type: "object",
    properties: {
      reasoning: { type: "string", description: "Your reasoning for this action" },
      action: {
        oneOf: [
          { type: "null" },
          {
            type: "object",
            properties: {
              tool: { type: "string", enum: toolNames },
              arguments: { type: "object" },
            },
            required: ["tool", "arguments"],
          },
        ],
      },
      answer: { type: "string", description: "Final answer when action is null" },
    },
    required: ["reasoning", "action"],
  };
}
```

- [ ] **Step 3: Implement StructuredOutputStrategy**

Create `packages/tools/src/tool-calling/structured-strategy.ts`:

```typescript
import { Effect } from "effect";
import type { ToolCallResolver, ToolCallResult } from "./types.js";
import type { StructuredOutputEngine } from "../structured-output/types.js";
import { buildToolCallSchema } from "./tool-call-schema.js";

export class StructuredOutputStrategy implements ToolCallResolver {
  constructor(private engine: StructuredOutputEngine) {}

  resolve(response, availableTools): Effect.Effect<ToolCallResult, never> {
    // Build schema from available tools
    const schema = buildToolCallSchema(availableTools);
    // Use the engine to get structured output from the LLM response
    // Parse the result and map to ToolCallResult
    // Validate tool name exists in available set
    // Return tool_calls, final_answer, or thinking
  }
}
```

- [ ] **Step 4: Write tests including capability-override test**

Test the structured output path by forcing `supportsToolCalling: false`:

```typescript
it("falls back to structured output when FC is disabled", async () => {
  const agent = await ReactiveAgents.create()
    .withProvider("test")
    .withTestScenario([...])
    .withTools()
    .withReasoning()
    // Override: force structured output path
    .build();
  // Verify the agent still completes tool tasks correctly
});
```

Run the full 35-scenario test suite with capability overridden to validate >95% first-attempt success.

- [ ] **Step 5: Update resolver factory**

Update `resolver.ts` to wire in StructuredOutputStrategy when `supportsToolCalling === false` but structured output engine is available.

- [ ] **Step 6: Run tests**

Run: `bun test packages/tools/tests`

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(tools): add StructuredOutputStrategy fallback and extract structured output engine"
```

---

### Task 13: Enable Native FC by Default

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts`
- Test: `test.ts` (cross-provider validation)

- [ ] **Step 1: Set useNativeFunctionCalling default to true**

In `executeReActKernel()`, change the resolver creation to default to native FC when the provider supports it:

```typescript
const capabilities = yield* llm.capabilities();
const useNativeFC = input.useNativeFunctionCalling ?? capabilities.supportsToolCalling;
```

- [ ] **Step 2: Run cross-provider test suite**

Run against all 3 providers:

```bash
PROVIDER=anthropic MODEL=claude-sonnet-4-20250514 bun run test.ts
PROVIDER=gemini MODEL=gemini-2.5-flash bun run test.ts
PROVIDER=ollama MODEL=cogito:14b bun run test.ts
```

Expected: All pass rates equal or better than baseline (97%/100%/91%)

- [ ] **Step 3: Run unit test suite**

Run: `bun test`

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: enable native function calling by default for all providers with FC support"
```

---

### Task 14: Direct-LLM Path Consolidation

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts:1342-2037`
- Test: `packages/runtime/tests/execution-engine.test.ts`

- [ ] **Step 1: Audit direct-LLM features**

Before deletion, verify each feature from the direct-LLM path exists in the kernel:
- [ ] `toFunctionCallingFormat()` conversion → ToolCallResolver handles this
- [ ] Kill switch checks → kernel-runner already has this
- [ ] Progress logging → kernel hooks already handle this
- [ ] Tool execution EventBus events → tool-execution.ts publishes these
- [ ] Cost tracking → kernel token accumulation
- [ ] Episodic memory logging → verify in kernel hooks

- [ ] **Step 2: Define simplified kernel configuration for non-reasoning mode**

Add a factory or preset to `KernelRunOptions` for non-reasoning runs:

```typescript
function directLLMKernelOptions(base: KernelRunOptions): KernelRunOptions {
  return {
    ...base,
    useNativeFunctionCalling: true,
    // No iteration cap on tool loops — run until model says end_turn with no pending tools
    // maxIterations controls reasoning cycles, not tool loop iterations
    maxIterations: 100, // effectively unlimited for tool loops
    disableTerminationOracle: true, // just check end_turn + no pending tool calls
    disableEntropyScoring: true,
    disableHarnessSkill: true,
    // Keep: tool execution, EventBus events, cost tracking, kill switch
  };
}
```

This may require adding `disableTerminationOracle`, `disableEntropyScoring`, and `disableHarnessSkill` flags to `KernelRunOptions` if they don't already exist. Check `kernel-state.ts` for existing flags and add what's missing.

- [ ] **Step 3: Route non-reasoning path through kernel**

In `execution-engine.ts`, replace the direct-LLM loop (lines ~1342-2037) with:

```typescript
// Non-reasoning path: use kernel in simplified mode
const directResult = yield* executeReActKernel({
  ...baseKernelInput,
  ...directLLMKernelOptions(baseKernelInput),
});
```

Verify that all features from the direct-LLM path are covered:
- `toFunctionCallingFormat()` → ToolCallResolver handles this
- Kill switch checks → kernel-runner already has this (verify)
- Progress logging → kernel hooks (verify)
- Tool execution EventBus → tool-execution.ts (verify)
- Episodic memory logging → confirm in kernel hooks, add if missing
- Cost tracking → kernel token accumulation (verify)

- [ ] **Step 3: Run full test suite**

Run: `bun test`

- [ ] **Step 4: Run cross-provider validation**

Run: `bun run test.ts` on all 3 providers

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: consolidate direct-LLM path into kernel, eliminate duplicated FC loop"
```

---

### Task 15: Harness Skill & Prompt Cleanup

**Files:**
- Modify: `packages/runtime/assets/harness.skill.md`
- Modify: `packages/runtime/assets/harness.skill.condensed.md`
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts` (system prompt builder)

- [ ] **Step 1: Remove ACTION: format instructions from harness skills**

In both `harness.skill.md` and `harness.skill.condensed.md`:
- Remove all `ACTION:` format examples
- Remove `Observation:` format descriptions
- Remove "use recall to access stored results" language
- Update recall description to "working memory for notes and intermediate findings"
- Keep strategy guidance (how to approach problems, when to use tools)

- [ ] **Step 2: Remove tool schema text injection from system prompt**

In `react-kernel.ts`, the `buildStaticContext()` call injects tool schemas as text. When native FC is active, skip this — tools are passed via the API parameter.

- [ ] **Step 3: Run cross-provider smoke test**

Verify agents still work correctly with slimmer prompts.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor: remove ACTION: format instructions from harness, slim system prompt for native FC"
```

---

## Phase 2b: Cleanup & Polish

Ship after Phase 2 is stable for one release cycle.

---

### Task 16: Delete Text-Based ReAct Code

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/tool-utils.ts` (delete ~350 LOC)
- Modify: `packages/reasoning/src/strategies/shared/tool-execution.ts` (delete ~250 LOC)
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts` (delete text branch)

- [ ] **Step 1: Remove feature flag and text-based branch**

Delete the `if (!useNativeFunctionCalling)` branch from the kernel.

- [ ] **Step 2: Delete parsing functions from tool-utils.ts**

Remove: `parseToolRequest`, `parseAllToolRequests`, `parseBareToolCall`, `parseToolRequestBase`, `normalizeTripleQuotes`, `formatToolSchemas`, `formatToolSchemaCompact`, `HYPHENATED_BUILTINS`, brace-matching parser, greedy regex fallback.

- [ ] **Step 3: Delete repair functions from tool-execution.ts**

Remove: `resolveToolArgs`, `repairJsonControlChars`, `normalizeObservation` switch, `getRecoveryHint` switch, recall short-circuit, dual scratchpad write, `nextToolResultKey`.

- [ ] **Step 4: Delete scratchpadStoreRef**

Remove from `packages/tools/src/skills/builtin.ts:91` and all imports.

- [ ] **Step 5: Delete dead tests**

Remove tests for: `parseToolRequest`, `parseBareToolCall`, `normalizeTripleQuotes`, `repairJsonControlChars`, `resolveToolArgs`, scratchpad-read compat.

- [ ] **Step 6: Run full suite**

Run: `bun test`

- [ ] **Step 7: Commit**

```bash
git commit -m "refactor: delete text-based ReAct parsing code (~700 LOC), remove scratchpadStoreRef"
```

---

### Task 17: Tool Output Contracts

**Files:**
- Modify: `packages/tools/src/types.ts` (extend ToolDefinition)
- Modify: Each builtin tool file (add output contract)

- [ ] **Step 1: Add output contract to ToolDefinition**

```typescript
export interface ToolOutputContract {
  normalize?: (raw: unknown) => string;
  preview?: (normalized: string, budget: number) => string;
  recoveryHint?: (error: string) => string;
}
```

Add `output?: ToolOutputContract` to `ToolDefinition`.

- [ ] **Step 2: Add contracts to builtin tools**

Start with `http-get` (HTML stripping), `web-search` (result formatting), `code-execute` (error normalization), `file-write` (path extraction).

- [ ] **Step 3: Use contracts in tool-execution.ts**

Replace the remaining `normalizeObservation` logic (if any) with:

```typescript
const contract = toolDef.output;
const normalized = contract?.normalize ? contract.normalize(raw) : raw;
```

- [ ] **Step 4: Run tests, commit**

---

### Task 18: Unify ToolDefinition Types

**Files:**
- Modify: `packages/tools/src/types.ts`
- Modify: `packages/llm-provider/src/types.ts`
- Modify: `packages/reasoning/src/strategies/shared/kernel-state.ts`

- [ ] **Step 1: Make tools ToolDefinition the canonical type**

- [ ] **Step 2: Add projection function for LLM wire format**

```typescript
export function toLLMToolDefinition(def: ToolDefinition): LLMToolDefinition { ... }
```

- [ ] **Step 3: Delete ToolSchema from reasoning**

Remove the local type, import from tools.

- [ ] **Step 4: Run tests, commit**

---

## Phase 3: Documentation & Downstream

### Task 19: Documentation Migration

- [ ] Update `apps/docs/src/content/docs/guides/reasoning.md` — replace ACTION: examples
- [ ] Update `apps/docs/src/content/docs/guides/tools.md` — update tool calling section
- [ ] Update `apps/docs/src/content/docs/concepts/composable-kernel.md` — new kernel architecture
- [ ] Update `README.md` — code examples
- [ ] Add migration guide for custom strategy authors

### Task 20: Benchmark & Eval Updates

- [ ] Update benchmark assertions to check `metadata.toolCall`
- [ ] Run full benchmark suite, verify pass rate maintained
- [ ] Update eval suite if any step-format assertions exist

### Task 21: Final Verification

- [ ] Run `bun test` — all tests pass
- [ ] Run `bun run build` — clean build
- [ ] Run `test.ts` on Anthropic — pass rate ≥97%
- [ ] Run `test.ts` on Gemini — pass rate ≥100%
- [ ] Run `test.ts` on Ollama — pass rate ≥91%
- [ ] Verify trivial tasks complete in 1 iteration on all providers
- [ ] Verify memory-flush ~0ms on non-memory runs
- [ ] Verify entropy grade A on 1-iteration successes
- [ ] Update CLAUDE.md with new test counts and architecture notes
