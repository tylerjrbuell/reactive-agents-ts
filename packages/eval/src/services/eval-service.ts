import { Context, Effect, Layer, Ref } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { CompletionRequest, CompletionResponse, LLMErrors } from "@reactive-agents/llm-provider";

type LLMCompleter = {
  readonly complete: (request: CompletionRequest) => Effect.Effect<CompletionResponse, LLMErrors>;
};
import type { EvalCase, EvalSuite } from "../types/eval-case.js";
import type { EvalResult, EvalRun, EvalRunSummary, DimensionScore } from "../types/eval-result.js";
import type { EvalConfig } from "../types/config.js";
import { DEFAULT_EVAL_CONFIG } from "../types/config.js";
import { EvalError, BenchmarkError } from "../errors/errors.js";
import type { EvalStore } from "./eval-store.js";
import { scoreAccuracy } from "../dimensions/accuracy.js";
import { scoreRelevance } from "../dimensions/relevance.js";
import { scoreCompleteness } from "../dimensions/completeness.js";
import { scoreSafety } from "../dimensions/safety.js";
import { scoreCostEfficiency } from "../dimensions/cost-efficiency.js";

export class EvalService extends Context.Tag("EvalService")<
  EvalService,
  {
    readonly runSuite: (
      suite: EvalSuite,
      agentConfig: string,
      config?: Partial<EvalConfig>,
    ) => Effect.Effect<EvalRun, BenchmarkError>;

    readonly runCase: (
      evalCase: EvalCase,
      agentConfig: string,
      dimensions: readonly string[],
      actualOutput: string,
      metrics?: { latencyMs?: number; costUsd?: number; tokensUsed?: number; stepsExecuted?: number },
    ) => Effect.Effect<EvalResult, EvalError>;

    readonly compare: (
      runA: EvalRun,
      runB: EvalRun,
    ) => Effect.Effect<{
      improved: string[];
      regressed: string[];
      unchanged: string[];
    }>;

    readonly checkRegression: (
      current: EvalRun,
      baseline: EvalRun,
      threshold?: number,
    ) => Effect.Effect<{ hasRegression: boolean; details: string[] }>;

    readonly getHistory: (
      suiteId: string,
      options?: { limit?: number },
    ) => Effect.Effect<readonly EvalRun[]>;
  }
>() {}

// scoreDimension takes a captured llm instance — no Effect context required
const scoreDimension = (
  llm: LLMCompleter,
  dimension: string,
  params: {
    input: string;
    actualOutput: string;
    expectedOutput?: string;
    caseId: string;
    costUsd: number;
    overallQualityScore?: number;
  },
): Effect.Effect<DimensionScore, EvalError> => {
  switch (dimension) {
    case "accuracy":
      return scoreAccuracy(llm, params);
    case "relevance":
      return scoreRelevance(llm, params);
    case "completeness":
      return scoreCompleteness(llm, params);
    case "safety":
      return scoreSafety(llm, params);
    case "cost-efficiency":
      return scoreCostEfficiency({
        overallQualityScore: params.overallQualityScore ?? 0.5,
        costUsd: params.costUsd,
        caseId: params.caseId,
      });
    default:
      // Unknown dimension — use generic LLM-as-judge
      return Effect.gen(function* () {
        const response = yield* llm
          .complete({
            messages: [
              {
                role: "user",
                content: `You are an evaluation judge. Score "${dimension}" for this AI response on a scale of 0.0 to 1.0.

Input: ${params.input}
Actual output: ${params.actualOutput}

Respond with ONLY a decimal number between 0.0 and 1.0. No explanation.`,
              },
            ],
            maxTokens: 10,
            temperature: 0.0,
          })
          .pipe(
            Effect.mapError(
              (err) =>
                new EvalError({
                  message: `Scoring "${dimension}" failed: ${String(err)}`,
                  caseId: params.caseId,
                  cause: err,
                }),
            ),
          );
        const score = Math.max(0, Math.min(1, parseFloat(response.content.trim()) || 0.5));
        return { dimension, score } satisfies DimensionScore;
      });
  }
};

const buildSummary = (results: EvalResult[], passThreshold: number): EvalRunSummary => {
  const allDimensions = new Set(results.flatMap((r) => r.scores.map((s) => s.dimension)));
  const dimensionAverages: Record<string, number> = {};

  for (const dim of allDimensions) {
    const dimScores = results.flatMap((r) =>
      r.scores.filter((s) => s.dimension === dim).map((s) => s.score),
    );
    dimensionAverages[dim] = dimScores.length > 0
      ? dimScores.reduce((a, b) => a + b, 0) / dimScores.length
      : 0;
  }

  return {
    totalCases: results.length,
    passed: results.filter((r) => r.overallScore >= passThreshold).length,
    failed: results.filter((r) => r.overallScore < passThreshold).length,
    avgScore: results.length > 0
      ? results.reduce((s, r) => s + r.overallScore, 0) / results.length
      : 0,
    avgLatencyMs: results.length > 0
      ? results.reduce((s, r) => s + r.latencyMs, 0) / results.length
      : 0,
    totalCostUsd: results.reduce((s, r) => s + r.costUsd, 0),
    dimensionAverages,
  };
};

/**
 * Create EvalServiceLive with optional persistent store.
 * When a store is provided, runs are persisted to SQLite and history is loaded from disk.
 */
export const makeEvalServiceLive = (store?: EvalStore) =>
  Layer.effect(
    EvalService,
    Effect.gen(function* () {
      const llm = yield* LLMService;
      const historyRef = yield* Ref.make<EvalRun[]>([]);

      return {
        runSuite: (suite, agentConfig, configOverride) =>
          Effect.gen(function* () {
            const config = { ...DEFAULT_EVAL_CONFIG, ...configOverride };
            const results: EvalResult[] = [];

            for (const evalCase of suite.cases) {
              const start = Date.now();
              const scores = yield* Effect.all(
                suite.dimensions.map((dim) =>
                  scoreDimension(llm, dim, {
                    input: evalCase.input,
                    actualOutput: "[evaluated via LLM-as-judge]",
                    expectedOutput: evalCase.expectedOutput,
                    caseId: evalCase.id,
                    costUsd: 0,
                  }),
                ),
                { concurrency: config.parallelism },
              ).pipe(
                Effect.mapError(
                  (err) =>
                    new BenchmarkError({
                      message: `Suite "${suite.id}" case "${evalCase.id}" failed: ${String(err)}`,
                      suiteId: suite.id,
                    }),
                ),
              );

              const overallScore =
                scores.length > 0 ? scores.reduce((s, d) => s + d.score, 0) / scores.length : 0;

              results.push({
                caseId: evalCase.id,
                timestamp: new Date(),
                agentConfig,
                scores,
                overallScore,
                actualOutput: "[evaluated via LLM-as-judge]",
                latencyMs: Date.now() - start,
                costUsd: 0,
                tokensUsed: 0,
                stepsExecuted: 0,
                passed: overallScore >= config.passThreshold,
              });
            }

            const run: EvalRun = {
              id: crypto.randomUUID(),
              suiteId: suite.id,
              timestamp: new Date(),
              agentConfig,
              results,
              summary: buildSummary(results, config.passThreshold),
            };

            yield* Ref.update(historyRef, (h) => [...h, run]);

            // Persist to store if available
            if (store) {
              yield* store.saveRun(run).pipe(Effect.catchAll(() => Effect.void));
            }

            return run;
          }),

      runCase: (evalCase, agentConfig, dimensions, actualOutput, metrics) =>
        Effect.gen(function* () {
          const start = Date.now();
          const costUsd = metrics?.costUsd ?? 0;

          const scores = yield* Effect.all(
            dimensions.map((dim) =>
              scoreDimension(llm, dim, {
                input: evalCase.input,
                actualOutput,
                expectedOutput: evalCase.expectedOutput,
                caseId: evalCase.id,
                costUsd,
              }),
            ),
            { concurrency: 3 },
          );

          const qualityScores = scores.filter((s) => s.dimension !== "cost-efficiency");
          const overallQuality =
            qualityScores.length > 0
              ? qualityScores.reduce((s, d) => s + d.score, 0) / qualityScores.length
              : 0;

          const finalScores = scores.map((s) =>
            s.dimension === "cost-efficiency"
              ? { ...s, score: Math.max(0, Math.min(1, overallQuality / Math.max(costUsd, 0.0001) / 1000)) }
              : s,
          );

          const overallScore =
            finalScores.length > 0
              ? finalScores.reduce((s, d) => s + d.score, 0) / finalScores.length
              : 0;

          return {
            caseId: evalCase.id,
            timestamp: new Date(),
            agentConfig,
            scores: finalScores,
            overallScore,
            actualOutput,
            latencyMs: metrics?.latencyMs ?? Date.now() - start,
            costUsd,
            tokensUsed: metrics?.tokensUsed ?? 0,
            stepsExecuted: metrics?.stepsExecuted ?? 0,
            passed: overallScore >= DEFAULT_EVAL_CONFIG.passThreshold,
          } satisfies EvalResult;
        }),

      compare: (runA, runB) =>
        Effect.sync(() => {
          const improved: string[] = [];
          const regressed: string[] = [];
          const unchanged: string[] = [];

          const dimsA = runA.summary.dimensionAverages;
          const dimsB = runB.summary.dimensionAverages;
          const allDims = new Set([...Object.keys(dimsA), ...Object.keys(dimsB)]);

          for (const dim of allDims) {
            const a = dimsA[dim] ?? 0;
            const b = dimsB[dim] ?? 0;
            const delta = b - a;
            if (delta > 0.02) improved.push(dim);
            else if (delta < -0.02) regressed.push(dim);
            else unchanged.push(dim);
          }

          const overallDelta = runB.summary.avgScore - runA.summary.avgScore;
          if (overallDelta > 0.02) improved.push("overall");
          else if (overallDelta < -0.02) regressed.push("overall");
          else unchanged.push("overall");

          return { improved, regressed, unchanged };
        }),

      checkRegression: (current, baseline, threshold) => {
        const t = threshold ?? DEFAULT_EVAL_CONFIG.regressionThreshold;
        return Effect.sync(() => {
          const details: string[] = [];
          const allDims = new Set([
            ...Object.keys(current.summary.dimensionAverages),
            ...Object.keys(baseline.summary.dimensionAverages),
          ]);

          for (const dim of allDims) {
            const curr = current.summary.dimensionAverages[dim] ?? 0;
            const base = baseline.summary.dimensionAverages[dim] ?? 0;
            if (curr < base - t) {
              details.push(
                `${dim}: ${curr.toFixed(3)} < baseline ${base.toFixed(3)} (delta ${(curr - base).toFixed(3)})`,
              );
            }
          }

          const overallDelta = current.summary.avgScore - baseline.summary.avgScore;
          if (overallDelta < -t) {
            details.push(
              `overall: ${current.summary.avgScore.toFixed(3)} < baseline ${baseline.summary.avgScore.toFixed(3)} (delta ${overallDelta.toFixed(3)})`,
            );
          }

          return { hasRegression: details.length > 0, details };
        });
      },

      getHistory: (suiteId, options) =>
        store
          ? store.loadHistory(suiteId, options).pipe(
              Effect.catchAll(() =>
                Ref.get(historyRef).pipe(
                  Effect.map((h) =>
                    h
                      .filter((r) => r.suiteId === suiteId)
                      .slice(-(options?.limit ?? 100)),
                  ),
                ),
              ),
            )
          : Ref.get(historyRef).pipe(
              Effect.map((h) =>
                h
                  .filter((r) => r.suiteId === suiteId)
                  .slice(-(options?.limit ?? 100)),
              ),
            ),
    };
  }),
);

/** EvalServiceLive without persistence (in-memory only) — backwards compatible. */
export const EvalServiceLive = makeEvalServiceLive();

/** EvalServicePersistentLive — convenience layer with SQLite persistence. */
export const makeEvalServicePersistentLive = (dbPath?: string) => {
  // Lazy import to avoid requiring bun:sqlite at module load time
  const { createEvalStore } = require("./eval-store.js") as typeof import("./eval-store.js");
  return makeEvalServiceLive(createEvalStore(dbPath));
};
