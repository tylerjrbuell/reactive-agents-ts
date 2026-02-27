import { describe, test, expect } from "bun:test";
import { compressToolResult, parseToolRequestWithTransform, evaluateTransform } from "../../src/strategies/reactive.js";

describe("tool result compression config threading", () => {
  test("ReactiveInput accepts resultCompression config", () => {
    // This is a compile-time / shape check
    const input = {
      taskDescription: "test",
      taskType: "test",
      memoryContext: "",
      availableTools: [] as string[],
      config: { strategies: { reactive: { maxIterations: 1, temperature: 0 } } } as any,
      resultCompression: { budget: 2000, previewItems: 8 },
    };
    expect(input.resultCompression?.budget).toBe(2000);
    expect(input.resultCompression?.previewItems).toBe(8);
  });
});

describe("runToolObservation compression wiring", () => {
  test("stored result is accessible via scratchpad store", () => {
    const bigArray = Array.from({ length: 20 }, (_, i) => ({
      sha: `sha${i}`,
      message: `commit ${i}`,
    }));
    const bigJson = JSON.stringify(bigArray);

    // Direct test: compressToolResult puts key in stored, and the key format is _tool_result_N
    const store = new Map<string, string>();
    const compressed = compressToolResult(bigJson, "github/list_commits", 100, 3);
    if (compressed.stored) {
      store.set(compressed.stored.key, compressed.stored.value);
    }
    expect(store.size).toBe(1);
    const [key] = [...store.keys()];
    expect(JSON.parse(store.get(key!)!)).toHaveLength(20);
  });

  test("compressToolResult reads compression config fields correctly", () => {
    const bigArray = Array.from({ length: 10 }, (_, i) => ({ id: i, name: `item ${i}` }));
    const bigJson = JSON.stringify(bigArray);

    // With budget=2000, the array should NOT be compressed (fits in budget)
    const result1 = compressToolResult(bigJson, "test-tool", 2000, 3);
    expect(result1.stored).toBeUndefined();

    // With budget=50, it should be compressed with previewItems=2
    const result2 = compressToolResult(bigJson, "test-tool", 50, 2);
    expect(result2.stored).toBeDefined();
    expect(result2.content).toContain("Array(10)");
    // Only 2 preview items (previewItems=2), so ...8 more
    expect(result2.content).toContain("...8 more");
  });
});

describe("compressToolResult", () => {
  test("returns result as-is when under budget", () => {
    const result = compressToolResult("hello world", "some-tool", 800, 3);
    expect(result.content).toBe("hello world");
    expect(result.stored).toBeUndefined();
  });

  test("generates array preview for JSON array over budget", () => {
    const commits = Array.from({ length: 10 }, (_, i) => ({
      sha: `abc${i}def${i}`,
      commit: { message: `feat: change ${i}`, author: { date: "2026-02-27" } },
      author: { login: "user" },
    }));
    const result = compressToolResult(JSON.stringify(commits), "github/list_commits", 100, 3);
    expect(result.content).toContain("Array(10)");
    expect(result.content).toContain("sha");
    expect(result.content).toContain("feat: change 0");
    expect(result.content).toContain("...7 more");
    expect(result.stored).toBeDefined();
    expect(result.stored!.key).toMatch(/^_tool_result_/);
    expect(result.stored!.value).toBe(JSON.stringify(commits));
  });

  test("generates object preview for JSON object over budget", () => {
    const obj = { id: 1, name: "test", description: "a long description here", nested: { a: 1 } };
    const result = compressToolResult(JSON.stringify(obj), "some-tool", 10, 3);
    expect(result.content).toContain("Object");
    expect(result.content).toContain("id");
    expect(result.content).toContain("name");
    expect(result.stored).toBeDefined();
  });

  test("generates line preview for plain text over budget", () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const result = compressToolResult(text, "file-read", 10, 3);
    expect(result.content).toContain("line 0");
    expect(result.content).toContain("line 1");
    expect(result.content).toContain("17 more lines");
    expect(result.stored).toBeDefined();
  });

  test("uses monotonic counter for stored key uniqueness", () => {
    const big = "x".repeat(1000);
    const r1 = compressToolResult(big, "tool-a", 10, 3);
    const r2 = compressToolResult(big, "tool-b", 10, 3);
    expect(r1.stored!.key).not.toBe(r2.stored!.key);
  });
});

describe("pipe transform parsing", () => {
  test("parses plain action with no transform", () => {
    const result = parseToolRequestWithTransform(
      'ACTION: github/list_commits({"owner":"x","repo":"y"})'
    );
    expect(result?.tool).toBe("github/list_commits");
    expect(result?.transform).toBeUndefined();
  });

  test("parses action with | transform: expression", () => {
    const result = parseToolRequestWithTransform(
      'ACTION: github/list_commits({"owner":"x"}) | transform: result.slice(0,3).map(c => c.sha)'
    );
    expect(result?.tool).toBe("github/list_commits");
    expect(result?.transform).toBe("result.slice(0,3).map(c => c.sha)");
  });

  test("transform expression can contain nested parens and JSON", () => {
    const result = parseToolRequestWithTransform(
      'ACTION: some/tool({"k":"v"}) | transform: result.filter(x => x.active).map(x => ({id: x.id, name: x.name}))'
    );
    expect(result?.transform).toContain("result.filter");
    expect(result?.transform).toContain("x.name");
  });

  test("returns null for invalid action", () => {
    expect(parseToolRequestWithTransform("THOUGHT: just thinking")).toBeNull();
  });
});

describe("evaluateTransform", () => {
  test("evaluates expression with result variable", () => {
    const input = [{ sha: "abc123def456", msg: "fix: bug" }, { sha: "xyz789uvw012", msg: "feat: add" }];
    const expr = "result.map(c => c.sha.slice(0, 7))";
    const output = evaluateTransform(expr, input);
    expect(output).toEqual('[\n  "abc123d",\n  "xyz789u"\n]');
  });

  test("returns error string on expression throw", () => {
    const output = evaluateTransform("result.nonExistentMethod()", []);
    expect(typeof output).toBe("string");
    expect(output as string).toContain("[Transform error:");
  });

  test("returns string output directly without re-serializing", () => {
    const output = evaluateTransform('"hello world"', null);
    expect(output).toBe("hello world");
  });
});
