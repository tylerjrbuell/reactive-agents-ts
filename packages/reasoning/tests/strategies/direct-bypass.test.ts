/**
 * direct-bypass.test.ts — MOVE-direct-bypass conditions pin.
 *
 * Locks the bypass truth-table at executeReactive's entry. The bypass
 * routes trivial+no-tools tasks through executeDirect (single LLM call,
 * no kernel loop). If conditions drift, the framework either:
 *   (a) over-bypasses (regresses tasks needing tool retries / verification)
 *   (b) under-bypasses (gives back token savings for trivial knowledge)
 *
 * The test exercises the LLM-capture layer to count calls per task:
 *   bypass active → 1 LLM call (executeDirect maxIter=1)
 *   bypass inactive → 1+ calls (reactive kernel may make 1-3)
 *
 * NOTE: Even when bypass is "inactive" qwen3.5-like models often finish
 * in 1 call. The discriminator is the strategy field in the result, not
 * the call count alone.
 */
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";
import type { StreamEvent } from "@reactive-agents/llm-provider";

function makeStreamResponse(content: string): Stream.Stream<StreamEvent, never> {
  return Stream.make(
    { type: "text_delta" as const, text: content },
    { type: "content_complete" as const, content },
    {
      type: "usage" as const,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 },
    },
  ) as Stream.Stream<StreamEvent, never>;
}

function makeCapturingLLM() {
  let calls = 0;
  const layer = Layer.succeed(LLMService, LLMService.of({
    complete: () => {
      calls += 1;
      return Effect.succeed({
        content: "Paris",
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 },
        model: "test",
      });
    },
    stream: () => {
      calls += 1;
      return Effect.succeed(makeStreamResponse("Paris"));
    },
    completeStructured: () => Effect.succeed({} as never),
    embed: () => Effect.succeed([]),
    countTokens: () => Effect.succeed(0),
    getModelConfig: () =>
      Effect.succeed({ provider: "anthropic" as const, model: "test" }),
    getStructuredOutputCapabilities: () =>
      Effect.succeed({
        nativeJsonMode: false,
        jsonSchemaEnforcement: false,
        prefillSupport: false,
        grammarConstraints: false,
      }),
  } as never));
  return { layer, getCalls: () => calls };
}

describe("MOVE-direct-bypass — trivial+no-tools shortcut", () => {
  it("k1-class task (trivial, no tools, high-conf) → bypass to direct, strategy='direct'", async () => {
    const { layer } = makeCapturingLLM();
    const result = await Effect.runPromise(
      executeReactive({
        taskDescription: "What is the capital of France?",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(layer)),
    );
    expect(result.strategy).toBe("direct");
  });

  it("k3-class task (trivial RGB) → bypass to direct", async () => {
    const { layer } = makeCapturingLLM();
    const result = await Effect.runPromise(
      executeReactive({
        taskDescription: "What are the three primary colors of light (RGB)?",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(layer)),
    );
    expect(result.strategy).toBe("direct");
  });

  it("tool-required task → bypass INHIBITED (strategy='reactive')", async () => {
    const { layer } = makeCapturingLLM();
    const result = await Effect.runPromise(
      executeReactive({
        taskDescription: "What is the capital of France?",
        taskType: "query",
        memoryContext: "",
        availableTools: ["web-search"],
        availableToolSchemas: [
          { name: "web-search", description: "Search", parameters: [] },
        ],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(layer)),
    );
    // Tools present → bypass inhibited, full reactive path.
    expect(result.strategy).toBe("reactive");
  });

  it("requiredTools present → bypass INHIBITED", async () => {
    const { layer } = makeCapturingLLM();
    const result = await Effect.runPromise(
      executeReactive({
        taskDescription: "What is the capital of France?",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        requiredTools: ["citation"],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(layer)),
    );
    expect(result.strategy).toBe("reactive");
  });

  it("custom verifier present → bypass INHIBITED (caller controls gating)", async () => {
    const { layer } = makeCapturingLLM();
    const result = await Effect.runPromise(
      executeReactive({
        taskDescription: "What is the capital of France?",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: defaultReasoningConfig,
        verifier: { verify: () => Promise.resolve({ verified: true, checks: [] }) } as never,
      }).pipe(Effect.provide(layer)),
    );
    expect(result.strategy).toBe("reactive");
  });

  it("complex task → bypass INHIBITED (shape.complexity !== trivial)", async () => {
    const { layer } = makeCapturingLLM();
    const result = await Effect.runPromise(
      executeReactive({
        taskDescription:
          "Compare and contrast eventual vs strong consistency. Critique the trade-offs.",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(layer)),
    );
    expect(result.strategy).toBe("reactive");
  });

  it("multi-step trivial task → bypass INHIBITED (shape.needsMultiStep)", async () => {
    const { layer } = makeCapturingLLM();
    const result = await Effect.runPromise(
      executeReactive({
        taskDescription: "First find X, then explain Y.",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(layer)),
    );
    expect(result.strategy).toBe("reactive");
  });
});
