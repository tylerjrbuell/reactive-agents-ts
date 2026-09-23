import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { JudgmentService } from "@reactive-agents/judgment";
import { EvalService, EvalServiceLive, type SuiteAgentRunner } from "../src/services/eval-service.js";
import { JudgeLLMService } from "../src/services/judge-llm-service.js";
import type { EvalSuite } from "../src/types/eval-case.js";

/** Deterministic judge whose answer VARIES per call (0.75, 0.80, 0.85, ...) — simulates real judge noise across repeats. */
const makeNoisyJudgeLayer = () => {
  let call = 0;
  return Layer.succeed(JudgeLLMService, {
    complete: (_params) => {
      const score = 0.75 + (call % 5) * 0.025; // cycles 0.75..0.85
      call += 1;
      return Effect.succeed({
        content: score.toFixed(3),
        stopReason: "end_turn" as const,
        model: "judge-test",
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, estimatedCost: 0 },
      });
    },
  });
};

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
  dimensions: ["accuracy"],
});

describe("Task 6: repeats + variance-aware checkRegression", () => {
  it("repeats:1 (default) reports no variance data — unchanged from pre-Task-6 behavior", async () => {
    const layer = EvalServiceLive.pipe(Layer.provide(makeNoisyJudgeLayer()));
    const run = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EvalService;
        return yield* svc.runSuite(makeSuite("s1"), "anthropic/claude", stubAgentRunner);
      }).pipe(Effect.provide(layer)),
    );

    expect(run.summary.dimensionVariance).toBeUndefined();
    expect(run.summary.repeats).toBe(1);
  });

  it("repeats:5 pools every repeat's score into run-level variance, and the case score is the mean", async () => {
    const layer = EvalServiceLive.pipe(Layer.provide(makeNoisyJudgeLayer()));
    const run = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EvalService;
        return yield* svc.runSuite(makeSuite("s2"), "anthropic/claude", stubAgentRunner, { repeats: 5 });
      }).pipe(Effect.provide(layer)),
    );

    expect(run.summary.repeats).toBe(5);
    const accVar = run.summary.dimensionVariance?.accuracy;
    expect(accVar).toBeDefined();
    expect(accVar?.n).toBe(5); // 1 case x 5 repeats
    expect(accVar?.mean).toBeCloseTo(0.8, 1); // mean of 0.75,0.775,0.8,0.825,0.85
    expect(accVar!.stddev).toBeGreaterThan(0); // judge noise is real, not collapsed to 0
    expect(accVar!.ci95Low).toBeLessThan(accVar!.mean);
    expect(accVar!.ci95High).toBeGreaterThan(accVar!.mean);
  });

  it("checkRegression uses MDE (not the flat threshold) when both runs carry variance data", async () => {
    const layer = EvalServiceLive.pipe(Layer.provide(makeNoisyJudgeLayer()));
    const [baseline, current, svc] = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EvalService;
        const baseline = yield* svc.runSuite(makeSuite("s3"), "anthropic/claude", stubAgentRunner, { repeats: 10 });
        const current = yield* svc.runSuite(makeSuite("s3"), "anthropic/claude", stubAgentRunner, { repeats: 10 });
        return [baseline, current, svc] as const;
      }).pipe(Effect.provide(layer)),
    );

    // A tiny hand-perturbed "current" run one stddev below baseline's mean —
    // small enough that the OLD flat-threshold (0.05 default) would likely
    // flag it, but well within MDE noise at n=10 given real judge variance.
    const perturbedCurrent = {
      ...current,
      summary: {
        ...current.summary,
        dimensionAverages: {
          accuracy: baseline.summary.dimensionAverages.accuracy! - (baseline.summary.dimensionVariance!.accuracy!.stddev * 0.3),
        },
      },
    };

    const result = await Effect.runPromise(svc.checkRegression(perturbedCurrent, baseline));
    // Small perturbation within noise -> MDE-based check should NOT flag it.
    expect(result.hasRegression).toBe(false);

    // Now perturb by MANY stddevs -- a real regression, must still be caught.
    const bigRegression = {
      ...current,
      summary: {
        ...current.summary,
        dimensionAverages: { accuracy: 0.0 },
      },
    };
    const bigResult = await Effect.runPromise(svc.checkRegression(bigRegression, baseline));
    expect(bigResult.hasRegression).toBe(true);
    expect(bigResult.details[0]).toContain("MDE=");
  });

  it("code-review fix: a jev flake mid-case does NOT blend a llm-fallback sample into the case's jev-sourced repeat stats", async () => {
    // jev always answers `relevance` with a fixed HIGH score, EXCEPT one
    // call out of 5, which fails outright (a transient flake). llm's fixed
    // fixture (below) answers a fixed LOW score. If a llm-fallback sample
    // ever gets pooled alongside the jev samples for this case+dimension,
    // the case's mean drops noticeably below the jev-only value and its
    // stddev becomes nonzero (jev's own samples are all identical).
    let jevCall = 0;
    const flakyJevLayer = Layer.succeed(JudgmentService, {
      ask: (input) => {
        jevCall += 1;
        if (jevCall === 2) {
          return Effect.fail({ _tag: "JudgmentTimeout", message: "flake", timeoutMs: 1 } as never);
        }
        const answers: Record<string, unknown> = {};
        for (const id of Object.keys(input.questions)) {
          answers[id] = { kind: "score", value: 2, probabilities: {}, confidence: 0.95, calibrated: true }; // top of a 0-2 rubric -> 1.0
        }
        return Effect.succeed(answers as never);
      },
      listModels: () => Effect.succeed([]),
    });
    const lowLlmLayer = Layer.succeed(JudgeLLMService, {
      complete: () =>
        Effect.succeed({
          content: "0.100", // deliberately far from jev's 1.0
          stopReason: "end_turn" as const,
          model: "judge-test",
          usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, estimatedCost: 0 },
        }),
    });
    const layer = EvalServiceLive.pipe(Layer.provide(lowLlmLayer), Layer.provideMerge(flakyJevLayer));

    const run = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EvalService;
        return yield* svc.runSuite(makeSuite("s5"), "anthropic/claude", stubAgentRunner, { repeats: 5 });
      }).pipe(Effect.provide(layer)),
    );

    expect(jevCall).toBe(5); // confirms the flake actually happened mid-case
    // Fix in effect: the flaky repeat's llm-fallback sample is EXCLUDED from
    // this case's stats once ANY jev sample exists for this dim -- the case
    // score stays at jev's exact value (1.0), not pulled toward llm's 0.1.
    expect(run.results[0]?.scores[0]?.score).toBeCloseTo(1.0);
    // And the run-level pooled stddev for this case's contribution is 0 --
    // jev answered identically on all 4 successful calls, no llm sample mixed in.
    expect(run.summary.dimensionVariance?.accuracy?.stddev).toBe(0);
  });

  it("checkRegression falls back to the flat threshold when either run lacks variance data (repeats:1)", async () => {
    const layer = EvalServiceLive.pipe(Layer.provide(makeNoisyJudgeLayer()));
    const [baseline, current, svc] = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EvalService;
        const baseline = yield* svc.runSuite(makeSuite("s4"), "anthropic/claude", stubAgentRunner); // repeats:1
        const current = yield* svc.runSuite(makeSuite("s4"), "anthropic/claude", stubAgentRunner);
        return [baseline, current, svc] as const;
      }).pipe(Effect.provide(layer)),
    );

    const droppedCurrent = {
      ...current,
      summary: { ...current.summary, dimensionAverages: { accuracy: baseline.summary.dimensionAverages.accuracy! - 0.1 } },
    };
    const result = await Effect.runPromise(svc.checkRegression(droppedCurrent, baseline, 0.05));
    expect(result.hasRegression).toBe(true);
    expect(result.details[0]).not.toContain("MDE="); // flat-threshold path, not MDE
  });
});
