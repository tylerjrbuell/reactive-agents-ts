// Run: bun test packages/reasoning/tests/structured-output/classify-tool-relevance.test.ts --timeout 15000
import { Effect, Layer } from "effect";
import { describe, it, expect } from "bun:test";
import { LLMService } from "@reactive-agents/llm-provider";
import { EventBusLive } from "@reactive-agents/core";
import { classifyToolRelevance } from "../../src/structured-output/infer-required-tools.js";
import type { ToolSummary } from "../../src/structured-output/infer-required-tools.js";

const makeMockLLM = (response: string) =>
  Layer.succeed(LLMService, {
    complete: () =>
      Effect.succeed({
        content: response,
        tokensUsed: 50,
        cost: 0,
        model: "test-model",
        finishReason: "stop" as const,
      }),
    stream: () => Effect.die("not implemented"),
    embed: () => Effect.die("not implemented"),
    getStructuredOutputCapabilities: () =>
      Effect.succeed({ nativeJsonMode: false, nativeToolMode: false }),
    completeStructured: () => Effect.die("not implemented"),
  } as any);

const tools: ToolSummary[] = [
  { name: "http-get", description: "HTTP GET request", parameters: [] },
  { name: "web-search", description: "Search the web", parameters: [] },
  { name: "file-write", description: "Write a file", parameters: [] },
  { name: "recall", description: "Working memory", parameters: [] },
];

const layer = (response: string) =>
  makeMockLLM(response).pipe(Layer.provideMerge(EventBusLive));

describe("classifyToolRelevance — requiredToolQuantities", () => {
  it("returns minCalls=1 by default when classifier omits the field", async () => {
    const json = JSON.stringify({
      required: [{ name: "web-search", minCalls: 1 }],
      relevant: ["recall"],
    });
    const result = await classifyToolRelevance({
      taskDescription: "Search for something",
      availableTools: tools,
    }).pipe(Effect.provide(layer(json)), Effect.runPromise);

    expect(result.requiredToolQuantities).toEqual({ "web-search": 1 });
  });

  it("captures minCalls > 1 when classifier specifies multiple required calls", async () => {
    const json = JSON.stringify({
      required: [
        { name: "http-get", minCalls: 4 },
      ],
      relevant: ["recall"],
    });
    const result = await classifyToolRelevance({
      taskDescription: "Fetch prices for XRP, XLM, ETH, BTC",
      availableTools: tools,
    }).pipe(Effect.provide(layer(json)), Effect.runPromise);

    expect(result.requiredToolQuantities).toEqual({ "http-get": 4 });
  });

  it("supports multiple required tools each with their own minCalls", async () => {
    const json = JSON.stringify({
      required: [
        { name: "web-search", minCalls: 3 },
        { name: "file-write", minCalls: 1 },
      ],
      relevant: ["recall"],
    });
    const result = await classifyToolRelevance({
      taskDescription: "Search 3 topics then write a report",
      availableTools: tools,
    }).pipe(Effect.provide(layer(json)), Effect.runPromise);

    expect(result.requiredToolQuantities).toEqual({ "web-search": 3, "file-write": 1 });
    expect(result.required).toEqual(["web-search", "file-write"]);
  });

  it("falls back gracefully when LLM returns old string-array format", async () => {
    // Old classifier format — should not crash, should treat minCalls as 1
    const json = JSON.stringify({
      required: ["http-get"],
      relevant: ["recall"],
    });
    const result = await classifyToolRelevance({
      taskDescription: "Fetch something",
      availableTools: tools,
    }).pipe(Effect.provide(layer(json)), Effect.runPromise);

    expect(result.required).toContain("http-get");
    expect(result.requiredToolQuantities["http-get"]).toBeGreaterThanOrEqual(1);
  });
});
