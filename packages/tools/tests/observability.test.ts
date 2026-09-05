import { describe, it, expect } from "bun:test";
import { Effect, Schema } from "effect";
import { defineTool } from "../src/define-tool.js";
import { ToolDefinitionError } from "../src/errors.js";
import { withToolObservability, withToolRetry } from "../src/observability.js";

describe("withToolObservability", () => {
  it("wraps a successful result with latency/attempt metadata", async () => {
    const base = defineTool({
      name: "slow-echo",
      description: "Echoes after a short delay",
      input: Schema.Struct({ text: Schema.String }),
      handler: async ({ text }) => {
        await new Promise((r) => setTimeout(r, 5));
        return { text };
      },
    });
    const observed = withToolObservability(base);
    const result = (await Effect.runPromise(observed.handler({ text: "hi" }))) as {
      data: { text: string };
      meta: { toolName: string; latencyMs: number; attempt: number };
    };
    expect(result.data).toEqual({ text: "hi" });
    expect(result.meta.toolName).toBe("slow-echo");
    expect(result.meta.attempt).toBe(1);
    expect(result.meta.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("with retry option, reports the attempt that finally succeeded", async () => {
    let calls = 0;
    const flaky = defineTool({
      name: "flaky",
      description: "Fails twice then succeeds",
      input: Schema.Struct({}),
      handler: async () => {
        calls++;
        if (calls < 3) throw new Error("transient");
        return { ok: true };
      },
    });
    const observed = withToolObservability(flaky, { retry: { maxAttempts: 5 } });
    const result = (await Effect.runPromise(observed.handler({}))) as {
      data: { ok: boolean };
      meta: { attempt: number };
    };
    expect(result.data).toEqual({ ok: true });
    expect(result.meta.attempt).toBe(3);
    expect(calls).toBe(3);
  });

  it("withToolObservability(withToolRetry(tool)) composition still reports attempt count", async () => {
    let calls = 0;
    const flaky = defineTool({
      name: "flaky-composed",
      description: "Fails twice then succeeds",
      input: Schema.Struct({}),
      handler: async () => {
        calls++;
        if (calls < 3) throw new Error("transient");
        return { ok: true };
      },
    });
    const observed = withToolObservability(withToolRetry(flaky, { maxAttempts: 5 }));
    const result = (await Effect.runPromise(observed.handler({}))) as {
      data: { ok: boolean };
      meta: { attempt: number };
    };
    expect(result.data).toEqual({ ok: true });
    // Retry succeeds inside withToolRetry's own loop (attempt 3 there), but
    // withToolObservability wrapping it from the outside only ever sees a
    // single call to withToolRetry's handler, so it reports attempt 1.
    expect(result.meta.attempt).toBe(1);
    expect(calls).toBe(3);
  });

  it("rejects maxAttempts < 1 with a typed ToolDefinitionError, not a raw TypeError", async () => {
    const tool = defineTool({
      name: "whatever",
      description: "unused",
      input: Schema.Struct({}),
      handler: async () => ({}),
    });
    expect(() => withToolObservability(tool, { retry: { maxAttempts: 0 } })).toThrow(
      ToolDefinitionError,
    );
  });
});

describe("withToolRetry", () => {
  it("Finding 1: used standalone, resolves to the tool's real value, not a carrier object", async () => {
    const tool = defineTool({
      name: "echo",
      description: "Echoes back the given value",
      input: Schema.Struct({}),
      handler: async () => ({ a: 1 }),
    });
    const retried = withToolRetry(tool, { maxAttempts: 3 });
    const result = await Effect.runPromise(retried.handler({}));
    expect(result).toEqual({ a: 1 });
    // Must NOT be the internal attempt-carrier shape.
    expect(result).not.toHaveProperty("value");
    expect(result).not.toHaveProperty("attempt");
  });

  it("retries on failure and eventually resolves to the real value on success", async () => {
    let calls = 0;
    const flaky = defineTool({
      name: "flaky-standalone",
      description: "Fails twice then succeeds",
      input: Schema.Struct({}),
      handler: async () => {
        calls++;
        if (calls < 3) throw new Error("transient");
        return { ok: true };
      },
    });
    const retried = withToolRetry(flaky, { maxAttempts: 5 });
    const result = await Effect.runPromise(retried.handler({}));
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it("Finding 2: maxAttempts: 0 throws a typed ToolDefinitionError, not a raw TypeError", async () => {
    const tool = defineTool({
      name: "unused-tool",
      description: "unused",
      input: Schema.Struct({}),
      handler: async () => ({}),
    });
    expect(() => withToolRetry(tool, { maxAttempts: 0 })).toThrow(ToolDefinitionError);
  });

  it("exhausts maxAttempts and fails with the last error when the tool never succeeds", async () => {
    const alwaysFails = defineTool({
      name: "always-fails",
      description: "Always throws",
      input: Schema.Struct({}),
      handler: async () => {
        throw new Error("nope");
      },
    });
    const retried = withToolRetry(alwaysFails, { maxAttempts: 3 });
    const exit = await Effect.runPromiseExit(retried.handler({}));
    expect(exit._tag).toBe("Failure");
  });
});
