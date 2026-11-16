// Run: bun test packages/reasoning/tests/judgment-shadow-priority.test.ts --timeout 15000
//
// Every observation-only (shadow) judgment producer in the reasoning package
// must pass `priority: "shadow"` to `judgment.ask` so the JudgmentService
// concurrency gate bounds it. No reasoning site is decision-driving, so none
// may be left at the default "explicit" priority.
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { JudgmentService, JudgmentTimeout } from "@reactive-agents/judgment";
import { judgmentCompletionShadow } from "../src/kernel/capabilities/verify/completion-judgment-shadow.js";
import { judgmentGroundingFabricationShadow } from "../src/kernel/capabilities/verify/grounding-fabrication-judgment-shadow.js";
import { judgmentComprehendShadow } from "../src/kernel/capabilities/comprehend/judgment-classification.js";
import { classifyTask } from "../src/kernel/capabilities/comprehend/task-classification.js";
import { executeAdaptive } from "../src/strategies/adaptive.js";
import { defaultReasoningConfig } from "../src/types/config.js";
import { provideTestEnvelope } from "../src/kernel/envelope/run-envelope.js";

/** JudgmentService stub that fails every ask and records the priority it was given. */
const recorder = () => {
  const priorities: Array<string | undefined> = [];
  const layer = Layer.succeed(JudgmentService, {
    ask: (input) => {
      priorities.push(input.priority);
      return Effect.fail(new JudgmentTimeout({ message: "stub", timeoutMs: 1 }));
    },
    listModels: () => Effect.succeed([]),
  } satisfies JudgmentService["Type"]);
  return { priorities, layer };
};

const settle = Effect.sleep("50 millis");

describe("shadow judgment producers pass priority: shadow", () => {
  it("completion-satisfied", async () => {
    const { priorities, layer } = recorder();
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* judgmentCompletionShadow({ task: "t", candidateOutput: "o", recentObservations: [], heuristicVerified: true });
        yield* settle;
      }).pipe(Effect.provide(Layer.merge(EventBusLive, layer))),
    );
    expect(priorities).toEqual(["shadow"]);
  });

  it("grounding-fabrication", async () => {
    const { priorities, layer } = recorder();
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* judgmentGroundingFabricationShadow({ claim: "c", evidence: "e", heuristicGrounded: true });
        yield* settle;
      }).pipe(Effect.provide(Layer.merge(EventBusLive, layer))),
    );
    expect(priorities).toEqual(["shadow"]);
  });

  it("comprehend classification", async () => {
    const { priorities, layer } = recorder();
    const task = "What is the capital of France?";
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* judgmentComprehendShadow(
          () => ({ task, classification: classifyTask(task), nominatedToolNames: new Set<string>(), availableToolNames: [] }),
          Option.none(),
        );
        yield* settle;
      }).pipe(Effect.provide(layer)),
    );
    expect(priorities.length).toBeGreaterThan(0);
    expect(priorities.every((p) => p === "shadow")).toBe(true);
  });

  it("adaptive strategy-selection", async () => {
    const { priorities, layer } = recorder();
    const llm = TestLLMServiceLayer([{ text: "FINAL ANSWER: 4" }]);
    await Effect.runPromise(
      provideTestEnvelope(
        Effect.gen(function* () {
          yield* executeAdaptive({
            taskDescription: "What is 2 plus 2?",
            taskType: "query",
            memoryContext: "",
            availableTools: [],
            config: defaultReasoningConfig,
          });
          yield* settle;
        }).pipe(Effect.provide(Layer.merge(Layer.merge(llm, EventBusLive), layer))),
      ),
    );
    // runKernel's comprehend shadow also asks on this path; every ask is a shadow.
    expect(priorities.length).toBeGreaterThan(0);
    expect(priorities.every((p) => p === "shadow")).toBe(true);
  }, 15000);
});
