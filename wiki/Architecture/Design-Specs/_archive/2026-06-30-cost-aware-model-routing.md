---
title: Cost-Aware Model Routing — Completion Design
date: 2026-06-30
status: DESIGN — approved direction, pending plan
owner: Architecture
target-release: 0.13.0
---

# Cost-Aware Model Routing — Completion Design

## 0. TL;DR

The complexity router (`@reactive-agents/cost`) was built to the original cost-layer spec (upfront complexity → tier → model) but is **dead on the reasoning path** and has **no public API**. This design completes it by fixing two broken wires, adding a capability safety-rail, and exposing an opt-in `.withModelRouting()` method — reusing everything already built. No new abstraction.

**Falsifiable promise:** with `.withModelRouting()` on, a simple task runs on the provider's *cheap* tier model and a complex/tool-heavy task on a *capable* tier model — verified by a recording LLM layer capturing the `model` param of the actual call, on **both** the inline and reasoning paths.

## 1. Verified current state (2026-06-30)

| Seam | State |
|---|---|
| `complexity-router.ts` — `analyzeComplexity(task) → tier → getModelCostConfig(tier, provider)` | ✅ built; `ModelTier = "haiku"\|"sonnet"\|"opus"` is an abstract cheap/mid/expensive ladder, mapped per-provider in `PROVIDER_CONFIGS` (anthropic/openai/gemini/ollama) |
| `TIER_ORDER = ["haiku","sonnet","opus"]` | ✅ exists — gives escalation order for free (Phase 2) |
| `cost-route.ts` phase — sets `ctx.selectedModel` | ✅ registered pre-loop phase; ⚠️ **Anthropic-only hard-gate** (`:41`), gated by `enableCostTracking`, uses `(modelConfig as any).model` |
| Inline/direct path honors `selectedModel` | ✅ `inline-think.ts:168` `model: c.selectedModel` |
| Provider honors `request.model` over layer default | ✅ all 5 providers (anthropic `:196`, others 9+ refs each), complete + stream + structured |
| `modelId` thread executor→kernel | ✅ intact: `reasoning-service` execute param `modelId` → `reactive.ts:223/252` `modelId: input.modelId` → kernel reads `input.modelId` |
| Reasoning path applies routed model | ❌ **BUG 1**: `reasoning-think.ts:256` feeds `modelId: String(config.defaultModel)` — ignores `ctx.selectedModel` |
| Kernel stream request carries the model | ❌ **BUG 2**: `think.ts:611` `llm.stream({...})` omits `model` entirely → provider falls back to layer default |
| Capability table for "capable" gating | ✅ `capability.ts` / `canonical-resolver.ts` — `tier`, `recommendedNumCtx` (context), `supportsThinkingMode` per model |

**Conclusion:** the model-override mechanism exists end-to-end at the provider. Routing is dead only because two wires feed the default instead of the selected model, and the kernel drops the model from its stream request. Fix those two; add a safety rail and a public method.

## 2. Design

### 2.1 Routing model (unchanged from original intent)

Route **once per run**, **within the configured provider's tiers**. The provider Layer is fixed; only the model *name* varies per request (every adapter honors `request.model`). The cost ladder (`haiku/sonnet/opus` = cheap/mid/expensive) is mapped to the provider's actual models by `PROVIDER_CONFIGS[provider][tier]`. Cross-provider routing is explicitly **out of scope** (that is the `FallbackChain`'s domain).

### 2.2 The four changes

**C1 — Wire the reasoning path (BUG 1).** `reasoning-think.ts:256`: `modelId: String(ctx.selectedModel ?? config.defaultModel)`. Handle `selectedModel` being string OR `SelectedModelShape` (object) via the existing `getSelectedModelName` helper (`think-context.ts`).

**C2 — Carry the model into the kernel call (BUG 2).** `think.ts:611`: add `...(input.modelId ? { model: input.modelId } : {})` to the `llm.stream({...})` request. This is the only kernel call-site that matters (the kernel uses `stream()` for think; the `complete` at `:781` is response-shaping only).

**C3 — Make `cost-route` provider-agnostic + clean.** `cost-route.ts`: drop the `provider === "anthropic"` gate (`:41`); pass `deps.config.provider` to `routeToModel(taskDescription, undefined, provider)`. Replace `(modelConfig as any).model` with a typed read (`ModelCostConfig.model`). Change the skip predicate from `enableCostTracking` to the new routing flag (C4).

**C4 — Public opt-in API + capability rail.** New builder method:

```ts
.withModelRouting(options?: {
  /** Override the per-tier model for the configured provider. */
  tierModels?: Partial<Record<"haiku"|"sonnet"|"opus", string>>;
  /** Force a floor tier (never route below this). Default: "haiku". */
  minTier?: "haiku"|"sonnet"|"opus";
})
```

Off by default (honesty). Sets a new `_modelRouting` builder-state flag (decoupled from `_enableCostTracking` analytics and `.withBudget()` spend caps). The `cost-route` phase runs when `_modelRouting` is set.

**Capability rail (inside the phase, after the router picks a tier):** resolve the chosen model's capability via `resolveCapability(provider, model)` (returns `{ tier, recommendedNumCtx, supportsThinkingMode, … }`). The phase runs pre-loop, so the rail gates on the task's *known static* requirement: the model's `recommendedNumCtx` must cover an **estimate of the initial prompt** (task input + system prompt + tool-schema text, `charCount / 4`). If the chosen model's window is too small, escalate one tier via `TIER_ORDER` and re-check, until a capable model is found or the top tier is reached. This guarantees cheap-first never routes a large-input task to a small-window model. The rail is the only genuinely new logic; everything else is wiring.

Note: the capability table has **no native-FC field**, so FC capability is *not* gated here (deferred — would need a `supportsNativeFC` capability column). Within a single *cloud* provider all tiers have large windows and FC, so the rail is mostly a no-op there; it earns its keep for `ollama`/local routing where context windows vary widely. Keeping it provider-agnostic costs nothing.

### 2.3 Data flow (end state)

```
run(task)
  └─ [pre-loop] cost-route phase  (skip unless _modelRouting)
       analyzeComplexity(task) → tier (haiku|sonnet|opus)
       capability-rail: escalate tier until STATIC_CAPABILITIES[model] is capable
       getModelCostConfig(tier, provider).model → ctx.selectedModel
  └─ agent loop
       inline path:    llm.complete({ model: ctx.selectedModel, … })   [already works]
       reasoning path: executeRequest.modelId = selectedModel (C1)
                         → input.modelId → think.ts llm.stream({ model: input.modelId, … }) (C2)
                         → provider honors request.model
```

## 3. Components & boundaries

| Unit | Responsibility | Change |
|---|---|---|
| `cost/routing/complexity-router.ts` | task → tier → provider model; tier order | none (already correct) — consumed as-is |
| `runtime/engine/phases/cost-route.ts` | pre-loop: set `ctx.selectedModel` | C3 + capability rail |
| `runtime/builder.ts` (+ withers/_state) | `.withModelRouting()` → `_modelRouting` | C4 |
| `runtime/.../reasoning-think.ts` | build reasoning executeRequest | C1 (one line) |
| `reasoning/.../reason/think.ts` | kernel stream request | C2 (one line) |
| capability rail helper (new, small) | "is model M capable of task T?" | new — pure fn over `STATIC_CAPABILITIES` |

## 4. Error handling

- Router failure (`RoutingError`) → fall back to `config.defaultModel` (existing behavior, keep).
- Unknown model in capability table → treat as capable for its declared tier (don't block a run on a missing capability entry; log once).
- `selectedModel` never null — always resolves to a real model (routed or default).
- Routing is **advisory**, never fails a run: any rail/router error degrades to `defaultModel`.

## 5. Testing (deterministic, no live models)

1. **Both-paths model application** (the headline): recording `LLMService` layer captures `request.model`. Build agent `.withModel(sonnet).withModelRouting()`, run a *simple* task → assert the captured model is the *cheap* tier; run with `.withReasoning()` → assert the same on the reasoning path. **Gut-check:** without `.withModelRouting()`, captured model == `defaultModel`.
2. **Complexity → tier** mapping (unit, over `analyzeComplexity`/`heuristicClassify`).
3. **Capability rail**: a task whose assembled prompt exceeds the cheap model's window routes UP to a capable tier; a tool task never routes to a non-FC model. (Construct via the capability table + a forced-small-window fixture.)
4. **Provider-agnostic**: same routing on a non-Anthropic provider (test provider / openai config) — no Anthropic-only regression.
5. **Advisory degradation**: a router error → run still completes on `defaultModel`.

## 6. Out of scope (deliberate, follow-ups)

- **Escalation cascade** (cheap-first → escalate on failure/verifier-reject + retry). The foundation here (per-request model + `TIER_ORDER` + capability rail) makes it a clean Phase 2; it is a separate design.
- **Cross-provider routing** (`FallbackChain` territory).
- **Pre-call budget gate** (estimate-and-block). Pairs with `.withBudget()`; separate.

## 7. Done criteria

- `.withModelRouting()` callable on the built builder (covered by the built-surface guard).
- Recording-layer test proves the routed model reaches the provider on **both** paths.
- Capability rail prevents routing-down below a capable model.
- Provider-agnostic (no Anthropic-only gate).
- `as any` in `cost-route.ts` removed.
- Full `runtime` + `reasoning` + `cost` suites green; DTS clean.
</content>
