import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EvalService, EvalServiceLive, type SuiteAgentRunner } from "../src/services/eval-service.js";
import { JudgeLLMService } from "../src/services/judge-llm-service.js";
import { BenchmarkError } from "../src/errors/errors.js";
import type { EvalSuite } from "../src/types/eval-case.js";

// W9 frozen judge — provide JudgeLLMService (NOT LLMService) so the judge
// code path is isolated from the SUT per Rule 4 of 00-RESEARCH-DISCIPLINE.md.
// Deterministic judge returns "0.8" for every scoring prompt.
const TestJudgeLayer = Layer.succeed(JudgeLLMService, {
  complete: (_params) =>
    Effect.succeed({
      content: "0.8",
      stopReason: "end_turn" as const,
      model: "judge-test",
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, estimatedCost: 0 },
    }),
});

const EvalLayer = EvalServiceLive.pipe(Layer.provide(TestJudgeLayer));

// Stub SuiteAgentRunner — pretends to "run the SUT" by returning a
// deterministic actualOutput per input. Tests that do not care about
// specific output content use this.
const stubAgentRunner: SuiteAgentRunner = (input) =>
  Effect.succeed({
    actualOutput: `SUT response to: ${input}`,
    metrics: { latencyMs: 50, costUsd: 0.0001, tokensUsed: 25, stepsExecuted: 1 },
  });

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
      const run = yield* evalService.runSuite(suite, "anthropic/claude", stubAgentRunner);
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

    // FIX-22: actualOutput is the SUT runner's real output, not a placeholder
    expect(run.results[0].actualOutput).toBe("SUT response to: What is 2+2?");
    expect(run.results[1].actualOutput).toBe("SUT response to: Tell me about Paris.");
    expect(run.results[0].costUsd).toBeCloseTo(0.0001);
    expect(run.results[0].tokensUsed).toBe(25);
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
      const runA = yield* evalService.runSuite(suite, "anthropic/claude-haiku", stubAgentRunner);

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
      const baseline = yield* evalService.runSuite(suite, "anthropic/claude-sonnet", stubAgentRunner);

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
      const baseline = yield* evalService.runSuite(suite, "anthropic/claude-sonnet", stubAgentRunner);
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
      yield* evalService.runSuite(suite, "anthropic/claude", stubAgentRunner);
      yield* evalService.runSuite(suite, "openai/gpt-4o", stubAgentRunner);
      yield* evalService.runSuite(makeSuite("other-suite", ["accuracy"]), "anthropic/claude", stubAgentRunner);
      return yield* evalService.getHistory("suite-history");
    });

    const history = await Effect.runPromise(program.pipe(Effect.provide(EvalLayer)));

    expect(history).toHaveLength(2);
    expect(history.every((r) => r.suiteId === "suite-history")).toBe(true);
  });

  // ── T10 (Rule 4 frozen judge) — judge model must differ from SUT ────────
  // FIX-22 added a runtime guard: if `config.judge.model` equals
  // `agentConfig`, runSuite fails with BenchmarkError. This pins the
  // contract so wiring both Tags to the same provider/model is rejected.
  it("runSuite rejects judge.model === sutModel (Rule 4 / T10 / FIX-22)", async () => {
    const program = Effect.gen(function* () {
      const evalService = yield* EvalService;
      const suite = makeSuite("rule4-suite", ["accuracy"]);
      const sameModel = "anthropic/claude-haiku-4-5";

      return yield* evalService
        .runSuite(suite, sameModel, stubAgentRunner, {
          judge: { model: sameModel, provider: "anthropic" },
        })
        .pipe(Effect.flip);
    });

    const err = await Effect.runPromise(program.pipe(Effect.provide(EvalLayer)));
    expect(err).toBeInstanceOf(BenchmarkError);
    expect(err.message).toContain("Rule 4 violation");
    expect(err.message).toContain(`"anthropic/claude-haiku-4-5"`);
  });

  it("runSuite accepts judge.model !== sutModel (Rule 4 / T10 happy path)", async () => {
    const program = Effect.gen(function* () {
      const evalService = yield* EvalService;
      const suite = makeSuite("rule4-ok", ["accuracy"]);
      return yield* evalService.runSuite(
        suite,
        "openai/gpt-4o",
        stubAgentRunner,
        { judge: { model: "claude-haiku-4-5", provider: "anthropic" } },
      );
    });

    const run = await Effect.runPromise(program.pipe(Effect.provide(EvalLayer)));
    expect(run.results).toHaveLength(2);
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
