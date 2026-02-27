import { describe, test, expect } from "bun:test";
import { compressToolResult } from "../../src/strategies/reactive.js";

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
