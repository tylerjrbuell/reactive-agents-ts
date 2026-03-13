# Test Scenario Provider Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `withTestResponses(Record<string,string>)` with `withTestScenario(TestTurn[])` so tests can simulate multi-turn tool-calling loops, MaxIterationsError, and LLM error injection.

**Architecture:** Rewrite `testing.ts` to consume a `TestTurn[]` scenario array with a mutable call-index cursor. Each turn resolves to a `CompletionResponse` with real `toolCalls` / `stopReason: "tool_use"` values. Propagate the type through runtime → builder, migrate all ~50 test files, then write the new behavioral tests that were previously impossible.

**Tech Stack:** TypeScript, Effect-TS (Layer, Stream, Effect.gen), bun:test

**Spec:** `docs/superpowers/specs/2026-03-13-test-scenario-provider-design.md`

---

## Chunk 1: Core Types + `testing.ts` Rewrite

### Task 1: Rewrite `testing.ts` and export new types

**Files:**
- Rewrite: `packages/llm-provider/src/testing.ts`
- Modify: `packages/llm-provider/src/index.ts`

The existing `testing.ts` has these exact import paths and signatures — preserve them all:
- Imports `LLMService` from `"./llm-service.js"` (the Effect Context.Tag)
- Imports `CompletionResponse`, `StreamEvent`, `LLMMessage` from `"./types.js"`
- Imports `LLMErrors` from `"./errors.js"`
- `TestLLMService(scenario)` returns `typeof LLMService.Service` (the service object type)
- `TestLLMServiceLayer(scenario)` wraps with `Layer.succeed(LLMService, LLMService.of(...))`
- `complete(request)` uses `Effect.gen(function* () { ... })`
- `stream(request)` returns `Effect.succeed(Stream.make(...) as Stream.Stream<StreamEvent, LLMErrors>)`
- `completeStructured(request)` — single arg, schema lives at `request.outputSchema`
- `countTokens(messages: readonly LLMMessage[])` — NOT a request object
- `getModelConfig()` returns `{ provider: "anthropic" as const, model: "test-model" }`
- `getStructuredOutputCapabilities()` returns `{ nativeJsonMode: true, jsonSchemaEnforcement: false, prefillSupport: false, grammarConstraints: false }`
- `TokenUsage` uses field `estimatedCost` (not `estimatedCostUsd`)

- [ ] **Step 1: Write the new `testing.ts`**

Replace the entire file with the following (all signatures match the existing codebase):

```typescript
import { Effect, Layer, Stream, Schema } from "effect";
import { LLMService } from "./llm-service.js";
import type {
  CompletionResponse,
  StreamEvent,
  LLMMessage,
} from "./types.js";
import type { LLMErrors } from "./errors.js";

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface ToolCallSpec {
  name: string;
  args: Record<string, unknown>;
  id?: string; // auto-generated "call-<matchedIndex>-<i>" if omitted
}

export type TestTurn =
  | { text: string; match?: string }
  | { json: unknown; match?: string }
  | { toolCall: ToolCallSpec; match?: string }
  | { toolCalls: ToolCallSpec[]; match?: string }
  | { error: string; match?: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fakeUsage(inputLen: number, outputLen: number) {
  return {
    inputTokens: Math.ceil(inputLen / 4),
    outputTokens: Math.ceil(outputLen / 4),
    totalTokens: Math.ceil(inputLen / 4) + Math.ceil(outputLen / 4),
    estimatedCost: 0,
  };
}

function extractSearchText(
  messages: readonly LLMMessage[],
  request: { systemPrompt?: string },
): string {
  const lastMessage = messages[messages.length - 1];
  const content =
    lastMessage && typeof lastMessage.content === "string"
      ? lastMessage.content
      : "";
  const systemPrompt =
    typeof (request as any).systemPrompt === "string"
      ? (request as any).systemPrompt
      : "";
  return `${content} ${systemPrompt}`.trim();
}

function resolveTurn(
  scenario: TestTurn[],
  callIndex: { value: number },
  searchText: string,
): { turn: TestTurn; matchedIndex: number } {
  for (let i = callIndex.value; i < scenario.length; i++) {
    const turn = scenario[i];
    const guard = turn.match;
    if (!guard || new RegExp(guard, "i").test(searchText)) {
      callIndex.value = Math.min(i + 1, scenario.length - 1);
      return { turn, matchedIndex: i };
    }
  }
  // Nothing matched from callIndex onward — repeat last turn
  return { turn: scenario[scenario.length - 1], matchedIndex: scenario.length - 1 };
}

function buildToolCalls(
  specs: ToolCallSpec[],
  matchedIndex: number,
): Array<{ id: string; name: string; input: unknown }> {
  return specs.map((spec, i) => ({
    id: spec.id ?? `call-${matchedIndex}-${i}`,
    name: spec.name,
    input: spec.args,
  }));
}

// ─── Service Factory ──────────────────────────────────────────────────────────

export const TestLLMService = (
  scenario: TestTurn[],
): typeof LLMService.Service => {
  // Mutable cursor — safe because each build() creates a fresh Layer instance
  const callIndex = { value: 0 };

  return {
    complete: (request) =>
      Effect.gen(function* () {
        const searchText = extractSearchText(request.messages, request as any);
        const { turn, matchedIndex } = resolveTurn(scenario, callIndex, searchText);

        if ("error" in turn) {
          throw new Error(turn.error);
        }

        if ("toolCall" in turn) {
          return {
            content: "",
            stopReason: "tool_use" as const,
            usage: fakeUsage(searchText.length, 0),
            model: "test-model",
            toolCalls: buildToolCalls([turn.toolCall], matchedIndex),
          } satisfies CompletionResponse;
        }

        if ("toolCalls" in turn) {
          return {
            content: "",
            stopReason: "tool_use" as const,
            usage: fakeUsage(searchText.length, 0),
            model: "test-model",
            toolCalls: buildToolCalls(turn.toolCalls, matchedIndex),
          } satisfies CompletionResponse;
        }

        const content = "json" in turn ? JSON.stringify(turn.json) : turn.text;
        return {
          content,
          stopReason: "end_turn" as const,
          usage: fakeUsage(searchText.length, content.length),
          model: "test-model",
        } satisfies CompletionResponse;
      }),

    stream: (request) => {
      const searchText = extractSearchText(request.messages, request as any);
      const { turn, matchedIndex } = resolveTurn(scenario, callIndex, searchText);

      if ("error" in turn) {
        return Effect.succeed(
          Stream.make(
            { type: "error" as const, error: turn.error } satisfies StreamEvent,
          ) as Stream.Stream<StreamEvent, LLMErrors>,
        );
      }

      const specs =
        "toolCall" in turn
          ? [turn.toolCall]
          : "toolCalls" in turn
            ? turn.toolCalls
            : null;

      if (specs) {
        const events: StreamEvent[] = [
          ...specs.flatMap((spec, i): StreamEvent[] => [
            {
              type: "tool_use_start" as const,
              id: spec.id ?? `call-${matchedIndex}-${i}`,
              name: spec.name,
            },
            {
              type: "tool_use_delta" as const,
              input: JSON.stringify(spec.args),
            },
          ]),
          { type: "content_complete" as const, content: "" },
          { type: "usage" as const, usage: fakeUsage(searchText.length, 0) },
        ];
        return Effect.succeed(
          Stream.fromIterable(events) as Stream.Stream<StreamEvent, LLMErrors>,
        );
      }

      const content = "json" in turn ? JSON.stringify(turn.json) : turn.text;
      const inputTokens = Math.ceil(searchText.length / 4);
      const outputTokens = Math.ceil(content.length / 4);

      return Effect.succeed(
        Stream.make(
          { type: "text_delta" as const, text: content } satisfies StreamEvent,
          { type: "content_complete" as const, content } satisfies StreamEvent,
          {
            type: "usage" as const,
            usage: {
              inputTokens,
              outputTokens,
              totalTokens: inputTokens + outputTokens,
              estimatedCost: 0,
            },
          } satisfies StreamEvent,
        ) as Stream.Stream<StreamEvent, LLMErrors>,
      );
    },

    completeStructured: (request) =>
      Effect.gen(function* () {
        const searchText = extractSearchText(request.messages, request as any);
        const { turn } = resolveTurn(scenario, callIndex, searchText);

        if ("error" in turn) {
          throw new Error(turn.error);
        }

        if ("json" in turn) {
          // Return json value directly — bypass schema decoding for test control
          return turn.json as any;
        }

        // text turn — try JSON.parse then decode against schema
        const responseContent = "text" in turn ? turn.text : "{}";
        const parsed = JSON.parse(responseContent);
        return Schema.decodeUnknownSync(request.outputSchema)(parsed);
      }),

    embed: (texts) =>
      Effect.succeed(
        texts.map(() => new Array(768).fill(0).map(() => Math.random())),
      ),

    countTokens: (messages) =>
      Effect.succeed(
        messages.reduce(
          (sum, m) =>
            sum +
            (typeof m.content === "string"
              ? Math.ceil(m.content.length / 4)
              : 100),
          0,
        ),
      ),

    getModelConfig: () =>
      Effect.succeed({
        provider: "anthropic" as const,
        model: "test-model",
      }),

    getStructuredOutputCapabilities: () =>
      Effect.succeed({
        nativeJsonMode: true,
        jsonSchemaEnforcement: false,
        prefillSupport: false,
        grammarConstraints: false,
      }),
  };
};

/**
 * Create a test Layer for LLMService with a deterministic turn scenario.
 * Turns are consumed sequentially; the last turn repeats when exhausted.
 */
export const TestLLMServiceLayer = (scenario: TestTurn[] = [{ text: "" }]) =>
  Layer.succeed(LLMService, LLMService.of(TestLLMService(scenario)));
```

- [ ] **Step 2: Export new types from `packages/llm-provider/src/index.ts`**

Find the existing testing export line and update it:
```typescript
// Before:
export { TestLLMService, TestLLMServiceLayer } from "./testing.js";

// After:
export { TestLLMService, TestLLMServiceLayer, type TestTurn, type ToolCallSpec } from "./testing.js";
```

- [ ] **Step 3: Run llm-provider package tests to confirm it compiles**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
bun test packages/llm-provider/ 2>&1 | tail -6
```

Expected: same pass count as before, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add packages/llm-provider/src/testing.ts packages/llm-provider/src/index.ts
git commit -m "feat(llm-provider): replace TestLLMServiceLayer with TestTurn scenario system"
```

---

## Chunk 2: Builder + Runtime Propagation

### Task 2: Wire `TestTurn[]` through runtime and builder

**Files:**
- Modify: `packages/llm-provider/src/runtime.ts`
- Modify: `packages/runtime/src/runtime.ts`
- Modify: `packages/runtime/src/builder.ts`

- [ ] **Step 1: Update `packages/llm-provider/src/runtime.ts`**

Add import at top:
```typescript
import type { TestTurn } from "./testing.js";
```

Find `createLLMProviderLayer` — change the `testResponses` parameter to `testScenario`:
```typescript
// Find and change the parameter name and type (second positional arg):
// Before: testResponses?: Record<string, string>
// After:  testScenario?: TestTurn[]

// Find where TestLLMServiceLayer is called with testResponses and change:
// Before: TestLLMServiceLayer(testResponses ?? {})
// After:  TestLLMServiceLayer(testScenario ?? [{ text: "" }])
```

**Important:** Preserve all other positional arguments to `createLLMProviderLayer` exactly. Only rename the second parameter.

- [ ] **Step 2: Update `packages/runtime/src/runtime.ts`**

Add import near top (find where `@reactive-agents/llm-provider` is imported):
```typescript
import type { TestTurn } from "@reactive-agents/llm-provider";
```

Find `testResponses?: Record<string, string>` in `RuntimeOptions` and change:
```typescript
// Before:
testResponses?: Record<string, string>;

// After:
testScenario?: TestTurn[];
```

Find the `createLLMProviderLayer(options.provider ?? "test", options.testResponses, ...)` call and change:
```typescript
// Change second arg from options.testResponses to options.testScenario
createLLMProviderLayer(options.provider ?? "test", options.testScenario, ...)
// Keep all remaining args unchanged
```

- [ ] **Step 3: Update `packages/runtime/src/builder.ts`**

Add import near top (find existing `@reactive-agents/llm-provider` import or add one):
```typescript
import type { TestTurn } from "@reactive-agents/llm-provider";
```

**3a. Rename private field** (find `private _testResponses`):
```typescript
// Before:
private _testResponses?: Record<string, string>;

// After:
private _testScenario?: TestTurn[];
```

**3b. Replace method** (find and replace entire `withTestResponses` method):
```typescript
/**
 * Configure a deterministic multi-turn scenario for the test LLM provider.
 *
 * Turns are consumed sequentially. Each turn produces one LLM response:
 * - `{ text: "..." }` — plain text, stopReason: "end_turn"
 * - `{ toolCall: { name, args } }` — single tool call, stopReason: "tool_use"
 * - `{ toolCalls: [...] }` — parallel tool calls, stopReason: "tool_use"
 * - `{ json: value }` — structured output for completeStructured(), stopReason: "end_turn"
 * - `{ error: "message" }` — throws with that message
 *
 * Add `match?: string` to any turn to guard it with a regex — the turn is only
 * consumed when the LLM input matches the pattern. End scenarios with an
 * unconditional turn as catch-all. The last turn repeats when exhausted.
 *
 * Automatically sets the provider to "test".
 *
 * @example
 * ```typescript
 * // Simple — replaces withTestResponses({ ".*": "X" })
 * .withTestScenario([{ text: "Paris is the capital of France." }])
 *
 * // Tool loop then final answer
 * .withTestScenario([
 *   { toolCall: { name: "web-search", args: { query: "AI news" } } },
 *   { toolCall: { name: "web-search", args: { query: "details" } } },
 *   { text: "Here is the summary." },
 * ])
 *
 * // Error injection
 * .withTestScenario([{ error: "rate_limit_exceeded" }])
 * ```
 */
withTestScenario(turns: TestTurn[]): this {
  this._testScenario = turns;
  this._provider = "test";
  return this;
}
```

**3c. Update the createRuntime call** (find `testResponses: this._testResponses`):
```typescript
// Before:
testResponses: this._testResponses,

// After:
testScenario: this._testScenario,
```

- [ ] **Step 4: Type-check only (do NOT run full test suite — test files still reference withTestResponses)**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
bun build packages/runtime 2>&1 | tail -10
```

If `bun build` is not available for individual packages, check `package.json` in `packages/runtime` for the build command. TypeScript errors from test files are expected at this stage — only check that `src/` compiles clean.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-provider/src/runtime.ts packages/runtime/src/runtime.ts packages/runtime/src/builder.ts
git commit -m "feat(runtime): wire TestTurn scenario through RuntimeOptions and builder"
```

---

## Chunk 3: Test File Migration

### Task 3: Migrate all test files from `withTestResponses` to `withTestScenario`

- [ ] **Step 1: Find all files that need migration**

```bash
grep -rl "withTestResponses" /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/ /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/apps/
```

- [ ] **Step 2: For each file, apply the migration**

Read each file. Apply the correct pattern:

**Pattern 1 — single catch-all (most common ~45 files):**
```typescript
// Before:
.withProvider("test")
.withTestResponses({ ".*": "Some response text" })

// After (withTestScenario auto-sets provider):
.withTestScenario([{ text: "Some response text" }])
```

**Pattern 1b — withTestResponses without explicit withProvider:**
```typescript
// Before:
.withTestResponses({ ".*": "Some response text" })

// After:
.withTestScenario([{ text: "Some response text" }])
```

**Pattern 2 — multiple keyed patterns (~5 files):**
```typescript
// Before:
.withTestResponses({ "search": "results here", ".*": "default response" })

// After:
.withTestScenario([
  { match: "search", text: "results here" },
  { text: "default response" },
])
```

**When you see `"default"` as a key:** treat it the same as `".*"` — it was used as a fallback key in some files. Map it to an unconditional `{ text: "..." }` turn (last in the array).

- [ ] **Step 3: Run the full test suite**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts && bun test 2>&1 | tail -8
```

Expected: ≥2000 pass, 30 skip, 0 fail. If any test fails due to migration (not pre-existing), inspect and fix — likely a multi-pattern case that needs reordering.

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "refactor(tests): migrate all withTestResponses → withTestScenario"
```

---

## Chunk 4: New Behavioral Tests

### Task 4a: Unit tests for `TestTurn` resolution

**File:** `packages/runtime/tests/test-scenario-provider.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer, LLMService } from "@reactive-agents/llm-provider";
import type { TestTurn } from "@reactive-agents/llm-provider";

const makeRequest = (content: string) => ({
  messages: [{ role: "user" as const, content }],
  model: "test-model",
  maxTokens: 1000,
});

async function callComplete(scenario: TestTurn[], input: string) {
  const layer = TestLLMServiceLayer(scenario);
  return Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      return yield* llm.complete(makeRequest(input));
    }).pipe(Effect.provide(layer)),
  );
}

describe("TestLLMServiceLayer — turn resolution", () => {
  it("single text turn returns text with stopReason end_turn", async () => {
    const result = await callComplete([{ text: "hello world" }], "any input");
    expect(result.content).toBe("hello world");
    expect(result.stopReason).toBe("end_turn");
    expect(result.toolCalls).toBeUndefined();
  });

  it("toolCall turn returns stopReason tool_use with toolCalls populated", async () => {
    const result = await callComplete(
      [{ toolCall: { name: "web-search", args: { query: "test" } } }],
      "any input",
    );
    expect(result.stopReason).toBe("tool_use");
    expect(result.content).toBe("");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("web-search");
    expect(result.toolCalls![0].input).toEqual({ query: "test" });
  });

  it("toolCalls turn returns multiple tool calls", async () => {
    const result = await callComplete(
      [
        {
          toolCalls: [
            { name: "web-search", args: { query: "a" } },
            { name: "calculator", args: { expr: "1+1" } },
          ],
        },
      ],
      "any input",
    );
    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls![0].name).toBe("web-search");
    expect(result.toolCalls![1].name).toBe("calculator");
  });

  it("turns are consumed sequentially across multiple calls", async () => {
    const layer = TestLLMServiceLayer([
      { text: "first" },
      { text: "second" },
      { text: "third" },
    ]);
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const r1 = yield* llm.complete(makeRequest("a"));
        const r2 = yield* llm.complete(makeRequest("b"));
        const r3 = yield* llm.complete(makeRequest("c"));
        return [r1.content, r2.content, r3.content];
      }).pipe(Effect.provide(layer)),
    );
    expect(results).toEqual(["first", "second", "third"]);
  });

  it("last turn repeats when scenario is exhausted", async () => {
    const layer = TestLLMServiceLayer([{ text: "only" }]);
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const r1 = yield* llm.complete(makeRequest("a"));
        const r2 = yield* llm.complete(makeRequest("b"));
        const r3 = yield* llm.complete(makeRequest("c"));
        return [r1.content, r2.content, r3.content];
      }).pipe(Effect.provide(layer)),
    );
    expect(results).toEqual(["only", "only", "only"]);
  });

  it("match guard skips non-matching turns and hits fallback", async () => {
    const layer = TestLLMServiceLayer([
      { match: "search", text: "search result" },
      { text: "fallback" },
    ]);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete(makeRequest("summarize this"));
      }).pipe(Effect.provide(layer)),
    );
    expect(result.content).toBe("fallback");
  });

  it("match guard consumes matching turn", async () => {
    const layer = TestLLMServiceLayer([
      { match: "search", text: "search result" },
      { text: "fallback" },
    ]);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete(makeRequest("please search for news"));
      }).pipe(Effect.provide(layer)),
    );
    expect(result.content).toBe("search result");
  });

  it("tool call id is auto-generated when not specified", async () => {
    const result = await callComplete(
      [{ toolCall: { name: "calculator", args: {} } }],
      "any",
    );
    expect(result.toolCalls![0].id).toMatch(/^call-/);
  });

  it("tool call id uses provided value", async () => {
    const result = await callComplete(
      [{ toolCall: { name: "calculator", args: {}, id: "my-custom-id" } }],
      "any",
    );
    expect(result.toolCalls![0].id).toBe("my-custom-id");
  });

  it("error turn throws", async () => {
    let threw = false;
    try {
      await callComplete([{ error: "rate_limit_exceeded" }], "any");
    } catch (e) {
      threw = true;
      expect((e as Error).message).toContain("rate_limit_exceeded");
    }
    expect(threw).toBe(true);
  });

  it("json turn returns stringified content from complete()", async () => {
    const result = await callComplete(
      [{ json: { plan: ["step1", "step2"] } }],
      "any",
    );
    expect(result.stopReason).toBe("end_turn");
    expect(JSON.parse(result.content)).toEqual({ plan: ["step1", "step2"] });
  });

  it("json turn returns value directly from completeStructured()", async () => {
    const layer = TestLLMServiceLayer([{ json: { answer: 42 } }]);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        // outputSchema is required by the interface but bypassed for json turns
        return yield* llm.completeStructured({
          ...makeRequest("any"),
          outputSchema: Schema.Unknown,
        } as any);
      }).pipe(Effect.provide(layer)),
    );
    expect(result).toEqual({ answer: 42 });
  });
});
```

- [ ] **Step 2: Run and verify**

```bash
bun test packages/runtime/tests/test-scenario-provider.test.ts
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add packages/runtime/tests/test-scenario-provider.test.ts
git commit -m "test(llm-provider): unit tests for TestTurn scenario resolution"
```

### Task 4b: Tool loop and MaxIterationsError behavioral tests

**File:** `packages/runtime/tests/tool-loop-behavioral.test.ts`

- [ ] **Step 1: Write tests**

```typescript
/**
 * Behavioral tests for the ReAct tool loop using withTestScenario.
 *
 * These tests were previously impossible because the test provider always
 * completed in one iteration without calling tools. With TestTurn scenarios
 * returning stopReason: "tool_use", these paths are now exercisable.
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents } from "../src/builder.js";

function makeToolDef(name: string) {
  return {
    name,
    description: `Tool ${name}`,
    parameters: [
      {
        name: "input",
        type: "string" as const,
        description: "Input",
        required: true,
      },
    ],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  };
}

describe("tool loop behavioral tests", () => {
  it("agent successfully calls a tool via native tool_use path", async () => {
    const toolCalls: string[] = [];

    const agent = await ReactiveAgents.create()
      .withName("tool-loop-test")
      .withTestScenario([
        { toolCall: { name: "echo-tool", args: { input: "hello" } } },
        { text: "The tool returned the value." },
      ])
      .withTools({
        tools: [
          {
            definition: makeToolDef("echo-tool"),
            handler: (args) => {
              toolCalls.push(args.input as string);
              return Effect.succeed(`echoed: ${args.input}`);
            },
          },
        ],
      })
      .build();

    let result;
    try {
      result = await agent.run("echo hello");
    } finally {
      await agent.dispose();
    }

    expect(result.success).toBe(true);
    expect(toolCalls).toContain("hello");
  });

  it("agent calls two tools across sequential turns", async () => {
    const calls: string[] = [];

    const agent = await ReactiveAgents.create()
      .withName("multi-tool-test")
      .withTestScenario([
        { toolCall: { name: "tool-a", args: { input: "first" } } },
        { toolCall: { name: "tool-b", args: { input: "second" } } },
        { text: "Both tools complete." },
      ])
      .withTools({
        tools: [
          {
            definition: makeToolDef("tool-a"),
            handler: (args) => {
              calls.push(`a:${args.input}`);
              return Effect.succeed("a done");
            },
          },
          {
            definition: makeToolDef("tool-b"),
            handler: (args) => {
              calls.push(`b:${args.input}`);
              return Effect.succeed("b done");
            },
          },
        ],
      })
      .build();

    try {
      await agent.run("use both tools");
    } finally {
      await agent.dispose();
    }

    expect(calls).toContain("a:first");
    expect(calls).toContain("b:second");
  });

  it("agent exceeds max iterations when tool calls never terminate", async () => {
    let threw = false;
    let errorMessage = "";

    const agent = await ReactiveAgents.create()
      .withName("max-iter-test")
      .withMaxIterations(3)
      .withTestScenario([
        // Always returns a tool call — agent loops until max iterations
        { toolCall: { name: "loop-tool", args: { input: "loop" } } },
      ])
      .withTools({
        tools: [
          {
            definition: makeToolDef("loop-tool"),
            handler: () => Effect.succeed("keep going"),
          },
        ],
      })
      .build();

    try {
      await agent.run("loop forever");
    } catch (e) {
      threw = true;
      errorMessage = (e as Error).message;
    } finally {
      await agent.dispose();
    }

    expect(threw).toBe(true);
    // Error message should reference iterations or limit
    expect(errorMessage.toLowerCase()).toMatch(/iteration|max|limit|exceed/);
  });

  it("error turn causes agent.run() to throw", async () => {
    let threw = false;

    const agent = await ReactiveAgents.create()
      .withName("error-turn-test")
      .withTestScenario([{ error: "provider_unavailable" }])
      .build();

    try {
      await agent.run("any prompt");
    } catch {
      threw = true;
    } finally {
      await agent.dispose();
    }

    expect(threw).toBe(true);
  });

  it("withErrorHandler fires when error turn is reached", async () => {
    let handlerFired = false;

    const agent = await ReactiveAgents.create()
      .withName("error-handler-test")
      .withTestScenario([{ error: "rate_limit_exceeded" }])
      .withErrorHandler(() => {
        handlerFired = true;
      })
      .build();

    try {
      await agent.run("test");
    } catch {
      // expected — run() rethrows after handler
    } finally {
      await agent.dispose();
    }

    expect(handlerFired).toBe(true);
  });

  it("withTestScenario auto-sets provider — no withProvider needed", async () => {
    const agent = await ReactiveAgents.create()
      .withName("auto-provider-test")
      .withTestScenario([{ text: "auto provider works" }])
      .build();

    let result;
    try {
      result = await agent.run("anything");
    } finally {
      await agent.dispose();
    }

    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
bun test packages/runtime/tests/tool-loop-behavioral.test.ts
```

Expected: all pass. If the MaxIterationsError test fails, confirm `withReasoning({ maxIterations: 3 })` is the correct API for setting max iterations on the builder — check `builder.ts` for the exact parameter name.

- [ ] **Step 3: Run full suite to confirm zero regressions**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts && bun test 2>&1 | tail -6
```

Expected: ≥2000 pass, 0 fail (skip count unchanged).

- [ ] **Step 4: Commit**

```bash
git add packages/runtime/tests/test-scenario-provider.test.ts packages/runtime/tests/tool-loop-behavioral.test.ts
git commit -m "test(runtime): behavioral contract tests for tool loop and MaxIterationsError"
```

---

## Chunk 5: Docs Update

### Task 5: Update testing cookbook and CLAUDE.md

**Files:**
- Modify: `apps/docs/src/content/docs/cookbook/testing-agents.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `cookbook/testing-agents.md`**

Replace all `withTestResponses` references with `withTestScenario`. Update the basic testing example at the top to use:
```typescript
.withTestScenario([{ text: "Paris is the capital of France." }])
```

Remove `.withProvider("test")` from examples that also call `.withTestScenario()` (it's now implicit).

Add a new section **"Simulating Tool Loops"** after the existing "Testing with Tools" section:

```markdown
## Simulating Tool Loops

`withTestScenario` lets you define a multi-turn sequence so you can test the full ReAct tool loop without a real LLM:

\`\`\`typescript
test("agent calls tool and uses the result", async () => {
  const toolCalls: string[] = [];

  const agent = await ReactiveAgents.create()
    .withName("test-agent")
    .withTestScenario([
      // Turn 1: LLM requests a tool call
      { toolCall: { name: "web-search", args: { query: "effect-ts" } } },
      // Turn 2: LLM produces a final answer (tool result fed in automatically)
      { text: "Effect-TS is a TypeScript library for building robust apps." },
    ])
    .withTools({
      tools: [{
        definition: webSearchDef,
        handler: (args) => {
          toolCalls.push(args.query as string);
          return Effect.succeed("Effect-TS search results...");
        },
      }],
    })
    .build();

  const result = await agent.run("Tell me about Effect-TS");
  await agent.dispose();

  expect(result.success).toBe(true);
  expect(toolCalls).toContain("effect-ts");   // tool was actually called
});
\`\`\`

## Testing MaxIterationsError

Force the agent to loop forever by returning tool calls on every turn:

\`\`\`typescript
test("throws when max iterations exceeded", async () => {
  const agent = await ReactiveAgents.create()
    .withName("test-agent")
    .withMaxIterations(3)
    .withTestScenario([
      // Single turn that repeats forever — agent never gets a final answer
      { toolCall: { name: "search", args: { query: "loop" } } },
    ])
    .withTools({ tools: [searchToolDef] })
    .build();

  await expect(agent.run("loop")).rejects.toThrow();
  await agent.dispose();
});
\`\`\`

## Injecting LLM Errors

Test error handling paths by including an `error` turn:

\`\`\`typescript
test("error handler fires on LLM failure", async () => {
  let handlerFired = false;

  const agent = await ReactiveAgents.create()
    .withName("test-agent")
    .withTestScenario([{ error: "rate_limit_exceeded" }])
    .withErrorHandler(() => { handlerFired = true; })
    .build();

  await expect(agent.run("test")).rejects.toThrow();
  expect(handlerFired).toBe(true);
  await agent.dispose();
});
\`\`\`
```

- [ ] **Step 2: Update `CLAUDE.md`**

In the Builder API code block, find `withTestResponses` and replace with:
```typescript
// Testing — multi-turn scenario (withTestScenario auto-sets provider to "test")
.withTestScenario([
  { toolCall: { name: "web-search", args: { query: "test" } } },
  { text: "Here is the answer." },
])
```

- [ ] **Step 3: Build docs**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/apps/docs && npx astro build 2>&1 | tail -5
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/docs/src/content/docs/cookbook/testing-agents.md CLAUDE.md
git commit -m "docs: update testing cookbook and CLAUDE.md for withTestScenario"
```
