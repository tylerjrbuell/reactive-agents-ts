# Architecture Sweep 2026-07-07 — 03-provider-model-params

I have comprehensive evidence across all five questions. Here is the audit.

## Findings (ranked by leverage)

**F1 — `Capability.maxOutputTokens` is a dead signal in the request path; output-budget clamping is hardcoded/absent (HIGHEST LEVERAGE).** Every provider computes the output budget as `request.maxTokens ?? config.defaultMaxTokens` (local.ts:487, anthropic.ts:195, openai.ts:289, gemini.ts:268, litellm.ts:253) and never clamps against `cap.maxOutputTokens`. The capability field is collected, flows into `canonical-resolver.ts:48`, and dies there. The only output-cap recovery logic lives in the kernel with a hardcoded `64_000` (`reasoning/.../reason/think.ts:855`), not derived from capability. So a model with an 8k output ceiling and a caller asking for 64k silently over-requests. This is the "should be capability-driven, is hardcoded" flagship.

**F2 — `Capability.toolCallDialect` is a parallel dead signal; the live dialect signal is a *different* struct.** The capability field is only read by `canonical-resolver.ts:46` (pass-through). Every place that actually branches on dialect reads `ModelCalibration.toolCallDialect` instead (`strategies/blueprint.ts:114`, `kernel/loop/runner.ts:225`, `runtime/.../tool-schemas.ts:123`, `tools/.../final-answer.ts:106`). Providers themselves unconditionally assume native function-calling. Two competing dialect sources; the capability one is inert.

**F3 — `Capability.tokenizerFamily` has ZERO readers anywhere.** Fully dead (grep returned nothing outside the schema definition). `token-counter.ts` uses a generic estimator, not the family.

**F4 — 120s cloud timeout is hardcoded and duplicated, with no resolution chain.** All four cloud providers hardcode `Effect.timeout("120 seconds")` AND restate `timeoutMs: 120_000` in the error (anthropic.ts:262/268, openai.ts:357/363, gemini.ts:413/419, litellm.ts:279/285). Only `local.ts` has a real precedence chain (`resolveLocalTimeoutMs`, :363). Cloud timeout is neither config- nor capability-driven, and the literal is written twice per provider so the two can drift.

**F5 — Error normalization is only half-migrated: `complete()` uses the shared `mapProviderError`, streams still use the old anti-pattern it was built to kill.** The top-level `catch` in each provider routes through `toEffectError → mapProviderError` (good), but the streaming error branches revert to `message: err.message ?? String(error)` (anthropic.ts:455, gemini.ts:638, openai.ts:585, litellm.ts:557) — exactly the stack-leaking/JSON-duplicating shape `provider-error.ts` documents as the defect it fixes (:10-27).

**F6 — `litellm` is missing thinking + capability resolution entirely.** Unlike the other three cloud providers, `litellm.ts` imports neither `resolveThinkingEnabled` nor `resolveCapability` (only `selectAdapter`, `retryPolicy`, `mapProviderError`). Thinking is silently unsupported there; inconsistent contract.

**F7 — `local.ts` recomputes `resolveOllamaNumCtx` 3× per call path for the same value.** complete() calls it at :473 then again twice at :604-605 for `resolvedParams`; stream() at :672 then twice at :858-859. Pure/cheap but the "single source of truth" doc-comment (:83) is undercut by recomputation instead of a single binding.

## Param resolution census (param → chain(s) → location(s))

| param | precedence chain | where it lives | shared or per-provider |
|---|---|---|---|
| **model** | `request.model` (string \| ModelConfig.model) → `config.defaultModel`; local adds claude/gpt→ollama-default swap | inline in each provider's `Effect.suspend`/gen (local.ts:421-424, 633-636; cloud analogues) | **per-provider, copy-pasted** (5×, plus 3× within local for complete/stream/structured) |
| **temperature** | `request.temperature ?? config.defaultTemperature` | inline at wire-assembly (local.ts:483, anthropic.ts:228, openai.ts:303, gemini.ts:352, litellm.ts:254) | **per-provider inline**, no helper |
| **maxTokens / num_predict** | `request.maxTokens ?? config.defaultMaxTokens`, then thinking widening | local: `widenNumPredictForThinking` (local.ts:308) at 3 sites (:486,:695,:978); cloud: `reserveThinkingBudget`+`buildTokenField` (openai.ts:36) / `answerBudget+reserve` (anthropic, gemini) | **two different mechanisms** (Ollama widen-flat vs cloud reserve-on-top); each duplicated across complete/stream/structured |
| **num_ctx** | `request.numCtx → config.explicitNumCtx → capability.recommendedNumCtx → config.defaultNumCtx` | `resolveOllamaNumCtx` (local.ts:89) | **local-only helper**, called 6× (should bind once) |
| **think / reasoning** | `requestOverride ?? config.thinking`, gated on capability | shared `resolveThinkingEnabled` (thinking/resolve.ts:24); local wraps it in async `resolveThinking` (local.ts:271) with `/api/show` probe; anthropic adds form dispatch (`anthropic-form.ts`) | **shared core**, per-provider capability source + encoding |
| **stop** | `request.stopSequences ? [...] : undefined` | inline (local.ts:492, anthropic.ts:215, openai.ts:306, gemini.ts:292, litellm.ts:256) | **per-provider inline**, identical spread |
| **timeout** | local: `request.timeoutMs ?? config.ollamaTimeoutMs ?? 300_000` (resolveLocalTimeoutMs :363); cloud: **hardcoded 120s** | local helper; cloud literals | **inconsistent** (1 chain + 4 literals) |
| **retries** | `Effect.retry(retryPolicy)` — recurs(3) × exponential, only on RateLimit/Timeout | shared `retry.ts:9` | **shared, consistent** (all 5) |

Count: **~8 params, 5 distinct precedence patterns**; only `retries` and the thinking *decision* are truly centralized. num_ctx and timeout each have exactly one provider that owns a real chain; temperature/stop/model/maxTokens are inline-duplicated 5× (and 3× within local across complete/stream/structured).

## Capability field usage matrix (field → readers → dead?)

| field | real behavioral readers | verdict |
|---|---|---|
| `tier` | adapter selection `selectAdapter(_, cap.tier, model)` (local.ts:527 + all providers); context profiles across reasoning (323 hits) | **LIVE — primary driver** |
| `recommendedNumCtx` | `resolveOllamaNumCtx` (local.ts:97) → `options.num_ctx` | **LIVE (Ollama only)** |
| `supportsThinkingMode` | `resolveThinkingEnabled` (resolve.ts:33), `reserveThinkingBudget` (budget.ts:29), `widenNumPredictForThinking` (local.ts:311) | **LIVE** |
| `requiresMaxCompletionTokens` | `buildTokenField` (openai.ts:43) — picks `max_completion_tokens` vs `max_tokens` | **LIVE (OpenAI only)** |
| `maxContextTokens` | `canonical-resolver.ts:43` → `effectiveWindowChars` (chars budget), round-trips in `adaptCache` | **LIVE but indirect** (only via canonical window derivation; not a provider request input) |
| `maxOutputTokens` | `canonical-resolver.ts:48` pass-through only | **DEAD in request path** (F1) — never clamps `maxTokens` |
| `toolCallDialect` | `canonical-resolver.ts:46` pass-through only; real branching reads `ModelCalibration.toolCallDialect` instead | **DEAD** (F2) |
| `supportsStreamingToolCalls` | `canonical-resolver.ts:51` pass-through; providers stream tool calls unconditionally | **DEAD** (collected, never gates) |
| `supportsPromptCaching` | `canonical-resolver.ts` sub-struct; Anthropic cache headers are applied unconditionally, not gated on this | **effectively DEAD** as a gate (9 hits are mostly the contract/telemetry, not a branch) |
| `supportsVision` | canonical pass-through only | **DEAD** |
| `tokenizerFamily` | none | **DEAD** (F3) |

So of 11 capability fields: **4 drive provider behavior** (tier, recommendedNumCtx, supportsThinkingMode, requiresMaxCompletionTokens), 1 drives char-budget indirectly (maxContextTokens), **6 are dead signals**.

## Adapter duplication map

- **Request assembly** is copy-pasted per provider AND per method. `local.ts` alone builds the Ollama `chat({...options})` body **3 times** — complete (:475-505), stream (:683-708), completeStructured (:963-989) — each re-deriving model, temperature, num_predict (via widen), num_ctx. The structured path deliberately passes `think=undefined` to widen (:982) — a subtle divergence that must be kept in sync by hand.
- Across the 5 providers the same skeleton repeats: resolve model → `resolveCapability` → `resolveThinking*` → `selectAdapter(tier, model)` → assemble body → call → normalize stopReason → `parseToolCalls` adapter hook → map usage. Only the SDK-specific body shape differs.
- `selectAdapter` (the M12 behavior adapter, `adapter.ts:314`) is correctly the *one* surviving hook — the doc note at adapter.ts:115-126 records that 6 of 7 original "M12 hooks" were deleted as un-invoked debt. Good precedent for the same treatment on dead capability fields.
- **stopReason mapping** is hand-rolled per provider (local.ts:584-590, openai finish_reason, anthropic stop_reason, gemini, litellm:120-126) — 5 near-identical ternary ladders mapping provider tokens → `StopReason`.
- A **single request-builder per provider** would collapse each provider's 3 method-bodies into one `buildBody(request, config, capability, {stream, format})` returning the SDK payload, plus one `mapStopReason` table and one `mapUsage`. Estimated: local.ts ~1078→~700 lines.

## Better shape (keep/merge/delete)

**KEEP (already the right primitives):**
- `retryPolicy` (retry.ts) — the one truly shared, consistent cross-provider control.
- `mapProviderError` (provider-error.ts) — good normalizer; just finish wiring it (F5).
- `resolveThinkingEnabled` (thinking/resolve.ts) — clean tri-state decision core.
- `selectAdapter` narrow surface — the model to imitate.

**MERGE into one pipeline** `resolve(intent, capability, providerCaps) → ProviderParams`:
- `resolveOllamaNumCtx`, `resolveLocalTimeoutMs`, `widenNumPredictForThinking`, `reserveThinkingBudget`, `buildTokenField`, `buildAnthropicThinkingBody`, and the inline `temperature ?? default` / `stop` / `model ?? default` spreads are all fragments of **one three-stage function**: (1) caller-intent precedence (`request.x ?? config.x`), (2) capability-informed clamp/reserve (this is where `maxOutputTokens` clamp and dialect gating would finally have a home), (3) provider-specific encoding (num_predict vs max_tokens vs max_completion_tokens). Today stage (2) is scattered and stage (1) is re-typed inline 5×.
- Timeout: give cloud providers the same `resolve*TimeoutMs` chain as local; drive the ceiling from config (and eventually the note at local.ts:356 about threading `.withTimeout()`).
- Per-provider `buildBody` + shared `mapStopReason` table + shared `mapUsage`.

**DELETE / demote:**
- `Capability.tokenizerFamily`, `.supportsVision`, `.maxOutputTokens` (or wire it into the clamp), `.toolCallDialect` (or make it the single dialect source and delete the calibration duplicate), `.supportsStreamingToolCalls` — each is either zero-reader or pass-through-only, mirroring the already-deleted M12 hooks.
- The 3× recompute of `resolveOllamaNumCtx` in local.ts → bind once.

## Signals worth exploiting

1. **`maxOutputTokens` → clamp `maxTokens`** in the stage-2 resolver. Highest-leverage: makes the field earn its place and prevents silent over-request (F1).
2. **`toolCallDialect` → collapse the two dialect sources.** Either capability or calibration should own it; today branching code reads calibration while the capability copy rots (F2). Unifying removes a whole class of "which dialect is authoritative?" drift.
3. **`supportsStreamingToolCalls` → gate the stream tool-call path** instead of assuming every model streams tool_use (currently unconditional).
4. **`supportsPromptCaching` → gate Anthropic cache headers** rather than applying them blind.
5. **capability/config-driven timeout** for cloud providers, replacing the eight hardcoded 120s literals (F4) — the resolution chain already exists in local.ts as the template.

Key files: `packages/llm-provider/src/providers/local.ts` (:44-100, :308-368, :415-1078), `capability.ts` (:75-125 struct + STATIC table), `capability-resolver.ts`, `canonical-resolver.ts` (:39-57 the pass-through where dead fields terminate), `thinking/{resolve,budget,anthropic-form}.ts`, `provider-error.ts`, `retry.ts`, `adapter.ts` (:115-126 the deletion precedent), `types.ts:781-839` (CompletionRequest), `providers/{anthropic,openai,gemini,litellm}.ts` (parallel assembly + stream error anti-pattern at :455/:585/:638/:557), `reasoning/src/kernel/observable-llm.ts` (wrapper, resolvedParams consumer), `reasoning/.../reason/think.ts:850-883` (the hardcoded 64k output-recovery that should be capability-driven).