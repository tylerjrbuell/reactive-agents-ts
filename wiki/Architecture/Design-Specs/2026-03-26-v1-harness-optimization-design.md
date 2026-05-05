# V1.0 Harness Optimization — Native Function Calling & Framework Efficiency

**Date:** 2026-03-26
**Status:** Draft
**Scope:** Framework-wide harness overhaul — migrate from text-based ReAct to native function calling, eliminate systemic inefficiencies, clean up architectural debt

---

## Problem Statement

The framework achieves 91-100% pass rates across Anthropic (Sonnet 4), Gemini (2.5 Flash), and Ollama (cogito:14b) on 35 test scenarios but burns excessive tokens and wall-clock time due to systemic inefficiencies rooted in the text-based ReAct architecture.

### Evidence (Cross-Provider Test Data, 2026-03-26)

| Metric | Anthropic | Gemini | Ollama |
|--------|-----------|--------|--------|
| Pass Rate | 34/35 (97%) | 35/35 (100%) | 32/35 (91%) |
| Avg Iters/Task | 2.0 | 1.8 | 2.1 |
| Avg Tokens/Task | 1,060 | 1,291 | 1,068 |
| Tools Grade | D (15 iter explosion) | C (9 iter) | D (16 iter explosion) |

### Five Proven Inefficiencies

| Issue | Evidence | Waste |
|-------|----------|-------|
| Memory-flush fires unconditionally | 1.7-8.3s per run even on trivial Q&A | 25% of wall-clock time |
| No fast-path when tools enabled | Gemini: 6 iter for "capital of France" | 5x token overhead |
| Scratchpad→recall migration incomplete | Only failing test across all 3 providers | 9-16 wasted iterations |
| Entropy sensor miscalibrated for short runs | Grade C on perfect 1-iteration completions | False alerts, noisy telemetry |
| No observation auto-forwarding | Each stored result requires recall iteration | 1 wasted iteration per large result |

### Root Architectural Issue

The ReAct kernel uses **text-based tool calling** — injecting tool schemas into the system prompt as text, having the model write `ACTION: tool-name({json})` in free text, then regex-parsing the output. This exists despite native function calling support being fully implemented in the LLM provider layer for Anthropic, OpenAI, Gemini, and Ollama.

This text-based approach generates:
- **~29 regex heuristics** across reasoning/shared/ for parsing model output (8-10 primary patterns in tool-utils.ts + context-utils.ts extraction patterns + kernel guard patterns)
- **4 JSON repair functions** for malformed arguments
- **37+ tool-specific special cases** scattered across 6 files
- **3x data duplication** per stored tool result (state.scratchpad + scratchpadStoreRef + steps[].content)
- **~1,767 tokens** of framework overhead before the agent starts thinking
- **5,033 LOC** in reasoning/shared/ directory

All major providers support native function calling. The text-based approach should never have been the primary path.

---

## Design Overview

### Phased Approach

- **Phase 1:** Surgical fixes — 5 data-backed items that ship independently and deliver immediate efficiency gains
- **Phase 2:** Native function calling architecture — the structural transformation that eliminates the root cause
- **Phase 2b:** Cleanup and polish — dead code deletion, type unification, tool output contracts
- **Phase 3:** Documentation migration and downstream updates

### Architecture After Refactor

```
┌─────────────────────────────────────────────┐
│              ReAct Kernel                     │
│  (orchestration only — no text parsing)      │
│                                              │
│  build context → call LLM → get action       │
│       → execute tool → inject result → loop  │
└──────────────┬───────────────────────────────┘
               │
     ┌─────────▼──────────┐
     │  ToolCallResolver   │  ← @reactive-agents/tools
     │  (picks strategy    │
     │   based on provider │
     │   capabilities)     │
     └──┬──────────┬───────┘
        │          │
   ┌────▼───┐ ┌───▼────────────┐
   │Native  │ │Structured      │
   │FC      │ │Output          │
   │Strategy│ │Strategy        │
   └────┬───┘ └───┬────────────┘
        │         │
   ┌────▼─────────▼───┐
   │   LLM Provider    │
   │  (with capability │
   │   declaration)    │
   └───────────────────┘
```

### Package Responsibility (Clean Separation)

| Package | Owns | Does NOT Own |
|---------|------|--------------|
| `@reactive-agents/llm-provider` | Wire format types (ToolCall, ToolDefinition), provider capability declarations, LLM API communication | Tool execution, tool business logic |
| `@reactive-agents/tools` | Tool definitions, execution, registration, MCP, ToolCallResolver (strategy selection + dispatch), tool output contracts | Reasoning orchestration, iteration control |
| `@reactive-agents/reasoning` | Kernel orchestration (think→act→observe loop), termination oracle, entropy integration, context compaction, output assembly | Tool call parsing, tool format conversion, JSON repair |
| `@reactive-agents/runtime` | Service wiring, execution engine, builder API | Tool or reasoning internals |

---

## Phase 1: Surgical Fixes

Ship independently. No architectural changes. Each is a targeted fix backed by test data.

### 1.1 Conditional Memory-Flush

**Problem:** Memory-flush phase runs on every execution, calling the LLM for memory consolidation even when `.withMemory()` was never called. Costs 1.7-8.3s per run.

**Fix:** Guard at the top of the memory-flush phase in `execution-engine.ts`:
- Skip when no MemoryService is in the Effect context
- Skip when run completed in ≤1 iteration AND no tool calls were made (pure Q&A, nothing to consolidate)
- Runs >1 iteration or runs with tool calls still flush (tool results may generate valuable episodic memory)

**Where:** `packages/runtime/src/execution-engine.ts`, memory-flush phase entry

**Success:** Trivial tasks with no `.withMemory()` show ~0ms memory-flush. "Capital of France" on Gemini drops from 6.6s to ~4.9s.

### 1.2 Trivial Task Fast-Path

**Problem:** With tools enabled, even trivial Q&A takes 6 iterations on Gemini because the kernel cycles through meta-tool injection, harness skill checks, and entropy scoring before the termination oracle evaluates.

**Fix:** After the first LLM call, if the response contains no tool call and the termination oracle scores a valid exit, return immediately. No second iteration.

**Where:** `packages/reasoning/src/strategies/shared/react-kernel.ts`, after first kernel transition

**Fast-path logic (precise):** After the first LLM call, check:
1. `response.toolCalls` is empty or undefined (native FC) / `action === null` (structured output)
2. `response.stopReason === "end_turn"` (model considers itself done)
3. Response content is non-empty and >20 characters (not a fragment)

If all three hold, return immediately. This does NOT invoke the termination oracle — it's a pre-oracle fast exit for cases where the model clearly has nothing more to do. The oracle is designed for multi-step evaluation and has no useful signal on a zero-history first response.

**Success:** Trivial tasks with tools enabled complete in 1 iteration (~400 tokens) instead of 6 (~2,324 tokens).

### 1.3 Complete Scratchpad→Recall Migration

**Problem:** The "Scratchpad tool usage" test fails on all 3 providers (D/C/D grades) because scratchpad was renamed to recall but references remain.

**Fix:**
- Update test case to reference `recall` instead of `scratchpad`
- Remove all `scratchpad-read`/`scratchpad-write` references from tool descriptions, harness skill, inference prompts
- Remove backward-compat branches in `tool-execution.ts` and `context-engine.ts`

**Where:** Scattered across ~6 files (grep for `scratchpad-read`, `scratchpad-write`)

**Success:** Tools grade goes from D to A across all providers.

### 1.4 Entropy Sensor Short-Run Calibration

**Problem:** Every 1-iteration successful run gets Grade C "flat/stalled" because there's no trajectory to analyze. This pollutes telemetry and generates false "stuck in reasoning loop" alerts.

**Fix:** In the composite scorer, add an `iterationCount` gate: when run completes in ≤2 iterations, bypass trajectory analysis. Grade based on completion quality — correct answer in 1 iteration = Grade A.

**Where:** `packages/reactive-intelligence/src/sensor/composite.ts`, grade assignment function

**Success:** 1-iteration correct answers get Grade A. No false "stalled" alerts.

### 1.5 Observation Auto-Forwarding (ReAct Text Mode Only)

**Problem:** Each compressed/stored tool result requires the model to call `recall` to access it, wasting an iteration per large result.

**Fix:** After a tool call whose result was compressed, inject the full normalized result (up to configurable budget, default 2,000 chars) into the next iteration's context. Model sees data without calling recall.

**Where:** `packages/reasoning/src/strategies/shared/react-kernel.ts`, dynamic context builder

**Note:** This fix is for the text-based ReAct path. Phase 2 (native FC) eliminates this problem entirely since tool results are conversation messages. This fix provides immediate value before Phase 2 ships.

**Compaction interaction:** Auto-forwarded content counts against the iteration's context budget as part of the observation step. It is NOT exempt from compaction — if the next iteration triggers compaction, the auto-forwarded content is summarized like any other observation. The budget (default 2,000 chars) is chosen to be well within a single iteration's headroom on all context profiles.

**Success:** Multi-step research tasks reduce recall calls, iteration count drops 30-50%.

---

## Phase 2: Native Function Calling Architecture

The structural transformation. Replaces text-based ReAct with native function calling for all supported providers, structured output fallback for the rest.

### 2.1 Provider Capability Declaration

**Problem:** No way to know at build time what a provider supports. Tool calling strategy is currently hardcoded (always text-based in reasoning, native FC only in direct-LLM path).

**Design:**

```typescript
// @reactive-agents/llm-provider
interface ProviderCapabilities {
  supportsToolCalling: boolean;
  supportsStreaming: boolean;
  supportsStructuredOutput: boolean;
  supportsLogprobs: boolean;
}
```

Each provider implementation declares capabilities statically:

```typescript
// anthropic.ts
static capabilities: ProviderCapabilities = {
  supportsToolCalling: true,
  supportsStreaming: true,
  supportsStructuredOutput: true,
  supportsLogprobs: true,
};
```

Exposed via `LLMService.capabilities()` — new method on the service interface. No runtime probing, no API calls.

**Where:** `packages/llm-provider/src/types.ts` (interface), each provider file (declaration), `packages/llm-provider/src/llm-service.ts` (method)

**Implementations requiring update:**
- Anthropic, OpenAI, Gemini, Ollama, LiteLLM provider files (add static capabilities)
- Test provider (`packages/llm-provider/src/testing.ts`)
- Any mock LLMService in the test suite

**Breaking changes:** Adding a method to the `LLMService` Context.Tag interface is a breaking change for anyone who has implemented a custom LLMService layer. Mitigation: provide a default implementation that returns `{ supportsToolCalling: false, supportsStreaming: true, supportsStructuredOutput: false, supportsLogprobs: false }` so existing custom implementations don't break — they just fall back to the structured output strategy until updated.

### 2.2 Anthropic stream() Tool Fix

**Problem:** `anthropic.ts` `stream()` method (line 190) does not pass the `tools` parameter, while `complete()` (line 160) does. This is a bug that blocks native FC in the kernel's streaming path.

**Fix:** Pass `tools` parameter in `stream()` identical to `complete()`.

**Where:** `packages/llm-provider/src/providers/anthropic.ts`, line ~190

**Breaking changes:** None — enables capability that should have been there.

### 2.3 ToolCallResolver Service

**Problem:** Tool call extraction is tightly coupled to the kernel via text-regex parsing. This should be a tools-package concern with strategy selection based on provider capabilities.

**Design:**

New service in `@reactive-agents/tools`:

```typescript
// Result type — what the resolver produces
type ToolCallResult =
  | { readonly _tag: "tool_calls"; readonly calls: ToolCallSpec[] }
  | { readonly _tag: "final_answer"; readonly content: string }
  | { readonly _tag: "thinking"; readonly content: string }

interface ToolCallSpec {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

// Resolver interface
interface ToolCallResolver {
  resolve(
    response: CompletionResponse,
    availableTools: readonly ToolDefinition[],
  ): Effect<ToolCallResult>;
}
```

Two strategy implementations:

**`NativeFCStrategy`:**
- Reads `response.toolCalls` directly
- Maps each ToolCall to ToolCallSpec
- If no tool calls and `stopReason === "end_turn"`, returns `final_answer`
- If no tool calls but `stopReason !== "end_turn"`, returns `thinking`
- Zero parsing, zero heuristics

**`StructuredOutputStrategy`:**
- For providers where `supportsToolCalling === false`
- Wraps the LLM call to request structured output with a tool-selection JSON schema:

```typescript
{
  "type": "object",
  "properties": {
    "reasoning": { "type": "string" },
    "action": {
      "oneOf": [
        { "type": "null" },
        {
          "type": "object",
          "properties": {
            "tool": { "enum": [/* available tool names */] },
            "arguments": { "type": "object" }
          },
          "required": ["tool", "arguments"]
        }
      ]
    },
    "answer": { "type": "string", "description": "Present only when action is null" }
  },
  "required": ["reasoning", "action"]
}
```

- Uses the existing structured output engine (4-layer: prompt → repair → validate → retry) through a clean interface — not coupled to it directly
- Schema generated dynamically from `availableTools` parameter definitions
- Validates tool name is in the available set, arguments match parameter schema

**Strategy selection:** Based on `ProviderCapabilities.supportsToolCalling`. The resolver reads capabilities and picks the strategy. Clean, deterministic.

**Where:** `packages/tools/src/tool-calling/` (new directory)

```
packages/tools/src/tool-calling/
├── resolver.ts           — ToolCallResolver interface + factory
├── native-fc-strategy.ts — NativeFCStrategy implementation
├── structured-strategy.ts — StructuredOutputStrategy implementation
└── tool-call-schema.ts   — JSON schema generation from ToolDefinition[]
```

**Dependencies:** LLMService (to make calls in structured output strategy), ToolDefinition[] (to build schemas)

### 2.4 Kernel Simplification

**Problem:** The ReAct kernel (1,098 LOC) mixes orchestration with text parsing, JSON repair, arg resolution, and tool-specific special cases.

**Design:** The kernel becomes a pure orchestrator. Its loop:

```
1. Build context (system prompt + conversation history)
2. Call LLM via LLMService.stream() WITH tools parameter
3. Pass response to ToolCallResolver.resolve()
4. Match result:
   - tool_calls → execute each via ToolService → add tool_result to history → continue
   - final_answer → return output
   - thinking → add thought to history → continue
5. Evaluate termination oracle
6. Loop or exit
```

**What gets deleted from reasoning/shared/:**

| File | Deleted Code | LOC Removed |
|------|-------------|-------------|
| `tool-utils.ts` | `parseToolRequest()`, `parseAllToolRequests()`, `parseBareToolCall()`, `parseToolRequestBase()`, brace-matching parser, greedy regex fallback, `HYPHENATED_BUILTINS`, `normalizeTripleQuotes()`, `formatToolSchemas()`, `formatToolSchemaCompact()` | ~350 |
| `tool-execution.ts` | `resolveToolArgs()`, `repairJsonControlChars()`, `normalizeObservation()` switch statement, `getRecoveryHint()` switch statement, recall short-circuit, dual scratchpad write, `nextToolResultKey()` | ~250 |
| `react-kernel.ts` | Text-based tool schema injection into prompt, `parseAllToolRequests()` call, `parseBareToolCall()` guard, fabricated observation stripping regex | ~100 |

**Estimated total deletion: ~700 LOC**

**What stays in reasoning:**
- Kernel orchestration (iteration control, state transitions)
- Termination oracle (evaluators for exit decisions)
- Output assembly (final answer construction, code block preservation)
- Entropy scoring integration
- Meta-tool visibility decisions (when to inject final-answer)
- Context compaction
- Step building (thought/action/observation with metadata)

**Conversation history format:** With native FC, the kernel maintains a message array:

```typescript
// Assistant message with tool call
{ role: "assistant", content: "I need to search for this.", toolCalls: [...] }
// Tool result message
{ role: "tool", toolCallId: "tc_1", content: "Search results: ..." }
// Assistant continues
{ role: "assistant", content: "Based on the results, here is my answer." }
```

This replaces the current text-injection approach where observations are concatenated into prompt strings.

**Provider-agnostic internal format:** The kernel maintains conversation history in a normalized format. The LLM provider layer maps to/from provider-specific wire formats:

```typescript
// Internal (provider-agnostic)
type KernelMessage =
  | { role: "assistant"; content: string; toolCalls?: ToolCallSpec[] }
  | { role: "tool_result"; toolCallId: string; content: string; isError?: boolean }
  | { role: "user"; content: string }
```

Each LLM provider's `complete()`/`stream()` implementation maps:
- Anthropic: `tool_result` → `role: "user"` with `tool_result` content blocks
- OpenAI: `tool_result` → `role: "tool"` with `tool_call_id`
- Gemini: `tool_result` → `role: "function"` with `FunctionResponse`
- Ollama: `tool_result` → `role: "tool"` (OpenAI-compatible)

This mapping already exists partially in the provider implementations (they handle message format conversion). The kernel never constructs provider-specific message formats.

### 2.5 ReasoningStep Compatibility

**Problem:** All downstream systems (entropy scoring, benchmarks, observability, learning engine) consume `ReasoningStep[]` with types `"thought" | "action" | "observation"`. Changing these types breaks everything.

**Design:** Keep step types identical. Enrich metadata:

```typescript
// BEFORE (text-based):
{
  type: "action",
  content: 'ACTION: web-search({"query": "AI trends"})',
  metadata: {}
}

// AFTER (native FC):
{
  type: "action",
  content: 'web-search({query: "AI trends"})',  // formatted for display
  metadata: {
    toolCall: { id: "tc_1", name: "web-search", arguments: { query: "AI trends" } },
    observationResult: { ... }
  }
}
```

- `step.type` unchanged — entropy scoring, trajectory analysis, step counting all stay compatible
- `step.content` changes from raw `ACTION:` text to a formatted display string — purely cosmetic
- `step.metadata.toolCall` is the new structured data — anything that needs typed tool call info reads this
- Historical trajectory data in SQLite stays compatible (step type sequences unchanged)

**Systems that need updating (read step.content for tool info):**
- `behavioral-entropy.ts` — read tool name from `metadata.toolCall.name` instead of parsing content
- `completion-gaps.ts` — check `metadata.toolCall.name` for required tool verification
- `context-utils.ts extractObservationFinding()` — minor format adjustment

### 2.6 Tool Result Flow (Simplified)

**Current (text-based):**
```
LLM text → regex parse → JSON repair → resolve args → execute tool
→ normalize observation → compress → store in scratchpad + Ref
→ inject STORED hint → model calls recall → short-circuit lookup → truncate
```

**After (native FC):**
```
LLM tool_call → execute tool → return tool_result message → LLM sees it next turn
```

For large results, compression still applies at the tool_result message level. The compaction system handles old tool results the same way it handles old messages.

**Eliminated:**
- `scratchpadStoreRef` module-level Ref
- `nextToolResultKey()` counter
- Dual-write sync logic (react-kernel.ts:895-901)
- `_tool_result_N` storage key pattern
- `[STORED: key]` observation format
- Recall short-circuit in `executeToolCall`

**`recall` meta-tool:** Remains available for the model to explicitly save/retrieve working notes (user-initiated storage, not auto-storage). Its role shifts from "retrieve tool results the framework hid from you" to "your personal notepad for this run."

**`scratchpadStoreRef` fate:** The module-level `Ref.unsafeMake(new Map())` in `packages/tools/src/skills/builtin.ts` is replaced by the `recall` tool's own internal store. Since `recall` is now purely agent-initiated (no auto-storage), its backing store is scoped to the `makeRecallHandler` closure — no global singleton needed. The Ref is deleted. The recall handler receives its store via Effect dependency injection (same pattern as other tools).

**Harness skill update:** The harness skill content is updated to describe recall as working memory for agent notes, plans, and intermediate findings — not for retrieving tool results (which are now in the conversation thread). Remove all "use recall to access stored results" language.

### 2.7 Compaction for Structured Messages

**Problem:** `compaction.ts` only handles text strings. With native FC, conversation history contains structured tool_use/tool_result blocks.

**Design:** Extend `formatStepFull()` and `formatStepSummary()` to handle structured step metadata:

```typescript
function formatStepFull(step: ReasoningStep): string {
  if (step.type === "action" && step.metadata?.toolCall) {
    const tc = step.metadata.toolCall;
    return `Action: ${tc.name}(${JSON.stringify(tc.arguments)})`;
  }
  if (step.type === "observation") return `Observation: ${step.content}`;
  return step.content; // thought
}
```

Compaction behavior:
- Recent tool calls preserved in full (last N steps)
- Older tool calls summarized: "Called web-search → got 5 results about AI trends"
- Tool results that were large get summarized by the compaction heuristics (same as current)

**Where:** `packages/reasoning/src/context/compaction.ts`

### 2.8 Streaming Adaptation

**Problem:** Native FC returns tool_use blocks in the stream alongside text. The kernel must emit `TextDelta` for reasoning text but not for tool_use JSON.

**Design:**
- During streaming, capture text content tokens as `TextDelta` events (same as current)
- When stream indicates `tool_use` block, do NOT emit as TextDelta
- After stream completes, read `toolCalls` from collected response
- Tool execution results are formatted and can optionally be streamed as `ObservationDelta` events

**Where:** `packages/reasoning/src/strategies/shared/react-kernel.ts` (stream consumption), `packages/runtime/src/stream-types.ts` (if adding ObservationDelta)

### 2.9 Sub-Agent Completion Guard

**Problem:** `completion-gaps.ts` uses text pattern matching on observation content to verify required tools were called. `tool-utils.ts` uses regex heuristics for tool classification.

**Fix:** Read from `step.metadata.toolCall.name` instead of parsing step content text. The `toolsUsed` Set on KernelState already tracks tool names — completion guard should use that.

**Where:** `packages/tools/src/skills/completion-gaps.ts`, `packages/reasoning/src/strategies/shared/tool-utils.ts`

### 2.10 Direct-LLM Path Consolidation

**Problem:** The execution engine has a 354-line direct-LLM loop (lines 1397-1850) that does native FC with tool loops. After the kernel refactor, both paths use native FC. Maintaining two FC implementations is unnecessary.

**Design:** The kernel becomes the single execution path. The "no reasoning" case is a simplified kernel configuration:
- No entropy scoring, no termination oracle (just stop on end_turn with no pending tool calls)
- No harness skill injection
- Tool loops run to completion regardless of `maxIterations` — `maxIterations` counts reasoning cycles (think→decide), not individual LLM calls within a tool loop. A single reasoning cycle may involve multiple tool calls if the model chains them.

The direct-LLM loop in execution-engine.ts (~700 lines, 1342-2037) is deleted. Features from the direct-LLM path that must be ported to the kernel or confirmed as already present:
- `toFunctionCallingFormat()` tool conversion → now in ToolCallResolver
- `ContextWindowManager` integration → already in kernel via context profiles
- Kill switch checks per iteration → already in kernel runner
- Progress logging → already in kernel hooks
- Tool execution with EventBus events → already in kernel via tool-execution.ts
- Episodic memory logging → confirm in kernel hooks
- Cost tracking → already in kernel via token accumulation

**Where:** `packages/runtime/src/execution-engine.ts` (delete direct-LLM loop, route through kernel)

### 2.11 Structured Output Engine Hardening

**Problem:** The structured output fallback strategy depends on the structured output engine. This engine must be bulletproof for tool call generation.

**Design:**
- Extract shared structured output pipeline from plan-execute-reflect into a location accessible by the tools package
- Add tool-call-specific schema generation (build JSON schema from ToolDefinition[])
- Add provider-adaptive prompting (some models need explicit "respond in JSON" instruction)
- Add validation that tool name exists in available set and arguments match parameter schema
- Retry with repair on malformed output (existing 4-layer pipeline)

**Separation of concerns:** The structured output engine is a general-purpose capability. The StructuredOutputStrategy calls it through an interface — it doesn't embed engine logic. The engine doesn't know about tool calls. The strategy generates the schema and interprets the result.

**Dependency resolution:** The structured output pipeline currently lives in `@reactive-agents/reasoning`. The tools package cannot import from reasoning (wrong dependency direction). Two options:

- **Option A (recommended):** Extract the structured output pipeline into `@reactive-agents/tools` since it's a general-purpose utility that tools now needs. Reasoning continues to use it via its existing dependency on tools. The pipeline has no reasoning-specific dependencies — it's pure JSON schema validation + LLM retry logic.
- **Option B:** Define a `StructuredOutputEngine` interface in tools and inject the reasoning implementation at runtime via Effect dependency injection. More indirection but avoids moving code.

Recommend Option A — the structured output pipeline is a data transformation utility, not reasoning logic. It belongs with tools.

**Success metric:** Structured output fallback produces valid tool calls on first attempt >95% of the time. Measured by: running the full 35-scenario test suite with `supportsToolCalling` forced to `false` on each provider in turn. All providers currently DO support FC, so the structured output path is explicitly tested by overriding the capability flag, not by finding a provider that lacks it.

**Where:** `packages/tools/src/structured-output/` (extracted from reasoning)

### 2.12 Harness Skill & Prompt Cleanup

**Problem:** ~400-800 tokens of system prompt dedicated to tool format instructions (`ACTION:` syntax, `Observation:` format, recall hints, tool schema text). With native FC, none of this is needed.

**Design:** System prompt shrinks to:
- Agent persona and task instructions
- Strategy guidance (how to approach problems)
- Available tool names/purposes (brief, not full schemas — the API parameter carries the schemas)

Tier-adaptive prompt generation:
- **Frontier** (Anthropic, OpenAI, Gemini full models): Rich strategy guidance, multi-step planning hints
- **Capable** (Gemini Flash, GPT-4o-mini, Ollama large): Focused strategy, less verbose
- **Local** (Ollama small <30B): Minimal, step-by-step, explicit

Model tier derived from `ProviderCapabilities` + model ID heuristics (existing tier detection in builder.ts).

**Token savings:** ~400-800 tokens removed from system prompt per run.

**Where:** `packages/reasoning/src/strategies/shared/react-kernel.ts` (system prompt builder), harness skill files in `packages/tools/src/skills/harness/`

---

## Phase 2b: Cleanup & Polish

### 2b.1 Delete Text-Based ReAct Code

After Phase 2 is stable and proven for 1 release cycle (rollback flag has not been needed), remove all dead code including the `useNativeFunctionCalling` flag and the text-based fallback path:

- `parseToolRequest()`, `parseAllToolRequests()`, `parseBareToolCall()`, `parseToolRequestBase()`
- `normalizeTripleQuotes()`, `repairJsonControlChars()`
- `resolveToolArgs()` and all JSON repair heuristics
- `formatToolSchemas()`, `formatToolSchemaCompact()`
- `HYPHENATED_BUILTINS` set, brace-matching parser
- `FINAL_ANSWER_RE` regex (final-answer is now a native tool call)
- Backward-compat `scratchpad-read` branches
- `scratchpadStoreRef` module-level Ref
- `nextToolResultKey()` global counter

**Estimated deletion: ~700-800 LOC from reasoning/shared/**

### 2b.2 Tool Output Contracts

Each tool declares its own normalization at definition time:

```typescript
export const httpGetTool: ToolDefinition = {
  name: "http-get",
  // ...existing fields...
  output: {
    normalize: (raw: unknown) => {
      const r = raw as { status: number; body: string };
      if (isHtml(r.body)) return `[${r.status}] ${stripHtml(r.body)}`;
      return typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    },
    preview: (normalized: string, budget: number) => normalized.slice(0, budget),
    recoveryHint: (error: string) => {
      if (error.includes("timeout")) return "Try a different URL or increase timeout.";
      return "";
    },
  },
};
```

Eliminates the `normalizeObservation()` switch statement. Each tool owns its output contract. Adding a new tool never requires touching shared framework code.

**Where:** `packages/tools/src/types.ts` (extend ToolDefinition), each tool file (add output contract)

### 2b.3 Unify ToolDefinition Types

Three ToolDefinition types currently exist:
- `@reactive-agents/tools` — rich (parameters[], riskLevel, timeoutMs, source, caching)
- `@reactive-agents/llm-provider` — minimal (name, description, inputSchema)
- `@reactive-agents/reasoning` — local ToolSchema (name, description, parameters[])

Consolidate to one canonical type in tools, with a lightweight projection function for the LLM wire format. Reasoning's local ToolSchema becomes an import from tools.

**Where:** `packages/tools/src/types.ts` (canonical), `packages/llm-provider/src/types.ts` (projection), `packages/reasoning/src/strategies/shared/kernel-state.ts` (delete local ToolSchema)

---

## Phase 3: Documentation & Downstream Updates

### 3.1 Documentation Migration

All docs showing `ACTION: tool({args})` format need updating:
- `apps/docs/src/content/docs/guides/reasoning.md`
- `apps/docs/src/content/docs/concepts/composable-kernel.md`
- `apps/docs/src/content/docs/guides/tools.md`
- `apps/docs/src/content/docs/guides/context-engineering.md`
- Code examples in cookbook
- README.md quick start

Add migration guide for users who've built custom strategies or tools expecting text-format steps.

### 3.2 Benchmark & Eval Updates

- Update benchmark validation to accept `metadata.toolCall` on action steps
- Update eval suite assertions to work with new step format
- Verify benchmark pass rate is maintained or improved

### 3.3 Test Strategy

**Tests to update:**
- Any test asserting `ACTION:` text in step content → assert `metadata.toolCall` instead
- Scratchpad test → recall test (Phase 1)
- Tests using `withTestScenario` tool turns → already compatible (test provider supports toolCalls)

**Tests to add:**
- ToolCallResolver unit tests (native FC strategy, structured output strategy)
- Provider capability declaration tests
- End-to-end: native FC tool loop on each provider
- Structured output fallback: tool call generation on model without FC
- Regression: all existing test.ts scenarios pass on all 3 providers

**Tests to remove:**
- Text-parsing unit tests (`parseToolRequest`, `parseBareToolCall`, brace matching)
- JSON repair tests (`normalizeTripleQuotes`, `repairJsonControlChars`)
- `resolveToolArgs` tests
- Scratchpad-read backward compat tests

---

## Success Criteria

### Quantitative (Measured Against Current Test Data)

| Metric | Current | Phase 1 | Phase 2 | Phase 2b |
|--------|---------|---------|---------|----------|
| Trivial task iterations (tools enabled) | 6 (Gemini) | 1-2 | 1 | 1 |
| Memory-flush overhead (no memory) | 1.7-8.3s | ~0s | ~0s | ~0s |
| Tools test grade | D/C/D | A/A/A | A/A/A | A/A/A |
| Entropy grade on 1-iter success | C | A | A | A |
| Token overhead (framework prompt) | ~1,767 | ~1,400 | ~800 | ~800 |
| LOC in reasoning/shared/ | 5,033 | ~4,800 | ~4,100 | ~3,500 |
| Special cases in tool pipeline | 37+ | ~30 | ~10 | ~5 |
| Regex patterns | 29 | ~25 | ~5 | ~3 |
| Scratchpad data copies per result | 3x | 2x | 1x | 1x |
| Files touched to add new tool | 4+ | 4+ | 1 | 1 |

### Qualitative

- All 35 test scenarios pass on all 3 providers after each phase
- No regression in pass rate or accuracy
- Agent streaming (TextDelta) works with native FC
- Structured output fallback produces valid tool calls >95% first attempt
- Developer adding a new tool touches only the tool definition file
- think→action→observe step pattern preserved in observability output

---

## Downstream Impact Assessment

### Unaffected (No Changes Needed)

| System | Why Safe |
|--------|----------|
| All 5 reasoning strategies | Use kernel abstraction, don't parse text |
| Debrief synthesis | Reads aggregated metrics, not steps |
| Gateway / webhooks | No step format dependency |
| Agent.chat() / sessions | Delegates to strategies |
| Test provider | Already supports toolCalls |
| ToolService execution | Unchanged — still executes tools |

### Needs Update (Addressed in Phase 2)

| System | What Changes | Risk |
|--------|-------------|------|
| Entropy sensor (behavioral) | Read tool name from metadata instead of content | Low |
| Completion guard | Check metadata.toolCall.name instead of text | Low |
| Context compaction | Handle structured step metadata | Medium |
| Streaming | Distinguish text from tool_use in stream | Medium |
| Sub-agent system | Use metadata for tool verification | Medium |
| Observability metrics | Rely on EventBus events, not step content | Low |

### Needs Update (Phase 3)

| System | What Changes | Risk |
|--------|-------------|------|
| Documentation | Replace ACTION: examples | Medium |
| Benchmarks | Accept metadata.toolCall in assertions | Low |
| Eval suite | Update step format assertions | Low |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Provider FC behavior differences | Medium | Medium | Test on all 4 providers, strategy pattern handles variance |
| Structured output fallback unreliable | Low | High | Existing 4-layer pipeline proven; validate >95% first-attempt success |
| Step format change breaks downstream | Low | High | Keep step types identical; only enrich metadata |
| Performance regression during migration | Medium | Medium | Phase 1 ships first with immediate gains; Phase 2 behind feature flag initially |
| Streaming breaks during FC migration | Medium | Medium | Test streaming on all providers before merging |

---

## Dependencies

- Phase 1 has no dependencies — each fix is independent
- Phase 2.1 (capabilities) must ship before 2.3 (resolver)
- Phase 2.2 (Anthropic stream fix) must ship before 2.4 (kernel simplification)
- Phase 2.3 (resolver) must ship before 2.4 (kernel simplification)
- **Phase 2.4 (kernel) + 2.5 (step compat) + 2.7 (compaction) + 2.8 (streaming) + 2.9 (sub-agent guard) are an atomic unit** — they must ship together since the kernel cannot function without compaction handling structured messages, streaming distinguishing text from tool_use, and sub-agents reading the new metadata format
- Phase 2.10 (direct-LLM consolidation) ships after the atomic unit is stable
- Phase 2b depends on Phase 2 being stable
- Phase 3 can happen in parallel with Phase 2b

## Rollback Strategy

Phase 2 is a structural change to the core reasoning loop. To enable safe incremental rollout:

**Feature flag:** Add `useNativeFunctionCalling: boolean` to `ReActKernelInput` (default: `true`). When `false`, the kernel falls back to the text-based path (which remains in code until Phase 2b deletion).

**Rollout sequence:**
1. Ship Phase 2 with flag defaulting to `true`
2. Run full test suite on all 3 providers — if pass rate drops, flip to `false` and investigate
3. Once stable for 1 release cycle, proceed to Phase 2b (delete text-based code)
4. Phase 2b removes the flag and the text-based fallback permanently

This means the ~700 LOC of text-parsing code is NOT deleted in Phase 2 — it stays as dead code behind the flag. Phase 2b is the cleanup that removes it once the native FC path is proven.

---

## Non-Goals

- Changing the ReasoningStep type enum (`"thought" | "action" | "observation"`) — we keep these stable
- Rewriting the termination oracle — it works correctly
- Changing the Effect-TS service pattern — it's the right architecture
- Supporting providers that have neither function calling nor structured output — such models cannot use tools
- Backward compatibility for text-based `ACTION:` format — clean break, not deprecated
