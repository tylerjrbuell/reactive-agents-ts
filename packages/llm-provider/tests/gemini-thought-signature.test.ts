// Run: bun test packages/llm-provider/tests/gemini-thought-signature.test.ts --timeout 15000
//
// N2 (2026-11-19 v0.19 QA): Gemini 3-family models return a `thoughtSignature`
// on the first functionCall part of a step and reject a replayed call without
// it (`400 Function call is missing a thought_signature in functionCall parts`)
// when the call sits in the current turn (no user text after it). Reflexion
// improve passes seed history ending in tool results, so they hit it; the
// reactive loop appends guidance text and did not. The provider now remembers
// signatures by tool-call id and replays them; unknown calls get Google's
// documented placeholder.
//
// Seam: module mock on dynamic import("@google/genai"), restored in afterAll.

afterAll(() => {
  mock.module("@google/genai", () => realGenaiModule);
});

import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { Effect, Layer, Stream } from "effect";

const realGenaiModule: Record<string, unknown> = {
  ...(await import("@google/genai")),
};

type MockPart = {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  thoughtSignature?: string;
};
type MockResponse = {
  text: string;
  functionCalls?: Array<{ name: string; args: unknown }>;
  candidates?: Array<{ finishReason?: string; content?: { parts?: MockPart[] } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

let nextResponse: MockResponse = { text: "ok" };
let nextChunks: MockResponse[] = [];
const completeCalls: unknown[] = [];
const streamCalls: unknown[] = [];

mock.module("@google/genai", () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = {
      generateContent: async (opts: unknown) => {
        completeCalls.push(opts);
        return nextResponse;
      },
      generateContentStream: async (opts: unknown) => {
        streamCalls.push(opts);
        const chunks = nextChunks;
        return (async function* () {
          for (const c of chunks) yield c;
        })();
      },
      embedContent: async () => ({ embeddings: [{ values: [0.1] }] }),
    };
  },
}));

import type { LLMService as LLMServiceType, LLMMessage } from "../src/index.js";
import type { Layer as EffectLayer } from "effect";
import type { StreamEvent } from "../src/types.js";
import {
  GEMINI_PLACEHOLDER_SIGNATURE,
  makeThoughtSignatureStore,
} from "../src/providers/gemini-thought-signatures.js";
import { toGeminiContents, type GeminiContent } from "../src/providers/gemini-messages.js";
import type { ContentPolicy } from "../src/content-parts.js";

let GeminiProviderLive: EffectLayer.Layer<LLMServiceType>;
let LLMConfig: (typeof import("../src/index.js"))["LLMConfig"];
let LLMService: (typeof import("../src/index.js"))["LLMService"];

beforeAll(async () => {
  const mod = await import("../src/index.js");
  GeminiProviderLive = mod.GeminiProviderLive as EffectLayer.Layer<LLMServiceType>;
  LLMConfig = mod.LLMConfig;
  LLMService = mod.LLMService;
});

const MODEL = "gemini-3.5-flash";
const TOOLS = [
  { name: "city_population", description: "Population of a city", inputSchema: { type: "object", properties: { city: { type: "string" } } } },
];
const POLICY: ContentPolicy = { imageBlocked: undefined };

const makeLayer = () =>
  GeminiProviderLive.pipe(
    Layer.provide(
      Layer.succeed(
        LLMConfig,
        LLMConfig.of({
          defaultProvider: "gemini",
          defaultModel: MODEL,
          googleApiKey: "test-key",
          embeddingConfig: { model: "gemini-embedding-001", dimensions: 4, provider: "openai", batchSize: 100 },
          supportsPromptCaching: false,
          maxRetries: 0,
          timeoutMs: 30_000,
          defaultMaxTokens: 1024,
          defaultTemperature: 0.7,
        }),
      ),
    ),
  );

const signedCallResponse: MockResponse = {
  text: "",
  functionCalls: [
    { name: "city_population", args: { city: "Tokyo" } },
    { name: "city_population", args: { city: "Paris" } },
  ],
  candidates: [
    {
      finishReason: "STOP",
      content: {
        parts: [
          { functionCall: { name: "city_population", args: { city: "Tokyo" } }, thoughtSignature: "sig-A" },
          { functionCall: { name: "city_population", args: { city: "Paris" } } },
        ],
      },
    },
  ],
  usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
};

/** History that ends in tool results with no user text after them (the reflexion improve-pass shape). */
const replayHistory = (ids: readonly [string, string]): LLMMessage[] => [
  { role: "user", content: "Look up Tokyo and Paris." },
  {
    role: "assistant",
    content: [
      { type: "tool_use", id: ids[0], name: "city_population", input: { city: "Tokyo" } },
      { type: "tool_use", id: ids[1], name: "city_population", input: { city: "Paris" } },
    ],
  },
  { role: "tool", toolCallId: ids[0], toolName: "city_population", content: "3141592" },
  { role: "tool", toolCallId: ids[1], toolName: "city_population", content: "2718281" },
];

const contentsOf = (call: unknown): GeminiContent[] => (call as { contents: GeminiContent[] }).contents;
const modelParts = (contents: GeminiContent[]) => contents.find((c) => c.role === "model")?.parts ?? [];
const sigOf = (part: unknown): string | undefined => (part as { thoughtSignature?: string }).thoughtSignature;

describe("gemini thought signatures — seam (toGeminiContents)", () => {
  it("puts the remembered signature on the matching functionCall part only", () => {
    const { contents } = toGeminiContents(replayHistory(["a", "b"]), POLICY, (id) => (id === "a" ? "sig-a" : undefined));
    const parts = modelParts(contents);
    expect(sigOf(parts[0])).toBe("sig-a");
    expect(sigOf(parts[1])).toBeUndefined();
  });

  it("gives the first call the documented placeholder when no call has a known signature", () => {
    const { contents } = toGeminiContents(replayHistory(["x", "y"]), POLICY);
    const parts = modelParts(contents);
    expect(GEMINI_PLACEHOLDER_SIGNATURE).toBe("skip_thought_signature_validator");
    expect(sigOf(parts[0])).toBe(GEMINI_PLACEHOLDER_SIGNATURE);
    expect(sigOf(parts[1])).toBeUndefined();
  });

  it("leaves model text-only contents and user contents unsigned", () => {
    const { contents } = toGeminiContents(
      [
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ type: "text", text: "hello" }] },
      ],
      POLICY,
    );
    for (const c of contents) for (const p of c.parts) expect(sigOf(p)).toBeUndefined();
  });

  it("store evicts the oldest entry past capacity", () => {
    const store = makeThoughtSignatureStore(2);
    store.remember("1", "s1");
    store.remember("2", "s2");
    store.remember("3", "s3");
    expect(store.lookup("1")).toBeUndefined();
    expect(store.lookup("2")).toBe("s2");
    expect(store.lookup("3")).toBe("s3");
  });
});

describe("gemini thought signatures — provider round trip", () => {
  it("complete(): the signature returned on a call is replayed on the next request", async () => {
    completeCalls.length = 0;
    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        nextResponse = signedCallResponse;
        const first = yield* llm.complete({ messages: [{ role: "user", content: "Look up Tokyo and Paris." }], tools: TOOLS, model: MODEL });
        const ids = (first.toolCalls ?? []).map((tc) => tc.id);
        expect(ids.length).toBe(2);
        nextResponse = { text: "done", usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 } };
        yield* llm.complete({ messages: replayHistory([ids[0]!, ids[1]!]), tools: TOOLS, model: MODEL });
      }).pipe(Effect.provide(makeLayer())),
    );
    const parts = modelParts(contentsOf(completeCalls[1]));
    expect(sigOf(parts[0])).toBe("sig-A");
    expect(sigOf(parts[1])).toBeUndefined();
  });

  it("stream(): the signature on a streamed call is replayed on the next request", async () => {
    streamCalls.length = 0;
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        nextChunks = [{ text: "", candidates: signedCallResponse.candidates, usageMetadata: signedCallResponse.usageMetadata }];
        const s1 = yield* llm.stream({ messages: [{ role: "user", content: "Look up Tokyo and Paris." }], tools: TOOLS, model: MODEL });
        const evs = Array.from(yield* Stream.runCollect(s1));
        const done = evs.find((e): e is Extract<StreamEvent, { type: "content_complete" }> => e.type === "content_complete");
        const ids = (done?.toolCalls ?? []).map((tc) => tc.id);
        expect(ids.length).toBe(2);
        nextChunks = [{ text: "done", usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 } }];
        const s2 = yield* llm.stream({ messages: replayHistory([ids[0]!, ids[1]!]), tools: TOOLS, model: MODEL });
        return Array.from(yield* Stream.runCollect(s2));
      }).pipe(Effect.provide(makeLayer())),
    );
    expect(events.some((e) => e.type === "error")).toBe(false);
    const parts = modelParts(contentsOf(streamCalls[1]));
    expect(sigOf(parts[0])).toBe("sig-A");
    expect(sigOf(parts[1])).toBeUndefined();
  });

  it("reflexion-shape replay with ids this instance never issued carries the placeholder, never a bare call", async () => {
    streamCalls.length = 0;
    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        nextChunks = [{ text: "done", usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 } }];
        const s = yield* llm.stream({ messages: replayHistory(["prior-pass-1", "prior-pass-2"]), tools: TOOLS, model: MODEL });
        yield* Stream.runCollect(s);
      }).pipe(Effect.provide(makeLayer())),
    );
    const parts = modelParts(contentsOf(streamCalls[0]));
    expect(sigOf(parts[0])).toBe(GEMINI_PLACEHOLDER_SIGNATURE);
  });

  it("tool-call ids are unique across responses (signatures are keyed by id)", async () => {
    const ids = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        nextResponse = signedCallResponse;
        const a = yield* llm.complete({ messages: [{ role: "user", content: "a" }], tools: TOOLS, model: MODEL });
        const b = yield* llm.complete({ messages: [{ role: "user", content: "b" }], tools: TOOLS, model: MODEL });
        return [...(a.toolCalls ?? []), ...(b.toolCalls ?? [])].map((tc) => tc.id);
      }).pipe(Effect.provide(makeLayer())),
    );
    expect(new Set(ids).size).toBe(4);
  });
});
