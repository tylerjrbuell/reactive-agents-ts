# Test Scenario Provider — Design Spec

**Date:** 2026-03-13
**Status:** Approved for implementation
**Scope:** `packages/llm-provider`, `packages/runtime`, all test files (~50)

---

## Problem

The current test LLM provider (`testing.ts`) always returns `stopReason: "end_turn"` with no `toolCalls`. This means the ReAct loop's native tool-calling path — the framework's most important behavior — is never exercised by any test. Every test using the test provider hits only the happy-path single-iteration flow. MaxIterationsError, loop detection, strategy switching, and tool retry logic have no meaningful test coverage.

---

## Solution

Replace `withTestResponses(Record<string, string>)` with `withTestScenario(TestTurn[])`. Turns are consumed sequentially, can return tool calls, and can inject errors. The last turn repeats when the scenario is exhausted so single-turn tests need no special handling.

This is a clean break — all ~50 existing test files are migrated.

---

## `TestTurn` Type

```typescript
export type TestTurn =
  | { text: string;     match?: string }
  | { toolCall:  ToolCallSpec;   match?: string }
  | { toolCalls: ToolCallSpec[]; match?: string }
  | { error: string;    match?: string }

export interface ToolCallSpec {
  name: string;
  args: Record<string, unknown>;
  id?: string;   // auto-generated "call-1", "call-2"... if omitted
}
```

`match` is an optional regex guard. If present, the turn is only consumed when the LLM input matches the pattern. If omitted, the turn is unconditional.

---

## Builder API

**Removed:**
```typescript
withTestResponses(responses: Record<string, string>): this
```

**Added:**
```typescript
withTestScenario(turns: TestTurn[]): this
```

### Usage examples

```typescript
// Single response (replaces all old withTestResponses({ ".*": "X" }) usage)
.withTestScenario([{ text: "Paris is the capital of France." }])

// Tool loop — two searches then final answer
.withTestScenario([
  { toolCall: { name: "web-search", args: { query: "AI news" } } },
  { toolCall: { name: "web-search", args: { query: "top story details" } } },
  { text: "Here is the summary..." },
])

// Parallel tool calls in one turn
.withTestScenario([
  { toolCalls: [
    { name: "web-search", args: { query: "news" } },
    { name: "calculator",  args: { expr: "2+2" } },
  ]},
  { text: "Combined result." },
])

// Error injection
.withTestScenario([
  { toolCall: { name: "web-search", args: { query: "test" } } },
  { error: "rate_limit_exceeded" },
])

// Pattern-guarded turns
.withTestScenario([
  { match: "search",    toolCall: { name: "web-search", args: { query: "test" } } },
  { match: "summarize", text: "Here is the summary" },
  { text: "Fallback response" },
])
```

---

## Internal Implementation

### `packages/llm-provider/src/testing.ts`

A mutable `callIndex` closure variable (safe because each `build()` creates a fresh service instance) tracks position in the scenario.

**Turn resolution algorithm:**
1. Starting from `callIndex`, find the first turn whose `match` regex (if any) matches the input
2. Advance `callIndex` to `min(matchedIndex + 1, scenario.length - 1)`
3. If no match found or scenario exhausted, repeat the last turn

**`CompletionResponse` mapping per turn type:**

| Turn | `content` | `stopReason` | `toolCalls` |
|------|-----------|--------------|-------------|
| `text` | the string | `"end_turn"` | `undefined` |
| `toolCall` | `""` | `"tool_use"` | `[{ id, name, input }]` |
| `toolCalls` | `""` | `"tool_use"` | array of `{ id, name, input }` |
| `error` | — | — | throws `LLMProviderError` |

Tool call `id` defaults to `"call-${callIndex}"` when not provided.

**Stream support:** `stream()` applies the same turn resolution and emits the appropriate `StreamEvent` sequence:
- `text` turn → `text_delta`, `content_complete`, `usage`
- `toolCall`/`toolCalls` turn → `tool_use_start`, `tool_use_delta` (JSON-stringified args), `content_complete`, `usage`
- `error` turn → `error` event

### Propagation changes (no logic changes)

| File | Change |
|------|--------|
| `packages/llm-provider/src/testing.ts` | Rewrite service to consume `TestTurn[]` |
| `packages/llm-provider/src/index.ts` | Export `TestTurn`, `ToolCallSpec` |
| `packages/llm-provider/src/runtime.ts` | `testResponses` param → `testScenario: TestTurn[]` |
| `packages/runtime/src/builder.ts` | `_testResponses` → `_testScenario`, rename method |
| `packages/runtime/src/types.ts` or `runtime.ts` | `testResponses` → `testScenario` in `RuntimeOptions` |
| ~50 test files | `withTestResponses({ ".*": "X" })` → `withTestScenario([{ text: "X" }])` |

---

## New Tests Unlocked

With this change, the following behavioral contract tests become straightforward to write:

```typescript
// Max iterations enforcement — real behavior
it("throws MaxIterationsError after N tool-call loops", async () => {
  const agent = await ReactiveAgents.create()
    .withMaxIterations(3)
    .withTestScenario([
      // Always returns a tool call → agent never gets a final answer
      { toolCall: { name: "web-search", args: { query: "loop" } } },
    ])
    .build();

  await expect(agent.run("search forever")).rejects.toThrow(MaxIterationsError);
});

// Tool actually invoked in loop
it("tool is called and result fed back into reasoning", async () => {
  const calls: string[] = [];
  const agent = await ReactiveAgents.create()
    .withTestScenario([
      { toolCall: { name: "calculator", args: { expr: "6*7" } } },
      { text: "The answer is 42." },
    ])
    .withTools({ tools: [{ definition: calculatorDef, handler: (args) => {
      calls.push(args.expr as string);
      return Effect.succeed({ result: 42 });
    }}]})
    .build();

  const result = await agent.run("What is 6 times 7?");
  expect(calls).toEqual(["6*7"]);
  expect(result.output).toContain("42");
});

// Error injection
it("withErrorHandler fires on LLM error", async () => {
  let handlerFired = false;
  const agent = await ReactiveAgents.create()
    .withTestScenario([{ error: "rate_limit_exceeded" }])
    .withErrorHandler(() => { handlerFired = true; })
    .build();

  await expect(agent.run("test")).rejects.toThrow();
  expect(handlerFired).toBe(true);
});
```

---

## Migration Pattern

All occurrences of `withTestResponses({...})` follow one of two patterns:

**Pattern 1 — catch-all (most common):**
```typescript
// Before
.withTestResponses({ ".*": "Some response" })
// After
.withTestScenario([{ text: "Some response" }])
```

**Pattern 2 — multiple patterns:**
```typescript
// Before
.withTestResponses({ "search": "results here", ".*": "default" })
// After
.withTestScenario([
  { match: "search", text: "results here" },
  { text: "default" },
])
```

Migration is mechanical and can be done with targeted search-and-replace plus manual review of multi-pattern cases.

---

## Documentation Updates

After implementation:
- Update `cookbook/testing-agents.md` — replace all `withTestResponses` examples, add tool-loop and error-injection recipes
- Update `withTestScenario` JSDoc in `builder.ts` — document turn resolution algorithm, exhaustion behavior, match guard semantics
- Update `CLAUDE.md` builder API section

---

## Success Criteria

1. All ~50 existing tests migrated and passing
2. `TestTurn` and `ToolCallSpec` exported from `@reactive-agents/llm-provider`
3. `tool_use` stop reason and `toolCalls` array correctly populated in `CompletionResponse`
4. Stream emits `tool_use_start` / `tool_use_delta` events for tool-call turns
5. Error turns throw `LLMProviderError` with the provided message
6. New behavioral tests pass: MaxIterationsError, tool invocation, error handler, loop detection
