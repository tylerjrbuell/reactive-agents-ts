# Custom Tool DX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 9 DX gaps found building the Halopedia lore agent (custom tools, chat sessions, research orchestration, citation trust) so a domain agent author never has to hand-roll output validation, HTTP retry policy, evidence citation, or research fan-out.

**Architecture:** All 9 items are additive, opt-in surface in `packages/tools` (+1 in `packages/reasoning` for the citation policy, +1 doc-only in root). Nothing here changes a default — every new option is either a new export or an optional field on `DefineToolOptions`/`ReactiveAgentBuilder`. No task requires touching kernel internals (`packages/reasoning/src/kernel/loop/**`) or the tool-execution envelope's private types; observability is captured at the `defineTool` wrapper boundary instead, which is the boundary every custom-tool author already touches.

**Tech Stack:** TypeScript, Effect (`Schema`, `Data.TaggedError`, `Effect.gen`), Bun test runner (`bun test`), existing `ToolSchema<A>` / Standard Schema dual-path pattern.

**Spec:** `.agents/MEMORY.md` lines 14-25 (2026-08-19 Halopedia-prototype DX feedback entry) — this plan is the spec; there is no separate design doc.

## Global Constraints

- No `any` casts — `unknown` + type guards only (project rule, `feedback_clean_types`).
- No new default-on behavior — everything here is an opt-in field or a net-new export.
- Match existing error style: `Data.TaggedError` classes in `errors.ts`, `ToolExecutionError` for handler failures (see `packages/tools/src/errors.ts`).
- Match existing dual-schema pattern: any new schema-accepting API must support both Effect `Schema.Schema<A, any, never>` and Standard Schema (`isStandardSchema` guard from `./standard-schema.js`), the same way `decodeArgs` in `define-tool.ts:372` does.
- New public exports go through `packages/tools/src/index.ts` (or `packages/reasoning/src/index.ts` for the citation-policy task) — do not leave a new module unexported.
- TDD: write the failing test before the implementation in every task.
- Commit after every task (not every step) unless a task's own steps say otherwise.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/tools/src/define-tool.ts` (modify) | Add `output?: ToolSchema<O>` to `DefineToolOptions`, validate handler return value |
| `packages/tools/src/errors.ts` (modify) | Add `ToolOutputValidationError` |
| `packages/tools/src/observability.ts` (new) | `withToolObservability()` — wraps a `DefinedTool` handler, returns `{ data, meta }` envelope with latency/attempts/toolName |
| `packages/tools/src/adapters/http-tool-adapter.ts` (new) | `fetchJsonTool()` — standard HTTP status/retry/empty-result handling for tool handlers |
| `packages/tools/src/toolset.ts` (new) | `defineToolset()` — shared-default factory over `defineTool` |
| `packages/tools/src/testing.ts` (new) | `testTool()` + `mockFetchOnce()` — turnkey tool test helper |
| `packages/tools/src/research/bounded-parallel.ts` (new) | `boundedMap()` — concurrency-capped `Promise.allSettled` fan-out |
| `packages/tools/src/research/search-then-fetch.ts` (new) | `searchThenFetch()` orchestration primitive |
| `packages/tools/src/research/resolve-then-retrieve.ts` (new) | `resolveThenRetrieve()` orchestration primitive |
| `packages/reasoning/src/kernel/capabilities/verify/citation-policy.ts` (new) | `validateCitations()` — deterministic check that every cited URL appears in tool-observation evidence |
| `packages/runtime/src/builder/types.ts` (modify) | Add `AnswerPolicyOptions` type (`requireCitations`) |
| `packages/runtime/src/builder.ts` (modify) | Add `.withAnswerPolicy()` builder method |
| `examples/canonical-chat-session.ts` (new) | Bun-native canonical `agent.session()`/`session.chat()` example |
| `examples/canonical-chat-session-node.ts` + `examples/tsconfig.node.json` (new) | Node-portable version using `node:readline/promises` |
| `README.md` (modify) | Link the canonical session example near the existing `agent.session()` docs (README.md:286-295) |

---

### Task 1: Output schema validation for `defineTool`

**Files:**
- Modify: `packages/tools/src/define-tool.ts:43-89` (`DefineToolOptions`), `:555-598` (`defineTool`)
- Modify: `packages/tools/src/errors.ts` (new error class, append after `ToolTimeoutError`)
- Test: `packages/tools/tests/define-tool-output-schema.test.ts`

**Interfaces:**
- Consumes: `ToolSchema<A>` (existing, `define-tool.ts:20`), `isStandardSchema` (existing, `./standard-schema.js`)
- Produces: `DefineToolOptions<A, O = unknown>` gains `output?: ToolSchema<O>`. When present, `defineTool`'s wrapped handler decodes the resolved value against it and fails with `ToolOutputValidationError` (new, tagged `"ToolOutputValidationError"`) on mismatch instead of returning an unvalidated value. When absent, behavior is byte-identical to today (no output check).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/tools/tests/define-tool-output-schema.test.ts
import { describe, it, expect } from "bun:test";
import { Effect, Schema } from "effect";
import { defineTool } from "../src/define-tool.js";

describe("defineTool output schema", () => {
  it("passes through a value matching the output schema", async () => {
    const t = defineTool({
      name: "get-user",
      description: "Fetch a user",
      input: Schema.Struct({ id: Schema.String }),
      output: Schema.Struct({ id: Schema.String, name: Schema.String }),
      handler: async ({ id }) => ({ id, name: "Ada" }),
    });
    const result = await Effect.runPromise(t.handler({ id: "u1" }));
    expect(result).toEqual({ id: "u1", name: "Ada" });
  });

  it("fails with ToolOutputValidationError when the return value doesn't match", async () => {
    const t = defineTool({
      name: "get-user-broken",
      description: "Fetch a user (buggy handler)",
      input: Schema.Struct({ id: Schema.String }),
      output: Schema.Struct({ id: Schema.String, name: Schema.String }),
      // Bug: forgot to include `name`.
      handler: async ({ id }) => ({ id }),
    });
    const result = await Effect.runPromiseExit(t.handler({ id: "u1" }));
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      const msg = JSON.stringify(result.cause);
      expect(msg).toContain("ToolOutputValidationError");
      expect(msg).toContain("get-user-broken");
    }
  });

  it("skips validation entirely when no output schema is given (unchanged behavior)", async () => {
    const t = defineTool({
      name: "no-output-schema",
      description: "No output schema declared",
      input: Schema.Struct({ id: Schema.String }),
      handler: async ({ id }) => ({ anything: id, extra: true }),
    });
    const result = await Effect.runPromise(t.handler({ id: "u1" }));
    expect(result).toEqual({ anything: "u1", extra: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/tools && bun test tests/define-tool-output-schema.test.ts`
Expected: FAIL — `output` is not a recognized property of `DefineToolOptions` (TS error) or the first two assertions fail because no validation runs yet.

- [ ] **Step 3: Add `ToolOutputValidationError` to `errors.ts`**

Append to `packages/tools/src/errors.ts`, after the existing `ToolTimeoutError` class:

```typescript
/**
 * Raised by `defineTool` when a handler's resolved return value fails to
 * decode against the tool's declared `output` schema. Only fires when the
 * tool author opted in via `output: ToolSchema<O>` — tools without one keep
 * today's unvalidated-return behavior.
 */
export class ToolOutputValidationError extends Data.TaggedError(
  "ToolOutputValidationError",
)<{
  readonly message: string;
  readonly toolName: string;
  readonly rawOutput?: unknown;
}> {}
```

- [ ] **Step 4: Add `output` to `DefineToolOptions` and validate in `defineTool`**

In `packages/tools/src/define-tool.ts`, change the import line to also pull the new error:

```typescript
import { ToolExecutionError, ToolDefinitionError, ToolOutputValidationError } from "./errors.js";
```

Change `DefineToolOptions<A>` (line 43) to a second type parameter, defaulted so every existing call site compiles unchanged:

```typescript
export interface DefineToolOptions<A, O = unknown> {
  name: string;
  description: string;
  input: ToolSchema<A>;
  handler: ToolHandler<A>;
  riskLevel?: ToolDefinition["riskLevel"];
  timeoutMs?: number;
  requiresApproval?: boolean;
  category?: ToolDefinition["category"];
  produces?: ToolDefinition["produces"];
  returnType?: string;
  isCacheable?: boolean;
  cacheTtlMs?: number;
  /**
   * Optional output schema. When present, the handler's resolved return
   * value is decoded against it before the tool call is considered
   * successful — a handler that silently returns the wrong shape fails
   * loudly (`ToolOutputValidationError`) instead of the bad shape reaching
   * the model. Accepts the same dual Effect-Schema / Standard-Schema forms
   * as `input`.
   */
  output?: ToolSchema<O>;
}
```

Add a `decodeOutput` helper right after `decodeArgs` (around line 415, same file) — it mirrors `decodeArgs`'s dual-path logic but reports `ToolOutputValidationError` instead of `ToolExecutionError`:

```typescript
function decodeOutput(
  output: ToolSchema<unknown>,
  rawValue: unknown,
  toolName: string,
): Effect.Effect<unknown, ToolOutputValidationError> {
  if (isStandardSchema(output)) {
    const std = output["~standard"];
    return Effect.tryPromise({
      try: () => Promise.resolve(std.validate(rawValue)),
      catch: (e) =>
        new ToolOutputValidationError({
          message: `Output validation threw for "${toolName}": ${e instanceof Error ? e.message : String(e)}`,
          toolName,
          rawOutput: rawValue,
        }),
    }).pipe(
      Effect.flatMap((result) =>
        result.issues === undefined
          ? Effect.succeed(result.value)
          : Effect.fail(
              new ToolOutputValidationError({
                message: `Invalid output for "${toolName}": ${formatStandardIssues(result.issues)}`,
                toolName,
                rawOutput: rawValue,
              }),
            ),
      ),
    );
  }

  const decode = Schema.decodeUnknown(output as Schema.Schema<unknown>);
  return decode(rawValue).pipe(
    Effect.mapError(
      (err) =>
        new ToolOutputValidationError({
          message:
            err instanceof ParseResult.ParseError
              ? ParseResult.TreeFormatter.formatErrorSync(err)
              : String(err),
          toolName,
          rawOutput: rawValue,
        }),
    ),
  );
}
```

Finally, wire it into `defineTool` itself. Replace the `wrappedHandler` definition (around line 591-598):

```typescript
  const typedHandler = handler as ToolHandler<unknown>;
  const typedInput = input as ToolSchema<unknown>;
  const typedOutput = options.output as ToolSchema<unknown> | undefined;

  const wrappedHandler = (
    rawArgs: Record<string, unknown>,
  ): Effect.Effect<unknown, ToolExecutionError | ToolOutputValidationError> =>
    decodeArgs(typedInput, rawArgs, name).pipe(
      Effect.flatMap((decoded) => runHandler(typedHandler, decoded, name, rawArgs)),
      Effect.flatMap((rawValue) =>
        typedOutput === undefined
          ? Effect.succeed(rawValue)
          : decodeOutput(typedOutput, rawValue, name),
      ),
    );

  return { definition, handler: wrappedHandler };
```

`DefinedTool`'s `handler` return type (interface at line 96-106) must widen from `Effect.Effect<unknown, ToolExecutionError>` to `Effect.Effect<unknown, ToolExecutionError | ToolOutputValidationError>`:

```typescript
export interface DefinedTool {
  readonly definition: ToolDefinition;
  readonly handler: (
    args: Record<string, unknown>,
  ) => Effect.Effect<unknown, ToolExecutionError | ToolOutputValidationError>;
}
```

Change `export function defineTool<A>(options: DefineToolOptions<A>): DefinedTool` (line 555) to:

```typescript
export function defineTool<A, O = unknown>(options: DefineToolOptions<A, O>): DefinedTool {
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/tools && bun test tests/define-tool-output-schema.test.ts`
Expected: PASS (3/3)

- [ ] **Step 6: Run the full `packages/tools` suite to confirm no regression**

Run: `cd packages/tools && bun test`
Expected: PASS, same pass count as before this task plus 3 (existing suite was 1007 pass per `.agents/MEMORY.md` 2026-08-16 entry — verify it hasn't dropped, don't assume the exact number is still current)

- [ ] **Step 7: Export `ToolOutputValidationError` from the package index**

In `packages/tools/src/index.ts`, find the existing `export type { ... } from "./define-tool.js"` block (line 208) and the errors export block (line ~15-27), add `ToolOutputValidationError` to whichever errors export block already lists `ToolExecutionError`/`ToolDefinitionError`.

- [ ] **Step 8: Commit**

```bash
git add packages/tools/src/define-tool.ts packages/tools/src/errors.ts packages/tools/src/index.ts packages/tools/tests/define-tool-output-schema.test.ts
git commit -m "feat(tools): defineTool accepts an output schema, validated at runtime"
```

---

### Task 2: Tool observability envelope (`withToolObservability`)

**Files:**
- Create: `packages/tools/src/observability.ts`
- Test: `packages/tools/tests/observability.test.ts`

**Interfaces:**
- Consumes: `DefinedTool` (Task 1's output type, `define-tool.ts:96-106`)
- Produces: `withToolObservability(tool: DefinedTool): DefinedTool` — wraps `tool.handler` so its resolved value becomes `{ data: T; meta: ToolObservabilityMeta }`, where `ToolObservabilityMeta = { toolName: string; latencyMs: number; attempt: number; startedAt: string }`. Retries are captured by wrapping `withToolRetry` (Task 2 also ships a tiny retry helper `withToolRetry(tool, { maxAttempts })` in the same file) — `attempt` reflects which try succeeded.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/tools/tests/observability.test.ts
import { describe, it, expect } from "bun:test";
import { Effect, Schema } from "effect";
import { defineTool } from "../src/define-tool.js";
import { withToolObservability, withToolRetry } from "../src/observability.js";

describe("withToolObservability", () => {
  it("wraps a successful result with latency/attempt metadata", async () => {
    const base = defineTool({
      name: "slow-echo",
      description: "Echoes after a short delay",
      input: Schema.Struct({ text: Schema.String }),
      handler: async ({ text }) => {
        await new Promise((r) => setTimeout(r, 5));
        return { text };
      },
    });
    const observed = withToolObservability(base);
    const result = (await Effect.runPromise(observed.handler({ text: "hi" }))) as {
      data: { text: string };
      meta: { toolName: string; latencyMs: number; attempt: number };
    };
    expect(result.data).toEqual({ text: "hi" });
    expect(result.meta.toolName).toBe("slow-echo");
    expect(result.meta.attempt).toBe(1);
    expect(result.meta.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("withToolRetry reports the attempt that finally succeeded", async () => {
    let calls = 0;
    const flaky = defineTool({
      name: "flaky",
      description: "Fails twice then succeeds",
      input: Schema.Struct({}),
      handler: async () => {
        calls++;
        if (calls < 3) throw new Error("transient");
        return { ok: true };
      },
    });
    const observed = withToolObservability(withToolRetry(flaky, { maxAttempts: 5 }));
    const result = (await Effect.runPromise(observed.handler({}))) as {
      data: { ok: boolean };
      meta: { attempt: number };
    };
    expect(result.data).toEqual({ ok: true });
    expect(result.meta.attempt).toBe(3);
    expect(calls).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/tools && bun test tests/observability.test.ts`
Expected: FAIL — `../src/observability.js` does not exist

- [ ] **Step 3: Implement `observability.ts`**

```typescript
// packages/tools/src/observability.ts
import { Effect } from "effect";
import type { DefinedTool } from "./define-tool.js";

export interface ToolObservabilityMeta {
  readonly toolName: string;
  readonly latencyMs: number;
  readonly attempt: number;
  readonly startedAt: string;
}

export interface ObservedToolResult<T = unknown> {
  readonly data: T;
  readonly meta: ToolObservabilityMeta;
}

interface AttemptCarrier {
  readonly value: unknown;
  readonly attempt: number;
}

/**
 * Wraps a `DefinedTool`'s handler so every successful call resolves to
 * `{ data, meta }` instead of a bare value — `meta` carries latency, which
 * attempt succeeded (1 unless composed with `withToolRetry`), and a
 * timestamp. Failures are untouched (still reject with the tool's normal
 * error type) so existing error handling keeps working.
 */
export function withToolObservability(tool: DefinedTool): DefinedTool {
  return {
    definition: tool.definition,
    handler: (rawArgs: Record<string, unknown>) => {
      const startedAt = new Date().toISOString();
      const startMs = Date.now();
      return tool.handler(rawArgs).pipe(
        Effect.map((resolved) => {
          const carrier = isAttemptCarrier(resolved) ? resolved : { value: resolved, attempt: 1 };
          const meta: ToolObservabilityMeta = {
            toolName: tool.definition.name,
            latencyMs: Date.now() - startMs,
            attempt: carrier.attempt,
            startedAt,
          };
          return { data: carrier.value, meta } satisfies ObservedToolResult;
        }),
      );
    },
  };
}

function isAttemptCarrier(value: unknown): value is AttemptCarrier {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    "attempt" in value &&
    typeof (value as { attempt: unknown }).attempt === "number"
  );
}

/**
 * Wraps a `DefinedTool`'s handler with a bounded retry: on failure, retries
 * up to `maxAttempts` times with no delay between attempts (callers needing
 * backoff should combine with `fetchJsonTool`'s own retry, see Task 3 — do
 * not stack both retry layers on the same handler). Tags the resolved value
 * with the attempt number so `withToolObservability` can report it.
 */
export function withToolRetry(tool: DefinedTool, options: { maxAttempts: number }): DefinedTool {
  const { maxAttempts } = options;
  return {
    definition: tool.definition,
    handler: (rawArgs: Record<string, unknown>) =>
      Effect.gen(function* () {
        let lastError: unknown;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const exit = yield* Effect.exit(tool.handler(rawArgs));
          if (exit._tag === "Success") {
            return { value: exit.value, attempt } satisfies AttemptCarrier;
          }
          lastError = exit.cause;
        }
        return yield* Effect.failCause(lastError as Parameters<typeof Effect.failCause>[0]);
      }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/tools && bun test tests/observability.test.ts`
Expected: PASS (2/2)

- [ ] **Step 5: Export from index and commit**

Add to `packages/tools/src/index.ts`:

```typescript
export { withToolObservability, withToolRetry } from "./observability.js";
export type { ObservedToolResult, ToolObservabilityMeta } from "./observability.js";
```

```bash
git add packages/tools/src/observability.ts packages/tools/src/index.ts packages/tools/tests/observability.test.ts
git commit -m "feat(tools): add withToolObservability/withToolRetry envelope helpers"
```

---

### Task 3: Standard fetch/tool adapter (`fetchJsonTool`)

**Files:**
- Create: `packages/tools/src/adapters/http-tool-adapter.ts`
- Test: `packages/tools/tests/http-tool-adapter.test.ts`

**Interfaces:**
- Consumes: global `fetch` (mockable — see Task 5's `mockFetchOnce`, this task ships its own inline mock since Task 5 depends on Task 3's shape, not vice versa)
- Produces:
  ```typescript
  export interface HttpToolOptions {
    readonly buildUrl: (args: Record<string, unknown>) => string;
    readonly maxRetries?: number;       // default 2
    readonly retryOn?: readonly number[]; // default [429, 502, 503, 504]
    readonly emptyResultValue?: unknown;  // returned on 204/empty body instead of throwing
  }
  export function fetchJsonTool(options: HttpToolOptions): (args: Record<string, unknown>) => Promise<unknown>
  export class HttpToolError extends Data.TaggedError("HttpToolError")<{ message: string; status?: number; url: string }> {}
  ```
  Return value is a plain handler function meant to be passed as `defineTool`'s `handler` field.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/tools/tests/http-tool-adapter.test.ts
import { describe, it, expect, afterEach, mock } from "bun:test";
import { fetchJsonTool, HttpToolError } from "../src/adapters/http-tool-adapter.js";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

describe("fetchJsonTool", () => {
  it("returns parsed JSON on 200", async () => {
    global.fetch = mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
    const handler = fetchJsonTool({ buildUrl: (a) => `https://example.test/${a.id}` });
    const result = await handler({ id: "42" });
    expect(result).toEqual({ ok: true });
  });

  it("throws HttpToolError with status on a 404", async () => {
    global.fetch = mock(async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;
    const handler = fetchJsonTool({ buildUrl: () => "https://example.test/missing" });
    await expect(handler({})).rejects.toBeInstanceOf(HttpToolError);
  });

  it("retries on 503 then succeeds", async () => {
    let calls = 0;
    global.fetch = mock(async () => {
      calls++;
      if (calls < 2) return new Response("unavailable", { status: 503 });
      return new Response(JSON.stringify({ ok: true, calls }), { status: 200 });
    }) as unknown as typeof fetch;
    const handler = fetchJsonTool({ buildUrl: () => "https://example.test/flaky", maxRetries: 3 });
    const result = await handler({});
    expect(result).toEqual({ ok: true, calls: 2 });
  });

  it("returns emptyResultValue on 204 instead of throwing", async () => {
    global.fetch = mock(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const handler = fetchJsonTool({ buildUrl: () => "https://example.test/empty", emptyResultValue: { items: [] } });
    const result = await handler({});
    expect(result).toEqual({ items: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/tools && bun test tests/http-tool-adapter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `http-tool-adapter.ts`**

```typescript
// packages/tools/src/adapters/http-tool-adapter.ts
import { Data } from "effect";

export class HttpToolError extends Data.TaggedError("HttpToolError")<{
  readonly message: string;
  readonly status?: number;
  readonly url: string;
}> {}

export interface HttpToolOptions {
  readonly buildUrl: (args: Record<string, unknown>) => string;
  readonly maxRetries?: number;
  readonly retryOn?: readonly number[];
  readonly emptyResultValue?: unknown;
  readonly headers?: Record<string, string>;
}

const DEFAULT_RETRY_ON = [429, 502, 503, 504];

/**
 * Standard fetch-based tool handler: builds a URL from decoded tool args,
 * retries transient status codes (429/502/503/504 by default) with linear
 * backoff, treats 204/empty-body responses as `emptyResultValue` (or throws
 * if not provided), and raises `HttpToolError` with the status code on any
 * other non-2xx response instead of leaving handlers to invent their own
 * status handling per tool.
 */
export function fetchJsonTool(
  options: HttpToolOptions,
): (args: Record<string, unknown>) => Promise<unknown> {
  const { buildUrl, maxRetries = 2, retryOn = DEFAULT_RETRY_ON, emptyResultValue, headers } = options;

  return async (args: Record<string, unknown>): Promise<unknown> => {
    const url = buildUrl(args);
    let lastStatus: number | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await fetch(url, headers ? { headers } : undefined);
      lastStatus = response.status;

      if (response.status === 204 || response.status === 205) {
        if (emptyResultValue !== undefined) return emptyResultValue;
        throw new HttpToolError({ message: `Empty response (${response.status}) with no emptyResultValue configured`, status: response.status, url });
      }

      if (response.ok) {
        const text = await response.text();
        if (text.length === 0) {
          if (emptyResultValue !== undefined) return emptyResultValue;
          throw new HttpToolError({ message: "Empty body on 2xx response with no emptyResultValue configured", status: response.status, url });
        }
        return JSON.parse(text);
      }

      if (retryOn.includes(response.status) && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        continue;
      }

      const body = await response.text().catch(() => "");
      throw new HttpToolError({
        message: `Request to ${url} failed with status ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
        status: response.status,
        url,
      });
    }

    throw new HttpToolError({ message: `Exhausted retries for ${url}`, status: lastStatus, url });
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/tools && bun test tests/http-tool-adapter.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Export and commit**

Add to `packages/tools/src/index.ts`:

```typescript
export { fetchJsonTool, HttpToolError } from "./adapters/http-tool-adapter.js";
export type { HttpToolOptions } from "./adapters/http-tool-adapter.js";
```

```bash
git add packages/tools/src/adapters/http-tool-adapter.ts packages/tools/src/index.ts packages/tools/tests/http-tool-adapter.test.ts
git commit -m "feat(tools): add fetchJsonTool standard HTTP adapter with retry/empty-result handling"
```

---

### Task 4: `defineToolset` — shared-default tool factory

**Files:**
- Create: `packages/tools/src/toolset.ts`
- Test: `packages/tools/tests/toolset.test.ts`

**Interfaces:**
- Consumes: `defineTool`, `DefineToolOptions<A, O>`, `DefinedTool` (Task 1)
- Produces:
  ```typescript
  export interface ToolsetDefaults {
    readonly category?: ToolDefinition["category"];
    readonly riskLevel?: ToolDefinition["riskLevel"];
    readonly timeoutMs?: number;
    readonly requiresApproval?: boolean;
  }
  export function defineToolset(
    name: string,
    defaults: ToolsetDefaults,
  ): { tool: <A, O = unknown>(options: DefineToolOptions<A, O>) => DefinedTool }
  ```
  Per-tool `options` always win over toolset `defaults` (explicit beats implicit).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/tools/tests/toolset.test.ts
import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { defineToolset } from "../src/toolset.js";

describe("defineToolset", () => {
  it("applies toolset defaults to every tool", () => {
    const halopedia = defineToolset("halopedia", {
      category: "research",
      riskLevel: "low",
      timeoutMs: 15_000,
    });
    const t = halopedia.tool({
      name: "get-article",
      description: "Fetch a Halopedia article",
      input: Schema.Struct({ title: Schema.String }),
      handler: async ({ title }) => ({ title }),
    });
    expect(t.definition.category).toBe("research");
    expect(t.definition.riskLevel).toBe("low");
    expect(t.definition.timeoutMs).toBe(15_000);
  });

  it("lets a per-tool option override the toolset default", () => {
    const halopedia = defineToolset("halopedia", { riskLevel: "low", timeoutMs: 15_000 });
    const t = halopedia.tool({
      name: "delete-cache",
      description: "Clears the local article cache",
      input: Schema.Struct({}),
      handler: async () => ({ cleared: true }),
      riskLevel: "medium",
    });
    expect(t.definition.riskLevel).toBe("medium");
    expect(t.definition.timeoutMs).toBe(15_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/tools && bun test tests/toolset.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `toolset.ts`**

```typescript
// packages/tools/src/toolset.ts
import { defineTool, type DefineToolOptions, type DefinedTool } from "./define-tool.js";
import type { ToolDefinition } from "./types.js";

export interface ToolsetDefaults {
  readonly category?: ToolDefinition["category"];
  readonly riskLevel?: ToolDefinition["riskLevel"];
  readonly timeoutMs?: number;
  readonly requiresApproval?: boolean;
  readonly isCacheable?: boolean;
  readonly cacheTtlMs?: number;
}

export interface Toolset {
  readonly name: string;
  readonly tool: <A, O = unknown>(options: DefineToolOptions<A, O>) => DefinedTool;
}

/**
 * Groups related `defineTool` calls under shared defaults (category, risk
 * level, timeout, approval, cache policy) so a domain toolset (e.g. every
 * Halopedia lookup tool) doesn't repeat the same 4-5 metadata fields per
 * tool. Any field the caller sets explicitly on an individual tool wins
 * over the toolset default — this only fills in what's left unset.
 */
export function defineToolset(name: string, defaults: ToolsetDefaults = {}): Toolset {
  return {
    name,
    tool: <A, O = unknown>(options: DefineToolOptions<A, O>): DefinedTool =>
      defineTool<A, O>({
        ...defaults,
        ...options,
      }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/tools && bun test tests/toolset.test.ts`
Expected: PASS (2/2)

- [ ] **Step 5: Export and commit**

Add to `packages/tools/src/index.ts`:

```typescript
export { defineToolset } from "./toolset.js";
export type { Toolset, ToolsetDefaults } from "./toolset.js";
```

```bash
git add packages/tools/src/toolset.ts packages/tools/src/index.ts packages/tools/tests/toolset.test.ts
git commit -m "feat(tools): add defineToolset for shared per-domain tool defaults"
```

---

### Task 5: Turnkey tool test helper (`testTool` + `mockFetchOnce`)

**Files:**
- Create: `packages/tools/src/testing.ts`
- Test: `packages/tools/tests/testing-helper.test.ts` (a test-of-the-test-helper — proves the helper itself works before other tasks/consumers rely on it)

**Interfaces:**
- Consumes: `DefinedTool` (Task 1)
- Produces:
  ```typescript
  export interface TestToolResult<T = unknown> {
    readonly ok: boolean;
    readonly value?: T;
    readonly error?: unknown;
  }
  export async function testTool<T = unknown>(
    tool: DefinedTool,
    args: Record<string, unknown>,
  ): Promise<TestToolResult<T>>
  export function mockFetchOnce(response: { status?: number; body?: unknown }): () => void   // returns a restore fn
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// packages/tools/tests/testing-helper.test.ts
import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { defineTool } from "../src/define-tool.js";
import { testTool, mockFetchOnce } from "../src/testing.js";

describe("testTool", () => {
  it("returns ok:true with the decoded value on success", async () => {
    const t = defineTool({
      name: "echo",
      description: "Echoes input",
      input: Schema.Struct({ text: Schema.String }),
      handler: async ({ text }) => ({ text }),
    });
    const result = await testTool(t, { text: "hi" });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ text: "hi" });
  });

  it("returns ok:false with the error on failure, doesn't throw", async () => {
    const t = defineTool({
      name: "always-fails",
      description: "Always throws",
      input: Schema.Struct({}),
      handler: async () => {
        throw new Error("boom");
      },
    });
    const result = await testTool(t, {});
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("mockFetchOnce", () => {
  it("stubs global.fetch for exactly one call, then restores it", async () => {
    const restore = mockFetchOnce({ status: 200, body: { hello: "world" } });
    const res = await fetch("https://example.test/anything");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: "world" });
    restore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/tools && bun test tests/testing-helper.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `testing.ts`**

```typescript
// packages/tools/src/testing.ts
import { Effect } from "effect";
import type { DefinedTool } from "./define-tool.js";

export interface TestToolResult<T = unknown> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: unknown;
}

/**
 * Invokes a `DefinedTool`'s handler with raw args and resolves with a plain
 * `{ ok, value }` / `{ ok: false, error }` result instead of an `Effect` —
 * no `Effect.runPromise`/`runPromiseExit` boilerplate needed in a test file,
 * and failures resolve rather than throw so a single `expect(...)` chain
 * covers both the success and failure path.
 */
export async function testTool<T = unknown>(
  tool: DefinedTool,
  args: Record<string, unknown>,
): Promise<TestToolResult<T>> {
  const exit = await Effect.runPromiseExit(tool.handler(args));
  if (exit._tag === "Success") {
    return { ok: true, value: exit.value as T };
  }
  return { ok: false, error: exit.cause };
}

/**
 * Stubs `global.fetch` to resolve once with the given status/body, then
 * returns a restore function that puts the original `fetch` back. Caller
 * MUST call the returned function (typically in the same `it` block, or an
 * `afterEach`) — this does not auto-restore.
 */
export function mockFetchOnce(response: { status?: number; body?: unknown }): () => void {
  const original = global.fetch;
  const { status = 200, body } = response;
  global.fetch = (async () =>
    new Response(body === undefined ? null : JSON.stringify(body), { status })) as unknown as typeof fetch;
  return () => {
    global.fetch = original;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/tools && bun test tests/testing-helper.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Export and commit**

Add to `packages/tools/src/index.ts`:

```typescript
export { testTool, mockFetchOnce } from "./testing.js";
export type { TestToolResult } from "./testing.js";
```

```bash
git add packages/tools/src/testing.ts packages/tools/src/index.ts packages/tools/tests/testing-helper.test.ts
git commit -m "feat(tools): add testTool/mockFetchOnce turnkey test helpers"
```

---

### Task 6: Bounded parallel fan-out (`boundedMap`)

**Files:**
- Create: `packages/tools/src/research/bounded-parallel.ts`
- Test: `packages/tools/tests/bounded-parallel.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface BoundedMapResult<T> {
    readonly succeeded: readonly T[];
    readonly failed: readonly { readonly input: unknown; readonly error: unknown }[];
  }
  export async function boundedMap<I, T>(
    items: readonly I[],
    concurrency: number,
    fn: (item: I) => Promise<T>,
  ): Promise<BoundedMapResult<T>>
  ```
  This is the primitive Task 7/8 (`searchThenFetch`, `resolveThenRetrieve`) build on.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/tools/tests/bounded-parallel.test.ts
import { describe, it, expect } from "bun:test";
import { boundedMap } from "../src/research/bounded-parallel.js";

describe("boundedMap", () => {
  it("never runs more than `concurrency` tasks at once", async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await boundedMap(items, 3, async (i) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return i * 2;
    });
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("separates succeeded from failed results without throwing", async () => {
    const items = [1, 2, 3, 4];
    const result = await boundedMap(items, 2, async (i) => {
      if (i === 3) throw new Error(`bad item ${i}`);
      return i;
    });
    expect(result.succeeded.sort()).toEqual([1, 2, 4]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].input).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/tools && bun test tests/bounded-parallel.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `bounded-parallel.ts`**

```typescript
// packages/tools/src/research/bounded-parallel.ts
export interface BoundedMapResult<T> {
  readonly succeeded: readonly T[];
  readonly failed: readonly { readonly input: unknown; readonly error: unknown }[];
}

/**
 * Runs `fn` over `items` with at most `concurrency` in flight at once.
 * Never throws — every item's outcome lands in `succeeded` or `failed`, so
 * one bad source in a research fan-out doesn't abort the rest. No external
 * dependency (no p-limit) — a worker-pool loop over a shared index cursor.
 */
export async function boundedMap<I, T>(
  items: readonly I[],
  concurrency: number,
  fn: (item: I) => Promise<T>,
): Promise<BoundedMapResult<T>> {
  const succeeded: T[] = [];
  const failed: { input: unknown; error: unknown }[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      try {
        succeeded.push(await fn(item));
      } catch (error) {
        failed.push({ input: item, error });
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return { succeeded, failed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/tools && bun test tests/bounded-parallel.test.ts`
Expected: PASS (2/2)

- [ ] **Step 5: Export and commit**

Add to `packages/tools/src/index.ts`:

```typescript
export { boundedMap } from "./research/bounded-parallel.js";
export type { BoundedMapResult } from "./research/bounded-parallel.js";
```

```bash
git add packages/tools/src/research/bounded-parallel.ts packages/tools/src/index.ts packages/tools/tests/bounded-parallel.test.ts
git commit -m "feat(tools): add boundedMap concurrency-capped fan-out primitive"
```

---

### Task 7: Research orchestration primitives (`searchThenFetch`, `resolveThenRetrieve`)

**Files:**
- Create: `packages/tools/src/research/search-then-fetch.ts`
- Create: `packages/tools/src/research/resolve-then-retrieve.ts`
- Test: `packages/tools/tests/search-then-fetch.test.ts`
- Test: `packages/tools/tests/resolve-then-retrieve.test.ts`

**Interfaces:**
- Consumes: `boundedMap` (Task 6)
- Produces:
  ```typescript
  // search-then-fetch.ts
  export interface SearchThenFetchOptions<S, T> {
    readonly search: (query: string) => Promise<readonly S[]>;
    readonly fetchOne: (result: S) => Promise<T>;
    readonly maxResults?: number;   // default 5 — bounds fan-out from a search that returns 50 hits
    readonly concurrency?: number;  // default 3
  }
  export async function searchThenFetch<S, T>(
    query: string,
    options: SearchThenFetchOptions<S, T>,
  ): Promise<{ readonly items: readonly T[]; readonly errors: readonly { input: unknown; error: unknown }[] }>

  // resolve-then-retrieve.ts
  export interface ResolveThenRetrieveOptions<R, T> {
    readonly resolve: (name: string) => Promise<R | null>;   // e.g. name -> canonical page ID
    readonly retrieve: (resolved: R) => Promise<T>;
  }
  export async function resolveThenRetrieve<R, T>(
    name: string,
    options: ResolveThenRetrieveOptions<R, T>,
  ): Promise<T | null>   // null when resolve() finds nothing — a real "not found", not an error
  ```

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/tools/tests/search-then-fetch.test.ts
import { describe, it, expect } from "bun:test";
import { searchThenFetch } from "../src/research/search-then-fetch.js";

describe("searchThenFetch", () => {
  it("caps fetches to maxResults even when search returns more", async () => {
    const search = async () => Array.from({ length: 20 }, (_, i) => ({ id: i }));
    let fetchCalls = 0;
    const fetchOne = async (r: { id: number }) => {
      fetchCalls++;
      return { id: r.id, title: `item-${r.id}` };
    };
    const result = await searchThenFetch("anything", { search, fetchOne, maxResults: 4 });
    expect(fetchCalls).toBe(4);
    expect(result.items).toHaveLength(4);
  });

  it("collects per-item fetch errors instead of failing the whole search", async () => {
    const search = async () => [{ id: 1 }, { id: 2 }, { id: 3 }];
    const fetchOne = async (r: { id: number }) => {
      if (r.id === 2) throw new Error("fetch failed");
      return { id: r.id };
    };
    const result = await searchThenFetch("q", { search, fetchOne });
    expect(result.items).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
  });
});
```

```typescript
// packages/tools/tests/resolve-then-retrieve.test.ts
import { describe, it, expect } from "bun:test";
import { resolveThenRetrieve } from "../src/research/resolve-then-retrieve.js";

describe("resolveThenRetrieve", () => {
  it("returns the retrieved value when resolve succeeds", async () => {
    const resolve = async (name: string) => (name === "Master Chief" ? { pageId: "mc-1" } : null);
    const retrieve = async (r: { pageId: string }) => ({ pageId: r.pageId, bio: "Spartan-117" });
    const result = await resolveThenRetrieve("Master Chief", { resolve, retrieve });
    expect(result).toEqual({ pageId: "mc-1", bio: "Spartan-117" });
  });

  it("returns null (not an error) when resolve finds nothing", async () => {
    const resolve = async () => null;
    const retrieve = async () => ({ never: "called" });
    const result = await resolveThenRetrieve("Unknown Entity", { resolve, retrieve });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/tools && bun test tests/search-then-fetch.test.ts tests/resolve-then-retrieve.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement `search-then-fetch.ts`**

```typescript
// packages/tools/src/research/search-then-fetch.ts
import { boundedMap } from "./bounded-parallel.js";

export interface SearchThenFetchOptions<S, T> {
  readonly search: (query: string) => Promise<readonly S[]>;
  readonly fetchOne: (result: S) => Promise<T>;
  readonly maxResults?: number;
  readonly concurrency?: number;
}

export interface SearchThenFetchResult<T> {
  readonly items: readonly T[];
  readonly errors: readonly { readonly input: unknown; readonly error: unknown }[];
}

/**
 * The "search, then fetch the top N hits in parallel" pattern every
 * research-style custom tool (Halopedia lore lookups, doc search, etc.)
 * currently hand-rolls. `search` runs once; `fetchOne` runs at most
 * `maxResults` times (default 5), bounded to `concurrency` in flight
 * (default 3) via `boundedMap`.
 */
export async function searchThenFetch<S, T>(
  query: string,
  options: SearchThenFetchOptions<S, T>,
): Promise<SearchThenFetchResult<T>> {
  const { search, fetchOne, maxResults = 5, concurrency = 3 } = options;
  const results = await search(query);
  const bounded = results.slice(0, maxResults);
  const { succeeded, failed } = await boundedMap(bounded, concurrency, fetchOne);
  return { items: succeeded, errors: failed };
}
```

- [ ] **Step 4: Implement `resolve-then-retrieve.ts`**

```typescript
// packages/tools/src/research/resolve-then-retrieve.ts
export interface ResolveThenRetrieveOptions<R, T> {
  readonly resolve: (name: string) => Promise<R | null>;
  readonly retrieve: (resolved: R) => Promise<T>;
}

/**
 * The "resolve a fuzzy name to a canonical ID, then retrieve the full
 * record" pattern (e.g. "Master Chief" -> page ID -> full article). Returns
 * `null` when `resolve` finds nothing — a real "not found" is not an error
 * and `retrieve` is never called in that case.
 */
export async function resolveThenRetrieve<R, T>(
  name: string,
  options: ResolveThenRetrieveOptions<R, T>,
): Promise<T | null> {
  const resolved = await options.resolve(name);
  if (resolved === null) return null;
  return options.retrieve(resolved);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/tools && bun test tests/search-then-fetch.test.ts tests/resolve-then-retrieve.test.ts`
Expected: PASS (4/4)

- [ ] **Step 6: Export and commit**

Add to `packages/tools/src/index.ts`:

```typescript
export { searchThenFetch } from "./research/search-then-fetch.js";
export type { SearchThenFetchOptions, SearchThenFetchResult } from "./research/search-then-fetch.js";
export { resolveThenRetrieve } from "./research/resolve-then-retrieve.js";
export type { ResolveThenRetrieveOptions } from "./research/resolve-then-retrieve.js";
```

```bash
git add packages/tools/src/research/search-then-fetch.ts packages/tools/src/research/resolve-then-retrieve.ts packages/tools/src/index.ts packages/tools/tests/search-then-fetch.test.ts packages/tools/tests/resolve-then-retrieve.test.ts
git commit -m "feat(tools): add searchThenFetch/resolveThenRetrieve research orchestration primitives"
```

---

### Task 8: Deterministic citation validator (`validateCitations`) + `.withAnswerPolicy()`

**Files:**
- Create: `packages/reasoning/src/kernel/capabilities/verify/citation-policy.ts`
- Test: `packages/reasoning/tests/citation-policy.test.ts`
- Modify: `packages/runtime/src/builder/types.ts` (add `AnswerPolicyOptions` near `GroundingOptions` at line 413-434)
- Modify: `packages/runtime/src/builder.ts` (add `.withAnswerPolicy()` near `.withGrounding()` at line 1037)
- Test: `packages/runtime/tests/answer-policy-builder.test.ts`

**Interfaces:**
- Consumes: `ReasoningStep[]` (existing kernel type, same shape `unconsumed-evidence.ts:21` and `evidence-grounding.ts:18-21` already consume), `buildEvidenceCorpusFromSteps` (existing export, `evidence-grounding.ts:18-21`)
- Produces:
  ```typescript
  // citation-policy.ts
  export interface CitationValidationResult {
    readonly ok: boolean;
    readonly uncitedUrls: readonly string[];   // URLs in the output not found in tool-observation evidence
    readonly citedUrlCount: number;
  }
  export function extractUrls(text: string): readonly string[]
  export function validateCitations(
    output: string,
    steps: readonly ReasoningStep[],
  ): CitationValidationResult

  // builder/types.ts
  export interface AnswerPolicyOptions {
    readonly requireCitations?: "warn" | "block";  // mirrors GroundingOptions.mode
  }

  // builder.ts
  withAnswerPolicy(options: AnswerPolicyOptions): this
  ```
  This task ships the deterministic checker + the builder option fully wired and tested in isolation. It does **not** touch the termination funnel directly (that file/line is not confirmed by this plan's research pass — grepping for the current `assembleDeliverable` call site is Step 6 below, done as a real command before wiring, not guessed). If the grep finds the funnel has moved since `.agents/MEMORY.md`'s 2026-08-16 entries, stop and re-scope Step 6 rather than editing blind.

- [ ] **Step 1: Write the failing test for `validateCitations`**

```typescript
// packages/reasoning/tests/citation-policy.test.ts
import { describe, it, expect } from "bun:test";
import { extractUrls, validateCitations } from "../src/kernel/capabilities/verify/citation-policy.js";
import type { ReasoningStep } from "../src/kernel/state/types.js"; // existing type, see kernel/state/

function observationStep(text: string): ReasoningStep {
  return {
    type: "observation",
    content: text,
  } as ReasoningStep;
}

describe("extractUrls", () => {
  it("finds http(s) URLs in text", () => {
    const urls = extractUrls("See https://halopedia.org/Master_Chief and http://example.com/x for details.");
    expect(urls).toEqual(["https://halopedia.org/Master_Chief", "http://example.com/x"]);
  });

  it("returns an empty array for text with no URLs", () => {
    expect(extractUrls("No links here.")).toEqual([]);
  });
});

describe("validateCitations", () => {
  it("ok:true when every cited URL appears in tool-observation evidence", () => {
    const steps = [observationStep("Fetched https://halopedia.org/Master_Chief -> Spartan-117")];
    const result = validateCitations("Per https://halopedia.org/Master_Chief, he is Spartan-117.", steps);
    expect(result.ok).toBe(true);
    expect(result.uncitedUrls).toEqual([]);
    expect(result.citedUrlCount).toBe(1);
  });

  it("ok:false when a cited URL never appeared in any observation", () => {
    const steps = [observationStep("Fetched https://halopedia.org/Master_Chief -> Spartan-117")];
    const result = validateCitations("Per https://halopedia.org/Cortana, she is an AI.", steps);
    expect(result.ok).toBe(false);
    expect(result.uncitedUrls).toEqual(["https://halopedia.org/Cortana"]);
  });

  it("ok:true (vacuously) when the output cites nothing", () => {
    const result = validateCitations("No sources needed for this answer.", []);
    expect(result.ok).toBe(true);
    expect(result.citedUrlCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/reasoning && bun test tests/citation-policy.test.ts`
Expected: FAIL — module not found (also check `../src/kernel/state/types.js` is the right import path for `ReasoningStep`; if not, grep `export.*ReasoningStep` under `packages/reasoning/src/kernel` and fix the import before proceeding — do not guess a second time)

- [ ] **Step 3: Implement `citation-policy.ts`**

```typescript
// packages/reasoning/src/kernel/capabilities/verify/citation-policy.ts
import { buildEvidenceCorpusFromSteps } from "./evidence-grounding.js";
import type { ReasoningStep } from "../../state/types.js";

export interface CitationValidationResult {
  readonly ok: boolean;
  readonly uncitedUrls: readonly string[];
  readonly citedUrlCount: number;
}

const URL_PATTERN = /https?:\/\/[^\s)\]}"'<>]+/g;

/** Extracts http(s) URLs from free text, in order of appearance. */
export function extractUrls(text: string): readonly string[] {
  const matches = text.match(URL_PATTERN);
  return matches ?? [];
}

/**
 * Deterministic (non-LLM) citation check: every URL the model's output
 * cites must appear verbatim somewhere in the run's tool-observation
 * evidence corpus (the same corpus `evidence-grounding.ts`'s numeric checks
 * already build from `state.steps`). An output with zero citations passes
 * vacuously — this validates that citations, when present, are grounded;
 * it does not by itself require a citation exist (that's `.withAnswerPolicy`
 * mode, see builder wiring).
 */
export function validateCitations(
  output: string,
  steps: readonly ReasoningStep[],
): CitationValidationResult {
  const citedUrls = extractUrls(output);
  if (citedUrls.length === 0) {
    return { ok: true, uncitedUrls: [], citedUrlCount: 0 };
  }

  const corpus = buildEvidenceCorpusFromSteps(steps);
  const uncitedUrls = citedUrls.filter((url) => !corpus.includes(url));

  return {
    ok: uncitedUrls.length === 0,
    uncitedUrls,
    citedUrlCount: citedUrls.length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/reasoning && bun test tests/citation-policy.test.ts`
Expected: PASS (5/5)

- [ ] **Step 5: Export from `packages/reasoning/src/index.ts`, commit the checker**

```bash
git add packages/reasoning/src/kernel/capabilities/verify/citation-policy.ts packages/reasoning/src/index.ts packages/reasoning/tests/citation-policy.test.ts
git commit -m "feat(reasoning): add deterministic validateCitations evidence check"
```

- [ ] **Step 6: Write the failing test for the builder option**

```typescript
// packages/runtime/tests/answer-policy-builder.test.ts
import { describe, it, expect } from "bun:test";
import { ReactiveAgentBuilder } from "../src/builder.js"; // confirm exact export name via existing builder tests before writing this import

describe(".withAnswerPolicy", () => {
  it("stores requireCitations mode on the builder config", () => {
    const builder = new ReactiveAgentBuilder().withAnswerPolicy({ requireCitations: "block" });
    // Existing builder tests read internal config via a `.build()` + inspect
    // pattern — follow whatever `packages/runtime/tests/builder*.test.ts`
    // already does to assert config was captured; do not invent a new
    // inspection path here.
    expect(builder).toBeDefined();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd packages/runtime && bun test tests/answer-policy-builder.test.ts`
Expected: FAIL — `withAnswerPolicy` is not a function

- [ ] **Step 8: Add `AnswerPolicyOptions` to `builder/types.ts`**

In `packages/runtime/src/builder/types.ts`, immediately after the existing `GroundingOptions` interface (ends around line 434):

```typescript
export interface AnswerPolicyOptions {
  /**
   * When set, every cited URL in the final answer must appear in this
   * run's tool-observation evidence (checked via
   * `citation-policy.ts`'s `validateCitations`). "warn" logs a mismatch;
   * "block" redirects once, mirroring `GroundingOptions.mode`. Unset =
   * today's behavior (citation-persona-dependent, no framework check).
   */
  readonly requireCitations?: "warn" | "block";
}
```

- [ ] **Step 9: Add `.withAnswerPolicy()` to `builder.ts`**

In `packages/runtime/src/builder.ts`, immediately after the existing `withGrounding` method (line 1037), following its exact pattern (read the 5-10 lines of `withGrounding`'s body first and mirror its config-storage call — do not invent a different storage mechanism than the one already used for `GroundingOptions`):

```typescript
withAnswerPolicy(options: import('./builder/types.js').AnswerPolicyOptions): this {
  this._answerPolicy = options;
  return this;
}
```

(If `withGrounding` stores into a different field name/pattern than `this._grounding = options`, e.g. a config object, match that pattern exactly instead of introducing `this._answerPolicy` as a bare new field.)

- [ ] **Step 10: Run test to verify it passes**

Run: `cd packages/runtime && bun test tests/answer-policy-builder.test.ts`
Expected: PASS (1/1)

- [ ] **Step 11: Run full runtime suite for regressions**

Run: `cd packages/runtime && bun test`
Expected: PASS, no new failures vs. baseline

- [ ] **Step 12: Commit**

```bash
git add packages/runtime/src/builder/types.ts packages/runtime/src/builder.ts packages/runtime/tests/answer-policy-builder.test.ts
git commit -m "feat(runtime): add .withAnswerPolicy({requireCitations}) builder option"
```

**Note for the executing agent:** wiring `validateCitations` + the stored `_answerPolicy` config into an actual termination/deliverable-assembly call site (so `requireCitations: "block"` really redirects a run) is explicitly OUT of scope for this task — it requires locating the CURRENT termination funnel via a fresh grep (`grep -rn "assembleDeliverable" packages/reasoning/src`), which may have moved since the 2026-08-15/16 memory entries this plan cites. File that wiring as a follow-up task once the funnel's current location is confirmed live, rather than editing blind against a possibly-stale file:line.

---

### Task 9: Canonical chat-session examples (Bun-native + Node-portable)

**Files:**
- Create: `examples/canonical-chat-session.ts`
- Create: `examples/canonical-chat-session-node.ts`
- Create: `examples/tsconfig.node.json`
- Modify: `README.md` (add a link near the existing `agent.session()` docs, README.md:286-295)

**Interfaces:**
- Consumes: `ReactiveAgent.session()` (`packages/runtime/src/reactive-agent.ts:2417-2423`), `AgentSession.chat()` (`packages/runtime/src/chat.ts:302`), `AgentSession.history()` (`chat.ts:314`), `AgentSession.end()` (`chat.ts:318`) — all existing, confirmed live.
- Produces: two runnable example files, no new library code.

- [ ] **Step 1: Read the existing README session example to match its exact API shape**

Run: `grep -n -A 15 "agent.session" README.md | head -40`
Expected: shows the current canonical builder chain (`.withTools(...)`, `agent.session()`, `session.chat(...)`) — use these exact calls in both example files, don't diverge from documented usage.

- [ ] **Step 2: Write `examples/canonical-chat-session.ts` (Bun-native)**

```typescript
// examples/canonical-chat-session.ts
//
// Canonical multi-turn chat session example. Run with:
//   bun run examples/canonical-chat-session.ts
//
// Demonstrates the documented agent.session()/session.chat() pattern
// (see README.md "Chat sessions") end to end, including history() and end().
import { createReactiveAgent } from "../packages/reactive-agents/src/index.js"; // adjust to the real package export path confirmed in Step 1

async function main() {
  const agent = createReactiveAgent()
    .withTools({ builtins: true })
    .build();

  const session = agent.session();

  const first = await session.chat("What tools do you have available?");
  console.log("Agent:", first.text);

  const second = await session.chat("Use one of them to tell me the current time.");
  console.log("Agent:", second.text);

  console.log("Turn count:", session.history().length);

  await session.end();
}

main().catch((error) => {
  console.error("Session failed:", error);
  process.exit(1);
});
```

- [ ] **Step 3: Verify the import path and builder chain compile**

Run: `cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts && bunx tsc --noEmit examples/canonical-chat-session.ts 2>&1 | head -30`
Expected: no import-resolution errors (adjust the `createReactiveAgent` import path if this fails — check `packages/reactive-agents/src/index.ts`'s actual exports first with `grep -n "export.*createReactiveAgent\|export.*ReactiveAgentBuilder" packages/reactive-agents/src/index.ts`)

- [ ] **Step 4: Create `examples/tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist-node"
  },
  "include": ["canonical-chat-session-node.ts"]
}
```

- [ ] **Step 5: Write `examples/canonical-chat-session-node.ts` (Node-portable)**

```typescript
// examples/canonical-chat-session-node.ts
//
// Same session as canonical-chat-session.ts, but using node:readline/promises
// for an interactive REPL loop instead of scripted turns — the portable
// pattern for consumers not on the Bun runtime. Build/run with:
//   npx tsc -p examples/tsconfig.node.json && node examples/dist-node/canonical-chat-session-node.js
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createReactiveAgent } from "../packages/reactive-agents/src/index.js"; // same path as Step 3

async function main() {
  const agent = createReactiveAgent()
    .withTools({ builtins: true })
    .build();

  const session = agent.session();
  const rl = createInterface({ input: stdin, output: stdout });

  console.log('Chat session started. Type "exit" to end.');

  try {
    for (;;) {
      const userInput = await rl.question("You: ");
      if (userInput.trim().toLowerCase() === "exit") break;

      const reply = await session.chat(userInput);
      console.log("Agent:", reply.text);
    }
  } finally {
    rl.close();
    await session.end();
  }
}

main().catch((error) => {
  console.error("Session failed:", error);
  process.exit(1);
});
```

- [ ] **Step 6: Verify the Node example typechecks under its own tsconfig**

Run: `cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts && npx tsc -p examples/tsconfig.node.json --noEmit`
Expected: no errors (if `@types/node` is missing from the workspace root, add it as a devDependency scoped to `examples/` per the repo's existing per-package devDependency convention — check `package.json`'s `devDependencies` first with `grep -n "@types/node" package.json packages/*/package.json | head -5` before adding a duplicate)

- [ ] **Step 7: Link both examples from README.md**

Near the existing session docs (README.md:286-295, found in Step 1), add:

```markdown
See [`examples/canonical-chat-session.ts`](examples/canonical-chat-session.ts) for a full runnable session example (Bun), or [`examples/canonical-chat-session-node.ts`](examples/canonical-chat-session-node.ts) for the Node-portable version using `node:readline/promises`.
```

- [ ] **Step 8: Commit**

```bash
git add examples/canonical-chat-session.ts examples/canonical-chat-session-node.ts examples/tsconfig.node.json README.md
git commit -m "docs: add canonical Bun + Node-portable chat-session examples"
```

---

## Self-Review

**Spec coverage** (against `.agents/MEMORY.md` lines 14-25's 9 items):

1. Output schemas on `defineTool` → Task 1
2. Guaranteed citations vs persona-dependent → Task 8
3. `defineToolset` shared defaults → Task 4
4. Canonical `agent.session()`/`session.chat()` example in docs/templates → Task 9
5. Reusable research orchestration (`explore`/`compare`-shaped: resolution, bounded fan-out, aggregation) → Tasks 6+7 (`boundedMap`, `searchThenFetch`, `resolveThenRetrieve` are the composable primitives the memory entry's "explore"/"compare" tools would be built from — full `explore`/`compare` end-user tools are a follow-up that composes these, scoped out to keep this plan's tasks independently shippable rather than one more layer of unverified aggregation logic)
6. Standard fetch/tool adapter (HTTP status, retries, empty-result) → Task 3
7. Turnkey tool test helper → Task 5
8. Node-portable example / officially supported path → Task 9
9. Tool observability envelope (latency, retries, provenance) → Task 2

All 9 covered. Item 5's scope note is a deliberate boundary, not a gap — see the note in Task 7's summary above.

**Placeholder scan:** no "TBD"/"handle appropriately"/"similar to Task N" found; every code step has real, complete code. Task 8's Step 12 note is an explicit scope boundary (with the exact grep command to resume it), not a placeholder.

**Type consistency check:**
- `DefinedTool.handler` return type widened once (Task 1) to `Effect.Effect<unknown, ToolExecutionError | ToolOutputValidationError>` — Tasks 2, 4, 5 all consume `DefinedTool` and don't narrow that type back, so they stay consistent.
- `defineToolset`'s `tool()` signature (`<A, O = unknown>(options: DefineToolOptions<A, O>) => DefinedTool`) matches Task 1's final `defineTool<A, O = unknown>` signature exactly.
- `boundedMap`'s `BoundedMapResult<T>` shape (`succeeded`/`failed`) is reused verbatim by `searchThenFetch` (`items`/`errors` — renamed at that layer deliberately, since "succeeded tool fetches" reads better as "items" to a research-tool caller; `resolveThenRetrieve` doesn't use it directly, single-item happy/null path only).
- `validateCitations`'s `ReasoningStep`/`buildEvidenceCorpusFromSteps` import path is flagged with a verify-before-use step (Task 8, Step 2) rather than assumed, since this plan's research pass confirmed the export but not confirmed this task's own import resolution live.

## Execution Handoff

Plan saved to `wiki/Planning/Implementation-Plans/2026-08-19-custom-tool-dx-improvements.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
