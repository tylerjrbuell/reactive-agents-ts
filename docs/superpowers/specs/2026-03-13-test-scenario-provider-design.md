# Test Scenario Provider — Design Spec

**Date:** 2026-03-13
**Status:** Approved for implementation
**Scope:** `packages/llm-provider`, `packages/runtime`, all test files (~50)

---

## Problem

The current test LLM provider (`testing.ts`) always returns `stopReason: "end_turn"` with no `toolCalls`. This means the ReAct loop's native tool-calling path — the framework's most important behavior — is never exercised by any test. Every test using the test provider hits only the happy-path single-iteration flow. MaxIterationsError, loop detection, strategy switching, and tool retry logic have no meaningful test coverage.

---

## Solution

Replace `withTestResponses(Record<string, string>)` with `withTestScenario(TestTurn[])`. Turns are consumed sequentially, can return tool calls, structured JSON, or errors. The last turn repeats when the scenario is exhausted so single-turn tests need no special handling.

This is a clean break — all ~50 existing test files are migrated.

---

## `TestTurn` Type

```typescript
export type TestTurn =
  | { text: string;     match?: string }   // → stopReason: "end_turn", plain text
  | { json: unknown;    match?: string }   // → stopReason: "end_turn", for completeStructured
  | { toolCall:  ToolCallSpec;   match?: string }   // single tool  → stopReason: "tool_use"
  | { toolCalls: ToolCallSpec[]; match?: string }   // parallel tools → stopReason: "tool_use"
  | { error: string;    match?: string }   // → throws LLMProviderError

export interface ToolCallSpec {
  name: string;
  args: Record<string, unknown>;   // mapped to `input` in CompletionResponse.toolCalls
  id?: string;                     // auto-generated "call-<matchedIndex>" if omitted
}
```

**`args` → `input` mapping:** When building a `CompletionResponse`, each `ToolCallSpec.args` is placed in the `toolCalls[n].input` field to match the `ToolCall` interface (`{ id: string; name: string; input: unknown }`).

**`json` turn:** Used by tests that call `completeStructured`. The value is returned as-is from `completeStructured`. When encountered during a plain `complete` call, the value is `JSON.stringify`-ed and returned as the `content` string.

---

## Turn Resolution Algorithm

Turns are consumed sequentially. On each LLM call:

1. Starting from `callIndex`, scan forward through the scenario array
2. For each candidate turn: if it has no `match`, it matches; if it has `match`, test `new RegExp(turn.match, "i").test(input)`
3. The **first matching turn** is consumed: `callIndex` advances to `matchedIndex + 1`, clamped to `scenario.length - 1`
4. If no turn from `callIndex` onward matches, the last turn in the scenario is returned (fallback)
5. Once `callIndex` reaches `scenario.length - 1`, that last turn repeats for all subsequent calls

**`id` generation:** Tool call `id` is `turn.toolCall.id ?? "call-${matchedIndex}"` where `matchedIndex` is the index of the turn that was actually consumed (not the `callIndex` at entry).

**Match guards on `error` turns:** `match` works identically for all turn variants including `error`. An `{ error: "...", match: "payment" }` turn is skipped if the input does not match `"payment"` — the scan continues to the next turn.

**Design intent:** Scenario authors should end their scenarios with an unconditional turn (no `match`) as a catch-all. Match-guarded turns are consumed in the order they appear; once passed, they are not revisited.

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

`withTestScenario` automatically sets the provider to `"test"`, overriding any prior `.withProvider()` call. This prevents silent misconfiguration where a developer forgets `.withProvider("test")`.

### Usage examples

```typescript
// Single response — replaces withTestResponses({ ".*": "X" })
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

// Structured output (for plan-execute-reflect and adaptive strategies)
.withTestScenario([
  { json: { plan: ["step 1", "step 2"], confidence: 0.9 } },
  { text: "Execution complete." },
])

// Error injection
.withTestScenario([
  { toolCall: { name: "web-search", args: { query: "test" } } },
  { error: "rate_limit_exceeded" },
])

// Pattern-guarded turns with unconditional fallback
.withTestScenario([
  { match: "search",    toolCall: { name: "web-search", args: { query: "test" } } },
  { match: "summarize", text: "Here is the summary" },
  { text: "Fallback response" },   // unconditional — catches everything else
])
```

---

## Internal Implementation

### `packages/llm-provider/src/testing.ts`

A mutable `callIndex` closure variable (safe because each `build()` creates a fresh service instance) tracks position in the scenario.

**`CompletionResponse` mapping per turn type:**

| Turn | `content` | `stopReason` | `toolCalls` |
|------|-----------|--------------|-------------|
| `text` | the string | `"end_turn"` | `undefined` |
| `json` | `JSON.stringify(value)` | `"end_turn"` | `undefined` |
| `toolCall` | `""` | `"tool_use"` | `[{ id: "call-N", name, input: args }]` |
| `toolCalls` | `""` | `"tool_use"` | one entry per spec, in order |
| `error` | — | — | throws `LLMProviderError({ message: turn.error })` |

**`completeStructured` behavior:** Uses the same scenario sequence and turn resolution. For `json` turns, returns the value directly as the parsed result. For `text` turns, attempts `JSON.parse(turn.text)` and returns the result. All other turn types fall back to returning `{}` (empty object) to avoid test crashes — the test author should use `json` turns when testing structured-output paths.

**`stream()` event sequences:**

- `text` turn: `text_delta(content)` → `content_complete(content)` → `usage`
- `json` turn: `text_delta(JSON.stringify(value))` → `content_complete(...)` → `usage`
- `toolCall` turn (single): `tool_use_start(id, name)` → `tool_use_delta(JSON.stringify(args))` → `content_complete("")` → `usage`
- `toolCalls` turn (N tools): for each tool in order: `tool_use_start(id, name)` → `tool_use_delta(JSON.stringify(args))`; then `content_complete("")` → `usage` once after all tools
- `error` turn: `error(message)` event

**`content_complete` for tool-call turns** carries `content: ""` (empty string) — real providers also emit an empty content string when the response is tool-only. Stream consumers that check `content_complete.content` for empty string before displaying should receive `""`.

### Propagation changes (no logic changes)

| File | Change |
|------|--------|
| `packages/llm-provider/src/testing.ts` | Rewrite service to consume `TestTurn[]` |
| `packages/llm-provider/src/index.ts` | Export `TestTurn`, `ToolCallSpec` |
| `packages/llm-provider/src/runtime.ts` | `testResponses` param → `testScenario: TestTurn[]` |
| `packages/runtime/src/builder.ts` | `_testResponses` → `_testScenario`; rename method; auto-set provider to `"test"` |
| `packages/runtime/src/runtime.ts` | `testResponses` → `testScenario` in `RuntimeOptions` |
| ~50 test files | `withTestResponses({ ".*": "X" })` → `withTestScenario([{ text: "X" }])` |

---

## New Tests Unlocked

```typescript
// Max iterations enforcement — real behavior, no workarounds
it("throws MaxIterationsError after N tool-call loops", async () => {
  const agent = await ReactiveAgents.create()
    .withMaxIterations(3)
    .withTestScenario([
      { toolCall: { name: "web-search", args: { query: "loop" } } },
      // last turn repeats → agent loops forever until max iterations
    ])
    .withTools({ tools: [webSearchDef] })
    .build();

  await expect(agent.run("search forever")).rejects.toThrow();
});

// Tool actually invoked in loop
it("tool is called and result fed back into reasoning", async () => {
  const calls: string[] = [];
  const agent = await ReactiveAgents.create()
    .withTestScenario([
      { toolCall: { name: "calculator", args: { expr: "6*7" } } },
      { text: "The answer is 42." },
    ])
    .withTools({ tools: [{
      definition: calculatorDef,
      handler: (args) => { calls.push(args.expr as string); return Effect.succeed({ result: 42 }); }
    }]})
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

**Pattern 1 — catch-all (most common, ~45 of ~50 tests):**
```typescript
// Before
.withTestResponses({ ".*": "Some response" })
// After
.withTestScenario([{ text: "Some response" }])
```

**Pattern 2 — multiple patterns (~5 tests):**
```typescript
// Before
.withTestResponses({ "search": "results here", ".*": "default" })
// After
.withTestScenario([
  { match: "search", text: "results here" },
  { text: "default" },
])
```

---

## Documentation Updates

After implementation:
- Update `cookbook/testing-agents.md` — replace all `withTestResponses` examples, add tool-loop and error-injection recipes
- Update `withTestScenario` JSDoc in `builder.ts` — document turn resolution algorithm, exhaustion/repeat behavior, match guard semantics, `json` turn for structured output
- Update `CLAUDE.md` builder API section

---

## Success Criteria

1. All ~50 existing tests migrated and passing with zero new failures
2. `TestTurn` and `ToolCallSpec` exported from `@reactive-agents/llm-provider`
3. `tool_use` stop reason and `toolCalls` array correctly populated in `CompletionResponse` for `toolCall`/`toolCalls` turns
4. Stream emits correct event sequences: for a single-tool turn — one `tool_use_start` + one `tool_use_delta` + `content_complete("")` + `usage`; for an N-tool turn — N `(tool_use_start, tool_use_delta)` pairs + `content_complete("")` + `usage`
5. `error` turns throw `LLMProviderError` with the provided message string
6. `json` turns work correctly through `completeStructured` — value returned as parsed result
7. `withTestScenario` auto-sets provider to `"test"`, overriding any prior `.withProvider()` call
8. New behavioral tests pass: MaxIterationsError enforcement, tool invocation in loop, error handler firing, loop detection triggering after N repeated tool calls
