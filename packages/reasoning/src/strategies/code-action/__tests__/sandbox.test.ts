import { describe, it, expect } from "bun:test";
import { runInSandbox } from "../sandbox.js";

describe("runInSandbox", () => {
  it("executes a simple expression and returns the result", async () => {
    const code = `(async () => { return 42; })()`;
    const result = await runInSandbox(code, new Map());
    expect(result.finalResult).toBe(42);
  });

  it("routes tool calls through host handlers", async () => {
    const code = `(async () => { return await add({ a: 1, b: 2 }); })()`;
    const handlers = new Map<string, (args: unknown) => Promise<unknown>>([
      ["add", async (args: unknown) => {
        const { a, b } = args as { a: number; b: number };
        return a + b;
      }],
    ]);
    const result = await runInSandbox(code, handlers);
    expect(result.finalResult).toBe(3);
  });

  it("records tool call log entries", async () => {
    const code = `(async () => { return await add({ a: 5, b: 5 }); })()`;
    const handlers = new Map<string, (args: unknown) => Promise<unknown>>([
      ["add", async (args: unknown) => {
        const { a, b } = args as { a: number; b: number };
        return a + b;
      }],
    ]);
    const result = await runInSandbox(code, handlers);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("add");
    expect(result.toolCalls[0].result).toBe(10);
  });

  it("rejects on code that throws", async () => {
    const code = `(async () => { throw new Error("boom"); })()`;
    await expect(runInSandbox(code, new Map())).rejects.toThrow("boom");
  });
});
