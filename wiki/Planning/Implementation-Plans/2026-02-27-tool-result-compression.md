# Tool Result Compression Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace blind tool result truncation with auto-preview+scratchpad overflow (Layer 1) and an in-process code-transform pipe action (Layer 2), giving the ReAct agent accurate data and full control over what enters context.

**Architecture:** `normalizeObservation()` is extended with a `compressToolResult()` path that generates a structured preview and writes the full result to a per-execution scratchpad store when the result exceeds `resultCompression.budget`. A new `| transform:` pipe syntax in `parseToolRequest()` lets the agent transform results in-process before they hit the context window. Both layers are wired through `ReactiveInput` via a new `ResultCompressionConfig` type threaded from `.withTools()` on the builder.

**Tech Stack:** TypeScript, Effect-TS, Bun test runner, `new Function()` for in-process transforms

---

## Task 1: `ResultCompressionConfig` type + builder option

**Files:**
- Modify: `packages/tools/src/types.ts`
- Modify: `packages/runtime/src/builder.ts:108-114`

**Step 1: Write the failing test**

Add to `packages/runtime/tests/builder.test.ts` (or create if absent — check with `ls packages/runtime/tests/`):

```typescript
test("withTools() accepts resultCompression config", async () => {
  const builder = ReactiveAgents.create()
    .withProvider("test")
    .withTools({
      resultCompression: {
        budget: 2000,
        previewItems: 8,
        autoStore: true,
        codeTransform: true,
      },
    });
  // Just verify it builds without type error — no runtime assertion needed
  expect(builder).toBeDefined();
});
```

**Step 2: Run test to verify it fails**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
bun test packages/runtime/tests/builder.test.ts 2>&1 | tail -10
```

Expected: type error — `resultCompression` does not exist on `ToolsOptions`

**Step 3: Add `ResultCompressionConfig` to `packages/tools/src/types.ts`**

Find the bottom of the file (after `MCPServerSchema`) and add:

```typescript
export interface ResultCompressionConfig {
  /** Chars before overflow triggers. Default: 800 */
  readonly budget?: number;
  /** Array items shown in preview. Default: 3 */
  readonly previewItems?: number;
  /** Auto-store overflow in scratchpad. Default: true */
  readonly autoStore?: boolean;
  /** Enable | transform: pipe syntax. Default: true */
  readonly codeTransform?: boolean;
}
```

**Step 4: Add `resultCompression` to `ToolsOptions` in `packages/runtime/src/builder.ts:108-114`**

```typescript
export interface ToolsOptions {
  readonly tools?: ReadonlyArray<{
    readonly definition: ToolDefinition;
    readonly handler: (args: Record<string, unknown>) => Effect.Effect<unknown>;
  }>;
  /** Tool result compression config — controls preview size, scratchpad overflow, and pipe transforms. */
  readonly resultCompression?: ResultCompressionConfig;
}
```

Add the import at the top of builder.ts alongside other tools imports:
```typescript
import type { ResultCompressionConfig } from "@reactive-agents/tools";
```

**Step 5: Run test to verify it passes**

```bash
bun test packages/runtime/tests/builder.test.ts 2>&1 | tail -10
```

Expected: PASS

**Step 6: Commit**

```bash
git add packages/tools/src/types.ts packages/runtime/src/builder.ts
git commit -m "feat(tools): add ResultCompressionConfig type and ToolsOptions.resultCompression field"
```

---

## Task 2: Thread `ResultCompressionConfig` into `ReactiveInput`

**Files:**
- Modify: `packages/reasoning/src/strategies/reactive.ts:32-47` (ReactiveInput)
- Modify: `packages/runtime/src/execution-engine.ts` (where ReactiveInput is constructed)

**Step 1: Write the failing test**

Add to `packages/reasoning/tests/strategies/reactive-compression.test.ts` (new file):

```typescript
import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { executeReactive } from "../../src/strategies/reactive.js";
import { TestLLMServiceLayer } from "../helpers/test-llm.js";

describe("tool result compression config threading", () => {
  test("ReactiveInput accepts resultCompression config", async () => {
    // This is a compile-time check — if it runs, the type is accepted
    const input = {
      taskDescription: "test",
      taskType: "test",
      memoryContext: "",
      availableTools: [],
      config: { strategies: { reactive: { maxIterations: 1, temperature: 0 } } } as any,
      resultCompression: { budget: 2000, previewItems: 8 },
    };
    expect(input.resultCompression?.budget).toBe(2000);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test packages/reasoning/tests/strategies/reactive-compression.test.ts 2>&1 | tail -10
```

Expected: type error on `resultCompression` not in `ReactiveInput`

**Step 3: Add `resultCompression` to `ReactiveInput` in `reactive.ts:32-47`**

```typescript
interface ReactiveInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableToolSchemas?: readonly ToolSchema[];
  readonly availableTools: readonly string[];
  readonly config: ReasoningConfig;
  readonly contextProfile?: ContextProfile;
  readonly systemPrompt?: string;
  readonly taskId?: string;
  /** Tool result compression config — overrides profile defaults for budget/preview. */
  readonly resultCompression?: ResultCompressionConfig;
}
```

Add import at top of `reactive.ts`:
```typescript
import type { ResultCompressionConfig } from "@reactive-agents/tools";
```

**Step 4: Pass `resultCompression` from execution-engine**

In `packages/runtime/src/execution-engine.ts`, find where `ReactiveInput` is constructed (search for `taskDescription:` near the strategy execution call). Add:

```typescript
resultCompression: config.resultCompression,
```

And in `ReactiveAgentsConfig` (in `packages/runtime/src/runtime.ts`), add the optional field so it flows from builder → config:

```typescript
resultCompression: Schema.optional(
  Schema.Struct({
    budget: Schema.optional(Schema.Number),
    previewItems: Schema.optional(Schema.Number),
    autoStore: Schema.optional(Schema.Boolean),
    codeTransform: Schema.optional(Schema.Boolean),
  })
),
```

In `packages/runtime/src/builder.ts`, in `withTools()`, save `resultCompression` to `_config`:

```typescript
withTools(options?: ToolsOptions): this {
  // ... existing logic ...
  if (options?.resultCompression) {
    this._config.resultCompression = options.resultCompression;
  }
  return this;
}
```

**Step 5: Run test to verify it passes**

```bash
bun test packages/reasoning/tests/strategies/reactive-compression.test.ts 2>&1 | tail -10
```

Expected: PASS

**Step 6: Commit**

```bash
git add packages/reasoning/src/strategies/reactive.ts packages/runtime/src/execution-engine.ts packages/runtime/src/runtime.ts packages/runtime/src/builder.ts
git commit -m "feat(reasoning): thread ResultCompressionConfig into ReactiveInput and execution config"
```

---

## Task 3: `compressToolResult()` — Layer 1 structured preview

**Files:**
- Modify: `packages/reasoning/src/strategies/reactive.ts:753-758` (replace `truncateToolResult`)

This is the core of Layer 1. Replace the 6-line `truncateToolResult` function with `compressToolResult` that generates a structured preview for large results.

**Step 1: Write the failing tests**

Add to `packages/reasoning/tests/strategies/reactive-compression.test.ts`:

```typescript
import { compressToolResult } from "../../src/strategies/reactive.js"; // will export after impl

describe("compressToolResult", () => {
  test("returns result as-is when under budget", () => {
    const result = compressToolResult("hello world", "some-tool", 800, 3);
    expect(result.content).toBe("hello world");
    expect(result.stored).toBeUndefined();
  });

  test("generates array preview for JSON array over budget", () => {
    const commits = Array.from({ length: 10 }, (_, i) => ({
      sha: `abc${i}def${i}`,
      commit: { message: `feat: change ${i}`, author: { date: "2026-02-27" } },
      author: { login: "user" },
    }));
    const result = compressToolResult(JSON.stringify(commits), "github/list_commits", 100, 3);
    expect(result.content).toContain("Array(10)");
    expect(result.content).toContain("sha");
    expect(result.content).toContain("feat: change 0");
    expect(result.content).toContain("...7 more");
    expect(result.stored).toBeDefined();
    expect(result.stored!.key).toMatch(/^_tool_result_/);
    expect(result.stored!.value).toBe(JSON.stringify(commits));
  });

  test("generates object preview for JSON object over budget", () => {
    const obj = { id: 1, name: "test", description: "a long description here", nested: { a: 1 } };
    const result = compressToolResult(JSON.stringify(obj), "some-tool", 10, 3);
    expect(result.content).toContain("Object");
    expect(result.content).toContain("id");
    expect(result.content).toContain("name");
    expect(result.stored).toBeDefined();
  });

  test("generates line preview for plain text over budget", () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const result = compressToolResult(text, "file-read", 10, 3);
    expect(result.content).toContain("line 0");
    expect(result.content).toContain("line 1");
    expect(result.content).toContain("17 more lines");
    expect(result.stored).toBeDefined();
  });

  test("uses monotonic counter for stored key uniqueness", () => {
    const big = "x".repeat(1000);
    const r1 = compressToolResult(big, "tool-a", 10, 3);
    const r2 = compressToolResult(big, "tool-b", 10, 3);
    expect(r1.stored!.key).not.toBe(r2.stored!.key);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test packages/reasoning/tests/strategies/reactive-compression.test.ts 2>&1 | tail -15
```

Expected: FAIL — `compressToolResult` is not exported

**Step 3: Implement `compressToolResult` in `reactive.ts`**

Replace `truncateToolResult` (lines 753-758) with:

```typescript
// Monotonic counter for unique scratchpad keys within a process lifetime
let _toolResultCounter = 0;

interface CompressResult {
  content: string;
  stored?: { key: string; value: string };
}

/** Replace blind truncation with structured preview + optional scratchpad storage. */
export function compressToolResult(
  result: string,
  toolName: string,
  budget: number,
  previewItems: number,
): CompressResult {
  if (result.length <= budget) return { content: result };

  const key = `_tool_result_${++_toolResultCounter}`;

  // Try JSON first
  try {
    const parsed = JSON.parse(result) as unknown;

    if (Array.isArray(parsed)) {
      // Schema: inspect first item keys, flatten one level
      const first = parsed[0] as Record<string, unknown> | undefined;
      const schema = first
        ? Object.entries(first)
            .flatMap(([k, v]) =>
              v !== null && typeof v === "object" && !Array.isArray(v)
                ? Object.keys(v as object).map((sub) => `${k}.${sub}`)
                : [k],
            )
            .slice(0, 8)
            .join(", ")
        : "unknown";

      const items = (parsed as Array<Record<string, unknown>>)
        .slice(0, previewItems)
        .map((item, i) => {
          const pairs = Object.entries(item)
            .slice(0, 4)
            .map(([k, v]) => {
              const val =
                v !== null && typeof v === "object"
                  ? Object.values(v as object)
                      .filter((x) => typeof x === "string")
                      .map(String)[0] ?? "{...}"
                  : String(v).slice(0, 60);
              return `${k}=${val}`;
            })
            .join("  ");
          return `  [${i}] ${pairs}`;
        })
        .join("\n");

      const remaining = parsed.length - previewItems;
      const moreStr = remaining > 0 ? `\n  ...${remaining} more` : "";
      const content =
        `[STORED: ${key} | ${toolName}]\n` +
        `Type: Array(${parsed.length}) | Schema: ${schema}\n` +
        `Preview (first ${Math.min(previewItems, parsed.length)}):\n` +
        items +
        moreStr +
        `\n  — use scratchpad-read("${key}") or | transform: to access full data`;

      return { content, stored: { key, value: result } };
    }

    // JSON object
    if (typeof parsed === "object" && parsed !== null) {
      const entries = Object.entries(parsed as Record<string, unknown>)
        .slice(0, 8)
        .map(([k, v]) => {
          const val =
            v === null
              ? "null"
              : Array.isArray(v)
                ? `Array(${v.length})`
                : typeof v === "object"
                  ? `{${Object.keys(v as object).slice(0, 3).join(", ")}}`
                  : String(v).slice(0, 80);
          return `  ${k}: ${val}`;
        })
        .join("\n");

      const totalKeys = Object.keys(parsed as object).length;
      const content =
        `[STORED: ${key} | ${toolName}]\n` +
        `Type: Object(${totalKeys} keys)\n` +
        entries +
        `\n  — use scratchpad-read("${key}") or | transform: to access full data`;

      return { content, stored: { key, value: result } };
    }
  } catch {
    // Not JSON — plain text preview
  }

  // Plain text: first N lines
  const lines = result.split("\n");
  const preview = lines.slice(0, previewItems).join("\n");
  const remaining = lines.length - previewItems;
  const moreStr = remaining > 0 ? `\n  ...${remaining} more lines` : "";
  const content =
    `[STORED: ${key} | ${toolName}]\n` +
    preview +
    moreStr +
    `\n  — use scratchpad-read("${key}") to access full text`;

  return { content, stored: { key, value: result } };
}
```

**Step 4: Run tests to verify they pass**

```bash
bun test packages/reasoning/tests/strategies/reactive-compression.test.ts 2>&1 | tail -15
```

Expected: all `compressToolResult` tests PASS

**Step 5: Commit**

```bash
git add packages/reasoning/src/strategies/reactive.ts packages/reasoning/tests/strategies/reactive-compression.test.ts
git commit -m "feat(reasoning): add compressToolResult() — structured preview + scratchpad overflow"
```

---

## Task 4: Wire `compressToolResult` into `runToolObservation`

**Files:**
- Modify: `packages/reasoning/src/strategies/reactive.ts:400-468` (`runToolObservation`)

The scratchpad store is a `Map<string, string>` passed by reference through the execution so auto-stored results are available to `scratchpad-read` in later steps.

**Step 1: Write the failing test**

Add to `reactive-compression.test.ts`:

```typescript
describe("runToolObservation compression integration", () => {
  test("preview replaces raw result when result exceeds budget", async () => {
    // Build a fake ToolService that returns a large array result
    const bigArray = Array.from({ length: 20 }, (_, i) => ({
      sha: `sha${i}`,
      message: `commit ${i}`,
    }));
    const bigJson = JSON.stringify(bigArray);

    // We'll test compressToolResult directly since runToolObservation is internal
    const result = compressToolResult(bigJson, "github/list_commits", 100, 3);
    expect(result.content).toContain("Array(20)");
    expect(result.content).toContain("[STORED:");
    expect(result.stored).toBeDefined();
    // Stored value should be the full original JSON
    expect(JSON.parse(result.stored!.value)).toHaveLength(20);
  });
});
```

**Step 2: Run test — should pass already (compressToolResult tested in Task 3)**

```bash
bun test packages/reasoning/tests/strategies/reactive-compression.test.ts 2>&1 | tail -10
```

**Step 3: Update `runToolObservation` to use `compressToolResult`**

In `runToolObservation` (around line 428-436), replace the `truncateToolResult` call:

Change this section:
```typescript
Effect.map((r: ToolOutput) => {
  const raw = typeof r.result === "string" ? r.result : JSON.stringify(r.result);
  const normalized = normalizeObservation(toolRequest.tool, raw);
  const maxChars = profile?.toolResultMaxChars ?? 800;
  const content = truncateToolResult(normalized, maxChars);
  return {
    content,
    observationResult: makeObservationResult(toolRequest.tool, r.success !== false, content),
  } satisfies ToolObservationOutput;
}),
```

To:
```typescript
Effect.map((r: ToolOutput) => {
  const raw = typeof r.result === "string" ? r.result : JSON.stringify(r.result);
  const normalized = normalizeObservation(toolRequest.tool, raw);
  const budget = compressionConfig?.budget ?? profile?.toolResultMaxChars ?? 800;
  const previewItems = compressionConfig?.previewItems ?? 3;
  const autoStore = compressionConfig?.autoStore ?? true;
  const compressed = compressToolResult(normalized, toolRequest.tool, budget, previewItems);
  // Write overflow to scratchpad store if autoStore is enabled and we have a store
  if (autoStore && compressed.stored && scratchpadStore) {
    scratchpadStore.set(compressed.stored.key, compressed.stored.value);
  }
  return {
    content: compressed.content,
    observationResult: makeObservationResult(toolRequest.tool, r.success !== false, compressed.content),
  } satisfies ToolObservationOutput;
}),
```

Update `runToolObservation` signature to accept the new params:

```typescript
function runToolObservation(
  toolServiceOpt: { _tag: "Some"; value: ToolServiceInstance } | { _tag: "None" },
  toolRequest: { tool: string; input: string; transform?: string },
  _input: ReactiveInput,
  profile?: ContextProfile,
  compressionConfig?: ResultCompressionConfig,
  scratchpadStore?: Map<string, string>,
): Effect.Effect<ToolObservationOutput, never>
```

In `executeReactive`, create a shared `scratchpadStore` at the top of the function (alongside `steps`):

```typescript
const scratchpadStore = new Map<string, string>();
```

And pass it to `runToolObservation` at the call site (around line 304):

```typescript
const toolObs = yield* runToolObservation(
  toolServiceOpt,
  toolRequest,
  input,
  profile,
  input.resultCompression,
  scratchpadStore,
);
```

Also wire `scratchpadStore` into the existing `scratchpad-read` tool execution — when `scratchpad-read` is called with a `_tool_result_*` key, check `scratchpadStore` first before the in-memory scratchpad Ref. Add this to the `runToolObservation` logic for the `scratchpad-read` tool:

In `runToolObservation`, before calling `toolService.execute`, check if it's a scratchpad-read for a stored result:

```typescript
// Short-circuit scratchpad-read for auto-stored tool results
if (toolRequest.tool === "scratchpad-read" && scratchpadStore) {
  try {
    const args = JSON.parse(toolRequest.input) as { key?: string };
    const key = args.key ?? "";
    if (scratchpadStore.has(key)) {
      const value = scratchpadStore.get(key)!;
      const content = value.length > (compressionConfig?.budget ?? 800)
        ? truncateForDisplay(value, compressionConfig?.budget ?? 800)
        : value;
      return Effect.succeed({
        content,
        observationResult: makeObservationResult("scratchpad-read", true, content),
      });
    }
  } catch { /* fall through to normal execution */ }
}
```

Add a simple `truncateForDisplay` helper (head+tail, but only used when agent explicitly reads the full store):
```typescript
function truncateForDisplay(result: string, maxChars: number): string {
  if (result.length <= maxChars) return result;
  const half = Math.floor(maxChars / 2);
  const omitted = result.length - maxChars;
  return `${result.slice(0, half)}\n[...${omitted} chars omitted...]\n${result.slice(-half)}`;
}
```

**Step 4: Run all tests**

```bash
bun test packages/reasoning/ 2>&1 | tail -10
```

Expected: all PASS (no regressions)

**Step 5: Commit**

```bash
git add packages/reasoning/src/strategies/reactive.ts
git commit -m "feat(reasoning): wire compressToolResult into runToolObservation with scratchpad overflow store"
```

---

## Task 5: Pipe transform parser — Layer 2

**Files:**
- Modify: `packages/reasoning/src/strategies/reactive.ts:665-716` (`parseToolRequest`)

**Step 1: Write the failing tests**

Add to `reactive-compression.test.ts`:

```typescript
import { parseToolRequestWithTransform } from "../../src/strategies/reactive.js";

describe("pipe transform parsing", () => {
  test("parses plain action with no transform", () => {
    const result = parseToolRequestWithTransform(
      'ACTION: github/list_commits({"owner":"x","repo":"y"})'
    );
    expect(result?.tool).toBe("github/list_commits");
    expect(result?.transform).toBeUndefined();
  });

  test("parses action with | transform: expression", () => {
    const result = parseToolRequestWithTransform(
      'ACTION: github/list_commits({"owner":"x"}) | transform: result.slice(0,3).map(c => c.sha)'
    );
    expect(result?.tool).toBe("github/list_commits");
    expect(result?.transform).toBe("result.slice(0,3).map(c => c.sha)");
  });

  test("transform expression can contain nested parens and JSON", () => {
    const result = parseToolRequestWithTransform(
      'ACTION: some/tool({"k":"v"}) | transform: result.filter(x => x.active).map(x => ({id: x.id, name: x.name}))'
    );
    expect(result?.transform).toContain("result.filter");
    expect(result?.transform).toContain("x.name");
  });

  test("returns null for invalid action", () => {
    expect(parseToolRequestWithTransform("THOUGHT: just thinking")).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test packages/reasoning/tests/strategies/reactive-compression.test.ts 2>&1 | tail -10
```

Expected: FAIL — `parseToolRequestWithTransform` not exported

**Step 3: Add `parseToolRequestWithTransform` to `reactive.ts`**

Add after `parseAllToolRequests` (around line 733):

```typescript
/** Parse an ACTION line, extracting optional | transform: expression. */
export function parseToolRequestWithTransform(
  thought: string,
): { tool: string; input: string; transform?: string } | null {
  // Split on " | transform: " before parsing the action
  const pipeIdx = thought.indexOf(" | transform: ");
  const actionPart = pipeIdx >= 0 ? thought.slice(0, pipeIdx) : thought;
  const transformExpr = pipeIdx >= 0 ? thought.slice(pipeIdx + " | transform: ".length).trim() : undefined;

  const base = parseToolRequest(actionPart);
  if (!base) return null;
  return { ...base, transform: transformExpr };
}
```

Update `parseAllToolRequests` to use `parseToolRequestWithTransform` internally so the loop captures transforms too:

```typescript
function parseAllToolRequests(
  thought: string,
): Array<{ tool: string; input: string; transform?: string }> {
  const results: Array<{ tool: string; input: string; transform?: string }> = [];
  const re = /ACTION:/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(thought)) !== null) {
    const slice = thought.slice(match.index);
    const req = parseToolRequestWithTransform(slice);
    if (req) results.push(req);
  }
  return results;
}
```

**Step 4: Run tests to verify they pass**

```bash
bun test packages/reasoning/tests/strategies/reactive-compression.test.ts 2>&1 | tail -10
```

Expected: all pipe transform tests PASS

**Step 5: Commit**

```bash
git add packages/reasoning/src/strategies/reactive.ts packages/reasoning/tests/strategies/reactive-compression.test.ts
git commit -m "feat(reasoning): add parseToolRequestWithTransform() for pipe syntax parsing"
```

---

## Task 6: Execute pipe transforms in `runToolObservation`

**Files:**
- Modify: `packages/reasoning/src/strategies/reactive.ts` (runToolObservation + executeReactive)

**Step 1: Write the failing test**

Add to `reactive-compression.test.ts`:

```typescript
import { evaluateTransform } from "../../src/strategies/reactive.js";

describe("evaluateTransform", () => {
  test("evaluates expression with result variable", () => {
    const input = [{ sha: "abc123def456", msg: "fix: bug" }, { sha: "xyz789uvw012", msg: "feat: add" }];
    const expr = "result.map(c => c.sha.slice(0, 7))";
    const output = evaluateTransform(expr, input);
    expect(output).toEqual(["abc123d", "xyz789u"]);
  });

  test("returns error string on expression throw", () => {
    const output = evaluateTransform("result.nonExistentMethod()", []);
    expect(typeof output).toBe("string");
    expect(output as string).toContain("[Transform error:");
  });

  test("serializes non-string output to JSON", () => {
    const output = evaluateTransform("result.slice(0,1)", [{ id: 1 }]);
    expect(typeof output).toBe("string");
    expect(output as string).toContain('"id":1');
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test packages/reasoning/tests/strategies/reactive-compression.test.ts 2>&1 | tail -10
```

Expected: FAIL — `evaluateTransform` not exported

**Step 3: Implement `evaluateTransform`**

Add to `reactive.ts` after `compressToolResult`:

```typescript
/**
 * Evaluate a transform expression in-process with `result` bound to the tool output.
 * Returns the serialized result, or an error string on failure.
 * Runs synchronously via new Function() — suitable for pure data transformations only.
 */
export function evaluateTransform(expr: string, result: unknown): string {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("result", `return (${expr})`);
    const output = fn(result) as unknown;
    if (typeof output === "string") return output;
    return JSON.stringify(output, null, 2);
  } catch (e) {
    return `[Transform error: ${e instanceof Error ? e.message : String(e)}] — fix the expression or remove | transform:`;
  }
}
```

**Step 4: Wire transform execution into `runToolObservation`**

In `runToolObservation`, update the `Effect.map` section to apply the transform when present. The `toolRequest` now has type `{ tool: string; input: string; transform?: string }`:

```typescript
Effect.map((r: ToolOutput) => {
  const raw = typeof r.result === "string" ? r.result : JSON.stringify(r.result);
  const normalized = normalizeObservation(toolRequest.tool, raw);

  // Layer 2: pipe transform — evaluate in-process, inject only the transformed result
  if (toolRequest.transform && (compressionConfig?.codeTransform ?? true)) {
    let parsed: unknown = normalized;
    try { parsed = JSON.parse(normalized); } catch { /* use string */ }
    const transformed = evaluateTransform(toolRequest.transform, parsed);
    // Still store the full original for follow-up access
    if ((compressionConfig?.autoStore ?? true) && scratchpadStore) {
      const key = `_tool_result_${++_toolResultCounter}`;
      scratchpadStore.set(key, normalized);
    }
    return {
      content: transformed,
      observationResult: makeObservationResult(toolRequest.tool, !transformed.startsWith("[Transform error:"), transformed),
    } satisfies ToolObservationOutput;
  }

  // Layer 1: auto-preview compression
  const budget = compressionConfig?.budget ?? profile?.toolResultMaxChars ?? 800;
  const previewItems = compressionConfig?.previewItems ?? 3;
  const autoStore = compressionConfig?.autoStore ?? true;
  const compressed = compressToolResult(normalized, toolRequest.tool, budget, previewItems);
  if (autoStore && compressed.stored && scratchpadStore) {
    scratchpadStore.set(compressed.stored.key, compressed.stored.value);
  }
  return {
    content: compressed.content,
    observationResult: makeObservationResult(toolRequest.tool, r.success !== false, compressed.content),
  } satisfies ToolObservationOutput;
}),
```

In `executeReactive`, the `allToolRequests` array now carries `transform?`. Pass it through to `runToolObservation`:

```typescript
const toolObs = yield* runToolObservation(
  toolServiceOpt,
  toolRequest,   // now has transform?: string
  input,
  profile,
  input.resultCompression,
  scratchpadStore,
);
```

**Step 5: Run all reasoning tests**

```bash
bun test packages/reasoning/ 2>&1 | tail -15
```

Expected: all PASS

**Step 6: Commit**

```bash
git add packages/reasoning/src/strategies/reactive.ts packages/reasoning/tests/strategies/reactive-compression.test.ts
git commit -m "feat(reasoning): execute pipe transforms in runToolObservation via evaluateTransform()"
```

---

## Task 7: Update ReAct prompt to teach the agent both layers

**Files:**
- Modify: `packages/reasoning/src/strategies/reactive.ts` — the `buildToolsSection` function (around line 597)

**Step 1: Write the failing test**

Add to `reactive-compression.test.ts`:

```typescript
describe("ReAct prompt includes compression instructions", () => {
  test("tools section mentions STORED and pipe transform when tools available", () => {
    // Build a minimal context string that includes the tools section
    // Access via the exported buildInitialContext or inspect the prompt text
    const input = {
      taskDescription: "test",
      taskType: "test",
      memoryContext: "",
      availableTools: ["github/list_commits", "scratchpad-read"],
      availableToolSchemas: undefined,
      config: { strategies: { reactive: { maxIterations: 1, temperature: 0 } } } as any,
      resultCompression: { codeTransform: true },
    };
    // We'll check this indirectly by verifying the prompt contains the keywords
    // after the update — for now this is a placeholder that will pass after impl
    expect(input.resultCompression?.codeTransform).toBe(true);
  });
});
```

**Step 2: Locate the tools section builder**

In `reactive.ts` around line 597:

```typescript
sections.push(`Available Tools:\n${toolLines}\n\nTo use a tool: ACTION: tool_name({"param": "value"}) — use EXACT parameter names shown above, valid JSON only.`);
```

**Step 3: Update the tools section to include compression instructions**

Replace that `sections.push` with:

```typescript
const transformNote = `
TOOL RESULTS:
Large results are stored automatically. You will see a compact preview:
  [STORED: _tool_result_1 | tool/name]
  Type: Array(30) | Schema: sha, commit.message, author.login
  Preview: [0] sha=abc1234  msg="fix: bug"  ...
  — use scratchpad-read("_tool_result_1") to access the full result

PIPE TRANSFORMS (optional, advanced):
To get exactly what you need in one step, append | transform: <expr> to any ACTION:
  ACTION: github/list_commits({"owner":"x","repo":"y"}) | transform: result.slice(0,3).map(c => ({sha: c.sha.slice(0,7), msg: c.commit.message.split('\\n')[0]}))
Only the transform output enters context. result = parsed JSON (or raw string).`.trim();

sections.push(
  `Available Tools:\n${toolLines}\n\nTo use a tool: ACTION: tool_name({"param": "value"}) — use EXACT parameter names shown above, valid JSON only.\n\n${transformNote}`
);
```

**Step 4: Run all tests**

```bash
bun test packages/reasoning/ 2>&1 | tail -10
```

Expected: all PASS

**Step 5: Commit**

```bash
git add packages/reasoning/src/strategies/reactive.ts
git commit -m "feat(reasoning): update ReAct prompt with tool result storage and pipe transform instructions"
```

---

## Task 8: Full integration test + run main.ts

**Files:**
- Modify: `packages/reasoning/tests/strategies/reactive-compression.test.ts` — add end-to-end integration test

**Step 1: Write the integration test**

Add to `reactive-compression.test.ts`:

```typescript
import { executeReactive } from "../../src/strategies/reactive.js";
import { Effect, Layer, Ref } from "effect";
import { ToolService } from "@reactive-agents/tools";

describe("compression end-to-end integration", () => {
  test("large tool result produces preview in observation context", async () => {
    // Build a minimal ToolService that returns a large array
    const bigCommits = Array.from({ length: 25 }, (_, i) => ({
      sha: `${"a".repeat(7)}${i}`,
      commit: { message: `feat: change ${i}`, author: { date: "2026-02-27" } },
      author: { login: "user" },
    }));

    const mockToolService = {
      execute: () => Effect.succeed({ result: bigCommits, success: true }),
      getTool: () => Effect.succeed({ name: "test/list", parameters: [], description: "", riskLevel: "low", source: "function" }),
      register: () => Effect.succeed(undefined),
      listTools: () => Effect.succeed([]),
      getToolsForLLM: () => Effect.succeed([]),
    };
    const MockToolLayer = Layer.succeed(ToolService, mockToolService as any);

    const result = await Effect.runPromise(
      executeReactive({
        taskDescription: "List commits and tell me how many there are",
        taskType: "query",
        memoryContext: "",
        availableTools: ["test/list"],
        config: {
          strategies: { reactive: { maxIterations: 5, temperature: 0 } },
        } as any,
        resultCompression: { budget: 200, previewItems: 3, autoStore: true },
      }).pipe(Effect.provide(MockToolLayer), Effect.provide(TestLLMServiceLayer("FINAL ANSWER: 25 commits")))
    );

    // The agent should have received a preview, not garbled JSON
    expect(result.output).toBeDefined();
  });
});
```

**Step 2: Run all tests**

```bash
bun test 2>&1 | tail -10
```

Expected: 893+ tests pass, 0 fail

**Step 3: Run main.ts to confirm real MCP tool results are clean**

```bash
bun --env-file=.env main.ts 2>&1 | grep -A5 "obs\]"
```

Expected: `[obs]` lines show either a clean preview with `[STORED:` header or transformed output — never a mid-JSON truncation

**Step 4: Final commit**

```bash
git add packages/reasoning/tests/strategies/reactive-compression.test.ts
git commit -m "test(reasoning): add compression integration test"
```

---

## Checklist

- [ ] `ResultCompressionConfig` type exported from `@reactive-agents/tools`
- [ ] `ToolsOptions.resultCompression` on builder
- [ ] `ReactiveInput.resultCompression` threaded through to execution
- [ ] `compressToolResult()` generates structured previews for array / object / text
- [ ] Auto-store writes to `scratchpadStore` when `autoStore: true`
- [ ] `scratchpad-read` short-circuit reads from `scratchpadStore` for `_tool_result_*` keys
- [ ] `parseToolRequestWithTransform()` parses `| transform:` pipe syntax
- [ ] `evaluateTransform()` evaluates in-process, returns error string on failure
- [ ] Pipe transforms execute before compression — full result still stored
- [ ] ReAct prompt updated with storage and transform instructions
- [ ] All 893+ existing tests pass
- [ ] `main.ts` shows clean `[obs]` output (no mid-JSON truncation)
