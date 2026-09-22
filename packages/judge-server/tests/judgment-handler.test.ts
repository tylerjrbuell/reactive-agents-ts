// Run: bun test packages/judge-server/tests/judgment-handler.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { JudgmentService } from "@reactive-agents/judgment";
import type { JudgmentAnswers } from "@reactive-agents/judgment";
import { handleJudgeRequestViaJudgment } from "../src/judgment-handler.js";
import type { JudgeRequest } from "../src/contract.js";

const REQ: JudgeRequest = {
  taskId: "t-jev-001",
  sutResponse: "Paris is the capital of France.",
  taskInput: { question: "Capital of France?" },
  sutModel: "claude-sonnet-4-6",
  runId: "r-1",
  taskCriteria: "Must correctly name the capital.",
};

const REPRO = { judgeModelSha: "jev-latest", judgeCodeSha: "code-sha" };

/** ONE call, batched — asserts on the actual question set the handler sends. */
const makeStubLayer = (
  respond: (questionIds: string[]) => Record<string, unknown>,
  callLog?: { count: number },
): Layer.Layer<JudgmentService> =>
  Layer.succeed(JudgmentService, {
    ask: (input) => {
      if (callLog) callLog.count += 1;
      return Effect.succeed(respond(Object.keys(input.questions)) as unknown as JudgmentAnswers<typeof input.questions>);
    },
  });

describe("judgment-handler — handleJudgeRequestViaJudgment", () => {
  it("answers passed/overallScore/recommendation in ONE batched call — no text parsing", async () => {
    const callLog = { count: 0 };
    const layer = makeStubLayer(
      () => ({
        passed: { kind: "noul", probability: 0.9 },
        overallScore: { kind: "score", value: 4, probabilities: {}, confidence: 0.85, calibrated: true },
        recommendation: { kind: "choice", value: "accept", probabilities: { accept: 0.9 }, confidence: 0.9, calibrated: true },
      }),
      callLog,
    );

    const result = await Effect.runPromise(handleJudgeRequestViaJudgment(REQ, REPRO).pipe(Effect.provide(layer)));

    expect(callLog.count).toBe(1);
    expect(result.taskId).toBe("t-jev-001");
    expect(result.passed).toBe(true);
    expect(result.overallScore).toBeCloseTo(1.0); // value=4 of a 5-level (0-4) rubric -> 1.0
    expect(result.recommendation).toBe("accept");
    expect(result.layerResults).toHaveLength(1);
    expect(result.layerResults[0]?.layerName).toBe("jev");
    expect(result.reproducibility).toEqual(REPRO);
  });

  it("maps partial credit correctly (value between rubric levels)", async () => {
    const layer = makeStubLayer(() => ({
      passed: { kind: "noul", probability: 0.4 },
      overallScore: { kind: "score", value: 2, probabilities: {}, confidence: 0.6, calibrated: true }, // 2 of 0-4 -> 0.5
      recommendation: { kind: "choice", value: "review", probabilities: { review: 0.7 }, confidence: 0.7, calibrated: true },
    }));

    const result = await Effect.runPromise(handleJudgeRequestViaJudgment(REQ, REPRO).pipe(Effect.provide(layer)));

    expect(result.overallScore).toBeCloseTo(0.5);
    expect(result.passed).toBe(false); // probability < 0.5
    expect(result.recommendation).toBe("review");
  });

  it("never fabricates a verdict on a wrong-shaped answer — the Effect fails, it does not silently default", async () => {
    const layer = makeStubLayer(() => ({
      passed: { kind: "noul", probability: 0.9 },
      overallScore: { kind: "score", value: 4, probabilities: {}, confidence: 0.9, calibrated: true },
      recommendation: { kind: "noul", probability: 0.9 }, // wrong shape for a Choice question
    }));

    const outcome = await Effect.runPromise(
      handleJudgeRequestViaJudgment(REQ, REPRO).pipe(Effect.provide(layer), Effect.either),
    );

    expect(outcome._tag).toBe("Left");
  });

  it("propagates a JudgmentService failure (e.g. timeout) rather than degrading silently — parity with the llm engine's failure behavior", async () => {
    const layer = Layer.succeed(JudgmentService, {
      ask: () => Effect.fail({ _tag: "JudgmentTimeout", message: "too slow", timeoutMs: 3000 } as never),
    });

    const outcome = await Effect.runPromise(
      handleJudgeRequestViaJudgment(REQ, REPRO).pipe(Effect.provide(layer), Effect.either),
    );

    expect(outcome._tag).toBe("Left");
  });
});
