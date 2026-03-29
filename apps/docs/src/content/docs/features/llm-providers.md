---
title: LLM Providers
description: Multi-provider LLM support — Anthropic, OpenAI, Google Gemini, Ollama, LiteLLM, and custom providers.
sidebar:
  order: 1
---

Reactive Agents supports multiple LLM providers through a unified `LLMService` interface. Switch providers with a single line — your agent code stays the same.

## Supported Providers

| Provider          | Models                                            | Tool Calling | Streaming | Embeddings      | Prompt Caching  |
| ----------------- | ------------------------------------------------- | :----------: | :-------: | :-------------: | :-------------: |
| **Anthropic**     | Claude 3.5 Haiku, Claude Sonnet 4, Claude Opus 4  |     Yes      |    Yes    | No (use OpenAI) | Yes (explicit)  |
| **OpenAI**        | GPT-4o, GPT-4o-mini                               |     Yes      |    Yes    |       Yes       | Yes (automatic) |
| **Google Gemini** | Gemini 2.0 Flash, Gemini 2.5 Flash, Gemini 2.5 Pro|     Yes      |    Yes    |       No        | Yes (automatic) |
| **Ollama**        | Any locally hosted model                          |     Yes      |    Yes    |       Yes       | No              |
| **LiteLLM**       | 100+ models via LiteLLM proxy                     |     Yes      |    Yes    |       No        | Depends         |
| **Test**          | Mock provider for testing (`withTestScenario`)    |     Yes\*    |    Yes\*  |       No        | No              |

\*The test provider advertises native tool calling so kernels exercise the same FC path as real providers; responses are still fully deterministic from your scenario.

## Configuration

Set your API key in `.env` and specify the provider:

```typescript
import { ReactiveAgents } from "reactive-agents";

// Anthropic
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .build();

// OpenAI
const agent = await ReactiveAgents.create()
  .withProvider("openai")
  .withModel("gpt-4o")
  .build();

// Google Gemini
const agent = await ReactiveAgents.create()
  .withProvider("gemini")
  .withModel("gemini-2.5-flash")
  .build();

// Ollama (local)
const agent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("cogito:14b")
  .build();

// LiteLLM proxy (100+ models)
const agent = await ReactiveAgents.create()
  .withProvider("litellm")
  .withModel("gpt-4o")
  .build();
```

### Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
OLLAMA_ENDPOINT=http://localhost:11434   # defaults to this
LITELLM_BASE_URL=http://localhost:4000   # LiteLLM proxy endpoint

TAVILY_API_KEY=tvly-...                  # enables built-in web search

LLM_DEFAULT_MODEL=claude-sonnet-4-20250514
LLM_DEFAULT_TEMPERATURE=0.7
LLM_MAX_RETRIES=3
LLM_TIMEOUT_MS=30000
```

## Model Presets

| Preset              | Provider  | Cost/1M Input | Context Window | Quality |
| ------------------- | --------- | ------------- | -------------- | ------- |
| `claude-haiku`      | Anthropic | $1.00         | 200K           | 0.60    |
| `claude-sonnet`     | Anthropic | $3.00         | 200K           | 0.85    |
| `claude-opus`       | Anthropic | $15.00        | 1M             | 1.00    |
| `gpt-4o-mini`       | OpenAI    | $0.15         | 128K           | 0.55    |
| `gpt-4o`            | OpenAI    | $2.50         | 128K           | 0.80    |
| `gemini-2.0-flash`  | Gemini    | $0.10         | 1M             | 0.75    |
| `gemini-2.5-flash`  | Gemini    | $0.15         | 1M             | 0.80    |
| `gemini-2.5-pro`    | Gemini    | $1.25         | 1M             | 0.95    |

## Tool Calling

When tools are enabled, each provider translates tool definitions to its native format automatically:

- **Anthropic** — `tools` parameter with Anthropic's `tool_use` format; last tool marked with `cache_control` to cache the full schema block
- **OpenAI** — `tools` array with `function_calling`; automatic prompt caching applies to tool schemas
- **Gemini** — `functionDeclarations` in `tools` array; function calling supported natively
- **Ollama** — OpenAI-compatible `tools` array via the Ollama SDK
- **LiteLLM** — OpenAI-compatible `tools` array forwarded to proxy

## Prompt Caching

Each provider implements caching differently. The framework handles cost discounting automatically when the provider reports cached token usage.

### Anthropic — Explicit `cache_control`

Anthropic uses **manual cache hints** via `cache_control: { type: "ephemeral" }` blocks. The framework automatically applies these to system prompts ≥ 1,024 tokens and to the full tool schema block on every request:

- **System prompt**: Cached when `>= ~4,096 chars` — 90% discount on cache hits, 25% surcharge on writes
- **Tool schemas**: Last tool in the array is marked, caching the full schema block

Cache TTL is 5 minutes. The framework handles this transparently — no configuration required.

### Gemini — Automatic Implicit Caching

Gemini 2.0 Flash and 2.5 models support **automatic context caching** — Google's servers cache repeated prefixes server-side with no client code required. When a cache hit occurs, `cachedContentTokenCount` is returned in the usage metadata and the framework applies a **75% cost discount** automatically.

There is no minimum token requirement for implicit caching — Google manages it transparently for eligible models.

```typescript
// No special config needed — Gemini caches automatically
const agent = await ReactiveAgents.create()
  .withProvider("gemini")
  .withModel("gemini-2.5-flash")
  .withTools()
  .build();
// Repeated system prompts and tool schemas are cached by Gemini automatically
```

### OpenAI — Automatic Caching

OpenAI applies automatic prompt caching server-side for inputs longer than 1,024 tokens. Cached tokens are returned as `cached_tokens` in the usage object and the framework applies a **50% cost discount** automatically.

## Provider Adapters

Provider adapters are lightweight hook objects the kernel calls at specific points to compensate for model-specific behavior differences — especially useful for local and mid-tier models that need more explicit guidance.

The framework ships three built-in adapters selected automatically by model tier:

| Tier       | Adapter           | Behavior                                                              |
| ---------- | ----------------- | --------------------------------------------------------------------- |
| `local`    | `localModelAdapter` | Explicit task framing, tool guidance, error recovery, quality check |
| `mid`      | `midModelAdapter`   | Lighter continuation hint + synthesis prompt                        |
| `large` / `frontier` | `defaultAdapter` | Structured decision framework only                        |

### Adapter Hooks (7 total)

| Hook              | When it fires                                              | What it does                                           |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| `systemPromptPatch` | Once at system prompt build time                         | Append multi-step completion instructions (local tier) |
| `toolGuidance`    | Once after the tool schema block in the system prompt      | Append inline required-tool reminder                   |
| `taskFraming`     | First iteration only (iteration 0)                         | Wrap task message with explicit numbered steps         |
| `continuationHint` | Each iteration when required tools are still pending      | Inject guidance as user message after tool results     |
| `errorRecovery`   | When a tool call returns a failed result                   | Append context-aware recovery hint to the observation  |
| `synthesisPrompt` | Research→produce transition (all search tools satisfied)   | Replace generic progress message with "write it now"   |
| `qualityCheck`    | Once before final answer (gated by `qualityCheckDone` flag)| Self-eval prompt; fires only once to prevent loops     |

You can register a fully custom adapter:

```typescript
import { selectAdapter } from "@reactive-agents/llm-provider";

// The built-in adapters are selected automatically by tier.
// Access them directly for inspection or extension:
import { localModelAdapter, midModelAdapter, defaultAdapter } from "@reactive-agents/llm-provider";
```

## Embeddings

Embeddings are routed through the configured embedding provider regardless of which chat provider you use:

```bash
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
```

```typescript
const vectors = await llm.embed(["text to embed", "another text"]);
// Returns: number[][] (one vector per input text)
```

## Structured Output

Parse LLM responses into typed objects with automatic retry on parse failure:

```typescript
import { Schema } from "effect";

const WeatherSchema = Schema.Struct({
  city: Schema.String,
  temperature: Schema.Number,
  conditions: Schema.String,
});

const weather = await llm.completeStructured({
  messages: [{ role: "user", content: "Weather in Tokyo" }],
  outputSchema: WeatherSchema,
  maxParseRetries: 2,
});
```

## Automatic Retry and Timeout

All providers include built-in retry logic with exponential backoff:

- **Rate limit (429)** — Retried with backoff, tracked as `LLMRateLimitError`
- **Timeout** — Configurable per-request, defaults to 30 seconds
- **Retries** — Configurable, defaults to 3 attempts

## Testing

Use `withTestScenario()` for deterministic, offline testing:

```typescript
const agent = await ReactiveAgents.create()
  .withTestScenario([
    { match: "capital of France", text: "Paris is the capital of France." },
  ])
  .build();
```
