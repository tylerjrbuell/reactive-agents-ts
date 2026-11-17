# @reactive-agents/llm-provider

> One `LLMService` interface (`complete`, `stream`, `embed`, structured output) over Anthropic, OpenAI, Gemini, Groq, xAI, Ollama and LiteLLM, for agents that should not care which model runs underneath.

> **Stability:** stable. Provider selection and the raw provider layers are stable; adapter selection, calibration and capability resolution are `@unstable` and may change between minors.

## Install

```bash
bun add @reactive-agents/llm-provider
# or: npm install @reactive-agents/llm-provider
```

Install the SDK for the provider you use:

```bash
bun add @anthropic-ai/sdk   # Anthropic
bun add openai              # OpenAI (also used for Groq and xAI, which are OpenAI-compatible)
bun add @google/genai       # Google Gemini
```

Ollama and LiteLLM need no extra SDK. The `reactive-agents` facade (`bun add reactive-agents`) re-exports this package.

## Usage

```ts
import { createLLMProviderLayer, LLMService } from "@reactive-agents/llm-provider";
import { Effect } from "effect";

// Reads ANTHROPIC_API_KEY from the environment.
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

Providers: `anthropic`, `openai`, `gemini`, `groq`, `xai`, `ollama`, `litellm`, plus a deterministic `test` provider. LiteLLM is a proxy: point it at your LiteLLM server to reach whatever models that server exposes.

Credentials come from the environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `GROQ_API_KEY`, `XAI_API_KEY`, `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `OLLAMA_ENDPOINT`). They are read when the layer is built, not at import time.

Deterministic tests need no API calls:

```ts
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

const layer = TestLLMServiceLayer([{ text: "Paris is the capital of France." }]);
```

## API

| Export | Use it when |
|---|---|
| `createLLMProviderLayer(provider, ...)` | You need an Effect layer for a provider. |
| `LLMService` | You call `complete`, `stream`, `embed` or structured output. |
| `readLLMConfigFromEnv()` | You want the `LLMConfig` built from the environment. |
| `getProviderDefaultModel(provider)` | You need the default model for a provider. |
| `TestLLMServiceLayer` | You test without network calls; script turns with `TestTurn` and `ToolCallSpec`. |
| `retryPolicy`, `makeCircuitBreaker`, `makeRateLimiter` | You add retry, circuit-breaking or rate limiting around a provider. |
| `selectAdapter`, `buildCalibratedAdapter`, `loadCalibration` | You tune prompting and recovery per provider and model (`@unstable`). |
| `resolveCapability(provider, model)` | You need the context window, tool support and dialect of a model. |

Provider fallback chains are configured on the builder (`.withFallbacks({ providers: [...] })` in `@reactive-agents/runtime`), not in this package.

## Documentation

- [LLM providers](https://docs.reactiveagents.dev/features/llm-providers/)

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
