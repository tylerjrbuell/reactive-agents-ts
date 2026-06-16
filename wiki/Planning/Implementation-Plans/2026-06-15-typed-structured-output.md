# Typed Structured Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface and extend the existing internal `extractStructuredOutput` pipeline into a user-facing, schema-typed agent output system with a fast single-shot floor and a grounded-loop extraction engine (per-field provenance/confidence/abstention/surgical repair).

**Architecture:** A `SchemaContract` adapter (Standard Schema → Effect Schema + validate + optional JSON Schema) feeds the *existing* 5-layer pipeline, which is reused unchanged for the fast path. A new grounded engine wraps the pipeline and integrates the existing verify spine (`requirement-state`, `verifier`, `evidence-grounding`). Capability-gated routing picks fast vs grounded. All `AgentResult` additions are backward-compatible optionals; all 3 internal pipeline callers stay behavior-unchanged.

**Tech Stack:** TypeScript (strict, no `any`), Effect-TS, Bun test runner, `@standard-schema/spec` (types-only), Turborepo monorepo.

**Spec:** `wiki/Architecture/Design-Specs/2026-06-15-typed-structured-output.md`

**Branch:** `feat/typed-structured-output` (already created).

**Conventions (from project memory — read before starting):**
- Workspace packages run from `src/` under Bun — no rebuild needed for tests/probes. Rebuild only for npm-publish/Node-consumers/`.d.ts`.
- Run a single test file: `bun test <path> --timeout 20000` (always pass `--timeout`; default can hang on LLM layers).
- Authoritative build: `bunx turbo run build` (NOT `tsc --noEmit`).
- Strict types: no `any`; use `unknown` + guards or proper types.
- No `@deprecated` on working methods; additive changes only; no metric-gaming.
- Commit messages: NO `Co-Authored-By` trailer.

---

## File Structure

**New files:**
- `packages/reasoning/src/structured-output/schema-contract.ts` — `SchemaContract<A>` type + `toSchemaContract()` adapter.
- `packages/reasoning/src/structured-output/grounded/grounded-extract.ts` — grounded engine orchestrator.
- `packages/reasoning/src/structured-output/grounded/field-requirements.ts` — schema-field requirement tracker.
- `packages/reasoning/src/structured-output/grounded/field-provenance.ts` — per-field grounding against the step evidence corpus.
- `packages/reasoning/src/structured-output/stream-object.ts` — streaming deep-partial extraction.
- `packages/runtime/src/builder/structured-output-config.ts` — builder option types + apply helper.

**Modified files:**
- `packages/reasoning/src/structured-output/pipeline.ts` — additive contract-based overload.
- `packages/reasoning/src/structured-output/index.ts` — export new symbols.
- `packages/reasoning/src/kernel/capabilities/verify/verifier.ts` — `schemaSatisfactionCheck`.
- `packages/runtime/src/builder.ts` — `.withOutputSchema()`, `.streamObject()`, generic carry.
- `packages/runtime/src/builder/types.ts` — `OutputSchemaOptions`, `AgentResult` field additions.
- `packages/runtime/src/agent-config.ts` — config schema + apply (parity with `withGrounding`).
- `packages/runtime/src/execution-engine.ts` (or `engine/finalize/*`) — fast-path object extraction at finalization.
- `packages/{svelte,vue}/src/*` — bind `streamObject` deep-partial events (P3).

---

## PHASE 0 — SchemaContract + pipeline generalization

### Task 0.1: Add `@standard-schema/spec` dependency

**Files:**
- Modify: `packages/reasoning/package.json`

- [ ] **Step 1: Add the types-only dependency**

Run:
```bash
cd packages/reasoning && bun add @standard-schema/spec@^1.0.0
```
Expected: `package.json` gains `"@standard-schema/spec": "^1.0.0"` under `dependencies`; lockfile updates.

- [ ] **Step 2: Verify it resolves**

Run: `cd packages/reasoning && bun -e "import('@standard-schema/spec').then(()=>console.log('ok'))"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add packages/reasoning/package.json bun.lock
git commit -m "build(reasoning): add @standard-schema/spec dep"
```

---

### Task 0.2: `SchemaContract` type + `toSchemaContract` adapter (Effect Schema input)

**Files:**
- Create: `packages/reasoning/src/structured-output/schema-contract.ts`
- Test: `packages/reasoning/src/structured-output/schema-contract.test.ts`

- [ ] **Step 1: Write the failing test (Effect Schema path)**

```ts
import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { toSchemaContract } from "./schema-contract.js";

describe("toSchemaContract — Effect Schema", () => {
  const S = Schema.Struct({ total: Schema.Number, currency: Schema.String });

  it("validates a conforming value", () => {
    const c = toSchemaContract(S);
    const r = c.validate({ total: 42, currency: "USD" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.total).toBe(42);
  });

  it("rejects a non-conforming value with issues", () => {
    const c = toSchemaContract(S);
    const r = c.validate({ total: "nope" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.length).toBeGreaterThan(0);
  });

  it("derives a JSON schema for native enforcement", () => {
    const c = toSchemaContract(S);
    const js = c.toJsonSchema();
    expect(js).toBeDefined();
    expect((js as Record<string, unknown>).type).toBe("object");
  });

  it("exposes the underlying effect schema", () => {
    const c = toSchemaContract(S);
    expect(c.effectSchema).toBe(S);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/reasoning/src/structured-output/schema-contract.test.ts --timeout 20000`
Expected: FAIL — `Cannot find module "./schema-contract.js"`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { JSONSchema, Schema } from "effect";
import type { StandardSchemaV1 } from "@standard-schema/spec";

export interface SchemaIssue {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly message: string;
}
export type SchemaValidationResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly issues: ReadonlyArray<SchemaIssue> };

export interface SchemaContract<A> {
  readonly validate: (v: unknown) => SchemaValidationResult<A>;
  readonly toJsonSchema: () => Record<string, unknown> | undefined;
  readonly effectSchema: Schema.Schema<A>;
  readonly label?: string;
}

const isEffectSchema = (x: unknown): x is Schema.Schema<unknown> =>
  typeof x === "object" && x !== null && "ast" in x &&
  Symbol.for("@effect/schema/Schema") in (x as object) === false
    ? "ast" in (x as object)
    : "ast" in (x as object);

function fromEffectSchema<A>(s: Schema.Schema<A>): SchemaContract<A> {
  const decode = Schema.decodeUnknownEither(s);
  return {
    effectSchema: s,
    validate: (v) => {
      const r = decode(v);
      return r._tag === "Right"
        ? { ok: true, value: r.right }
        : { ok: false, issues: [{ path: [], message: String(r.left) }] };
    },
    toJsonSchema: () => {
      try {
        return JSONSchema.make(s) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    },
  };
}

export function toSchemaContract<A>(
  input: StandardSchemaV1<unknown, A> | Schema.Schema<A>,
): SchemaContract<A> {
  if (isEffectSchema(input)) return fromEffectSchema(input as Schema.Schema<A>);
  return fromStandardSchema(input as StandardSchemaV1<unknown, A>);
}

// Implemented in Task 0.3.
function fromStandardSchema<A>(_input: StandardSchemaV1<unknown, A>): SchemaContract<A> {
  throw new Error("Standard Schema path implemented in Task 0.3");
}
```

> Note: the `isEffectSchema` guard above is intentionally simple — Effect schemas expose an `ast` property. Read `node_modules/effect/dist/dts/Schema.d.ts` if you need to confirm the brand. Do not import internal effect symbols.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/reasoning/src/structured-output/schema-contract.test.ts --timeout 20000`
Expected: PASS (4/4 — the Effect-Schema tests).

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/structured-output/schema-contract.ts packages/reasoning/src/structured-output/schema-contract.test.ts
git commit -m "feat(structured-output): SchemaContract + Effect-Schema adapter"
```

---

### Task 0.3: `toSchemaContract` Standard Schema path (Zod/Valibot/etc.)

**Files:**
- Modify: `packages/reasoning/src/structured-output/schema-contract.ts`
- Test: `packages/reasoning/src/structured-output/schema-contract.test.ts`

- [ ] **Step 1: Add the failing test (Standard Schema path)**

Append to the test file. Uses a hand-rolled minimal Standard Schema validator so no extra dep is needed in the test.

```ts
import type { StandardSchemaV1 } from "@standard-schema/spec";

describe("toSchemaContract — Standard Schema", () => {
  // Minimal Standard Schema v1 validator: { total: number }
  const std: StandardSchemaV1<unknown, { total: number }> = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value) => {
        if (typeof value === "object" && value !== null && typeof (value as { total?: unknown }).total === "number") {
          return { value: value as { total: number } };
        }
        return { issues: [{ message: "total must be a number", path: ["total"] }] };
      },
    },
  };

  it("validates via ~standard.validate", () => {
    const c = toSchemaContract(std);
    const r = c.validate({ total: 7 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.total).toBe(7);
  });

  it("reports issues from ~standard.validate", () => {
    const c = toSchemaContract(std);
    const r = c.validate({ total: "x" });
    expect(r.ok).toBe(false);
  });

  it("returns undefined JSON schema when the validator has no emitter", () => {
    const c = toSchemaContract(std);
    expect(c.toJsonSchema()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/reasoning/src/structured-output/schema-contract.test.ts --timeout 20000`
Expected: FAIL — `Standard Schema path implemented in Task 0.3` thrown.

- [ ] **Step 3: Implement the Standard Schema path**

Replace the stub `fromStandardSchema` with:

```ts
function fromStandardSchema<A>(input: StandardSchemaV1<unknown, A>): SchemaContract<A> {
  const std = input["~standard"];
  // Bridge Effect schema: decode delegates to the Standard Schema validator.
  const bridge = Schema.declare(
    (v: unknown): v is A => {
      const r = std.validate(v);
      return !(r instanceof Promise) && !("issues" in r);
    },
    { identifier: std.vendor ? `standard:${std.vendor}` : "standard-schema" },
  ) as unknown as Schema.Schema<A>;

  return {
    effectSchema: bridge,
    label: std.vendor,
    validate: (v) => {
      const r = std.validate(v);
      if (r instanceof Promise) {
        return { ok: false, issues: [{ path: [], message: "async validation unsupported" }] };
      }
      if ("issues" in r && r.issues) {
        return {
          ok: false,
          issues: r.issues.map((i) => ({
            path: (i.path ?? []).map((p) => (typeof p === "object" && p !== null ? (p as { key: PropertyKey }).key : p)) as PropertyKey[],
            message: i.message,
          })),
        };
      }
      return { ok: true, value: (r as { value: A }).value };
    },
    // Standard Schema v1 does NOT standardize JSON Schema emission.
    // Vendor-specific emitters (e.g. Zod 4 toJSONSchema) can be added here later;
    // undefined ⇒ engine uses prompt+heal (no native enforcement). Honest default.
    toJsonSchema: () => undefined,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/reasoning/src/structured-output/schema-contract.test.ts --timeout 20000`
Expected: PASS (7/7).

- [ ] **Step 5: Export from the package index**

Modify `packages/reasoning/src/structured-output/index.ts` — add:

```ts
export { toSchemaContract } from "./schema-contract.js";
export type { SchemaContract, SchemaIssue, SchemaValidationResult } from "./schema-contract.js";
```

- [ ] **Step 6: Run reasoning build to confirm no type errors**

Run: `bunx turbo run build --filter=@reactive-agents/reasoning`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/reasoning/src/structured-output/schema-contract.ts packages/reasoning/src/structured-output/schema-contract.test.ts packages/reasoning/src/structured-output/index.ts
git commit -m "feat(structured-output): Standard Schema adapter path + exports"
```

---

### Task 0.4: Additive contract overload on `extractStructuredOutput`

**Files:**
- Modify: `packages/reasoning/src/structured-output/pipeline.ts`
- Test: `packages/reasoning/src/structured-output/pipeline-contract.test.ts`

**Goal:** Accept a `SchemaContract<A>` in `StructuredOutputConfig` *alongside* the existing `schema: Schema.Schema<T>`. When `contract` is present, use `contract.effectSchema` for the pipeline and `contract.validate` for the final Layer-3 check. Existing callers (passing `schema`) are byte-identical.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import { extractStructuredOutput } from "./pipeline.js";
import { toSchemaContract } from "./schema-contract.js";
import { makeTestLLMLayer } from "@reactive-agents/llm-provider/testing";

describe("extractStructuredOutput — contract overload", () => {
  it("extracts using a SchemaContract", async () => {
    const contract = toSchemaContract(Schema.Struct({ answer: Schema.String }));
    // test LLM returns a fixed JSON string for complete(); see testing.ts.
    const llm = makeTestLLMLayer({ completeText: '{"answer":"hi"}' });
    const out = await Effect.runPromise(
      extractStructuredOutput({ contract, prompt: "say hi" }).pipe(Effect.provide(llm)),
    );
    expect(out.data).toEqual({ answer: "hi" });
  });
});
```

> Read `packages/llm-provider/src/testing.ts` for the exact deterministic-provider factory name/signature (the test above assumes `makeTestLLMLayer({ completeText })`; adjust to the real export — do not invent it).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/reasoning/src/structured-output/pipeline-contract.test.ts --timeout 20000`
Expected: FAIL — `contract` not accepted / type error.

- [ ] **Step 3: Extend `StructuredOutputConfig` and the pipeline**

In `pipeline.ts`, change the config interface (additive) and resolve schema/validate from either source:

```ts
import type { SchemaContract } from "./schema-contract.js";

export interface StructuredOutputConfig<T> {
  /** Effect Schema (existing callers). Mutually exclusive with `contract`. */
  readonly schema?: Schema.Schema<T>;
  /** SchemaContract (new surface). Mutually exclusive with `schema`. */
  readonly contract?: SchemaContract<T>;
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly examples?: readonly T[];
  readonly maxRetries?: number;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly forcePromptMode?: boolean;
  readonly traceContext?: { readonly taskId?: string; readonly iteration?: number };
}
```

At the top of `extractStructuredOutput`, derive the effective schema + validator:

```ts
const effectSchema: Schema.Schema<T> =
  config.contract ? config.contract.effectSchema : (config.schema as Schema.Schema<T>);
if (!effectSchema) {
  return yield* Effect.fail(new Error("extractStructuredOutput: provide `schema` or `contract`"));
}
const validateFinal = (parsed: unknown): T =>
  config.contract
    ? (() => {
        const r = config.contract.validate(parsed);
        if (r.ok) return r.value;
        throw new Error(r.issues.map((i) => i.message).join("; "));
      })()
    : Schema.decodeUnknownSync(effectSchema)(parsed);
```

Then: (a) in `tryNativeStructuredOutput` pass `outputSchema: effectSchema`; (b) at Layer 3 replace `Schema.decodeUnknownSync(config.schema)(parsed)` with `validateFinal(parsed)`; (c) in `buildStructuredPrompt` keep using `effectSchema` for any schema rendering.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/reasoning/src/structured-output/pipeline-contract.test.ts --timeout 20000`
Expected: PASS.

- [ ] **Step 5: Run the existing pipeline + internal-caller tests (regression)**

Run:
```bash
bun test packages/reasoning/src/structured-output --timeout 30000
bun test packages/reasoning/src/strategies/plan-execute.test.ts --timeout 30000
```
Expected: PASS — internal callers (`plan-execute`, `plan-mutation`, `infer-required-tools`) unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/structured-output/pipeline.ts packages/reasoning/src/structured-output/pipeline-contract.test.ts
git commit -m "feat(structured-output): additive SchemaContract overload on pipeline"
```

---

## PHASE 1 — Fast path: `.withOutputSchema` → `result.object`

### Task 1.1: `AgentResult` + `OutputSchemaOptions` types

**Files:**
- Modify: `packages/runtime/src/builder/types.ts`

- [ ] **Step 1: Add the options + result fields (no test — pure types; verified by build)**

Add near the other builder option types:

```ts
/** Options for `.withOutputSchema()`. */
export interface OutputSchemaOptions {
  /** `auto` (default): capability-routed. `fast`: single-shot. `grounded`: loop-integrated. */
  readonly mode?: "auto" | "fast" | "grounded";
  /** `degrade` (default): object=undefined + objectError. `throw`: StructuredOutputError. */
  readonly onParseFail?: "degrade" | "throw";
}
```

In `interface AgentResult`, add backward-compatible optionals after `error?`:

```ts
  /** Typed structured output when `.withOutputSchema()` was set; undefined on parse-fail (lenient). */
  readonly object?: unknown
  /** Populated (lenient mode) when structured parse failed after retries. */
  readonly objectError?: string
  /** Grounded engine only: per-field-path evidence source. */
  readonly provenance?: Readonly<Record<string, { readonly source: string; readonly evidence: string }>>
  /** Grounded engine only: per-field-path confidence 0..1. */
  readonly confidence?: Readonly<Record<string, number>>
  /** Grounded engine only: per-field-path abstention reason (field omitted, not hallucinated). */
  readonly abstained?: Readonly<Record<string, string>>
```

- [ ] **Step 2: Build the runtime package**

Run: `bunx turbo run build --filter=@reactive-agents/runtime`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/runtime/src/builder/types.ts
git commit -m "feat(runtime): OutputSchemaOptions + AgentResult structured fields"
```

---

### Task 1.2: `StructuredOutputError`

**Files:**
- Create: `packages/runtime/src/errors/structured-output-error.ts`
- Modify: `packages/runtime/src/index.ts` (export)
- Test: `packages/runtime/src/errors/structured-output-error.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { StructuredOutputError } from "./structured-output-error.js";

describe("StructuredOutputError", () => {
  it("carries raw text and issues", () => {
    const e = new StructuredOutputError({ rawText: "not json", issues: ["bad"] });
    expect(e._tag).toBe("StructuredOutputError");
    expect(e.rawText).toBe("not json");
    expect(e.issues).toEqual(["bad"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/src/errors/structured-output-error.test.ts --timeout 20000`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement (mirror existing durable error tagged-class style)**

> Read `packages/runtime/src/engine/durable-resume.ts` exports `DurableRunNotFoundError` for the exact `Data.TaggedError` pattern this codebase uses, and match it.

```ts
import { Data } from "effect";

export class StructuredOutputError extends Data.TaggedError("StructuredOutputError")<{
  readonly rawText: string;
  readonly issues: ReadonlyArray<string>;
}> {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/runtime/src/errors/structured-output-error.test.ts --timeout 20000`
Expected: PASS.

- [ ] **Step 5: Export + commit**

Add to `packages/runtime/src/index.ts`: `export { StructuredOutputError } from "./errors/structured-output-error.js";`

```bash
git add packages/runtime/src/errors/structured-output-error.ts packages/runtime/src/errors/structured-output-error.test.ts packages/runtime/src/index.ts
git commit -m "feat(runtime): StructuredOutputError tagged error"
```

---

### Task 1.3: Builder `.withOutputSchema()` (mirror `.withGrounding`)

**Files:**
- Modify: `packages/runtime/src/builder.ts`
- Test: `packages/runtime/src/builder/with-output-schema.test.ts`

- [ ] **Step 1: Write the failing test (builder carries config)**

```ts
import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { ReactiveAgentBuilder } from "../builder.js";

describe(".withOutputSchema", () => {
  it("stores the schema + options on the builder", () => {
    const b = new ReactiveAgentBuilder().withOutputSchema(
      Schema.Struct({ x: Schema.Number }),
      { mode: "fast" },
    );
    // @ts-expect-error — reading private for the test
    expect(b._outputSchemaConfig).toBeDefined();
    // @ts-expect-error
    expect(b._outputSchemaConfig.options.mode).toBe("fast");
  });
});
```

> Confirm the exact constructor/export name of the builder class in `packages/runtime/src/builder.ts` (it may be exported under a factory). Adjust the import accordingly.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/src/builder/with-output-schema.test.ts --timeout 20000`
Expected: FAIL — `withOutputSchema` not a function.

- [ ] **Step 3: Implement the builder field + method (parity with `_groundingConfig`)**

In `builder.ts`, near `_groundingConfig` (line ~386) add the private field:

```ts
    private _outputSchemaConfig:
      | { readonly contract: import('@reactive-agents/reasoning').SchemaContract<unknown>;
          readonly options: import('./builder/types.js').OutputSchemaOptions }
      | undefined = undefined
```

Near `withGrounding` (line ~858) add:

```ts
    /**
     * Declare a typed structured output schema (Standard Schema or Effect Schema).
     * `run()` then populates `result.object`. Default lenient: on parse-fail,
     * `object` is undefined and `objectError` is set (use `{ onParseFail: "throw" }` for strict).
     */
    withOutputSchema<A>(
      schema: import('@standard-schema/spec').StandardSchemaV1<unknown, A> | import('effect').Schema.Schema<A>,
      options: import('./builder/types.js').OutputSchemaOptions = {},
    ): this {
      const { toSchemaContract } = require('@reactive-agents/reasoning') as typeof import('@reactive-agents/reasoning');
      this._outputSchemaConfig = { contract: toSchemaContract(schema) as never, options };
      return this;
    }
```

> If the file uses ESM static imports (no `require`), add `import { toSchemaContract } from '@reactive-agents/reasoning'` at the top instead and call it directly. Match the file's existing import style.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/runtime/src/builder/with-output-schema.test.ts --timeout 20000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/builder.ts packages/runtime/src/builder/with-output-schema.test.ts
git commit -m "feat(runtime): .withOutputSchema builder method"
```

---

### Task 1.4: Fast-path extraction at finalization

**Files:**
- Create: `packages/runtime/src/engine/finalize/extract-object.ts`
- Modify: the finalization site that constructs `AgentResult` (find via grep below)
- Test: `packages/runtime/src/engine/finalize/extract-object.test.ts`

- [ ] **Step 1: Locate the result-construction site**

Run: `rtk grep -rn "goalAchieved:" packages/runtime/src/engine packages/runtime/src/execution-engine.ts | head`
Read the surrounding function — this is where `object`/`objectError` must be attached.

- [ ] **Step 2: Write the failing test for the extraction helper**

```ts
import { describe, it, expect } from "bun:test";
import { Effect, Schema } from "effect";
import { extractObjectFromAnswer } from "./extract-object.js";
import { toSchemaContract } from "@reactive-agents/reasoning";
import { makeTestLLMLayer } from "@reactive-agents/llm-provider/testing";

describe("extractObjectFromAnswer", () => {
  const contract = toSchemaContract(Schema.Struct({ city: Schema.String }));

  it("returns typed object on success (lenient)", async () => {
    const llm = makeTestLLMLayer({ completeText: '{"city":"Paris"}' });
    const r = await Effect.runPromise(
      extractObjectFromAnswer({ contract, finalAnswer: "The city is Paris", onParseFail: "degrade" }).pipe(Effect.provide(llm)),
    );
    expect(r.object).toEqual({ city: "Paris" });
    expect(r.objectError).toBeUndefined();
  });

  it("degrades on failure (lenient)", async () => {
    const llm = makeTestLLMLayer({ completeText: "not json at all" });
    const r = await Effect.runPromise(
      extractObjectFromAnswer({ contract, finalAnswer: "garbage", onParseFail: "degrade" }).pipe(Effect.provide(llm)),
    );
    expect(r.object).toBeUndefined();
    expect(r.objectError).toBeDefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test packages/runtime/src/engine/finalize/extract-object.test.ts --timeout 20000`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the helper (wraps the existing pipeline + degrade)**

```ts
import { Effect } from "effect";
import { extractStructuredOutput, type SchemaContract } from "@reactive-agents/reasoning";
import { StructuredOutputError } from "../../errors/structured-output-error.js";

export interface ExtractObjectInput<A> {
  readonly contract: SchemaContract<A>;
  readonly finalAnswer: string;
  readonly onParseFail: "degrade" | "throw";
  readonly traceContext?: { readonly taskId?: string; readonly iteration?: number };
}
export interface ExtractObjectOutput<A> {
  readonly object?: A;
  readonly objectError?: string;
}

export const extractObjectFromAnswer = <A>(
  input: ExtractObjectInput<A>,
): Effect.Effect<ExtractObjectOutput<A>, StructuredOutputError, import("@reactive-agents/llm-provider").LLMService> =>
  extractStructuredOutput<A>({
    contract: input.contract,
    prompt: `Extract the structured data described by the schema from the following result.\n\n${input.finalAnswer}`,
    ...(input.traceContext ? { traceContext: input.traceContext } : {}),
  }).pipe(
    Effect.map((r) => ({ object: r.data })),
    Effect.catchAll((e) =>
      input.onParseFail === "throw"
        ? Effect.fail(new StructuredOutputError({ rawText: input.finalAnswer, issues: [String(e)] }))
        : Effect.succeed({ objectError: e instanceof Error ? e.message : String(e) } as ExtractObjectOutput<A>),
    ),
  );
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/runtime/src/engine/finalize/extract-object.test.ts --timeout 20000`
Expected: PASS (2/2).

- [ ] **Step 6: Wire into the finalization site**

At the result-construction site found in Step 1: when `this._outputSchemaConfig` is set AND routing chose fast (Task 1.5), call `extractObjectFromAnswer` and spread `object`/`objectError` onto the `AgentResult`. Thread `_outputSchemaConfig` through the engine config the same way `_groundingConfig` is threaded (follow that field end-to-end).

- [ ] **Step 7: Run a builder-level e2e test**

```ts
// packages/runtime/src/builder/output-schema-e2e.test.ts
import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
// build an agent with the deterministic test provider returning '{"city":"Paris"}'
// then: const r = await agent.withOutputSchema(Schema.Struct({city:Schema.String})).run("...")
// expect(r.object).toEqual({ city: "Paris" })
```
> Fill this using the test-provider agent-construction pattern from an existing runtime e2e test (e.g. grep `packages/runtime/src` for `.run(` in `*.test.ts`). Use a real existing helper, not an invented one.

Run: `bun test packages/runtime/src/builder/output-schema-e2e.test.ts --timeout 30000`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/runtime/src/engine/finalize/extract-object.ts packages/runtime/src/engine/finalize/extract-object.test.ts packages/runtime/src/builder/output-schema-e2e.test.ts packages/runtime/src/execution-engine.ts
git commit -m "feat(runtime): fast-path structured output extraction at finalization"
```

---

### Task 1.5: Routing (auto/fast/grounded)

**Files:**
- Create: `packages/runtime/src/engine/finalize/structured-route.ts`
- Test: `packages/runtime/src/engine/finalize/structured-route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { chooseStructuredEngine } from "./structured-route.js";

describe("chooseStructuredEngine", () => {
  it("respects explicit fast", () => {
    expect(chooseStructuredEngine({ mode: "fast", nativeJsonMode: true, toolsRegistered: true, calibrated: false })).toBe("fast");
  });
  it("respects explicit grounded", () => {
    expect(chooseStructuredEngine({ mode: "grounded", nativeJsonMode: true, toolsRegistered: false, calibrated: true })).toBe("grounded");
  });
  it("auto → grounded when tools registered", () => {
    expect(chooseStructuredEngine({ mode: "auto", nativeJsonMode: true, toolsRegistered: true, calibrated: true })).toBe("grounded");
  });
  it("auto → grounded when uncalibrated/local", () => {
    expect(chooseStructuredEngine({ mode: "auto", nativeJsonMode: false, toolsRegistered: false, calibrated: false })).toBe("grounded");
  });
  it("auto → fast when frontier+native+no tools", () => {
    expect(chooseStructuredEngine({ mode: "auto", nativeJsonMode: true, toolsRegistered: false, calibrated: true })).toBe("fast");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/src/engine/finalize/structured-route.test.ts --timeout 20000`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export interface RouteInput {
  readonly mode: "auto" | "fast" | "grounded";
  readonly nativeJsonMode: boolean;
  readonly toolsRegistered: boolean;
  readonly calibrated: boolean;
}
export function chooseStructuredEngine(i: RouteInput): "fast" | "grounded" {
  if (i.mode === "fast") return "fast";
  if (i.mode === "grounded") return "grounded";
  // auto
  if (i.toolsRegistered || !i.calibrated || !i.nativeJsonMode) return "grounded";
  return "fast";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/runtime/src/engine/finalize/structured-route.test.ts --timeout 20000`
Expected: PASS (5/5).

- [ ] **Step 5: Wire routing at the finalization site**

Read `nativeJsonMode` from `llm.getStructuredOutputCapabilities()`; `toolsRegistered` from whether the agent has tools; `calibrated` from the calibration state. For Phase 1, grounded falls back to fast (grounded engine lands in Phase 2 — leave a `// TODO(P2): grounded` only as a code comment pointing at Task 2.x, never as a plan placeholder).

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/engine/finalize/structured-route.ts packages/runtime/src/engine/finalize/structured-route.test.ts
git commit -m "feat(runtime): structured-output fast/grounded routing"
```

---

### Task 1.6: `agent-config.ts` parity (declarative config support)

**Files:**
- Modify: `packages/runtime/src/agent-config.ts`
- Test: existing `agent-config` test suite

- [ ] **Step 1: Add the config schema + apply (mirror `grounding` at lines 199/245/471)**

Add an `OutputSchemaConfigSchema` (mode + onParseFail only — the schema object itself is not JSON-serializable, so declarative config supports options but requires the schema passed in code; document this). Apply in the builder-from-config path guarded by presence.

```ts
export const OutputSchemaOptionsSchema = Schema.Struct({
  mode: Schema.optional(Schema.Literal("auto", "fast", "grounded")),
  onParseFail: Schema.optional(Schema.Literal("degrade", "throw")),
});
// in AgentConfigSchema: outputSchemaOptions: Schema.optional(OutputSchemaOptionsSchema)
```

- [ ] **Step 2: Run the agent-config tests**

Run: `bun test packages/runtime/src/agent-config.test.ts --timeout 20000`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/runtime/src/agent-config.ts
git commit -m "feat(runtime): agent-config support for output-schema options"
```

---

### Task 1.7: Phase 1 full build + suite gate

- [ ] **Step 1: Build all**

Run: `bunx turbo run build`
Expected: PASS (all packages).

- [ ] **Step 2: Run reasoning + runtime suites**

Run:
```bash
bun test packages/reasoning --timeout 60000
bun test packages/runtime --timeout 60000
```
Expected: PASS (no regressions; new tests green).

- [ ] **Step 3: Commit (if any fixups)**

```bash
git commit -am "test: phase-1 structured output green" || echo "nothing to commit"
```

---

## PHASE 2 — Grounded engine (the differentiator)

> Reuses verify-spine functions confirmed present: `buildEvidenceCorpusFromSteps` (`evidence-grounding.ts`), `VerificationCheck`/`checkSeverity`/`VerificationResult` (`verifier.ts`), and the missing-required-tools pattern (`requirement-state.ts`). Read those three files before starting.

### Task 2.1: Field-requirement tracker

**Files:**
- Create: `packages/reasoning/src/structured-output/grounded/field-requirements.ts`
- Test: `packages/reasoning/src/structured-output/grounded/field-requirements.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { fieldRequirementsFromSchema, missingRequiredFields } from "./field-requirements.js";

describe("field-requirements", () => {
  const S = Schema.Struct({ total: Schema.Number, note: Schema.optional(Schema.String) });

  it("lists required (non-optional) top-level fields", () => {
    const reqs = fieldRequirementsFromSchema(S);
    expect(reqs.map((r) => r.path)).toEqual(["total"]); // note is optional
  });

  it("computes missing fields from a partial object", () => {
    const reqs = fieldRequirementsFromSchema(S);
    expect(missingRequiredFields(reqs, {})).toEqual(["total"]);
    expect(missingRequiredFields(reqs, { total: 5 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/reasoning/src/structured-output/grounded/field-requirements.test.ts --timeout 20000`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement (derive required keys from the Effect schema AST)**

```ts
import { Schema, SchemaAST } from "effect";

export interface FieldRequirement {
  readonly path: string;
  readonly required: boolean;
}

export function fieldRequirementsFromSchema(schema: Schema.Schema<unknown>): ReadonlyArray<FieldRequirement> {
  const ast = schema.ast;
  if (ast._tag !== "TypeLiteral") return [];
  return ast.propertySignatures.map((p) => ({
    path: String(p.name),
    required: !p.isOptional,
  }));
}

export function missingRequiredFields(
  reqs: ReadonlyArray<FieldRequirement>,
  partial: Record<string, unknown>,
): ReadonlyArray<string> {
  return reqs
    .filter((r) => r.required && (partial[r.path] === undefined || partial[r.path] === null))
    .map((r) => r.path);
}
```

> Confirm `SchemaAST.TypeLiteral` / `propertySignatures` / `isOptional` field names against `node_modules/effect/dist/dts/SchemaAST.d.ts` — these are the public AST shapes but the property names must match the installed effect version. Adjust if needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/reasoning/src/structured-output/grounded/field-requirements.test.ts --timeout 20000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/structured-output/grounded/field-requirements.ts packages/reasoning/src/structured-output/grounded/field-requirements.test.ts
git commit -m "feat(grounded): schema field-requirement tracker"
```

---

### Task 2.2: Per-field provenance

**Files:**
- Create: `packages/reasoning/src/structured-output/grounded/field-provenance.ts`
- Test: `packages/reasoning/src/structured-output/grounded/field-provenance.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { groundFields } from "./field-provenance.js";

describe("groundFields", () => {
  it("attaches provenance when a field value appears in the corpus", () => {
    const corpus = "tool crypto-price returned BTC=64000 USD";
    const r = groundFields({ price: 64000, name: "unseen" }, corpus);
    expect(r.provenance.price).toBeDefined();
    expect(r.provenance.name).toBeUndefined(); // not in corpus
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/reasoning/src/structured-output/grounded/field-provenance.test.ts --timeout 20000`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement (reuse evidence-corpus matching)**

```ts
export interface GroundResult {
  readonly provenance: Record<string, { source: string; evidence: string }>;
  readonly confidence: Record<string, number>;
}

export function groundFields(obj: Record<string, unknown>, corpus: string): GroundResult {
  const provenance: GroundResult["provenance"] = {};
  const confidence: GroundResult["confidence"] = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || val === null) continue;
    const needle = String(val);
    const idx = needle.length >= 2 ? corpus.indexOf(needle) : -1;
    if (idx >= 0) {
      const start = Math.max(0, idx - 30);
      provenance[key] = { source: "step-corpus", evidence: corpus.slice(start, idx + needle.length + 30) };
      confidence[key] = 0.9;
    } else {
      confidence[key] = 0.4; // parametric / ungrounded — honest lower confidence
    }
  }
  return { provenance, confidence };
}
```

> For numeric tolerance matching, reuse `validateNumericGrounding` from `kernel/capabilities/verify/evidence-grounding.ts` instead of strict `indexOf` for number fields — read its signature and wire it for `typeof val === "number"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/reasoning/src/structured-output/grounded/field-provenance.test.ts --timeout 20000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/structured-output/grounded/field-provenance.ts packages/reasoning/src/structured-output/grounded/field-provenance.test.ts
git commit -m "feat(grounded): per-field provenance via step corpus"
```

---

### Task 2.3: `schemaSatisfactionCheck` verifier check

**Files:**
- Modify: `packages/reasoning/src/kernel/capabilities/verify/verifier.ts`
- Test: `packages/reasoning/src/kernel/capabilities/verify/schema-satisfaction.test.ts`

- [ ] **Step 1: Read `verifier.ts`**

Read `VerificationCheck` (line ~146), `VerificationSeverity` (~130), `checkSeverity` (~163), `VerificationResult` (~192) to match the exact shapes.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { toSchemaContract } from "../../../structured-output/schema-contract.js";
import { schemaSatisfactionCheck } from "./verifier.js";

describe("schemaSatisfactionCheck", () => {
  const contract = toSchemaContract(Schema.Struct({ total: Schema.Number }));

  it("passes when object is valid + grounded", () => {
    const c = schemaSatisfactionCheck({ contract, candidate: { total: 5 }, missingRequired: [], lowConfidenceFields: [] });
    expect(c.severity ?? "pass").toBe("pass");
  });
  it("rejects when required fields are missing", () => {
    const c = schemaSatisfactionCheck({ contract, candidate: {}, missingRequired: ["total"], lowConfidenceFields: [] });
    expect(["reject", "warn"]).toContain(c.severity);
  });
  it("escalates when fields are low-confidence", () => {
    const c = schemaSatisfactionCheck({ contract, candidate: { total: 5 }, missingRequired: [], lowConfidenceFields: ["total"] });
    expect(c.severity).toBe("escalate");
  });
});
```

> Adjust the asserted `VerificationCheck` field name (`severity` vs nested) to match the real shape you read in Step 1.

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test packages/reasoning/src/kernel/capabilities/verify/schema-satisfaction.test.ts --timeout 20000`
Expected: FAIL — `schemaSatisfactionCheck` not exported.

- [ ] **Step 4: Implement, conforming to the real `VerificationCheck` shape**

Add to `verifier.ts` a `schemaSatisfactionCheck(input): VerificationCheck` that returns severity `reject` when `missingRequired.length > 0`, `escalate` when `lowConfidenceFields.length > 0`, else `pass`. Use the existing `VerificationCheck` constructor/shape — do not invent a new return type.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/reasoning/src/kernel/capabilities/verify/schema-satisfaction.test.ts --timeout 20000`
Expected: PASS (3/3).

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/kernel/capabilities/verify/verifier.ts packages/reasoning/src/kernel/capabilities/verify/schema-satisfaction.test.ts
git commit -m "feat(verify): schemaSatisfactionCheck for grounded structured output"
```

---

### Task 2.4: Grounded orchestrator + surgical repair

**Files:**
- Create: `packages/reasoning/src/structured-output/grounded/grounded-extract.ts`
- Test: `packages/reasoning/src/structured-output/grounded/grounded-extract.test.ts`

- [ ] **Step 1: Write the failing test (composition: extract → ground → repair one field)**

```ts
import { describe, it, expect } from "bun:test";
import { Effect, Schema } from "effect";
import { groundedExtract } from "./grounded-extract.js";
import { toSchemaContract } from "../schema-contract.js";
import { makeTestLLMLayer } from "@reactive-agents/llm-provider/testing";

describe("groundedExtract", () => {
  const contract = toSchemaContract(Schema.Struct({ price: Schema.Number, vendor: Schema.String }));

  it("returns object + provenance + confidence", async () => {
    const llm = makeTestLLMLayer({ completeText: '{"price":64000,"vendor":"acme"}' });
    const r = await Effect.runPromise(
      groundedExtract({
        contract,
        finalAnswer: "price is 64000",
        evidenceCorpus: "tool returned price=64000",
        onParseFail: "degrade",
      }).pipe(Effect.provide(llm)),
    );
    expect(r.object).toEqual({ price: 64000, vendor: "acme" });
    expect(r.provenance?.price).toBeDefined();
    expect(r.confidence?.price).toBeGreaterThan(r.confidence?.vendor ?? 1); // price grounded, vendor not
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/reasoning/src/structured-output/grounded/grounded-extract.test.ts --timeout 20000`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the orchestrator (composes Tasks 0.4, 2.1, 2.2)**

```ts
import { Effect } from "effect";
import { extractStructuredOutput } from "../pipeline.js";
import type { SchemaContract } from "../schema-contract.js";
import { fieldRequirementsFromSchema, missingRequiredFields } from "./field-requirements.js";
import { groundFields } from "./field-provenance.js";

export interface GroundedInput<A> {
  readonly contract: SchemaContract<A>;
  readonly finalAnswer: string;
  readonly evidenceCorpus: string;
  readonly onParseFail: "degrade" | "throw";
  readonly abstainBelow?: number; // default: no abstention (opt-in)
}
export interface GroundedOutput<A> {
  readonly object?: A;
  readonly objectError?: string;
  readonly provenance?: Record<string, { source: string; evidence: string }>;
  readonly confidence?: Record<string, number>;
  readonly abstained?: Record<string, string>;
}

export const groundedExtract = <A>(
  input: GroundedInput<A>,
): Effect.Effect<GroundedOutput<A>, never, import("@reactive-agents/llm-provider").LLMService> =>
  Effect.gen(function* () {
    const reqs = fieldRequirementsFromSchema(input.contract.effectSchema);
    const extracted = yield* extractStructuredOutput<A>({
      contract: input.contract,
      prompt: `Extract the schema fields from:\n${input.finalAnswer}`,
    }).pipe(Effect.map((r) => r.data as Record<string, unknown>), Effect.catchAll(() => Effect.succeed(null)));

    if (extracted === null) {
      return { objectError: "grounded extraction failed" };
    }

    const grounded = groundFields(extracted, input.evidenceCorpus);
    const abstained: Record<string, string> = {};
    let obj: Record<string, unknown> = { ...extracted };

    if (input.abstainBelow !== undefined) {
      for (const [k, conf] of Object.entries(grounded.confidence)) {
        const required = reqs.find((r) => r.path === k)?.required;
        if (conf < input.abstainBelow && !required) {
          delete obj[k];
          abstained[k] = `confidence ${conf.toFixed(2)} < ${input.abstainBelow}`;
        }
      }
    }

    const missing = missingRequiredFields(reqs, obj);
    if (missing.length > 0) {
      // Surgical repair would re-derive only `missing` fields via a Schema.pick sub-extract.
      // For the base implementation, record them as an error if still missing.
      return {
        objectError: `missing required fields after extraction: ${missing.join(", ")}`,
        provenance: grounded.provenance,
        confidence: grounded.confidence,
      };
    }

    return {
      object: obj as A,
      provenance: grounded.provenance,
      confidence: grounded.confidence,
      ...(Object.keys(abstained).length ? { abstained } : {}),
    };
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/reasoning/src/structured-output/grounded/grounded-extract.test.ts --timeout 20000`
Expected: PASS.

- [ ] **Step 5: Add surgical-repair sub-task test + impl**

Add a test where the first extraction misses a required field and a second pass (sub-schema `Schema.pick`) fills it; implement the repair loop inside `groundedExtract` (replace the "record as error" branch with one bounded re-extract of just the missing fields). Keep it ≤1 repair pass by default.

```ts
// test: makeTestLLMLayer with a scripted sequence — first call omits `vendor`, second returns it.
// Read packages/llm-provider/src/testing.ts for how to script multiple sequential responses.
```

- [ ] **Step 6: Export + commit**

Add to `structured-output/index.ts`: `export { groundedExtract } from "./grounded/grounded-extract.js";` (+ types).

```bash
git add packages/reasoning/src/structured-output/grounded packages/reasoning/src/structured-output/index.ts
git commit -m "feat(grounded): orchestrator with provenance, confidence, abstention, surgical repair"
```

---

### Task 2.5: Wire grounded engine into the routing finalization site

**Files:**
- Modify: finalization site (Task 1.4/1.5)
- Test: `packages/runtime/src/builder/grounded-output-e2e.test.ts`

- [ ] **Step 1: Write the failing e2e test**

Build an agent with the test provider + a tool that returns a known value; call `.withOutputSchema(S, { mode: "grounded" }).run(...)`; assert `r.object`, `r.provenance` present. (Reuse the agent-construction helper from Task 1.4 Step 7.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/src/builder/grounded-output-e2e.test.ts --timeout 30000`
Expected: FAIL — grounded path still falls back to fast (Task 1.5 Step 5 TODO).

- [ ] **Step 3: Replace the fast-fallback with a real grounded call**

At the finalization site, when routing returns `"grounded"`: build the evidence corpus via `buildEvidenceCorpusFromSteps(state.steps)` and call `groundedExtract`, spreading `object`/`objectError`/`provenance`/`confidence`/`abstained` onto the result. Keep `abstainBelow` undefined by default (opt-in only — see Task 2.6).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/runtime/src/builder/grounded-output-e2e.test.ts --timeout 30000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/execution-engine.ts packages/runtime/src/builder/grounded-output-e2e.test.ts
git commit -m "feat(runtime): wire grounded structured engine into finalization"
```

---

### Task 2.6: Abstention behind an ablation gate (opt-in)

**Files:**
- Modify: `OutputSchemaOptions` (`builder/types.ts`), grounded wiring

- [ ] **Step 1: Add `abstainBelow?: number` to `OutputSchemaOptions`** (default undefined = OFF). Thread to `groundedExtract`.

- [ ] **Step 2: Add a test** that with `abstainBelow: 0.5` a low-confidence optional field is omitted + recorded in `abstained`, and with it unset the field is kept.

Run: `bun test packages/runtime/src/builder/grounded-output-e2e.test.ts --timeout 30000`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(grounded): opt-in abstention threshold (default off, ablation-gated)"
```

> **Post-merge governance:** before any default-on flip of grounded routing or abstention, run the cross-tier ablation matrix and route through `ablation-warden` (≥3pp lift AND ≤15% token overhead). Do NOT default-on in this sprint.

---

## PHASE 3 — Streaming structured output

### Task 3.1: Incremental partial-JSON parse util

**Files:**
- Create: `packages/reasoning/src/structured-output/partial-parse.ts`
- Test: `packages/reasoning/src/structured-output/partial-parse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { parsePartial } from "./partial-parse.js";

describe("parsePartial", () => {
  it("parses a complete prefix of a streaming object", () => {
    expect(parsePartial('{"a":1,"b":')).toEqual({ a: 1 });
    expect(parsePartial('{"a":1,"b":2}')).toEqual({ a: 1, b: 2 });
    expect(parsePartial('{"a":1,"items":[{"x":')).toEqual({ a: 1, items: [{}] });
  });
  it("returns {} for un-parseable head", () => {
    expect(parsePartial("not json")).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/reasoning/src/structured-output/partial-parse.test.ts --timeout 20000`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement (close-open-brackets then JSON.parse; reuse `repairJson` as fallback)**

```ts
import { repairJson } from "./json-repair.js";

export function parsePartial(buf: string): Record<string, unknown> {
  const trimmed = buf.trim();
  if (!trimmed.startsWith("{")) {
    const repaired = repairJson(trimmed);
    try { return JSON.parse(repaired) as Record<string, unknown>; } catch { return {}; }
  }
  // Walk the buffer, tracking string/escape state, closing any open brackets.
  const stack: string[] = [];
  let inStr = false, esc = false, lastComplete = "";
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") stack.pop();
    // Snapshot at a stable boundary (after a closed value, before a dangling key/colon).
    if (!inStr && (ch === "," || ch === "}" || ch === "]")) lastComplete = trimmed.slice(0, i + 1);
  }
  const candidate = (lastComplete || trimmed) + stack.reverse().join("");
  try { return JSON.parse(candidate) as Record<string, unknown>; }
  catch {
    try { return JSON.parse(repairJson(candidate)) as Record<string, unknown>; }
    catch { return {}; }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/reasoning/src/structured-output/partial-parse.test.ts --timeout 20000`
Expected: PASS. (If the `items:[{x:` case is too aggressive, relax the test to assert `a===1` and `Array.isArray(items)` — keep the contract honest about what partial parsing can guarantee.)

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/structured-output/partial-parse.ts packages/reasoning/src/structured-output/partial-parse.test.ts
git commit -m "feat(structured-output): incremental partial-JSON parser"
```

---

### Task 3.2: `streamObject` on the builder

**Files:**
- Create: `packages/reasoning/src/structured-output/stream-object.ts`
- Modify: `packages/runtime/src/builder.ts` (add `.streamObject()`)
- Test: `packages/runtime/src/builder/stream-object.test.ts`

- [ ] **Step 1: Write the failing test (deep-partial sequence + final validated event)**

```ts
import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
// agent with a test provider that streams '{"city":"Par' then 'is"}'
// const events = [];
// for await (const p of agent.withOutputSchema(Schema.Struct({city:Schema.String})).streamObject("...")) events.push(p.object);
// expect(events.at(-1)).toEqual({ city: "Paris" });
// expect(events.length).toBeGreaterThan(1);
```
> Use the streaming test-provider pattern from an existing `runStream` test in `packages/runtime/src` — grep for `.runStream(` in `*.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/src/builder/stream-object.test.ts --timeout 30000`
Expected: FAIL — `.streamObject` not a function.

- [ ] **Step 3: Implement `streamObject` generator (reuse `runStream` + `parsePartial`)**

In `stream-object.ts`, expose an async generator that consumes the agent's text stream, accumulates the buffer, and yields `{ object: parsePartial(buf) }` on each delta; at stream end, run `contract.validate(parsePartial(buf))` and yield the final validated object (or `objectError`). Add a thin `.streamObject()` on the builder that wires the configured contract to this generator over `runStream`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/runtime/src/builder/stream-object.test.ts --timeout 30000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/structured-output/stream-object.ts packages/runtime/src/builder.ts packages/runtime/src/builder/stream-object.test.ts
git commit -m "feat(structured-output): streamObject deep-partial streaming"
```

---

### Task 3.3: Svelte + Vue bindings

**Files:**
- Modify: `packages/svelte/src/*`, `packages/vue/src/*`
- Test: existing framework-binding test suites

- [ ] **Step 1: Read the existing `runStream` binding** in each package to match the store/composable pattern.

- [ ] **Step 2: Add a `createStructuredStream`/`useStructuredObject` helper** that subscribes to `streamObject` and exposes a reactive `object: DeepPartial<A>` store/ref. Write a test mirroring the existing streaming-binding test.

Run: `bun test packages/svelte --timeout 30000 && bun test packages/vue --timeout 30000`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/svelte/src packages/vue/src
git commit -m "feat(svelte,vue): streamObject reactive bindings"
```

---

## PHASE 4 — Typed agent-as-tool (CUT-LINE)

> Ship only if Phases 0–3 are green with sprint time remaining. Otherwise this becomes a follow-up plan.

### Task 4.1: `.asTool({ input, output })`

**Files:**
- Create: `packages/runtime/src/builder/as-tool.ts`
- Modify: `packages/runtime/src/builder.ts`
- Test: `packages/runtime/src/builder/as-tool.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
// const tool = innerAgent.asTool({ input: Schema.Struct({q: Schema.String}), output: Schema.Struct({a: Schema.String}) });
// expect typeof tool.handler === "function"; tool.parameters reflects the input JSON schema;
// running the handler with {q:"hi"} runs innerAgent.withOutputSchema(output).run(...) and returns result.object.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/src/builder/as-tool.test.ts --timeout 20000`
Expected: FAIL — `.asTool` not a function.

- [ ] **Step 3: Implement**

`asTool({ input, output })` returns a tool definition whose `parameters` = `toSchemaContract(input).toJsonSchema()` (fallback to a permissive object schema if undefined) and whose handler runs `this.withOutputSchema(output).run(<rendered input>)` and returns `result.object`. Reuse the existing tool-definition shape from `packages/tools/src` (read a built-in tool for the exact `{ def, handler }` contract).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/runtime/src/builder/as-tool.test.ts --timeout 20000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/builder/as-tool.ts packages/runtime/src/builder.ts packages/runtime/src/builder/as-tool.test.ts
git commit -m "feat(runtime): typed agent-as-tool (.asTool)"
```

---

## FINAL — Cross-tier receipt + docs + gate

### Task F.1: Cross-tier live probe (the "works on local models" receipt)

- [ ] **Step 1: Write a probe script** `scripts/probe-structured-output.ts` that runs the same `.withOutputSchema(Invoice).run(...)` extraction against (a) one Ollama local model (e.g. `qwen2.5:7b` or `gemma`) and (b) one frontier model (anthropic/openai — keys in `.env`, bun auto-loads). Print per-tier: object validity, missing fields, provenance coverage, token cost.

- [ ] **Step 2: Run it**

Run: `bun scripts/probe-structured-output.ts`
Expected: both tiers return a valid `object`; local tier benefits from grounded routing. Capture numbers for the debrief.

- [ ] **Step 3: Record results** in `wiki/Research/Harness-Reports/2026-06-1X-structured-output-cross-tier.md`.

### Task F.2: Docs

- [ ] **Step 1: Add a guide** `apps/docs/src/content/docs/guides/structured-output.md` (mirror the durable-execution guide structure): `.withOutputSchema`, lenient vs strict, grounded provenance/confidence, `streamObject`. State honestly that abstention + grounded-default are opt-in pending ablation.

- [ ] **Step 2: Update** `packages/reactive-agents/src/index.ts` umbrella exports (`StructuredOutputError`, types) and the root README structured-output section.

- [ ] **Step 3: Commit**

```bash
git add apps/docs/src/content/docs/guides/structured-output.md packages/reactive-agents/src/index.ts README.md
git commit -m "docs(structured-output): guide + umbrella exports"
```

### Task F.3: Full gate

- [ ] **Step 1: Build all** — `bunx turbo run build` → PASS.
- [ ] **Step 2: Full suite** — `bun test --timeout 120000` → PASS (no regressions; internal pipeline callers unchanged).
- [ ] **Step 3: Verify no `any`** — `rtk grep -rn ": any\| as any" packages/reasoning/src/structured-output packages/runtime/src/builder` → no new hits.
- [ ] **Step 4: Debrief** — write `wiki/Research/Debriefs/2026-06-1X-typed-structured-output-debrief.md` (what shipped, cross-tier numbers, what's gated, P4 cut or shipped).

---

## Self-Review (completed by plan author)

**Spec coverage:** §3 decisions → Tasks 0.2/0.3 (Standard Schema), 1.4 (lenient/strict), 1.5 (routing), 3.2 (streaming), 2.x (grounded). §4.1 SchemaContract → 0.2/0.3. §4.2 additive pipeline → 0.4. §4.3 two engines → P1 + P2. §4.4 streaming → P3. §4.5 asTool → P4. §6 error handling → 1.2/1.4. §7 testing → tests in every task + F.1. §8 guardrails → 2.6 + governance notes. All spec sections map to tasks.

**Placeholder scan:** No "TBD/implement later". Spots that say "read file X for exact signature" are deliberate grounding pointers (the executing engineer must match real signatures in `effect`, `testing.ts`, `verifier.ts`, tool-def shape) — each names the exact file and what to confirm, with concrete code to adapt. Not placeholders.

**Type consistency:** `SchemaContract` (validate/toJsonSchema/effectSchema) consistent across 0.2→0.4→2.x. `extractObjectFromAnswer` / `groundedExtract` / `chooseStructuredEngine` names stable. `OutputSchemaOptions` (mode/onParseFail/abstainBelow) consistent 1.1→2.6. `AgentResult` fields (object/objectError/provenance/confidence/abstained) consistent 1.1→2.5.
