// Run: bun test packages/llm-provider/tests/gemini-thought-marker.test.ts --timeout 15000
//
// Recorded shape (trace llm-exchange seq 3925, gemini-2.5-flash, stream; also
// reproduced live with RA_GEMINI_DEBUG=1): the FIRST visible text part is a
// plain `kind=text` part (no `thought: true`) whose text starts "thought\n".
// It is model-emitted text, so the adapter strips exactly one leading bare
// `thought` line, on stream and complete, and never touches other answers.

afterAll(() => {
  mock.module("@google/genai", () => realGenaiModule);
});

import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { Effect, Layer, Stream } from "effect";

const realGenaiModule: Record<string, unknown> = {
  ...(await import("@google/genai")),
};

type Part = { text?: string; thought?: boolean; functionCall?: { name: string; args?: Record<string, unknown> } };
let pendingStreamChunks: Array<{ candidates?: Array<{ finishReason?: string; content?: { parts?: Part[] } }> }> = [];
let completeText = "";

mock.module("@google/genai", () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = {
      generateContent: async () => ({
        text: completeText,
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: completeText }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
      }),
      generateContentStream: async () =>
        (async function* () {
          for (const c of pendingStreamChunks) yield c;
        })(),
      embedContent: async () => ({ embeddings: [{ values: [0.1] }] }),
    };
  },
}));

import type { LLMService as LLMServiceType } from "../src/index.js";
import type { Layer as EffectLayer } from "effect";
import type { StreamEvent } from "../src/types.js";
import {
  makeThoughtMarkerStripper,
  stripLeadingThoughtMarker,
} from "../src/providers/gemini-thought-marker.js";

let GeminiProviderLive: EffectLayer.Layer<LLMServiceType>;
let LLMConfig: (typeof import("../src/index.js"))["LLMConfig"];
let LLMService: (typeof import("../src/index.js"))["LLMService"];

beforeAll(async () => {
  const mod = await import("../src/index.js");
  GeminiProviderLive = mod.GeminiProviderLive as EffectLayer.Layer<LLMServiceType>;
  LLMConfig = mod.LLMConfig;
  LLMService = mod.LLMService;
});

const layer = () =>
  GeminiProviderLive.pipe(
    Layer.provide(
      Layer.succeed(
        LLMConfig,
        LLMConfig.of({
          defaultProvider: "gemini",
          defaultModel: "gemini-2.5-flash",
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

const collect = (): Promise<StreamEvent[]> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      const s = yield* llm.stream({ messages: [{ role: "user", content: "go" }], model: "gemini-2.5-flash" });
      return Array.from(yield* Stream.runCollect(s));
    }).pipe(Effect.provide(layer())),
  );

const textOf = (events: StreamEvent[]): string =>
  events.flatMap((e) => (e.type === "text_delta" ? [e.text] : [])).join("");
const completeOf = (events: StreamEvent[]): string => {
  const c = events.find((e) => e.type === "content_complete");
  return c && c.type === "content_complete" ? c.content : "<none>";
};
const chunk = (...parts: Part[]) => ({ candidates: [{ content: { parts } }] });

describe("gemini thought-marker normalization", () => {
  it("stream: strips leading 'thought\\n' from a plain text part, keeps tool call", async () => {
    pendingStreamChunks = [
      chunk({ text: "thought\nThe user wants stats." }),
      chunk({ text: " Start by listing sites." }),
      { candidates: [{ finishReason: "STOP", content: { parts: [{ functionCall: { name: "todo", args: { action: "add" } } }] } }] },
    ];
    const events = await collect();
    expect(textOf(events)).toBe("The user wants stats. Start by listing sites.");
    expect(completeOf(events)).toBe("The user wants stats. Start by listing sites.");
    expect(events.some((e) => e.type === "tool_use_start")).toBe(true);
  });

  it("stream: strips marker split across chunk boundaries", async () => {
    pendingStreamChunks = [chunk({ text: "thou" }), chunk({ text: "ght" }), chunk({ text: "\nHello" }), { candidates: [{ finishReason: "STOP" }] }];
    const events = await collect();
    expect(textOf(events)).toBe("Hello");
    expect(completeOf(events)).toBe("Hello");
  });

  it("stream: leaves answers that merely start with the word untouched", async () => {
    for (const lead of ["thoughtful answer", "Thought: x", "thought process\nfoo", "thought"]) {
      pendingStreamChunks = [chunk({ text: lead }), { candidates: [{ finishReason: "STOP" }] }];
      const events = await collect();
      expect(textOf(events)).toBe(lead);
      expect(completeOf(events)).toBe(lead);
    }
  });

  it("stream: only the very start is stripped, not later 'thought\\n'", async () => {
    pendingStreamChunks = [chunk({ text: "ok " }), chunk({ text: "thought\nmid" }), { candidates: [{ finishReason: "STOP" }] }];
    expect(completeOf(await collect())).toBe("ok thought\nmid");
  });

  it("complete: strips leading 'thought\\n' from response text", async () => {
    completeText = "thought\nThe answer is 4.";
    const res = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({ messages: [{ role: "user", content: "2+2?" }], model: "gemini-2.5-flash" });
      }).pipe(Effect.provide(layer())),
    );
    expect(res.content).toBe("The answer is 4.");
  });

  it("pure helpers: CRLF form, one marker only, flush of held prefix", () => {
    expect(stripLeadingThoughtMarker("thought\r\nx")).toBe("x");
    expect(stripLeadingThoughtMarker("thought\nthought\nx")).toBe("thought\nx");
    const s = makeThoughtMarkerStripper();
    expect(s.push("thou")).toBe("");
    expect(s.flush()).toBe("thou");
  });
});
