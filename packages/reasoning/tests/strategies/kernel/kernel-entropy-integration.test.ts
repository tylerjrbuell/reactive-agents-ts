import { describe, test, expect } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { runKernel } from "../../../src/kernel/loop/runner.js";
import { reactKernel } from "../../../src/kernel/loop/react-kernel.js";
import { LLMService } from "@reactive-agents/llm-provider";
import type { StreamEvent } from "@reactive-agents/llm-provider";

function makeStreamResponse(content: string): Stream.Stream<StreamEvent, never> {
  return Stream.make(
    { type: "text_delta" as const, text: content },
    { type: "content_complete" as const, content },
    { type: "usage" as const, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 } },
  ) as Stream.Stream<StreamEvent, never>;
}

describe("kernel runner entropy integration", () => {
  test("runs successfully without EntropySensorService (optional)", async () => {
    const mockLLM = Layer.succeed(LLMService, {
      complete: () =>
        Effect.succeed({
          content: "FINAL ANSWER: Paris",
          stopReason: "end_turn" as const,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 },
          model: "test",
        }),
      stream: () => Effect.succeed(makeStreamResponse("FINAL ANSWER: Paris")),
      embed: () => Effect.succeed([]),
      countTokens: () => Effect.succeed(10),
      getModelConfig: () => Effect.succeed({ provider: "test" as any, model: "test" }),
      getStructuredOutputCapabilities: () =>
        Effect.succeed({
          nativeJsonMode: false,
          jsonSchemaEnforcement: false,
          prefillSupport: false,
          grammarConstraints: false,
        }),
    } as any);

    const program = runKernel(
      reactKernel,
      {
        task: "What is the capital of France?",
        availableToolSchemas: [],
      },
      {
        maxIterations: 3,
        strategy: "reactive",
        kernelType: "react",
        taskId: "test-no-entropy",
      },
    );

    const state = await Effect.runPromise(program.pipe(Effect.provide(mockLLM)));
    expect(state.status).toBe("done");
  });
});
