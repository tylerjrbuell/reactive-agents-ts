---
name: llm-api-contract
description: LLMService API contract — the correct signatures for complete(), stream(), embed(), and response types. Use when calling LLMService from any layer, writing reasoning strategies, or building LLM-dependent features.
user-invocable: false
---

# LLMService API Contract

The most common source of bugs in this codebase is calling `LLMService` incorrectly. This skill defines the exact API contract.

## Service Definition

```typescript
export class LLMService extends Context.Tag("LLMService")<
  LLMService,
  {
    readonly complete: (
      request: CompletionRequest,
    ) => Effect.Effect<CompletionResponse, LLMErrors>;
    readonly stream: (
      request: CompletionRequest,
    ) => Effect.Effect<Stream.Stream<StreamEvent, LLMErrors>, LLMErrors>;
    readonly completeStructured: <A>(
      request: StructuredCompletionRequest<A>,
    ) => Effect.Effect<A, LLMErrors>;
    readonly embed: (
      texts: readonly string[],
      model?: string,
    ) => Effect.Effect<readonly number[][], LLMErrors>;
    readonly countTokens: (
      messages: readonly LLMMessage[],
    ) => Effect.Effect<number, LLMErrors>;
    readonly getModelConfig: () => Effect.Effect<ModelConfig, never>;
  }
>() {}
```

## CompletionRequest — What You Send

```typescript
interface CompletionRequest {
  readonly messages: readonly LLMMessage[]; // REQUIRED — array of messages
  readonly systemPrompt?: string; // Optional system prompt
  readonly maxTokens?: number; // Optional max output tokens
  readonly temperature?: number; // Optional temperature
  readonly model?: ModelConfig; // Optional model override
  readonly tools?: readonly ToolDefinition[]; // Optional tool definitions
  readonly stopSequences?: readonly string[]; // Optional stop sequences
}
```

### CORRECT usage:

```typescript
const response =
  yield *
  llm.complete({
    messages: [{ role: "user", content: "What is quantum computing?" }],
    systemPrompt: "You are a helpful assistant.",
    maxTokens: 300,
    temperature: 0.7,
  });
```

### WRONG — these will NOT compile:

```typescript
// ❌ WRONG: No "prompt" field exists
llm.complete({ prompt: "Hello" });

// ❌ WRONG: No "input" field exists
llm.complete({ input: "Hello" });

// ❌ WRONG: messages must be an array of LLMMessage
llm.complete({ messages: "Hello" });

// ❌ WRONG: Do NOT wrap in Effect.tryPromise — complete() already returns Effect
yield* Effect.tryPromise({ try: () => llm.complete({ ... }), ... });
```

## CompletionResponse — What You Get Back

```typescript
interface CompletionResponse {
  readonly content: string; // ← The text response (NOT .text, NOT .result)
  readonly stopReason: StopReason; // "end_turn" | "max_tokens" | "stop_sequence" | "tool_use"
  readonly usage: TokenUsage; // Token accounting
  readonly model: string; // Model that was used
  readonly toolCalls?: readonly ToolCall[]; // If tools were invoked
}

interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedCost: number; // USD (NOT .cost, use .estimatedCost)
}
```

### CORRECT field access:

```typescript
const response = yield* llm.complete({ messages: [...] });
const text = response.content;                    // ✅ .content
const tokens = response.usage.totalTokens;        // ✅ .usage.totalTokens
const cost = response.usage.estimatedCost;        // ✅ .usage.estimatedCost
const reason = response.stopReason;               // ✅ .stopReason
```

### WRONG field access:

```typescript
// ❌ response.text — does not exist, use .content
// ❌ response.result — does not exist, use .content
// ❌ response.usage.cost — does not exist, use .usage.estimatedCost
// ❌ response.usage.confidence — does not exist
// ❌ response.output — does not exist, use .content
```

## LLMMessage Types

```typescript
type LLMMessage =
  | { readonly role: "system"; readonly content: string }
  | {
      readonly role: "user";
      readonly content: string | readonly ContentBlock[];
    }
  | {
      readonly role: "assistant";
      readonly content: string | readonly ContentBlock[];
    };
```

## Error Handling

`LLMService` methods return `Effect.Effect<T, LLMErrors>` — they already handle errors using Effect. Do NOT wrap calls in `Effect.tryPromise`. Use `Effect.mapError` or `Effect.catchTag` to transform errors:

```typescript
// ✅ CORRECT: pipe with mapError
const result = yield* llm.complete({ messages: [...] }).pipe(
  Effect.mapError((e) => new MyError({ message: `LLM failed: ${e.message}` })),
);

// ✅ CORRECT: catch specific error tags
const result = yield* llm.complete({ messages: [...] }).pipe(
  Effect.catchTag("LLMRateLimitError", (e) =>
    Effect.sleep(e.retryAfterMs).pipe(Effect.flatMap(() => llm.complete({ messages: [...] }))),
  ),
);
```

## Embeddings (Tier 2 Memory Only)

```typescript
// embed() is the SOLE embedding source for the entire framework
// Memory Tier 1 does NOT call embed()
// Memory Tier 2 calls embed() for sqlite-vec KNN search
const vectors = yield * llm.embed(["text to embed", "another text"]);
// Returns: readonly number[][] (one vector per input text)
```

## Prompt Caching (Anthropic)

```typescript
import { makeCacheable } from "@reactive-agents/llm-provider";

// Wrap static content in cacheable blocks for Anthropic prompt caching
const message: LLMMessage = {
  role: "user",
  content: [
    makeCacheable(staticSystemContext), // Cached across requests
    { type: "text", text: dynamicInput },
  ],
};
```

## Model Presets

Available presets: `"claude-haiku"`, `"claude-sonnet"`, `"claude-sonnet-4-5"`, `"claude-opus"`, `"gpt-4o-mini"`, `"gpt-4o"`

```typescript
import { ModelPresets } from "@reactive-agents/llm-provider";
const config = ModelPresets["claude-sonnet"]; // { provider, model, costPer1MInput, ... }
```
