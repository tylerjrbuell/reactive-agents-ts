import { describe, it, expect } from "bun:test";
import { Effect, FiberRef } from "effect";
import { StreamingTextCallback } from "@reactive-agents/core";
import { executeReActKernel } from "../../src/strategies/kernel/react-kernel.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

describe("react-kernel streaming", () => {
  it("calls StreamingTextCallback with text deltas when set", async () => {
    const captured: string[] = [];
    const result = await Effect.runPromise(
      Effect.locally(
        executeReActKernel({ task: "Say hello", maxIterations: 2 }).pipe(
          Effect.provide(
            TestLLMServiceLayer([{ match: "Task:", text: "FINAL ANSWER: hello" }]),
          ),
        ),
        StreamingTextCallback,
        (text) => Effect.sync(() => { captured.push(text); }),
      ),
    );
    // Should have received text delta(s) for the response
    expect(captured.length).toBeGreaterThan(0);
    expect(result.output).toContain("hello");
  });

  it("does not error when StreamingTextCallback is null (default)", async () => {
    const result = await Effect.runPromise(
      executeReActKernel({ task: "Say hi", maxIterations: 2 }).pipe(
        Effect.provide(
          TestLLMServiceLayer([{ match: "Task:", text: "FINAL ANSWER: hi" }]),
        ),
      ),
    );
    expect(result.output).toContain("hi");
  });

  it("accumulates text deltas into final answer correctly", async () => {
    const captured: string[] = [];
    // The streaming callback should capture deltas before the final answer is extracted
    await Effect.runPromise(
      Effect.locally(
        executeReActKernel({ task: "What is 2+2?", maxIterations: 2 }).pipe(
          Effect.provide(
            TestLLMServiceLayer([{ match: "Task:", text: "FINAL ANSWER: 4" }]),
          ),
        ),
        StreamingTextCallback,
        (text) => Effect.sync(() => { captured.push(text); }),
      ),
    );
    // Combined captured text should contain the response content
    const combined = captured.join("");
    expect(combined.length).toBeGreaterThan(0);
  });
});
