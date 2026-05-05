# V1.0 FC Unification & Dead Code Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the codebase to a single native function calling path, deleting ~700 LOC of text-based ACTION: parsing dead code so every test exercises the real FC path.

**Architecture:** The test LLM provider already emits correct `tool_use_start`/`tool_use_delta`/`content_complete` stream events for `toolCall` turns — the only blocker is `supportsToolCalling: false` in `testing.ts:259`. Changing this one flag makes `kernel-runner` create a `ToolCallResolver` for all tests, enabling deletion of the text-path branches that currently exist only for test compatibility. Context-engine dead code (`buildContext`, `buildPinnedToolReference`, text-path branches in `buildToolReference`/`buildRules`) is removed separately.

**Tech Stack:** TypeScript, Effect-TS, Bun test (`bun:test`), bun:sqlite. All code follows `CODING_STANDARDS.md`: Effect-TS patterns, `readonly` fields, tagged errors, no `@ts-ignore`.

---

## File Map

| File | Action | What Changes |
|------|--------|--------------|
| `packages/llm-provider/src/testing.ts` | Modify | Line ~259: `supportsToolCalling: false` → `true` |
| `packages/reasoning/src/strategies/shared/react-kernel.ts` | Modify | Remove `useNativeFC` conditionals, text-path action selection block (~lines 368-372, 414-427, 435, 647-652, 812-948), remove text-parsing imports |
| `packages/reasoning/src/strategies/shared/kernel-runner.ts` | Modify | Simplify auto-detect block (always create resolver); remove `parseBareToolCall` embedded guard block (~lines 508-530) |
| `packages/reasoning/src/strategies/shared/tool-utils.ts` | Modify | Delete: `parseToolRequest`, `parseToolRequestBase`, `parseBareToolCall`, `parseAllToolRequests`, `parseToolRequestGroup` (~lines 27-137, 359-397) |
| `packages/reasoning/src/context/context-engine.ts` | Modify | Delete: `buildContext` (~lines 254-342), `buildPinnedToolReference` (~lines 581-607); remove text-path branches from `buildToolReference` and `buildRules`; remove `useNativeFunctionCalling` from `StaticContextInput`/`DynamicContextInput` |
| `packages/reasoning/src/strategies/shared/react-kernel.ts` | Modify | Remove `useNativeFunctionCalling` from `ReActKernelInput` and its passthrough at end of file |
| `packages/reasoning/tests/strategies/shared/tool-utils.test.ts` | Modify | Delete tests for removed functions |

**Keep untouched:** `hasFinalAnswer`, `extractFinalAnswer`, `FINAL_ANSWER_RE` — these are used in the FC path (cleaning model output that writes "FINAL ANSWER:" text) and in `termination-oracle.ts`. They are NOT text-path-only.

---

## Task 1: Enable Native FC in Test Provider

**Files:**
- Modify: `packages/llm-provider/src/testing.ts` (line ~259)

### Context

The test provider stream (`stream()` method) already emits correct native FC events for `toolCall` turns:
```typescript
// Already correct in stream():
{ type: "tool_use_start", id: "call-0-0", name: spec.name },
{ type: "tool_use_delta", input: JSON.stringify(spec.args) },
{ type: "content_complete", content: "" },
```

The `complete()` method also already returns proper `toolCalls`. The ONLY blocker is the `capabilities()` method returning `supportsToolCalling: false`, which prevents `kernel-runner` from creating a `ToolCallResolver`.

- [ ] **Step 1.1: Change supportsToolCalling**

In `packages/llm-provider/src/testing.ts`, find the `capabilities()` method (near the bottom of `TestLLMService`). Change:

```typescript
// BEFORE
capabilities: () =>
  Effect.succeed({
    ...DEFAULT_CAPABILITIES,
    supportsToolCalling: false, // Test provider uses its own tool dispatch, not native FC
    supportsStreaming: true,
  }),
```

To:

```typescript
// AFTER
capabilities: () =>
  Effect.succeed({
    ...DEFAULT_CAPABILITIES,
    supportsToolCalling: true, // Test provider emits native FC stream events
    supportsStreaming: true,
  }),
```

- [ ] **Step 1.2: Run full test suite and record failures**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
bun test 2>&1 | tee /tmp/test-after-fc-flag.txt | tail -50
```

Expected: Most tests pass. Some tests using `{ text: "ACTION: tool_name({...})" }` patterns will fail because those text strings are no longer parsed as tool calls — the FC resolver will see them as plain text final answers, not as tool calls.

- [ ] **Step 1.3: Identify and update failing tests**

```bash
grep -n "FAIL\|✗" /tmp/test-after-fc-flag.txt | head -40
```

For each failing test, check if it uses text-encoded tool calls. Migrate to native FC format:

```typescript
// OLD (text-based, no longer works):
{ text: `I will search for that.\nACTION: web-search({"query": "AI news"})` }

// NEW (native FC, matches real provider behavior):
{ toolCall: { name: "web-search", args: { query: "AI news" } } }
```

- [ ] **Step 1.4: Fix tool-utils tests that test deleted functions**

In `packages/reasoning/tests/strategies/shared/tool-utils.test.ts`, find all `describe` blocks testing `parseToolRequest`, `parseBareToolCall`, `parseAllToolRequests`, `parseToolRequestGroup`. Comment them out with a `// REMOVED: text-path parsing deleted` note — they will be deleted in Task 4.

- [ ] **Step 1.5: Run full test suite again**

```bash
bun test 2>&1 | tail -20
```

Expected: All tests pass. If any still fail, read the specific error and update the test scenario to use `{ toolCall: ... }` or `{ text: "..." }` as appropriate.

- [ ] **Step 1.6: Commit**

```bash
git add packages/llm-provider/src/testing.ts packages/reasoning/tests/
git commit -m "fix(testing): enable native FC in test provider — supportsToolCalling: true

All tests now exercise the real native FC path instead of the text-based
ACTION: parsing fallback. Stream already emitted correct tool_use_start/
tool_use_delta events; this one flag change wires kernel-runner to create
a ToolCallResolver for test scenarios."
```

---

## Task 2: Remove Text-Path Branches from react-kernel.ts handleThinking

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts`

### Context

With `supportsToolCalling: true` in the test provider, `useNativeFC` is always `true` at runtime. The `else` branches of every `useNativeFC` conditional in `handleThinking` are now dead code. This task removes them, simplifying the function significantly.

**Branches to remove:**

| Location | Current | After |
|---|---|---|
| Lines ~368-372 | `if (!useNativeFC) { ... text prompt ... } else { ... FC prompt ... }` | Keep only FC prompt, no conditional |
| Lines ~386-403 | `const llmTools = useNativeFC ? ... : undefined` | Always build `llmTools` |
| Lines ~414-427 | `if (useNativeFC) { ... messages ... } else { single user message }` | Keep only FC messages branch |
| Line ~435 | `...(useNativeFC ? {} : { stopSequences: [...] })` | Delete entire ternary |
| Lines ~323, 361 | `useNativeFunctionCalling: useNativeFC` passed to context builders | Remove the parameter |
| Lines ~647-652 | `const textToolRequests = parseAllToolRequests(...)` fallback in FC resolver | Delete fallback block |

- [ ] **Step 2.1: Remove the thought prompt conditional**

Find the block (around line 368):
```typescript
if (!useNativeFC) {
  thoughtPrompt += "\n\nThink step-by-step, then either take ONE action or give your FINAL ANSWER:";
} else {
  thoughtPrompt += "\n\nThink step-by-step. Use available tools when needed, or provide your final answer directly.";
}
```

Replace with:
```typescript
thoughtPrompt += "\n\nThink step-by-step. Use available tools when needed, or provide your final answer directly.";
```

- [ ] **Step 2.2: Remove the llmTools conditional**

Find (around line 386):
```typescript
const llmTools = useNativeFC
  ? augmentedToolSchemas.map((ts) => ({
      name: ts.name,
      description: ts.description,
      inputSchema: { ... },
    }))
  : undefined;
```

Replace with (always build tools):
```typescript
const llmTools = augmentedToolSchemas.map((ts) => ({
  name: ts.name,
  description: ts.description,
  inputSchema: {
    type: "object" as const,
    properties: Object.fromEntries(
      (ts.parameters ?? []).map((p) => [
        p.name,
        { type: p.type ?? "string", description: p.description },
      ]),
    ),
    required: (ts.parameters ?? [])
      .filter((p) => p.required)
      .map((p) => p.name),
  } as Record<string, unknown>,
}));
```

- [ ] **Step 2.3: Remove the conversationMessages conditional**

Find (around line 414):
```typescript
let conversationMessages: LLMMessage[];
if (useNativeFC) {
  let compactedMessages = applyMessageWindow(state.messages, profile as ...);
  if (compactedMessages.length === 0) {
    compactedMessages = [{ role: "user" as const, content: thoughtPrompt }];
  }
  conversationMessages = (compactedMessages as readonly KernelMessage[]).map(toProviderMessage);
} else {
  conversationMessages = [{ role: "user", content: thoughtPrompt }];
}
```

Replace with (always use FC path):
```typescript
let compactedMessages = applyMessageWindow(state.messages, profile as import("../../context/context-profile.js").ContextProfile);
if (compactedMessages.length === 0) {
  compactedMessages = [{ role: "user" as const, content: thoughtPrompt }];
}
const conversationMessages: LLMMessage[] = (compactedMessages as readonly KernelMessage[]).map(toProviderMessage);
```

- [ ] **Step 2.4: Remove stopSequences conditional**

Find (around line 435 in the `llm.stream({...})` call):
```typescript
...(useNativeFC ? {} : { stopSequences: ["\nObservation:", "\nObservation: "] }),
```

Delete this entire line (native FC never needs stop sequences).

- [ ] **Step 2.5: Remove useNativeFunctionCalling from context builder calls**

Find the `buildStaticContext({...})` call. Remove the `useNativeFunctionCalling: useNativeFC` parameter:
```typescript
// BEFORE
const staticContext = buildStaticContext({
  task: input.task,
  profile,
  availableToolSchemas: augmentedToolSchemas,
  requiredTools: input.requiredTools,
  environmentContext: input.environmentContext,
  useNativeFunctionCalling: useNativeFC,
});

// AFTER
const staticContext = buildStaticContext({
  task: input.task,
  profile,
  availableToolSchemas: augmentedToolSchemas,
  requiredTools: input.requiredTools,
  environmentContext: input.environmentContext,
});
```

Similarly for `buildDynamicContext({...})`, remove the `useNativeFunctionCalling: useNativeFC` line.

- [ ] **Step 2.6: Remove useNativeFC variable declaration**

Find and delete:
```typescript
const useNativeFC = !!(input as ReActKernelInput).useNativeFunctionCalling && !!(input as ReActKernelInput).toolCallResolver;
```

- [ ] **Step 2.7: Remove text-parsing fallback inside FC resolver block**

Find the comment `// FC received a text-only response` in the `resolverResult._tag === "final_answer"` branch (around line 647). Remove the fallback check:

```typescript
// BEFORE
if (resolverResult._tag === "final_answer") {
  const textToolRequests = parseAllToolRequests(resolverResult.content);
  if (textToolRequests.length > 0) {
    // Skip FC — let the text-based ACTION parsing path below handle it
  } else {
    // Genuine final answer — check completion gaps first
    ...
  }
}

// AFTER
if (resolverResult._tag === "final_answer") {
  // Genuine final answer — check completion gaps first
  ...
}
```

Remove the `if (textToolRequests.length > 0) { }` wrapper entirely, keeping the inner "genuine final answer" block flat.

- [ ] **Step 2.8: Run reasoning tests**

```bash
bun test packages/reasoning/ 2>&1 | tail -20
```

Expected: All pass. Fix any TypeScript errors from the parameter removals.

- [ ] **Step 2.9: Commit**

```bash
git add packages/reasoning/src/strategies/shared/react-kernel.ts
git commit -m "refactor(kernel): remove text-path conditionals from handleThinking

useNativeFC is always true — delete the text-path branches for prompt
wording, conversationMessages, llmTools, stopSequences, and the
text-parsing fallback inside the FC resolver's final_answer branch."
```

---

## Task 3: Delete Text-Path Action Selection Block from handleThinking

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts`

### Context

The text-based ACTION: selection block starts after the FC resolver block ends (look for `// ── ACTION SELECTION (text-based path) ──`). This block contains `parseAllToolRequests(thought)`, deduplication logic, and the `parseBareToolCall` guard — all dead code now that `useNativeFC` is always true. The code never reaches this block at runtime.

- [ ] **Step 3.1: Delete the text-based action selection block**

Find the comment `// ── ACTION SELECTION (text-based path) ──` (around line 812). Delete from there through the end of the `BARE TOOL CALL GUARD` section (~line 848). This removes:
- `let allToolRequests = parseAllToolRequests(thought);`
- The deduplication `.find()` logic
- The `BARE TOOL CALL GUARD` block with `parseBareToolCall`

The next surviving line should be the `// ── TERMINATION ORACLE ──` comment.

- [ ] **Step 3.2: Delete text-path imports from react-kernel.ts**

Find the import line at the top of `react-kernel.ts` that imports `parseAllToolRequests`, `parseToolRequestGroup`, `parseBareToolCall`. Remove those names (keep `hasFinalAnswer`, `extractFinalAnswer`, `FINAL_ANSWER_RE` — they're still used in the FC path).

Before:
```typescript
import {
  parseAllToolRequests,
  parseToolRequestGroup,
  hasFinalAnswer,
  extractFinalAnswer,
  parseBareToolCall,
  // ...
} from "./tool-utils.js";
```

After:
```typescript
import {
  hasFinalAnswer,
  extractFinalAnswer,
  // ...
} from "./tool-utils.js";
```

- [ ] **Step 3.3: Delete text-path parallel/chain dispatch block**

Find `parseToolRequestGroup(thought)` (around line 927). This is another text-path block. Delete the entire `const toolRequestGroup = parseToolRequestGroup(thought)` block and any logic branching on `toolRequestGroup.type === "parallel"` or `"chain"`.

After deletion, the acting dispatch should only handle `pendingNativeToolCalls` from the FC path.

- [ ] **Step 3.4: Run full test suite**

```bash
bun test 2>&1 | tail -20
```

Expected: All pass. Any TypeScript error about unused variables in the import is expected — we'll clean up in Task 4.

- [ ] **Step 3.5: Commit**

```bash
git add packages/reasoning/src/strategies/shared/react-kernel.ts
git commit -m "refactor(kernel): delete text-based ACTION: selection block

Remove parseAllToolRequests, parseBareToolCall, parseToolRequestGroup
call sites from handleThinking and handleActing. The FC path handles
all tool call resolution via ToolCallResolver — text parsing is gone."
```

---

## Task 4: Delete Text-Parsing Functions from tool-utils.ts

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/tool-utils.ts`
- Modify: `packages/reasoning/tests/strategies/shared/tool-utils.test.ts`

### Context

With all call sites removed in Tasks 2-3, these functions are now unreferenced dead code. Delete them and their tests.

**Functions to delete:**
- `parseToolRequest` (and internal `parseToolRequestBase`)
- `parseBareToolCall`
- `parseAllToolRequests`
- `parseToolRequestGroup`

**Keep:** `hasFinalAnswer`, `extractFinalAnswer`, `FINAL_ANSWER_RE` — used in FC path and `termination-oracle.ts`.

- [ ] **Step 4.1: Delete text-parsing functions from tool-utils.ts**

Open `packages/reasoning/src/strategies/shared/tool-utils.ts`.

Delete the following complete function bodies (locate by their JSDoc comments):

1. `parseBareToolCall` — JSDoc: `"Parse a bare tool call (no ACTION: prefix) from text"`
2. `parseToolRequest` — JSDoc: `"Parse a single ACTION request from a thought string"`
3. `parseToolRequestBase` — private internal function called only by `parseToolRequest`
4. `parseAllToolRequests` — locate by `"Finds all ACTION: tool call requests in a thought string"`
5. `parseToolRequestGroup` — locate by `"Parse the tool request group type"`

Also delete any constants that only these functions used (e.g., `HYPHENATED_BUILTINS` if it's only used inside `parseToolRequestBase`).

- [ ] **Step 4.2: Delete corresponding tests**

Open `packages/reasoning/tests/strategies/shared/tool-utils.test.ts`.

Delete all `describe` or `it` blocks that test the removed functions:
- Any tests for `parseBareToolCall`
- Any tests for `parseToolRequest`
- Any tests for `parseAllToolRequests`
- Any tests for `parseToolRequestGroup`

Keep tests for: `hasFinalAnswer`, `extractFinalAnswer`, `compressToolResult`, `evaluateTransform`, `nextToolResultKey`, and any other surviving functions.

- [ ] **Step 4.3: Remove kernel-runner parseBareToolCall guard**

In `packages/reasoning/src/strategies/shared/kernel-runner.ts`, find the embedded tool call guard (around step 7 in the post-loop block):

```typescript
// ── 7. Embedded tool call guard ──────────────────────────────────────────
// After the loop ends with status "done", check if the output contains a
// bare tool call. If so, execute it and update state.
if (state.status === "done" && state.output) {
  const bareCall = parseBareToolCall(state.output.trim());
  if (bareCall) {
    // ... execute the embedded tool call
  }
}
```

Delete this entire block. On the FC path, tool calls are always resolved before the loop marks `done` — a bare text tool call in the output is an artifact of the old text path.

Also remove the `parseBareToolCall` import from the top of `kernel-runner.ts`.

- [ ] **Step 4.4: Run full test suite**

```bash
bun test 2>&1 | tail -20
```

Expected: All pass. TypeScript should report no unused imports.

- [ ] **Step 4.5: Commit**

```bash
git add packages/reasoning/src/strategies/shared/tool-utils.ts \
         packages/reasoning/src/strategies/shared/kernel-runner.ts \
         packages/reasoning/tests/strategies/shared/tool-utils.test.ts
git commit -m "refactor(tools): delete text-based ACTION: parsing functions

Remove parseToolRequest, parseBareToolCall, parseAllToolRequests,
parseToolRequestGroup and their tests. These regex-based parsing
functions existed for the text-based ReAct path which no longer
exists. hasFinalAnswer/extractFinalAnswer/FINAL_ANSWER_RE are kept
as they serve the FC path response cleanup."
```

---

## Task 5: Remove useNativeFunctionCalling Flag from All Interfaces

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts`
- Modify: `packages/reasoning/src/context/context-engine.ts`
- Modify: `packages/reasoning/src/strategies/shared/kernel-runner.ts`

### Context

With the text path gone, the `useNativeFunctionCalling` parameter is meaningless everywhere. Remove it from all type definitions and the `kernel-runner` auto-detect block (simplify to always create resolver unconditionally).

- [ ] **Step 5.1: Remove useNativeFunctionCalling from ReActKernelInput**

In `react-kernel.ts`, find `interface ReActKernelInput` (or equivalent). Delete:
```typescript
useNativeFunctionCalling?: boolean;
```

Also delete the passthrough at the end of the file (around line 1916):
```typescript
...(input.useNativeFunctionCalling != null ? { useNativeFunctionCalling: input.useNativeFunctionCalling } : {}),
```

- [ ] **Step 5.2: Remove useNativeFunctionCalling from context-engine interfaces**

In `packages/reasoning/src/context/context-engine.ts`, find `StaticContextInput` and `DynamicContextInput` interfaces. Delete `useNativeFunctionCalling?: boolean` from both.

- [ ] **Step 5.3: Remove useNativeFunctionCalling from buildStaticContext and buildDynamicContext signatures**

Find the exported function bodies for `buildStaticContext` and `buildDynamicContext`. Remove the `useNativeFunctionCalling` parameter from their destructured inputs and from any inner function calls they make to `buildToolReference` and `buildRules`.

- [ ] **Step 5.4: Simplify kernel-runner auto-detect block**

In `packages/reasoning/src/strategies/shared/kernel-runner.ts`, find the auto-detect block:
```typescript
let effectiveInput = input;
if (!(input as any).useNativeFunctionCalling && !(input as any).toolCallResolver) {
  const llmOpt = yield* Effect.serviceOption(LLMService);
  if (llmOpt._tag === "Some" && ...) {
    const caps = yield* llmOpt.value.capabilities()...;
    if (caps.supportsToolCalling) {
      try {
        const resolver = createToolCallResolver(caps);
        effectiveInput = { ...input, useNativeFunctionCalling: true, toolCallResolver: resolver } as KernelInput;
      } catch { /* fall back to text-based */ }
    }
  }
}
```

Replace with (always create resolver, no conditional):
```typescript
let effectiveInput = input;
if (!(input as any).toolCallResolver) {
  const llmOpt = yield* Effect.serviceOption(LLMService);
  if (llmOpt._tag === "Some" && typeof llmOpt.value.capabilities === "function") {
    const caps = yield* llmOpt.value.capabilities().pipe(
      Effect.catchAll(() => Effect.succeed(DEFAULT_CAPABILITIES)),
    );
    if (caps.supportsToolCalling) {
      const resolver = createToolCallResolver(caps);
      effectiveInput = { ...input, toolCallResolver: resolver } as KernelInput;
    }
  }
}
```

- [ ] **Step 5.5: Run TypeScript check**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
bun run build 2>&1 | grep -E "error TS|✓" | head -30
```

Expected: Zero TypeScript errors. If any remain, they are from the `useNativeFunctionCalling` field being referenced in a location not yet cleaned up — find and remove.

- [ ] **Step 5.6: Run full test suite**

```bash
bun test 2>&1 | tail -20
```

Expected: All pass.

- [ ] **Step 5.7: Commit**

```bash
git add packages/reasoning/src/strategies/shared/react-kernel.ts \
         packages/reasoning/src/context/context-engine.ts \
         packages/reasoning/src/strategies/shared/kernel-runner.ts
git commit -m "refactor(kernel): remove useNativeFunctionCalling flag

Flag was the last remnant of dual-path architecture. kernel-runner
now unconditionally creates a ToolCallResolver when the provider
supports tool calling. No interface carries the flag anymore."
```

---

## Task 6: Delete Dead Code from context-engine.ts

**Files:**
- Modify: `packages/reasoning/src/context/context-engine.ts`
- Modify: `packages/reasoning/src/context/index.ts` (remove re-export of buildContext)
- Modify: `packages/reasoning/tests/context/context-engine.test.ts` (delete buildContext tests)

### Context

After removing `useNativeFunctionCalling` from `buildStaticContext`/`buildDynamicContext`, two things remain:
1. `buildContext` (the old pre-split unified builder, ~89 LOC) — called by tests only, never production
2. `buildPinnedToolReference` (helper used only by `buildContext`)
3. The text-path branches inside `buildToolReference` (the `if (!useNativeFC)` → `else` where text is the `else` and FC is the `if`)
4. The text-path branches inside `buildRules`

- [ ] **Step 6.1: Remove useNativeFunctionCalling from buildToolReference signature**

Find `function buildToolReference(... useNativeFC = false)`. Remove the `useNativeFC` parameter. The function body previously had `if (useNativeFC) { ... FC ... } else { ... text ... }`. Keep only the FC branch body (the `if (useNativeFC)` branch), delete the `else` branch entirely.

After edit, `buildToolReference` always renders the compact FC-native format: tool names/descriptions, no "ACTION: tool_name({...})" instructions.

- [ ] **Step 6.2: Remove useNativeFunctionCalling from buildRules signature**

Find `function buildRules(... useNativeFC = false)`. Remove the `useNativeFC` parameter. For each tier conditional that has a text-path branch vs FC-path branch, keep only the FC-path text.

The text-path strings to delete look like:
```typescript
// DELETE these strings:
`Use ACTION: recall({"key": "_key"}) to read full data`
`use ACTION: recall({...}) ...)`
```

Keep:
```typescript
// KEEP these strings:
`Large results are stored automatically. Use recall(key) to retrieve them.`
```

- [ ] **Step 6.3: Delete buildContext function**

Find and delete the entire `buildContext` function body (the old unified context builder, ~89 LOC, starts with a JSDoc `"Build the full context string for an LLM prompt. Replaces 6 separate builders..."`).

- [ ] **Step 6.4: Delete buildPinnedToolReference function**

Find and delete `function buildPinnedToolReference(...)` — it is only called by `buildContext` which is now deleted.

- [ ] **Step 6.5: Remove buildContext from public exports**

In `packages/reasoning/src/context/index.ts`, remove `buildContext` from the re-export list:
```typescript
// DELETE this line:
export { buildContext } from "./context-engine.js";
```

Also remove from `packages/reasoning/src/index.ts` if re-exported there.

- [ ] **Step 6.6: Delete buildContext tests**

In `packages/reasoning/tests/context/context-engine.test.ts`, find and delete `describe` blocks that test `buildContext`. Keep tests for `scoreContextItem`, `allocateContextBudget`, and the other live exports.

- [ ] **Step 6.7: Run TypeScript build + full test suite**

```bash
bun run build 2>&1 | grep "error TS" | head -20
bun test 2>&1 | tail -20
```

Expected: Zero errors, all tests pass.

- [ ] **Step 6.8: Commit**

```bash
git add packages/reasoning/src/context/
git commit -m "refactor(context): delete dead text-path code from context-engine

Remove buildContext (89 LOC, unused in production), buildPinnedToolReference
(27 LOC, only called by buildContext), text-path ACTION: instruction branches
from buildToolReference (49 LOC) and buildRules (8 LOC). context-engine.ts
goes from 690 to ~506 LOC with zero behavioral change to the live FC path."
```

---

## Task 7: Final Cleanup and Verification

**Files:**
- Check: all packages for any remaining `useNativeFunctionCalling`, `parseAllToolRequests`, `parseBareToolCall`, `parseToolRequest` references

- [ ] **Step 7.1: Grep for leftover references**

```bash
grep -rn "useNativeFunctionCalling\|parseAllToolRequests\|parseBareToolCall\|parseToolRequestGroup\|parseToolRequest[^G]" \
  /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages \
  --include="*.ts" | grep -v ".test.ts" | grep -v "node_modules"
```

Expected: Zero results. If any appear, find the file and remove the reference.

- [ ] **Step 7.2: Run full build**

```bash
bun run build 2>&1 | grep -E "error TS|✓ Built" | head -30
```

Expected: 22 packages built with zero TypeScript errors.

- [ ] **Step 7.3: Run full test suite**

```bash
bun test 2>&1 | tail -10
```

Expected: ≥3,020 tests pass (original count). Count may decrease slightly if text-parsing tests were deleted in Tasks 4 and 6 — that's expected.

- [ ] **Step 7.4: Verify LOC reduction**

```bash
wc -l \
  /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/reasoning/src/strategies/shared/react-kernel.ts \
  /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/reasoning/src/strategies/shared/tool-utils.ts \
  /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/reasoning/src/context/context-engine.ts
```

Expected:
- `react-kernel.ts`: ~1,200–1,350 LOC (was 1,961) — ~600 LOC removed
- `tool-utils.ts`: ~500–550 LOC (was 714) — ~200 LOC removed
- `context-engine.ts`: ~500–510 LOC (was 690) — ~180 LOC removed

- [ ] **Step 7.5: Update .agents/MEMORY.md**

Update the Architecture Debt section. Mark these items as resolved:
- ✅ "Two code paths coexist (FC + text-based) — text only needed for test mocks"
- ✅ "buildDynamicContext/buildStaticContext still in codebase behind flag"
- ✅ "context-engine.ts has ~690 LOC mostly dead text-assembly functions"
- ✅ "Test mocks use supportsToolCalling: false — testing legacy path not real FC path"

Update test count to reflect current numbers.

- [ ] **Step 7.6: Final commit**

```bash
git add .agents/MEMORY.md
git commit -m "chore: update MEMORY.md — FC unification complete

Text-based ACTION: parsing path fully removed. All tests now exercise
native function calling. Dead code in react-kernel, tool-utils, and
context-engine deleted. Architecture is clean, single-path."
```

---

## Self-Review

**Spec coverage check:**
- ✅ `testing.ts:259` `supportsToolCalling: false` → `true` — Task 1
- ✅ Remove `useNativeFunctionCalling` from all interfaces — Tasks 2, 5
- ✅ Delete text-path conditionals from `handleThinking` — Task 2
- ✅ Delete text-path ACTION: selection block — Task 3
- ✅ Delete regex parsing functions from `tool-utils.ts` — Task 4
- ✅ Remove `parseBareToolCall` guard from `kernel-runner.ts` — Task 4
- ✅ Delete `buildContext` and `buildPinnedToolReference` — Task 6
- ✅ Delete text-path branches from `buildToolReference`/`buildRules` — Task 6
- ✅ Simplify `kernel-runner` auto-detect block — Task 5

**What's explicitly NOT in this plan (out of scope):**
- react-kernel.ts split (Plan B)
- Benchmark e5/c6 fixes (Plan C)
- Provider adapter 5 missing hooks (V1.1)

**Type consistency check:**
- `buildStaticContext` and `buildDynamicContext` — `useNativeFunctionCalling` parameter removed consistently in both function signature (Task 5) and call sites (Task 2)
- `ToolCallResolver` — not modified; `toolCallResolver` field on `KernelInput` stays (needed for resolver injection)
- `hasFinalAnswer` / `extractFinalAnswer` — kept in `tool-utils.ts`, imports in `react-kernel.ts` and `termination-oracle.ts` unchanged

**Placeholder check:** All steps contain real code or real commands. No TBD items.
