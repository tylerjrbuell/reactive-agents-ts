# Type-Safe Tools, Context Ingestion & Effect-Free DX — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three user-facing improvements: (1) type-safe tool definitions with schema-inferred handlers, (2) user-controlled document/context ingestion API, (3) convenience utilities that abstract Effect scaffolding.

**Architecture:** Add a `defineTool()` function that uses Effect Schema to infer handler argument types (tRPC-style). Refactor RAG from agent-tool-only to user-facing `.withDocuments()` + `agent.ingest()` API while keeping `rag-search` as a built-in tool. Add `defineHook()`, `agent.on()`, and simplified tool creation patterns that don't require Effect knowledge.

**Tech Stack:** Effect Schema (already in project), TypeScript 5.7+ template literal types, bun:test

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/tools/src/define-tool.ts` | `defineTool()` — schema-inferred type-safe tool factory |
| `packages/tools/src/define-tool-simple.ts` | `tool()` — zero-schema convenience wrapper for simple tools |
| `packages/tools/tests/define-tool.test.ts` | Tests for schema-inferred tool definitions |
| `packages/tools/tests/define-tool-simple.test.ts` | Tests for simple tool wrapper |
| `packages/runtime/src/context-ingestion.ts` | Document ingestion API: `ingest()`, `ingestFile()` |
| `packages/runtime/tests/context-ingestion.test.ts` | Tests for context ingestion |
| `packages/runtime/tests/convenience-api.test.ts` | Tests for `agent.on()` and other convenience methods |

### Modified Files
| File | Changes |
|------|---------|
| `packages/tools/src/index.ts` | Export `defineTool`, `tool` |
| `packages/tools/src/tool-builder.ts` | Add generic type parameter to `handler()` method |
| `packages/runtime/src/builder.ts` | Add `.withDocuments()`, update `.withTools()` to accept `defineTool` output |
| `packages/runtime/src/builder.ts` | Add `agent.on()`, `agent.ingest()`, `agent.ingestFile()` to ReactiveAgent |
| `packages/tools/src/skills/rag-ingest.ts` | Refactor to expose `ingestDocuments()` as a reusable Effect |
| `packages/tools/src/skills/builtin.ts` | Make `rag-ingest` optional (not auto-registered), keep `rag-search` |
| `packages/reactive-agents/src/index.ts` | Re-export new utilities |

---

## Chunk 1: Type-Safe Tool Definitions

### Task 1: `defineTool()` with Schema-Inferred Handler Types

The core type-safe tool factory. Uses Effect Schema to infer handler argument types at compile time.

**Files:**
- Create: `packages/tools/src/define-tool.ts`
- Test: `packages/tools/tests/define-tool.test.ts`

**Target API:**
```typescript
import { defineTool } from "@reactive-agents/tools";
import { Schema } from "effect";

const searchTool = defineTool({
  name: "search",
  description: "Search the web",
  input: Schema.Struct({
    query: Schema.String,
    maxResults: Schema.optionalWith(Schema.Number, { default: () => 5 }),
  }),
  handler: (args) => {
    // args is typed as { query: string; maxResults: number }
    return Effect.succeed(`Results for: ${args.query}`);
  },
});

// Use with builder:
agent.withTools({ tools: [searchTool] })
```

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/tools/tests/define-tool.test.ts
import { describe, it, expect } from "bun:test";
import { Effect, Schema } from "effect";
import { defineTool } from "../src/define-tool.js";

describe("defineTool", () => {
  it("should create a tool definition with correct metadata", () => {
    const tool = defineTool({
      name: "test-tool",
      description: "A test tool",
      input: Schema.Struct({
        query: Schema.String,
      }),
      handler: (args) => Effect.succeed(args.query),
    });

    expect(tool.definition.name).toBe("test-tool");
    expect(tool.definition.description).toBe("A test tool");
    expect(tool.definition.parameters).toHaveLength(1);
    expect(tool.definition.parameters[0]!.name).toBe("query");
    expect(tool.definition.parameters[0]!.type).toBe("string");
    expect(tool.definition.parameters[0]!.required).toBe(true);
  });

  it("should infer parameter types from Schema", () => {
    const tool = defineTool({
      name: "multi-param",
      description: "Multi param tool",
      input: Schema.Struct({
        name: Schema.String,
        count: Schema.Number,
        enabled: Schema.Boolean,
      }),
      handler: (args) => Effect.succeed(`${args.name}-${args.count}-${args.enabled}`),
    });

    expect(tool.definition.parameters).toHaveLength(3);
    const types = tool.definition.parameters.map(p => p.type);
    expect(types).toContain("string");
    expect(types).toContain("number");
    expect(types).toContain("boolean");
  });

  it("should handle optional parameters with defaults", () => {
    const tool = defineTool({
      name: "optional-tool",
      description: "Has optional params",
      input: Schema.Struct({
        required: Schema.String,
        optional: Schema.optional(Schema.Number),
      }),
      handler: (args) => Effect.succeed(args.required),
    });

    const params = tool.definition.parameters;
    const reqParam = params.find(p => p.name === "required")!;
    const optParam = params.find(p => p.name === "optional")!;
    expect(reqParam.required).toBe(true);
    expect(optParam.required).toBe(false);
  });

  it("should validate and parse args at runtime via handler wrapper", async () => {
    const tool = defineTool({
      name: "validated",
      description: "Validated tool",
      input: Schema.Struct({
        count: Schema.Number,
      }),
      handler: (args) => Effect.succeed(args.count * 2),
    });

    // Handler wraps: parses raw args through Schema, then calls typed handler
    const result = await Effect.runPromise(tool.handler({ count: 5 }));
    expect(result).toBe(10);
  });

  it("should fail with validation error for invalid args", async () => {
    const tool = defineTool({
      name: "strict",
      description: "Strict tool",
      input: Schema.Struct({
        count: Schema.Number,
      }),
      handler: (args) => Effect.succeed(args.count),
    });

    const result = await Effect.runPromise(
      tool.handler({ count: "not-a-number" }).pipe(Effect.either),
    );
    expect(result._tag).toBe("Left"); // Validation failure
  });

  it("should support custom options (riskLevel, timeout, category)", () => {
    const tool = defineTool({
      name: "risky",
      description: "High risk tool",
      input: Schema.Struct({ target: Schema.String }),
      handler: (args) => Effect.succeed(args.target),
      riskLevel: "high",
      timeoutMs: 60_000,
      category: "code",
      requiresApproval: true,
    });

    expect(tool.definition.riskLevel).toBe("high");
    expect(tool.definition.timeoutMs).toBe(60_000);
    expect(tool.definition.category).toBe("code");
    expect(tool.definition.requiresApproval).toBe(true);
  });

  it("should support enum constraints via Schema.Literal", () => {
    const tool = defineTool({
      name: "enum-tool",
      description: "Enum param tool",
      input: Schema.Struct({
        format: Schema.Literal("json", "csv", "text"),
      }),
      handler: (args) => Effect.succeed(args.format),
    });

    const formatParam = tool.definition.parameters.find(p => p.name === "format")!;
    expect(formatParam.enum).toEqual(["json", "csv", "text"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/tools/tests/define-tool.test.ts`
Expected: FAIL — module `../src/define-tool.js` not found

- [ ] **Step 3: Implement `defineTool()`**

Create `packages/tools/src/define-tool.ts`:

```typescript
import { Effect, Schema } from "effect";
import type { ToolDefinition, ToolParameter } from "./types.js";
import { ToolExecutionError } from "./errors.js";

/**
 * Type-safe tool definition with schema-inferred handler arguments.
 *
 * The `input` Schema defines both the runtime validation AND the TypeScript type
 * of the handler's `args` parameter — no manual type annotations needed.
 */
export interface DefineToolOptions<A> {
  readonly name: string;
  readonly description: string;
  readonly input: Schema.Schema<A>;
  readonly handler: (args: A) => Effect.Effect<unknown, ToolExecutionError>;
  readonly riskLevel?: ToolDefinition["riskLevel"];
  readonly timeoutMs?: number;
  readonly category?: ToolDefinition["category"];
  readonly requiresApproval?: boolean;
}

export interface DefinedTool {
  readonly definition: ToolDefinition;
  readonly handler: (args: Record<string, unknown>) => Effect.Effect<unknown, ToolExecutionError>;
}

/**
 * Define a type-safe tool with schema-validated inputs.
 *
 * Uses Effect Schema to:
 * 1. Infer TypeScript types for the handler's `args` parameter (compile-time)
 * 2. Validate and parse raw LLM arguments at runtime (runtime safety)
 * 3. Generate ToolParameter[] metadata for the LLM (tool discovery)
 *
 * @example
 * ```typescript
 * const searchTool = defineTool({
 *   name: "search",
 *   description: "Search the web",
 *   input: Schema.Struct({
 *     query: Schema.String,
 *     maxResults: Schema.optional(Schema.Number),
 *   }),
 *   handler: (args) => {
 *     // args: { query: string; maxResults?: number }
 *     return Effect.succeed(`Results for: ${args.query}`);
 *   },
 * });
 * ```
 */
export function defineTool<A>(options: DefineToolOptions<A>): DefinedTool {
  const parameters = schemaToParameters(options.input);

  const definition: ToolDefinition = {
    name: options.name,
    description: options.description,
    parameters,
    riskLevel: options.riskLevel ?? "low",
    timeoutMs: options.timeoutMs ?? 30_000,
    requiresApproval: options.requiresApproval ?? false,
    source: "function",
    ...(options.category ? { category: options.category } : {}),
  };

  // Wrapper: parse raw args through Schema, then call typed handler
  const handler = (rawArgs: Record<string, unknown>): Effect.Effect<unknown, ToolExecutionError> =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknown(options.input)(rawArgs).pipe(
        Effect.mapError(
          (parseError) =>
            new ToolExecutionError({
              message: `Tool "${options.name}" input validation failed: ${String(parseError)}`,
              toolName: options.name,
            }),
        ),
      );
      return yield* options.handler(decoded);
    });

  return { definition, handler };
}

/**
 * Extract ToolParameter[] from an Effect Schema.
 * Handles Schema.Struct fields, optional fields, and Schema.Literal enums.
 */
function schemaToParameters(schema: Schema.Schema<any>): ToolParameter[] {
  const ast = schema.ast;

  // Handle Struct schemas
  if (ast._tag === "TypeLiteral") {
    return ast.propertySignatures.map((prop: any) => {
      const name = String(prop.name);
      const isOptional = prop.isOptional;
      const paramType = inferParamType(prop.type);
      const enumValues = inferEnumValues(prop.type);

      return {
        name,
        type: paramType,
        description: name, // Users should set descriptions via Schema.annotations in future
        required: !isOptional,
        ...(enumValues.length > 0 ? { enum: enumValues } : {}),
      } as ToolParameter;
    });
  }

  return [];
}

/**
 * Infer the ToolParameter type from an Effect Schema AST node.
 */
function inferParamType(ast: any): ToolParameter["type"] {
  // Unwrap transformations, optionals, and defaults
  const unwrapped = unwrapAST(ast);

  switch (unwrapped._tag) {
    case "StringKeyword":
      return "string";
    case "NumberKeyword":
      return "number";
    case "BooleanKeyword":
      return "boolean";
    case "TypeLiteral":
      return "object";
    case "TupleType":
      return "array";
    case "Literal":
      return typeof unwrapped.literal === "number" ? "number"
        : typeof unwrapped.literal === "boolean" ? "boolean"
        : "string";
    case "Union":
      // For literal unions (enums), infer from first member
      if (unwrapped.types?.length > 0) {
        return inferParamType(unwrapped.types[0]);
      }
      return "string";
    default:
      return "string";
  }
}

/**
 * Extract enum values from Schema.Literal unions.
 */
function inferEnumValues(ast: any): string[] {
  const unwrapped = unwrapAST(ast);

  if (unwrapped._tag === "Union") {
    const literals = unwrapped.types?.filter((t: any) => t._tag === "Literal") ?? [];
    if (literals.length > 0 && literals.every((l: any) => typeof l.literal === "string")) {
      return literals.map((l: any) => l.literal as string);
    }
  }

  if (unwrapped._tag === "Literal" && typeof unwrapped.literal === "string") {
    return [unwrapped.literal];
  }

  return [];
}

/**
 * Unwrap AST wrappers (transformations, optional, defaults) to get the core type.
 */
function unwrapAST(ast: any): any {
  if (!ast) return ast;
  // Transformation (decode/encode pipelines)
  if (ast._tag === "Transformation") return unwrapAST(ast.from);
  // Union with undefined (optional) — find the non-undefined branch
  if (ast._tag === "Union" && ast.types?.some((t: any) => t._tag === "UndefinedKeyword")) {
    const nonUndefined = ast.types.find((t: any) => t._tag !== "UndefinedKeyword");
    if (nonUndefined) return unwrapAST(nonUndefined);
  }
  return ast;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/tools/tests/define-tool.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/define-tool.ts packages/tools/tests/define-tool.test.ts
git commit -m "feat(tools): add defineTool() with schema-inferred handler types"
```

---

### Task 2: `tool()` — Simple Tool Wrapper (No Schema Required)

For users who don't want Schema ceremony. Infers parameter metadata from a plain options object.

**Files:**
- Create: `packages/tools/src/define-tool-simple.ts`
- Test: `packages/tools/tests/define-tool-simple.test.ts`

**Target API:**
```typescript
import { tool } from "@reactive-agents/tools";

// Minimal — just name, description, handler
const greetTool = tool("greet", "Greet a user by name", async (args) => {
  return `Hello, ${args.name}!`;
});

// With typed params
const searchTool = tool("search", "Search the web", {
  params: {
    query: { type: "string", required: true, description: "Search query" },
    limit: { type: "number", required: false, description: "Max results", default: 5 },
  },
  handler: async (args) => {
    return `Results for: ${args.query}`;
  },
});
```

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/tools/tests/define-tool-simple.test.ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { tool } from "../src/define-tool-simple.js";

describe("tool() simple wrapper", () => {
  it("should create a tool from name + description + handler", () => {
    const t = tool("greet", "Greet someone", async (args) => `Hi ${args.name}`);
    expect(t.definition.name).toBe("greet");
    expect(t.definition.description).toBe("Greet someone");
    expect(t.definition.parameters).toEqual([]);
  });

  it("should accept explicit params", () => {
    const t = tool("search", "Search", {
      params: {
        query: { type: "string", required: true, description: "Query" },
        limit: { type: "number", required: false, description: "Limit", default: 5 },
      },
      handler: async (args) => args.query,
    });
    expect(t.definition.parameters).toHaveLength(2);
    expect(t.definition.parameters[0]!.name).toBe("query");
    expect(t.definition.parameters[0]!.required).toBe(true);
    expect(t.definition.parameters[1]!.name).toBe("limit");
    expect(t.definition.parameters[1]!.required).toBe(false);
  });

  it("should wrap async handler into Effect", async () => {
    const t = tool("echo", "Echo input", async (args) => args.text);
    const result = await Effect.runPromise(t.handler({ text: "hello" }));
    expect(result).toBe("hello");
  });

  it("should catch handler errors as ToolExecutionError", async () => {
    const t = tool("fail", "Always fails", async () => { throw new Error("boom"); });
    const result = await Effect.runPromise(t.handler({}).pipe(Effect.either));
    expect(result._tag).toBe("Left");
  });

  it("should accept options like riskLevel, timeout, category", () => {
    const t = tool("risky", "Risky op", {
      handler: async () => "done",
      riskLevel: "high",
      timeoutMs: 60_000,
      category: "code",
    });
    expect(t.definition.riskLevel).toBe("high");
    expect(t.definition.timeoutMs).toBe(60_000);
    expect(t.definition.category).toBe("code");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/tools/tests/define-tool-simple.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `tool()`**

Create `packages/tools/src/define-tool-simple.ts`:

```typescript
import { Effect } from "effect";
import type { ToolDefinition, ToolParameter } from "./types.js";
import { ToolExecutionError } from "./errors.js";

type SimpleParam = {
  type: ToolParameter["type"];
  required?: boolean;
  description: string;
  default?: unknown;
  enum?: string[];
};

type SimpleToolOptions = {
  params?: Record<string, SimpleParam>;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  riskLevel?: ToolDefinition["riskLevel"];
  timeoutMs?: number;
  category?: ToolDefinition["category"];
  requiresApproval?: boolean;
};

type SimpleHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

export interface SimpleTool {
  readonly definition: ToolDefinition;
  readonly handler: (args: Record<string, unknown>) => Effect.Effect<unknown, ToolExecutionError>;
}

/**
 * Create a tool with minimal boilerplate. No Effect or Schema knowledge required.
 *
 * Overload 1: `tool(name, description, handler)` — simplest form
 * Overload 2: `tool(name, description, options)` — with typed params and config
 */
export function tool(
  name: string,
  description: string,
  handlerOrOptions: SimpleHandler | SimpleToolOptions,
): SimpleTool {
  const isOptions = typeof handlerOrOptions === "object" && "handler" in handlerOrOptions;
  const options: SimpleToolOptions = isOptions
    ? handlerOrOptions
    : { handler: handlerOrOptions as SimpleHandler };

  const parameters: ToolParameter[] = options.params
    ? Object.entries(options.params).map(([paramName, param]) => ({
        name: paramName,
        type: param.type,
        description: param.description,
        required: param.required ?? false,
        ...(param.default !== undefined ? { default: param.default } : {}),
        ...(param.enum ? { enum: param.enum } : {}),
      }))
    : [];

  const definition: ToolDefinition = {
    name,
    description,
    parameters,
    riskLevel: options.riskLevel ?? "low",
    timeoutMs: options.timeoutMs ?? 30_000,
    requiresApproval: options.requiresApproval ?? false,
    source: "function",
    ...(options.category ? { category: options.category } : {}),
  };

  const handler = (args: Record<string, unknown>): Effect.Effect<unknown, ToolExecutionError> =>
    Effect.tryPromise({
      try: () => Promise.resolve(options.handler(args)),
      catch: (e) =>
        new ToolExecutionError({
          message: `Tool "${name}" failed: ${e instanceof Error ? e.message : String(e)}`,
          toolName: name,
        }),
    });

  return { definition, handler };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/tools/tests/define-tool-simple.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Export from index and commit**

Add to `packages/tools/src/index.ts`:
```typescript
export { defineTool } from "./define-tool.js";
export type { DefineToolOptions, DefinedTool } from "./define-tool.js";
export { tool } from "./define-tool-simple.js";
export type { SimpleTool } from "./define-tool-simple.js";
```

Also re-export from `packages/reactive-agents/src/index.ts`.

```bash
git add packages/tools/src/define-tool-simple.ts packages/tools/tests/define-tool-simple.test.ts \
  packages/tools/src/index.ts packages/reactive-agents/src/index.ts
git commit -m "feat(tools): add tool() convenience wrapper for Effect-free tool creation"
```

---

## Chunk 2: User-Controlled Context Ingestion

### Task 3: Refactor RAG Ingest from Tool-Only to User API

Move document ingestion from agent-only (`rag-ingest` tool) to user-facing API. Keep `rag-search` as built-in tool. Make `rag-ingest` optional.

**Files:**
- Create: `packages/runtime/src/context-ingestion.ts`
- Create: `packages/runtime/tests/context-ingestion.test.ts`
- Modify: `packages/tools/src/skills/builtin.ts` — remove `rag-ingest` from auto-registration
- Modify: `packages/runtime/src/builder.ts` — add `.withDocuments()`, `agent.ingest()`, `agent.ingestFile()`

**Target API:**
```typescript
// Pre-build: user loads documents before agent runs
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withDocuments([
    { content: readFileSync("./README.md", "utf-8"), source: "README.md" },
    { content: csvData, source: "data.csv", format: "csv" },
  ])
  .withTools()    // rag-search available as built-in tool
  .build();

// Post-build: add more context dynamically
await agent.ingest("Additional context here", { source: "manual-input" });
await agent.ingest(fileContent, { source: "report.pdf", format: "text", chunkStrategy: "paragraph" });
```

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/runtime/tests/context-ingestion.test.ts
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

describe("Context Ingestion", () => {
  describe(".withDocuments()", () => {
    it("should accept documents at build time", async () => {
      const agent = await ReactiveAgents.create()
        .withName("doc-agent")
        .withProvider("test")
        .withTestScenario([{ text: "I found the answer in the docs." }])
        .withDocuments([
          { content: "The capital of France is Paris.", source: "facts.txt" },
        ])
        .withTools()
        .build();

      expect(agent).toBeDefined();
    });

    it("should make documents searchable via rag-search tool", async () => {
      const agent = await ReactiveAgents.create()
        .withName("search-agent")
        .withProvider("test")
        .withTestScenario([
          { toolCall: { name: "rag-search", args: { query: "capital of France" } } },
          { text: "The capital of France is Paris." },
        ])
        .withDocuments([
          { content: "The capital of France is Paris. The capital of Germany is Berlin.", source: "geo.txt" },
        ])
        .withTools()
        .withReasoning()
        .build();

      const result = await agent.run("What is the capital of France?");
      expect(result.success).toBe(true);
    });

    it("should accept format and chunk options", async () => {
      const agent = await ReactiveAgents.create()
        .withName("csv-agent")
        .withProvider("test")
        .withTestScenario([{ text: "Done." }])
        .withDocuments([
          {
            content: "name,age\nAlice,30\nBob,25",
            source: "people.csv",
            format: "csv",
            chunkStrategy: "fixed",
            maxChunkSize: 500,
          },
        ])
        .withTools()
        .build();

      expect(agent).toBeDefined();
    });
  });

  describe("agent.ingest()", () => {
    it("should ingest documents after build", async () => {
      const agent = await ReactiveAgents.create()
        .withName("ingest-agent")
        .withProvider("test")
        .withTestScenario([{ text: "Done." }])
        .withTools()
        .build();

      await agent.ingest("New document content here.", { source: "dynamic.txt" });
      // Should not throw
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/runtime/tests/context-ingestion.test.ts`
Expected: FAIL — `.withDocuments` / `.ingest` not found

- [ ] **Step 3: Implement context ingestion module**

Create `packages/runtime/src/context-ingestion.ts` — a helper that takes document specs, runs them through the RAG loaders/chunker, and stores chunks in the in-memory RAG store.

- [ ] **Step 4: Wire `.withDocuments()` into builder**

In `packages/runtime/src/builder.ts`:
- Add `_documents` private field (array of document specs)
- Add `withDocuments(docs)` builder method
- In `buildEffect()`, after tool registration, iterate `_documents` and call the ingest pipeline to pre-populate the RAG store
- Add `ingest(content, opts)` and `ingestFile(path, opts)` to `ReactiveAgent` class

- [ ] **Step 5: Remove `rag-ingest` from auto-registration in builtins**

In `packages/tools/src/skills/builtin.ts`: remove the `ragIngestTool` entry from the `builtinTools` array. Keep `ragSearchTool`. Update the `tool-service.test.ts` count accordingly (11 → 10).

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test packages/runtime/tests/context-ingestion.test.ts packages/tools/tests/tool-service.test.ts`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/context-ingestion.ts packages/runtime/tests/context-ingestion.test.ts \
  packages/runtime/src/builder.ts packages/tools/src/skills/builtin.ts packages/tools/tests/tool-service.test.ts
git commit -m "feat(runtime): add .withDocuments() and agent.ingest() for user-controlled RAG"
```

---

## Chunk 3: Effect-Free Convenience Utilities

### Task 4: `agent.on()` — Promise-Based Event Subscription

Users shouldn't need Effect to subscribe to agent events.

**Files:**
- Modify: `packages/runtime/src/builder.ts` — add `on()` method to ReactiveAgent
- Create: `packages/runtime/tests/convenience-api.test.ts`

**Target API:**
```typescript
// Effect-free event subscription
agent.on("TextDelta", (event) => {
  process.stdout.write(event.text);  // event is typed!
});

agent.on("ToolCallCompleted", (event) => {
  console.log(`Tool ${event.toolName} completed in ${event.durationMs}ms`);
});

// Still works with Effect for power users:
agent.subscribe("TextDelta", (event) => Effect.sync(() => console.log(event.text)));
```

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/runtime/tests/convenience-api.test.ts
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

describe("Convenience API", () => {
  describe("agent.on()", () => {
    it("should subscribe to events with a plain callback", async () => {
      const events: string[] = [];

      const agent = await ReactiveAgents.create()
        .withName("on-agent")
        .withProvider("test")
        .withTestScenario([{ text: "Hello there!" }])
        .build();

      agent.on("FinalAnswerProduced", (event) => {
        events.push(event.answer);
      });

      await agent.run("Say hello");
      expect(events.length).toBeGreaterThan(0);
    });

    it("should return an unsubscribe function", async () => {
      let callCount = 0;

      const agent = await ReactiveAgents.create()
        .withName("unsub-agent")
        .withProvider("test")
        .withTestScenario([{ text: "First" }, { text: "Second" }])
        .build();

      const unsub = agent.on("FinalAnswerProduced", () => { callCount++; });
      await agent.run("First run");
      unsub();
      // After unsub, no more events
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/runtime/tests/convenience-api.test.ts`
Expected: FAIL — `agent.on` is not a function

- [ ] **Step 3: Implement `agent.on()` in ReactiveAgent**

In `packages/runtime/src/builder.ts`, add to the `ReactiveAgent` class:

```typescript
/**
 * Subscribe to agent events with a plain callback (no Effect required).
 * Returns an unsubscribe function.
 */
on<T extends AgentEventTag>(
  tag: T,
  callback: (event: Extract<AgentEvent, { _tag: T }>) => void,
): () => void {
  let unsubscribed = false;
  this.subscribe(tag, (event) =>
    Effect.sync(() => {
      if (!unsubscribed) callback(event);
    }),
  );
  return () => { unsubscribed = true; };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/runtime/tests/convenience-api.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/builder.ts packages/runtime/tests/convenience-api.test.ts
git commit -m "feat(runtime): add agent.on() for Effect-free event subscription"
```

---

### Task 5: Export Everything from Umbrella Package

Ensure all new utilities are accessible from the main `reactive-agents` package.

**Files:**
- Modify: `packages/reactive-agents/src/index.ts`

- [ ] **Step 1: Add re-exports**

```typescript
// In packages/reactive-agents/src/index.ts, add:
export { defineTool, tool } from "@reactive-agents/tools";
export type { DefineToolOptions, DefinedTool, SimpleTool } from "@reactive-agents/tools";
```

- [ ] **Step 2: Run umbrella tests**

Run: `bun test packages/reactive-agents/tests/umbrella-integration.test.ts`
Expected: PASS

- [ ] **Step 3: Build all packages**

Run: `bun run build`
Expected: All packages build successfully

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: All existing tests pass + new tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/reactive-agents/src/index.ts
git commit -m "feat: export defineTool and tool from umbrella package"
```

---

## Summary

| Task | What | Tests |
|------|------|-------|
| 1 | `defineTool()` — Schema-inferred type-safe tools | 7 |
| 2 | `tool()` — Effect-free simple tool wrapper | 5 |
| 3 | `.withDocuments()` + `agent.ingest()` — user-controlled RAG | 4 |
| 4 | `agent.on()` — Promise-based event subscription | 2 |
| 5 | Umbrella exports + full suite verification | — |
| **Total** | | **~18 new tests** |
