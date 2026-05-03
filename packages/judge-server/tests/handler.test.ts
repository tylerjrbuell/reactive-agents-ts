// Run: bun test packages/judge-server/tests/handler.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { JudgeLLMService } from "@reactive-agents/eval";
import { handleJudgeRequest } from "../src/handler.js";
import type { JudgeRequest } from "../src/contract.js";

// Stub the JudgeLLMService Tag from @reactive-agents/eval. The shape now matches
// CompletionRequest → CompletionResponse (Task 6 alignment), so the stub returns
// a CompletionResponse with the judgment payload as `content`.
const makeStubLayer = (textResponse: string): Layer.Layer<JudgeLLMService> =>
  Layer.succeed(
    JudgeLLMService,
    JudgeLLMService.of({
      complete: () =>
        Effect.succeed({
          content: textResponse,
          stopReason: "end_turn" as const,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            estimatedCost: 0,
          },
          model: "stub-judge",
        }),
    }),
  );

describe("judge handler — handleJudgeRequest", () => {
  it("returns a JudgeResponse with reproducibility metadata for a passing verdict", async () => {
    const req: JudgeRequest = {
      taskId: "t-001",
      sutResponse: "Paris is the capital of France.",
      taskInput: { question: "Capital of France?" },
      sutModel: "claude-sonnet-4-6",
      runId: "r-1",
    };
    // Stub returns a structured judgment text the handler can parse
    const stubText = JSON.stringify({
      passed: true,
      overallScore: 0.95,
      recommendation: "accept",
      layerResults: [{ layerName: "factuality", score: 0.95, passed: true }],
    });

    const result = await Effect.runPromise(
      handleJudgeRequest(req, { judgeModelSha: "judge-sha", judgeCodeSha: "code-sha" })
        .pipe(Effect.provide(makeStubLayer(stubText)))
    );

    expect(result.taskId).toBe("t-001");
    expect(result.passed).toBe(true);
    expect(result.overallScore).toBe(0.95);
    expect(result.recommendation).toBe("accept");
    expect(result.reproducibility.judgeModelSha).toBe("judge-sha");
    expect(result.reproducibility.judgeCodeSha).toBe("code-sha");
  }, 15000);

  it("returns a rejecting verdict when the judge text indicates failure", async () => {
    const req: JudgeRequest = {
      taskId: "t-002",
      sutResponse: "I don't know.",
      taskInput: { question: "Capital of France?" },
      sutModel: "claude-sonnet-4-6",
      runId: "r-2",
    };
    const stubText = JSON.stringify({
      passed: false,
      overallScore: 0.2,
      recommendation: "reject",
      layerResults: [{ layerName: "factuality", score: 0.2, passed: false, details: "Did not answer" }],
    });

    const result = await Effect.runPromise(
      handleJudgeRequest(req, { judgeModelSha: "j", judgeCodeSha: "c" })
        .pipe(Effect.provide(makeStubLayer(stubText)))
    );

    expect(result.passed).toBe(false);
    expect(result.recommendation).toBe("reject");
    expect(result.layerResults[0].details).toBe("Did not answer");
  }, 15000);

  it("propagates the runId in the response metadata via the response shape (not yet — taskId is the link)", async () => {
    // taskId is the response's link to the request; runId is recorded by the bench client.
    // This test pins that taskId is preserved 1:1.
    const req: JudgeRequest = {
      taskId: "t-003-runid-link",
      sutResponse: "x",
      taskInput: {},
      sutModel: "m",
      runId: "r-3",
    };
    const stubText = JSON.stringify({
      passed: true, overallScore: 0.5, recommendation: "review", layerResults: [],
    });

    const result = await Effect.runPromise(
      handleJudgeRequest(req, { judgeModelSha: "j", judgeCodeSha: "c" })
        .pipe(Effect.provide(makeStubLayer(stubText)))
    );

    expect(result.taskId).toBe("t-003-runid-link");
  }, 15000);

  it("returns a degraded 'review' verdict when judge text is unparseable", async () => {
    const req: JudgeRequest = {
      taskId: "t-004",
      sutResponse: "x",
      taskInput: {},
      sutModel: "m",
      runId: "r-4",
    };
    const result = await Effect.runPromise(
      handleJudgeRequest(req, { judgeModelSha: "j", judgeCodeSha: "c" })
        .pipe(Effect.provide(makeStubLayer("this is not JSON at all")))
    );
    expect(result.passed).toBe(false);
    expect(result.recommendation).toBe("review");
    expect(result.layerResults[0].layerName).toBe("judge_parse_failure");
  }, 15000);
});
