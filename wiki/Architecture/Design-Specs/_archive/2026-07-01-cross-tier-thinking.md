# Cross-Tier Thinking Support — Design Spec

**Date:** 2026-07-01
**Status:** Approved (brainstorm) → ready for implementation plan
**Author:** harness session (Opus 4.8)

## Goal

One unified `thinking` contract honored by **every** provider (anthropic, openai, gemini, local/ollama), enabling native model reasoning with the visible-answer budget always protected, exposed through a rich `.withThinking()` builder method — then **empirically gated**: thinking ships **opt-in / off by default**, and a tier flips to default-on only if cross-tier ablation clears the project lift rule. The headline requirement is "make sure it helps and doesn't hurt reactive agents across all tiers."

## Background — current state (verified 2026-06-30)

- **Config rail is complete.** `.withModel({thinking})` → `_thinking` (`builder/withers/model-budget.ts:29`) → `config["thinking"]` (`builder/to-config.ts:122`) → `thinking: state._thinking` (`builder/build-effect/runtime-construction.ts:319`) → `LLMProviderConfig.thinking?: boolean` (`llm-provider/src/llm-config.ts:130`). The boolean reaches **every** adapter's construction closure today.
- **Only local reads it.** `local.ts:resolveThinking(client, model, configThinking)` (`:268`) implements the tri-state and control-pillar opt-in discipline (FIX-3): `undefined`→off, `false`→off, `true`→capability-check then enable (warn+degrade if incapable).
- **Gemini thinks by default** ignoring the flag: `geminiThinkingBudget(model, answerBudget)` (`gemini.ts:53`) reserves `clamp(answer*4, 1024, 16384)` for any thinking-capable model and sets `maxOutputTokens = answer + thinking`. It never consults `config.thinking`, so it cannot be disabled and auto-enables (the anti-pattern the control pillar forbids).
- **Anthropic / OpenAI ignore thinking entirely.** Requests send `max_tokens: request.maxTokens ?? config.defaultMaxTokens` (anthropic `:204/:281/stream`; openai `:249/:338/:545`) with no `thinking`/`reasoning_effort` and no answer-budget reservation.
- **Kernel budget:** tier caps `mid=2000 / frontier=4000` (`reasoning/.../reason/think.ts:578`) are passed as `maxTokens` (the *answer* budget). Adapters reserve thinking **on top** — no kernel change. A truncation-recovery escalation already exists (`think.ts:799` → `maxOutputTokensOverride=64000`).
- **Cluster-B loud-fail guard** already present in anthropic (`:223` complete, `:353` stream) and openai (`:279`, `:467`) — a non-OK finish with empty content fails loudly instead of returning empty success. This is the residual-truncation safety net.

## Core design decisions

1. **Provider-config-level, not per-request.** Thinking is set at build time via `config.thinking` + `config.thinkingOptions`. Per-request thinking (a `CompletionRequest.thinking` override with `??` precedence) is a **documented seam, unbuilt** — no current consumer; additive later without breakage. The shared resolver is shaped to accept a future per-request override as a one-line precedence change.
2. **Unified opt-in default — `undefined` → OFF for ALL providers.** Extends local's control-pillar discipline everywhere. **This flips Gemini's current thinks-by-default to opt-in** (a deliberate behavior change: auto-enable-by-inference violates the control pillar and creates the starvation risk by default). Caveat: gemini-2.5-pro treats a zero thinking budget as *advisory* and may still think; we send the best-effort disable and rely on the on-top reservation + Cluster-B guard when it does.
3. **`.withThinking(options?)` is the home for rich config**, not a boolean alias. `.withModel({thinking:true})` stays the quick boolean. Both write `config.thinking`; `.withThinking` also writes `config.thinkingOptions`. Last-wins, composable.
4. **Default posture ships opt-in/off.** Ablation promotes a tier to default-on only if it clears the lift rule (≥3pp ∧ ≤15%tok ∧ ≥2 tiers). Otherwise stays opt-in; the verdict is documented.

## Components

### A. Shared thinking module — `packages/llm-provider/src/thinking/` (new)

Single contract all adapters import. Two pure/total helpers + one type.

```ts
export interface ThinkingOptions {
  readonly enabled?: boolean;              // tri-state mirror of config.thinking
  readonly effort?: "low" | "medium" | "high"; // openai reasoning_effort; advisory elsewhere
  readonly budgetTokens?: number;          // explicit thinking budget (overrides the scaled default)
}

// Tri-state → boolean. undefined→false (opt-in), false→false, true→capable?true:warn+false.
// `capability` is resolveCapability(provider, model). requestOverride is the
// unbuilt per-request seam (always undefined for now; precedence: requestOverride ?? configThinking).
export const resolveThinkingEnabled = (
  provider: Provider,
  model: string,
  configThinking: boolean | undefined,
  capability: ResolvedCapability,
  requestOverride?: boolean,
): boolean => { /* ... */ };

// Bounded thinking allowance so maxOut = answer + reserve. Generalizes geminiThinkingBudget.
// Returns undefined when thinking is off or the model is incapable (caller leaves budget untouched).
export const reserveThinkingBudget = (
  answerBudget: number,
  opts?: ThinkingOptions,          // budgetTokens wins when set
): number | undefined => { /* clamp(budgetTokens ?? answer*4, MIN=1024, MAX=16384) */ };
```

- Local's `resolveThinking` (async, `/api/show` capability probe) is refactored to call `resolveThinkingEnabled` for the tri-state decision, keeping its Ollama-specific async capability check. One decision contract, provider-specific capability sources.
- A single `thinkingMismatchWarned` set (moved here) dedupes the incapable-model warning across providers.

### B. Anthropic adapter (`providers/anthropic.ts`)
When `resolveThinkingEnabled` is true: add `thinking: { type: "enabled", budget_tokens: reserve }` to the request and set `max_tokens = answerBudget + reserve`. Applies to complete + stream. `effort` maps to budget tiers (low/med/high → scaled `budget_tokens`) when `budgetTokens` not explicit.

### C. OpenAI adapter (`providers/openai.ts`)
When true **and** the model is reasoning-capable: send `reasoning_effort: effort ?? "medium"` and switch the token param from `max_tokens` to `max_completion_tokens = answerBudget + reserve` (reasoning models reject `max_tokens`). Applies to complete + stream + structured. Non-reasoning models with `thinking:true` → warn+degrade (no param). Add one reasoning-capable entry to `STATIC_CAPABILITIES` (`capability.ts`) with `supportsThinkingMode: true` so the path is exercised by the ablation and tests.

### D. Gemini adapter (`providers/gemini.ts`)
Consult `config.thinking`/`thinkingOptions`: `resolveThinkingEnabled` false → send `thinkingConfig: { thinkingBudget: 0 }` (best-effort disable) and leave `maxOutputTokens = answer`. True → current reservation (now driven by the shared helper + `budgetTokens` override). Document the 2.5-pro advisory-disable caveat inline.

### E. Local adapter (`providers/local.ts`)
Already complete. Refactor `resolveThinking` to delegate the tri-state to the shared `resolveThinkingEnabled`; keep the async `/api/show` probe as its capability source. Behavior unchanged.

### F. Empirical ablation (the helps/hurts gate)

- **Session:** thinking-off vs thinking-on, two variants, over **reactive-agent** real-world tasks (reasoning-sensitive: multi-step, analysis, selective filter — not pure single-tool).
- **Tiers/cells:** local thinking-model (`qwen3:14b`), gemini-2.5, anthropic sonnet + opus, openai reasoning model. Calibrated models only (preflight honesty guard).
- **Rigor:** cloud judge (never local SUT + local judge — GPU contention); `runs ≥ 3` for variance/significance.
- **Verdict:** `rax eval gate` per cell → lift rule. Record to the improvement ledger (weakness→hypothesis→verdict).
- **Outcome:** each tier that clears the rule flips default-on for that tier; the rest stay opt-in. Document the full verdict table regardless.

## Data flow

`.withThinking({effort,budgetTokens})` → `config.thinking` + `config.thinkingOptions` → adapter closure → `resolveThinkingEnabled(provider, model, config.thinking, capability)` → if on, `reserveThinkingBudget(answerBudget, thinkingOptions)` → provider-native params with `maxOut = answer + reserve` → Cluster-B guard catches any residual truncation.

## Error handling

- Incapable model + `thinking:true` → dedupe-warn, degrade to off (never crash — matches local FIX-3 and the anti-`selectCapableModel`-defect discipline).
- Reservation is bounded (clamp 1024..16384) — thinking can neither starve the answer nor run away.
- All provider calls stay within existing `Effect` error channels; the Cluster-B non-OK-empty guard is the final net.

## Testing

- **Unit/TDD (per adapter, RED→GREEN, `--timeout 15000`, `Effect.flip` for error paths):**
  - `thinking:true` on a capable model → native param present + `maxOut = answer + reserve`.
  - `thinking:false` → param absent / disabled (incl. gemini sends budget 0).
  - `thinking:undefined` → off (opt-in) for every provider.
  - incapable model + `thinking:true` → warn once, no param, no crash.
  - `.withThinking({effort})`/`{budgetTokens}` → carried into the provider request.
- **Config-rail test:** `.withModel({thinking:true})` and `.withThinking(...)` both reach each adapter's request (use the recording-LLM-layer seam; reasoning path via EventBus `LLMExchangeEmitted`).
- **Shared-module unit tests:** `resolveThinkingEnabled` tri-state matrix × provider; `reserveThinkingBudget` clamp bounds + `budgetTokens` override.
- **Empirical:** component F above.

## Scope boundaries (YAGNI)

- No per-request thinking (documented seam only).
- No kernel budget-logic change (adapters reserve on top).
- No new builder model method beyond `.withThinking()` (`.withModel({thinking})` already exists).
- No thinking for non-thinking-capable models (warn + degrade).
- No fine-tuning / no thinking for strategies other than what reactive exercises (ablation targets reactive; other strategies inherit the same adapter path transitively).

## Files touched

- Create: `packages/llm-provider/src/thinking/{index.ts,resolve.ts,budget.ts}` (+ tests)
- Modify: `providers/{anthropic,openai,gemini,local}.ts`, `capability.ts` (openai reasoning entry), `llm-config.ts` (`thinkingOptions`), builder (`.withThinking()` wither + `to-config` + `runtime-construction` threading)
- Create: benchmark ablation session + run script; ledger entry

## Post-implementation correction (2026-07-01, from whole-branch review)

The original **Anthropic** section above assumed the legacy `thinking:{type:"enabled",budget_tokens:N}` shape mirrored from Gemini. Whole-branch review + Anthropic-doc verification found this is **rejected (400) on current models** (Opus 4.7/4.8, Sonnet 5, Fable 5). Corrected, as-shipped design:

- **Model-generation branch** (`thinking/anthropic-form.ts` `anthropicThinkingForm`): current models (Opus 4.6/4.7/4.8, Sonnet 5, Fable, Mythos) use `thinking:{type:"adaptive"}` + a **top-level** `output_config:{effort}` (from `ThinkingOptions.effort`; omitted when unset → API default). Legacy models (≤ Sonnet 4.5 / Haiku 4.5 / Opus 4.5) use `thinking:{type:"enabled",budget_tokens:reserve}`.
- **`temperature` must be dropped whenever thinking is enabled** — Anthropic (any form) AND OpenAI reasoning both 400 on a non-default `temperature`. Adapters omit it on the thinking path; the OFF path is byte-identical to pre-feature.
- `max_tokens = answer + reserve` holds for both Anthropic forms (headroom); adaptive has no `budget_tokens` (effort is the knob), enabled keeps `budget_tokens < max_tokens`.
- OpenAI reasoning: `reasoning_effort` + `max_completion_tokens`, no `temperature` (I1).

**Lesson:** request-capturing mocks pass any payload → per-task green missed a live-API-shape defect on the headline capability; only whole-branch review + real-API-doc verification caught it. The ablation live-run is the empirical proof that thinking actually completes on each tier.

## Success criteria

1. All four providers honor the tri-state; `undefined`→off everywhere (control-pillar consistent).
2. `.withThinking({effort,budgetTokens})` reaches each provider's request, answer budget always reserved.
3. Cross-tier ablation run + lift-rule verdict recorded; default posture set per verdict (opt-in unless a tier earns default-on).
4. Full suite green; `tsc --noEmit` clean per touched package; no regression in the Cluster-B guards.
