import { describe, it, expect } from "bun:test";
import { Effect, Schema } from "effect";
import { defineTool } from "../src/define-tool.js";
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

  it("withToolRetry reports the attempt that finally succeeded", async () => {
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
    const observed = withToolObservability(withToolRetry(flaky, { maxAttempts: 5 }));
    const result = (await Effect.runPromise(observed.handler({}))) as {
      data: { ok: boolean };
      meta: { attempt: number };
    };
    expect(result.data).toEqual({ ok: true });
    expect(result.meta.attempt).toBe(3);
    expect(calls).toBe(3);
  });
});
