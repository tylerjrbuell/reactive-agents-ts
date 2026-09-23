import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { JudgmentService } from "@reactive-agents/judgment";
import type { JudgmentAnswers, JudgmentError } from "@reactive-agents/judgment";
import { EvalService, EvalServiceLive, type SuiteAgentRunner } from "../src/services/eval-service.js";
import { JudgeLLMService } from "../src/services/judge-llm-service.js";
import type { EvalSuite } from "../src/types/eval-case.js";

/**
 * Task 3 Step 2: the `judgeEngine` seam. Three modes, exercised against the
 * real `EvalServiceLive` (not a reimplementation): (a) jev routes scoring
 * through `JudgmentService`, (b) no `JudgmentService` wired degrades to the
 * `llm` path byte-for-byte (regression lock — same fixture as
 * eval-service.test.ts's existing "0.8" judge), (c) `judgeEngine:"llm"`
 * with a JudgmentService wired still uses the `llm` path (explicit opt-out
 * honored).
 */

const TestJudgeLayer = Layer.succeed(JudgeLLMService, {
  complete: (_params) =>
    Effect.succeed({
      content: "0.8",
      stopReason: "end_turn" as const,
      model: "judge-test",
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, estimatedCost: 0 },
    }),
});

/** Fake JudgmentService returning a deterministic Score for every question ("jev decided 1.0" = full marks). */
const makeFakeJudgmentLayer = (callLog: { count: number }) =>
  Layer.succeed(JudgmentService, {
    ask: (input) => {
      callLog.count += 1;
      const answers: Record<string, { kind: "score"; value: number; probabilities: Record<string, number>; confidence: number; calibrated: boolean }> = {};
      for (const id of Object.keys(input.questions)) {
        answers[id] = { kind: "score", value: 2, probabilities: {}, confidence: 0.93, calibrated: true };
      }
      return Effect.succeed(answers as unknown as JudgmentAnswers<typeof input.questions>);
    },
    listModels: () => Effect.succeed([]),
  });

const FailingJudgmentLayer = Layer.succeed(JudgmentService, {
  ask: () =>
    Effect.fail({ _tag: "JudgmentTimeout", message: "too slow", timeoutMs: 3000 } as unknown as JudgmentError),
  listModels: () => Effect.succeed([]),
});

const stubAgentRunner: SuiteAgentRunner = (input) =>
  Effect.succeed({
    actualOutput: `SUT response to: ${input}`,
    metrics: { latencyMs: 50, costUsd: 0.0001, tokensUsed: 25, stepsExecuted: 1 },
  });

const makeSuite = (id: string): EvalSuite => ({
  id,
  name: `Test Suite ${id}`,
  description: "Test suite",
  cases: [{ id: "case-1", name: "Case 1", input: "What is 2+2?", expectedOutput: "4" }],
  dimensions: ["accuracy", "relevance"],
});

describe("judgeEngine seam", () => {
  it("default (jev, JudgmentService wired): scores come from the ONE batched judgment call, not the llm path", async () => {
    const callLog = { count: 0 };
    const layer = EvalServiceLive.pipe(
      Layer.provide(TestJudgeLayer),
      Layer.provideMerge(makeFakeJudgmentLayer(callLog)),
    );

    const run = await Effect.runPromise(
      Effect.gen(function* () {
        const evalService = yield* EvalService;
        return yield* evalService.runSuite(makeSuite("jev-suite"), "anthropic/claude", stubAgentRunner);
      }).pipe(Effect.provide(layer)),
    );

    // Fake judgment always answers score=2 (max of a 3-level rubric) -> normalized 1.0,
    // not the llm fixture's 0.8 -- proves the jev path, not the llm path, decided this.
    expect(run.results[0]?.scores[0]?.score).toBeCloseTo(1.0);
    expect(run.results[0]?.scores[0]?.confidence).toBeCloseTo(0.93);
    // ONE batched call per case (both dimensions in one ask()), not one per dimension.
    expect(callLog.count).toBe(1);
  });

  it("no JudgmentService wired: degrades to the llm path byte-for-byte (regression lock)", async () => {
    const layer = EvalServiceLive.pipe(Layer.provide(TestJudgeLayer));

    const run = await Effect.runPromise(
      Effect.gen(function* () {
        const evalService = yield* EvalService;
        return yield* evalService.runSuite(makeSuite("no-judgment-suite"), "anthropic/claude", stubAgentRunner);
      }).pipe(Effect.provide(layer)),
    );

    expect(run.results[0]?.scores[0]?.score).toBeCloseTo(0.8); // the llm fixture's fixed answer
    expect(run.results[0]?.scores[0]?.confidence).toBeUndefined(); // llm path has no calibration concept
  });

  it("a failing JudgmentService degrades that case to the llm path, never fails the run", async () => {
    const layer = EvalServiceLive.pipe(
      Layer.provide(TestJudgeLayer),
      Layer.provideMerge(FailingJudgmentLayer),
    );

    const run = await Effect.runPromise(
      Effect.gen(function* () {
        const evalService = yield* EvalService;
        return yield* evalService.runSuite(makeSuite("failing-judgment-suite"), "anthropic/claude", stubAgentRunner);
      }).pipe(Effect.provide(layer)),
    );

    expect(run.results[0]?.scores[0]?.score).toBeCloseTo(0.8); // fell through to the llm fixture
  });
});
