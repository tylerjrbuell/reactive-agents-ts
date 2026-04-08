import { describe, it, expect } from "bun:test";
import {
  hasFinalAnswer,
  extractFinalAnswer,
  evaluateTransform,
  formatToolSchemas,
  formatToolSchemaCompact,
  formatToolSchemaMicro,
  filterToolsByRelevance,
  gateNativeToolCallsForRequiredTools,
  buildToolElaborationInjection,
  planNextMoveBatches,
} from "../../../../src/strategies/kernel/utils/tool-utils.js";

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

describe("formatToolSchemaCompact", () => {
  it("formats tool with params as name(param: type)", () => {
    const result = formatToolSchemaCompact({
      name: "web-search",
      description: "Search the web",
      parameters: [
        { name: "query", type: "string", required: true },
        { name: "maxResults", type: "number", required: false },
      ],
    });
    expect(result).toBe("- web-search(query: string, maxResults: number?)");
  });

  it("formats tool with no params as name()", () => {
    const result = formatToolSchemaCompact({
      name: "list-groups",
      description: "List all groups",
      parameters: [],
    });
    expect(result).toBe("- list-groups()");
  });
});

describe("formatToolSchemaMicro", () => {
  const schema = {
    name: "web-search",
    description: "Search the web for information",
    parameters: [{ name: "query", type: "string", description: "search query", required: true }],
  }

  it("returns name: description with no parameters shown", () => {
    const result = formatToolSchemaMicro(schema)
    expect(result).toBe("web-search: Search the web for information")
  })

  it("truncates long descriptions at 80 chars", () => {
    const longSchema = { ...schema, description: "A".repeat(100) }
    const result = formatToolSchemaMicro(longSchema)
    expect(result).toBe(`web-search: ${"A".repeat(77)}...`)
  })

  it("handles undefined description", () => {
    const noDesc = { ...schema, description: undefined as any }
    const result = formatToolSchemaMicro(noDesc)
    expect(result).toBe("web-search: ")
  })
})

describe("filterToolsByRelevance", () => {
  const allTools = [
    { name: "github/list_commits", description: "List commits", parameters: [] },
    { name: "signal/send_message_to_user", description: "Send message", parameters: [] },
    { name: "web-search", description: "Search the web", parameters: [] },
    { name: "file-write", description: "Write a file", parameters: [] },
  ];

  it("classifies tools mentioned in task as primary", () => {
    const result = filterToolsByRelevance(
      "Use github/list_commits to fetch commits then signal/send_message_to_user",
      allTools,
    );
    expect(result.primary.map((t) => t.name)).toContain("github/list_commits");
    expect(result.primary.map((t) => t.name)).toContain("signal/send_message_to_user");
    expect(result.secondary.map((t) => t.name)).toContain("web-search");
    expect(result.secondary.map((t) => t.name)).toContain("file-write");
  });

  it("matches tool names without namespace prefix", () => {
    const result = filterToolsByRelevance("list_commits from the repo", allTools);
    expect(result.primary.map((t) => t.name)).toContain("github/list_commits");
  });

  it("matches tool names by the part after the slash", () => {
    // "send_message_to_user" is the suffix — should match when it appears in the task
    const result = filterToolsByRelevance("use send_message_to_user to notify them", allTools);
    expect(result.primary.map((t) => t.name)).toContain("signal/send_message_to_user");
  });

  it("returns all as secondary when none mentioned", () => {
    const result = filterToolsByRelevance("Do something unrelated", allTools);
    expect(result.primary.length).toBe(0);
    expect(result.secondary.length).toBe(allTools.length);
  });
});

describe("gateNativeToolCallsForRequiredTools", () => {
  const calls = [
    { name: "web-search", id: "a", arguments: {} },
    { name: "http-get", id: "b", arguments: {} },
  ] as const;

  it("passes through when no required tools", () => {
    const r = gateNativeToolCallsForRequiredTools(calls, [], new Set());
    expect(r.effective).toEqual(calls);
    expect(r.blockedOptionalBatch).toBe(false);
  });

  it("returns first call toward a missing required tool only", () => {
    const r = gateNativeToolCallsForRequiredTools(
      calls,
      ["web-search", "file-write"],
      new Set(),
    );
    expect(r.effective.map((c) => c.name)).toEqual(["web-search"]);
    expect(r.blockedOptionalBatch).toBe(false);
  });

  it("blocks when batch omits every missing required tool", () => {
    const r = gateNativeToolCallsForRequiredTools(
      [{ name: "http-get", id: "x", arguments: {} }],
      ["web-search", "file-write"],
      new Set(["web-search"]),
    );
    expect(r.effective.map((c) => c.name)).toEqual(["http-get"]);
    expect(r.blockedOptionalBatch).toBe(false);
  });

  it("blocks when strict dependency mode is enabled and batch omits missing required tools", () => {
    const r = gateNativeToolCallsForRequiredTools(
      [{ name: "http-get", id: "x", arguments: {} }],
      ["web-search", "file-write"],
      new Set(["web-search"]),
      undefined,
      undefined,
      undefined,
      true,
    );
    expect(r.effective.length).toBe(0);
    expect(r.blockedOptionalBatch).toBe(true);
  });

  it("passes through when all required tools are satisfied", () => {
    const r = gateNativeToolCallsForRequiredTools(
      calls,
      ["web-search"],
      new Set(["web-search"]),
    );
    expect(r.effective).toEqual(calls);
    expect(r.blockedOptionalBatch).toBe(false);
  });
});

describe("buildToolElaborationInjection", () => {
  it("returns empty string when disabled", () => {
    const result = buildToolElaborationInjection(
      [{ name: "web-search", parameters: [{ name: "query" }] }],
      { enabled: false },
    );
    expect(result).toBe("");
  });

  it("builds a lightweight elaboration section when enabled", () => {
    const result = buildToolElaborationInjection(
      [
        { name: "web-search", parameters: [{ name: "query" }, { name: "maxResults" }] },
        { name: "file-write", parameters: [{ name: "path" }, { name: "content" }] },
      ],
      { enabled: true, maxHintsPerTool: 2 },
    );
    expect(result).toContain("Tool Elaboration");
    expect(result).toContain("web-search");
    expect(result).toContain("file-write");
    expect(result).toContain("required args:");
  });
});

describe("planNextMoveBatches", () => {
  const calls = [
    { id: "1", name: "web-search" },
    { id: "2", name: "http-get" },
    { id: "3", name: "file-read" },
    { id: "4", name: "file-write" },
    { id: "5", name: "web-search" },
  ] as const;

  it("returns singletons when planner is disabled", () => {
    const batches = planNextMoveBatches(calls, { enabled: false });
    expect(batches.length).toBe(calls.length);
    expect(batches.every((b) => b.length === 1)).toBe(true);
  });

  it("groups safe contiguous calls and isolates side-effecting calls", () => {
    const batches = planNextMoveBatches(calls, {
      enabled: true,
      maxBatchSize: 3,
      allowParallelBatching: true,
    });
    expect(batches[0]?.map((c) => c.name)).toEqual(["web-search", "http-get", "file-read"]);
    expect(batches[1]?.map((c) => c.name)).toEqual(["file-write"]);
    expect(batches[2]?.map((c) => c.name)).toEqual(["web-search"]);
  });
});
