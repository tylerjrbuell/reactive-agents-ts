import { describe, it, expect } from "bun:test";
import {
  parseToolRequest,
  parseAllToolRequests,
  hasFinalAnswer,
  extractFinalAnswer,
  evaluateTransform,
  formatToolSchemas,
} from "../../../src/strategies/shared/tool-utils.js";

describe("parseToolRequest", () => {
  it("parses simple tool request with JSON args", () => {
    const thought = `I'll write the file.\nACTION: file-write({"path": "./out.txt", "content": "hello"})`;
    const result = parseToolRequest(thought);
    expect(result).not.toBeNull();
    expect(result?.tool).toBe("file-write");
    expect(result?.input).toBe('{"path": "./out.txt", "content": "hello"}');
  });

  it("parses namespaced MCP tool names (github/list_commits)", () => {
    const thought = `ACTION: github/list_commits({"owner": "tylerjrbuell", "repo": "test"})`;
    const result = parseToolRequest(thought);
    expect(result?.tool).toBe("github/list_commits");
  });

  it("returns null when no ACTION present", () => {
    expect(parseToolRequest("Just a thought with no action.")).toBeNull();
  });

  it("extracts | transform: expression after args", () => {
    const thought = `ACTION: web-search({"query": "Effect TS"}) | transform: result.results[0].content`;
    const result = parseToolRequest(thought);
    expect(result?.transform).toBe("result.results[0].content");
  });

  it("handles no-arg tools with empty parens", () => {
    const thought = `ACTION: list_allowed_directories()`;
    const result = parseToolRequest(thought);
    expect(result?.tool).toBe("list_allowed_directories");
    expect(result?.input).toBe("{}");
  });
});

describe("parseAllToolRequests", () => {
  it("returns all ACTION requests in order", () => {
    const thought = `Step 1: ACTION: file-read({"path": "./a.txt"})\nStep 2: ACTION: file-write({"path": "./b.txt", "content": "x"})`;
    const results = parseAllToolRequests(thought);
    expect(results).toHaveLength(2);
    expect(results[0]?.tool).toBe("file-read");
    expect(results[1]?.tool).toBe("file-write");
  });

  it("returns empty array when no actions present", () => {
    expect(parseAllToolRequests("No tools here.")).toHaveLength(0);
  });

  it("handles transform in first action, plain in second", () => {
    const thought = `ACTION: web-search({"query": "test"}) | transform: result[0]\nACTION: file-write({"path": "./x"})`;
    const results = parseAllToolRequests(thought);
    expect(results[0]?.transform).toBe("result[0]");
    expect(results[1]?.transform).toBeUndefined();
  });
});

describe("hasFinalAnswer", () => {
  it("returns true for FINAL ANSWER: prefix", () => {
    expect(hasFinalAnswer("FINAL ANSWER: The answer is 42")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(hasFinalAnswer("Final Answer: done")).toBe(true);
  });

  it("returns false when absent", () => {
    expect(hasFinalAnswer("I'm still thinking...")).toBe(false);
  });
});

describe("extractFinalAnswer", () => {
  it("extracts text after FINAL ANSWER:", () => {
    const result = extractFinalAnswer("FINAL ANSWER: The water cycle has 3 stages.");
    expect(result).toBe("The water cycle has 3 stages.");
  });

  it("handles multiline answers", () => {
    const result = extractFinalAnswer("FINAL ANSWER: Step 1: do A\nStep 2: do B");
    expect(result).toBe("Step 1: do A\nStep 2: do B");
  });

  it("returns full text when no FINAL ANSWER: marker", () => {
    const text = "Just a response without the marker";
    expect(extractFinalAnswer(text)).toBe(text);
  });
});

describe("evaluateTransform", () => {
  it("evaluates a simple property access", () => {
    const result = evaluateTransform("result.title", { title: "Hello World" });
    expect(result).toBe("Hello World");
  });

  it("returns error string on invalid expression", () => {
    const result = evaluateTransform("result.x.y.z.undefined.property", null);
    expect(result).toContain("[Transform error:");
  });
});

describe("formatToolSchemas", () => {
  const schemas = [
    {
      name: "file-write",
      description: "Write content to a file",
      parameters: [
        { name: "path", type: "string", description: "File path", required: true },
        { name: "content", type: "string", description: "Content", required: true },
      ],
    },
  ];

  it("formats compact schema by default", () => {
    const result = formatToolSchemas(schemas);
    expect(result).toContain("file-write");
    expect(result).toContain("path");
  });

  it("formats verbose schema with parameter details", () => {
    const result = formatToolSchemas(schemas, true);
    expect(result).toContain("required");
    expect(result).toContain("Write content to a file");
  });
});
