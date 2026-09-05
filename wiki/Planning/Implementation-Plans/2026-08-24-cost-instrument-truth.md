---
aliases: [Cost Instrument Truth, W1+W2]
tags: [plan, instrument, cost, cache, north-star]
date: 2026-08-24
status: READY
spec: "wiki/Decisions/2026-08-24-external-research-convergence-amendment.md"
---

# Cost Instrument Truth (W1 + W2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Reactive Agents' cost instrument cache-aware end to end, so that the lift gate scores mechanisms on tokens the provider actually bills and every cache miss is attributable to a named prefix segment.

**Architecture:** Three defects sit on one wire. `LLMRequestCompleted` is declared in `packages/core` and consumed by nine call sites but published by nobody, so the per-call cost stream is dead. `cacheReadInputTokens` is produced correctly by the Anthropic adapter and lands in the trace exchange, then stops — it never reaches `AgentResult.metadata`, the receipt, or the bench. And the lift gate's token leg sums raw tokens, counting a cached prefix read at full weight when the provider bills it at roughly one tenth. This plan repairs all three at their single shared choke point (`emitLLMExchange` in `packages/reasoning/src/kernel/utils/diagnostics.ts`), adds two content hashes so a cache miss names its own cause, then switches the gate's token leg to billed input tokens behind an explicit policy field.

**Tech Stack:** TypeScript (strict), Effect-TS 3.x, Bun test runner, Effect `Layer`/`FiberRef`/`Effect.serviceOption` service patterns, `node:crypto` for hashing.

**Spec:** [[../../Decisions/2026-08-24-external-research-convergence-amendment]] — read §2 (findings F-1, F-2, F-3, F-8) and §4 (the rule change) before starting.

## Global Constraints

- **The spec must be ratified before Task 7.** Tasks 1–6 and 8 are pure plumbing and are safe regardless of the outcome. Task 7 changes the meaning of the lift gate and is a ratification event — do not merge it until the owner accepts §5 item 1 of the spec.
- **Strict TypeScript. No `any` casts.** Use `unknown` plus a narrowing guard. This is enforced by review, not by a lint rule.
- **Effect-TS patterns are mandatory.** Read the `effect-ts-patterns` skill before writing service code. Optional dependencies are read with `Effect.serviceOption(X)`, never `yield* X` inside code that must work without the service.
- **Every `bun test` invocation carries an explicit timeout flag.** Use `--timeout 15000` unless a step says otherwise. A hanging Effect test without a timeout wedges the runner.
- **Never add `Co-Authored-By` trailers to commits.**
- **Backward compatibility is a hard requirement on every event and receipt field.** New fields are optional and emitted via conditional spread (`...(typeof x === "number" ? { x } : {})`), so a payload from a provider that reports no cache figures stays byte-identical to today's. There are recorded traces and golden fixtures that must keep parsing.
- **`meanTokens` (raw) is never removed.** Billed tokens are added alongside it. Historical reports must stay readable and prior verdicts must stay auditable.
- **Build is authoritative over `tsc --noEmit`.** Verify with `bunx turbo run build`, not a bare typecheck (TS 6.0.3 false-positives on this repo's `ignoreDeprecations`).
- **Commit after every task.** Conventional Commits (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`), scoped to the package.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `packages/llm-provider/src/billed-tokens.ts` | The single definition of "billed input tokens". Pure, no Effect, no I/O. |
| `packages/llm-provider/tests/billed-tokens.test.ts` | Unit tests for the above. |
| `packages/reasoning/src/kernel/utils/prefix-hash.ts` | Stable content hashes for the cacheable prefix segments (system prompt, tool surface). Pure. |
| `packages/reasoning/src/kernel/utils/prefix-hash.test.ts` | Unit tests for the above. |
| `packages/reasoning/src/kernel/utils/llm-request-completed.test.ts` | Proves `emitLLMExchange` publishes `LLMRequestCompleted` with cache fields. |
| `packages/benchmarks/tests/gate-billed-token-leg.test.ts` | Proves the gate scores on billed tokens and that raw is retained. |
| `scripts/check-cost-accounting.sh` | Grep-able enforcement: no cost consumer reads raw tokens as the cost figure. |

**Modify:**

| File | Change |
|---|---|
| `packages/llm-provider/src/index.ts` | Export `billedInputTokens`, `BilledTokens`. |
| `packages/core/src/services/event-bus.ts:184-205` | Add four optional fields to `LLMRequestCompleted`. |
| `packages/reasoning/src/kernel/utils/diagnostics.ts:528+` | `emitLLMExchange` also publishes `LLMRequestCompleted`; accepts the two hashes. |
| `packages/reasoning/src/kernel/observable-llm.ts:150-180` | Compute and pass the two hashes; pass `provider`/`model` through unchanged. |
| `packages/runtime/src/types.ts` | Add `cacheReadTokens` / `billedTokens` to the result metadata schema. |
| `packages/runtime/src/runtime.ts:924` | Accumulate the new event fields into run metadata. |
| `packages/benchmarks/src/types.ts:225-245` | `RunScore.billedTokens`, `TaskVariantReport.meanBilledTokens`, `meanCacheReadTokens`. |
| `packages/benchmarks/src/runner.ts:163-165, 237, 1010` | Populate the new fields from the now-live event. |
| `packages/benchmarks/src/gate/types.ts` | `LiftPolicy.tokenLeg`; `TierEvidence.billedTokenOverheadPct`, `cacheHitRate`. |
| `packages/benchmarks/src/gate/gate.ts:206-208, ~286` | Score `costOk` on the configured leg. |
| `packages/benchmarks/src/gate/receipt.ts` | Print both legs plus cache-hit rate. |
| `scripts/check-cross-cutting.sh` | Register the new check. |
| `CHANGELOG.md` | Entry under Unreleased. |

---

### Task 1: The single definition of billed input tokens

**Files:**
- Create: `packages/llm-provider/src/billed-tokens.ts`
- Create: `packages/llm-provider/tests/billed-tokens.test.ts`
- Modify: `packages/llm-provider/src/index.ts`

**Interfaces:**
- Consumes: `TokenUsage` shape from `packages/llm-provider/src/types.ts` (fields `inputTokens: number`, `outputTokens: number`, `totalTokens: number`, `cacheReadInputTokens?: number`, `cacheCreationInputTokens?: number`).
- Produces:
  - `export interface BilledTokens { readonly billedInput: number; readonly cacheRead: number; readonly output: number; readonly billedTotal: number }`
  - `export function billedInputTokens(usage: UsageLike): BilledTokens`
  - `export type UsageLike = { readonly inputTokens?: number; readonly outputTokens?: number; readonly cacheReadInputTokens?: number }`

Every later task calls `billedInputTokens`. Nothing recomputes the subtraction inline.

- [ ] **Step 1: Write the failing test**

Create `packages/llm-provider/tests/billed-tokens.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { billedInputTokens } from "../src/billed-tokens.js";

describe("billedInputTokens", () => {
  it("subtracts cache reads from input tokens", () => {
    const r = billedInputTokens({
      inputTokens: 10_000,
      outputTokens: 500,
      cacheReadInputTokens: 9_000,
    });
    expect(r.billedInput).toBe(1_000);
    expect(r.cacheRead).toBe(9_000);
    expect(r.output).toBe(500);
    expect(r.billedTotal).toBe(1_500);
  });

  it("falls back to raw input when the provider reports no cache figures", () => {
    const r = billedInputTokens({ inputTokens: 10_000, outputTokens: 500 });
    expect(r.billedInput).toBe(10_000);
    expect(r.cacheRead).toBe(0);
    expect(r.billedTotal).toBe(10_500);
  });

  it("clamps at zero when a provider reports cacheRead >= input", () => {
    // Anthropic reports input_tokens as the UNCACHED remainder, so a provider
    // that also reports the cached figure separately can make the naive
    // subtraction negative. Billed tokens are never negative.
    const r = billedInputTokens({
      inputTokens: 200,
      outputTokens: 50,
      cacheReadInputTokens: 9_000,
    });
    expect(r.billedInput).toBe(0);
    expect(r.cacheRead).toBe(9_000);
    expect(r.billedTotal).toBe(50);
  });

  it("treats missing fields as zero rather than NaN", () => {
    const r = billedInputTokens({});
    expect(r.billedInput).toBe(0);
    expect(r.output).toBe(0);
    expect(r.billedTotal).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/llm-provider/tests/billed-tokens.test.ts --timeout 15000`
Expected: FAIL — `Cannot find module '../src/billed-tokens.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/llm-provider/src/billed-tokens.ts`:

```ts
// File: src/billed-tokens.ts
//
// The SINGLE definition of "billed input tokens" (spec §4, finding F-3).
//
// Raw `inputTokens` stopped being a cost proxy when prompt caching shipped: a
// cached prefix read is billed at roughly a tenth of a fresh one, so a
// mechanism that trades raw tokens for cache hits looks more expensive than it
// is. Every cost consumer in this repo reads THIS function; nothing recomputes
// the subtraction inline.
//
// Pure — no Effect, no I/O, no provider coupling.

/**
 * Structural subset of `TokenUsage` (see `types.ts`). Every field optional so
 * partial/streamed usage objects pass without a cast.
 */
export type UsageLike = {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadInputTokens?: number;
};

export interface BilledTokens {
  /** Input tokens the provider charges at the fresh rate. Never negative. */
  readonly billedInput: number;
  /** Input tokens served from a prompt-cache hit. */
  readonly cacheRead: number;
  /** Completion tokens. Always billed in full. */
  readonly output: number;
  /** `billedInput + output` — the figure the lift gate's token leg scores. */
  readonly billedTotal: number;
}

const nonNegative = (n: number | undefined): number =>
  typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;

/**
 * Split a usage report into billed and cached halves.
 *
 * Providers disagree about whether `inputTokens` already excludes cache reads.
 * Anthropic reports the UNCACHED remainder, so `inputTokens - cacheRead` can go
 * negative; that is clamped to 0 rather than allowed to poison an aggregate.
 * A provider reporting no cache figures degrades to `billedInput === inputTokens`,
 * which is exactly today's behavior.
 */
export function billedInputTokens(usage: UsageLike): BilledTokens {
  const input = nonNegative(usage.inputTokens);
  const cacheRead = nonNegative(usage.cacheReadInputTokens);
  const output = nonNegative(usage.outputTokens);
  const billedInput = Math.max(0, input - cacheRead);
  return { billedInput, cacheRead, output, billedTotal: billedInput + output };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/llm-provider/tests/billed-tokens.test.ts --timeout 15000`
Expected: PASS, 4 tests.

- [ ] **Step 5: Export from the package index**

In `packages/llm-provider/src/index.ts`, add alongside the other type/function re-exports:

```ts
export { billedInputTokens, type BilledTokens, type UsageLike } from "./billed-tokens.js";
```

- [ ] **Step 6: Verify the package builds**

Run: `bunx turbo run build --filter=@reactive-agents/llm-provider`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/llm-provider/src/billed-tokens.ts \
        packages/llm-provider/tests/billed-tokens.test.ts \
        packages/llm-provider/src/index.ts
git commit -m "feat(llm-provider): single definition of billed input tokens

Raw inputTokens stopped tracking cost when prompt caching shipped. This is
the one function every cost consumer will read (spec F-3)."
```

---

### Task 2: Widen the `LLMRequestCompleted` event

**Files:**
- Modify: `packages/core/src/services/event-bus.ts:184-205`

**Interfaces:**
- Consumes: nothing.
- Produces: four new optional fields on the `LLMRequestCompleted` member of the `AgentEvent` union — `cacheReadTokensIn?: number`, `billedTokens?: number`, `promptPrefixHash?: string`, `toolSurfaceHash?: string`. Tasks 3, 4, 5 and 6 read these by exactly these names.

This task is type-only. It has no behavioral test of its own; Task 3 tests both together, which is why the two are separate commits but one review unit.

- [ ] **Step 1: Add the fields**

In `packages/core/src/services/event-bus.ts`, inside the `LLMRequestCompleted` union member, immediately after the existing `readonly cached?: boolean;` line (currently line 202):

```ts
      /**
       * Input tokens served from a prompt-cache hit, when the provider reports
       * them (Anthropic `cache_read_input_tokens`, OpenAI cached input).
       * Absent means "provider did not report", NOT "zero" — a consumer that
       * needs a number treats absent as 0 via `billedInputTokens`.
       */
      readonly cacheReadTokensIn?: number;
      /**
       * `(inputTokens - cacheReadTokensIn) + outputTokens`, clamped at zero on
       * the input half. The figure the lift gate's token leg scores
       * (2026-08-24 amendment §4). `tokensUsed` above stays RAW and is retained
       * on every receipt so historical reports stay readable.
       */
      readonly billedTokens?: number;
      /**
       * Stable hash of the cacheable prompt prefix (system block). When two
       * consecutive calls in one run disagree on this, the cache could not have
       * hit and the system block is the reason.
       */
      readonly promptPrefixHash?: string;
      /**
       * Stable hash of the ordered tool-schema surface sent on the wire. Tools
       * occupy position zero of the Anthropic cache prefix, so a change here
       * invalidates every downstream breakpoint (failure mode F10).
       */
      readonly toolSurfaceHash?: string;
```

- [ ] **Step 2: Verify the workspace still builds**

Run: `bunx turbo run build --filter=@reactive-agents/core`
Expected: exit 0. All four fields are optional, so no existing consumer breaks.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/services/event-bus.ts
git commit -m "feat(core): LLMRequestCompleted carries cache + prefix-hash fields

All optional; payloads from providers without cache reporting stay
byte-identical. Producer lands in the next commit."
```

---

### Task 3: Publish the dead event

**Files:**
- Modify: `packages/reasoning/src/kernel/utils/diagnostics.ts` (the `emitLLMExchange` function, starting line 528)
- Create: `packages/reasoning/src/kernel/utils/llm-request-completed.test.ts`

**Interfaces:**
- Consumes: `billedInputTokens` (Task 1), the widened `LLMRequestCompleted` (Task 2).
- Produces: `emitLLMExchange` now publishes two events per call — the existing `LLMExchangeEmitted` and a new `LLMRequestCompleted`. Its argument object gains two optional fields: `promptPrefixHash?: string`, `toolSurfaceHash?: string`. Task 5 passes them.

**Why here.** `emitLLMExchange` is already the one site that sees provider, model, token usage, cache figures, duration and cost together, and it already resolves `EventBus` optionally. Publishing from a second site would recreate the boundary multiplicity the spec exists to remove. `requestId` is not currently threaded into this function; use the exchange's `${taskId}:${iteration}:${requestKind}` triple, which is unique per call within a run and is what the trace correlates on.

- [ ] **Step 1: Write the failing test**

Create `packages/reasoning/src/kernel/utils/llm-request-completed.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { EventBus } from "@reactive-agents/core";
import { emitLLMExchange } from "./diagnostics.js";

type Captured = { readonly _tag: string } & Record<string, unknown>;

/** Recording EventBus stub — collects every published event for assertions. */
const recordingBus = (sink: Ref.Ref<readonly Captured[]>) =>
  Layer.succeed(EventBus, {
    publish: (event: unknown) =>
      Ref.update(sink, (prev) => [...prev, event as Captured]),
    on: () => Effect.succeed(() => {}),
    subscribe: () => Effect.succeed(() => {}),
  } as unknown as typeof EventBus.Service);

const baseArgs = {
  taskId: "task-1",
  iteration: 3,
  provider: "anthropic",
  model: "claude-haiku-4-5-20251001",
  requestKind: "complete" as const,
  systemPrompt: "you are a test",
  messages: [{ role: "user" as const, content: "hi" }],
  toolSchemaNames: ["file-read"],
};

describe("emitLLMExchange -> LLMRequestCompleted", () => {
  it("publishes LLMRequestCompleted alongside LLMExchangeEmitted", async () => {
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* Ref.make<readonly Captured[]>([]);
        yield* emitLLMExchange({
          ...baseArgs,
          response: {
            content: "ok",
            tokensIn: 10_000,
            tokensOut: 500,
            cacheReadTokensIn: 9_000,
            costUsd: 0.004,
            durationMs: 1_200,
          },
        }).pipe(Effect.provide(recordingBus(sink)));
        return yield* Ref.get(sink);
      }),
    );

    const tags = events.map((e) => e._tag);
    expect(tags).toContain("LLMExchangeEmitted");
    expect(tags).toContain("LLMRequestCompleted");
  });

  it("carries billed tokens, cache reads and the raw total", async () => {
    const completed = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* Ref.make<readonly Captured[]>([]);
        yield* emitLLMExchange({
          ...baseArgs,
          promptPrefixHash: "aaaaaaaaaaaaaaaa",
          toolSurfaceHash: "bbbbbbbbbbbbbbbb",
          response: {
            content: "ok",
            tokensIn: 10_000,
            tokensOut: 500,
            cacheReadTokensIn: 9_000,
            costUsd: 0.004,
            durationMs: 1_200,
          },
        }).pipe(Effect.provide(recordingBus(sink)));
        const all = yield* Ref.get(sink);
        return all.find((e) => e._tag === "LLMRequestCompleted");
      }),
    );

    expect(completed).toBeDefined();
    expect(completed?.tokensUsed).toBe(10_500); // RAW, unchanged semantics
    expect(completed?.billedTokens).toBe(1_500); // (10000 - 9000) + 500
    expect(completed?.cacheReadTokensIn).toBe(9_000);
    expect(completed?.cached).toBe(true);
    expect(completed?.estimatedCost).toBe(0.004);
    expect(completed?.durationMs).toBe(1_200);
    expect(completed?.model).toBe("claude-haiku-4-5-20251001");
    expect(completed?.provider).toBe("anthropic");
    expect(completed?.promptPrefixHash).toBe("aaaaaaaaaaaaaaaa");
    expect(completed?.toolSurfaceHash).toBe("bbbbbbbbbbbbbbbb");
  });

  it("omits cache fields and reports cached=false when the provider reports none", async () => {
    const completed = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* Ref.make<readonly Captured[]>([]);
        yield* emitLLMExchange({
          ...baseArgs,
          response: { content: "ok", tokensIn: 800, tokensOut: 200, durationMs: 90 },
        }).pipe(Effect.provide(recordingBus(sink)));
        const all = yield* Ref.get(sink);
        return all.find((e) => e._tag === "LLMRequestCompleted");
      }),
    );

    expect(completed?.tokensUsed).toBe(1_000);
    expect(completed?.billedTokens).toBe(1_000);
    expect("cacheReadTokensIn" in (completed ?? {})).toBe(false);
    expect(completed?.cached).toBe(false);
  });

  it("does not throw when no EventBus is provided", async () => {
    await Effect.runPromise(
      emitLLMExchange({
        ...baseArgs,
        response: { content: "ok", tokensIn: 1, tokensOut: 1 },
      }),
    );
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/reasoning/src/kernel/utils/llm-request-completed.test.ts --timeout 15000`
Expected: FAIL — the first test fails on `expect(tags).toContain("LLMRequestCompleted")`, because nothing in the repo publishes that tag. This is the RED that proves finding F-1.

- [ ] **Step 3: Extend the argument type**

In `packages/reasoning/src/kernel/utils/diagnostics.ts`, in `emitLLMExchange`'s parameter object type, add after `readonly maxTokens?: number;`:

```ts
  /**
   * Stable hash of the cacheable system-prompt prefix (W2). Optional so call
   * sites that do not compute it (tests, un-mediated calls) stay valid.
   */
  readonly promptPrefixHash?: string;
  /** Stable hash of the ordered wire tool surface (W2). */
  readonly toolSurfaceHash?: string;
```

- [ ] **Step 4: Publish the second event**

In the same file, add the import at the top:

```ts
import { billedInputTokens } from "@reactive-agents/llm-provider";
```

Then, inside `emitLLMExchange`'s `Effect.gen` body, immediately after the existing `busOpt.value.publish({ _tag: "LLMExchangeEmitted", ... })` chain completes, append:

```ts
    // LLMRequestCompleted had NINE consumers and ZERO producers before this
    // (spec finding F-1): the bench's token accumulator, both observability
    // collectors, the observe tracer, runtime.ts, and four Cortex readouts all
    // subscribed to an event nobody emitted. This is the single site that sees
    // provider, model, usage, cache figures, duration and cost together, so it
    // is the one producer. Publishing from anywhere else would recreate the
    // boundary multiplicity this program exists to remove.
    const billed = billedInputTokens({
      inputTokens: args.response.tokensIn,
      outputTokens: args.response.tokensOut,
      cacheReadInputTokens: args.response.cacheReadTokensIn,
    });
    const rawTotal =
      (args.response.tokensIn ?? 0) + (args.response.tokensOut ?? 0);

    yield* busOpt.value
      .publish({
        _tag: "LLMRequestCompleted",
        taskId: args.taskId,
        // No requestId is threaded into this function today. The
        // taskId:iteration:kind triple is unique per call within a run and is
        // what the trace already correlates on.
        requestId: `${args.taskId}:${args.iteration}:${args.requestKind}`,
        model: args.model,
        provider: args.provider,
        durationMs: args.response.durationMs ?? 0,
        tokensUsed: rawTotal,
        ...(typeof args.response.tokensIn === "number"
          ? { tokensIn: args.response.tokensIn }
          : {}),
        ...(typeof args.response.tokensOut === "number"
          ? { tokensOut: args.response.tokensOut }
          : {}),
        cached: billed.cacheRead > 0,
        ...(typeof args.response.cacheReadTokensIn === "number"
          ? { cacheReadTokensIn: args.response.cacheReadTokensIn }
          : {}),
        billedTokens: billed.billedTotal,
        ...(args.promptPrefixHash ? { promptPrefixHash: args.promptPrefixHash } : {}),
        ...(args.toolSurfaceHash ? { toolSurfaceHash: args.toolSurfaceHash } : {}),
        estimatedCost: args.response.costUsd ?? 0,
      })
      .pipe(
        Effect.catchAll((err) =>
          emitErrorSwallowed({
            site: "reasoning/src/kernel/utils/diagnostics.ts:emitLLMRequestCompleted",
            tag: errorTag(err),
          }),
        ),
      );
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test packages/reasoning/src/kernel/utils/llm-request-completed.test.ts --timeout 15000`
Expected: PASS, 4 tests.

- [ ] **Step 6: Run the reasoning suite for regressions**

Run: `bun test packages/reasoning/ --timeout 30000`
Expected: no new failures. The baseline at plan-writing time was 2718 pass / 0 fail / 4 todo. A test asserting an exact published-event count for a run is the plausible breakage; if one appears, update its expectation and note the added event in its comment rather than suppressing the publish.

- [ ] **Step 7: Commit**

```bash
git add packages/reasoning/src/kernel/utils/diagnostics.ts \
        packages/reasoning/src/kernel/utils/llm-request-completed.test.ts
git commit -m "fix(reasoning): LLMRequestCompleted had nine consumers and no producer

The per-call LLM cost stream was dead: benchmarks, both observability
collectors, the observe tracer, runtime.ts and four Cortex readouts all
subscribed to an event nothing published. emitLLMExchange is the single site
that sees usage, cache figures, duration and cost together, so it publishes
it. Carries billed tokens (spec F-1, F-2)."
```

---

### Task 4: Stable prefix hashes

**Files:**
- Create: `packages/reasoning/src/kernel/utils/prefix-hash.ts`
- Create: `packages/reasoning/src/kernel/utils/prefix-hash.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export function hashPromptPrefix(systemPrompt: string | undefined): string`
  - `export function hashToolSurface(toolNames: readonly string[] | undefined): string`

  Both return a 16-character lowercase hex string. The empty/undefined input returns the hash of the empty string, never `""`, so a missing hash and an empty prefix are distinguishable downstream.

**Why order matters and why it is not sorted.** Anthropic caches by exact prefix in `tools` → `system` → `messages` order. The tool surface hash must therefore reflect **wire order**, not a normalized set — two runs sending the same tools in a different order genuinely cannot share a cache entry, and a sorted hash would hide exactly the churn this is built to catch.

- [ ] **Step 1: Write the failing test**

Create `packages/reasoning/src/kernel/utils/prefix-hash.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { hashPromptPrefix, hashToolSurface } from "./prefix-hash.js";

describe("hashPromptPrefix", () => {
  it("is stable for identical input", () => {
    expect(hashPromptPrefix("you are a helpful agent")).toBe(
      hashPromptPrefix("you are a helpful agent"),
    );
  });

  it("changes when one character changes", () => {
    expect(hashPromptPrefix("Remaining steps: 4")).not.toBe(
      hashPromptPrefix("Remaining steps: 3"),
    );
  });

  it("returns a 16-char hex string, never empty, for undefined input", () => {
    const h = hashPromptPrefix(undefined);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("hashToolSurface", () => {
  it("is stable for the same tools in the same order", () => {
    expect(hashToolSurface(["file-read", "file-write"])).toBe(
      hashToolSurface(["file-read", "file-write"]),
    );
  });

  it("is ORDER SENSITIVE — reordering breaks the Anthropic cache prefix", () => {
    expect(hashToolSurface(["file-read", "file-write"])).not.toBe(
      hashToolSurface(["file-write", "file-read"]),
    );
  });

  it("changes when a tool is added", () => {
    expect(hashToolSurface(["file-read"])).not.toBe(
      hashToolSurface(["file-read", "recall"]),
    );
  });

  it("does not collide between a joined name and two names", () => {
    // A naive join(",") makes ["a,b"] and ["a","b"] hash identically.
    expect(hashToolSurface(["a,b"])).not.toBe(hashToolSurface(["a", "b"]));
  });

  it("returns a 16-char hex string for undefined input", () => {
    expect(hashToolSurface(undefined)).toMatch(/^[0-9a-f]{16}$/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/reasoning/src/kernel/utils/prefix-hash.test.ts --timeout 15000`
Expected: FAIL — `Cannot find module './prefix-hash.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/reasoning/src/kernel/utils/prefix-hash.ts`:

```ts
// File: src/kernel/utils/prefix-hash.ts
//
// Cache explainability (W2, spec finding F-8).
//
// Before this, a `cacheRead=0` was a dead end: you learned THAT the prompt
// cache missed, never WHICH segment moved. Anthropic caches by exact prefix in
// `tools` -> `system` -> `messages` order, so churn at position zero
// invalidates every downstream breakpoint. Hashing the two cacheable segments
// separately makes the culprit nameable in a receipt diff.
//
// Pure — no Effect, no state.

import { createHash } from "node:crypto";

/** 16 hex chars = 64 bits. Collision risk is irrelevant for run-local diffs. */
const HASH_LEN = 16;

function hash(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, HASH_LEN);
}

/**
 * Hash of the cacheable system-prompt prefix. Undefined hashes as the empty
 * string rather than returning "", so "no system prompt" and "hash not
 * computed" stay distinguishable at the consumer (absent field vs present hash).
 */
export function hashPromptPrefix(systemPrompt: string | undefined): string {
  return hash(systemPrompt ?? "");
}

/**
 * Hash of the ordered wire tool surface.
 *
 * ORDER SENSITIVE by design. Two runs sending the same tools in a different
 * order genuinely cannot share a cache entry, so normalizing the order would
 * hide the exact churn this exists to catch (failure mode F10). Names are
 * length-prefixed so ["a,b"] and ["a","b"] cannot collide.
 */
export function hashToolSurface(toolNames: readonly string[] | undefined): string {
  const encoded = (toolNames ?? []).map((n) => `${n.length}:${n}`).join("");
  return hash(encoded);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/reasoning/src/kernel/utils/prefix-hash.test.ts --timeout 15000`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/kernel/utils/prefix-hash.ts \
        packages/reasoning/src/kernel/utils/prefix-hash.test.ts
git commit -m "feat(reasoning): stable prefix + tool-surface hashes

A cacheRead=0 was previously unattributable. Order-sensitive on the tool
surface because Anthropic caches by exact prefix and position zero is tools."
```

---

### Task 5: Compute the hashes at the wire

**Files:**
- Modify: `packages/reasoning/src/kernel/observable-llm.ts` (the `emitForRequestWith` body, around lines 150-180)

**Interfaces:**
- Consumes: `hashPromptPrefix`, `hashToolSurface` (Task 4); `emitLLMExchange`'s widened argument (Task 3).
- Produces: every `LLMExchangeEmitted` and `LLMRequestCompleted` from a mediated call now carries both hashes.

- [ ] **Step 1: Write the failing test**

Append to `packages/reasoning/src/kernel/utils/llm-request-completed.test.ts` — no, put this one with its subject. Append to `packages/reasoning/src/kernel/observable-llm.test.ts`, inside the existing top-level `describe`:

```ts
  it("stamps promptPrefixHash and toolSurfaceHash on the emitted exchange", async () => {
    // Mirrors the existing exchange-capture tests in this file: build the
    // observable layer over a stub LLMService, run one complete(), read the
    // captured LLMExchangeEmitted.
    const exchange = await captureExchange({
      systemPrompt: "you are a test agent",
      tools: [{ name: "file-read" }, { name: "file-write" }],
    });

    expect(exchange.promptPrefixHash).toMatch(/^[0-9a-f]{16}$/);
    expect(exchange.toolSurfaceHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes toolSurfaceHash when the wire tool order changes", async () => {
    const a = await captureExchange({
      systemPrompt: "s",
      tools: [{ name: "file-read" }, { name: "file-write" }],
    });
    const b = await captureExchange({
      systemPrompt: "s",
      tools: [{ name: "file-write" }, { name: "file-read" }],
    });
    expect(a.toolSurfaceHash).not.toBe(b.toolSurfaceHash);
  });
```

Read the existing tests in that file first and reuse whatever capture helper they already use; if there is no reusable helper, extract the setup from the existing `"surfaces cacheReadInputTokens/cacheCreationInputTokens..."` test (around line 253) into a local `captureExchange(opts)` helper and have both the existing test and these two use it. Do not duplicate the layer setup.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/reasoning/src/kernel/observable-llm.test.ts --timeout 15000`
Expected: FAIL — `expect(undefined).toMatch(...)`, because the hashes are not computed yet.

- [ ] **Step 3: Compute and pass the hashes**

In `packages/reasoning/src/kernel/observable-llm.ts`, add the import:

```ts
import { hashPromptPrefix, hashToolSurface } from "./utils/prefix-hash.js";
```

Then, inside `emitForRequestWith`, in the object passed to `emitLLMExchange`, add immediately after the existing `toolSchemaNames: request.tools?.map((t) => t.name),` line:

```ts
    // W2 — hash the two cacheable prefix segments so a cacheRead=0 names its
    // own cause. The system prompt is hashed AS SENT (post-assembly), which is
    // the whole point: if the volatile tail leaked back into the cached block,
    // this hash churns and the receipt shows it.
    promptPrefixHash: hashPromptPrefix(systemPromptForHash),
    toolSurfaceHash: hashToolSurface(request.tools?.map((t) => t.name)),
```

`systemPromptForHash` must be the **untruncated** system prompt as sent. `emitLLMExchange` truncates for the trace payload at `SYSTEM_PROMPT_MAX`; hashing the truncated text would make two different prompts sharing a 4,000-character head hash identically. Locate how the system prompt reaches `emitForRequestWith` (it is derived from `request.messages` via `toExchangeMessages`) and hash the pre-truncation string. If the function does not currently hold it separately, bind it once at the top of `emitForRequestWith`:

```ts
  // Untruncated on purpose — see promptPrefixHash below.
  const systemPromptForHash = request.messages.find((m) => m.role === "system")
    ? messageContentToString(
        request.messages.find((m) => m.role === "system")!.content,
      )
    : undefined;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/reasoning/src/kernel/observable-llm.test.ts --timeout 15000`
Expected: PASS, including the two new tests and the pre-existing cache-usage test.

- [ ] **Step 5: Run the reasoning suite**

Run: `bun test packages/reasoning/ --timeout 30000`
Expected: no new failures.

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/kernel/observable-llm.ts \
        packages/reasoning/src/kernel/observable-llm.test.ts
git commit -m "feat(reasoning): stamp prefix + tool-surface hashes on every exchange

Hashed pre-truncation so two prompts sharing a 4000-char head do not collide."
```

---

### Task 6: Thread billed tokens into the run result and the bench

**Files:**
- Modify: `packages/runtime/src/types.ts` (the execution-context/result metadata schema, around lines 170-180)
- Modify: `packages/runtime/src/runtime.ts:924` (the `LLMRequestCompleted` subscriber)
- Modify: `packages/benchmarks/src/types.ts:225-245`
- Modify: `packages/benchmarks/src/runner.ts:163-165`, `:237`, `:1010`

**Interfaces:**
- Consumes: the now-live `LLMRequestCompleted` with `billedTokens` / `cacheReadTokensIn` (Task 3).
- Produces:
  - `AgentResult.metadata.billedTokens?: number` and `.cacheReadTokens?: number`
  - `RunScore.billedTokens: number` (defaults 0)
  - `TaskVariantReport.meanBilledTokens: number`, `TaskVariantReport.meanCacheReadTokens: number`

  Task 7 reads `meanBilledTokens` and `meanCacheReadTokens` by exactly these names.

- [ ] **Step 1: Write the failing test**

Create `packages/benchmarks/tests/billed-token-rollup.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { aggregateRuns } from "../src/runner.js";

// `aggregateRuns` is the function at runner.ts:1010 that folds RunScore[] into
// a TaskVariantReport. If it is not currently exported, export it — it is pure
// and this is the only way to pin the rollup without a live model.
describe("billed-token rollup", () => {
  it("means billed tokens and cache reads separately from raw tokens", () => {
    const report = aggregateRuns([
      {
        runIndex: 0,
        dimensions: [{ dimension: "accuracy", score: 1 }],
        tokensUsed: 10_500,
        billedTokens: 1_500,
        cacheReadTokens: 9_000,
        durationMs: 10,
        status: "success" as const,
      },
      {
        runIndex: 1,
        dimensions: [{ dimension: "accuracy", score: 1 }],
        tokensUsed: 10_500,
        billedTokens: 2_500,
        cacheReadTokens: 8_000,
        durationMs: 10,
        status: "success" as const,
      },
    ]);

    expect(report.meanTokens).toBe(10_500);
    expect(report.meanBilledTokens).toBe(2_000);
    expect(report.meanCacheReadTokens).toBe(8_500);
  });

  it("falls back to raw tokens when no run reports a billed figure", () => {
    const report = aggregateRuns([
      {
        runIndex: 0,
        dimensions: [{ dimension: "accuracy", score: 1 }],
        tokensUsed: 4_000,
        durationMs: 10,
        status: "success" as const,
      },
    ]);

    // A provider without cache reporting must not read as "0 billed tokens",
    // which would make every such arm trivially pass the cost leg.
    expect(report.meanBilledTokens).toBe(4_000);
    expect(report.meanCacheReadTokens).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/benchmarks/tests/billed-token-rollup.test.ts --timeout 15000`
Expected: FAIL — either `aggregateRuns` is not exported, or `meanBilledTokens` is `undefined`.

- [ ] **Step 3: Add the fields to the bench types**

In `packages/benchmarks/src/types.ts`, on `RunScore` (the interface containing `tokensUsed` at line 225):

```ts
  /**
   * Provider-billed tokens for this run: `(inputTokens - cacheRead) + output`.
   * Optional because replayed/deterministic runs and providers without cache
   * reporting do not produce one; consumers fall back to `tokensUsed`, NEVER
   * to 0 — a 0 default would make every such arm trivially pass the cost leg.
   */
  readonly billedTokens?: number;
  /** Input tokens served from a prompt-cache hit. Absent means "not reported". */
  readonly cacheReadTokens?: number;
```

On `TaskVariantReport`, immediately after `readonly meanTokens: number;` (line 242):

```ts
  /**
   * Mean billed tokens across runs — the figure the lift gate's token leg
   * scores as of the 2026-08-24 amendment. `meanTokens` above stays RAW and is
   * retained on every receipt so historical reports stay readable.
   */
  readonly meanBilledTokens: number;
  /** Mean cache-read input tokens across runs. 0 when unreported. */
  readonly meanCacheReadTokens: number;
```

- [ ] **Step 4: Populate them in the rollup**

In `packages/benchmarks/src/runner.ts`, at the aggregation site (line 1010, alongside the existing `meanTokens`):

```ts
    meanTokens: Math.round(runs.reduce((a, r) => a + r.tokensUsed, 0) / runs.length),
    // Fall back to the RAW figure per run, not to 0 — a provider with no cache
    // reporting must score as "billed everything", which is the truth.
    meanBilledTokens: Math.round(
      runs.reduce((a, r) => a + (r.billedTokens ?? r.tokensUsed), 0) / runs.length,
    ),
    meanCacheReadTokens: Math.round(
      runs.reduce((a, r) => a + (r.cacheReadTokens ?? 0), 0) / runs.length,
    ),
```

Also patch the two zero-value literals that construct an empty report (line 958 and line 1350) to include `meanBilledTokens: 0, meanCacheReadTokens: 0`, or the build fails on the now-required fields.

- [ ] **Step 5: Accumulate the live event in the runner**

In `packages/benchmarks/src/runner.ts`, extend the subscriber at lines 163-165:

```ts
    let cumulativeBilledTokens = 0;
    let cumulativeCacheReadTokens = 0;
    // ...
      if (event._tag === "LLMRequestCompleted") {
        cumulativeTokens += event.tokensUsed;
        cumulativeCost += event.estimatedCost;
        // Before the F-1 fix nothing published this event, so these
        // accumulators sat at 0 and the bench silently fell through to
        // agentResult.metadata.tokensUsed. They are live now.
        cumulativeBilledTokens += event.billedTokens ?? event.tokensUsed;
        cumulativeCacheReadTokens += event.cacheReadTokensIn ?? 0;
      }
```

Then carry both onto the returned `TaskResult` at line 237 and the failure path at line 218, mirroring how `tokensUsed` is already carried.

- [ ] **Step 6: Add the fields to the runtime result metadata**

In `packages/runtime/src/types.ts`, in the result-metadata schema next to `tokensUsed: Schema.Number`:

```ts
  /** Provider-billed tokens: `(input - cacheRead) + output`. Absent when unreported. */
  billedTokens: Schema.optional(Schema.Number),
  /** Input tokens served from a prompt-cache hit. Absent when unreported. */
  cacheReadTokens: Schema.optional(Schema.Number),
```

In `packages/runtime/src/runtime.ts:924`, extend the existing `LLMRequestCompleted` handler to accumulate `event.billedTokens` and `event.cacheReadTokensIn` alongside `event.tokensUsed`, following the accumulation pattern already in that block.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test packages/benchmarks/tests/billed-token-rollup.test.ts --timeout 15000`
Expected: PASS, 2 tests.

Run: `bun test packages/benchmarks/ --timeout 30000` and `bun test packages/runtime/ --timeout 30000`
Expected: no new failures.

- [ ] **Step 8: Verify the workspace builds**

Run: `bunx turbo run build`
Expected: 37/37 clean.

- [ ] **Step 9: Commit**

```bash
git add packages/runtime/src/types.ts packages/runtime/src/runtime.ts \
        packages/benchmarks/src/types.ts packages/benchmarks/src/runner.ts \
        packages/benchmarks/tests/billed-token-rollup.test.ts
git commit -m "feat(runtime,benchmarks): carry billed tokens and cache reads to the result

Falls back to the raw figure, never to 0 — a provider without cache reporting
must score as 'billed everything', not as free."
```

---

### Task 7: Switch the lift gate's token leg

> **RATIFICATION GATE.** Do not start this task until the owner has accepted §5 item 1 of [[../../Decisions/2026-08-24-external-research-convergence-amendment]]. This task changes what "improvement" means in this codebase (09 C4).

**Files:**
- Modify: `packages/benchmarks/src/gate/types.ts` (`LiftPolicy`, `DEFAULT_LIFT_POLICY`, `TierEvidence`)
- Modify: `packages/benchmarks/src/gate/gate.ts:206-208` and the `costOk` branch (~line 286)
- Modify: `packages/benchmarks/src/gate/receipt.ts`
- Create: `packages/benchmarks/tests/gate-billed-token-leg.test.ts`

**Interfaces:**
- Consumes: `TaskVariantReport.meanBilledTokens`, `.meanCacheReadTokens` (Task 6).
- Produces:
  - `LiftPolicy.tokenLeg: "raw" | "billed"` (default `"billed"`)
  - `TierEvidence.billedTokenOverheadPct: number`, `TierEvidence.cacheHitRate: number`
  - `TierEvidence.tokenOverheadPct` keeps its current meaning (raw) and is never removed.

- [ ] **Step 1: Write the failing test**

Create `packages/benchmarks/tests/gate-billed-token-leg.test.ts`. Reuse the `scores` / `runsOf` / `tvr` fixture builders already defined at the top of `packages/benchmarks/tests/gate.test.ts` — import them if they are exported, otherwise copy the three helpers verbatim into this file with a comment pointing at their origin.

```ts
import { describe, expect, it } from "bun:test";
import { projectTierEvidence } from "../src/gate/gate.js";
import { DEFAULT_LIFT_POLICY } from "../src/gate/types.js";

describe("billed token leg", () => {
  it("defaults to the billed leg", () => {
    expect(DEFAULT_LIFT_POLICY.tokenLeg).toBe("billed");
  });

  it("passes a caching arm that the raw leg would fail", () => {
    // The RA_STABLE_TOOL_SURFACE shape (spec F-3): +33% RAW tokens, but the
    // extra is all cache reads, so billed overhead is NEGATIVE.
    const evidence = projectTierEvidence({
      tier: "haiku",
      baseline: { meanTokens: 30_000, meanBilledTokens: 30_000, meanCacheReadTokens: 0, accuracy: 0.6 },
      candidate: { meanTokens: 40_000, meanBilledTokens: 28_000, meanCacheReadTokens: 12_000, accuracy: 0.7 },
      policy: DEFAULT_LIFT_POLICY,
    });

    expect(Math.round(evidence.tokenOverheadPct)).toBe(33);
    expect(Math.round(evidence.billedTokenOverheadPct)).toBe(-7);
    expect(evidence.costOk).toBe(true);
  });

  it("fails the same arm under the raw leg, proving the legs differ", () => {
    const evidence = projectTierEvidence({
      tier: "haiku",
      baseline: { meanTokens: 30_000, meanBilledTokens: 30_000, meanCacheReadTokens: 0, accuracy: 0.6 },
      candidate: { meanTokens: 40_000, meanBilledTokens: 28_000, meanCacheReadTokens: 12_000, accuracy: 0.7 },
      policy: { ...DEFAULT_LIFT_POLICY, tokenLeg: "raw" },
    });

    expect(evidence.costOk).toBe(false);
  });

  it("still fails an arm that is genuinely more expensive in billed terms", () => {
    // The amendment must not become a way to pass an expensive mechanism.
    const evidence = projectTierEvidence({
      tier: "haiku",
      baseline: { meanTokens: 30_000, meanBilledTokens: 30_000, meanCacheReadTokens: 0, accuracy: 0.6 },
      candidate: { meanTokens: 45_000, meanBilledTokens: 44_000, meanCacheReadTokens: 1_000, accuracy: 0.7 },
      policy: DEFAULT_LIFT_POLICY,
    });

    expect(Math.round(evidence.billedTokenOverheadPct)).toBe(47);
    expect(evidence.costOk).toBe(false);
  });

  it("reports the candidate cache-hit rate", () => {
    const evidence = projectTierEvidence({
      tier: "haiku",
      baseline: { meanTokens: 30_000, meanBilledTokens: 30_000, meanCacheReadTokens: 0, accuracy: 0.6 },
      candidate: { meanTokens: 40_000, meanBilledTokens: 28_000, meanCacheReadTokens: 12_000, accuracy: 0.7 },
      policy: DEFAULT_LIFT_POLICY,
    });

    expect(evidence.cacheHitRate).toBeCloseTo(0.3, 2); // 12000 / 40000
  });
});
```

**Note on shape.** `projectTierEvidence`'s real signature takes `SessionReport`-shaped inputs, not the flat object above. Read its current signature first and build the fixtures with the existing `tvr(...)` helper so this test calls the real function; the flat literals above show the *numbers* each assertion depends on, not a new API. Do not add a parallel overload to make the test convenient.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/benchmarks/tests/gate-billed-token-leg.test.ts --timeout 15000`
Expected: FAIL on the first assertion — `DEFAULT_LIFT_POLICY.tokenLeg` is `undefined`.

- [ ] **Step 3: Add the policy field**

In `packages/benchmarks/src/gate/types.ts`, on `LiftPolicy`, immediately after `maxTokenOverheadPct`:

```ts
  /**
   * Which token figure the cost leg scores (2026-08-24 amendment §4).
   *
   * "billed" — `(input - cacheRead) + output`. The default. Raw tokens stopped
   *            tracking cost when prompt caching shipped: a cached prefix read
   *            is billed at roughly a tenth of a fresh one, so the raw leg
   *            penalised the only mechanism that caches by construction
   *            (RA_STABLE_TOOL_SURFACE: +33.3% raw tokens, -4.4% money).
   * "raw"    — pre-amendment behavior. Retained so an archived report can be
   *            re-scored under the rule that was in force when it was produced.
   *
   * The leg stays denominated in TOKENS in both cases. USD was considered and
   * rejected: it imports vendor pricing into a gate that must stay comparable
   * across providers and across time.
   */
  readonly tokenLeg: "raw" | "billed";
```

In `DEFAULT_LIFT_POLICY`, add `tokenLeg: "billed",`.

On `TierEvidence`, immediately after `tokenOverheadPct`:

```ts
  /** (candidateBilled − baselineBilled) / baselineBilled × 100. Scored by default. */
  readonly billedTokenOverheadPct: number;
  /** Candidate `meanCacheReadTokens / meanTokens`, 0..1. 0 when unreported. */
  readonly cacheHitRate: number;
```

- [ ] **Step 4: Score on the configured leg**

In `packages/benchmarks/src/gate/gate.ts`, extend the block at lines 206-208:

```ts
  const baseTokens = mean(pairedBase.map((r) => r.meanTokens));
  const candTokens = mean(pairedCand.map((r) => r.meanTokens));
  const tokenOverheadPct =
    baseTokens === 0 ? 0 : ((candTokens - baseTokens) / baseTokens) * 100;

  // Billed leg (2026-08-24 amendment §4). Both figures are computed and both
  // are reported; `policy.tokenLeg` decides which one the AND is evaluated on.
  // Raw is NEVER dropped — archived reports and prior verdicts stay auditable.
  const baseBilled = mean(pairedBase.map((r) => r.meanBilledTokens));
  const candBilled = mean(pairedCand.map((r) => r.meanBilledTokens));
  const billedTokenOverheadPct =
    baseBilled === 0 ? 0 : ((candBilled - baseBilled) / baseBilled) * 100;
  const candCacheRead = mean(pairedCand.map((r) => r.meanCacheReadTokens));
  const cacheHitRate = candTokens === 0 ? 0 : candCacheRead / candTokens;
```

Then in the `costOk` branch (the `else` at roughly line 286), replace:

```ts
    costOk = tokenOverheadPct <= policy.maxTokenOverheadPct;
```

with:

```ts
    const scoredOverheadPct =
      policy.tokenLeg === "raw" ? tokenOverheadPct : billedTokenOverheadPct;
    costOk = scoredOverheadPct <= policy.maxTokenOverheadPct;
```

Add `billedTokenOverheadPct` and `cacheHitRate` to the returned `TierEvidence` object. Leave the `long-horizon` branch's cost-per-deliverable logic alone — it already divides tokens by a pass rate, and switching its numerator is a separate ruling this amendment does not make. Add a comment saying so:

```ts
    // Long-horizon CPD keeps the RAW numerator for now. Switching it is a
    // separate ruling the 2026-08-24 amendment deliberately did not make.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test packages/benchmarks/tests/gate-billed-token-leg.test.ts --timeout 15000`
Expected: PASS, 5 tests.

- [ ] **Step 6: Print both legs on the receipt**

In `packages/benchmarks/src/gate/receipt.ts`, extend the per-tier line so it shows raw, billed and cache-hit rate together — a receipt that showed only the scored leg would make the amendment invisible to a future reader:

```ts
  // Both legs on every receipt. A reader must be able to see WHY a verdict
  // differs from a pre-amendment one without re-running anything.
  `tokens raw ${fmtPct(e.tokenOverheadPct)} | billed ${fmtPct(e.billedTokenOverheadPct)}` +
  ` (scored: ${policy.tokenLeg}) | cacheHit ${(e.cacheHitRate * 100).toFixed(1)}%`
```

Match the file's existing formatting helpers and column style rather than introducing new ones.

- [ ] **Step 7: Run the full gate suite**

Run: `bun test packages/benchmarks/ --timeout 30000`
Expected: existing gate tests still pass. Several construct `TierEvidence` or `TaskVariantReport` fixtures and will need `meanBilledTokens` / `meanCacheReadTokens` / `tokenLeg` added. Set fixtures where cache is irrelevant to `meanBilledTokens: <same as meanTokens>, meanCacheReadTokens: 0` — that is the no-caching case and it keeps every existing assertion numerically unchanged, which is the point.

- [ ] **Step 8: Commit**

```bash
git add packages/benchmarks/src/gate/ packages/benchmarks/tests/gate-billed-token-leg.test.ts
git commit -m "feat(gate): score the cost leg on billed tokens, not raw

Ratified 2026-08-24. Raw tokens stopped tracking cost when prompt caching
shipped: a cached prefix read bills at ~0.1x but counted at 1.0x, penalising
the one mechanism that caches by construction. Leg stays in tokens, never USD.
Raw is retained and printed on every receipt."
```

---

### Task 8: Enforcement script, docs, and the honesty check

**Files:**
- Create: `scripts/check-cost-accounting.sh`
- Modify: `scripts/check-cross-cutting.sh`
- Modify: `CHANGELOG.md`
- Modify: `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md` (§2, §4, §5.3, §6.8, §6.11)

**Interfaces:**
- Consumes: everything above.
- Produces: a grep-able gate. Per 09 §2, "one owner module + one grep-able enforcement script per subsystem. No script → not done."

- [ ] **Step 1: Write the check**

Create `scripts/check-cost-accounting.sh`:

```bash
#!/usr/bin/env bash
# Check N — cost accounting is cache-aware (2026-08-24 amendment §4).
#
# Two invariants:
#   1. LLMRequestCompleted has at least one producer. It shipped with nine
#      consumers and zero producers for months (spec finding F-1); this makes
#      that regression loud.
#   2. The lift gate's cost leg reads a `billed` figure, not a raw one.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

producers=$(grep -rn '_tag: "LLMRequestCompleted"' packages/*/src apps/*/  \
  --include='*.ts' 2>/dev/null | grep -v '/dist/' | grep -v '\.test\.ts' | wc -l)
if [ "$producers" -lt 1 ]; then
  echo "FAIL: LLMRequestCompleted has no producer. The per-call cost stream is dead."
  fail=1
else
  echo "ok: LLMRequestCompleted producers: $producers"
fi

if ! grep -q 'billedTokenOverheadPct' packages/benchmarks/src/gate/gate.ts; then
  echo "FAIL: gate.ts does not compute billedTokenOverheadPct — cost leg is cache-blind."
  fail=1
else
  echo "ok: gate computes the billed token leg"
fi

if ! grep -q 'tokenLeg' packages/benchmarks/src/gate/types.ts; then
  echo "FAIL: LiftPolicy has no tokenLeg field."
  fail=1
else
  echo "ok: LiftPolicy declares tokenLeg"
fi

exit $fail
```

- [ ] **Step 2: Make it executable and run it**

```bash
chmod +x scripts/check-cost-accounting.sh
./scripts/check-cost-accounting.sh
```

Expected: three `ok:` lines, exit 0.

- [ ] **Step 3: Prove the check can fail**

Temporarily comment out the `_tag: "LLMRequestCompleted"` publish added in Task 3, re-run the script, confirm it exits non-zero with the FAIL line, then restore. A gate that has never been observed red is not a gate.

- [ ] **Step 4: Register it in the cross-cutting runner**

In `scripts/check-cross-cutting.sh`, add the invocation alongside the existing checks, following that file's established pattern for numbering and failure aggregation.

- [ ] **Step 5: Update `09-UNIFIED-PROGRAM.md`**

Five edits, each citing this amendment:

1. **§2 lift rule** — change the token leg wording to billed input tokens, with a pointer to [[../../Decisions/2026-08-24-external-research-convergence-amendment]].
2. **§4 verified state** — add a row: `LLMRequestCompleted producers | 1 (was 0) | scripts/check-cost-accounting.sh`.
3. **§5.3** — append: *"Superseded in part 2026-08-24. The verdict was correct under the rule as written; the rule's token leg was cache-blind. Re-measure under the billed leg before citing this section's numbers as a disposition."* Do not delete the section — it is the record of a correct call under a wrong instrument.
4. **§6.8 and §6.11** — mark the two-consolidators item and the API-key-prefix item **RESOLVED (verified 2026-08-24)** with the file evidence from spec F-5. Note that §6.9 remains open (shallow validation only).
5. **§7** — insert W1/W2 ahead of Step 0 residue and reference the workstream table in the amendment.

- [ ] **Step 6: Update `CHANGELOG.md`**

Under Unreleased:

```markdown
### Fixed
- `LLMRequestCompleted` was declared and consumed in nine places but published
  by nothing, leaving the per-call LLM token/cost stream dead across the
  benchmark runner, both observability collectors, the trace tracer and the
  Cortex live readouts. It is now published from the kernel's single
  LLM-exchange emission site.

### Added
- Prompt-cache accounting reaches the run result and the benchmark gate:
  `billedTokens` and `cacheReadTokens` on run metadata, `meanBilledTokens` and
  `meanCacheReadTokens` on benchmark reports.
- `promptPrefixHash` and `toolSurfaceHash` on every LLM exchange, so a
  prompt-cache miss is attributable to a named prefix segment.

### Changed
- The lift gate's cost leg now scores **billed** input tokens
  (`input − cacheRead`) rather than raw tokens, configurable via
  `LiftPolicy.tokenLeg`. Raw overhead is still computed and printed on every
  receipt. The leg remains denominated in tokens, not USD.
```

- [ ] **Step 7: Full verification**

```bash
bunx turbo run build
bun test --timeout 60000
./scripts/check-cross-cutting.sh
```

Expected: build 37/37; suite green against the plan-time baseline of 8,890+ pass / 0 fail; all cross-cutting checks ok. **Report the actual numbers.** If anything fails, say so with the output — do not report completion.

- [ ] **Step 8: Commit**

```bash
git add scripts/check-cost-accounting.sh scripts/check-cross-cutting.sh \
        CHANGELOG.md wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md
git commit -m "chore(gate): enforce cache-aware cost accounting; sync 09 and CHANGELOG

Adds check-cost-accounting.sh (verified red before green). Marks 09 6.8 and
6.11 resolved with file evidence; 6.9 stays open."
```

---

### Task 9: Re-measure under the corrected instrument

> **This task requires live model calls and cannot run in CI.** It is the honesty half of the amendment: the rule change must be paid for with a measurement, not assumed.

**Files:**
- Modify: none (measurement only)
- Create: `wiki/Research/Harness-Reports/2026-08-24-billed-token-rebaseline.md`

- [ ] **Step 1: Confirm the instrument reports cache data end to end**

Run one short haiku task and read the receipt. Confirm `cacheHitRate > 0` on at least one arm and that `promptPrefixHash` is stable across iterations within a run where it should be.

**If `cacheHitRate` is 0 on every arm, STOP.** That is the F10 prefix-churn defect still live, not a null result, and the rebaseline is meaningless until it is explained — which is precisely what the Task 4 hashes exist to make possible. Diff the per-iteration `promptPrefixHash` and `toolSurfaceHash` and report which segment churns.

- [ ] **Step 2: Re-run the disclosure ablation**

Run **in the foreground** with an explicit timeout — background bench cells get SIGKILLed and silently produce nothing:

```bash
timeout 590 bun run packages/benchmarks/src/disclosure-ablation.ts --output wiki/Research/Harness-Reports/raw/2026-08-24-disclosure-billed.json
```

`--output` is required or nothing persists. Do not run this under a Monitor.

- [ ] **Step 3: Score both legs and write the report**

Create `wiki/Research/Harness-Reports/2026-08-24-billed-token-rebaseline.md` recording, per arm: raw tokens, billed tokens, cache-read tokens, cache-hit rate, USD, correctness, and the gate verdict under **both** `tokenLeg: "raw"` and `tokenLeg: "billed"`.

State the sample size and its limits explicitly (`n`, model, task count). Per 09 §2, bench cells are Bernoulli — with 5 tasks and n ≤ 5 the standard error is roughly 13pp and accuracy gaps under 26pp are noise. **The accuracy leg is very unlikely to be resolvable at this n.** Say that in the report rather than reading a small gap as a result. The cost leg is a near-deterministic measurement and is what this rebaseline is actually for.

- [ ] **Step 4: Route the promotion decision to `ablation-warden`**

Do **not** promote `RA_STABLE_TOOL_SURFACE` to default-on from this plan. Hand the report to `ablation-warden`, which holds the veto and applies the promotion band (1.96σ) and the cross-tier requirement (rungs 2 and 3 must agree in sign). If it still fails, it still fails — record that outcome with the same prominence as a pass.

- [ ] **Step 5: Commit the report**

```bash
git add wiki/Research/Harness-Reports/2026-08-24-billed-token-rebaseline.md \
        wiki/Research/Harness-Reports/raw/2026-08-24-disclosure-billed.json
git commit -m "bench: rebaseline the disclosure ablation under the billed token leg"
```

---

## Self-Review

**Spec coverage.** W1 (F-1, F-2, F-3) → Tasks 1, 2, 3, 6, 7, 9. W2 (F-8 hashes) → Tasks 4, 5. Spec §4's "re-run the disclosure ablation under the corrected leg" → Task 9. Spec §5 item 3 (stale debt closure, F-5) → Task 8 Step 5. **Deliberately out of scope:** W3–W7 (separate plans, WIP=1), the MCP server surface and per-kind trace validation (spec W7 residue), and the long-horizon cost-per-deliverable numerator (Task 7 Step 4 records the non-decision explicitly).

**Type consistency.** `billedInputTokens` / `BilledTokens` (Task 1) are the sole subtraction site, consumed in Task 3. Event fields `cacheReadTokensIn` / `billedTokens` / `promptPrefixHash` / `toolSurfaceHash` are named identically in Task 2 (declaration), Task 3 (publish), Task 5 (hash source) and Task 6 (consumption). Bench fields `meanBilledTokens` / `meanCacheReadTokens` are declared in Task 6 and read in Task 7. `LiftPolicy.tokenLeg` is declared and consumed in Task 7.

**Known soft spots, flagged rather than hidden.** Task 5's `systemPromptForHash` binding and Task 7's `projectTierEvidence` fixture shape both depend on current function signatures that the implementer must read before writing — each step says so and says what the constraint is (hash pre-truncation; call the real function, do not add a convenience overload). Task 6's `aggregateRuns` may need an export added. These are read-then-write steps, not placeholders.

---

## Execution Handoff

Plan saved to `wiki/Planning/Implementation-Plans/2026-08-24-cost-instrument-truth.md`.

Tasks 1–6 and 8 are safe to execute now. **Task 7 is blocked on ratification** of the spec's §5 item 1. Task 9 requires live model access and must run in the foreground.
