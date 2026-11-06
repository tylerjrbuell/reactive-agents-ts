// Run: bun test packages/llm-provider/tests/tool-choice-seam.test.ts --timeout 15000
//
// Direct-import pins for the `CompletionRequest.toolChoice` mapping seams:
// src/tool-protocol.ts, src/providers/tool-choice.ts, src/providers/ollama-tools.ts.
// Wire-level (adapter request body) pins live in tool-choice-wire.test.ts.

import { describe, it, expect } from "bun:test";
import { Chunk, Effect, Stream } from "effect";
import { isToolCallRequired, type ToolDefinition } from "../src/tool-protocol.js";
import {
  anthropicThinkingPreference,
  anthropicToolChoiceField,
  geminiToolConfigField,
  openAIToolChoiceField,
} from "../src/providers/tool-choice.js";
import {
  completionToStreamEvents,
  ollamaForcedToolFormat,
  ollamaToolRequestFields,
  parseOllamaForcedToolCall,
  toOllamaTools,
  withOllamaForcedToolStream,
} from "../src/providers/ollama-tools.js";
import { buildGenerationConfig } from "../src/providers/gemini.js";
import { TestLLMService } from "../src/testing.js";
import type { CompletionRequest, CompletionResponse, StreamEvent } from "../src/types.js";
import type { LLMService } from "../src/llm-service.js";

const searchTool: ToolDefinition = {
  name: "search",
  description: "Search the web",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
};
const readTool: ToolDefinition = {
  name: "read-file",
  description: "Read a file",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
};
const tools = [searchTool, readTool] as const;

describe("isToolCallRequired", () => {
  it("is true only for required + non-empty tools", () => {
    expect(isToolCallRequired({ toolChoice: "required", tools })).toBe(true);
    expect(isToolCallRequired({ toolChoice: "required", tools: [] })).toBe(false);
    expect(isToolCallRequired({ toolChoice: "required" })).toBe(false);
    expect(isToolCallRequired({ toolChoice: "auto", tools })).toBe(false);
    expect(isToolCallRequired({ tools })).toBe(false);
  });
});

describe("cloud tool-choice fields", () => {
  it("Anthropic: tool_choice any when required, nothing otherwise", () => {
    expect(anthropicToolChoiceField({ toolChoice: "required", tools })).toEqual({
      tool_choice: { type: "any" },
    });
    expect(anthropicToolChoiceField({ tools })).toEqual({});
    expect(anthropicToolChoiceField({ toolChoice: "auto", tools })).toEqual({});
    expect(anthropicToolChoiceField({ toolChoice: "required", tools: [] })).toEqual({});
  });

  it("Anthropic: a forced call turns thinking off; otherwise the request's preference passes through", () => {
    expect(anthropicThinkingPreference({ toolChoice: "required", tools, thinking: true })).toBe(false);
    expect(anthropicThinkingPreference({ toolChoice: "required", tools })).toBe(false);
    expect(anthropicThinkingPreference({ tools, thinking: true })).toBe(true);
    expect(anthropicThinkingPreference({ tools })).toBeUndefined();
  });

  it("OpenAI / LiteLLM: tool_choice required when required, nothing otherwise", () => {
    expect(openAIToolChoiceField({ toolChoice: "required", tools })).toEqual({ tool_choice: "required" });
    expect(openAIToolChoiceField({ tools })).toEqual({});
    expect(openAIToolChoiceField({ toolChoice: "required" })).toEqual({});
  });

  it("Gemini: functionCallingConfig mode ANY when required, nothing otherwise", () => {
    expect(geminiToolConfigField({ toolChoice: "required", tools })).toEqual({
      toolConfig: { functionCallingConfig: { mode: "ANY" } },
    });
    expect(geminiToolConfigField({ tools })).toEqual({});
  });

  it("Gemini buildGenerationConfig: required adds toolConfig; omitted is byte-identical to auto", () => {
    const base = { model: "gemini-2.5-flash", maxTokens: 256, tools };
    const forced = buildGenerationConfig({ ...base, toolChoice: "required" }, undefined, undefined);
    expect(forced.toolConfig).toEqual({ functionCallingConfig: { mode: "ANY" } });
    const omitted = buildGenerationConfig(base, undefined, undefined);
    const auto = buildGenerationConfig({ ...base, toolChoice: "auto" }, undefined, undefined);
    expect("toolConfig" in omitted).toBe(false);
    expect(JSON.stringify(auto)).toBe(JSON.stringify(omitted));
  });
});

describe("Ollama forced-call format", () => {
  it("builds anyOf one branch per tool, pinning the name and the parameters schema", () => {
    const format = ollamaForcedToolFormat(tools);
    expect(format.anyOf).toHaveLength(2);
    expect(format.anyOf[0]).toEqual({
      type: "object",
      properties: {
        tool: { type: "string", enum: ["search"] },
        arguments: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
      required: ["tool", "arguments"],
    });
    expect(format.anyOf[1]?.properties.tool.enum).toEqual(["read-file"]);
  });

  it("request fields: format and no tools when required; native tools exactly as before otherwise", () => {
    const forced = ollamaToolRequestFields({ toolChoice: "required", tools });
    expect("tools" in forced).toBe(false);
    expect(forced).toEqual({ format: ollamaForcedToolFormat(tools) });
    expect(ollamaToolRequestFields({ tools })).toEqual({ tools: toOllamaTools(tools) });
    expect(ollamaToolRequestFields({ toolChoice: "auto", tools })).toEqual({ tools: toOllamaTools(tools) });
    expect(ollamaToolRequestFields({ toolChoice: "required", tools: [] })).toEqual({ tools: undefined });
  });
});

describe("parseOllamaForcedToolCall", () => {
  const forced = { toolChoice: "required" as const, tools };

  it("reads {tool, arguments} JSON as a tool call", () => {
    const call = parseOllamaForcedToolCall(forced, '{"tool":"search","arguments":{"query":"weather"}}');
    expect(call?.name).toBe("search");
    expect(call?.input).toEqual({ query: "weather" });
    expect(call?.id.startsWith("ollama-tc-")).toBe(true);
  });

  it("returns undefined for invalid JSON, unknown tools, or non-object arguments", () => {
    expect(parseOllamaForcedToolCall(forced, "I think I should search")).toBeUndefined();
    expect(parseOllamaForcedToolCall(forced, '{"tool":"search","arguments":')).toBeUndefined();
    expect(parseOllamaForcedToolCall(forced, '{"tool":"delete-all","arguments":{}}')).toBeUndefined();
    expect(parseOllamaForcedToolCall(forced, '{"tool":"search","arguments":"weather"}')).toBeUndefined();
    expect(parseOllamaForcedToolCall(forced, '{"tool":"search","arguments":[1]}')).toBeUndefined();
    expect(parseOllamaForcedToolCall(forced, '"search"')).toBeUndefined();
    expect(parseOllamaForcedToolCall(forced, "")).toBeUndefined();
  });

  it("never parses when the call was not forced", () => {
    const json = '{"tool":"search","arguments":{"query":"x"}}';
    expect(parseOllamaForcedToolCall({ tools }, json)).toBeUndefined();
    expect(parseOllamaForcedToolCall({ toolChoice: "auto", tools }, json)).toBeUndefined();
  });
});

const forcedResponse: CompletionResponse = {
  content: "",
  stopReason: "tool_use",
  usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7, estimatedCost: 0 },
  model: "m",
  toolCalls: [{ id: "c1", name: "search", input: { query: "x" } }],
  resolvedParams: { contextWindow: 8192 },
};

describe("completionToStreamEvents", () => {
  it("emits tool start+delta, content_complete with stopReason, then usage", () => {
    expect(completionToStreamEvents(forcedResponse)).toEqual([
      { type: "tool_use_start", id: "c1", name: "search" },
      { type: "tool_use_delta", input: '{"query":"x"}' },
      { type: "content_complete", content: "", stopReason: "tool_use" },
      { type: "usage", usage: forcedResponse.usage, resolvedParams: { contextWindow: 8192 } },
    ]);
  });

  it("a no-call fallback streams its text and thinking", () => {
    const events = completionToStreamEvents({
      ...forcedResponse,
      content: "plain text",
      thinking: "hmm",
      stopReason: "end_turn",
      toolCalls: undefined,
      resolvedParams: undefined,
    });
    expect(events.map((e) => e.type)).toEqual(["thinking_delta", "text_delta", "content_complete", "usage"]);
    expect(events[2]).toEqual({ type: "content_complete", content: "plain text", thinking: "hmm", stopReason: "end_turn" });
  });
});

describe("withOllamaForcedToolStream", () => {
  const nativeEvent: StreamEvent = { type: "text_delta", text: "native stream" };
  const calls: string[] = [];
  const inner: typeof LLMService.Service = {
    ...TestLLMService([{ text: "unused" }]),
    complete: () => {
      calls.push("complete");
      return Effect.succeed(forcedResponse);
    },
    stream: () => {
      calls.push("stream");
      return Effect.succeed(Stream.make(nativeEvent));
    },
  };
  const wrapped = withOllamaForcedToolStream(inner);
  const collect = (request: CompletionRequest) =>
    Effect.runPromise(
      Effect.flatMap(wrapped.stream(request), (s) => Stream.runCollect(s)).pipe(Effect.map(Chunk.toArray)),
    );
  const messages = [{ role: "user" as const, content: "hi" }];

  it("routes forced calls through complete() and emits its result", async () => {
    calls.length = 0;
    const events = await collect({ messages, tools, toolChoice: "required" });
    expect(calls).toEqual(["complete"]);
    expect(events).toEqual(completionToStreamEvents(forcedResponse));
  });

  it("leaves every other request on the native stream()", async () => {
    calls.length = 0;
    expect(await collect({ messages, tools })).toEqual([nativeEvent]);
    expect(await collect({ messages, tools, toolChoice: "auto" })).toEqual([nativeEvent]);
    expect(await collect({ messages, tools: [], toolChoice: "required" })).toEqual([nativeEvent]);
    expect(calls).toEqual(["stream", "stream", "stream"]);
  });
});

describe("test provider", () => {
  it("accepts toolChoice with no behavior change", async () => {
    const run = (request: CompletionRequest) =>
      Effect.runPromise(TestLLMService([{ text: "scripted answer" }]).complete(request));
    const messages = [{ role: "user" as const, content: "hi" }];
    const forced = await run({ messages, tools, toolChoice: "required" });
    const plain = await run({ messages, tools });
    expect(forced).toEqual(plain);
    expect(forced.content).toBe("scripted answer");
  });
});
