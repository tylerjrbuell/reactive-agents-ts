---
name: provider-streaming
description: LLM provider streaming patterns and per-provider quirks. Use when adding a new provider, implementing adapter hooks, or debugging streaming tool call behavior in packages/llm-provider.
user-invocable: false
---

# Provider Streaming Patterns

## The One Rule That Applies to ALL Providers

```
Pass tools to BOTH complete() AND stream().
```

Failing to pass tools to `stream()` causes silent tool call failures where the LLM receives no tool schemas and falls back to text output.

```typescript
// CORRECT — tools on both:
const response = yield* llm.complete({ messages, tools: toolSchemas, maxTokens: 4096 });
const stream = yield* llm.stream({ messages, tools: toolSchemas, maxTokens: 4096 });

// WRONG — tools only on complete:
const stream = yield* llm.stream({ messages, maxTokens: 4096 }); // missing tools
```

## Per-Provider Streaming Quirks

These bugs have been introduced multiple times. Treat them as rules.

### Anthropic

**Rule:** Use raw `streamEvent`, not the SDK helper events.

```typescript
// WRONG — inputJson fires before contentBlock, causing missed content:
stream.on("inputJson", (delta) => { ... });

// CORRECT — use streamEvent for ordering guarantees:
stream.on("streamEvent", (event) => {
  if (event.type === "content_block_delta") { ... }
  if (event.type === "tool_use") { ... }
});
```

### Gemini

**Rule:** `functionResponse.name` must use `msg.toolName`, not a hard-coded string.

```typescript
// WRONG — breaks multi-tool scenarios:
{
  functionResponse: {
    name: "tool",  // hard-coded — wrong
    response: toolResult,
  }
}

// CORRECT:
{
  functionResponse: {
    name: msg.toolName,  // use the actual tool name from the message
    response: toolResult,
  }
}
```

### Ollama

**Rule:** Tool calls are on `chunk.done`, not streamed incrementally. Emit synthetic events.

```typescript
// CORRECT Ollama streaming pattern:
if (chunk.done && chunk.message.tool_calls) {
  for (const tc of chunk.message.tool_calls) {
    yield { type: "tool_use_start", toolName: tc.function.name };
    yield { type: "tool_use_delta", delta: JSON.stringify(tc.function.arguments) };
  }
}
```

Do NOT attempt to stream Ollama tool call arguments incrementally — they arrive only on the final `done` chunk.

### OpenAI / LiteLLM / Others

Standard streaming patterns apply. Follow the `StreamEvent` type definitions in `packages/llm-provider/src/types.ts`.

## Adding a New Provider

### Required: 7 methods on LLMService

```typescript
// packages/llm-provider/src/providers/<name>.ts
export const create<Name>Provider = (config: ProviderConfig): LLMService["_tag"] => ({
  complete: (request) => Effect.gen(function* () { ... }),
  stream: (request) => Effect.gen(function* () { ... }),        // ← must accept tools
  completeStructured: (request) => Effect.gen(function* () { ... }),
  embed: (texts, model?) => Effect.gen(function* () { ... }),
  countTokens: (messages) => Effect.gen(function* () { ... }),
  getModelConfig: () => Effect.succeed({ provider: "<name>", model: config.model }),
});
```

### Required: Declare ProviderCapabilities

```typescript
// In packages/llm-provider/src/capabilities.ts or provider file:
export const myProviderCapabilities: ProviderCapabilities = {
  supportsNativeFunctionCalling: true,  // or false
  supportsStreaming: true,
  supportsPromptCaching: false,
  supportedTiers: ["t1", "t2", "t3"],
};
```

### Required: Register in createLLMProviderLayer

```typescript
// packages/llm-provider/src/runtime.ts
case "my-provider":
  return createMyProviderLayer(config);
```

## Provider Adapter Hooks

7 hooks that allow strategies to inject provider-specific guidance. All 7 are implemented. Wire them via `selectAdapter(capabilities, tier)`.

| Hook | When it fires | Purpose |
|------|--------------|---------|
| `systemPromptPatch` | Before every LLM call | Provider-specific system prompt additions |
| `toolGuidance` | When tools are available | How to frame tool use for this provider |
| `taskFraming` | Start of task | Provider-specific task framing language |
| `continuationHint` | After tool results | Nudge toward next action |
| `errorRecovery` | On LLM error | Recovery message phrasing |
| `synthesisPrompt` | Pre-final-answer | Synthesis framing |
| `qualityCheck` | Post-output | Output quality validation prompt |

```typescript
// Usage in a phase:
const adapter = selectAdapter(context.capabilities, context.tier);
const patch = adapter.systemPromptPatch?.(state, context) ?? "";
```

## Testing Provider Streaming

```typescript
// tests/providers/<name>.test.ts
// Run: bun test packages/llm-provider/tests/providers/<name>.test.ts --timeout 15000
import { Effect } from "effect";
import { describe, it, expect } from "bun:test";

it("should stream tool calls with correct event sequence", async () => {
  const events: StreamEvent[] = [];

  await Effect.gen(function* () {
    const llm = yield* LLMService;
    const stream = yield* llm.stream({
      messages: [{ role: "user", content: "use the test tool" }],
      tools: [testToolDefinition],
    });
    yield* Stream.runForEach(stream, (event) =>
      Effect.sync(() => events.push(event)),
    );
  }).pipe(Effect.provide(myProviderLayer), Effect.runPromise);

  // Verify event ordering
  const toolUseStart = events.find(e => e.type === "tool_use_start");
  const toolUseDelta = events.find(e => e.type === "tool_use_delta");
  expect(toolUseStart).toBeDefined();
  expect(toolUseDelta).toBeDefined();
  expect(events.at(-1)?.type).toBe("message_stop");
}, 15000);
```
