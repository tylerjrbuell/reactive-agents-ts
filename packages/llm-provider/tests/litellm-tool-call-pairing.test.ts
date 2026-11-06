// Run: bun test packages/llm-provider/tests/litellm-tool-call-pairing.test.ts --timeout 15000
//
// LiteLLM wire-thread pairing: every `tool` role message the proxy receives
// must follow an assistant turn whose `tool_calls` carries the same id.
// OpenAI-compatible backends reject an orphan tool message with a 400, so
// LiteLLM must send assistant `tool_calls` exactly like the OpenAI adapter
// (task #50: the mapper used to strip them while still sending tool messages).

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import type { LLMMessage, LLMService as LLMServiceType } from "../src/index.js";
import { fetchStub } from "./helpers/fetch-stub.js";

type WireToolCall = { id: string; type: string; function: { name: string; arguments: string } };
type WireMessage = { role: string; content?: unknown; tool_call_id?: string; tool_calls?: WireToolCall[] };

let lastRequestBody: { messages?: WireMessage[] } | undefined;

const sseStream = (frames: ReadonlyArray<string>): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(`data: ${frame}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
};

const originalFetch = globalThis.fetch;
const mockFetch = fetchStub(async (_url, init) => {
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { stream?: boolean; messages?: WireMessage[] }) : {};
  lastRequestBody = body;
  if (body.stream) {
    return new Response(
      sseStream([
        JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: null }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 1 } }),
      ]),
      { status: 200, statusText: "OK" },
    );
  }
  return new Response(
    JSON.stringify({
      model: "openai/gpt-4o-mini",
      choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 1 },
    }),
    { status: 200, statusText: "OK", headers: { "content-type": "application/json" } },
  );
});

let LiteLLMProviderLive: Layer.Layer<LLMServiceType>;
let LLMConfig: (typeof import("../src/index.js"))["LLMConfig"];
let LLMService: (typeof import("../src/index.js"))["LLMService"];

beforeAll(async () => {
  globalThis.fetch = mockFetch;
  const mod = await import("../src/index.js");
  LiteLLMProviderLive = mod.LiteLLMProviderLive as Layer.Layer<LLMServiceType>;
  LLMConfig = mod.LLMConfig;
  LLMService = mod.LLMService;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  lastRequestBody = undefined;
});

const runWith = <A>(eff: Effect.Effect<A, unknown, LLMServiceType>) =>
  Effect.runPromise(
    eff.pipe(
      Effect.provide(
        LiteLLMProviderLive.pipe(
          Layer.provide(
            Layer.succeed(
              LLMConfig,
              LLMConfig.of({
                defaultProvider: "litellm",
                defaultModel: "openai/gpt-4o-mini",
                embeddingConfig: { model: "text-embedding-3-small", dimensions: 3, provider: "openai" as const, batchSize: 100 },
                supportsPromptCaching: false,
                maxRetries: 1,
                timeoutMs: 30_000,
                defaultMaxTokens: 1024,
                defaultTemperature: 0.7,
              }),
            ),
          ),
        ) as Layer.Layer<LLMServiceType, unknown>,
      ),
    ),
  );

const THREAD: readonly LLMMessage[] = [
  { role: "user", content: "read x then y" },
  {
    role: "assistant",
    content: [
      { type: "text", text: "reading" },
      { type: "tool_use", id: "call_1", name: "file-read", input: { path: "x" } },
      { type: "tool_use", id: "call_2", name: "file-read", input: { path: "y" } },
    ],
  },
  { role: "tool", toolCallId: "call_1", toolName: "file-read", content: "X" },
  { role: "tool", toolCallId: "call_2", toolName: "file-read", content: "Y" },
];

const TOOLS = [
  { name: "file-read", description: "read a file", inputSchema: { type: "object", properties: { path: { type: "string" } } } },
];

/** Every tool message pairs with a `tool_calls` id on the nearest preceding assistant turn. */
const expectPairedThread = (messages: WireMessage[] | undefined) => {
  expect(messages).toBeDefined();
  const wire = messages ?? [];
  const assistant = wire.find((m) => m.role === "assistant");
  expect(assistant?.tool_calls).toEqual([
    { id: "call_1", type: "function", function: { name: "file-read", arguments: '{"path":"x"}' } },
    { id: "call_2", type: "function", function: { name: "file-read", arguments: '{"path":"y"}' } },
  ]);
  const toolMsgs = wire.filter((m) => m.role === "tool");
  expect(toolMsgs.map((m) => m.tool_call_id)).toEqual(["call_1", "call_2"]);
  for (const [i, m] of wire.entries()) {
    if (m.role !== "tool") continue;
    const owner = wire.slice(0, i).reverse().find((p) => p.role === "assistant");
    expect(owner?.tool_calls?.map((c) => c.id)).toContain(m.tool_call_id);
  }
};

describe("LiteLLM request body pairs tool messages with assistant tool_calls", () => {
  it("complete() sends assistant tool_calls for each tool message", async () => {
    await runWith(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({ messages: THREAD, model: "openai/gpt-4o-mini", tools: TOOLS });
      }),
    );
    expectPairedThread(lastRequestBody?.messages);
  });

  it("stream() sends assistant tool_calls for each tool message", async () => {
    await runWith(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const s = yield* llm.stream({ messages: THREAD, model: "openai/gpt-4o-mini", tools: TOOLS });
        return yield* Stream.runCollect(s);
      }),
    );
    expectPairedThread(lastRequestBody?.messages);
  });
});
