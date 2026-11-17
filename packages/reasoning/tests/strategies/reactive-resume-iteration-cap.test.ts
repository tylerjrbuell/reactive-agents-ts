// File: tests/strategies/reactive-resume-iteration-cap.test.ts
//
// Cortex Continue bug (trace 01M7N2EMH2GEXA333HBHF0VPP3): a resumed segment
// kept iterationCap.threshold 16 at iterations 13 and 15. The runtime raises
// the per-run cap on resume and sends it as contextProfile.maxIterations;
// resolveMaxIterationCap must honor it when (and only when) the run resumes.

import { describe, it, expect } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { executeReactive, resolveMaxIterationCap } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import { initialKernelState, transitionState } from "../../src/kernel/state/kernel-state.js";
import { makeObservableLogger, ObservableLogger } from "@reactive-agents/observability";

describe("resolveMaxIterationCap — resume cap", () => {
  it("resumed + raised cap 13 beats explicit cap 3 (threshold 13)", () => {
    expect(
      resolveMaxIterationCap({ configCap: 3, tierHint: 13, explicit: true, resumed: true }),
    ).toEqual({ maxIterations: 13, clamped: false });
  });

  it("resumed + raised cap beats the min(tierHint, configCap) rule", () => {
    expect(
      resolveMaxIterationCap({ configCap: 10, tierHint: 13, explicit: false, resumed: true }),
    ).toEqual({ maxIterations: 13, clamped: false });
  });

  it("resumed + plan-budget-raised config cap above the resume cap keeps the higher cap", () => {
    expect(
      resolveMaxIterationCap({ configCap: 20, tierHint: 13, explicit: true, resumed: true }),
    ).toEqual({ maxIterations: 20, clamped: false });
  });

  it("resumed with a lower hint falls through to the normal rules", () => {
    expect(
      resolveMaxIterationCap({ configCap: 10, tierHint: 8, explicit: false, resumed: true }),
    ).toEqual({ maxIterations: 8, clamped: true });
  });

  it("non-resumed runs are unchanged", () => {
    expect(resolveMaxIterationCap({ configCap: 3, tierHint: 13, explicit: true })).toEqual({
      maxIterations: 3,
      clamped: false,
    });
    expect(
      resolveMaxIterationCap({ configCap: 3, tierHint: 13, explicit: true, resumed: false }),
    ).toEqual({ maxIterations: 3, clamped: false });
    expect(resolveMaxIterationCap({ configCap: 10, tierHint: 13, explicit: false })).toEqual({
      maxIterations: 10,
      clamped: false,
    });
  });
});

const makeLlm = async () => {
  const state = { callCount: 0 };
  const { LLMService } = await import("@reactive-agents/llm-provider");
  type Ev = import("@reactive-agents/llm-provider").StreamEvent;
  const usage = () => {
    state.callCount++;
    const inputTokens = 100 + state.callCount * 400;
    return { inputTokens, outputTokens: 50, totalTokens: inputTokens + 50, estimatedCost: 0 };
  };
  const layer = Layer.succeed(LLMService, {
    complete: () => {
      const u = usage();
      return Effect.succeed({ content: "Thinking...", stopReason: "end_turn" as const, usage: u, model: "test-model" });
    },
    stream: () => {
      const u = usage();
      return Effect.succeed(
        Stream.make(
          { type: "text_delta" as const, text: "Thinking..." },
          { type: "content_complete" as const, content: "Thinking..." },
          { type: "usage" as const, usage: u },
        ) as Stream.Stream<Ev, never>,
      );
    },
    completeStructured: () => Effect.succeed({} as never),
    embed: (texts: string[]) => Effect.succeed(texts.map(() => [])),
    countTokens: () => Effect.succeed(0),
    getModelConfig: () => Effect.succeed({ provider: "anthropic" as const, model: "test-model" }),
    capabilities: () =>
      Effect.succeed({
        supportsToolCalling: false,
        supportsStreaming: true,
        supportsStructuredOutput: false,
        supportsLogprobs: false,
      }),
  } as never);
  return { state, layer };
};

const runWith = async (withResume: boolean): Promise<number> => {
  const llm = await makeLlm();
  const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
  const resumeState = transitionState(
    initialKernelState({ maxIterations: 3, strategy: "reactive", kernelType: "react" }),
    { iteration: 3, status: "thinking" },
  );
  await Effect.runPromise(
    provideTestEnvelope(
      executeReactive({
        taskDescription: "resume cap",
        taskType: "test",
        memoryContext: "",
        availableTools: ["never-called-tool"],
        requiredTools: ["never-called-tool"],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations: 3, maxIterationsExplicit: true },
          },
        },
        contextProfile: { tier: "local" as const, maxIterations: 13 },
        ...(withResume ? { resumeState } : {}),
      }),
    ).pipe(Effect.provide(Layer.succeed(ObservableLogger, logger)), Effect.provide(llm.layer)),
  );
  return llm.state.callCount;
};

describe("executeReactive — resumed run honors the resume cap", () => {
  it("resumed state that spent cap 3 does more iterations under resume cap 13", async () => {
    const resumed = await runWith(true);
    const fresh = await runWith(false);
    // Fresh run: explicit cap 3 stops it; the resumed one has 3 -> 13 headroom.
    expect(fresh).toBeLessThanOrEqual(4);
    expect(resumed).toBeGreaterThan(fresh);
  });
});
