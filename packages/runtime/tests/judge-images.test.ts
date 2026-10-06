// Run: bun test packages/runtime/tests/judge-images.test.ts --timeout 15000
//
// Task 6 - agent.judge() optional images channel for vision decision models.
//
// Pins:
//   1. FORWARDING - images are passed through verbatim and in order to
//      JudgmentService.ask().
//   2. OMISSION - when no images are supplied (or an empty array), ask() input
//      does not contain an images field (no vacuous empty array).
//   3. COEXISTENCE - images work alongside includeContext; state merging is
//      untouched.
//   4. REJECTION - a text-only backend (llm, capabilities.images defaults to
//      false) rejects non-empty images with JudgmentUnsupported at the service
//      guard, not by silently dropping them.

import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, DEFAULT_CAPABILITIES } from "@reactive-agents/llm-provider";
import type { ModelConfig, StructuredOutputCapabilities } from "@reactive-agents/llm-provider";
import type { JudgmentAnswers, JudgmentError } from "@reactive-agents/judgment";
import { JudgmentService } from "@reactive-agents/judgment";
import { ReactiveAgents } from "../src/index.js";

type CapturedAsk = {
  state: unknown;
  questions: unknown;
  model?: string;
  images?: readonly string[];
};

const makeFakeJudgmentService = (captures: CapturedAsk[]): JudgmentService["Type"] => ({
  ask: (input) => {
    const captured: CapturedAsk = {
      state: input.state,
      questions: input.questions,
      model: input.model,
    };
    if (input.images !== undefined) {
      captured.images = input.images;
    }
    captures.push(captured);
    return Effect.succeed({
      risky: { kind: "noul" as const, probability: 0.5, calibrated: false },
    }) as Effect.Effect<JudgmentAnswers<typeof input.questions>, JudgmentError, never>;
  },
  listModels: () => Effect.die(new Error("unused in this test")),
});

const noulQuestion = {
  risky: {
    type: "noul" as const,
    instructions: "Is this action destructive?",
  },
};

const makeFakeLLMLayer = (): Layer.Layer<LLMService> =>
  Layer.succeed(LLMService, {
    complete: () => Effect.die(new Error("unused in this test")),
    stream: () => Effect.die(new Error("unused in this test")),
    completeStructured: () => Effect.die(new Error("unused in this test")),
    embed: () => Effect.die(new Error("unused in this test")),
    countTokens: () => Effect.succeed(0),
    getModelConfig: () =>
      Effect.succeed({ provider: "custom", model: "fake-model" } as ModelConfig),
    getStructuredOutputCapabilities: () =>
      Effect.succeed({
        nativeJsonMode: true,
        jsonSchemaEnforcement: false,
        prefillSupport: false,
        grammarConstraints: false,
      } as StructuredOutputCapabilities),
    capabilities: () => Effect.succeed(DEFAULT_CAPABILITIES),
  });

describe("agent.judge() - optional images channel", () => {
  const agentsToDispose: Array<{ dispose: () => Promise<void> }> = [];
  afterEach(async () => {
    while (agentsToDispose.length > 0) {
      await agentsToDispose.pop()!.dispose();
    }
  });

  it("forwards images to JudgmentService.ask verbatim and in order", async () => {
    const captures: CapturedAsk[] = [];
    const agent = await ReactiveAgents.create()
      .withName("judge-images-forward")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withLayers(Layer.succeed(JudgmentService, makeFakeJudgmentService(captures)))
      .build();
    agentsToDispose.push(agent);

    const images = ["base64-a", "base64-b", "base64-c"] as const;
    await agent.judge({
      state: { action: "x" },
      questions: noulQuestion,
      images,
    });

    expect(captures).toHaveLength(1);
    expect(captures[0]!.images).toEqual(["base64-a", "base64-b", "base64-c"]);
  });

  it("omits images from the ask input when the caller passes none or an empty array", async () => {
    const captures: CapturedAsk[] = [];
    const agent = await ReactiveAgents.create()
      .withName("judge-images-omit")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withLayers(Layer.succeed(JudgmentService, makeFakeJudgmentService(captures)))
      .build();
    agentsToDispose.push(agent);

    await agent.judge({ state: { action: "x" }, questions: noulQuestion });
    expect(captures[0]!).not.toHaveProperty("images");

    captures.length = 0;
    await agent.judge({ state: { action: "x" }, questions: noulQuestion, images: [] });
    expect(captures[0]!).not.toHaveProperty("images");
  });

  it("images coexist with includeContext (state merging is untouched)", async () => {
    const captures: CapturedAsk[] = [];
    const agent = await ReactiveAgents.create()
      .withName("judge-images-context")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withLayers(Layer.succeed(JudgmentService, makeFakeJudgmentService(captures)))
      .build();
    agentsToDispose.push(agent);

    await agent.judge({
      state: { action: "x" },
      questions: noulQuestion,
      includeContext: { reasoningSteps: true },
      images: ["base64-img"],
    });

    expect(captures).toHaveLength(1);
    expect(captures[0]!.images).toEqual(["base64-img"]);
    expect(captures[0]!.state).toBeTruthy();
  });

  it("a text-only backend rejects images with JudgmentUnsupported rather than dropping them", async () => {
    const llmCallCount = { count: 0 };
    const agent = await ReactiveAgents.create()
      .withName("judge-images-reject")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withReplayLLM(makeFakeLLMLayer())
      .withJudgment({ backend: "llm" })
      .build();
    agentsToDispose.push(agent);

    let error: Error | null = null;
    try {
      await agent.judge({
        state: { action: "x" },
        questions: noulQuestion,
        images: ["base64-img"],
      });
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e));
    }

    expect(error).not.toBeNull();
    expect(error?.message).toContain("does not support images");
    expect(llmCallCount.count).toBe(0);
  });
});
