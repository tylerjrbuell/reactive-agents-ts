import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { Effect, Layer } from "effect";

// Bun module mocks are process-global and leak across test FILES. Capture the
// real module and re-install it in afterAll so later files (e.g. runtime
// live-Anthropic tests) hit the real SDK again.
const realAnthropicSdk = { ...(await import("@anthropic-ai/sdk")) };
afterAll(() => {
  mock.module("@anthropic-ai/sdk", () => realAnthropicSdk);
});

// ─── Mock @anthropic-ai/sdk BEFORE the provider module is imported ───
// Pattern mirrors gemini-provider.test.ts. Lever 1 prompt-caching spike —
// validates cache_control markers fire on system + last tool + last
// tool_result so multi-iter Anthropic calls hit the 5-min ephemeral cache.

let capturedCreateOpts: Record<string, unknown> | null = null;

const mockCreate = mock(async (opts: unknown) => {
  capturedCreateOpts = opts as Record<string, unknown>;
  return {
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
});

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mockCreate,
      stream: () => ({ on: () => {} }),
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

describe("Anthropic prompt caching (Lever 1)", () => {
  it("marks system prompt with cache_control on every call", async () => {
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
    const system = capturedCreateOpts!.system;
    expect(Array.isArray(system)).toBe(true);
    const arr = system as Array<{ type: string; cache_control?: { type: string } }>;
    expect(arr).toHaveLength(1);
    expect(arr[0]!.cache_control).toEqual({ type: "ephemeral" });
  });

  it("marks the LAST tool with cache_control (existing behavior preserved)", async () => {
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

    const tools = capturedCreateOpts!.tools as Array<{ name: string; cache_control?: { type: string } }>;
    expect(tools).toHaveLength(3);
    expect(tools[0]!.cache_control).toBeUndefined();
    expect(tools[1]!.cache_control).toBeUndefined();
    expect(tools[2]!.cache_control).toEqual({ type: "ephemeral" });
  });

  it("marks the LAST tool_result message with cache_control on multi-turn input", async () => {
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
      content: string | Array<{ type: string; cache_control?: { type: string } }>;
    }>;

    // Find the two tool_result messages — only the LAST one should carry cache_control.
    const toolResultMessages = messages.filter(
      (m) =>
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === "tool_result"),
    );
    expect(toolResultMessages).toHaveLength(2);

    const firstToolResultBlock = (toolResultMessages[0]!.content as Array<{
      type: string;
      cache_control?: { type: string };
    }>)[0]!;
    expect(firstToolResultBlock.cache_control).toBeUndefined();

    const lastToolResultBlock = (toolResultMessages[1]!.content as Array<{
      type: string;
      cache_control?: { type: string };
    }>)[0]!;
    expect(lastToolResultBlock.cache_control).toEqual({ type: "ephemeral" });
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

  it("omits cache_control on tool_result when no tool_result in messages", async () => {
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

    const messages = capturedCreateOpts!.messages as Array<{
      role: string;
      content: string | Array<{ type: string; cache_control?: { type: string } }>;
    }>;
    // None of the messages are tool_result — none should have cache_control on content blocks.
    for (const m of messages) {
      if (Array.isArray(m.content)) {
        for (const b of m.content) {
          expect(b.cache_control).toBeUndefined();
        }
      }
    }
  });
});
