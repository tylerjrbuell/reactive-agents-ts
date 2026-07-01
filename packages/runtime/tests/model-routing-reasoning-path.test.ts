// Run: bun test packages/runtime/tests/model-routing-reasoning-path.test.ts --timeout 20000
/**
 * Non-vacuous verification that the routed model actually reaches `llm.stream()`
 * on the reasoning path (C2 gate).
 *
 * Strategy: inject a recording LLMService layer that captures `request.model`
 * from every `stream()` call. Drive `executeReActKernel` with `modelId` set to a
 * cheap-tier model. Assert the captured value equals the modelId.
 *
 * Non-vacuity proof (captured in the negative-control test below):
 * - When `modelId` is omitted, `request.model` is `undefined` — proves the
 *   positive assertion is not trivially satisfied.
 * - Reverting C2 (`...(input.modelId ? { model: input.modelId } : {})`) makes
 *   the positive test go RED because `captured[0]` would be `undefined`.
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { executeReActKernel } from "@reactive-agents/reasoning";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";

/** Build a layer that wraps TestLLMService and records every `request.model` passed to stream(). */
function makeRecordingLayer(
  captured: Array<string | object | undefined>,
  scenario: Parameters<typeof TestLLMService>[0],
) {
  const base = TestLLMService(scenario);
  return Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      stream: (request) => {
        captured.push(request.model);
        return base.stream(request);
      },
    }),
  );
}

describe("model routing — reasoning path (C2)", () => {
  it("forwards input.modelId as request.model to llm.stream (C2 positive)", async () => {
    const captured: Array<string | object | undefined> = [];
    const layer = makeRecordingLayer(captured, [{ text: "FINAL ANSWER: 4" }]);

    const result = await Effect.runPromise(
      executeReActKernel({
        task: "What is 2 + 2?",
        modelId: "claude-haiku-4-5",
        maxIterations: 2,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.terminatedBy).toBe("final_answer");
    expect(captured.length).toBeGreaterThan(0);
    // C2: the routed model string must reach the stream call
    expect(captured[0]).toBe("claude-haiku-4-5");
  });

  it("non-vacuity control: without modelId, request.model is undefined", async () => {
    const captured: Array<string | object | undefined> = [];
    const layer = makeRecordingLayer(captured, [{ text: "FINAL ANSWER: 4" }]);

    await Effect.runPromise(
      executeReActKernel({
        task: "What is 2 + 2?",
        // No modelId — without C2 the positive test would look exactly like this
        maxIterations: 2,
      }).pipe(Effect.provide(layer)),
    );

    expect(captured.length).toBeGreaterThan(0);
    // Without modelId, request.model must NOT be set — this proves the positive
    // test is non-vacuous: removing C2 would collapse it into this state.
    expect(captured[0]).toBeUndefined();
  });
});
