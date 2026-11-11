import { describe, it, expect } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvalService, EvalServiceLive, makeEvalServiceLive, type SuiteAgentRunner } from "../src/services/eval-service.js";
import { createEvalStore } from "../src/services/eval-store.js";
import { JudgeLLMService } from "../src/services/judge-llm-service.js";
import { EvalSuiteSchema, type EvalSuite } from "../src/types/eval-case.js";

// Counts judge calls so tests can prove structured cases never reach an LLM.
const makeJudge = () => {
  let calls = 0;
  const layer = Layer.succeed(JudgeLLMService, {
    complete: (_params) =>
      Effect.sync(() => {
        calls++;
        return {
          content: "0.8",
          stopReason: "end_turn" as const,
          model: "judge-test",
          usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, estimatedCost: 0 },
        };
      }),
  });
  return { layer: EvalServiceLive.pipe(Layer.provide(layer)), calls: () => calls };
};

const jsonRunner = (outputs: Record<string, unknown>): SuiteAgentRunner => (input) =>
  Effect.succeed({ actualOutput: JSON.stringify(outputs[input] ?? null) });

const suite: EvalSuite = {
  id: "structured-suite",
  name: "Structured",
  description: "Typed results graded field by field",
  dimensions: ["accuracy"],
  cases: [
    {
      id: "exact",
      name: "all fields right",
      input: "q1",
      structured: { fields: { city: "Paris", population: 2_100_000 }, numericTolerance: 100_000 },
    },
    {
      id: "partial",
      name: "one field wrong",
      input: "q2",
      structured: {
        fields: { city: "Paris" },
        checks: [{ kind: "approx", path: "/population", value: 2_100_000, tolerance: 1000 }],
      },
    },
  ],
};

const outputs = {
  q1: { city: "Paris", population: 2_150_000, country: "FR" },
  q2: { city: "Paris", population: 3_000_000 },
};

describe("EvalSuite structured cases", () => {
  it("suite JSON with `structured` decodes through EvalSuiteSchema", () => {
    const decoded = Schema.decodeUnknownSync(EvalSuiteSchema)(JSON.parse(JSON.stringify(suite)));
    expect(decoded.cases[1]?.structured?.checks?.[0]?.kind).toBe("approx");
  });

  it("grades structured cases deterministically with zero judge calls and per-field results", async () => {
    const judge = makeJudge();
    const run = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EvalService;
        return yield* svc.runSuite(suite, "sut-model", jsonRunner(outputs));
      }).pipe(Effect.provide(judge.layer)),
    );

    expect(judge.calls()).toBe(0);
    const [exact, partial] = run.results;
    expect(exact?.scores).toEqual([{ dimension: "structured", score: 1, details: expect.any(String) }]);
    expect(exact?.passed).toBe(true);
    expect(partial?.passed).toBe(false);
    expect(partial?.overallScore).toBeCloseTo(0.5);
    const failed = partial?.fieldResults?.filter((f) => f.outcome === "fail") ?? [];
    expect(failed.map((f) => f.path)).toEqual(["/population"]);
    expect(run.summary.passed).toBe(1);
    expect(run.summary.failed).toBe(1);
    expect(run.summary.dimensionAverages["structured"]).toBeCloseTo(0.75);
  });

  it("prefers the runner's structuredOutput over parsing actualOutput", async () => {
    const judge = makeJudge();
    const runner: SuiteAgentRunner = (input) =>
      Effect.succeed({ actualOutput: "prose answer", structuredOutput: outputs[input as keyof typeof outputs] });
    const run = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EvalService;
        return yield* svc.runSuite(suite, "sut-model", runner);
      }).pipe(Effect.provide(judge.layer)),
    );
    expect(run.results[0]?.passed).toBe(true);
  });

  it("output that is not JSON fails with a json field result", async () => {
    const judge = makeJudge();
    const runner: SuiteAgentRunner = () => Effect.succeed({ actualOutput: "Paris, about 2 million" });
    const run = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EvalService;
        return yield* svc.runSuite(suite, "sut-model", runner);
      }).pipe(Effect.provide(judge.layer)),
    );
    expect(run.results[0]?.passed).toBe(false);
    expect(run.results[0]?.fieldResults?.[0]?.check).toBe("json");
    expect(run.results[0]?.scores[0]?.score).toBe(0);
  });

  it("an inconclusive expectation does not pass and records why", async () => {
    const judge = makeJudge();
    const bad: EvalSuite = {
      ...suite,
      cases: [{ id: "bad", name: "bad regex", input: "q1", structured: { checks: [{ kind: "matches", path: "/city", pattern: "(" }] } }],
    };
    const run = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EvalService;
        return yield* svc.runSuite(bad, "sut-model", jsonRunner(outputs));
      }).pipe(Effect.provide(judge.layer)),
    );
    expect(run.results[0]?.passed).toBe(false);
    expect(run.results[0]?.scores).toEqual([]);
    expect(run.results[0]?.error).toContain("inconclusive");
    expect(judge.calls()).toBe(0);
  });

  it("mixed suites still judge the cases without `structured`", async () => {
    const judge = makeJudge();
    const mixed: EvalSuite = {
      ...suite,
      cases: [...suite.cases, { id: "judged", name: "prose", input: "q3", expectedOutput: "x" }],
    };
    const run = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EvalService;
        return yield* svc.runSuite(mixed, "sut-model", jsonRunner(outputs));
      }).pipe(Effect.provide(judge.layer)),
    );
    expect(judge.calls()).toBe(1);
    expect(run.results[2]?.scores[0]?.dimension).toBe("accuracy");
    expect(run.results[2]?.fieldResults).toBeUndefined();
  });

  it("checkRegression flags a drop in the structured dimension", async () => {
    const judge = makeJudge();
    const worse = { q1: { city: "Lyon", population: 500_000 }, q2: { city: "Lyon", population: 0 } };
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EvalService;
        const baseline = yield* svc.runSuite(suite, "sut-model", jsonRunner(outputs));
        const current = yield* svc.runSuite(suite, "sut-model", jsonRunner(worse));
        return yield* svc.checkRegression(current, baseline);
      }).pipe(Effect.provide(judge.layer)),
    );
    expect(result.hasRegression).toBe(true);
    expect(result.details.some((d) => d.startsWith("structured:"))).toBe(true);
  });

  it("per-field results survive EvalStore persistence", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-structured-"));
    try {
      const judgeLayer = Layer.succeed(JudgeLLMService, {
        complete: () => Effect.die("structured cases must not call the judge"),
      });
      const layer = makeEvalServiceLive(createEvalStore(join(dir, "evals.db"))).pipe(Layer.provide(judgeLayer));
      const history = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EvalService;
          yield* svc.runSuite(suite, "sut-model", jsonRunner(outputs));
          return yield* svc.getHistory(suite.id);
        }).pipe(Effect.provide(layer)),
      );
      const partial = history[0]?.results.find((r) => r.caseId === "partial");
      expect(partial?.fieldResults?.find((f) => f.outcome === "fail")?.path).toBe("/population");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runCase grades a structured case without the judge", async () => {
    const judge = makeJudge();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EvalService;
        return yield* svc.runCase(suite.cases[0]!, "sut-model", ["accuracy"], JSON.stringify(outputs.q1));
      }).pipe(Effect.provide(judge.layer)),
    );
    expect(judge.calls()).toBe(0);
    expect(result.passed).toBe(true);
    expect(result.scores[0]?.dimension).toBe("structured");
  });
});
