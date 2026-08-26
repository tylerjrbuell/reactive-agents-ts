import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { Effect, Layer, Stream } from "effect";

// Bun module mocks are process-global and leak across test FILES. Capture the
// real module and re-install it in afterAll so later files (e.g. runtime
// live-Anthropic tests) hit the real SDK again.
const realAnthropicSdk = { ...(await import("@anthropic-ai/sdk")) };
afterAll(() => {
  mock.module("@anthropic-ai/sdk", () => realAnthropicSdk);
});

// ─── Mock @anthropic-ai/sdk BEFORE the provider module is imported ───
// Pattern mirrors gemini-provider.test.ts. Validates automatic prompt
// caching: a single top-level `cache_control: { type: "ephemeral" }` field
// on the request, replacing the old three hand-placed breakpoints (last
// tool, system text block, last tool_result).

let capturedCreateOpts: Record<string, unknown> | null = null;
let capturedStreamOpts: Record<string, unknown> | null = null;

const mockResponse = {
  id: "msg_test",
  type: "message",
  role: "assistant",
  content: [{ type: "text", text: "ok" }],
  model: "claude-sonnet-4-6",
  stop_reason: "end_turn",
  usage: {
    input_tokens: 10,
    output_tokens: 5,
    cache_creation_input_tokens: 100,
    cache_read_input_tokens: 500,
  },
};

const mockCreate = mock(async (opts: unknown) => {
  capturedCreateOpts = opts as Record<string, unknown>;
  return mockResponse;
});

const mockStream = mock((opts: unknown) => {
  capturedStreamOpts = opts as Record<string, unknown>;
  const obj: { on: (event: string, cb: (m: unknown) => void) => unknown } = {
    on(event, cb) {
      if (event === "finalMessage") setTimeout(() => cb(mockResponse), 0);
      return obj;
    },
  };
  return obj;
});

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mockCreate,
      stream: mockStream,
    };
  },
}));

import type { LLMService as LLMServiceType } from "../src/index.js";
import type { Layer as EffectLayer } from "effect";

let AnthropicProviderLive: EffectLayer.Layer<LLMServiceType>;
let LLMService: typeof import("../src/index.js")["LLMService"];
let LLMConfig: typeof import("../src/index.js")["LLMConfig"];

beforeAll(async () => {
  const mod = await import("../src/index.js");
  AnthropicProviderLive = mod.AnthropicProviderLive;
  LLMService = mod.LLMService;
  LLMConfig = mod.LLMConfig;
});

function makeLayer() {
  const configLayer = Layer.succeed(LLMConfig, {
    provider: "anthropic" as const,
    apiKey: "test-key",
    defaultModel: "claude-sonnet-4-6",
    defaultMaxTokens: 1024,
    defaultTemperature: 0.5,
    pricingRegistry: undefined,
  });
  return Layer.provide(AnthropicProviderLive, configLayer);
}

describe("Anthropic prompt caching (automatic)", () => {
  it("carries a top-level cache_control: { type: 'ephemeral' } field on complete()", async () => {
    capturedCreateOpts = null;
    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        yield* llm.complete({
          messages: [{ role: "user", content: "hi" }],
          systemPrompt: "You are an agent.",
        });
      }).pipe(Effect.provide(makeLayer())),
    );

    expect(capturedCreateOpts).not.toBeNull();
    expect(capturedCreateOpts!.cache_control).toEqual({ type: "ephemeral" });
    // system goes back to a plain string — the array-of-blocks shape was
    // only needed to carry the old per-block cache_control marker.
    expect(capturedCreateOpts!.system).toBe("You are an agent.");
  });

  it("carries a top-level cache_control: { type: 'ephemeral' } field on stream()", async () => {
    capturedStreamOpts = null;
    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const stream = yield* llm.stream({
          messages: [{ role: "user", content: "hi" }],
          systemPrompt: "You are an agent.",
        });
        return yield* Stream.runDrain(stream);
      }).pipe(Effect.provide(makeLayer())),
    );

    expect(capturedStreamOpts).not.toBeNull();
    expect(capturedStreamOpts!.cache_control).toEqual({ type: "ephemeral" });
    expect(capturedStreamOpts!.system).toBe("You are an agent.");
  });

  it("no longer marks individual tools with cache_control (automatic caching supersedes it)", async () => {
    capturedCreateOpts = null;
    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        yield* llm.complete({
          messages: [{ role: "user", content: "use a tool" }],
          systemPrompt: "agent",
          tools: [
            { name: "first", description: "first tool", inputSchema: {} },
            { name: "second", description: "second tool", inputSchema: {} },
            { name: "third", description: "third tool", inputSchema: {} },
          ],
        });
      }).pipe(Effect.provide(makeLayer())),
    );

    const tools = capturedCreateOpts!.tools as Array<{ name: string; cache_control?: unknown }>;
    expect(tools).toHaveLength(3);
    for (const t of tools) {
      expect(t.cache_control).toBeUndefined();
    }
  });

  it("no longer marks tool_result blocks with cache_control (automatic caching supersedes it)", async () => {
    capturedCreateOpts = null;
    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        yield* llm.complete({
          messages: [
            { role: "user", content: "what is X?" },
            { role: "assistant", content: "let me check" },
            { role: "tool", toolCallId: "call_1", content: "X = 42" },
            { role: "assistant", content: "answer is" },
            { role: "tool", toolCallId: "call_2", content: "and here is more" },
            { role: "user", content: "continue" },
          ],
        });
      }).pipe(Effect.provide(makeLayer())),
    );

    const messages = capturedCreateOpts!.messages as Array<{
      role: string;
      content: string | Array<{ type: string; cache_control?: unknown }>;
    }>;

    const toolResultMessages = messages.filter(
      (m) =>
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === "tool_result"),
    );
    expect(toolResultMessages).toHaveLength(2);

    for (const m of toolResultMessages) {
      for (const b of m.content as Array<{ type: string; cache_control?: unknown }>) {
        expect(b.cache_control).toBeUndefined();
      }
    }
  });

  it("surfaces cacheCreationInputTokens + cacheReadInputTokens in usage", async () => {
    capturedCreateOpts = null;
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "hi" }],
          systemPrompt: "agent",
        });
      }).pipe(Effect.provide(makeLayer())),
    );

    expect(result.usage.cacheCreationInputTokens).toBe(100);
    expect(result.usage.cacheReadInputTokens).toBe(500);
  });

  it("carries cache_control even when there is no system prompt or tools", async () => {
    capturedCreateOpts = null;
    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        yield* llm.complete({
          messages: [
            { role: "user", content: "no tools called" },
            { role: "assistant", content: "ok done" },
            { role: "user", content: "continue" },
          ],
        });
      }).pipe(Effect.provide(makeLayer())),
    );

    expect(capturedCreateOpts!.cache_control).toEqual({ type: "ephemeral" });
    const messages = capturedCreateOpts!.messages as Array<{
      role: string;
      content: string | Array<{ type: string; cache_control?: unknown }>;
    }>;
    for (const m of messages) {
      if (Array.isArray(m.content)) {
        for (const b of m.content) {
          expect(b.cache_control).toBeUndefined();
        }
      }
    }
  });
});
