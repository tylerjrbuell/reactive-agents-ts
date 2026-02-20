# @reactive-agents/llm-provider

LLM provider adapters for the [Reactive Agents](https://tylerjrbuell.github.io/reactive-agents-ts/) framework.

Provides a unified `LLMService` interface with adapters for Anthropic, OpenAI, Google Gemini, Ollama, and a deterministic test provider.

## Installation

```bash
bun add @reactive-agents/llm-provider effect
```

Install the SDK for your chosen provider:

```bash
bun add @anthropic-ai/sdk          # Anthropic Claude
bun add openai                     # OpenAI GPT-4o
bun add @google/genai              # Google Gemini
```

## Supported Providers

| Provider | Models | Streaming | Embeddings | Structured Output |
|----------|--------|-----------|------------|------------------|
| `anthropic` | claude-haiku, claude-sonnet, claude-opus | ✓ | — | ✓ |
| `openai` | gpt-4o, gpt-4o-mini, o1-* | ✓ | ✓ | ✓ |
| `gemini` | gemini-2.0-flash, gemini-2.5-pro | ✓ | ✓ | ✓ |
| `ollama` | any local model | ✓ | ✓ | ✓ |
| `test` | deterministic mock | ✓ | ✓ | — |

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

const result = await Effect.runPromise(
  Effect.gen(function* () {
    const llm = yield* LLMService;
    return yield* llm.complete({
      messages: [{ role: "user", content: "Explain quantum entanglement." }],
      model: { provider: "gemini", model: "gemini-2.0-flash" },
    });
  }).pipe(Effect.provide(layer)),
);
```

## Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...     # Anthropic Claude
OPENAI_API_KEY=sk-...            # OpenAI GPT-4o
GOOGLE_API_KEY=...               # Google Gemini
OLLAMA_ENDPOINT=http://localhost:11434  # Ollama (default)
```

## Model Presets

Built-in presets with cost estimates:

```typescript
import { ModelPresets } from "@reactive-agents/llm-provider";

// Available: claude-haiku, claude-sonnet, claude-opus,
//            gpt-4o-mini, gpt-4o,
//            gemini-2.0-flash, gemini-2.5-pro
const preset = ModelPresets["gemini-2.0-flash"];
// { provider: "gemini", model: "gemini-2.0-flash", costPer1MInput: 0.10, ... }
```

## Test Provider

For deterministic testing without API calls:

```typescript
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

const layer = TestLLMServiceLayer({
  "capital of France": "Paris is the capital of France.",
});
```

## Documentation

Full documentation at [tylerjrbuell.github.io/reactive-agents-ts](https://tylerjrbuell.github.io/reactive-agents-ts/)
