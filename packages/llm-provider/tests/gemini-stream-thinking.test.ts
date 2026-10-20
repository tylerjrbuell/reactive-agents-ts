// Run: bun test packages/llm-provider/tests/gemini-stream-thinking.test.ts --timeout 15000
//
// GH #238 — gemini streaming drops `thought: true` parts silently. Route them
// through the SAME `thinking_delta` StreamEvent the local (Ollama) + anthropic
// providers emit, gated on MODEL CAPABILITY (supportsThinkingMode), not
// consent — Gemini's `thinkingBudget: 0` is advisory and gemini-2.5-class
// models can emit thought parts even when thinking was never opted in, so a
// consent gate would keep silently swallowing real reasoning.
//
// Test substrate: module-mock seam on dynamic import("@google/genai")
// (packages/llm-provider's established gemini seam — mock.module is
// process-global, so the real SDK namespace is restored in afterAll).

afterAll(() => {
  mock.module("@google/genai", () => realGenaiModule);
});

import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { Effect, Layer, Stream } from "effect";

// Capture the real module namespace BEFORE any mock registration so the
// afterAll restore puts the package back exactly as it was.
const realGenaiModule: Record<string, unknown> = {
  ...(await import("@google/genai")),
};

// Chunks the fake generateContentStream iterates. Reset per test.
let pendingStreamChunks: GeminiMockChunk[] = [];

type GeminiMockChunk = {
  text?: string;
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{
        text?: string;
        thought?: boolean;
        functionCall?: { name: string; args?: Record<string, unknown> };
      }>;
    };
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
};

const mockGenerateContentStream = mock(async (_opts: unknown) => {
  return (async function* () {
    for (const chunk of pendingStreamChunks) {
      yield chunk;
    }
  })();
});

mock.module("@google/genai", () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = {
      generateContent: async () => ({
        text: "",
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
      }),
      generateContentStream: mockGenerateContentStream,
      embedContent: async () => ({ embeddings: [{ values: [0.1, 0.2] }] }),
    };
  },
}));

// ─── Types ───
import type { LLMService as LLMServiceType } from "../src/index.js";
import type { Layer as EffectLayer } from "effect";
import type { StreamEvent } from "../src/types.js";

let GeminiProviderLive: EffectLayer.Layer<LLMServiceType>;
let LLMConfig: (typeof import("../src/index.js"))["LLMConfig"];
let LLMService: (typeof import("../src/index.js"))["LLMService"];

beforeAll(async () => {
  const mod = await import("../src/index.js");
  GeminiProviderLive = mod.GeminiProviderLive as EffectLayer.Layer<LLMServiceType>;
  LLMConfig = mod.LLMConfig;
  LLMService = mod.LLMService;
});

const makeLayer = (model: string, thinking?: boolean) =>
  GeminiProviderLive.pipe(
    Layer.provide(
      Layer.succeed(
        LLMConfig,
        LLMConfig.of({
          defaultProvider: "gemini",
          defaultModel: model,
          googleApiKey: "test-key",
          embeddingConfig: {
            model: "gemini-embedding-001",
            dimensions: 4,
            provider: "openai",
            batchSize: 100,
          },
          supportsPromptCaching: false,
          maxRetries: 0,
          timeoutMs: 30_000,
          defaultMaxTokens: 1024,
          defaultTemperature: 0.7,
          ...(thinking === undefined ? {} : { thinking }),
        }),
      ),
    ),
  );

const collect = (model: string, thinking?: boolean): Promise<StreamEvent[]> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      const stream = yield* llm.stream({
        messages: [{ role: "user", content: "2+2?" }],
        model,
      });
      return Array.from(yield* Stream.runCollect(stream));
    }).pipe(Effect.provide(makeLayer(model, thinking))),
  );

describe("gemini stream — thinking_delta routing (GH #238)", () => {
  it("emits thinking_delta events + content_complete.thinking for thought parts on a thinking-capable model", async () => {
    pendingStreamChunks = [
      {
        candidates: [
          {
            content: {
              parts: [{ text: "Let me work through this. ", thought: true }],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 6 },
      },
      {
        candidates: [
          { content: { parts: [{ text: "The answer is 4." }] } },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 12 },
      },
      {
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 40,
          totalTokenCount: 50,
        },
      },
    ];

    const events = await collect("gemini-2.5-flash", true);

    const thinkingDeltas = events.filter((e) => e.type === "thinking_delta");
    expect(thinkingDeltas.length).toBe(1);
    if (thinkingDeltas[0]?.type !== "thinking_delta") throw new Error("expected thinking_delta");
    expect(thinkingDeltas[0].thinking).toBe("Let me work through this. ");

    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas.length).toBe(1);
    if (textDeltas[0]?.type !== "text_delta") throw new Error("expected text_delta");
    expect(textDeltas[0].text).toBe("The answer is 4.");

    const complete = events.find((e) => e.type === "content_complete");
    if (complete?.type !== "content_complete") throw new Error("expected content_complete");
    expect(complete.content).toBe("The answer is 4.");
    expect(complete.thinking).toBe("Let me work through this. ");
  }, 15000);

  it("still emits thinking_delta when thinking is NOT opted in (budget 0 is advisory — capability gate, not consent)", async () => {
    pendingStreamChunks = [
      {
        candidates: [
          {
            content: {
              parts: [{ text: "Hidden reasoning the model emitted anyway. ", thought: true }],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 6 },
      },
      {
        candidates: [
          { content: { parts: [{ text: "The answer is 4." }] } },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 12 },
      },
      {
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 40,
          totalTokenCount: 50,
        },
      },
    ];

    const events = await collect("gemini-2.5-flash", undefined);

    const thinkingDeltas = events.filter((e) => e.type === "thinking_delta");
    expect(thinkingDeltas.length).toBe(1);
    if (thinkingDeltas[0]?.type !== "thinking_delta") throw new Error("expected thinking_delta");
    expect(thinkingDeltas[0].thinking).toBe(
      "Hidden reasoning the model emitted anyway. ",
    );

    const complete = events.find((e) => e.type === "content_complete");
    if (complete?.type !== "content_complete") throw new Error("expected content_complete");
    expect(complete.thinking).toBe("Hidden reasoning the model emitted anyway. ");
  }, 15000);

  it("emits ZERO thinking_delta on a non-thinking-capable model AND suppresses the thought part from content", async () => {
    pendingStreamChunks = [
      {
        candidates: [
          {
            content: {
              parts: [{ text: "should never surface ", thought: true }],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 6 },
      },
      {
        candidates: [
          { content: { parts: [{ text: "visible." }] } },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 12 },
      },
      {
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 40,
          totalTokenCount: 50,
        },
      },
    ];

    const events = await collect("gemini-2.5-flash-lite", true);

    expect(events.filter((e) => e.type === "thinking_delta").length).toBe(0);
    const complete = events.find((e) => e.type === "content_complete");
    if (complete?.type !== "content_complete") throw new Error("expected content_complete");
    expect(complete.content).toBe("visible.");
    expect((complete as { thinking?: string }).thinking).toBeUndefined();
  }, 15000);

  it("mixed thought + functionCall chunk still yields text + tool-call events (regression guard on the shared parts loop)", async () => {
    pendingStreamChunks = [
      {
        candidates: [
          {
            content: {
              parts: [
                { text: "Locate the file first... ", thought: true },
                { functionCall: { name: "file_read", args: { path: "a.ts" } } },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 6 },
      },
      {
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 40,
          totalTokenCount: 50,
        },
      },
    ];

    const events = await collect("gemini-2.5-flash", undefined);

    const thinkingDeltas = events.filter((e) => e.type === "thinking_delta");
    expect(thinkingDeltas.length).toBe(1);
    if (thinkingDeltas[0]?.type !== "thinking_delta") throw new Error("expected thinking_delta");
    expect(thinkingDeltas[0].thinking).toBe("Locate the file first... ");

    const complete = events.find((e) => e.type === "content_complete");
    if (complete?.type !== "content_complete") throw new Error("expected content_complete");
    expect((complete as { thinking?: string }).thinking).toBe("Locate the file first... ");
    expect((complete as { stopReason?: string }).stopReason).toBe("tool_use");
  }, 15000);
});
