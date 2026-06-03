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

// A BATCH tool: one call with an array input returns N items. crypto-price is the
// real-world case — `coins: array, required`. Its required-call floor must be 1
// regardless of how many entities the task names or what the LLM estimates.
const batchTool: ToolSummary = {
  name: "crypto-price",
  description: "Get prices. Pass ALL coins in ONE call.",
  parameters: [
    { name: "coins", type: "array", description: "symbols to fetch in one call", required: true },
    { name: "currency", type: "string", description: "quote currency", required: false },
  ],
};
const declaredBatchTool: ToolSummary = {
  name: "bulk-fetch",
  description: "Fetch many in one call",
  parameters: [{ name: "ids", type: "array", description: "ids", required: true }],
  cardinality: "batch",
};
const toolsWithBatch: ToolSummary[] = [...tools, batchTool, declaredBatchTool];

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

  it("applies entity-count floor for lookup tools when classifier underestimates minCalls", async () => {
    const json = JSON.stringify({
      required: [
        { name: "web-search", minCalls: 1 },
      ],
      relevant: ["recall"],
    });
    const result = await classifyToolRelevance({
      taskDescription:
        "Fetch the current USD price for: XRP, XLM, ETH, Bitcoin. Then render a markdown table.",
      availableTools: tools,
    }).pipe(Effect.provide(layer(json)), Effect.runPromise);

    expect(result.requiredToolQuantities).toEqual({ "web-search": 4 });
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

  // ── Batch-tool floor (crypto-price ×4 bug) ──────────────────────────────────
  // Regression: gemma4:e4b classified `crypto-price` with minCalls=4 ("4 coins →
  // 4 calls"). The model correctly batched all 4 into ONE call and succeeded, but
  // the required-tool floor (4) was never met → endless "still must call
  // crypto-price" nudge → max_iterations → success:false despite the file being
  // written. A tool whose required input is an ARRAY is batch by construction:
  // one call covers all entities, so its floor is 1.
  it("clamps an array-input (batch) tool's floor to 1 even when the LLM says minCalls=4", async () => {
    const json = JSON.stringify({
      required: [{ name: "crypto-price", minCalls: 4 }, { name: "file-write", minCalls: 1 }],
      relevant: [],
    });
    const result = await classifyToolRelevance({
      taskDescription: "Find the price of XRP, BTC, XLM and BONK and write to crypto.md",
      availableTools: toolsWithBatch,
    }).pipe(Effect.provide(layer(json)), Effect.runPromise);

    expect(result.requiredToolQuantities["crypto-price"]).toBe(1);
    expect(result.requiredToolQuantities["file-write"]).toBe(1);
  });

  it("does NOT apply the entity-count floor to an array-input (batch) tool", async () => {
    const json = JSON.stringify({
      required: [{ name: "crypto-price", minCalls: 1 }],
      relevant: [],
    });
    const result = await classifyToolRelevance({
      taskDescription: "Fetch the USD price for: XRP, XLM, ETH, Bitcoin. Then render a table.",
      availableTools: toolsWithBatch,
    }).pipe(Effect.provide(layer(json)), Effect.runPromise);

    expect(result.requiredToolQuantities["crypto-price"]).toBe(1);
  });

  it("clamps an explicitly cardinality:batch tool to 1 even when the LLM over-counts", async () => {
    const json = JSON.stringify({
      required: [{ name: "bulk-fetch", minCalls: 5 }],
      relevant: [],
    });
    const result = await classifyToolRelevance({
      taskDescription: "Fetch ids a, b, c, d, e",
      availableTools: toolsWithBatch,
    }).pipe(Effect.provide(layer(json)), Effect.runPromise);

    expect(result.requiredToolQuantities["bulk-fetch"]).toBe(1);
  });

  it("does NOT clamp a non-array tool — http-get minCalls=4 stays 4 (no over-correction)", async () => {
    const json = JSON.stringify({
      required: [{ name: "http-get", minCalls: 4 }],
      relevant: [],
    });
    const result = await classifyToolRelevance({
      taskDescription: "Fetch prices for XRP, XLM, ETH, BTC",
      availableTools: toolsWithBatch,
    }).pipe(Effect.provide(layer(json)), Effect.runPromise);

    expect(result.requiredToolQuantities["http-get"]).toBe(4);
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
