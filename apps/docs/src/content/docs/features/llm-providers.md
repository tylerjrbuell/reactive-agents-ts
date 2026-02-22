---
title: LLM Providers
description: Multi-provider LLM support — Anthropic, OpenAI, Google Gemini, Ollama, and custom providers.
sidebar:
  order: 1
---

Reactive Agents supports multiple LLM providers through a unified `LLMService` interface. Switch providers with a single line — your agent code stays the same.

## Supported Providers

| Provider | Models | Tool Calling | Streaming | Embeddings | Prompt Caching |
|----------|--------|:---:|:---:|:---:|:---:|
| **Anthropic** | Claude 3.5 Haiku, Claude Sonnet 4, Claude Opus 4 | Yes | Yes | No (use OpenAI) | Yes |
| **OpenAI** | GPT-4o, GPT-4o-mini | Yes | Yes | Yes | No |
| **Google Gemini** | Gemini 2.0 Flash, Gemini 2.5 Pro | Yes | Yes | No | No |
| **Ollama** | Any locally hosted model | Yes | Yes | Yes | No |
| **Test** | Mock provider for testing | No | No | No | No |

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
  .withModel("gemini-2.0-flash")
  .build();

// Ollama (local)
const agent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("llama3")
  .build();
```

### Environment Variables

```bash
# Set the key for your provider
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
OLLAMA_ENDPOINT=http://localhost:11434   # defaults to this

# Tools (optional)
TAVILY_API_KEY=tvly-...                  # enables built-in web search

# Optional tuning
LLM_DEFAULT_MODEL=claude-sonnet-4-20250514
LLM_DEFAULT_TEMPERATURE=0.7
LLM_MAX_RETRIES=3
LLM_TIMEOUT_MS=30000
```

## Model Presets

Pre-configured model presets with cost and capability data:

| Preset | Provider | Cost/1M Input | Context Window | Quality |
|--------|----------|--------------|----------------|---------|
| `claude-haiku` | Anthropic | $1.00 | 200K | 0.60 |
| `claude-sonnet` | Anthropic | $3.00 | 200K | 0.85 |
| `claude-opus` | Anthropic | $15.00 | 1M | 1.00 |
| `gpt-4o-mini` | OpenAI | $0.15 | 128K | 0.55 |
| `gpt-4o` | OpenAI | $2.50 | 128K | 0.80 |
| `gemini-2.0-flash` | Gemini | $0.10 | 1M | 0.75 |
| `gemini-2.5-pro` | Gemini | $1.25 | 1M | 0.95 |

```typescript
import { ModelPresets } from "@reactive-agents/llm-provider";

const config = ModelPresets["claude-sonnet"];
// { provider: "anthropic", model: "claude-sonnet-4-20250514", costPer1MInput: 3.0, ... }
```

## Tool Calling

When tools are enabled, the LLM can request tool calls. Each provider translates tool definitions to its native format automatically:

- **Anthropic**: Uses the `tools` parameter with Anthropic's tool use format
- **OpenAI**: Uses `function_calling` with `tools` array
- **Gemini**: Uses `functionDeclarations` in `tools` array
- **Ollama**: Uses the `ollama` npm SDK with OpenAI-compatible tool format

```typescript
const response = await llm.complete({
  messages: [{ role: "user", content: "What's the weather in Tokyo?" }],
  tools: [{
    name: "get_weather",
    description: "Get current weather for a city",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  }],
});

if (response.toolCalls) {
  for (const call of response.toolCalls) {
    console.log(`Tool: ${call.name}, Input: ${JSON.stringify(call.input)}`);
  }
}
```

## Prompt Caching (Anthropic)

Anthropic supports prompt caching for static content, reducing costs on repeated calls:

```typescript
import { makeCacheable } from "@reactive-agents/llm-provider";

const message = {
  role: "user" as const,
  content: [
    makeCacheable(largeSystemContext),    // Cached across requests
    { type: "text" as const, text: dynamicUserInput },
  ],
};
```

## Embeddings

Embeddings are routed through the configured embedding provider (OpenAI or Ollama), regardless of which chat provider you use:

```bash
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
```

```typescript
const vectors = await llm.embed(["text to embed", "another text"]);
// Returns: number[][] (one vector per input text)
```

Embeddings are used by Memory Tier 2 for KNN vector search.

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
  maxParseRetries: 2,  // Retries with error feedback on parse failure
});
// weather is fully typed: { city: string, temperature: number, conditions: string }
```

## Automatic Retry and Timeout

All providers include built-in retry logic with exponential backoff for transient errors and rate limits:

- **Rate limit (429)**: Retried with backoff, tracked as `LLMRateLimitError`
- **Timeout**: Configurable per-request, defaults to 30 seconds
- **Retries**: Configurable, defaults to 3 attempts

## Testing

Use the test provider for deterministic, offline testing:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("test")
  .withTestResponses({
    "capital of France": "Paris is the capital of France.",
    "quantum": "Quantum mechanics describes nature at the atomic scale.",
  })
  .build();

const result = await agent.run("What is the capital of France?");
// Always returns: "Paris is the capital of France."
```
