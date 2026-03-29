import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { NativeFCStrategy } from "../../src/tool-calling/native-fc-strategy.js";
import type { ResolverInput } from "../../src/tool-calling/types.js";

const strategy = new NativeFCStrategy();
const noTools: readonly { name: string }[] = [];

function run<A>(effect: Effect.Effect<A, never>): A {
  return Effect.runSync(effect);
}

describe("NativeFCStrategy", () => {
  it("extracts single tool call from response.toolCalls", () => {
    const input: ResolverInput = {
      toolCalls: [{ id: "tc1", name: "web-search", input: { query: "hello" } }],
    };
    const result = run(strategy.resolve(input, noTools));
    expect(result._tag).toBe("tool_calls");
    if (result._tag === "tool_calls") {
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0].id).toBe("tc1");
      expect(result.calls[0].name).toBe("web-search");
      expect(result.calls[0].arguments).toEqual({ query: "hello" });
    }
  });

  it("extracts multiple tool calls from response", () => {
    const input: ResolverInput = {
      toolCalls: [
        { id: "tc1", name: "tool-a", input: { x: 1 } },
        { id: "tc2", name: "tool-b", input: { y: 2 } },
      ],
    };
    const result = run(strategy.resolve(input, noTools));
    expect(result._tag).toBe("tool_calls");
    if (result._tag === "tool_calls") {
      expect(result.calls).toHaveLength(2);
      expect(result.calls[0].name).toBe("tool-a");
      expect(result.calls[1].name).toBe("tool-b");
    }
  });

  it("returns final_answer when no tool calls and end_turn", () => {
    const input: ResolverInput = {
      content: "The answer is 42.",
      stopReason: "end_turn",
    };
    const result = run(strategy.resolve(input, noTools));
    expect(result._tag).toBe("final_answer");
    if (result._tag === "final_answer") {
      expect(result.content).toBe("The answer is 42.");
    }
  });

  it("returns final_answer when no tool calls and stop", () => {
    const input: ResolverInput = {
      content: "Done here.",
      stopReason: "stop",
    };
    const result = run(strategy.resolve(input, noTools));
    expect(result._tag).toBe("final_answer");
    if (result._tag === "final_answer") {
      expect(result.content).toBe("Done here.");
    }
  });

  it("returns thinking when no tool calls and not end_turn", () => {
    const input: ResolverInput = {
      content: "Let me think about this...",
      stopReason: "max_tokens",
    };
    const result = run(strategy.resolve(input, noTools));
    expect(result._tag).toBe("thinking");
    if (result._tag === "thinking") {
      expect(result.content).toBe("Let me think about this...");
    }
  });

  it("returns thinking when no tool calls and no stopReason", () => {
    const input: ResolverInput = {
      content: "Intermediate thought.",
    };
    const result = run(strategy.resolve(input, noTools));
    expect(result._tag).toBe("thinking");
  });

  it("preserves thinking text alongside tool calls", () => {
    const input: ResolverInput = {
      content: "I will search for that.",
      toolCalls: [{ id: "tc1", name: "web-search", input: { query: "test" } }],
    };
    const result = run(strategy.resolve(input, noTools));
    expect(result._tag).toBe("tool_calls");
    if (result._tag === "tool_calls") {
      expect(result.thinking).toBe("I will search for that.");
    }
  });

  it("handles empty/null input on tool calls gracefully", () => {
    const input: ResolverInput = {
      toolCalls: [{ id: "tc1", name: "my-tool", input: null }],
    };
    const result = run(strategy.resolve(input, noTools));
    expect(result._tag).toBe("tool_calls");
    if (result._tag === "tool_calls") {
      expect(result.calls[0].arguments).toEqual({});
    }
  });

  it("handles undefined content — empty end_turn returns thinking to reprompt", () => {
    // Empty content with end_turn means the model didn't know what to do.
    // Return "thinking" so the kernel reprompts rather than accepting empty output.
    const input: ResolverInput = {
      stopReason: "end_turn",
    };
    const result = run(strategy.resolve(input, noTools));
    expect(result._tag).toBe("thinking");
    if (result._tag === "thinking") {
      expect(result.content).toBe("");
    }
  });

  it("omits thinking field when content is empty string alongside tool calls", () => {
    const input: ResolverInput = {
      content: "",
      toolCalls: [{ id: "tc1", name: "my-tool", input: { k: "v" } }],
    };
    const result = run(strategy.resolve(input, noTools));
    expect(result._tag).toBe("tool_calls");
    if (result._tag === "tool_calls") {
      // empty string is falsy — thinking should be undefined
      expect(result.thinking).toBeUndefined();
    }
  });
});

describe("NativeFCStrategy — text tool call fallback", () => {
  const tools = [{ name: "web-search" }, { name: "file-write" }, { name: "http-get" }];

  it("parses fenced JSON tool call from model text output", () => {
    const input: ResolverInput = {
      content: '```json\n{"name":"web-search","arguments":{"query":"AI trends","maxResults":5}}\n```',
      stopReason: "end_turn",
    };
    const result = run(strategy.resolve(input, tools));
    expect(result._tag).toBe("tool_calls");
    if (result._tag === "tool_calls") {
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0].name).toBe("web-search");
      expect(result.calls[0].arguments).toEqual({ query: "AI trends", maxResults: 5 });
    }
  });

  it("ignores fenced JSON when tool name not in available tools", () => {
    const input: ResolverInput = {
      content: '```json\n{"name":"unknown-tool","arguments":{}}\n```',
      stopReason: "end_turn",
    };
    const result = run(strategy.resolve(input, tools));
    // Should NOT become a tool call — tool not available
    expect(result._tag).toBe("final_answer");
  });

  it("normalizes underscores to hyphens in tool names", () => {
    const input: ResolverInput = {
      content: '```json\n{"name":"web_search","arguments":{"query":"test"}}\n```',
      stopReason: "end_turn",
    };
    const result = run(strategy.resolve(input, tools));
    expect(result._tag).toBe("tool_calls");
    if (result._tag === "tool_calls") {
      expect(result.calls[0].name).toBe("web-search");
    }
  });

  it("handles alternate schema: tool + parameters keys", () => {
    const input: ResolverInput = {
      content: '```json\n{"tool":"file-write","parameters":{"path":"./out.md","content":"hello"}}\n```',
      stopReason: "end_turn",
    };
    const result = run(strategy.resolve(input, tools));
    expect(result._tag).toBe("tool_calls");
    if (result._tag === "tool_calls") {
      expect(result.calls[0].name).toBe("file-write");
      expect((result.calls[0].arguments as any).path).toBe("./out.md");
    }
  });

  it("handles bare JSON without code fence", () => {
    const input: ResolverInput = {
      content: '{"name":"http-get","arguments":{"url":"https://example.com"}}',
      stopReason: "end_turn",
    };
    const result = run(strategy.resolve(input, tools));
    expect(result._tag).toBe("tool_calls");
    if (result._tag === "tool_calls") {
      expect(result.calls[0].name).toBe("http-get");
    }
  });

  it("native toolCalls take priority over text fallback", () => {
    const input: ResolverInput = {
      content: '```json\n{"name":"web-search","arguments":{"query":"ignored"}}\n```',
      toolCalls: [{ id: "tc1", name: "file-write", input: { path: "./real.md", content: "real" } }],
      stopReason: "tool_use",
    };
    const result = run(strategy.resolve(input, tools));
    expect(result._tag).toBe("tool_calls");
    if (result._tag === "tool_calls") {
      // Native FC takes priority — should be file-write not web-search
      expect(result.calls[0].name).toBe("file-write");
    }
  });
});
