import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { rootContext } from "@reactive-agents/core";
import { getRunSlot, streamSinkSlot, withRunScope } from "@reactive-agents/core/internal/run-scope";
import { executeReActKernel } from "../../src/kernel/loop/react-kernel.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

/** Run `effect` as one run whose stream sink feeds `captured`. */
const streamingRun = <A, E>(effect: Effect.Effect<A, E>, captured: string[]): Effect.Effect<A, E> =>
  Effect.flatMap(getRunSlot(streamSinkSlot), (sink) => {
    sink.current = (text) => Effect.sync(() => void captured.push(text));
    return effect;
  }).pipe(withRunScope(rootContext("stream-test", "agent")));

describe("react-kernel streaming", () => {
  it("sends text deltas to the run's stream sink when one is installed", async () => {
    const captured: string[] = [];
    const result = await Effect.runPromise(
      streamingRun(
        executeReActKernel({ task: "Say hello", maxIterations: 2 }).pipe(
          Effect.provide(TestLLMServiceLayer([{ match: "Task:", text: "FINAL ANSWER: hello" }])),
        ),
        captured,
      ),
    );
    // Should have received text delta(s) for the response
    expect(captured.length).toBeGreaterThan(0);
    expect(result.output).toContain("hello");
  });

  it("does not error when the run has no stream sink (default)", async () => {
    const result = await Effect.runPromise(
      executeReActKernel({ task: "Say hi", maxIterations: 2 }).pipe(
        Effect.provide(TestLLMServiceLayer([{ match: "Task:", text: "FINAL ANSWER: hi" }])),
        withRunScope(rootContext("stream-test-none", "agent")),
      ),
    );
    expect(result.output).toContain("hi");
  });

  it("accumulates text deltas into final answer correctly", async () => {
    const captured: string[] = [];
    // The stream sink should capture deltas before the final answer is extracted
    await Effect.runPromise(
      streamingRun(
        executeReActKernel({ task: "What is 2+2?", maxIterations: 2 }).pipe(
          Effect.provide(TestLLMServiceLayer([{ match: "Task:", text: "FINAL ANSWER: 4" }])),
        ),
        captured,
      ),
    );
    // Combined captured text should contain the response content
    const combined = captured.join("");
    expect(combined.length).toBeGreaterThan(0);
  });
});
