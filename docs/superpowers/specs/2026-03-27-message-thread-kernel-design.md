# Message-Thread Kernel Architecture

**Date:** 2026-03-27
**Status:** Draft — V1.0 Foundation
**Scope:** Complete kernel rewrite — replace text-based context packing with stateful conversation threading. Unifies all providers under one clean architecture. Eliminates ~1,500 LOC of text-assembly machinery. Makes every model from 7B to frontier perform reliably.

---

## Problem Statement

The ReAct kernel was built around a fundamentally wrong premise: pack all context into a single `thoughtPrompt` text blob and send it as a single user message every iteration.

```
Current (broken):
LLM Call N: { messages: [{ role: "user", content: <2,000 token text blob> }] }
LLM Call N+1: { messages: [<history replay>, { role: "user", content: <2,400 token text blob> }] }
```

This creates three compounding problems:

**1. Double-context bug (2-3x token waste)**
After we added `conversationHistory` to fix native FC, we created a situation where structured history AND the full `thoughtPrompt` (which contains the same information) are both sent. By iteration 3, the model sees its own tool calls and results twice — once in proper message format, once re-serialized as text.

**2. Text-serialization breaks model comprehension**
Local models (cogito, llama, qwen) are fine-tuned on proper multi-turn conversation format. When they receive `"I called web-search and got: [500 chars of compressed text]..."` inside a user message, they have to re-parse semantics from prose. When they receive `role:"assistant" tool_calls:[{web-search}]` + `role:"tool" content:[results]`, they understand it natively. The latter is how they were trained. We were fighting the models' own architecture.

**3. Quadratic context growth**
Each `thoughtPrompt` embeds all prior steps. As iterations grow, the text blob grows, and with history replay it's sent multiple times. A 10-iteration task consumes 3-4x more tokens than it should.

**Root cause:** We built `buildDynamicContext()` before native function calling existed. It was correct for text-based ReAct. After migrating to native FC, we should have replaced it entirely — instead we bolted conversation history on top of it.

---

## The Vision Alignment

From `docs/spec/docs/00-VISION.md`:

> *"The right engineering makes any model production-capable — great agents aren't locked to flagship models."*
> *"Model-Adaptive Intelligence — the framework adapts its behavior based on the model running it."*

The message-thread architecture directly realizes this vision:
- Every provider sees their native conversation format — no translation overhead
- 7B models see the same clean thread structure as GPT-4
- Context management is model-tier-adaptive (sliding window budget per tier)
- No performance gap from text-packing: the model reasons from its own prior output, not from our prose summary of it

---

## Architecture: Two Independent Records

**Principle:** What the LLM sees and what our systems observe are different concerns. Separate them cleanly.

```
┌─────────────────────────────────────────────────────────────┐
│                      AGENT THREAD                            │
│  messages: KernelMessage[]  ← What gets sent to the LLM     │
│                                                              │
│  [user]       "Research AI trends and write to file"         │
│  [assistant]  tool_calls: [web-search({query: "..."})]       │
│  [tool]       {results: [...compressed to budget...]}        │
│  [assistant]  tool_calls: [file-write({path, content})]      │
│  [tool]       "✓ Written to ./agent-news.md"                  │
│  [assistant]  "Complete. Report saved."                      │
└─────────────────────────────────────────────────────────────┘
         ↕ both updated from same events
┌─────────────────────────────────────────────────────────────┐
│                    OBSERVABILITY RECORD                      │
│  steps: ReasoningStep[]  ← What our systems read             │
│                                                              │
│  [thought]    "I'll search for AI trends..."                  │
│  [action]     web-search({query: "..."}) metadata.toolCall   │
│  [observation] [STORED: _tool_result_1] preview...           │
│  [action]     file-write({path, content})                    │
│  [observation] ✓ Written to ./agent-news.md                  │
└─────────────────────────────────────────────────────────────┘
         ↓ feeds
  Entropy Sensor · Metrics Dashboard · Debrief · Learning Engine
```

`ReasoningStep[]` format is **unchanged** — all downstream systems continue to work without modification.

---

## Phase 1: Immediate Fixes (Ship This Week)

These are bugs that exist right now. Fix before the full rewrite.

### 1.1 Fix the Double-Context Bug

**File:** `packages/reasoning/src/strategies/shared/react-kernel.ts`

The `conversationHistory` was added but `thoughtPrompt` is still appended after it. This sends the same information twice.

**Fix:** When `conversationHistory` has entries, do NOT append `thoughtPrompt`. Instead, append a minimal continuation message:

```typescript
// When history exists (not first iteration):
const continuationMsg = missingRequired.length > 0
  ? `Continue. Still need: ${missingRequired.join(", ")}.`
  : "Continue.";

messages = [...historyMessages, { role: "user", content: continuationMsg }];

// When history is empty (first iteration):
messages = [{ role: "user", content: thoughtPrompt }]; // initial task prompt only
```

**Expected gain:** 50-70% token reduction on iterations 2+.

### 1.2 Fix Gemini Tool Naming Bug

**File:** `packages/llm-provider/src/providers/gemini.ts`

`functionResponse` hard-codes `name: "tool"` instead of the actual tool name. Gemini requires the function name to match the tool that was called.

```typescript
// BROKEN:
functionResponse: { name: "tool", response: { content: msg.content } }

// FIXED:
functionResponse: { name: msg.toolName ?? "tool", response: { content: msg.content } }
```

Requires adding `toolName?: string` to the `tool_result` variant of `KernelMessage` so the name propagates from `handleActing`.

### 1.3 Add Message Validation

**File:** New `packages/llm-provider/src/validation.ts`

Before any provider sends messages to the API, validate:
- No empty `content` strings on user/assistant messages (replace with `"..."`)
- No orphaned `tool_result` without a prior `tool_call`
- No duplicate consecutive `user` messages
- Tool call IDs referenced by `tool_result` exist in a prior assistant turn

Silent validation with auto-repair (not throws) — log warnings in debug mode.

---

## Phase 2: Message-Thread Kernel (The Real Fix)

This is the core rewrite. The kernel stops building `thoughtPrompt` and instead maintains a proper `messages: KernelMessage[]` conversation thread that grows with each tool call.

### 2.1 KernelState: messages as primary state

Add to `KernelState`:

```typescript
interface KernelState {
  // existing fields unchanged...
  steps: readonly ReasoningStep[];          // observability (unchanged)

  // NEW: the LLM conversation thread
  messages: readonly KernelMessage[];       // what gets sent to the model
}
```

`initialKernelState` starts with an empty `messages` array. The execution engine seeds it with the initial task message before calling `runKernel`.

Remove `conversationHistory` (replaced by `messages`).

### 2.2 KernelMessage: canonical format

Already defined in `kernel-state.ts`. Confirm these three variants are sufficient:

```typescript
type KernelMessage =
  | { role: "user";       content: string }
  | { role: "assistant";  content: string; toolCalls?: readonly ToolCallSpec[] }
  | { role: "tool_result"; toolCallId: string; toolName: string; content: string; isError?: boolean }
```

The `toolName` field on `tool_result` is new — needed to fix the Gemini bug.

### 2.3 handleThinking: send messages directly

Replace the entire `thoughtPrompt` + `buildDynamicContext` path in the FC branch:

```typescript
// FC path — build the LLM call from state.messages directly
const systemPrompt = buildSystemPrompt(input, profile);  // static, cached
const llmMessages = toProviderMessages(state.messages);   // map to LLMMessage[]

const response = await llm.stream({
  messages: llmMessages,
  systemPrompt,
  tools: llmTools,
  maxTokens: outputMaxTokens,
  temperature: temp,
});
```

No `buildDynamicContext`. No `thoughtPrompt`. The message thread IS the context.

**First iteration:** The execution engine seeds `state.messages` with:
```typescript
[{ role: "user", content: input.task }]
```

Optionally preceded by:
- Prior context (reflexion critique, plan summary) as a compressed user message
- Memory bootstrap as a user message with format: `"[Relevant context: ...]"`

### 2.4 handleActing: append to messages after tool execution

After executing all native tool calls for this iteration:

```typescript
// 1. Append the assistant turn (the model's thought + tool calls)
const assistantMsg: KernelMessage = {
  role: "assistant",
  content: state.meta.lastThought as string ?? "",
  toolCalls: pendingNativeCalls.map(tc => ({
    id: tc.id, name: tc.name, arguments: tc.arguments
  })),
};

// 2. Append tool results
const toolResultMsgs: KernelMessage[] = executedCalls.map(({ tc, result }) => ({
  role: "tool_result",
  toolCallId: tc.id,
  toolName: tc.name,            // ← fixes Gemini bug
  content: result.content,
  isError: !result.success,
}));

// 3. Update messages in state
const newMessages = [...state.messages, assistantMsg, ...toolResultMsgs];

return transitionState(state, {
  messages: newMessages,
  // steps[] updated exactly as before
  ...
});
```

### 2.5 Context Budget Management: sliding window on messages

This replaces the text-based compaction in `buildDynamicContext`. Instead of compacting `steps[]` into shorter text, we compact `messages[]` by summarizing older turns.

**Algorithm:**
```
1. Estimate token count of current messages[]
2. If under budget: send as-is
3. If over budget:
   a. Keep system prompt (cached, free)
   b. Keep first user message (the task — always needed)
   c. Keep last N assistant+tool turns in full (per tier: local=2, mid=3, large=5, frontier=8)
   d. Summarize everything between first message and last-N turns into ONE compressed message:
      { role: "user", content: "[Summary of prior work: called web-search (found 5 results about...),
         started drafting report...]" }
```

**Token estimation:** Use `llm.countTokens()` or approximate with `content.length / 4`.

**Why this is better than current compaction:**
- Current: re-serializes steps back to text (lossy, re-parsing overhead)
- New: summarizes at the message level, preserving the "last N turns in full" structure the model was trained on
- The model always has its most recent tool calls + results as native messages

**Tier-adaptive window sizes:**

| Tier | Full Detail Turns | Token Budget | Summary Trigger |
|------|-----------------|--------------|-----------------|
| Local (≤14B) | 2 | 2,048 | 1,500 tokens |
| Mid (14B-34B) | 3 | 4,096 | 3,000 tokens |
| Large (34B-70B) | 5 | 8,192 | 6,000 tokens |
| Frontier | 8 | 16,384 | 12,000 tokens |

### 2.6 System Prompt: static, cached, tool-schema-free

The system prompt becomes lean and stable:

```
You are {persona}. {instructions}

Available tools: {tool names and one-line descriptions — NOT full schemas}
Full schemas are provided via the API tools parameter.
```

Harness skill content (strategy guidance) goes here — sent once, cached by providers that support prompt caching (Anthropic, Gemini).

**What leaves the system prompt:**
- Tool schemas (sent via API `tools` parameter — already done)
- RULES section about tool format (`ACTION:`, `Observation:` — already removed)
- Dynamic context (step history, memories, iteration status — now in messages)
- Task description (now the first user message)

**Expected system prompt size:** 200-400 tokens (down from 800-1,400 currently).

### 2.7 Memory Integration

Episodic and semantic memories are no longer mixed into `thoughtPrompt`. They become a dedicated message:

```typescript
// Before the task user message, inject memory as context:
if (memoryBootstrap.hasRelevantMemory) {
  messages.push({
    role: "user",
    content: `[Relevant context from prior sessions: ${memoryBootstrap.summary}]`
  });
  messages.push({
    role: "assistant",
    content: "Understood. I'll use that context for this task."
  });
}
// Then the actual task:
messages.push({ role: "user", content: input.task });
```

Memory bootstrap becomes a proper conversation preamble, not text injected into a prompt blob.

### 2.8 What Gets Deleted

These files/functions are no longer needed in the FC path and can be removed:

| Code | Location | LOC | Replacement |
|------|----------|-----|-------------|
| `buildDynamicContext()` | context-engine.ts | ~200 | Message threading |
| `buildStaticContext()` | context-engine.ts | ~150 | System prompt builder |
| `formatStepsForContext()` | context-engine.ts | ~100 | N/A — messages are threaded |
| `compressStepsToText()` | compaction.ts | ~180 | Message-level sliding window |
| Text-based `thoughtPrompt` assembly | react-kernel.ts | ~80 | Replaced by message array |
| `buildContext()` wrapper | context-engine.ts | ~50 | N/A |

**Estimated deletion: ~760 LOC**

The compaction.ts functions (`formatStepFull`, `formatStepSummary`, `groupToolSequences`) are **kept** — they're used for the observability `steps[]` display and the message summarization fallback.

---

## Phase 3: Provider Unification

Every provider's message conversion maps `KernelMessage[]` to their native format. This is the only place provider-specific logic lives.

### Anthropic
```
KernelMessage.role = "assistant" + toolCalls → { role: "assistant", content: [text_block, tool_use_block] }
KernelMessage.role = "tool_result" → { role: "user", content: [{ type: "tool_result", tool_use_id, content }] }
```

### OpenAI
```
KernelMessage.role = "assistant" + toolCalls → { role: "assistant", tool_calls: [...] }
KernelMessage.role = "tool_result" → { role: "tool", tool_call_id, content }
```

### Gemini
```
KernelMessage.role = "assistant" + toolCalls → { role: "model", parts: [text, functionCall(name, args)] }
KernelMessage.role = "tool_result" → { role: "user", parts: [functionResponse(toolName, response)] }
                                                                        ↑ uses toolName field (Phase 1.2 fix)
```

### Ollama
```
KernelMessage.role = "assistant" + toolCalls → { role: "assistant", tool_calls: [{ function: { name, arguments } }] }
KernelMessage.role = "tool_result" → { role: "tool", content }
```

Each provider's conversion function is ~20 lines. One canonical format in, four native formats out.

---

## Phase 4: Text-Based Path Sunset

After Phase 2 is stable and tested:

1. Delete `buildDynamicContext()`, `buildStaticContext()`, `buildContext()`
2. Delete the `thoughtPrompt` variable and all code that builds it
3. Delete the `else` text-based branch in `handleThinking`
4. The text-based path (`parseAllToolRequests`, `resolveToolArgs`, etc.) was already flagged for deletion — this is the final commit that removes them

The kernel becomes a clean 300-400 LOC orchestrator:
```
think: build messages → call LLM → route result
act:   execute tools → append to messages → sync steps[]
```

---

## What All Existing Systems Keep Working

| System | How it works after the rewrite |
|--------|-------------------------------|
| Entropy Sensor | Reads `steps[]` — unchanged |
| Metrics Dashboard | Reads EventBus events from hooks — unchanged |
| Debrief Synthesizer | Reads aggregated metrics + steps — unchanged |
| Learning Engine | Reads trajectories from steps — unchanged |
| Context Compaction | Now operates on messages[] (Phase 2.5) instead of steps[] text |
| Memory System | Injected as conversation preamble (Phase 2.7) |
| Skill Injection | Goes into system prompt — sent once, cached |
| Required Tools Guard | Reads `state.toolsUsed` — unchanged |
| Termination Oracle | Reads `steps[]` — unchanged |
| Completion Gaps | Reads `steps[]` metadata.toolCall — unchanged |
| Streaming (TextDelta) | Reads text from assistant response — unchanged |
| Tool Result Compression | Applies to tool results before appending to messages |

---

## Success Criteria

### Quantitative (measured on test.ts + scratch.ts)

| Metric | Current | Target |
|--------|---------|--------|
| Tokens per 5-iteration task | 8,000–12,000 | 3,000–5,000 |
| Token growth per iteration | Quadratic | Linear (sliding window) |
| cogito:14b task completion (scratch.ts) | ~30% inconsistent | >85% consistent |
| Gemini Flash task completion | ~50% | >90% |
| Anthropic task completion | 100% | 100% (maintained) |
| Context budget utilization | ~40% (with waste) | ~70% (efficient use) |
| Context window exhaustion point | ~8 iterations | ~20+ iterations |
| LOC deleted | 0 | ~760 |
| Provider behavior consistency | Varies | Uniform across all 5 |

### Qualitative

- Any model ≥7B that supports native FC reliably completes multi-step tool tasks
- The kernel loop is readable in 10 minutes — no hidden context assembly
- Adding a new provider is ~20 lines of message mapping code
- Tool result too large? Compression happens at message append time — one place, consistent
- Memory too large? Sliding window summary — one algorithm, all providers

---

## Implementation Phases

### Phase 1 (Immediate, ~1 day)
- Fix double-context bug (remove thoughtPrompt from history+thoughtPrompt combination)
- Fix Gemini toolName bug
- Add message validation layer

### Phase 2 (Core, ~3-5 days)
- `state.messages` as primary state
- `handleThinking` FC path: send messages, not text blob
- `handleActing` FC path: append to messages after execution
- Sliding window context budget management
- System prompt: lean + static

### Phase 3 (Provider, ~1-2 days)
- Audit all 5 provider `toXMessages()` functions
- Ensure `toolName` propagation for Gemini
- Add validation layer

### Phase 4 (Cleanup, ~1 day)
- Delete `buildDynamicContext`, `buildStaticContext`, `thoughtPrompt`
- Delete text-based `handleThinking` branch
- Remove dead context engine code

---

## Non-Goals

- Changing the `ReasoningStep` interface — it stays exactly as-is
- Changing the `AgentResult` public API — unchanged
- Changing the builder API — unchanged
- Changing how downstream systems (entropy, debrief, metrics) work — unchanged
- Multi-modal messages — out of scope for this refactor

---

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Message format differences cause provider errors | Medium | Phase 1.3 validation + Phase 3 audit |
| Context budget too tight for complex tasks | Low | Sliding window tested on existing 35 scenarios |
| Steps[] diverges from messages[] | Low | Both updated from same events in handleActing |
| Text-based fallback removed too early | Medium | Phase 4 only after Phase 2 passes full test.ts on all providers |
