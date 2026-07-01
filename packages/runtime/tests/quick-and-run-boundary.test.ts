import { describe, test, expect, afterEach } from "bun:test";
import { ReactiveAgents } from "../src";
import { toRunBoundaryError } from "../src/errors";

describe("ReactiveAgents.quick()", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    Object.keys(process.env).forEach((k) => {
      if (!(k in originalEnv)) delete process.env[k];
    });
    Object.assign(process.env, originalEnv);
  });

  test("two-line hello: quick({provider:'test'}) builds and runs", async () => {
    const agent = await ReactiveAgents.quick({ provider: "test" });
    const result = await agent.run("hi");
    expect(result.output).toBeDefined();
    await agent.dispose();
  });

  test("resolves provider from REACTIVE_AGENTS_PROVIDER", async () => {
    process.env.REACTIVE_AGENTS_PROVIDER = "test";
    const agent = await ReactiveAgents.quick();
    const result = await agent.run("hi");
    expect(result.output).toBeDefined();
    await agent.dispose();
  });

  test("honors explicit maxIterations override", async () => {
    const agent = await ReactiveAgents.quick({ provider: "test", maxIterations: 3 });
    expect(agent).toBeDefined();
    await agent.dispose();
  });
});

describe("run() error boundary (toRunBoundaryError)", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    Object.keys(process.env).forEach((k) => {
      if (!(k in originalEnv)) delete process.env[k];
    });
    Object.assign(process.env, originalEnv);
  });

  test("collapses a multi-line provider error to a single line, preserving cause", () => {
    delete process.env.RA_DEBUG_ERRORS;
    delete process.env.REACTIVE_AGENTS_DEBUG;
    const raw = new Error(
      '404 {"error":{"message":"model not found"}}\n    at foo (bar.ts:1:1)\n    at baz (qux.ts:2:2)',
    );
    const mapped = toRunBoundaryError(raw);
    expect(mapped.message.includes("\n")).toBe(false);
    expect(mapped.message).toContain("404");
    // stack is trimmed to a single line — no internal frames on the console
    expect((mapped.stack ?? "").split("\n").length).toBe(1);
    // full original recoverable via cause
    expect((mapped as Error & { cause?: unknown }).cause).toBe(raw);
  });

  test("RA_DEBUG_ERRORS=1 returns the full original error with stack", () => {
    process.env.RA_DEBUG_ERRORS = "1";
    const raw = new Error("boom\n  at x (y.ts:1:1)");
    const mapped = toRunBoundaryError(raw);
    expect(mapped).toBe(raw);
  });
});
