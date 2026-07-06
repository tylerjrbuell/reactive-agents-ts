# @reactive-agents/llm-provider

> Version: **0.10.3** — LLM provider adapters for [Reactive Agents](https://docs.reactiveagents.dev/).

A unified `LLMService` interface (`complete`, `stream`, `embed`, structured output) with adapters
for **Anthropic**, **OpenAI**, **Google Gemini**, **Groq**, **xAI (Grok)**, **Ollama**, **LiteLLM**,
and a deterministic **test** provider. Groq and xAI are OpenAI-compatible and share the
`makeOpenAICompatProvider` factory. Includes provider behavior adapters, calibration,
retry/circuit-breaker/rate limiting, and a fallback chain.

## Installation

```bash
bun add @reactive-agents/llm-provider
```

Install the SDK for your chosen provider:

```bash
bun add @anthropic-ai/sdk           # Anthropic Claude
bun add openai                      # OpenAI GPT-4o, o1 — also Groq & xAI (OpenAI-compatible)
bun add @google/genai               # Google Gemini
# Groq, xAI, Ollama, and LiteLLM use OpenAI-compatible / plain HTTP — reuse the openai SDK or none.
```

## Supported providers

| Provider    | Streaming | Native FC | Embeddings | Structured output | Notes |
|-------------|-----------|-----------|------------|-------------------|-------|
| `anthropic` | ✓         | ✓         | —          | ✓                 | claude-sonnet-4, claude-haiku-4-5, claude-opus-4 |
| `openai`    | ✓         | ✓         | ✓          | ✓                 | gpt-4o, gpt-4o-mini, o1-* |
| `gemini`    | ✓         | ✓         | ✓          | ✓                 | gemini-2.0-flash, gemini-2.5-pro |
| `ollama`    | ✓         | ✓         | ✓          | ✓                 | any local model; thinking opt-in |
| `litellm`   | ✓         | ✓         | ✓          | ✓                 | proxy to 100+ providers |
| `test`      | ✓         | ✓         | ✓          | —                 | deterministic mock for unit tests |

Default model per provider is exposed via `getProviderDefaultModel(provider)` /
`PROVIDER_DEFAULT_MODELS`.

## Usage

### Anthropic

```typescript
import { createLLMProviderLayer, LLMService } from "@reactive-agents/llm-provider";
import { Effect } from "effect";

const layer = createLLMProviderLayer("anthropic");

const result = await Effect.runPromise(
  Effect.gen(function* () {
    const llm = yield* LLMService;
    return yield* llm.complete({
      messages: [{ role: "user", content: "Hello!" }],
      model: { provider: "anthropic", model: "claude-sonnet-4-6" },
    });
  }).pipe(Effect.provide(layer)),
);
```

### Google Gemini

```typescript
import { createLLMProviderLayer, LLMService } from "@reactive-agents/llm-provider";
import { Effect } from "effect";

// Set GOOGLE_API_KEY in your environment
const layer = createLLMProviderLayer("gemini");

const out = await Effect.runPromise(
  Effect.gen(function* () {
    const llm = yield* LLMService;
    return yield* llm.complete({
      messages: [{ role: "user", content: "Explain quantum entanglement." }],
      model: { provider: "gemini", model: "gemini-2.5-pro" },
    });
  }).pipe(Effect.provide(layer)),
);
```

### Streaming

```typescript
const events = yield* llm.stream({
  messages: [{ role: "user", content: "Write a haiku." }],
  model: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
});
for await (const ev of events) {
  if (ev.type === "text-delta") process.stdout.write(ev.text);
  if (ev.type === "tool-use-start") console.log("→ tool:", ev.name);
}
```

## Native function calling

All providers receive `tools` on **both** `complete()` and `stream()` calls and emit normalized
`tool_use_start` / `tool_use_delta` events. Provider-specific quirks handled internally:

- **Anthropic streaming** uses raw `streamEvent` (not helper events) to capture `inputJson`
  before `contentBlock`.
- **Gemini** walks `candidates[0].content.parts[]` directly (`chunk.text` strips functionCall
  parts) and surfaces non-OK `finishReason` as explicit errors.
- **Ollama streaming** flushes `chunk.message.tool_calls` on `chunk.done`.

## Environment variables

```bash
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
OLLAMA_ENDPOINT=http://localhost:11434
LITELLM_BASE_URL=http://localhost:4000
LITELLM_API_KEY=...
```

`llmConfigFromEnv` / `LLMConfigFromEnv` build `LLMConfig` from the environment automatically.

## Model presets

```typescript
import { ModelPresets } from "@reactive-agents/llm-provider";

const preset = ModelPresets["claude-sonnet-4"];
// { provider, model, costPer1MInput, costPer1MOutput, ... }
```

## Provider behavior adapters

Per-tier hooks compose to give each provider/model the right prompting and recovery behavior.
Seven hooks fire across the kernel lifecycle:

| Hook | Purpose |
|---|---|
| `taskFraming` | Reframe task per provider/tier conventions |
| `toolGuidance` | Inject tool-use guidance and exemplars |
| `continuationHint` | Encourage long responses to keep going |
| `errorRecovery` | Provider-specific repair on tool/parse errors |
| `synthesisPrompt` | Tweak ICS curator output for the model |
| `qualityCheck` | Provider-aware verifier hints |
| `systemPromptPatch` | Final system-prompt patch |

```typescript
import { selectAdapter, defaultAdapter, midModelAdapter, localModelAdapter } from "@reactive-agents/llm-provider";

const adapter = selectAdapter({ provider: "ollama", model: "qwen3:14b" });
```

## Calibration

A three-tier calibration store records per-(provider, model) measured behavior (latency, alias
frequency, success rate) and materializes an `ExperienceSummary` that drives
`buildCalibratedAdapter` for adaptive prompting.

```typescript
import { runCalibrationProbes, buildCalibratedAdapter, loadCalibration } from "@reactive-agents/llm-provider";
```

## Resilience: retry, circuit breaker, rate limit, fallbacks

```typescript
import {
  retryPolicy,
  makeCircuitBreaker,
  makeRateLimiter,
  makeRateLimitedProvider,
  FallbackChain,
} from "@reactive-agents/llm-provider";

const fallback = new FallbackChain([primaryLayer, secondaryLayer], {
  onFallback: (err, idx) => console.warn(`fell through to provider #${idx}:`, err),
});
```

## Capability port

`Capability` (per-(provider, model) descriptor) supersedes the deprecated `ProviderCapabilities`
in v0.10.0; `ProviderCapabilities` remains exported for binary compatibility but is **scheduled
for removal in v0.11.0**.

```typescript
import { resolveCapability } from "@reactive-agents/llm-provider";
const cap = await resolveCapability("ollama", "qwen3:14b");
// { tier, contextWindow, supportsTools, toolCallDialect, tokenizer, ... }
```

## Test provider

For deterministic testing without API calls:

```typescript
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

const layer = TestLLMServiceLayer({
  "capital of France": "Paris is the capital of France.",
});
```

Per-turn tool-call sequences are configured via `TestTurn` / `ToolCallSpec`.

## Documentation

- Provider guide: [docs.reactiveagents.dev/guides/providers/](https://docs.reactiveagents.dev/guides/providers/)
- Calibration: [docs.reactiveagents.dev/guides/calibration/](https://docs.reactiveagents.dev/guides/calibration/)
- Related: [`@reactive-agents/runtime`](../runtime/README.md),
  [`@reactive-agents/reasoning`](../reasoning/README.md),
  [`@reactive-agents/tools`](../tools/README.md).

## License

MIT
