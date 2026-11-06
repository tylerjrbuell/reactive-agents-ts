// Run: bun test packages/llm-provider/tests/tool-choice-wire.test.ts --timeout 15000
//
// Wire pins for `CompletionRequest.toolChoice`: each adapter's REAL request
// body, captured at its SDK / fetch seam, on both complete() and stream().
//   - "required" maps to the provider's forced-call field
//     (Anthropic tool_choice any + no thinking, OpenAI/LiteLLM tool_choice
//     required, Gemini functionCallingConfig ANY, Ollama `format` and no
//     `tools` + the JSON content read back as a tool call).
//   - omitted is byte-identical to "auto" and carries none of those fields.
// Synthetic fixtures only. Every module mock / fetch swap is restored in
// afterAll (bun module mocks are process-global).

import { describe, it, expect, mock, beforeAll, afterAll, beforeEach } from "bun:test";
import { Chunk, Effect, Layer, Stream } from "effect";
import { makeLLMConfig, type LLMConfigValue } from "./helpers/llm-config.js";
import { fetchStub } from "./helpers/fetch-stub.js";

const realAnthropic = { ...(await import("@anthropic-ai/sdk")) };
const realOpenAI = { ...(await import("openai")) };
const realGenAI = { ...(await import("@google/genai")) };
const realOllama = { ...(await import("ollama")) };
const originalFetch = globalThis.fetch;

let bodies: Record<string, unknown>[] = [];
const capture = (body: unknown): void => {
  bodies.push(JSON.parse(JSON.stringify(body)) as Record<string, unknown>);
};

// ─── Anthropic ───
mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: async (body: unknown) => {
        capture(body);
        return {
          content: [{ type: "tool_use", id: "toolu_1", name: "search", input: { query: "x" } }],
          stop_reason: "tool_use",
          usage: { input_tokens: 5, output_tokens: 5 },
          model: "claude-sonnet-4-5",
        };
      },
      stream: (body: unknown) => {
        capture(body);
        const handlers: Record<string, (m: unknown) => void> = {};
        queueMicrotask(() =>
          handlers.finalMessage?.({
            content: [{ type: "text", text: "ok" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 5, output_tokens: 1 },
            model: "claude-sonnet-4-5",
          }),
        );
        return { on: (ev: string, cb: (m: unknown) => void) => { handlers[ev] = cb; } };
      },
    };
  },
}));

// ─── OpenAI ───
async function* openAIChunks() {
  yield { choices: [{ delta: { content: "ok" }, finish_reason: null }] };
  yield { choices: [{ delta: {}, finish_reason: "stop" }] };
  yield { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
}
mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: async (body: { stream?: boolean }) => {
          capture(body);
          if (body.stream) return openAIChunks();
          return {
            choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            model: "gpt-4o",
          };
        },
      },
    };
  },
}));

// ─── Gemini ───
const geminiResponse = {
  candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
};
async function* geminiChunks() {
  yield geminiResponse;
}
mock.module("@google/genai", () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = {
      generateContent: async (opts: unknown) => {
        capture(opts);
        return { ...geminiResponse, text: "ok" };
      },
      generateContentStream: async (opts: unknown) => {
        capture(opts);
        return geminiChunks();
      },
    };
  },
}));

// ─── Ollama ───
let ollamaContent = "";
mock.module("ollama", () => ({
  Ollama: class MockOllama {
    chat = async (body: { stream?: boolean }) => {
      capture(body);
      const done = {
        model: "cogito:14b",
        message: { role: "assistant", content: ollamaContent },
        done: true,
        done_reason: "stop",
        prompt_eval_count: 3,
        eval_count: 4,
      };
      if (!body.stream) return done;
      return {
        abort: () => {},
        async *[Symbol.asyncIterator]() {
          yield done;
        },
      };
    };
    show = async () => ({ capabilities: ["completion", "tools"] });
  },
}));

// ─── LiteLLM (fetch) ───
const sse = (frames: readonly unknown[]): ReadableStream<Uint8Array> => {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(`data: ${JSON.stringify(f)}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
};
const mockFetch = fetchStub(async (url, init) => {
  if (!String(url).startsWith("http://litellm.test")) return new Response("not found", { status: 404 });
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { stream?: boolean }) : {};
  capture(body);
  if (body.stream) {
    return new Response(
      sse([
        { choices: [{ delta: { content: "ok" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
      ]),
      { status: 200 },
    );
  }
  return Response.json({
    choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    model: "openai/gpt-4o-mini",
  });
});

import type { LLMService as LLMServiceType } from "../src/index.js";
import type { CompletionRequest, StreamEvent, ToolDefinition } from "../src/types.js";

let mod: typeof import("../src/index.js");

beforeAll(async () => {
  globalThis.fetch = mockFetch;
  mod = await import("../src/index.js");
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  mock.module("@anthropic-ai/sdk", () => realAnthropic);
  mock.module("openai", () => realOpenAI);
  mock.module("@google/genai", () => realGenAI);
  mock.module("ollama", () => realOllama);
});

beforeEach(() => {
  bodies = [];
  ollamaContent = "";
});

const tools: readonly ToolDefinition[] = [
  {
    name: "search",
    description: "Search the web",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
];
const messages = [{ role: "user" as const, content: "find the weather" }];
const base: CompletionRequest = { messages, tools };

type ProviderName = "anthropic" | "openai" | "gemini" | "litellm" | "ollama";

const layerFor = (provider: ProviderName, overrides: Partial<LLMConfigValue> = {}) => {
  const live = {
    anthropic: mod.AnthropicProviderLive,
    openai: mod.OpenAIProviderLive,
    gemini: mod.GeminiProviderLive,
    litellm: mod.LiteLLMProviderLive,
    ollama: mod.LocalProviderLive,
  }[provider];
  const defaultModel = {
    anthropic: "claude-sonnet-4-5",
    openai: "gpt-4o",
    gemini: "gemini-2.5-flash",
    litellm: "openai/gpt-4o-mini",
    ollama: "cogito:14b",
  }[provider];
  const config = makeLLMConfig({
    defaultProvider: provider,
    defaultModel,
    anthropicApiKey: "test-key",
    openaiApiKey: "test-key",
    googleApiKey: "test-key",
    litellmBaseUrl: "http://litellm.test",
    ollamaEndpoint: "http://ollama.test:11434",
    ...overrides,
  });
  return Layer.provide(live, Layer.succeed(mod.LLMConfig, config));
};

const complete = (provider: ProviderName, request: CompletionRequest, overrides?: Partial<LLMConfigValue>) =>
  Effect.runPromise(
    Effect.flatMap(mod.LLMService, (svc) => svc.complete(request)).pipe(
      Effect.provide(layerFor(provider, overrides)),
    ),
  );

const stream = (provider: ProviderName, request: CompletionRequest, overrides?: Partial<LLMConfigValue>) =>
  Effect.runPromise(
    Effect.flatMap(mod.LLMService, (svc) => svc.stream(request)).pipe(
      Effect.flatMap((s) => Stream.runCollect(s)),
      Effect.map((c): StreamEvent[] => Chunk.toArray(c)),
      Effect.provide(layerFor(provider, overrides)),
    ),
  );

const lastBody = (): Record<string, unknown> => {
  const body = bodies.at(-1);
  expect(body).toBeDefined();
  return body ?? {};
};

/** Body of the omitted and the "auto" request, for the byte-identity pin. */
const omittedAndAuto = async (run: (r: CompletionRequest) => Promise<unknown>) => {
  await run(base);
  const omitted = lastBody();
  await run({ ...base, toolChoice: "auto" });
  const auto = lastBody();
  return { omitted, auto };
};

describe("toolChoice wire: Anthropic", () => {
  for (const path of ["complete", "stream"] as const) {
    const run = (r: CompletionRequest, o?: Partial<LLMConfigValue>) =>
      path === "complete" ? complete("anthropic", r, o) : stream("anthropic", r, o);

    it(`${path}: required sends tool_choice any`, async () => {
      await run({ ...base, toolChoice: "required" });
      expect(lastBody().tool_choice).toEqual({ type: "any" });
    });

    it(`${path}: required drops extended thinking even when config enables it`, async () => {
      await run(base, { thinking: true });
      expect(lastBody().thinking).toBeDefined();
      await run({ ...base, toolChoice: "required" }, { thinking: true });
      expect(lastBody().thinking).toBeUndefined();
      expect(lastBody().tool_choice).toEqual({ type: "any" });
    });

    it(`${path}: omitted is byte-identical to auto and has no tool_choice`, async () => {
      const { omitted, auto } = await omittedAndAuto((r) => run(r));
      expect("tool_choice" in omitted).toBe(false);
      expect(JSON.stringify(auto)).toBe(JSON.stringify(omitted));
    });
  }
});

describe("toolChoice wire: OpenAI and LiteLLM", () => {
  for (const provider of ["openai", "litellm"] as const) {
    for (const path of ["complete", "stream"] as const) {
      const run = (r: CompletionRequest) => (path === "complete" ? complete(provider, r) : stream(provider, r));

      it(`${provider} ${path}: required sends tool_choice "required"`, async () => {
        await run({ ...base, toolChoice: "required" });
        expect(lastBody().tool_choice).toBe("required");
        expect(lastBody().tools).toBeDefined();
      });

      it(`${provider} ${path}: required with no tools sends no tool_choice`, async () => {
        await run({ messages, toolChoice: "required" });
        expect("tool_choice" in lastBody()).toBe(false);
      });

      it(`${provider} ${path}: omitted is byte-identical to auto and has no tool_choice`, async () => {
        const { omitted, auto } = await omittedAndAuto(run);
        expect("tool_choice" in omitted).toBe(false);
        expect(JSON.stringify(auto)).toBe(JSON.stringify(omitted));
      });
    }
  }
});

describe("toolChoice wire: Gemini", () => {
  for (const path of ["complete", "stream"] as const) {
    const run = (r: CompletionRequest) => (path === "complete" ? complete("gemini", r) : stream("gemini", r));
    const configOf = (body: Record<string, unknown>) => body.config as Record<string, unknown>;

    it(`${path}: required sets functionCallingConfig mode ANY`, async () => {
      await run({ ...base, toolChoice: "required" });
      expect(configOf(lastBody()).toolConfig).toEqual({ functionCallingConfig: { mode: "ANY" } });
    });

    it(`${path}: omitted is byte-identical to auto and has no toolConfig`, async () => {
      const { omitted, auto } = await omittedAndAuto(run);
      expect("toolConfig" in configOf(omitted)).toBe(false);
      expect(JSON.stringify(auto)).toBe(JSON.stringify(omitted));
    });
  }
});

describe("toolChoice wire: Ollama (constrained decoding)", () => {
  const forced: CompletionRequest = { ...base, toolChoice: "required" };
  const callJson = '{"tool":"search","arguments":{"query":"weather"}}';

  it("complete: required sends format anyOf and no tools, and returns the JSON as a tool call", async () => {
    ollamaContent = callJson;
    const res = await complete("ollama", forced);
    const body = lastBody();
    expect("tools" in body).toBe(false);
    expect(body.format).toEqual({
      anyOf: [
        {
          type: "object",
          properties: {
            tool: { type: "string", enum: ["search"] },
            arguments: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
          },
          required: ["tool", "arguments"],
        },
      ],
    });
    expect(res.stopReason).toBe("tool_use");
    expect(res.content).toBe("");
    expect(res.toolCalls?.map((tc) => [tc.name, tc.input])).toEqual([["search", { query: "weather" }]]);
  });

  it("complete: unparseable forced output comes back as a plain no-call response", async () => {
    ollamaContent = "I would search for the weather.";
    const res = await complete("ollama", forced);
    expect(res.toolCalls).toBeUndefined();
    expect(res.content).toBe("I would search for the weather.");
    expect(res.stopReason).toBe("end_turn");
  });

  it("stream: required runs non-streamed with format and emits the call as stream events", async () => {
    ollamaContent = callJson;
    const events = await stream("ollama", forced);
    const body = lastBody();
    expect(body.stream).toBe(false);
    expect(body.format).toBeDefined();
    expect("tools" in body).toBe(false);
    const start = events.find((e) => e.type === "tool_use_start");
    const delta = events.find((e) => e.type === "tool_use_delta");
    const done = events.find((e) => e.type === "content_complete");
    expect(start?.type === "tool_use_start" && start.name).toBe("search");
    expect(delta?.type === "tool_use_delta" && JSON.parse(delta.input)).toEqual({ query: "weather" });
    expect(done?.type === "content_complete" && done.stopReason).toBe("tool_use");
    expect(events.some((e) => e.type === "text_delta")).toBe(false);
  });

  for (const path of ["complete", "stream"] as const) {
    it(`${path}: omitted is byte-identical to auto, sends native tools and no format`, async () => {
      ollamaContent = "ok";
      const run = (r: CompletionRequest) => (path === "complete" ? complete("ollama", r) : stream("ollama", r));
      const { omitted, auto } = await omittedAndAuto(run);
      expect(omitted.tools).toBeDefined();
      expect("format" in omitted).toBe(false);
      expect(omitted.stream).toBe(path === "stream");
      expect(JSON.stringify(auto)).toBe(JSON.stringify(omitted));
    });
  }
});
