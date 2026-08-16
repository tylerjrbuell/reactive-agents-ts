# Bundle: providers-dynamic-config
Date: 2026-08-16
Budget: 90 min
Issues: #198

## Acceptance criteria
- #198: `.withProvider("litellm", { baseUrl, apiKey, headers })` sets an OpenAI-compatible
  endpoint (Llama.cpp server, Deepseek, any proxy) at runtime, without predefining env vars.
  `litellm` adapter already speaks OpenAI-compat protocol — this is config plumbing, not a
  new provider.

## Verified-by (supplied by triage, none present on issue)
- `packages/llm-provider/src/providers/litellm.ts:230,234` — `litellmBaseUrl`/`litellmApiKey`
  read via `(config as unknown as {...})` cast; NOT declared on `LLMConfig`
  (`packages/llm-provider/src/llm-config.ts`).
- `packages/runtime/src/builder.ts:804` — `.withProvider(provider: ProviderName)` takes only
  a fixed enum string, no config object overload.
- No custom-headers support anywhere in `litellm.ts` fetch call sites (4 sites).

## Execution units (ordered)
1. **Unit 1** (`packages/llm-provider`): type `litellmBaseUrl?`, `litellmApiKey?`,
   `litellmHeaders?: Record<string,string>` on `LLMConfig`; delete the `as unknown as {}`
   casts in `litellm.ts`; merge `litellmHeaders` into all 4 fetch call sites. Extend
   `createLLMProviderLayer`'s `modelParams` (`runtime.ts`) with `baseUrl?/apiKey?/headers?`,
   mapped to the new config fields.
2. **Unit 2** (`packages/runtime`): add `providerConfig?: {baseUrl?; apiKey?; headers?}` to
   `RuntimeOptions` (`runtime-types.ts`); thread through `runtime.ts:413` call site into
   `createLLMProviderLayer`'s modelParams; add `_providerConfig` field + `.withProvider()`
   overload on `ReactiveAgentBuilder`; wire `state._providerConfig` through
   `BuilderRuntimeStateView` → `createRuntime()` call in `runtime-construction.ts`.

## Risk register
- Cross-package (llm-provider + runtime) — inherent to the feature shape (config type lives
  in llm-provider, builder API lives in runtime); not an artificial bundle, single coherent
  fix. Shipped as one PR per the skill's own judgment call on singleton-issue bundles.

## Verification protocol
- `bun test packages/llm-provider/ packages/runtime/`
- `bunx turbo run typecheck --filter=@reactive-agents/llm-provider --filter=@reactive-agents/runtime`
- `bun run build`

## Baseline (pre-EXECUTE, captured on bundle branch)
- `bun test packages/llm-provider/ packages/runtime/` → 1879 pass / 3 skip / 4 fail (pre-existing,
  unrelated: `built-surface.test.ts` dist-check, `.withLlmTimeout` live timing test, 2x
  `low_delta_guard` evidence-delta misfire tests). Not touched by this bundle.

## Out-of-scope (explicit)
- New provider adapters — not needed, litellm already speaks OpenAI-compat.
- Extending baseUrl/apiKey/headers to non-OpenAI-compat providers (anthropic/gemini) — those
  have fixed hosted endpoints, out of scope for this request.
- Serialization roundtrip (`AgentConfig`/`agent-config.ts`) for `providerConfig` — declarative
  JSON config is out of scope per the `"custom"`-provider precedent (agent-config.ts already
  excludes runtime-only escape hatches from the JSON schema).
