import { describe, it, expect } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  JudgmentTimeout,
  makeJudgmentServiceLive,
  type JudgmentAnswer,
  type JudgmentBackend,
  type JudgmentCapabilities,
} from "@reactive-agents/judgment";
import { EvalService, EvalServiceLive, makeEvalServiceLive, type SuiteAgentRunner } from "../src/services/eval-service.js";
import { createEvalStore } from "../src/services/eval-store.js";
import { JudgeLLMService } from "../src/services/judge-llm-service.js";
import { EvalSuiteSchema, type EvalCase, type EvalSuite } from "../src/types/eval-case.js";
import type { Rubric } from "../src/types/rubric.js";

/** A scripted backend: answers every question with `answer`, or fails, and counts the asks. */
const scripted = (
  answer: JudgmentAnswer | "timeout",
  options: { readonly calibrated?: boolean } = {},
) => {
  const log = { asks: 0 };
  const caps: JudgmentCapabilities = {
    supportedKinds: ["noul", "choice", "score"],
    distributions: true,
    calibrated: options.calibrated ?? true,
    images: false,
    modelCatalog: false,
  };
  const backend: JudgmentBackend = {
    name: "scripted",
    capabilities: caps,
    evaluate: ({ questions }) => {
      log.asks += 1;
      if (answer === "timeout") return Effect.fail(new JudgmentTimeout({ message: "too slow", timeoutMs: 1 }));
      return Effect.succeed(Object.fromEntries(Object.keys(questions).map((id) => [id, answer])));
    },
  };
  return { log, layer: makeJudgmentServiceLive(backend) };
};

const judge = Layer.succeed(JudgeLLMService, {
  complete: () =>
    Effect.succeed({
      content: "0.8",
      stopReason: "end_turn" as const,
      model: "judge-test",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCost: 0 },
    }),
});

const noulRubric: Rubric = { question: { type: "noul", instructions: "Is the answer polite?" }, passWhen: {} };
const choiceRubric: Rubric = {
  question: { type: "choice", criteria: { good: "helpful", bad: "unhelpful" } },
  passWhen: { accept: ["good"] },
};
const scoreRubric: Rubric = {
  question: { type: "score", criteria: ["bad", "ok", "great"] },
  passWhen: { minScore: 1.5 },
};

const caseOf = (rubric: Rubric, extra: Partial<EvalCase> = {}): EvalCase => ({ id: "c1", name: "c1", input: "q", rubric, ...extra });
const suiteOf = (cases: readonly EvalCase[]): EvalSuite => ({ id: "rubric-suite", name: "r", description: "r", dimensions: ["accuracy"], cases });
const runner: SuiteAgentRunner = () => Effect.succeed({ actualOutput: JSON.stringify({ city: "Paris" }) });

const runWith = (suite: EvalSuite, judgmentLayer?: ReturnType<typeof scripted>["layer"]) => {
  const base = EvalServiceLive.pipe(Layer.provide(judge));
  const layer = judgmentLayer ? EvalServiceLive.pipe(Layer.provide(Layer.merge(judge, judgmentLayer))) : base;
  return Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* EvalService;
      return yield* svc.runSuite(suite, "sut", runner);
    }).pipe(Effect.provide(layer)),
  );
};

const only = async (rubric: Rubric, answer: JudgmentAnswer | "timeout", options?: { calibrated?: boolean }, extra: Partial<EvalCase> = {}) => {
  const s = scripted(answer, options);
  const run = await runWith(suiteOf([caseOf(rubric, extra)]), s.layer);
  return { result: run.results[0]!, run, asks: () => s.log.asks };
};

describe("rubric graders", () => {
  it("confident pass: records answer, confidence, calibration and backend", async () => {
    const { result } = await only(noulRubric, { kind: "noul", probability: 0.95 });
    expect(result.verdict).toBe("pass");
    expect(result.passed).toBe(true);
    expect(result.rubric).toMatchObject({ verdict: "pass", kind: "noul", answer: 0.95, calibrated: true, backend: "scripted" });
    expect(result.rubric?.confidence).toBeCloseTo(0.95);
    expect(result.scores.map((s) => s.dimension)).toEqual(["rubric"]);
    expect(result.checks).toEqual([{ check: "rubric", verdict: "pass", detail: result.rubric?.reason }]);
  });

  it("confident fail is a fail, not inconclusive", async () => {
    const { result } = await only(noulRubric, { kind: "noul", probability: 0.05 });
    expect(result.verdict).toBe("fail");
    expect(result.passed).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("low confidence is inconclusive and never a pass", async () => {
    const { result } = await only(noulRubric, { kind: "noul", probability: 0.55 });
    expect(result.verdict).toBe("inconclusive");
    expect(result.passed).toBe(false);
    expect(result.rubric?.reason).toContain("below the required");
    expect(result.error).toContain("inconclusive");
    expect(result.scores).toEqual([]);
  });

  it("a backend error is inconclusive and names the cause", async () => {
    const { result } = await only(noulRubric, "timeout");
    expect(result.verdict).toBe("inconclusive");
    expect(result.passed).toBe(false);
    expect(result.rubric?.reason).toContain("JudgmentTimeout");
    expect(result.rubric?.backend).toBe("scripted");
  });

  it("uncalibrated answers need higher agreement than the rubric asks", async () => {
    const low = await only(choiceRubric, { kind: "choice", value: "good", probabilities: { good: 0.7, bad: 0.3 }, confidence: 0.7, calibrated: false });
    expect(low.result.verdict).toBe("inconclusive");
    expect(low.result.rubric).toMatchObject({ calibrated: false, requiredConfidence: 0.8 });
    expect(low.result.rubric?.reason).toContain("uncalibrated");

    const high = await only(choiceRubric, { kind: "choice", value: "good", probabilities: { good: 0.95, bad: 0.05 }, confidence: 0.95, calibrated: false });
    expect(high.result.verdict).toBe("pass");
    expect(high.result.rubric?.calibrated).toBe(false);
  });

  it("the same 0.7 confidence passes when the backend is calibrated", async () => {
    const { result } = await only(choiceRubric, { kind: "choice", value: "good", probabilities: { good: 0.7, bad: 0.3 }, confidence: 0.7, calibrated: true });
    expect(result.verdict).toBe("pass");
  });

  it("an uncalibrated Noul is read through the backend's declared calibration", async () => {
    const { result } = await only(noulRubric, { kind: "noul", probability: 0.7 }, { calibrated: false });
    expect(result.verdict).toBe("inconclusive");
    expect(result.rubric?.calibrated).toBe(false);
  });

  it("choice outside passWhen.accept fails; probability on accepted labels is the score", async () => {
    const { result } = await only(choiceRubric, { kind: "choice", value: "bad", probabilities: { good: 0.1, bad: 0.9 }, confidence: 0.9, calibrated: true });
    expect(result.verdict).toBe("fail");
    expect(result.rubric?.score).toBeCloseTo(0.1);
  });

  it("score passes at or above minScore and normalises over the top level", async () => {
    const pass = await only(scoreRubric, { kind: "score", value: 1.8, probabilities: {}, confidence: 0.9, calibrated: true });
    expect(pass.result.verdict).toBe("pass");
    expect(pass.result.rubric?.score).toBeCloseTo(0.9);
    const fail = await only(scoreRubric, { kind: "score", value: 0.4, probabilities: {}, confidence: 0.9, calibrated: true });
    expect(fail.result.verdict).toBe("fail");
  });

  it("a wrong answer kind is inconclusive", async () => {
    const { result } = await only(scoreRubric, { kind: "noul", probability: 0.99 });
    expect(result.verdict).toBe("inconclusive");
    expect(result.rubric?.reason).toContain("answered a noul");
  });

  it("an invalid rubric is inconclusive and spends no judge call", async () => {
    const bad: Rubric = { question: { type: "choice", criteria: { a: "x" } }, passWhen: { accept: ["missing"] } };
    const { result, asks } = await only(bad, { kind: "noul", probability: 1 });
    expect(result.verdict).toBe("inconclusive");
    expect(result.rubric?.reason).toContain("invalid rubric");
    expect(asks()).toBe(0);
  });

  it("without a JudgmentService the rubric is inconclusive, not passed", async () => {
    const run = await runWith(suiteOf([caseOf(noulRubric)]));
    expect(run.results[0]?.verdict).toBe("inconclusive");
    expect(run.results[0]?.passed).toBe(false);
    expect(run.results[0]?.rubric?.reason).toContain("no JudgmentService");
  });
});

describe("rubric ordering with structured checks", () => {
  const passing = { fields: { city: "Paris" } };
  const failing = { fields: { city: "Rome" } };

  it("a failed structured check skips the rubric: no judge call, case fails", async () => {
    const { result, asks } = await only(noulRubric, { kind: "noul", probability: 0.99 }, undefined, { structured: failing });
    expect(asks()).toBe(0);
    expect(result.verdict).toBe("fail");
    expect(result.rubric).toBeUndefined();
    expect(result.checks?.map((c) => c.check)).toEqual(["structured"]);
  });

  it("passing structured checks then the rubric: one grade, per-check breakdown", async () => {
    const { result, asks } = await only(noulRubric, { kind: "noul", probability: 0.95 }, undefined, { structured: passing });
    expect(asks()).toBe(1);
    expect(result.verdict).toBe("pass");
    expect(result.checks?.map((c) => [c.check, c.verdict])).toEqual([["structured", "pass"], ["rubric", "pass"]]);
    expect(result.scores.map((s) => s.dimension)).toEqual(["structured", "rubric"]);
    expect(result.fieldResults?.length).toBeGreaterThan(0);
  });

  it("structured passes but the rubric is inconclusive: case is inconclusive", async () => {
    const { result } = await only(noulRubric, "timeout", undefined, { structured: passing });
    expect(result.verdict).toBe("inconclusive");
    expect(result.checks?.map((c) => [c.check, c.verdict])).toEqual([["structured", "pass"], ["rubric", "inconclusive"]]);
  });

  it("a rubric-only case calls no judge for the suite dimensions", async () => {
    const { asks } = await only(noulRubric, { kind: "noul", probability: 0.95 });
    expect(asks()).toBe(1);
  });
});

describe("rubric results in runs, store and regression", () => {
  const build = async (probabilities: readonly number[]) => {
    let i = 0;
    const backend: JudgmentBackend = {
      name: "scripted",
      capabilities: { supportedKinds: ["noul", "choice", "score"], distributions: true, calibrated: true, images: false, modelCatalog: false },
      evaluate: ({ questions }) => {
        const p = probabilities[i++] ?? 0.5;
        return Effect.succeed(Object.fromEntries(Object.keys(questions).map((id) => [id, { kind: "noul" as const, probability: p }])));
      },
    };
    return makeJudgmentServiceLive(backend);
  };

  const cases = (n: number): EvalCase[] => Array.from({ length: n }, (_, k) => ({ id: `c${k}`, name: `c${k}`, input: "q", rubric: noulRubric }));

  const runOf = async (probabilities: readonly number[], store?: ReturnType<typeof createEvalStore>) => {
    const j = await build(probabilities);
    const layer = makeEvalServiceLive(store).pipe(Layer.provide(Layer.merge(judge, j)));
    return Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EvalService;
        return yield* svc.runSuite(suiteOf(cases(probabilities.length)), "sut", runner);
      }).pipe(Effect.provide(layer)),
    );
  };

  it("inconclusive is counted apart and kept out of averages and failures", async () => {
    const run = await runOf([0.95, 0.05, 0.55]);
    expect(run.summary).toMatchObject({ totalCases: 3, passed: 1, failed: 1, inconclusive: 1 });
    // pass scored 0.95, fail scored 0.05; the inconclusive case is not averaged in.
    expect(run.summary.avgScore).toBeCloseTo(0.5);
    expect(run.summary.dimensionAverages.rubric).toBeCloseTo(0.5);
  });

  it("persists judgment fields additively and reads them back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rubric-store-"));
    try {
      const store = createEvalStore(join(dir, "eval.db"));
      const run = await runOf([0.95, 0.55], store);
      const loaded = await Effect.runPromise(store.loadRun(run.id));
      expect(loaded?.summary.inconclusive).toBe(1);
      expect(loaded?.results[0]?.rubric).toMatchObject({ verdict: "pass", backend: "scripted", calibrated: true });
      expect(loaded?.results[1]?.verdict).toBe("inconclusive");
      expect(loaded?.results[1]?.checks?.[0]).toMatchObject({ check: "rubric", verdict: "inconclusive" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const check = (current: Awaited<ReturnType<typeof runOf>>, baseline: Awaited<ReturnType<typeof runOf>>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EvalService;
        return yield* svc.checkRegression(current, baseline);
      }).pipe(Effect.provide(EvalServiceLive.pipe(Layer.provide(judge)))),
    );

  it("checkRegression flags a pass-rate drop over decided cases", async () => {
    const baseline = await runOf([0.95, 0.95, 0.95, 0.95]);
    const current = await runOf([0.95, 0.05, 0.05, 0.05]);
    const out = await check(current, baseline);
    expect(out.hasRegression).toBe(true);
    expect(out.details.some((d) => d.startsWith("pass rate:"))).toBe(true);
    expect(out.passRate).toEqual({ current: 0.25, baseline: 1 });
  });

  it("checkRegression reports inconclusive apart and never counts it as a pass or a regression", async () => {
    const baseline = await runOf([0.95, 0.95, 0.95, 0.95]);
    const current = await runOf([0.95, 0.95, 0.55, 0.55]);
    const out = await check(current, baseline);
    expect(out.inconclusive).toEqual({ current: 2, baseline: 0 });
    expect(out.passRate).toEqual({ current: 1, baseline: 1 });
    expect(out.hasRegression).toBe(false);
  });
});

describe("rubric schema", () => {
  it("suite JSON with a rubric decodes, and a malformed rubric is rejected", () => {
    const json = {
      id: "s", name: "s", description: "s", dimensions: [],
      cases: [{ id: "a", name: "a", input: "q", rubric: { question: { type: "score", criteria: ["bad", "ok"] }, passWhen: { minScore: 1 }, minConfidence: 0.7 } }],
    };
    expect(Schema.decodeUnknownSync(EvalSuiteSchema)(json).cases[0]?.rubric?.question.type).toBe("score");
    const bad = { ...json, cases: [{ id: "a", name: "a", input: "q", rubric: { question: { type: "score", criteria: ["only-one"] }, passWhen: { minScore: 0 } } }] };
    expect(() => Schema.decodeUnknownSync(EvalSuiteSchema)(bad)).toThrow();
  });
});
