# Cost-Aware Model Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the upfront complexity router so an opt-in `.withModelRouting()` actually routes each run to the cheapest *capable* model of the configured provider — on both the inline and reasoning paths.

**Architecture:** Reuse the existing provider-mapped cost ladder (`@reactive-agents/cost` `complexity-router.ts`, tiers `haiku`/`sonnet`/`opus` = cheap/mid/expensive) and the `cost-route` pre-loop phase that sets `ctx.selectedModel`. Fix the two broken wires (reasoning path feeds `defaultModel`; kernel stream omits `model`), add a context-window capability rail, and expose an opt-in builder method. No new abstraction.

**Tech Stack:** TypeScript, Effect-TS, bun:test. Packages: `@reactive-agents/runtime`, `@reactive-agents/reasoning`, `@reactive-agents/cost`, `@reactive-agents/llm-provider`.

## Global Constraints

- TDD mandatory: RED → GREEN. Every test file header: `// Run: bun test <path> --timeout 15000`. Error-path tests use `Effect.flip`.
- Additive / non-breaking. `.withModelRouting()` is **opt-in, off by default**.
- Routing stays **within the configured provider's tiers** (provider Layer is fixed; only the model name varies per request).
- No `as any`. The existing `(modelConfig as any).model` in `cost-route.ts` must be removed, not relocated.
- Routing is **advisory**: any router/rail error degrades to `config.defaultModel`, never fails a run.
- Spec: `wiki/Architecture/Design-Specs/2026-06-30-cost-aware-model-routing.md`.

---

## File Structure

- **Create** `packages/cost/src/routing/capability-rail.ts` — pure `selectCapableModel(...)`: given provider + complexity tier + estimated prompt tokens, escalate `TIER_ORDER` until the tier's model has a large-enough `recommendedNumCtx`. Returns the model name.
- **Modify** `packages/runtime/src/builder.ts` — add `.withModelRouting()` + `_modelRouting` field.
- **Modify** `packages/runtime/src/builder/withers/_state.ts` + `.../build-effect/runtime-construction.ts` + `packages/runtime/src/runtime-types.ts` — thread `modelRouting` through builder-state → config.
- **Modify** `packages/runtime/src/engine/phases/cost-route.ts` — provider-agnostic, capability rail, skip on `!modelRouting`, drop `as any`.
- **Modify** `packages/runtime/src/engine/phases/agent-loop/reasoning-think.ts:256` — feed `c.selectedModel` into `modelId` (C1).
- **Modify** `packages/reasoning/src/kernel/capabilities/reason/think.ts:611` — add `model` to the stream request (C2).
- **Test** new files + the headline recording-layer tests in `packages/runtime/tests/`.

---

## Task 1: Capability rail helper

**Files:**
- Create: `packages/cost/src/routing/capability-rail.ts`
- Test: `packages/cost/tests/routing/capability-rail.test.ts`

**Interfaces:**
- Consumes: `resolveCapability(provider, model)` from `@reactive-agents/llm-provider` (returns `{ recommendedNumCtx: number, tier, ... }`); `getModelCostConfig(tier, provider)` and `TIER_ORDER` from `./complexity-router.js`; `ModelTier` (`"haiku"|"sonnet"|"opus"`) and `Provider` from `../types.js` / `@reactive-agents/core`.
- Produces: `export function selectCapableModel(provider: Provider, startTier: ModelTier, estimatedPromptTokens: number): string` — the model name of the cheapest tier ≥ `startTier` whose `recommendedNumCtx >= estimatedPromptTokens`, escalating via `TIER_ORDER`; if none qualifies, returns the top tier's model. Pure, never throws.

- [ ] **Step 1: Write the failing test**

```ts
// Run: bun test packages/cost/tests/routing/capability-rail.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { selectCapableModel } from "../../src/routing/capability-rail.js";

describe("selectCapableModel", () => {
  it("keeps the cheap tier when its window covers the prompt", () => {
    // anthropic haiku has a large window; a tiny prompt stays on haiku.
    expect(selectCapableModel("anthropic", "haiku", 1000)).toBe("claude-haiku-4-5-20251001");
  });

  it("never returns below the start tier", () => {
    const m = selectCapableModel("anthropic", "sonnet", 1000);
    expect(m).toBe("claude-sonnet-4-6");
  });

  it("escalates when the prompt exceeds the cheap model's window (ollama)", () => {
    // ollama tiers have differing windows; a huge prompt must escalate past the smallest.
    const small = selectCapableModel("ollama", "haiku", 10);
    const huge = selectCapableModel("ollama", "haiku", 10_000_000);
    expect(huge).not.toBe(small); // escalated to a larger-window tier
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cost/tests/routing/capability-rail.test.ts --timeout 15000`
Expected: FAIL — `selectCapableModel` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cost/src/routing/capability-rail.ts
import { resolveCapability } from "@reactive-agents/llm-provider";
import type { Provider } from "@reactive-agents/core";
import { getModelCostConfig, TIER_ORDER } from "./complexity-router.js";
import type { ModelTier } from "../types.js";

/**
 * Cheapest CAPABLE model for a provider: starting at `startTier`, escalate the
 * cost ladder until the tier's model has a context window large enough for the
 * estimated prompt. Pure + total — returns the top-tier model if none qualify.
 */
export function selectCapableModel(
  provider: Provider,
  startTier: ModelTier,
  estimatedPromptTokens: number,
): string {
  const start = Math.max(0, TIER_ORDER.indexOf(startTier));
  let lastModel = getModelCostConfig(TIER_ORDER[start]!, provider).model;
  for (let i = start; i < TIER_ORDER.length; i++) {
    const model = getModelCostConfig(TIER_ORDER[i]!, provider).model;
    lastModel = model;
    const cap = resolveCapability(provider, model);
    if (cap.recommendedNumCtx >= estimatedPromptTokens) return model;
  }
  return lastModel; // nothing big enough — return the largest-window (top) tier
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/cost/tests/routing/capability-rail.test.ts --timeout 15000`
Expected: PASS (3 tests). If `resolveCapability` requires options, call `resolveCapability(provider, model, {})`.

- [ ] **Step 5: Export from the cost barrel + commit**

Add to `packages/cost/src/index.ts` (alongside the existing `complexity-router` exports):
```ts
export { selectCapableModel } from "./routing/capability-rail.js";
```
Then:
```bash
git add packages/cost/src/routing/capability-rail.ts packages/cost/tests/routing/capability-rail.test.ts packages/cost/src/index.ts
git commit -m "feat(cost): capability rail — cheapest model whose window covers the prompt"
```

---

## Task 2: `.withModelRouting()` builder API + config threading

**Files:**
- Modify: `packages/runtime/src/builder.ts` (private field near `:397`; method near the other `with*` methods ~`:922`)
- Modify: `packages/runtime/src/builder/withers/_state.ts:~122`
- Modify: `packages/runtime/src/builder/build-effect/runtime-construction.ts:~178` and `~464`
- Modify: `packages/runtime/src/runtime-types.ts:~284` (config shape the phase reads)
- Test: `packages/runtime/tests/model-routing-builder.test.ts`

**Interfaces:**
- Produces: `ModelRoutingOptions = { tierModels?: Partial<Record<"haiku"|"sonnet"|"opus", string>>; minTier?: "haiku"|"sonnet"|"opus" }`; builder method `withModelRouting(options?: ModelRoutingOptions): this`; config field `modelRouting?: ModelRoutingOptions`.
- Consumes: the builder-state → config plumbing pattern used by `_fabricationGuard` (`builder.ts:397`, `_state.ts:120`, `runtime-construction.ts:176/463`).

- [ ] **Step 1: Write the failing test**

```ts
// Run: bun test packages/runtime/tests/model-routing-builder.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";

describe(".withModelRouting()", () => {
  it("is off by default (config.modelRouting undefined)", async () => {
    const agent = await ReactiveAgents.create().withName("r").withTestScenario([{ text: "ok" }]).build();
    expect((agent as any)._config?.modelRouting).toBeUndefined();
  });

  it("sets config.modelRouting when enabled", async () => {
    const agent = await ReactiveAgents.create()
      .withName("r").withTestScenario([{ text: "ok" }])
      .withModelRouting({ minTier: "sonnet" })
      .build();
    expect((agent as any)._config?.modelRouting?.minTier).toBe("sonnet");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/runtime/tests/model-routing-builder.test.ts --timeout 15000`
Expected: FAIL — `withModelRouting` is not a function.

- [ ] **Step 3: Implement**

In `builder.ts` near the other private fields (~`:399`):
```ts
    private _modelRouting?: import('./builder/types.js').ModelRoutingOptions = undefined
```
Add the method (mirror `withFabricationGuard`):
```ts
    /**
     * Opt in to cost-aware model routing (off by default). Routes each run to
     * the cheapest CAPABLE model of the configured provider, picked by task
     * complexity. Stays within the provider's tiers; degrades to the configured
     * model on any routing error.
     * @returns `this` for chaining
     */
    withModelRouting(options: import('./builder/types.js').ModelRoutingOptions = {}): this {
        this._modelRouting = options
        return this
    }
```
Add `ModelRoutingOptions` to `packages/runtime/src/builder/types.ts`:
```ts
export interface ModelRoutingOptions {
  readonly tierModels?: Partial<Record<'haiku' | 'sonnet' | 'opus', string>>;
  readonly minTier?: 'haiku' | 'sonnet' | 'opus';
}
```
In `withers/_state.ts` (~`:122`): `_modelRouting: import("./types.js").ModelRoutingOptions | undefined;` (match the file's existing import style for builder types).
In `runtime-construction.ts`: add `readonly _modelRouting?: ...` near `:178` and `modelRouting: state._modelRouting,` in the options object near `:464`.
In `runtime-types.ts`: add `modelRouting?: { tierModels?: Partial<Record<'haiku'|'sonnet'|'opus', string>>; minTier?: 'haiku'|'sonnet'|'opus' };` to BOTH config shapes that already declare `enableCostTracking?` (`:284` and `:867`).

- [ ] **Step 4: Run to verify it passes**

Run: `bun test packages/runtime/tests/model-routing-builder.test.ts --timeout 15000`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/builder.ts packages/runtime/src/builder/types.ts packages/runtime/src/builder/withers/_state.ts packages/runtime/src/builder/build-effect/runtime-construction.ts packages/runtime/src/runtime-types.ts packages/runtime/tests/model-routing-builder.test.ts
git commit -m "feat(runtime): .withModelRouting() opt-in builder method + config threading"
```

---

## Task 3: Rewire `cost-route.ts` — provider-agnostic + capability rail

**Files:**
- Modify: `packages/runtime/src/engine/phases/cost-route.ts` (whole file)
- Test: `packages/runtime/tests/cost-route-phase.test.ts`

**Interfaces:**
- Consumes: `selectCapableModel` (Task 1); `analyzeComplexity` from `@reactive-agents/cost`; `deps.config.modelRouting` (Task 2); `deps.config.provider`, `deps.config.defaultModel`.
- Produces: a `cost-route` phase that, when `modelRouting` is set, sets `ctx.selectedModel` to the routed+capable model for the configured provider; otherwise passes through.

- [ ] **Step 1: Write the failing test** (use `CostService` real layer or stub `analyzeComplexity` via the public API; assert `selectedModel`)

```ts
// Run: bun test packages/runtime/tests/cost-route-phase.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { costRoute } from "../src/engine/phases/cost-route.js";

const baseCtx = { selectedModel: undefined } as any;
const deps = (over: any) => ({
  config: { provider: "anthropic", defaultModel: "claude-sonnet-4-6", ...over },
  task: { input: "What is 2 + 2?" },
} as any);

describe("cost-route phase", () => {
  it("skips (passes through) when modelRouting is off", () => {
    expect(costRoute.skip!(baseCtx, deps({}))).toBe(true);
  });

  it("routes a simple task to a cheaper anthropic model when modelRouting on", async () => {
    const d = deps({ modelRouting: {} });
    expect(costRoute.skip!(baseCtx, d)).toBe(false);
    const out: any = await Effect.runPromise(costRoute.run(baseCtx, d) as any);
    expect(typeof out.selectedModel).toBe("string");
    // a trivial task routes to the cheap tier, not the configured sonnet
    expect(out.selectedModel).toContain("haiku");
  });

  it("is provider-agnostic — routes within openai tiers, not anthropic", async () => {
    const d = deps({ provider: "openai", defaultModel: "gpt-4o", modelRouting: {} });
    const out: any = await Effect.runPromise(costRoute.run(baseCtx, d) as any);
    expect(out.selectedModel).toContain("gpt");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/runtime/tests/cost-route-phase.test.ts --timeout 15000`
Expected: FAIL — current `skip` keys on `enableCostTracking`; current code is Anthropic-only and returns `defaultModel` for openai.

- [ ] **Step 3: Implement** (replace the body of `cost-route.ts`)

`analyzeComplexity`, `getModelCostConfig`, and `selectCapableModel` are all exported from the `@reactive-agents/cost` barrel as **pure functions** — no `CostService` / `Effect.serviceOption` needed. `analyzeComplexity` returns an `Effect<ComplexityAnalysis, RoutingError>`; run it and degrade on error.

```ts
import { Effect } from "effect";
import { analyzeComplexity, selectCapableModel } from "@reactive-agents/cost";
import { extractTaskText } from "../util.js";
import type { Phase } from "../phase.js";

const TIERS = ["haiku", "sonnet", "opus"] as const;
type Tier = (typeof TIERS)[number];
const asTier = (t: unknown): Tier => (TIERS.includes(t as Tier) ? (t as Tier) : "haiku");

export const costRoute: Phase = {
  name: "cost-route",
  skip: (_ctx, deps) => !deps.config.modelRouting,
  run: (ctx, deps) =>
    Effect.gen(function* () {
      const provider = deps.config.provider;
      const fallback = { ...ctx, selectedModel: deps.config.defaultModel };

      const taskText = extractTaskText(deps.task.input);
      const analysis = yield* analyzeComplexity(taskText).pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      );
      if (!analysis) return fallback; // advisory: degrade to defaultModel

      const minTier = asTier(deps.config.modelRouting?.minTier);
      const startIdx = Math.max(TIERS.indexOf(asTier(analysis.recommendedTier)), TIERS.indexOf(minTier));
      const startTier = TIERS[startIdx]!;
      const estPromptTokens = Math.ceil(taskText.length / 4);

      const override = deps.config.modelRouting?.tierModels?.[startTier];
      const routed = override ?? selectCapableModel(provider, startTier, estPromptTokens);
      return { ...ctx, selectedModel: routed ?? deps.config.defaultModel };
    }),
};
```
The key changes: provider-agnostic (no Anthropic gate), rail-gated, `modelRouting`-gated, pure-fn import (no `CostService`), no `as any`. Verify `analyzeComplexity`'s return field is `recommendedTier` (per `ComplexityAnalysisSchema`); adjust if the field name differs.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test packages/runtime/tests/cost-route-phase.test.ts --timeout 15000`
Expected: PASS (3 tests). Then `grep -n "as any" packages/runtime/src/engine/phases/cost-route.ts` → no matches.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/engine/phases/cost-route.ts packages/runtime/tests/cost-route-phase.test.ts
git commit -m "feat(runtime): cost-route provider-agnostic + capability rail + drop as-any"
```

---

## Task 4: Wire the reasoning path (C1 + C2)

**Files:**
- Modify: `packages/runtime/src/engine/phases/agent-loop/reasoning-think.ts:256`
- Modify: `packages/reasoning/src/kernel/capabilities/reason/think.ts:611`
- Test: `packages/runtime/tests/model-routing-reasoning-path.test.ts`

**Interfaces:**
- Consumes: `getSelectedModelName(selectedModel)` from `./think-context.js` (extracts the model-name string from `string | SelectedModelShape`); `c.selectedModel` (set by Task 3 phase); `input.modelId` in the kernel.
- Produces: the kernel's `llm.stream` request carries `model: input.modelId`, and the reasoning executor's `modelId` is `c.selectedModel ?? defaultModel`.

- [ ] **Step 1: Write the failing test** (recording LLM layer captures `request.model` on the reasoning path)

```ts
// Run: bun test packages/runtime/tests/model-routing-reasoning-path.test.ts --timeout 20000
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";

describe("model routing — reasoning path", () => {
  it("routes a trivial task to a cheaper model on the reasoning path", async () => {
    const agent = await ReactiveAgents.create()
      .withName("rp").withProvider("anthropic").withModel("claude-sonnet-4-6")
      .withTestScenario([{ text: "FINAL ANSWER: 4" }])
      .withReasoning()
      .withModelRouting()
      .build();
    const r = await agent.run("What is 2 + 2?");
    // The model actually used (selectedModel updates to the real call model)
    const used = String((r as any).metadata?.modelUsed ?? (r as any).modelUsed ?? "");
    // Assert via the result's recorded model OR a tracing hook — see note.
    expect(r.success).toBe(true);
    expect(used.includes("haiku") || used.length >= 0).toBe(true); // refine to a recording-layer capture
  });
});
```

> NOTE for the implementer: the **authoritative** assertion is a recording `LLMService` layer that captures `request.model`. If the builder cannot inject a custom layer, drive the kernel directly: build the reasoning kernel with a `TestLLMServiceLayer`-style recording wrapper (mirror `packages/reasoning/tests/strategies/kernel/react-kernel.test.ts`) and assert the captured `model === <cheap tier model>` when `input.modelId` is the routed model, and that **without** the C2 change it is `undefined`. The headline cross-path proof lives in Task 5; this task's test must fail before C1+C2 and pass after.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/runtime/tests/model-routing-reasoning-path.test.ts --timeout 20000`
Expected: FAIL — the kernel stream request omits `model`, so the routed model never reaches the provider.

- [ ] **Step 3: Implement**

`reasoning-think.ts:256` — replace:
```ts
      modelId: String(config.defaultModel ?? ""),
```
with (import `getSelectedModelName` from `./think-context.js` if not already imported):
```ts
      modelId: String(getSelectedModelName(c.selectedModel) ?? config.defaultModel ?? ""),
```
`think.ts:611` — add `model` to the `llm.stream({...})` object (right after `messages`):
```ts
      ...(input.modelId ? { model: input.modelId } : {}),
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test packages/runtime/tests/model-routing-reasoning-path.test.ts --timeout 20000`
Expected: PASS. Then full regression: `bun test packages/reasoning --timeout 40000` (expect 0 fail) and `bun test packages/runtime --timeout 40000` (expect 0 fail).

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/engine/phases/agent-loop/reasoning-think.ts packages/reasoning/src/kernel/capabilities/reason/think.ts packages/runtime/tests/model-routing-reasoning-path.test.ts
git commit -m "fix(runtime,reasoning): apply the routed model on the reasoning path (C1+C2)"
```

---

## Task 5: Headline cross-path verification + off-by-default gut-check

**Files:**
- Test: `packages/runtime/tests/model-routing-e2e.test.ts`

**Interfaces:**
- Consumes: the full feature (Tasks 1-4). A recording `LLMService` layer (or the deterministic test provider extended to record `request.model`) capturing the `model` of each call.

- [ ] **Step 1: Write the test** (RED if any wire is missing)

```ts
// Run: bun test packages/runtime/tests/model-routing-e2e.test.ts --timeout 20000
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";

// Helper: capture the model param of every LLM call. Implement via a recording
// LLMService layer provided to the agent, OR (if no injection seam) assert on
// the result's recorded model-used field. Mirror the Task 4 recording approach.

describe("model routing — both paths + gut-check", () => {
  it("inline path: simple task routes to the cheap tier", async () => {
    const agent = await ReactiveAgents.create()
      .withName("inline").withProvider("anthropic").withModel("claude-sonnet-4-6")
      .withTestScenario([{ text: "FINAL ANSWER: 4" }])
      .withModelRouting().build(); // no .withReasoning() → inline path
    const r = await agent.run("What is 2 + 2?");
    expect(r.success).toBe(true);
    // assert captured model contains "haiku"
  });

  it("GUT-CHECK: without .withModelRouting(), the configured model is used unchanged", async () => {
    const agent = await ReactiveAgents.create()
      .withName("default").withProvider("anthropic").withModel("claude-sonnet-4-6")
      .withTestScenario([{ text: "FINAL ANSWER: 4" }])
      .withReasoning().build(); // routing OFF
    const r = await agent.run("What is 2 + 2?");
    expect(r.success).toBe(true);
    // assert captured model === "claude-sonnet-4-6" (NOT routed)
  });
});
```

> The implementer MUST wire a real model-capture (recording layer or test-provider extension) so these assertions are non-vacuous — gutting C1/C2/C3 must turn the routing assertions RED and the gut-check stays GREEN. If the test provider needs a `recordModel` hook, add it to `packages/llm-provider/src/testing.ts` (it already records calls).

- [ ] **Step 2: Run — verify routing assertions pass, gut-check passes**

Run: `bun test packages/runtime/tests/model-routing-e2e.test.ts --timeout 20000`
Expected: PASS. Temporarily revert C2 (remove `model:` from the stream request) → the reasoning routing assertion goes RED (proves non-vacuity) → restore.

- [ ] **Step 3: Full regression + build**

Run: `bun test packages/runtime packages/reasoning packages/cost --timeout 60000` → 0 fail.
Run: `bun run --filter=@reactive-agents/runtime build` and `bun run --filter=@reactive-agents/cost build` → exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/runtime/tests/model-routing-e2e.test.ts packages/llm-provider/src/testing.ts
git commit -m "test(runtime): model routing applies on both paths + off-by-default gut-check"
```

---

## Self-Review

**Spec coverage:** C1 → Task 4. C2 → Task 4. C3 → Task 3. C4 (API + rail) → Task 2 (API) + Task 1 (rail) + Task 3 (rail wired). Headline both-paths verification → Task 4 (reasoning) + Task 5 (inline + gut-check). Provider-agnostic → Task 3. `as any` removed → Task 3. Advisory degradation → Task 3 (`fallback`). Done.

**Type consistency:** `ModelRoutingOptions` shape identical in Task 2 (builder/types) and Task 3 (config read). Tier literals `"haiku"|"sonnet"|"opus"` consistent. `selectCapableModel(provider, tier, tokens): string` used identically in Task 1 and Task 3.

**Open verification for implementers (resolve in-task, don't guess):** (a) confirm `CostService` exposes `analyzeComplexity`, else import the pure fn from `@reactive-agents/cost`; (b) confirm the export path for `selectCapableModel` (`@reactive-agents/cost` barrel vs subpath); (c) confirm `getSelectedModelName` import in `reasoning-think.ts`; (d) confirm the recording-layer injection seam for Tasks 4-5 (mirror `react-kernel.test.ts` if the builder has no custom-layer seam).
</content>
