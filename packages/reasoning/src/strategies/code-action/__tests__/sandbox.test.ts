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

  // ── Hyphenated tool names (the builtin reality — 2026-07-11 probe p7) ──
  //
  // Every builtin is hyphenated (file-write, code-execute, web-search). The
  // sandbox passed raw names as `new Function` PARAMETER names — syntactically
  // invalid JS — so code-action hard-failed with "Unexpected token '-'" the
  // moment a real builtin was involved. Tests only ever used "add".
  it("exposes hyphenated tools under sanitized identifiers, dispatches under original names", async () => {
    const code = `(async () => { return await file_write({ path: "x.txt", content: "hi" }); })()`;
    const seen: unknown[] = [];
    const handlers = new Map<string, (args: unknown) => Promise<unknown>>([
      [
        "file-write",
        async (args: unknown) => {
          seen.push(args);
          return "written";
        },
      ],
    ]);
    const result = await runInSandbox(code, handlers);
    expect(result.finalResult).toBe("written");
    // Host-side dispatch + call log stay keyed by the ORIGINAL tool name.
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.name).toBe("file-write");
    expect(seen).toHaveLength(1);
  });

  it("executes TypeScript-annotated code (models emit TS regardless of prompt)", async () => {
    // p7 2026-07-11: one `: number` annotation killed 10/10 attempts — the
    // worker parses JS. Under bun the worker transpiles TS first.
    const code = `(async () => { const n: number = 250; const total: number = n * (n + 1) * (2 * n + 1) / 6; return total; })()`;
    const result = await runInSandbox(code, new Map());
    expect(result.finalResult).toBe(5239625);
  });

  it("dedupes sanitized identifier collisions deterministically", async () => {
    const code = `(async () => { return [await a_b({}), await a_b_({})]; })()`;
    const handlers = new Map<string, (args: unknown) => Promise<unknown>>([
      ["a-b", async () => "dash"],
      ["a_b", async () => "underscore"],
    ]);
    const result = await runInSandbox(code, handlers);
    // First name claims its sanitized form; the collider gets a suffix.
    expect(result.finalResult).toEqual(["dash", "underscore"]);
  });
});
