# Message-Thread Kernel Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **RUFLO MCP TOOLS REQUIRED:** Before starting any task, agents MUST use ruflo tools as follows:
> - `mcp__ruflo__agentdb_session-start` — start a session to track progress
> - `mcp__ruflo__agentdb_pattern-search` — check for prior implementation patterns before writing code
> - `mcp__ruflo__agentdb_hierarchical-recall` — recall any relevant architectural decisions
> - `mcp__ruflo__memory_store` — store key decisions and findings after each task
> - `mcp__ruflo__claims_claim` — claim a task before starting to prevent parallel conflicts
> - `mcp__ruflo__agentdb_pattern-store` — store successful patterns for future agents
> - `mcp__ruflo__coordination_sync` — sync with other agents if running in parallel

**Goal:** Replace text-based context packing with stateful conversation threading — `state.messages[]` becomes the primary LLM interface while `state.steps[]` remains the observability record. Eliminates the double-context bug, fixes Gemini tool naming, adds provider-native prompt caching.

**Architecture:** Two independent records: `messages[]` (what the LLM sees — proper multi-turn conversation) and `steps[]` (what our systems observe — unchanged). The kernel appends to both from the same events. Sliding window compaction operates on messages instead of text blobs. System prompt becomes lean and cached. All 5 providers map `KernelMessage[]` to their native format.

**Tech Stack:** Effect-TS, bun:test, TypeScript strict, `@anthropic-ai/sdk`, `openai` node SDK, `@google/genai`, `ollama` npm package

**Spec:** `docs/superpowers/specs/2026-03-27-message-thread-kernel-design.md`

---

## File Map

### Phase 1 — Immediate Fixes (modify only)
| File | Change |
|------|--------|
| `packages/reasoning/src/strategies/shared/react-kernel.ts` | Fix double-context: drop `thoughtPrompt` after first iteration |
| `packages/reasoning/src/strategies/shared/kernel-state.ts` | Add `toolName` to `tool_result` KernelMessage variant |
| `packages/llm-provider/src/providers/gemini.ts` | Fix `functionResponse.name` from `"tool"` to actual tool name |
| **NEW** `packages/llm-provider/src/validation.ts` | Message validation + auto-repair |
| `packages/llm-provider/src/index.ts` | Export validation functions |

### Phase 2 — Message-Thread Kernel (create + modify)
| File | Change |
|------|--------|
| `packages/reasoning/src/strategies/shared/kernel-state.ts` | Add `messages: readonly KernelMessage[]` to `KernelState`, remove `conversationHistory` |
| `packages/reasoning/src/strategies/shared/react-kernel.ts` | `handleThinking`: send `state.messages` directly; `handleActing`: append to `state.messages` |
| **NEW** `packages/reasoning/src/context/message-window.ts` | Sliding window compaction for messages[] |
| `packages/reasoning/src/strategies/shared/react-kernel.ts` | `buildSystemPrompt`: lean static prompt, no dynamic context |
| `packages/runtime/src/execution-engine.ts` | Seed `state.messages` with initial task + memory preamble |

### Phase 3 — Provider Caching (modify only)
| File | Change |
|------|--------|
| `packages/llm-provider/src/providers/anthropic.ts` | Add `cache_control: { type: "ephemeral" }` to system + tools |
| `packages/llm-provider/src/providers/openai.ts` | Read `usage.prompt_tokens_details?.cached_tokens` for metrics |
| `packages/llm-provider/src/providers/gemini.ts` | Verify `toGeminiContents` uses `toolName` from Phase 1.2 |
| `packages/llm-provider/src/providers/local.ts` | No change needed (Ollama: local, no caching) |

### Phase 4 — Delete Dead Code
| File | Change |
|------|--------|
| `packages/reasoning/src/context/context-engine.ts` | Delete `buildDynamicContext`, `buildStaticContext`, `buildContext`, `formatStepsForContext` |
| `packages/reasoning/src/strategies/shared/react-kernel.ts` | Delete `thoughtPrompt` assembly, text-based branch |

---

## Phase 1: Immediate Fixes

### Task 1: Fix Double-Context Bug

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts:384-430`
- Test: `packages/reasoning/tests/strategies/shared/react-kernel.test.ts`

**Ruflo steps:**
```
mcp__ruflo__agentdb_session-start({ sessionId: "msg-thread-p1-task1", agentId: "implementer" })
mcp__ruflo__claims_claim({ taskId: "fix-double-context", agentId: "implementer" })
mcp__ruflo__agentdb_pattern-search({ query: "conversationHistory thoughtPrompt double context bug" })
```

- [ ] **Step 1: Understand the current flow**

Read lines 380-435 of `packages/reasoning/src/strategies/shared/react-kernel.ts`. The bug: when `state.conversationHistory` has entries, both the history AND a new `thoughtPrompt` are sent. The `thoughtPrompt` contains the SAME information as the history (all prior steps), causing 2-3x token waste.

- [ ] **Step 2: Write the failing test**

In `packages/reasoning/tests/strategies/shared/react-kernel.test.ts`, add:

```typescript
it("FC path: second iteration sends continuation not thoughtPrompt", async () => {
  const capturedMessages: any[][] = [];
  const mockLLM = createMockLLMWithCapture((req) => {
    capturedMessages.push(req.messages);
    return { content: "", toolCalls: [], stopReason: "end_turn" };
  });

  // Build a state that already has conversationHistory (simulates iteration 2)
  const state = {
    ...initialKernelState("test-task"),
    iteration: 1,
    conversationHistory: [
      { role: "assistant", content: "I'll search.", toolCalls: [{ id: "tc1", name: "web-search", arguments: { query: "AI" } }] },
      { role: "tool_result", toolCallId: "tc1", toolName: "web-search", content: "Results: ..." },
    ],
    toolsUsed: new Set(["web-search"]),
  };

  await runKernelIteration(state, mockLLM);

  const iteration2Messages = capturedMessages[0];
  // Should NOT contain a large thoughtPrompt at the end
  const lastMsg = iteration2Messages[iteration2Messages.length - 1];
  expect(lastMsg.role).toBe("user");
  expect(lastMsg.content.length).toBeLessThan(200); // short continuation only
  // The prior tool call should be in a structured assistant message, not re-serialized as text
  const hasStructuredHistory = iteration2Messages.some(m =>
    m.role === "assistant" && Array.isArray(m.tool_calls ?? m.toolCalls)
  );
  expect(hasStructuredHistory).toBe(true);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `bun test packages/reasoning/tests/strategies/shared/react-kernel.test.ts -t "continuation"`
Expected: FAIL — current code sends full thoughtPrompt after history

- [ ] **Step 4: Apply the fix**

In `packages/reasoning/src/strategies/shared/react-kernel.ts`, find the FC path message construction block (around line 384). Change it from:

```typescript
// CURRENT (broken) — sends both history AND thoughtPrompt:
conversationMessages = [
  ...historyMessages,
  { role: "user", content: thoughtPrompt },  // ← duplicates history as text
];
```

To:

```typescript
// FIXED — history on iterations 2+, initial prompt only on iteration 0:
if (history.length > 0) {
  // Subsequent iterations: structured history + minimal continuation hint
  const reqTools = input.requiredTools ?? [];
  const missingReq = reqTools.filter((t) => !state.toolsUsed.has(t));
  const continuationContent = missingReq.length > 0
    ? `Continue. You still need to call: ${missingReq.join(", ")}.`
    : "Continue with the task.";
  conversationMessages = [
    ...historyMessages,
    { role: "user", content: continuationContent },
  ];
} else {
  // First iteration: send initial task as the user message
  conversationMessages = [{ role: "user", content: thoughtPrompt }];
}
```

The variable `history` is already defined above (it reads from `state.conversationHistory`). The `historyMessages` is the mapped LLMMessage array.

- [ ] **Step 5: Run tests**

Run: `bun test packages/reasoning/tests/strategies/shared/react-kernel.test.ts`
Expected: All pass including new test

- [ ] **Step 6: Run full suite**

Run: `bun test`

- [ ] **Step 7: Store pattern + commit**

```
mcp__ruflo__agentdb_pattern-store({
  pattern: "FC double-context fix: use continuation message not thoughtPrompt on iterations 2+",
  context: "react-kernel.ts handleThinking FC path, state.conversationHistory check"
})
```

```bash
git add packages/reasoning/src/strategies/shared/react-kernel.ts
git commit -m "fix(kernel): FC second+ iterations send continuation not repeated thoughtPrompt"
```

---

### Task 2: Fix Gemini Tool Naming Bug + Add toolName to KernelMessage

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/kernel-state.ts:68`
- Modify: `packages/llm-provider/src/providers/gemini.ts:40-50`
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts` (handleActing: pass toolName)
- Test: `packages/llm-provider/tests/providers/gemini.test.ts`

**Ruflo steps:**
```
mcp__ruflo__claims_claim({ taskId: "fix-gemini-toolname", agentId: "implementer" })
mcp__ruflo__agentdb_pattern-search({ query: "gemini functionResponse tool name bug" })
```

- [ ] **Step 1: Update KernelMessage type**

In `packages/reasoning/src/strategies/shared/kernel-state.ts`, update the `KernelMessage` type:

```typescript
// BEFORE:
type KernelMessage =
  | { role: "user";       content: string }
  | { role: "assistant";  content: string; toolCalls?: readonly ToolCallSpec[] }
  | { role: "tool_result"; toolCallId: string; content: string; isError?: boolean }

// AFTER: add toolName to tool_result
type KernelMessage =
  | { role: "user";       content: string }
  | { role: "assistant";  content: string; toolCalls?: readonly ToolCallSpec[] }
  | { role: "tool_result"; toolCallId: string; toolName: string; content: string; isError?: boolean }
```

- [ ] **Step 2: Update handleActing to include toolName**

In `packages/reasoning/src/strategies/shared/react-kernel.ts`, in the `handleActing` FC path where `tool_result` messages are built (around line 1299-1312), add `toolName`:

```typescript
const toolResultMsgs: KernelMessage[] = executedCalls.map(({ tc, result }) => ({
  role: "tool_result",
  toolCallId: tc.id,
  toolName: tc.name,   // ← ADD THIS
  content: result.content,
  isError: !result.success,
}));
```

Also update the `conversationHistory` builder (around line 1297) to include `toolName`.

- [ ] **Step 3: Fix Gemini toGeminiContents**

In `packages/llm-provider/src/providers/gemini.ts`, lines 40-50, update:

```typescript
// BEFORE (broken — hard-codes "tool"):
if (msg.role === "tool") {
  result.push({
    role: "user",
    parts: [{
      functionResponse: {
        name: "tool",   // ← BUG
        response: { content: msg.content },
      },
    }],
  });
```

```typescript
// AFTER (fixed — uses toolCallId to find the tool name, with fallback):
if (msg.role === "tool") {
  // msg.toolName comes from KernelMessage.toolName (added in kernel-state.ts)
  // Fall back to "unknown_tool" if not available
  const toolName = (msg as any).toolName ?? "unknown_tool";
  result.push({
    role: "user",
    parts: [{
      functionResponse: {
        name: toolName,   // ← FIXED
        response: { content: msg.content },
      },
    }],
  });
```

- [ ] **Step 4: Write test**

```typescript
// packages/llm-provider/tests/providers/gemini.test.ts
it("toGeminiContents uses actual tool name in functionResponse", () => {
  const messages: LLMMessage[] = [
    { role: "assistant", content: "", toolCalls: [{ id: "tc1", name: "web-search", input: { query: "AI" } }] },
    { role: "tool", content: "Search results", toolCallId: "tc1", toolName: "web-search" } as any,
  ];
  const contents = toGeminiContentsExposed(messages);
  const toolResultPart = contents[1]?.parts?.[0] as any;
  expect(toolResultPart?.functionResponse?.name).toBe("web-search"); // not "tool"
});
```

- [ ] **Step 5: Run tests**

Run: `bun test packages/llm-provider/tests`

- [ ] **Step 6: Run full suite**

Run: `bun test`

- [ ] **Step 7: Store pattern + commit**

```
mcp__ruflo__agentdb_pattern-store({
  pattern: "Gemini functionResponse requires actual tool name from KernelMessage.toolName",
  context: "packages/llm-provider/src/providers/gemini.ts toGeminiContents, LLMMessage role:tool"
})
```

```bash
git add packages/reasoning/src/strategies/shared/kernel-state.ts packages/llm-provider/src/providers/gemini.ts packages/reasoning/src/strategies/shared/react-kernel.ts
git commit -m "fix: add toolName to KernelMessage tool_result, fix Gemini functionResponse naming"
```

---

### Task 3: Message Validation Layer

**Files:**
- Create: `packages/llm-provider/src/validation.ts`
- Modify: `packages/llm-provider/src/index.ts`
- Test: `packages/llm-provider/tests/validation.test.ts`

**Ruflo steps:**
```
mcp__ruflo__claims_claim({ taskId: "message-validation", agentId: "implementer" })
mcp__ruflo__agentdb_pattern-search({ query: "LLM message validation auto-repair" })
```

- [ ] **Step 1: Write tests first**

Create `packages/llm-provider/tests/validation.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { validateAndRepairMessages } from "../src/validation.js";
import type { LLMMessage } from "../src/types.js";

describe("validateAndRepairMessages", () => {
  it("replaces empty user content with ellipsis", () => {
    const msgs: LLMMessage[] = [{ role: "user", content: "" }];
    const result = validateAndRepairMessages(msgs);
    expect((result[0] as any).content).toBe("...");
  });

  it("removes orphaned tool_result with no prior tool_call", () => {
    const msgs: LLMMessage[] = [
      { role: "user", content: "hello" },
      { role: "tool", content: "result", toolCallId: "missing-id" } as any,
    ];
    const result = validateAndRepairMessages(msgs);
    expect(result.length).toBe(1); // orphan removed
  });

  it("passes valid conversation unchanged", () => {
    const msgs: LLMMessage[] = [
      { role: "user", content: "What is AI?" },
      { role: "assistant", content: "AI is..." },
    ];
    const result = validateAndRepairMessages(msgs);
    expect(result).toEqual(msgs);
  });

  it("handles empty messages array", () => {
    expect(validateAndRepairMessages([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/llm-provider/tests/validation.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement validation.ts**

Create `packages/llm-provider/src/validation.ts`:

```typescript
import type { LLMMessage } from "./types.js";

/**
 * Validates and auto-repairs a message array before sending to any LLM provider.
 * Silent — logs warnings in debug mode, never throws.
 * Repairs: empty content, orphaned tool_results, duplicate consecutive user messages.
 */
export function validateAndRepairMessages(messages: readonly LLMMessage[]): readonly LLMMessage[] {
  if (messages.length === 0) return messages;

  const repaired: LLMMessage[] = [];
  const toolCallIds = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;

    // Collect tool call IDs from assistant messages
    if (msg.role === "assistant") {
      const toolCalls = (msg as any).tool_calls ?? [];
      for (const tc of toolCalls) {
        if (tc.id) toolCallIds.add(tc.id);
      }
      // Repair empty assistant content (keep it — just note it)
      const content = typeof msg.content === "string" ? msg.content : "";
      repaired.push({ ...msg, content: content || "" });
      continue;
    }

    // Check for orphaned tool_result
    if (msg.role === "tool") {
      const callId = (msg as any).tool_call_id ?? (msg as any).toolCallId;
      if (callId && !toolCallIds.has(callId)) {
        // Orphaned — skip it
        if (process.env.DEBUG_VALIDATION) {
          console.warn(`[validation] Removed orphaned tool_result for tool_call_id: ${callId}`);
        }
        continue;
      }
      repaired.push(msg);
      continue;
    }

    // Repair empty user/system content
    if (msg.role === "user" || msg.role === "system") {
      const content = typeof msg.content === "string" ? msg.content : "";
      if (!content.trim()) {
        repaired.push({ ...msg, content: "..." });
        continue;
      }
    }

    repaired.push(msg);
  }

  return repaired;
}
```

- [ ] **Step 4: Export from index**

In `packages/llm-provider/src/index.ts`, add:
```typescript
export { validateAndRepairMessages } from "./validation.js";
```

- [ ] **Step 5: Run tests**

Run: `bun test packages/llm-provider/tests/validation.test.ts`
Expected: All 4 tests pass

- [ ] **Step 6: Run full suite**

Run: `bun test`

- [ ] **Step 7: Store pattern + commit**

```
mcp__ruflo__agentdb_pattern-store({
  pattern: "LLM message validation: repair before provider send, never throw, use DEBUG_VALIDATION for warnings",
  context: "packages/llm-provider/src/validation.ts"
})
```

```bash
git add packages/llm-provider/src/validation.ts packages/llm-provider/src/index.ts packages/llm-provider/tests/validation.test.ts
git commit -m "feat(llm-provider): add message validation + auto-repair layer"
```

---

### Task 4: Phase 1 Verification

**Ruflo steps:**
```
mcp__ruflo__agentdb_hierarchical-recall({ query: "phase 1 immediate fixes completed status" })
```

- [ ] **Step 1: Run cross-provider smoke test**

Run: `PROVIDER=anthropic MODEL=claude-sonnet-4-20250514 bun run test.ts 2>&1 | tail -10`
Expected: All health signals clean, iteration count similar or lower

- [ ] **Step 2: Token usage check**

Run `bun run scratch.ts` (with Anthropic). Check logs for token usage. It should be ≤50% of what it was before Phase 1 for multi-step tasks (was ~10,000-14,000 for the research task, should be ~5,000-7,000 after double-context fix).

- [ ] **Step 3: Store phase 1 results**

```
mcp__ruflo__memory_store({
  key: "phase1-token-results",
  value: "<actual token counts from test run>",
  tags: ["message-thread", "phase1", "token-usage"]
})
```

- [ ] **Step 4: Commit phase 1 completion marker**

```bash
git tag phase1-immediate-fixes
```

---

## Phase 2: Message-Thread Kernel

### Task 5: KernelState — messages as primary state

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/kernel-state.ts`
- Test: `packages/reasoning/tests/strategies/shared/kernel-state.test.ts`

**Ruflo steps:**
```
mcp__ruflo__claims_claim({ taskId: "kernelstate-messages-primary", agentId: "implementer" })
mcp__ruflo__agentdb_pattern-search({ query: "KernelState messages primary conversationHistory replacement" })
```

- [ ] **Step 1: Update KernelState interface**

In `packages/reasoning/src/strategies/shared/kernel-state.ts`, in the `KernelState` interface (around line 30-70):

```typescript
// ADD this field:
/**
 * The LLM conversation thread — what gets sent to the model.
 * Grows with each tool call (assistant turn + tool results appended).
 * Compacted via sliding window when approaching token budget.
 * Separate from steps[] which is the observability record.
 */
readonly messages: readonly KernelMessage[];

// REMOVE this field (replaced by messages):
// readonly conversationHistory?: readonly KernelMessage[];
```

- [ ] **Step 2: Update initialKernelState**

In the `initialKernelState()` function:

```typescript
// ADD:
messages: [],

// REMOVE:
// conversationHistory: [],
```

- [ ] **Step 3: Write test**

```typescript
it("initialKernelState has empty messages array", () => {
  const state = initialKernelState("test task");
  expect(state.messages).toEqual([]);
  expect((state as any).conversationHistory).toBeUndefined();
});

it("messages field exists and is readonly array", () => {
  const state = initialKernelState("test");
  expect(Array.isArray(state.messages)).toBe(true);
});
```

- [ ] **Step 4: Run tests**

Run: `bun test packages/reasoning/tests/strategies/shared`

- [ ] **Step 5: Fix TypeScript errors**

Any place that reads `state.conversationHistory` now needs to read `state.messages`. Run:
```bash
grep -rn "conversationHistory" packages/ --include="*.ts" | grep -v ".test." | grep -v node_modules | grep -v dist
```
Fix each occurrence to use `state.messages`.

- [ ] **Step 6: Run full suite**

Run: `bun test`

- [ ] **Step 7: Commit**

```bash
git commit -am "feat(kernel): messages[] replaces conversationHistory as primary LLM thread state"
```

---

### Task 6: handleThinking — Send messages[] directly (FC path)

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts:289-435` (handleThinking FC path)
- Test: `packages/reasoning/tests/strategies/shared/react-kernel.test.ts`

**Ruflo steps:**
```
mcp__ruflo__claims_claim({ taskId: "handleThinking-messages-direct", agentId: "implementer" })
mcp__ruflo__agentdb_pattern-search({ query: "handleThinking FC path LLM call messages array" })
mcp__ruflo__agentdb_hierarchical-recall({ query: "message thread kernel architecture design decisions" })
```

- [ ] **Step 1: Find current FC LLM call**

The FC path sends to the LLM at line ~376:
```typescript
const llmStreamEffect = llm.stream({
  messages: conversationMessages,  // currently built from history + thoughtPrompt
  systemPrompt: systemPromptText,
  ...
});
```

- [ ] **Step 2: Replace with direct state.messages**

In the FC path (`if (useNativeFC && resolver)` block), change message construction:

```typescript
// FC path — build from state.messages (the live conversation thread)
// Apply sliding window compaction if over budget (Phase 2, Task 7 handles this)
const fcMessages = applyMessageWindow(state.messages, profile);
const llmMessages: LLMMessage[] = fcMessages.map(toProviderMessage);

// For first iteration (empty messages), the execution engine already seeded
// state.messages with [{ role: "user", content: input.task }] (Task 8)
// so we just send it directly.

const llmStreamEffect = llm.stream({
  messages: llmMessages,
  systemPrompt: systemPromptText,  // lean static prompt (Task 9)
  maxTokens: outputMaxTokens,
  temperature: temp,
  ...(useNativeFC ? {} : { stopSequences: ["\nObservation:", "\nObservation: "] }),
  ...(llmTools ? { tools: llmTools } : {}),
  ...(wantLogprobs ? { logprobs: true, topLogprobs: 5 } : {}),
});
```

Where `applyMessageWindow` is from Task 7 (for now, stub it as identity: `(msgs) => msgs`).

Where `toProviderMessage` converts `KernelMessage` to `LLMMessage`:

```typescript
function toProviderMessage(msg: KernelMessage): LLMMessage {
  if (msg.role === "user") return { role: "user", content: msg.content };
  if (msg.role === "assistant") {
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: msg.content || null,
        tool_calls: msg.toolCalls.map(tc => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      } as any;
    }
    return { role: "assistant", content: msg.content };
  }
  if (msg.role === "tool_result") {
    return { role: "tool", content: msg.content, toolCallId: msg.toolCallId } as any;
  }
  return { role: "user", content: msg.content };
}
```

Add this helper function inside `handleThinking` or as a module-level helper.

- [ ] **Step 3: Write test**

```typescript
it("FC handleThinking sends state.messages to LLM on first call", async () => {
  // State with messages already seeded (simulates post-Task-8 execution engine seeding)
  const stateWithMessages = {
    ...initialKernelState("test"),
    messages: [{ role: "user" as const, content: "Research AI trends" }],
  };
  const capturedRequests: any[] = [];
  const mockLLM = createCapturingMockLLM(capturedRequests);

  await runFCKernelThinkStep(stateWithMessages, mockLLM);

  expect(capturedRequests[0].messages).toEqual([
    { role: "user", content: "Research AI trends" }
  ]);
  // NOT a huge thoughtPrompt blob
  expect(capturedRequests[0].messages.length).toBe(1);
});
```

- [ ] **Step 4: Run tests**

Run: `bun test packages/reasoning/tests/strategies/shared/react-kernel.test.ts`

- [ ] **Step 5: Run full suite**

Run: `bun test`

- [ ] **Step 6: Store pattern + commit**

```
mcp__ruflo__agentdb_pattern-store({
  pattern: "FC handleThinking: send state.messages directly, toProviderMessage maps KernelMessage→LLMMessage",
  context: "react-kernel.ts FC path, no more thoughtPrompt in messages array"
})
```

```bash
git commit -am "feat(kernel): FC handleThinking sends state.messages directly to LLM"
```

---

### Task 7: Sliding Window Message Compaction

**Files:**
- Create: `packages/reasoning/src/context/message-window.ts`
- Test: `packages/reasoning/tests/context/message-window.test.ts`

**Ruflo steps:**
```
mcp__ruflo__claims_claim({ taskId: "message-window-compaction", agentId: "implementer" })
mcp__ruflo__agentdb_pattern-search({ query: "sliding window context compaction messages token budget" })
```

- [ ] **Step 1: Write tests**

Create `packages/reasoning/tests/context/message-window.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { applyMessageWindow } from "../../src/context/message-window.js";
import type { KernelMessage } from "../../src/strategies/shared/kernel-state.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";

const makeMessages = (count: number): KernelMessage[] => {
  const msgs: KernelMessage[] = [{ role: "user", content: "Initial task" }];
  for (let i = 0; i < count; i++) {
    msgs.push({ role: "assistant", content: `Thought ${i}`, toolCalls: [{ id: `tc${i}`, name: "web-search", arguments: { query: `q${i}` } }] });
    msgs.push({ role: "tool_result", toolCallId: `tc${i}`, toolName: "web-search", content: `Result ${i}` });
  }
  return msgs;
};

describe("applyMessageWindow", () => {
  it("returns messages unchanged when under budget", () => {
    const msgs = makeMessages(2); // small
    const result = applyMessageWindow(msgs, CONTEXT_PROFILES["mid"]!);
    expect(result).toHaveLength(msgs.length);
  });

  it("always keeps first user message (the task)", () => {
    const msgs = makeMessages(20); // large
    const result = applyMessageWindow(msgs, CONTEXT_PROFILES["local"]!);
    expect(result[0]).toEqual({ role: "user", content: "Initial task" });
  });

  it("keeps last N full turns for local tier (N=2)", () => {
    const msgs = makeMessages(10); // 10 rounds of tool calls
    const result = applyMessageWindow(msgs, CONTEXT_PROFILES["local"]!);
    // local tier keeps last 2 assistant+tool pairs = 4 messages + 1 task + 1 summary = 6
    const assistantCount = result.filter(m => m.role === "assistant").length;
    expect(assistantCount).toBeLessThanOrEqual(3); // last 2 full + optional summary assistant
  });

  it("summary message appears as user role when compaction fires", () => {
    const msgs = makeMessages(20);
    const result = applyMessageWindow(msgs, CONTEXT_PROFILES["local"]!);
    // If compaction fired, there should be a summary user message
    const hasSummary = result.some(m =>
      m.role === "user" && m.content.startsWith("[Summary of prior work:")
    );
    expect(hasSummary || result.length <= 6).toBe(true);
  });
});
```

- [ ] **Step 2: Implement message-window.ts**

Create `packages/reasoning/src/context/message-window.ts`:

```typescript
import type { KernelMessage } from "../strategies/shared/kernel-state.js";
import type { ContextProfile } from "./context-profile.js";

/**
 * Full-turn window sizes per model tier.
 * A "full turn" = one assistant message + its tool_result messages.
 */
const FULL_TURNS_BY_TIER: Record<string, number> = {
  local: 2,
  mid: 3,
  large: 5,
  frontier: 8,
};

/** Rough token estimate: 4 chars ≈ 1 token */
function estimateTokens(messages: readonly KernelMessage[]): number {
  return messages.reduce((sum, m) => {
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    const toolCallTokens = "toolCalls" in m && m.toolCalls
      ? JSON.stringify(m.toolCalls).length / 4
      : 0;
    return sum + content.length / 4 + toolCallTokens;
  }, 0);
}

/** Split messages into assistant+tool_result groups */
function groupTurns(messages: readonly KernelMessage[]): KernelMessage[][] {
  const groups: KernelMessage[][] = [];
  let current: KernelMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "assistant") {
      if (current.length > 0) groups.push(current);
      current = [msg];
    } else if (msg.role === "tool_result") {
      current.push(msg);
    }
    // user messages are handled separately (first message = task)
  }
  if (current.length > 0) groups.push(current);

  return groups;
}

/** Summarize old turns into a single compressed user message */
function summarizeTurns(turns: KernelMessage[][]): KernelMessage {
  const summaryParts = turns.map((turn) => {
    const assistant = turn.find(m => m.role === "assistant");
    const toolCalls = "toolCalls" in (assistant ?? {}) && (assistant as any).toolCalls;
    if (toolCalls && toolCalls.length > 0) {
      const toolNames = toolCalls.map((tc: any) => tc.name).join(", ");
      const results = turn
        .filter(m => m.role === "tool_result")
        .map(m => m.content.slice(0, 100))
        .join("; ");
      return `called ${toolNames} → ${results}`;
    }
    return (assistant?.content ?? "").slice(0, 100);
  }).filter(Boolean);

  return {
    role: "user",
    content: `[Summary of prior work: ${summaryParts.join(" | ")}]`,
  };
}

/**
 * Apply sliding window compaction to keep messages within token budget.
 * - Always keeps: system (handled separately), first user message (the task)
 * - Keeps last N full turns in detail (tier-adaptive)
 * - Summarizes older turns into one compact message
 */
export function applyMessageWindow(
  messages: readonly KernelMessage[],
  profile: ContextProfile,
): readonly KernelMessage[] {
  if (messages.length === 0) return messages;

  const budget = profile.contextBudget * 0.75; // leave room for response + tools
  const currentTokens = estimateTokens(messages);

  // Under budget — send as-is
  if (currentTokens <= budget) return messages;

  const tier = profile.tier ?? "mid";
  const fullTurns = FULL_TURNS_BY_TIER[tier] ?? 3;

  // Separate first user message (the task) from conversation turns
  const [firstMsg, ...rest] = messages;
  if (!firstMsg) return messages;

  // Group remaining messages into turns
  const turns = groupTurns(rest);

  if (turns.length <= fullTurns) {
    // Not enough turns to compact — return as-is (budget will be exceeded but gracefully)
    return messages;
  }

  // Split: old turns to summarize, recent turns to keep in full
  const oldTurns = turns.slice(0, turns.length - fullTurns);
  const recentTurns = turns.slice(turns.length - fullTurns);

  const summaryMsg = summarizeTurns(oldTurns);
  const recentMessages = recentTurns.flat();

  return [firstMsg, summaryMsg, ...recentMessages];
}
```

- [ ] **Step 3: Run tests**

Run: `bun test packages/reasoning/tests/context/message-window.test.ts`
Expected: All pass

- [ ] **Step 4: Wire into handleThinking**

In `react-kernel.ts`, change the stub from Task 6:
```typescript
// BEFORE (stub):
const fcMessages = applyMessageWindow(state.messages, profile);

// AFTER (import added at top):
import { applyMessageWindow } from "../../context/message-window.js";
// (already referenced correctly)
```

- [ ] **Step 5: Run full suite**

Run: `bun test`

- [ ] **Step 6: Store pattern + commit**

```
mcp__ruflo__agentdb_pattern-store({
  pattern: "Message window compaction: keep first user msg + last N turns full + summarize older turns",
  context: "packages/reasoning/src/context/message-window.ts, applyMessageWindow(messages, profile)"
})
```

```bash
git add packages/reasoning/src/context/message-window.ts packages/reasoning/tests/context/message-window.test.ts
git commit -m "feat(context): sliding window message compaction replaces text-based buildDynamicContext"
```

---

### Task 8: handleActing — Append to messages after tool execution

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts` (handleActing FC path ~line 1218-1232)
- Test: `packages/reasoning/tests/strategies/shared/react-kernel.test.ts`

**Ruflo steps:**
```
mcp__ruflo__claims_claim({ taskId: "handleActing-append-messages", agentId: "implementer" })
mcp__ruflo__agentdb_pattern-search({ query: "handleActing FC append messages tool result KernelMessage" })
```

- [ ] **Step 1: Find the current state transition at end of handleActing FC path**

Around line 1218-1232 in `react-kernel.ts`, find:
```typescript
return transitionState(state, {
  steps: allSteps,
  toolsUsed: newToolsUsed,
  scratchpad: mergedScratchpad,
  status: "thinking",
  iteration: state.iteration + 1,
  meta: { ...state.meta, pendingNativeToolCalls: undefined, ... },
});
```

- [ ] **Step 2: Build new messages to append**

Before the `return transitionState`, build the message thread update:

```typescript
// Build the conversation thread update for this iteration's tool calls
const assistantMsg: KernelMessage = {
  role: "assistant",
  content: (state.meta.lastThought as string) ?? "",
  toolCalls: pendingNativeCalls.map(tc => ({
    id: tc.id,
    name: tc.name,
    arguments: tc.arguments,
  })),
};

// Collect tool results from the steps we just added (allSteps since last assistant step)
const toolResultMsgs: KernelMessage[] = pendingNativeCalls
  .map(tc => {
    // Find the observation step for this tool call
    const obsStep = allSteps.find(s =>
      s.type === "observation" &&
      (s.metadata?.observationResult as any)?.source === tc.name
    );
    return {
      role: "tool_result" as const,
      toolCallId: tc.id,
      toolName: tc.name,
      content: obsStep?.content ?? "",
      isError: obsStep?.metadata?.observationResult?.success === false,
    };
  })
  .filter(msg => msg.content !== ""); // skip empty results

const newMessages = [...state.messages, assistantMsg, ...toolResultMsgs];
```

- [ ] **Step 3: Include messages in transitionState**

```typescript
return transitionState(state, {
  steps: allSteps,
  toolsUsed: newToolsUsed,
  scratchpad: mergedScratchpad,
  messages: newMessages,     // ← ADD
  status: "thinking",
  iteration: state.iteration + 1,
  meta: {
    ...state.meta,
    pendingNativeToolCalls: undefined,
    lastThought: undefined,
    lastThinking: undefined,
  },
});
```

- [ ] **Step 4: Write test**

```typescript
it("FC handleActing appends assistant+tool_result to state.messages", async () => {
  const state = createTestStateWithPendingToolCalls([
    { id: "tc1", name: "web-search", arguments: { query: "AI" } }
  ]);
  const mockToolService = createMockToolService({ "web-search": "Results: AI is growing fast" });
  const newState = await runHandleActing(state, mockToolService);

  const msgs = newState.messages;
  const assistantMsg = msgs.find(m => m.role === "assistant" && "toolCalls" in m);
  expect(assistantMsg).toBeDefined();
  expect((assistantMsg as any).toolCalls?.[0]?.name).toBe("web-search");

  const toolResult = msgs.find(m => m.role === "tool_result");
  expect(toolResult).toBeDefined();
  expect((toolResult as any).toolName).toBe("web-search");
  expect((toolResult as any).content).toContain("AI is growing fast");
});
```

- [ ] **Step 5: Run tests**

Run: `bun test packages/reasoning/tests/strategies/shared/react-kernel.test.ts`

- [ ] **Step 6: Run full suite**

Run: `bun test`

- [ ] **Step 7: Store pattern + commit**

```
mcp__ruflo__agentdb_pattern-store({
  pattern: "FC handleActing: append assistant(toolCalls) + tool_result(toolName, content) to state.messages after execution",
  context: "react-kernel.ts handleActing FC path, KernelMessage builder, transitionState"
})
```

```bash
git commit -am "feat(kernel): FC handleActing appends to state.messages after each tool execution"
```

---

### Task 9: Seed messages in execution engine + lean system prompt

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts` (seed messages before runKernel)
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts` (`buildSystemPrompt`)

**Ruflo steps:**
```
mcp__ruflo__claims_claim({ taskId: "seed-messages-system-prompt", agentId: "implementer" })
mcp__ruflo__agentdb_hierarchical-recall({ query: "execution engine runKernel call initial kernel state" })
```

- [ ] **Step 1: Find where execution engine calls runKernel**

Search for the reasoning path in `packages/runtime/src/execution-engine.ts`:
```bash
grep -n "runKernel\|executeReActKernel\|executeReactive" packages/runtime/src/execution-engine.ts | head -5
```

Find where `kernelInput` is built and `runKernel` is called.

- [ ] **Step 2: Seed initial messages**

Before passing `kernelInput` to the strategy, add:

```typescript
// Seed the message thread with the initial task + optional memory preamble
const seedMessages: KernelMessage[] = [];

// Memory preamble (if memory was bootstrapped)
if (memoryBootstrapResult?.hasRelevantMemory && memoryBootstrapResult.summary) {
  seedMessages.push({
    role: "user",
    content: `[Relevant context from prior sessions: ${memoryBootstrapResult.summary}]`,
  });
  seedMessages.push({
    role: "assistant",
    content: "Understood. I'll use that context for this task.",
  });
}

// The actual task
seedMessages.push({ role: "user", content: task.input });

// Inject into kernelInput
kernelInput = { ...kernelInput, initialMessages: seedMessages };
```

Then update `KernelInput` (in `kernel-state.ts`) to accept `initialMessages?: readonly KernelMessage[]`. Update `runKernel` (in `kernel-runner.ts`) to initialize `state.messages = input.initialMessages ?? []`.

- [ ] **Step 3: Lean system prompt**

In `react-kernel.ts` `buildSystemPrompt()`, update to exclude dynamic context:

```typescript
function buildSystemPrompt(
  task: string,
  systemPrompt?: string,
  tier?: "local" | "mid" | "large" | "frontier",
): string {
  // Use custom system prompt if provided (persona, etc.)
  if (systemPrompt) return systemPrompt;

  // Tier-adaptive base instruction — NO task description, NO tool schemas,
  // NO rules about format. Those go in messages or API tools parameter.
  const t = tier ?? "mid";
  if (t === "local") {
    return "You are a helpful assistant. Use the provided tools when needed to complete tasks.";
  }
  if (t === "frontier" || t === "large") {
    return `You are an expert reasoning agent. Think step by step. Use tools precisely and efficiently. Prefer concise, direct answers once you have sufficient information.`;
  }
  return "You are a reasoning agent. Think step by step and use available tools when needed.";
}
```

**Expected result:** System prompt shrinks from 800-1,400 tokens to 20-50 tokens for the base case. The task goes in `state.messages[0]` instead.

- [ ] **Step 4: Run tests**

Run: `bun test`

- [ ] **Step 5: Commit**

```bash
git commit -am "feat: seed state.messages with task in execution engine, lean static system prompt"
```

---

## Phase 3: Provider Prompt Caching

### Task 10: Anthropic Explicit Prompt Caching

**Files:**
- Modify: `packages/llm-provider/src/providers/anthropic.ts` (complete() and stream())
- Test: `packages/llm-provider/tests/providers/anthropic.test.ts`

**Ruflo steps:**
```
mcp__ruflo__claims_claim({ taskId: "anthropic-prompt-caching", agentId: "implementer" })
mcp__ruflo__agentdb_pattern-search({ query: "Anthropic prompt caching cache_control ephemeral system tools" })
```

- [ ] **Step 1: Update buildSystemParam to add cache_control**

In `packages/llm-provider/src/providers/anthropic.ts`, find `buildSystemParam()`:

```typescript
// BEFORE:
function buildSystemParam(systemPrompt?: string): Anthropic.TextBlockParam[] | undefined {
  if (!systemPrompt) return undefined;
  return [{ type: "text", text: systemPrompt }];
}

// AFTER: add cache_control for prompt caching (min 1024 tokens)
function buildSystemParam(systemPrompt?: string): Anthropic.TextBlockParam[] | undefined {
  if (!systemPrompt) return undefined;
  return [{
    type: "text",
    text: systemPrompt,
    cache_control: { type: "ephemeral" },  // explicit caching — 90% read discount, 5min TTL
  }];
}
```

- [ ] **Step 2: Add cache_control to tools**

In both `complete()` and `stream()`, where tools are mapped with `toAnthropicTool()`, add cache_control to the last tool:

```typescript
// The Anthropic SDK applies cache_control to the last tool definition,
// which caches all tools up to and including that point.
tools: request.tools?.map((t, i) => ({
  ...toAnthropicTool(t, i === (request.tools?.length ?? 0) - 1),
  ...(i === (request.tools?.length ?? 0) - 1
    ? { cache_control: { type: "ephemeral" } }
    : {}),
})),
```

- [ ] **Step 3: Track cache metrics in response**

In the `complete()` response mapping, read cache tokens:

```typescript
const cacheTokens = {
  cacheCreation: (response.usage as any).cache_creation_input_tokens ?? 0,
  cacheRead: (response.usage as any).cache_read_input_tokens ?? 0,
};
// Include in usage object for cost tracking
```

- [ ] **Step 4: Run tests**

Run: `bun test packages/llm-provider/tests`

- [ ] **Step 5: Store pattern + commit**

```
mcp__ruflo__agentdb_pattern-store({
  pattern: "Anthropic caching: cache_control ephemeral on system text block and last tool definition",
  context: "anthropic.ts buildSystemParam, toAnthropicTool, 90% read discount, 5min TTL, min 1024 tokens"
})
```

```bash
git commit -am "feat(anthropic): add cache_control to system prompt and tools for prompt caching"
```

---

### Task 11: OpenAI Cache Metrics + Verify Automatic Caching

**Files:**
- Modify: `packages/llm-provider/src/providers/openai.ts` (read cached_tokens from usage)
- Test: `packages/llm-provider/tests/providers/openai.test.ts`

**Ruflo steps:**
```
mcp__ruflo__claims_claim({ taskId: "openai-cache-metrics", agentId: "implementer" })
```

- [ ] **Step 1: Note OpenAI caching behavior**

OpenAI automatically caches prompts >1024 tokens for gpt-4o, gpt-4o-mini, o1, o1-mini. No API parameters needed. We just need to read the cache metrics.

- [ ] **Step 2: Read cached_tokens from usage**

In `packages/llm-provider/src/providers/openai.ts`, in the `complete()` response mapping, update usage tracking:

```typescript
const usage = {
  inputTokens: response.usage?.prompt_tokens ?? 0,
  outputTokens: response.usage?.completion_tokens ?? 0,
  totalTokens: response.usage?.total_tokens ?? 0,
  estimatedCost: /* existing cost calc */,
  // OpenAI automatic prompt caching — no API changes needed
  cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
};
```

- [ ] **Step 3: Add to ProviderCapabilities**

In `packages/llm-provider/src/capabilities.ts`, add `supportsPromptCaching: boolean` to `ProviderCapabilities`. Set:
- Anthropic: `true` (explicit)
- OpenAI: `true` (automatic on eligible models)
- Gemini: `true` (automatic on Flash 1.5+)
- Ollama: `false` (local, no caching)
- LiteLLM: `false` (provider-dependent, conservative default)

- [ ] **Step 4: Run tests**

Run: `bun test packages/llm-provider/tests`

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(openai): read cached_tokens from usage, add supportsPromptCaching to ProviderCapabilities"
```

---

## Phase 4: Delete Dead Code

### Task 12: Remove buildDynamicContext and thoughtPrompt

**Files:**
- Modify: `packages/reasoning/src/context/context-engine.ts` (delete ~560 LOC)
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts` (delete imports + text branch)

**Ruflo steps:**
```
mcp__ruflo__claims_claim({ taskId: "delete-builddynamiccontext", agentId: "implementer" })
mcp__ruflo__agentdb_pattern-search({ query: "buildDynamicContext buildStaticContext usage callers" })
```

- [ ] **Step 1: Find all callers of the functions being deleted**

```bash
grep -rn "buildDynamicContext\|buildStaticContext\|buildContext\b" packages/ --include="*.ts" | grep -v node_modules | grep -v dist | grep -v ".test."
```

Verify they are ONLY called in `react-kernel.ts` (FC path already replaced them in Phase 2).

- [ ] **Step 2: Delete from context-engine.ts**

Delete these functions from `packages/reasoning/src/context/context-engine.ts`:
- `buildDynamicContext()` (~200 lines)
- `buildStaticContext()` (~150 lines)
- `buildContext()` wrapper (~50 lines)
- `formatStepsForContext()` (~100 lines)

**Keep:** `StaticContextInput`, `DynamicContextInput` types (may be used elsewhere). `buildContext` is only a re-export wrapper — check first.

- [ ] **Step 3: Delete thoughtPrompt from react-kernel.ts**

In `packages/reasoning/src/strategies/shared/react-kernel.ts`:
- Remove the imports: `buildContext, buildStaticContext, buildDynamicContext`
- Remove the `thoughtPrompt` variable and all code that builds it (~80 lines)
- Remove the text-based `else` branch in `handleThinking` (the non-FC fallback)
- Remove the `autoForwardSection` computation (no longer needed — messages carry tool results)

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: All pass — the code paths that used these functions are now replaced by message threading.

- [ ] **Step 5: Run build**

Run: `bun run build`
Expected: Clean

- [ ] **Step 6: Store deletion pattern + commit**

```
mcp__ruflo__agentdb_pattern-store({
  pattern: "buildDynamicContext deleted — replaced by state.messages conversation thread. No callers remain after Phase 2.",
  context: "packages/reasoning/src/context/context-engine.ts — ~560 LOC removed in Phase 4"
})
```

```bash
git add -A
git commit -m "refactor: delete buildDynamicContext/buildStaticContext/thoughtPrompt — replaced by message threading"
```

---

### Task 13: Phase 4 Verification + Cross-Provider Tests

**Ruflo steps:**
```
mcp__ruflo__agentdb_session-start({ sessionId: "phase4-verification" })
mcp__ruflo__agentdb_hierarchical-recall({ query: "phase1 token results baseline" })
mcp__ruflo__coordination_sync({ agentId: "implementer", status: "starting-final-verification" })
```

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: 0 failures (same as before Phase 4)

- [ ] **Step 2: Run cross-provider test.ts on Anthropic**

Run: `PROVIDER=anthropic MODEL=claude-sonnet-4-20250514 bun run test.ts 2>&1 | tail -20`
Expected: 35/35 pass, token counts lower than pre-refactor baseline

- [ ] **Step 3: Run cross-provider test.ts on Gemini**

Run: `PROVIDER=gemini MODEL=gemini-2.5-flash bun run test.ts 2>&1 | tail -20`

- [ ] **Step 4: Run scratch.ts on Ollama**

Run: `bun run scratch.ts 2>&1 | grep -E "classify|action|complete|Result:"`
Expected: cogito:14b reliably completes multi-step task (web-search + file-write) >80% of runs

- [ ] **Step 5: Check token reduction**

Compare token counts from Step 2 against pre-refactor baseline. Target: 40-60% reduction on multi-step tasks.

- [ ] **Step 6: Store final results**

```
mcp__ruflo__memory_store({
  key: "message-thread-refactor-results",
  value: "<actual results: token counts, pass rates, model completion rates>",
  tags: ["message-thread", "final-results", "v1.0"]
})
```

- [ ] **Step 7: Update CLAUDE.md**

Update test counts and add architecture note about message-thread kernel.

- [ ] **Step 8: Final commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md after message-thread kernel refactor"
git tag v1.0-message-thread-kernel
```

---

## Ruflo Session Cleanup

After all tasks complete:

```
mcp__ruflo__agentdb_session-end({
  sessionId: "msg-thread-implementation",
  summary: "Message-thread kernel complete: state.messages as primary LLM interface, sliding window compaction, provider caching, dead code deleted"
})
mcp__ruflo__claims_release({ agentId: "implementer", all: true })
```
