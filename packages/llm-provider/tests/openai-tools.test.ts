// Tests for OpenAI tool calling: message conversion, strict schemas, model detection
import { describe, it, expect } from "bun:test";
import {
  toOpenAIMessages,
  toStrictToolSchema,
  isStrictToolCallingSupported,
  toOpenAITool,
} from "../src/providers/openai.js";
import type { LLMMessage, ToolDefinition } from "../src/types.js";

// ─── toOpenAIMessages ───────────────────────────────────────────────────────

describe("toOpenAIMessages", () => {
  it("converts simple text messages", () => {
    const messages: LLMMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];
    const result = toOpenAIMessages(messages);
    expect(result).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ]);
  });

  it("converts tool result messages with toolCallId", () => {
    const messages: LLMMessage[] = [
      { role: "tool", toolCallId: "call_abc", content: "Result data" },
    ];
    const result = toOpenAIMessages(messages);
    expect(result).toEqual([
      { role: "tool", tool_call_id: "call_abc", content: "Result data" },
    ]);
  });

  it("converts assistant message with tool_use content blocks to tool_calls", () => {
    const messages: LLMMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me search for that." },
          {
            type: "tool_use",
            id: "call_123",
            name: "web-search",
            input: { query: "weather in Paris" },
          },
        ],
      },
    ];
    const result = toOpenAIMessages(messages);
    expect(result).toEqual([
      {
        role: "assistant",
        content: "Let me search for that.",
        tool_calls: [
          {
            id: "call_123",
            type: "function",
            function: {
              name: "web-search",
              arguments: '{"query":"weather in Paris"}',
            },
          },
        ],
      },
    ]);
  });

  it("converts assistant message with multiple tool_use blocks", () => {
    const messages: LLMMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          {
            type: "tool_use",
            id: "call_1",
            name: "file-read",
            input: { path: "/tmp/a.txt" },
          },
          {
            type: "tool_use",
            id: "call_2",
            name: "file-read",
            input: { path: "/tmp/b.txt" },
          },
        ],
      },
    ];
    const result = toOpenAIMessages(messages);
    expect(result[0]).toHaveProperty("tool_calls");
    const msg = result[0] as { role: "assistant"; content: string; tool_calls?: unknown[] };
    expect(msg.tool_calls!.length).toBe(2);
  });

  it("handles assistant message with only text content blocks (no tool_use)", () => {
    const messages: LLMMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Part 1. " },
          { type: "text", text: "Part 2." },
        ],
      },
    ];
    const result = toOpenAIMessages(messages);
    expect(result[0]).toEqual({ role: "assistant", content: "Part 1. Part 2." });
    // Should NOT have tool_calls property
    expect(result[0]).not.toHaveProperty("tool_calls");
  });

  it("serializes tool_use input that is already a string", () => {
    const messages: LLMMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_x",
            name: "raw-tool",
            input: '{"already":"stringified"}',
          },
        ],
      },
    ];
    const result = toOpenAIMessages(messages);
    const msg = result[0] as { role: "assistant"; tool_calls?: Array<{ function: { arguments: string } }> };
    // String input should be passed through as-is
    expect(msg.tool_calls![0].function.arguments).toBe('{"already":"stringified"}');
  });

  it("handles full multi-turn tool use conversation", () => {
    const messages: LLMMessage[] = [
      { role: "user", content: "What's the weather?" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I'll check." },
          { type: "tool_use", id: "call_w", name: "weather", input: { city: "NYC" } },
        ],
      },
      { role: "tool", toolCallId: "call_w", content: '{"temp": 72}' },
      { role: "assistant", content: "It's 72°F in NYC." },
    ];
    const result = toOpenAIMessages(messages);
    expect(result.length).toBe(4);
    expect(result[0]).toEqual({ role: "user", content: "What's the weather?" });
    expect((result[1] as any).tool_calls[0].function.name).toBe("weather");
    expect(result[2]).toEqual({ role: "tool", tool_call_id: "call_w", content: '{"temp": 72}' });
    expect(result[3]).toEqual({ role: "assistant", content: "It's 72°F in NYC." });
  });

  it("extracts text from user content blocks", () => {
    const messages: LLMMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Analyze this: " },
          { type: "text", text: "data here" },
        ],
      },
    ];
    const result = toOpenAIMessages(messages);
    expect(result[0]).toEqual({ role: "user", content: "Analyze this: data here" });
  });
});

// ─── toStrictToolSchema ─────────────────────────────────────────────────────

describe("toStrictToolSchema", () => {
  it("adds additionalProperties: false and requires all properties", () => {
    const schema = {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query", "limit"],
    };
    const result = toStrictToolSchema(schema);
    expect(result.additionalProperties).toBe(false);
    expect(result.required).toEqual(["query", "limit"]);
  });

  it("makes originally-optional properties nullable", () => {
    const schema = {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    };
    const result = toStrictToolSchema(schema);
    // All properties must be required in strict mode
    expect(result.required).toEqual(["query", "limit"]);
    // 'query' stays as-is (was already required)
    expect(result.properties.query.type).toBe("string");
    // 'limit' becomes nullable (was optional)
    expect(result.properties.limit.anyOf).toEqual([
      { type: "number" },
      { type: "null" },
    ]);
    expect(result.properties.limit.type).toBeUndefined();
  });

  it("removes default values", () => {
    const schema = {
      type: "object",
      properties: {
        query: { type: "string", default: "hello" },
      },
      required: ["query"],
    };
    const result = toStrictToolSchema(schema);
    expect(result.properties.query.default).toBeUndefined();
  });

  it("recursively applies to nested objects", () => {
    const schema = {
      type: "object",
      properties: {
        config: {
          type: "object",
          properties: {
            verbose: { type: "boolean" },
          },
          required: ["verbose"],
        },
      },
      required: ["config"],
    };
    const result = toStrictToolSchema(schema);
    expect(result.properties.config.additionalProperties).toBe(false);
    expect(result.properties.config.required).toEqual(["verbose"]);
  });

  it("recursively applies to array items that are objects", () => {
    const schema = {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
            },
            required: ["name"],
          },
        },
      },
      required: ["items"],
    };
    const result = toStrictToolSchema(schema);
    expect(result.properties.items.items.additionalProperties).toBe(false);
  });

  it("does not modify non-object schemas", () => {
    expect(toStrictToolSchema(null)).toBeNull();
    expect(toStrictToolSchema(undefined)).toBeUndefined();
    expect(toStrictToolSchema("string")).toBe("string");
  });

  it("handles schema with no required array (all optional)", () => {
    const schema = {
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "number" },
      },
    };
    const result = toStrictToolSchema(schema);
    expect(result.required).toEqual(["a", "b"]);
    // Both become nullable since neither was originally required
    expect(result.properties.a.anyOf).toBeDefined();
    expect(result.properties.b.anyOf).toBeDefined();
  });

  it("does not double-wrap properties that already have anyOf", () => {
    const schema = {
      type: "object",
      properties: {
        value: { anyOf: [{ type: "string" }, { type: "number" }] },
      },
    };
    const result = toStrictToolSchema(schema);
    // Should not add another anyOf wrapper
    expect(result.properties.value.anyOf).toEqual([
      { type: "string" },
      { type: "number" },
    ]);
  });
});

// ─── isStrictToolCallingSupported ───────────────────────────────────────────

describe("isStrictToolCallingSupported", () => {
  it("returns true for gpt-4o (latest)", () => {
    expect(isStrictToolCallingSupported("gpt-4o")).toBe(true);
  });

  it("returns true for gpt-4o-2024-08-06", () => {
    expect(isStrictToolCallingSupported("gpt-4o-2024-08-06")).toBe(true);
  });

  it("returns false for gpt-4o-2024-05-13 (pre-strict)", () => {
    expect(isStrictToolCallingSupported("gpt-4o-2024-05-13")).toBe(false);
  });

  it("returns true for gpt-4o-mini", () => {
    expect(isStrictToolCallingSupported("gpt-4o-mini")).toBe(true);
  });

  it("returns true for o1, o3, o4 series", () => {
    expect(isStrictToolCallingSupported("o1")).toBe(true);
    expect(isStrictToolCallingSupported("o1-mini")).toBe(true);
    expect(isStrictToolCallingSupported("o3-mini")).toBe(true);
    expect(isStrictToolCallingSupported("o4-mini")).toBe(true);
  });

  it("returns false for gpt-3.5-turbo", () => {
    expect(isStrictToolCallingSupported("gpt-3.5-turbo")).toBe(false);
  });

  it("returns false for gpt-4-turbo", () => {
    expect(isStrictToolCallingSupported("gpt-4-turbo")).toBe(false);
  });
});

// ─── toOpenAITool ──────────────────────────────────────────────────────────

describe("toOpenAITool", () => {
  const tool: ToolDefinition = {
    name: "search",
    description: "Search the web",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
  };

  it("produces correct non-strict format", () => {
    const result = toOpenAITool(tool, false);
    expect(result.type).toBe("function");
    expect(result.function.name).toBe("search");
    expect(result.function.description).toBe("Search the web");
    expect(result.function.parameters).toEqual(tool.inputSchema);
    expect(result.function.strict).toBeUndefined();
  });

  it("produces strict format with additionalProperties: false", () => {
    const result = toOpenAITool(tool, true);
    expect(result.function.strict).toBe(true);
    expect(result.function.parameters.additionalProperties).toBe(false);
    expect(result.function.parameters.required).toEqual(["query"]);
  });

  it("strict mode does not modify original schema", () => {
    const original = JSON.parse(JSON.stringify(tool.inputSchema));
    toOpenAITool(tool, true);
    expect(tool.inputSchema).toEqual(original);
  });
});
