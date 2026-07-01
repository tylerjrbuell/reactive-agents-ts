# Cross-Tier Thinking Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every LLM provider (anthropic, openai, gemini, local) honor one unified `thinking` contract with the visible-answer budget always protected, exposed via `.withThinking()`, shipped opt-in and empirically ablation-gated.

**Architecture:** Thinking is provider-config-level (`config.thinking` boolean + `config.thinkingOptions`). A shared module resolves the tri-state (`undefined`→off everywhere) and computes a bounded thinking budget; each adapter reads its own `config` closure, enables the provider-native param, and sets `maxOut = answer + reserve`. No kernel change; per-request thinking is a documented unbuilt seam.

**Tech Stack:** TypeScript (strict, no `any`), Effect-TS, Bun test, fast-check (available), `@reactive-agents/llm-provider` capability table.

**Spec:** `wiki/Architecture/Design-Specs/2026-07-01-cross-tier-thinking.md`

## Global Constraints

- Strict TypeScript — no `any` casts; use `unknown` + guards or proper types.
- TDD mandatory: RED→GREEN, every test carries `--timeout 15000`, error paths use `Effect.flip`.
- Type gate is `cd packages/<pkg> && bunx tsc --noEmit` — NOT `bun run build` (tsup masks real tsc errors).
- `undefined` → thinking OFF for ALL providers (control-pillar: no auto-enable by inference). This flips gemini's current thinks-by-default to opt-in — intended.
- Additive / non-breaking: `.withModel({thinking})` boolean stays; `.withThinking()` is the rich-config home. Both write `config.thinking`.
- Thinking budget bounded: `clamp(budgetTokens ?? answer*4, 1024, 16384)`.
- Incapable model + `thinking:true` → dedupe-warn, degrade to off, never crash.
- No co-author trailers in commits. Commit own files only.
- Ships opt-in/off; ablation promotes a tier to default-on only if it clears the lift rule (≥3pp ∧ ≤15%tok ∧ ≥2 tiers).

## File Structure

- `packages/llm-provider/src/thinking/index.ts` — re-exports (new)
- `packages/llm-provider/src/thinking/resolve.ts` — `resolveThinkingEnabled`, `ThinkingOptions`, warn-dedupe (new)
- `packages/llm-provider/src/thinking/budget.ts` — `reserveThinkingBudget` (new)
- `packages/llm-provider/src/thinking/*.test.ts` — unit tests (new)
- `packages/llm-provider/src/llm-config.ts` — add `thinkingOptions?` field (modify)
- `packages/llm-provider/src/providers/{gemini,anthropic,openai,local}.ts` — adapter wiring (modify)
- `packages/llm-provider/src/capability.ts` — add one openai reasoning-capable entry (modify)
- `packages/runtime/src/types.ts` — `ModelParamsSchema` + `RuntimeOptions` thinkingOptions (modify)
- `packages/runtime/src/builder.ts` + `builder/withers/model-budget.ts` + `builder/withers/_state.ts` + `builder/to-config.ts` + `builder/build-effect/runtime-construction.ts` + `runtime.ts` — `.withThinking()` + threading (modify)
- `packages/benchmarks/src/sessions/thinking-ablation.ts` — ablation session (new)

---

### Task 1: Shared thinking module (resolver + budget)

**Files:**
- Create: `packages/llm-provider/src/thinking/resolve.ts`
- Create: `packages/llm-provider/src/thinking/budget.ts`
- Create: `packages/llm-provider/src/thinking/index.ts`
- Test: `packages/llm-provider/src/thinking/thinking.test.ts`

**Interfaces:**
- Produces:
  - `interface ThinkingOptions { readonly enabled?: boolean; readonly effort?: "low"|"medium"|"high"; readonly budgetTokens?: number }`
  - `resolveThinkingEnabled(provider: string, model: string, configThinking: boolean | undefined, supportsThinkingMode: boolean, requestOverride?: boolean): boolean`
  - `reserveThinkingBudget(answerBudget: number, supportsThinkingMode: boolean, opts?: ThinkingOptions): number | undefined`
  - `THINKING_MIN = 1024`, `THINKING_MAX = 16384`

- [ ] **Step 1: Write the failing test**

```typescript
// Run: bun test packages/llm-provider/src/thinking/thinking.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import {
  resolveThinkingEnabled,
  reserveThinkingBudget,
  THINKING_MIN,
  THINKING_MAX,
} from "./index.js";

describe("resolveThinkingEnabled — tri-state, opt-in", () => {
  it("undefined → off (opt-in, no auto-enable by inference)", () => {
    expect(resolveThinkingEnabled("gemini", "gemini-2.5-pro", undefined, true)).toBe(false);
    expect(resolveThinkingEnabled("anthropic", "claude-opus-4-8", undefined, true)).toBe(false);
  });
  it("false → off even when capable", () => {
    expect(resolveThinkingEnabled("anthropic", "claude-opus-4-8", false, true)).toBe(false);
  });
  it("true + capable → on", () => {
    expect(resolveThinkingEnabled("anthropic", "claude-opus-4-8", true, true)).toBe(true);
  });
  it("true + incapable → off (degrade, no crash)", () => {
    expect(resolveThinkingEnabled("openai", "gpt-5.5", true, false)).toBe(false);
  });
  it("requestOverride wins over config (unbuilt seam, precedence proven)", () => {
    expect(resolveThinkingEnabled("anthropic", "claude-opus-4-8", false, true, true)).toBe(true);
    expect(resolveThinkingEnabled("anthropic", "claude-opus-4-8", true, true, false)).toBe(false);
  });
});

describe("reserveThinkingBudget — bounded", () => {
  it("off/undefined enabled → undefined (caller leaves budget untouched)", () => {
    expect(reserveThinkingBudget(2000, true, { enabled: false })).toBeUndefined();
    expect(reserveThinkingBudget(2000, true, undefined)).toBeUndefined();
  });
  it("incapable → undefined", () => {
    expect(reserveThinkingBudget(2000, false, { enabled: true })).toBeUndefined();
  });
  it("enabled + capable → clamp(answer*4, MIN, MAX)", () => {
    expect(reserveThinkingBudget(2000, true, { enabled: true })).toBe(8000); // 2000*4
    expect(reserveThinkingBudget(100, true, { enabled: true })).toBe(THINKING_MIN); // floor
    expect(reserveThinkingBudget(100000, true, { enabled: true })).toBe(THINKING_MAX); // ceil
  });
  it("explicit budgetTokens overrides the scaled default (still clamped)", () => {
    expect(reserveThinkingBudget(2000, true, { enabled: true, budgetTokens: 4096 })).toBe(4096);
    expect(reserveThinkingBudget(2000, true, { enabled: true, budgetTokens: 999999 })).toBe(THINKING_MAX);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/llm-provider/src/thinking/thinking.test.ts --timeout 15000`
Expected: FAIL — `Cannot find module './index.js'`.

- [ ] **Step 3: Write minimal implementation**

`packages/llm-provider/src/thinking/resolve.ts`:
```typescript
/**
 * Unified thinking resolution — one tri-state contract for every provider.
 *
 * Control-pillar discipline (mirrors local.ts FIX-3): `undefined` NEVER
 * auto-enables. Only explicit `true` (or a future per-request override) turns
 * thinking on, and only when the model is actually capable.
 */
export interface ThinkingOptions {
  /** Tri-state mirror of config.thinking. */
  readonly enabled?: boolean;
  /** OpenAI reasoning_effort; advisory for other providers. */
  readonly effort?: "low" | "medium" | "high";
  /** Explicit thinking budget in tokens; overrides the scaled default (still clamped). */
  readonly budgetTokens?: number;
}

const warned = new Set<string>();

/**
 * Resolve whether thinking should be enabled for this call.
 * @param requestOverride unbuilt per-request seam; when set it takes precedence
 *   over `configThinking`. Always `undefined` today.
 */
export const resolveThinkingEnabled = (
  provider: string,
  model: string,
  configThinking: boolean | undefined,
  supportsThinkingMode: boolean,
  requestOverride?: boolean,
): boolean => {
  const want = requestOverride ?? configThinking;
  if (want !== true) return false; // undefined/false → off (opt-in)
  if (!supportsThinkingMode) {
    const key = `${provider}/${model}`;
    if (!warned.has(key)) {
      warned.add(key);
      // eslint-disable-next-line no-console
      console.warn(
        `[thinking] ${key} does not support thinking mode; ignoring thinking:true (degrading to off).`,
      );
    }
    return false;
  }
  return true;
};
```

`packages/llm-provider/src/thinking/budget.ts`:
```typescript
import type { ThinkingOptions } from "./resolve.js";

export const THINKING_MIN = 1024;
export const THINKING_MAX = 16384;

const clamp = (n: number): number => Math.min(Math.max(n, THINKING_MIN), THINKING_MAX);

/**
 * Bounded thinking allowance reserved ON TOP of the answer budget so hidden
 * reasoning can never starve the visible answer. Returns `undefined` when
 * thinking is off or the model is incapable — the caller then leaves the
 * output budget untouched.
 */
export const reserveThinkingBudget = (
  answerBudget: number,
  supportsThinkingMode: boolean,
  opts?: ThinkingOptions,
): number | undefined => {
  if (!supportsThinkingMode) return undefined;
  if (opts?.enabled !== true) return undefined;
  return clamp(opts.budgetTokens ?? answerBudget * 4);
};
```

`packages/llm-provider/src/thinking/index.ts`:
```typescript
export { resolveThinkingEnabled, type ThinkingOptions } from "./resolve.js";
export { reserveThinkingBudget, THINKING_MIN, THINKING_MAX } from "./budget.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/llm-provider/src/thinking/thinking.test.ts --timeout 15000`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck + commit**

Run: `cd packages/llm-provider && bunx tsc --noEmit` → exit 0.
```bash
git add packages/llm-provider/src/thinking/
git commit -m "feat(llm-provider): shared thinking resolver + bounded budget helper"
```

---

### Task 2: Config surface + `.withThinking()` builder method

**Files:**
- Modify: `packages/llm-provider/src/llm-config.ts:130` (add `thinkingOptions`)
- Modify: `packages/runtime/src/types.ts` (`ModelParamsSchema` + `RuntimeOptions`/config schema `thinkingOptions`)
- Modify: `packages/runtime/src/builder/withers/_state.ts:72` (add `_thinkingOptions`)
- Modify: `packages/runtime/src/builder/withers/model-budget.ts` (add `applyWithThinking`)
- Modify: `packages/runtime/src/builder.ts` (add `withThinking` method)
- Modify: `packages/runtime/src/builder/to-config.ts:122` (thread `thinkingOptions`)
- Modify: `packages/runtime/src/builder/build-effect/runtime-construction.ts:319` (pass `thinkingOptions`)
- Modify: `packages/runtime/src/runtime.ts:275,384,1094,1150` (config `thinkingOptions`)
- Test: `packages/runtime/tests/with-thinking.test.ts`

**Interfaces:**
- Consumes: `ThinkingOptions` from `@reactive-agents/llm-provider` (Task 1).
- Produces:
  - `builder.withThinking(options?: boolean | ThinkingOptions): this`
  - `config.thinkingOptions?: ThinkingOptions` reaching every adapter closure.

- [ ] **Step 1: Write the failing test**

```typescript
// Run: bun test packages/runtime/tests/with-thinking.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "reactive-agents";

describe(".withThinking() writes config.thinkingOptions + config.thinking", () => {
  it("bare call enables thinking", async () => {
    const agent = await ReactiveAgents.create().withProvider("anthropic").withThinking().build();
    const cfg = (agent as unknown as { config: Record<string, unknown> }).config;
    expect(cfg.thinking).toBe(true);
    expect(cfg.thinkingOptions).toMatchObject({ enabled: true });
  }, 15000);

  it("carries effort + budgetTokens", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("openai")
      .withThinking({ effort: "high", budgetTokens: 8000 })
      .build();
    const cfg = (agent as unknown as { config: Record<string, unknown> }).config;
    expect(cfg.thinkingOptions).toMatchObject({ enabled: true, effort: "high", budgetTokens: 8000 });
  }, 15000);

  it("withThinking(false) disables", async () => {
    const agent = await ReactiveAgents.create().withProvider("gemini").withThinking(false).build();
    const cfg = (agent as unknown as { config: Record<string, unknown> }).config;
    expect(cfg.thinking).toBe(false);
    expect(cfg.thinkingOptions).toMatchObject({ enabled: false });
  }, 15000);

  it(".withModel({thinking:true}) still works (quick boolean, unchanged)", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("anthropic")
      .withModel({ thinking: true })
      .build();
    const cfg = (agent as unknown as { config: Record<string, unknown> }).config;
    expect(cfg.thinking).toBe(true);
  }, 15000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/tests/with-thinking.test.ts --timeout 15000`
Expected: FAIL — `withThinking is not a function`.

- [ ] **Step 3: Implement**

In `packages/llm-provider/src/llm-config.ts`, after the `thinking?: boolean` field (`:130`):
```typescript
    /**
     * Rich thinking configuration (effort level, explicit budget). When present,
     * `thinkingOptions.enabled` is authoritative over the `thinking` boolean.
     * Written by `.withThinking()`. See `@reactive-agents/llm-provider` thinking module.
     */
    readonly thinkingOptions?: import("./thinking/index.js").ThinkingOptions;
```

In `packages/runtime/src/types.ts`, add a `thinkingOptions` optional field to `RuntimeOptions` and `ReactiveAgentsConfigSchema` (NOT `ModelParamsSchema` — `.withThinking()` writes `_thinkingOptions` directly, it does not flow through `withModel`). Model the schema field as `thinkingOptions: Schema.optional(Schema.Struct({ enabled: Schema.optional(Schema.Boolean), effort: Schema.optional(Schema.Literal("low","medium","high")), budgetTokens: Schema.optional(Schema.Number) }))`. Re-export the `ThinkingOptions` type from `@reactive-agents/llm-provider` for builder use.

In `packages/runtime/src/builder/withers/_state.ts` after `_thinking?: boolean` (`:72`):
```typescript
  _thinkingOptions?: import("@reactive-agents/llm-provider").ThinkingOptions;
```

In `packages/runtime/src/builder/withers/model-budget.ts`, add:
```typescript
import type { ThinkingOptions } from "@reactive-agents/llm-provider";

/**
 * Apply `.withThinking(options?)` — the rich-config home for thinking mode.
 * `true`/absent → enable; `false` → disable; object → enable with effort/budget.
 * Writes both the `_thinking` boolean (quick path parity) and `_thinkingOptions`.
 */
export const applyWithThinking = (
  builder: ReactiveAgentBuilder,
  options?: boolean | ThinkingOptions,
): void => {
  const s = asBuilderState(builder);
  if (options === false) {
    s._thinking = false;
    s._thinkingOptions = { enabled: false };
    return;
  }
  if (options === undefined || options === true) {
    s._thinking = true;
    s._thinkingOptions = { enabled: true };
    return;
  }
  const enabled = options.enabled !== false;
  s._thinking = enabled;
  s._thinkingOptions = { ...options, enabled };
};
```

In `packages/runtime/src/builder.ts`, near `withModel` (`:665`), add the method + import:
```typescript
    /**
     * Enable native thinking / reasoning mode with optional effort + budget.
     * Rich-config home; `.withModel({thinking})` remains the quick boolean.
     * @param options `true`/absent enable, `false` disable, or `{ effort, budgetTokens }`.
     */
    withThinking(options?: boolean | import("@reactive-agents/llm-provider").ThinkingOptions): this {
        applyWithThinking(this, options);
        return this;
    }
```
Add `applyWithThinking` to the existing import from `./builder/withers/model-budget.js` (alongside `applyWithModel`).

In `packages/runtime/src/builder/to-config.ts`, after the `thinking` line (`:122`):
```typescript
  if (state._thinkingOptions !== undefined) config["thinkingOptions"] = state._thinkingOptions;
```

In `packages/runtime/src/builder/build-effect/runtime-construction.ts`, after `thinking: state._thinking,` (`:319`):
```typescript
      thinkingOptions: state._thinkingOptions,
```
Add `readonly _thinkingOptions?: import("@reactive-agents/llm-provider").ThinkingOptions;` to the local state interface at `:59`.

In `packages/runtime/src/runtime.ts`, at each `thinking: options.thinking,` site (`:275, :384, :1094, :1150`) add on the next line:
```typescript
    thinkingOptions: options.thinkingOptions,
```
Add `thinkingOptions` to `RuntimeOptions` and `ReactiveAgentsConfig` types where `thinking` is declared.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/runtime/tests/with-thinking.test.ts --timeout 15000`
Expected: PASS (4/4).

- [ ] **Step 5: Typecheck + commit**

Run: `cd packages/runtime && bunx tsc --noEmit` → exit 0. `cd packages/llm-provider && bunx tsc --noEmit` → exit 0.
```bash
git add packages/llm-provider/src/llm-config.ts packages/runtime/src/types.ts packages/runtime/src/builder.ts packages/runtime/src/builder/ packages/runtime/src/runtime.ts packages/runtime/tests/with-thinking.test.ts
git commit -m "feat(runtime): .withThinking() + config.thinkingOptions threading"
```

---

### Task 3: Gemini adapter — honor tri-state (opt-in), disable path

**Files:**
- Modify: `packages/llm-provider/src/providers/gemini.ts` (`geminiThinkingBudget:53`, config-builder `~336`)
- Test: `packages/llm-provider/tests/gemini-provider.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveThinkingEnabled`, `reserveThinkingBudget` (Task 1); `config.thinking`, `config.thinkingOptions` (Task 2).

- [ ] **Step 1: Write the failing test** (append to the gemini test file)

```typescript
// Run: bun test packages/llm-provider/tests/gemini-provider.test.ts --timeout 15000
// Assert the request-config builder honors the tri-state. Import the internal
// buildGenerationConfig (export it @internal for testing) or assert via a
// recording fetch. Minimal shape:
it("gemini: thinking undefined → thinkingBudget 0 (opt-in, disabled)", () => {
  const cfg = buildGenerationConfig({ model: "gemini-2.5-pro", maxTokens: 2000 }, /*configThinking*/ undefined, /*thinkingOptions*/ undefined);
  expect(cfg.maxOutputTokens).toBe(2000); // no reservation
  expect((cfg.thinkingConfig as { thinkingBudget: number }).thinkingBudget).toBe(0);
}, 15000);

it("gemini: thinking true + capable → reserves budget on top", () => {
  const cfg = buildGenerationConfig({ model: "gemini-2.5-pro", maxTokens: 2000 }, true, { enabled: true });
  expect(cfg.maxOutputTokens).toBe(2000 + 8000);
  expect((cfg.thinkingConfig as { thinkingBudget: number }).thinkingBudget).toBe(8000);
}, 15000);
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/llm-provider/tests/gemini-provider.test.ts --timeout 15000 -t "opt-in"`
Expected: FAIL — gemini still auto-enables (thinkingBudget≠0 for undefined) / `buildGenerationConfig` not exported.

- [ ] **Step 3: Implement**

Replace `geminiThinkingBudget` (`:53`) usage with the shared helpers. In the generation-config builder (`~:336`):
```typescript
import { resolveThinkingEnabled, reserveThinkingBudget } from "../thinking/index.js";
import { resolveCapability } from "../capability-resolver.js";

// inside the cfg builder, replace the old thinkingBudget block:
const cap = resolveCapability("gemini", opts.model ?? config.model ?? "");
const enabled = resolveThinkingEnabled("gemini", opts.model ?? "", config.thinking, cap.supportsThinkingMode);
const reserve = reserveThinkingBudget(answerBudget, cap.supportsThinkingMode, {
  ...(config.thinkingOptions ?? {}),
  enabled,
});
const cfg: Record<string, unknown> = {
  maxOutputTokens: reserve !== undefined ? answerBudget + reserve : answerBudget,
  temperature: opts.temperature ?? config.defaultTemperature,
};
// Best-effort disable when off (gemini-2.5-pro treats budget 0 as ADVISORY and
// may still think; the on-top reservation + Cluster-B guard cover that case).
cfg.thinkingConfig = { thinkingBudget: reserve ?? 0 };
```
Export a testable `buildGenerationConfig(opts, configThinking, thinkingOptions)` seam (thread `config.thinking`/`config.thinkingOptions` in) if the current closure isn't directly callable.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test packages/llm-provider/tests/gemini-provider.test.ts --timeout 15000`
Expected: PASS. Then full package: `bun test packages/llm-provider --timeout 30000` — no regressions vs baseline.

- [ ] **Step 5: Typecheck + commit**

Run: `cd packages/llm-provider && bunx tsc --noEmit` → exit 0.
```bash
git add packages/llm-provider/src/providers/gemini.ts packages/llm-provider/tests/gemini-provider.test.ts
git commit -m "feat(llm-provider): gemini honors thinking tri-state (opt-in) via shared helpers"
```

---

### Task 4: Anthropic adapter — extended thinking + budget reservation

**Files:**
- Modify: `packages/llm-provider/src/providers/anthropic.ts` (request builders at `max_tokens` sites `:204`, `:281`, and the stream builder)
- Test: `packages/llm-provider/tests/anthropic-provider.test.ts` (extend or create)

**Interfaces:**
- Consumes: `resolveThinkingEnabled`, `reserveThinkingBudget` (Task 1); `config.thinking`, `config.thinkingOptions` (Task 2).

- [ ] **Step 1: Write the failing test**

```typescript
// Run: bun test packages/llm-provider/tests/anthropic-provider.test.ts --timeout 15000
// Use a recording fetch (Bun.serve on port 0 or a stub) to capture the request body.
it("anthropic: thinking true → body has thinking{enabled,budget} + max_tokens=answer+budget", async () => {
  const body = await captureRequestBody({ provider: "anthropic", model: "claude-opus-4-8", thinking: true, maxTokens: 2000 });
  expect(body.thinking).toMatchObject({ type: "enabled", budget_tokens: 8000 });
  expect(body.max_tokens).toBe(2000 + 8000);
}, 15000);

it("anthropic: thinking undefined → no thinking field, max_tokens unchanged", async () => {
  const body = await captureRequestBody({ provider: "anthropic", model: "claude-opus-4-8", maxTokens: 2000 });
  expect(body.thinking).toBeUndefined();
  expect(body.max_tokens).toBe(2000);
}, 15000);
```
(Reuse an existing anthropic request-capture helper if the test file already has one; otherwise add a `Bun.serve({port:0})` stub with `afterAll(() => server?.stop(true))`.)

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL — anthropic never sets `thinking`; `body.thinking` undefined when true.

- [ ] **Step 3: Implement**

At each request-body builder (complete `:204`, structured `:281`, stream), compute once near the body:
```typescript
import { resolveThinkingEnabled, reserveThinkingBudget } from "../thinking/index.js";
import { resolveCapability } from "../capability-resolver.js";

const cap = resolveCapability("anthropic", request.model ?? config.model ?? "");
const answerBudget = request.maxTokens ?? config.defaultMaxTokens;
const thinkEnabled = resolveThinkingEnabled("anthropic", request.model ?? "", config.thinking, cap.supportsThinkingMode);
const reserve = reserveThinkingBudget(answerBudget, cap.supportsThinkingMode, {
  ...(config.thinkingOptions ?? {}),
  enabled: thinkEnabled,
});
// body:
const requestBody: Record<string, unknown> = {
  model,
  max_tokens: reserve !== undefined ? answerBudget + reserve : answerBudget,
  // ...existing fields...
  ...(reserve !== undefined ? { thinking: { type: "enabled", budget_tokens: reserve } } : {}),
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test packages/llm-provider/tests/anthropic-provider.test.ts --timeout 15000` → PASS.
Full package: `bun test packages/llm-provider --timeout 30000` — no regression; Cluster-B guard tests still green.

- [ ] **Step 5: Typecheck + commit**

Run: `cd packages/llm-provider && bunx tsc --noEmit` → exit 0.
```bash
git add packages/llm-provider/src/providers/anthropic.ts packages/llm-provider/tests/anthropic-provider.test.ts
git commit -m "feat(llm-provider): anthropic extended thinking + answer-budget reservation"
```

---

### Task 5: OpenAI adapter — reasoning_effort + max_completion_tokens

**Files:**
- Modify: `packages/llm-provider/src/providers/openai.ts` (request bodies `:249`, `:338`, `:545`)
- Modify: `packages/llm-provider/src/capability.ts` (add one openai reasoning-capable entry)
- Test: `packages/llm-provider/tests/openai-provider.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1 helpers; `config.thinking`/`thinkingOptions` (Task 2).

- [ ] **Step 1: Write the failing test**

```typescript
// Run: bun test packages/llm-provider/tests/openai-provider.test.ts --timeout 15000
it("openai reasoning model + thinking true → reasoning_effort + max_completion_tokens, no max_tokens", async () => {
  const body = await captureRequestBody({ provider: "openai", model: "o5-reasoning", thinking: true, thinkingOptions: { enabled: true, effort: "high" }, maxTokens: 4000 });
  expect(body.reasoning_effort).toBe("high");
  expect(body.max_completion_tokens).toBe(4000 + 16384); // 4000*4 clamped to MAX
  expect(body.max_tokens).toBeUndefined();
}, 15000);

it("openai non-reasoning model + thinking true → warn+degrade: plain max_tokens, no reasoning_effort", async () => {
  const body = await captureRequestBody({ provider: "openai", model: "gpt-5.5", thinking: true, maxTokens: 4000 });
  expect(body.reasoning_effort).toBeUndefined();
  expect(body.max_tokens).toBe(4000);
}, 15000);
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL — no reasoning-capable entry (`o5-reasoning` resolves to fallback, `supportsThinkingMode:false`) and adapter always sends `max_tokens`.

- [ ] **Step 3: Implement**

Add to `capability.ts` `STATIC_CAPABILITIES`:
```typescript
  "openai/o5-reasoning": {
    provider: "openai",
    model: "o5-reasoning",
    tier: "frontier",
    maxContextTokens: 400_000,
    recommendedNumCtx: 400_000,
    maxOutputTokens: 128_000,
    tokenizerFamily: "tiktoken-cl100k",
    supportsPromptCaching: true,
    supportsVision: false,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
```

In each openai request body builder, replace the unconditional `max_tokens`:
```typescript
import { resolveThinkingEnabled, reserveThinkingBudget } from "../thinking/index.js";
import { resolveCapability } from "../capability-resolver.js";

const cap = resolveCapability("openai", request.model ?? config.model ?? model ?? "");
const answerBudget = request.maxTokens ?? config.defaultMaxTokens;
const thinkEnabled = resolveThinkingEnabled("openai", model, config.thinking, cap.supportsThinkingMode);
const reserve = reserveThinkingBudget(answerBudget, cap.supportsThinkingMode, {
  ...(config.thinkingOptions ?? {}),
  enabled: thinkEnabled,
});
// body: reasoning models use max_completion_tokens + reasoning_effort; others keep max_tokens.
const tokenField = reserve !== undefined
  ? { max_completion_tokens: answerBudget + reserve, reasoning_effort: config.thinkingOptions?.effort ?? "medium" }
  : { max_tokens: answerBudget };
const requestBody: Record<string, unknown> = {
  model,
  ...tokenField,
  // ...existing fields (temperature, messages, stop, tools)...
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test packages/llm-provider/tests/openai-provider.test.ts --timeout 15000` → PASS.
Full package: `bun test packages/llm-provider --timeout 30000` — no regression.

- [ ] **Step 5: Typecheck + commit**

Run: `cd packages/llm-provider && bunx tsc --noEmit` → exit 0.
```bash
git add packages/llm-provider/src/providers/openai.ts packages/llm-provider/src/capability.ts packages/llm-provider/tests/openai-provider.test.ts
git commit -m "feat(llm-provider): openai reasoning_effort + max_completion_tokens for thinking"
```

---

### Task 6: Local adapter — delegate tri-state to shared resolver

**Files:**
- Modify: `packages/llm-provider/src/providers/local.ts:268` (`resolveThinking`)
- Test: `packages/llm-provider/tests/*local*.test.ts` (extend or add a focused test)

**Interfaces:**
- Consumes: `resolveThinkingEnabled` (Task 1). Behavior must remain unchanged (opt-in, `/api/show` capability probe).

- [ ] **Step 1: Write the failing test**

```typescript
// Run: bun test packages/llm-provider/tests/local-thinking.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { resolveThinking } from "../src/providers/local.js"; // @internal export for test

const showCapable = { show: async () => ({ capabilities: ["thinking"] }) };
const showIncapable = { show: async () => ({ capabilities: ["tools"] }) };

describe("local resolveThinking delegates tri-state, keeps async capability probe", () => {
  it("undefined → undefined (off)", async () => {
    expect(await resolveThinking(showCapable, "qwen3:14b", undefined)).toBeUndefined();
  });
  it("true + capable → true", async () => {
    expect(await resolveThinking(showCapable, "qwen3:14b", true)).toBe(true);
  });
  it("true + incapable → false/undefined (degrade, no throw)", async () => {
    const r = await resolveThinking(showIncapable, "granite3.3", true);
    expect(r === false || r === undefined).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL if `resolveThinking` isn't exported, or PASS-as-is if behavior already matches — in which case add an assertion that the shared resolver is the decision source (e.g. spy is out of scope; instead assert the incapable-true path warns once). Keep the test asserting the observable contract.

- [ ] **Step 3: Implement**

Refactor `resolveThinking` to use the shared resolver for the tri-state decision, keeping the Ollama `/api/show` probe as the capability source:
```typescript
import { resolveThinkingEnabled } from "../thinking/index.js";

async function resolveThinking(client, model, configThinking): Promise<boolean | undefined> {
  if (configThinking !== true) return undefined; // undefined/false → off (unchanged)
  const capable = await supportsThinking(client, model);
  // Shared resolver applies the identical opt-in + warn-once discipline.
  return resolveThinkingEnabled("ollama", model, true, capable) ? true : undefined;
}
```
Export `resolveThinking` `@internal` for the test.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test packages/llm-provider/tests/local-thinking.test.ts --timeout 15000` → PASS.
Full package green.

- [ ] **Step 5: Typecheck + commit**

Run: `cd packages/llm-provider && bunx tsc --noEmit` → exit 0.
```bash
git add packages/llm-provider/src/providers/local.ts packages/llm-provider/tests/local-thinking.test.ts
git commit -m "refactor(llm-provider): local thinking delegates tri-state to shared resolver"
```

---

### Task 7: Cross-tier thinking ablation session + verdict

**Files:**
- Create: `packages/benchmarks/src/sessions/thinking-ablation.ts`
- Modify: session registry (wherever sessions are registered, e.g. `packages/benchmarks/src/sessions/index.ts`)
- Test: `packages/benchmarks/tests/thinking-ablation.test.ts` (structural — session builds two variants, correct tasks)

**Interfaces:**
- Consumes: `.withThinking()` (Task 2); existing `runSession`/variant infra.

- [ ] **Step 1: Write the failing test**

```typescript
// Run: bun test packages/benchmarks/tests/thinking-ablation.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { thinkingAblationSession } from "../src/sessions/thinking-ablation.js";

describe("thinking-ablation session", () => {
  it("defines thinking-off and thinking-on variants over reasoning-sensitive tasks", () => {
    const s = thinkingAblationSession();
    const names = s.variants.map((v) => v.name).sort();
    expect(names).toEqual(["thinking-off", "thinking-on"]);
    expect(s.tasks.length).toBeGreaterThanOrEqual(3);
  }, 15000);

  it("thinking-on variant enables thinking on the builder", () => {
    const s = thinkingAblationSession();
    const on = s.variants.find((v) => v.name === "thinking-on")!;
    // The variant's harness config records thinking enabled (structural assertion).
    expect(on.thinking).toBe(true);
  }, 15000);
});
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement** the session mirroring an existing 2-variant session (e.g. `docs-receipts.ts` / `m3-ablation.ts` patterns): `thinking-off` builds `.withThinking(false)`, `thinking-on` builds `.withThinking()`; reasoning-sensitive real-world tasks (multi-step, analysis, selective filter — reuse existing `rw-*` reasoning tasks). Register it.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test packages/benchmarks/tests/thinking-ablation.test.ts --timeout 15000` → PASS.

- [ ] **Step 5: Commit**
```bash
git add packages/benchmarks/src/sessions/thinking-ablation.ts packages/benchmarks/src/sessions/index.ts packages/benchmarks/tests/thinking-ablation.test.ts
git commit -m "test(benchmarks): cross-tier thinking ablation session (off vs on)"
```

- [ ] **Step 6: Run the ablation (controller, not a subagent step)**

Start a NON-SUT cloud judge. Run the session with calibrated models across tiers (`qwen3:14b`, gemini-2.5, claude-sonnet+opus, `o5-reasoning`), `runs ≥ 3`, `traceDir` set. Then:
```bash
rax eval gate --report thinking.json --baseline thinking-off --candidate thinking-on \
  --ledger wiki/Research/Harness-Reports/improvement-ledger.json \
  --weakness "no native thinking on cloud tiers" --hypothesis "thinking lifts reactive quality per tier"
```
Record the verdict table in `wiki/Research/Debriefs/2026-07-01-cross-tier-thinking-debrief.md`. For each tier that clears the lift rule, flip its default (a follow-up config change, only if earned). Otherwise ships opt-in — no default change. This step gates the "helps/doesn't hurt" claim and is the feature's acceptance evidence.

---

## Notes for the implementer

- The `captureRequestBody` helper in Tasks 4/5 is the recording-fetch seam. If the provider test files already have a request-capture fixture, reuse it; otherwise add a `Bun.serve({ port: 0 })` stub returning a minimal valid provider response and `afterAll(() => server?.stop(true))` per the agent-tdd skill (dangling-server teardown).
- Every adapter reads its construction `config` closure — `config.thinking` and `config.thinkingOptions` are already in scope after Task 2. No new plumbing per adapter beyond the shared-helper calls.
- Do NOT change the kernel tier caps (`think.ts:578`) — the answer budget is correct; adapters reserve thinking on top.
- The Cluster-B non-OK-empty guards must stay green in every adapter package run — they are the residual-truncation net.
