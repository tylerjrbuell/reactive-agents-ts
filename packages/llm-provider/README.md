# @reactive-agents/llm-provider

LLM provider adapters for the [Reactive Agents](https://tylerjrbuell.github.io/reactive-agents-ts/) framework.

Provides a unified `LLMService` interface with adapters for Anthropic, OpenAI, Ollama, and a deterministic test provider.

## Installation

```bash
bun add @reactive-agents/llm-provider effect
```

## Supported Providers

| Provider | Models | Streaming | Embeddings |
|----------|--------|-----------|------------|
| `anthropic` | claude-* | ✓ | — |
| `openai` | gpt-*, o1-* | ✓ | ✓ |
| `ollama` | local models | ✓ | ✓ |
| `test` | deterministic | — | — |

## Usage

```typescript
import { createLLMLayer } from "@reactive-agents/llm-provider";
import { LLMService } from "@reactive-agents/llm-provider";
import { Effect } from "effect";

const llmLayer = createLLMLayer("anthropic");

const program = Effect.gen(function* () {
  const llm = yield* LLMService;
  const response = yield* llm.complete({
    messages: [{ role: "user", content: "Hello!" }],
    model: "claude-sonnet-4-20250514",
  });
  return response.content;
});
```

## Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

## Test Provider

For deterministic testing without API calls:

```typescript
const llmLayer = createLLMLayer("test", {
  responses: { "hello": "Hello back!" }
});
```

## Documentation

Full documentation at [tylerjrbuell.github.io/reactive-agents-ts](https://tylerjrbuell.github.io/reactive-agents-ts/)
