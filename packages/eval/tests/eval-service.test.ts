import { describe, it, expect } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { EvalService, EvalServiceLive } from "../src/services/eval-service.js";
import type { EvalSuite } from "../src/types/eval-case.js";

// Deterministic LLM that returns "0.8" for all scoring prompts
const TestLLMLayer = Layer.succeed(LLMService, {
  complete: (_params) =>
    Effect.succeed({
      content: "0.8",
      stopReason: "end_turn" as const,
      model: "test",
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, estimatedCost: 0 },
    }),
  stream: (_params) => Effect.succeed(Stream.empty),
  completeStructured: (_params) => Effect.succeed({} as never),
  embed: (_texts, _model) => Effect.succeed([[]]),
  countTokens: (_messages) => Effect.succeed(0),
  getModelConfig: () =>
    Effect.succeed({ provider: "test", model: "test", costPer1MInput: 0, costPer1MOutput: 0 }),
});

// Provide LLMService to EvalServiceLive during construction (llm captured in closure)
const EvalLayer = EvalServiceLive.pipe(Layer.provide(TestLLMLayer));

const makeSuite = (id: string, dimensions: string[]): EvalSuite => ({
  id,
  name: `Test Suite ${id}`,
  description: "Test suite",
  cases: [
    {
      id: "case-1",
      name: "Simple case",
      input: "What is 2+2?",
      expectedOutput: "4",
    },
    {
      id: "case-2",
      name: "No expected output",
      input: "Tell me about Paris.",
    },
  ],
  dimensions,
});

describe("EvalService", () => {
  it("runSuite scores all cases across requested dimensions", async () => {
    const program = Effect.gen(function* () {
      const evalService = yield* EvalService;
      const suite = makeSuite("suite-1", ["accuracy", "relevance"]);
      const run = yield* evalService.runSuite(suite, "anthropic/claude");
      return run;
    });

    const run = await Effect.runPromise(program.pipe(Effect.provide(EvalLayer)));

    expect(run.suiteId).toBe("suite-1");
    expect(run.results).toHaveLength(2);
    expect(run.results[0].scores).toHaveLength(2);
    expect(run.results[0].scores[0].dimension).toBe("accuracy");
    expect(run.results[0].scores[0].score).toBeCloseTo(0.8);
    expect(run.results[0].passed).toBe(true); // 0.8 >= 0.7 threshold
    expect(run.summary.totalCases).toBe(2);
    expect(run.summary.passed).toBe(2);
    expect(run.summary.avgScore).toBeCloseTo(0.8);
  });

  it("runCase scores a single case with real output", async () => {
    const program = Effect.gen(function* () {
      const evalService = yield* EvalService;
      const evalCase = {
        id: "case-1",
        name: "Direct case",
        input: "What is the capital of France?",
        expectedOutput: "Paris",
      };
      return yield* evalService.runCase(
        evalCase,
        "openai/gpt-4o",
        ["accuracy", "completeness"],
        "The capital of France is Paris.",
        { latencyMs: 120, costUsd: 0.0005, tokensUsed: 50, stepsExecuted: 1 },
      );
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(EvalLayer)));

    expect(result.caseId).toBe("case-1");
    expect(result.actualOutput).toBe("The capital of France is Paris.");
    expect(result.latencyMs).toBe(120);
    expect(result.costUsd).toBeCloseTo(0.0005);
    expect(result.scores).toHaveLength(2);
    expect(result.overallScore).toBeCloseTo(0.8);
  });

  it("compare detects improvements and regressions between runs", async () => {
    const program = Effect.gen(function* () {
      const evalService = yield* EvalService;
      const suite = makeSuite("suite-compare", ["accuracy", "safety"]);

      // Run A (baseline)
      const runA = yield* evalService.runSuite(suite, "anthropic/claude-haiku");

      // Run B with injected overrides — simulate a better accuracy, worse safety
      const runB: typeof runA = {
        ...runA,
        id: crypto.randomUUID(),
        summary: {
          ...runA.summary,
          dimensionAverages: { accuracy: 0.95, safety: 0.4 },
          avgScore: 0.675,
        },
      };

      return yield* evalService.compare(runA, runB);
    });

    const diff = await Effect.runPromise(program.pipe(Effect.provide(EvalLayer)));

    expect(diff.improved).toContain("accuracy");
    expect(diff.regressed).toContain("safety");
  });

  it("checkRegression flags overall score drops beyond threshold", async () => {
    const program = Effect.gen(function* () {
      const evalService = yield* EvalService;
      const suite = makeSuite("suite-reg", ["relevance"]);
      const baseline = yield* evalService.runSuite(suite, "anthropic/claude-sonnet");

      const degraded: typeof baseline = {
        ...baseline,
        id: crypto.randomUUID(),
        summary: { ...baseline.summary, avgScore: 0.5 },
      };

      return yield* evalService.checkRegression(degraded, baseline, 0.05);
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(EvalLayer)));

    expect(result.hasRegression).toBe(true);
    expect(result.details.length).toBeGreaterThan(0);
    expect(result.details[0]).toContain("overall");
  });

  it("checkRegression returns no regression when scores are stable", async () => {
    const program = Effect.gen(function* () {
      const evalService = yield* EvalService;
      const suite = makeSuite("suite-stable", ["accuracy"]);
      const baseline = yield* evalService.runSuite(suite, "anthropic/claude-sonnet");
      // Same run = no regression
      return yield* evalService.checkRegression(baseline, baseline, 0.05);
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(EvalLayer)));

    expect(result.hasRegression).toBe(false);
    expect(result.details).toHaveLength(0);
  });

  it("getHistory returns runs for the given suiteId", async () => {
    const program = Effect.gen(function* () {
      const evalService = yield* EvalService;
      const suite = makeSuite("suite-history", ["relevance"]);
      yield* evalService.runSuite(suite, "anthropic/claude");
      yield* evalService.runSuite(suite, "openai/gpt-4o");
      yield* evalService.runSuite(makeSuite("other-suite", ["accuracy"]), "anthropic/claude");
      return yield* evalService.getHistory("suite-history");
    });

    const history = await Effect.runPromise(program.pipe(Effect.provide(EvalLayer)));

    expect(history).toHaveLength(2);
    expect(history.every((r) => r.suiteId === "suite-history")).toBe(true);
  });

  it("scores cost-efficiency dimension without LLM call", async () => {
    const program = Effect.gen(function* () {
      const evalService = yield* EvalService;
      const evalCase = {
        id: "cost-case",
        name: "Cost test",
        input: "Summarize this document.",
      };
      return yield* evalService.runCase(
        evalCase,
        "openai/gpt-4o-mini",
        ["cost-efficiency"],
        "Here is the summary.",
        { costUsd: 0.001 },
      );
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(EvalLayer)));

    expect(result.scores).toHaveLength(1);
    expect(result.scores[0].dimension).toBe("cost-efficiency");
    expect(result.scores[0].score).toBeGreaterThanOrEqual(0);
    expect(result.scores[0].score).toBeLessThanOrEqual(1);
  });
});
