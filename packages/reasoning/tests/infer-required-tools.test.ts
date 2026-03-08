import { Effect, Layer } from "effect";
import { describe, it, expect } from "bun:test";
import { LLMService } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { inferRequiredTools } from "../src/structured-output/infer-required-tools.js";
import type { ToolSummary } from "../src/structured-output/infer-required-tools.js";

// ── Mock LLM that returns structured JSON ──

const makeMockLLM = (response: string) =>
  Layer.succeed(LLMService, {
    complete: () =>
      Effect.succeed({
        content: response,
        tokensUsed: 50,
        cost: 0.001,
        model: "test-model",
        finishReason: "stop" as const,
      }),
    stream: () => Effect.die("not implemented"),
    embed: () => Effect.die("not implemented"),
    getStructuredOutputCapabilities: () =>
      Effect.succeed({ nativeJsonMode: false, nativeToolMode: false }),
    completeStructured: () => Effect.die("not implemented"),
  } as any);

const mockEventBus = EventBusLive;

// ── Test tools ──

const sampleTools: ToolSummary[] = [
  {
    name: "web_search",
    description: "Search the web for information",
    parameters: [
      { name: "query", type: "string", description: "Search query", required: true },
    ],
  },
  {
    name: "file_write",
    description: "Write content to a file",
    parameters: [
      { name: "path", type: "string", description: "File path", required: true },
      { name: "content", type: "string", description: "File content", required: true },
    ],
  },
  {
    name: "send_message",
    description: "Send a message to a user",
    parameters: [
      { name: "recipient", type: "string", description: "Recipient ID", required: true },
      { name: "message", type: "string", description: "Message text", required: true },
    ],
  },
];

describe("inferRequiredTools", () => {
  it("should return empty array when no tools are available", async () => {
    const layer = makeMockLLM("{}").pipe(Layer.provideMerge(mockEventBus));

    const result = await inferRequiredTools({
      taskDescription: "Say hello",
      availableTools: [],
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(result).toEqual([]);
  });

  it("should return inferred tool names from LLM response", async () => {
    const llmResponse = JSON.stringify({
      requiredTools: [
        { name: "web_search", reason: "Task asks to search for information" },
        { name: "send_message", reason: "Task asks to send the result" },
      ],
      reasoning: "The task requires searching and then sending the result.",
    });

    const layer = makeMockLLM(llmResponse).pipe(Layer.provideMerge(mockEventBus));

    const result = await inferRequiredTools({
      taskDescription: "Search for the latest news and send it to Alice",
      availableTools: sampleTools,
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(result).toEqual(["web_search", "send_message"]);
  });

  it("should filter out hallucinated tool names not in available tools", async () => {
    const llmResponse = JSON.stringify({
      requiredTools: [
        { name: "web_search", reason: "Needed for search" },
        { name: "nonexistent_tool", reason: "This tool doesn't exist" },
      ],
      reasoning: "Filtering test",
    });

    const layer = makeMockLLM(llmResponse).pipe(Layer.provideMerge(mockEventBus));

    const result = await inferRequiredTools({
      taskDescription: "Search the web",
      availableTools: sampleTools,
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(result).toEqual(["web_search"]);
    expect(result).not.toContain("nonexistent_tool");
  });

  it("should return empty array when LLM returns no required tools", async () => {
    const llmResponse = JSON.stringify({
      requiredTools: [],
      reasoning: "This is a conversational task that doesn't require any tools.",
    });

    const layer = makeMockLLM(llmResponse).pipe(Layer.provideMerge(mockEventBus));

    const result = await inferRequiredTools({
      taskDescription: "What is the meaning of life?",
      availableTools: sampleTools,
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(result).toEqual([]);
  });

  it("should gracefully handle LLM returning malformed JSON by returning empty array", async () => {
    const layer = makeMockLLM("this is not valid json").pipe(Layer.provideMerge(mockEventBus));

    const result = await inferRequiredTools({
      taskDescription: "Do something",
      availableTools: sampleTools,
    }).pipe(
      Effect.catchAll(() => Effect.succeed([] as readonly string[])),
      Effect.provide(layer),
      Effect.runPromise,
    );

    expect(Array.isArray(result)).toBe(true);
  });

  it("should accept optional system prompt without error", async () => {
    const llmResponse = JSON.stringify({
      requiredTools: [{ name: "file_write", reason: "Agent writes reports" }],
      reasoning: "System prompt indicates this agent produces file outputs.",
    });

    const layer = makeMockLLM(llmResponse).pipe(Layer.provideMerge(mockEventBus));

    const result = await inferRequiredTools({
      taskDescription: "Produce a report",
      availableTools: sampleTools,
      systemPrompt: "You are a report generation agent that outputs to files.",
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(result).toContain("file_write");
    expect(result.length).toBe(1);
  });
});
