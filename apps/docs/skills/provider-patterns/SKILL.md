---
name: provider-patterns
description: Configure per-provider behavior, understand streaming quirks, and use the 7-hook adapter system for optimal performance across LLM providers.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "capability"
---

# Provider Patterns

## Agent objective

Produce a builder with the correct provider + model + any provider-specific configuration; know which providers need special handling for streaming and tool calls.

## When to load this skill

- Configuring a non-Anthropic provider
- Debugging tool call or streaming issues specific to one provider
- Using local models (Ollama) or proxy routing (LiteLLM)
- Enabling extended thinking or provider-specific model options

## Implementation baseline

```ts
// Anthropic — highest quality, native FC, prompt caching
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withModel("claude-opus-4-6")
  .withReasoning({ defaultStrategy: "adaptive" })
  .withTools()
  .build();

// Local Ollama model
const agent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("qwen2.5:7b")
  .withReasoning({ defaultStrategy: "reactive", maxIterations: 6 })
  .withTools({ allowedTools: ["web-search"] })
  .build();
```

## Provider selection guide

| Provider | Best for | Key notes |
|----------|----------|-----------|
| `"anthropic"` | Production, highest quality | Native FC, prompt caching, streaming |
| `"openai"` | GPT-4o, broad compatibility | Native FC, streaming |
| `"gemini"` | Multimodal, long context | Native FC; `functionResponse.name` quirk |
| `"ollama"` | Local, privacy-first | Tool calls arrive on `chunk.done` |
| `"litellm"` | Proxy routing, cost optimization | OpenAI-compatible; use for Groq, OpenRouter, etc. |
| `"test"` | Unit tests, CI | Returns deterministic mock responses |

## Key patterns

### Extended thinking (Anthropic)

```ts
.withProvider("anthropic")
.withModel({ model: "claude-opus-4-6", thinking: true })
// Enables extended thinking — model reasons before responding
// Higher quality on complex reasoning tasks; adds latency and cost
```

### LiteLLM for provider routing

```ts
// Groq, OpenRouter, Bedrock, Vertex — all through LiteLLM
.withProvider("litellm")
.withModel("groq/llama-3.1-70b-versatile")
// Model name format: "provider/model-name" as per LiteLLM docs
```

### Circuit breaker for unreliable providers

```ts
.withProvider("ollama")
.withModel("llama3:8b")
.withCircuitBreaker({
  failureThreshold: 3,    // open after 3 consecutive failures
  cooldownMs: 30_000,     // wait 30s before half-open probe
  halfOpenRequests: 1,
})
.withRateLimiting({ requestsPerMinute: 10 })
```

### Enabling temperature and sampling

```ts
.withModel({ model: "gpt-4o", temperature: 0.2 })  // more deterministic
.withModel({ model: "claude-sonnet-4-6", temperature: 0.9 })  // more creative
```

## 7 adapter hooks (automatic — no configuration needed)

These hooks run automatically and adapt prompts/behavior for each provider:

| Hook | What it does |
|------|-------------|
| `taskFraming` | Wraps task in provider-optimal framing |
| `toolGuidance` | Injects provider-specific tool-use instructions |
| `continuationHint` | Tells model to continue after tool results |
| `errorRecovery` | Recovery prompt on tool errors |
| `synthesisPrompt` | Final answer synthesis guidance |
| `qualityCheck` | Post-step quality assessment |
| `systemPromptPatch` | Provider-specific system prompt additions |

Adapter selection is automatic via `selectAdapter(capabilities, tier)`.

## Builder API reference

| Method | Key params | Notes |
|--------|-----------|-------|
| `.withProvider(p)` | `"anthropic"\|"openai"\|"gemini"\|"ollama"\|"litellm"\|"test"` | Required |
| `.withModel(m)` | `string \| { model, thinking?, temperature? }` | `thinking: true` = extended reasoning |
| `.withCircuitBreaker(cfg?)` | `{ failureThreshold?, cooldownMs?, halfOpenRequests? }` | Auto-retry with backoff |
| `.withRateLimiting(cfg)` | `{ requestsPerMinute?, tokensPerMinute?, maxConcurrent? }` | |

## Pitfalls

- `"groq"` and `"openrouter"` are **not** valid provider names — use `"litellm"` with the appropriate model prefix
- **Gemini**: `functionResponse.name` must use `msg.toolName`, not hard-coded `"tool"` — framework handles this but custom tool parsers must follow the same pattern
- **Ollama**: tool_calls arrive on `chunk.done`, not during the stream — don't parse mid-stream chunks for tool calls
- **Anthropic streaming**: use raw `streamEvent`, not helper events (`inputJson` fires before `contentBlock` in streaming FC)
- `thinking: true` requires a model that supports extended thinking — verify model capability before enabling
- LiteLLM model names are `"provider/model"` format — check LiteLLM docs for exact names
