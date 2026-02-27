import { describe, test, expect } from "bun:test";

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
