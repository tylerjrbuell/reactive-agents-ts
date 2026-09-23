// Run: bun test packages/reasoning/tests/strategies/adaptive-judgment-shadow.test.ts --timeout 15000
//
// Task 9 (shadow-only): the judgment strategy classifier fires speculatively
// at adaptive.ts's selection site but must NEVER alter the strategy the
// existing heuristic/LLM path picked. Covers: agreeing answer, disagreeing
// answer, backend failure/timeout, and JudgmentService entirely absent — all
// four must leave `selectedStrategy` identical to the heuristic-only baseline.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { executeAdaptive } from "../../src/strategies/adaptive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBusLive, EventBus } from "@reactive-agents/core";
import type { AgentEvent } from "@reactive-agents/core";
import { JudgmentService } from "@reactive-agents/judgment";
import type { JudgmentAnswers, JudgmentError } from "@reactive-agents/judgment";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";

type ShadowEvent = Extract<AgentEvent, { _tag: "JudgmentShadow" }>;

// Short, tool-less task → heuristicClassify's "wordCount <= 15 && !hasTools"
// rule fires deterministically ("reactive"), no LLM classification call needed.
const SIMPLE_TASK = "What is 2 plus 2?";

const fakeJudgmentAnswering = (strategyValue: string) =>
  Layer.succeed(JudgmentService, {
    ask: (input) =>
      Effect.succeed({
        strategy: { kind: "choice", value: strategyValue, probabilities: {}, confidence: 0.9, calibrated: true },
        "explicit-steps-given": { kind: "noul", probability: 0.1 },
        "requires-retries-or-debugging": { kind: "noul", probability: 0.1 },
        "single-hop-answerable": { kind: "noul", probability: 0.9 },
      } as unknown as JudgmentAnswers<typeof input.questions>),
  } satisfies JudgmentService["Type"]);

const fakeJudgmentFailing = () =>
  Layer.succeed(JudgmentService, {
    ask: () =>
      Effect.fail({ _tag: "JudgmentTimeout", message: "shadow probe timed out", timeoutMs: 1 } as unknown as JudgmentError),
  } satisfies JudgmentService["Type"]);

/** Runs executeAdaptive, capturing any JudgmentShadow event(s) published. Waits one scheduler tick for the forkDaemon shadow fiber to settle before returning. */
const runWithShadowCapture = async (judgmentLayer?: Layer.Layer<JudgmentService>) => {
  const captured: ShadowEvent[] = [];
  const llmLayer = TestLLMServiceLayer([{ text: "FINAL ANSWER: 4" }]);
  const baseLayer = judgmentLayer ? Layer.merge(Layer.merge(llmLayer, EventBusLive), judgmentLayer) : Layer.merge(llmLayer, EventBusLive);

  const result = await Effect.runPromise(provideTestEnvelope(
    Effect.gen(function* () {
      const eb = yield* EventBus;
      // Filter by site: runKernel() (invoked by the dispatched "reactive"
      // sub-strategy) also fires its own task-comprehension shadow (Task 10)
      // onto the same bus — this test only asserts on the strategy-selection
      // shadow (Task 9).
      yield* eb.on("JudgmentShadow", (event) =>
        Effect.sync(() => { if (event.site === "strategy-selection") captured.push(event); }),
      );

      const adaptiveResult = yield* executeAdaptive({
        taskDescription: SIMPLE_TASK,
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: defaultReasoningConfig,
      });

      // Cooperatively yield so the forkDaemon shadow fiber (fake backend is
      // synchronous) settles before this Effect completes and the fake
      // EventBus subscription goes out of scope.
      yield* Effect.sleep("50 millis");

      return adaptiveResult;
    }).pipe(Effect.provide(baseLayer)),
  ));

  return { result, captured };
};

describe("adaptive judgment strategy-selection shadow (Task 9, shadow-only)", () => {
  it("agreeing judgment answer: shadow reports agreement:true, selection unchanged", async () => {
    const { result, captured } = await runWithShadowCapture(fakeJudgmentAnswering("reactive"));

    expect(result.metadata.selectedStrategy).toBe("reactive");
    expect(captured).toHaveLength(1);
    expect(captured[0]?.site).toBe("strategy-selection");
    expect(captured[0]?.judged).toBe("reactive");
    expect(captured[0]?.current).toBe("reactive");
    expect(captured[0]?.agreement).toBe(true);
  }, 15000);

  it("disagreeing judgment answer: shadow reports agreement:false, selection STILL unchanged", async () => {
    const { result, captured } = await runWithShadowCapture(fakeJudgmentAnswering("tree-of-thought"));

    expect(result.metadata.selectedStrategy).toBe("reactive"); // heuristic's pick, not the judgment's
    expect(captured).toHaveLength(1);
    expect(captured[0]?.judged).toBe("tree-of-thought");
    expect(captured[0]?.current).toBe("reactive");
    expect(captured[0]?.agreement).toBe(false);
  }, 15000);

  it("judgment backend failure/timeout: shadow reports judged:null, agreement:null, selection untouched", async () => {
    const { result, captured } = await runWithShadowCapture(fakeJudgmentFailing());

    expect(result.metadata.selectedStrategy).toBe("reactive");
    expect(captured).toHaveLength(1);
    expect(captured[0]?.judged).toBeNull();
    expect(captured[0]?.agreement).toBeNull();
  }, 15000);

  it("JudgmentService entirely absent (no .withJudgment()): no crash, no shadow event, selection untouched", async () => {
    const { result, captured } = await runWithShadowCapture(undefined);

    expect(result.metadata.selectedStrategy).toBe("reactive");
    expect(captured).toHaveLength(0);
  }, 15000);
});
