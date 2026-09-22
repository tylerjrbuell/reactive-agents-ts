import { Context, Effect, Layer, Option, Ref } from "effect";
import type { CompletionRequest, CompletionResponse, LLMErrors } from "@reactive-agents/llm-provider";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { JudgmentService } from "@reactive-agents/judgment";
import { JudgeLLMService } from "./judge-llm-service.js";
import { scoreDimensionsViaJudgment } from "./judgment-dimensions.js";
import { minimumDetectableEffect, pooledStats, summarizeRepeats, type RepeatStats } from "../stats/variance.js";

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

/**
 * Per-case SUT runner. Invoked by `runSuite` for each `EvalCase` to produce
 * the real `actualOutput` the judge will score. Pre-W6.5 (FIX-22), `runSuite`
 * hardcoded `"[evaluated via LLM-as-judge]"` as the actualOutput, which meant
 * the judge scored a placeholder string for every case — the suite was
 * structurally broken. Callers now supply this runner; it exercises the SUT
 * (the agent under test) and returns the captured output + metrics.
 *
 * The runner MUST NOT use `JudgeLLMService` (Rule 4 of 00-RESEARCH-DISCIPLINE.md
 * — judge code path is isolated from the SUT). Use `LLMService` or a higher-
 * level builder layer to run the agent.
 */
export type SuiteAgentRunner = (input: string) => Effect.Effect<
  {
    readonly actualOutput: string;
    readonly metrics?: {
      readonly latencyMs?: number;
      readonly costUsd?: number;
      readonly tokensUsed?: number;
      readonly stepsExecuted?: number;
    };
  },
  BenchmarkError
>;

export class EvalService extends Context.Tag("EvalService")<
  EvalService,
  {
    readonly runSuite: (
      suite: EvalSuite,
      agentConfig: string,
      agentRunner: SuiteAgentRunner,
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

/**
 * Scores `dims` with the configured judge engine. When a `JudgmentService`
 * is wired AND `judgeEngine` resolves to `"jev"` (the default — see
 * `DEFAULT_EVAL_CONFIG.judgeEngine`), jev-capable dimensions are answered in
 * ONE batched request (`scoreDimensionsViaJudgment`); any dimension that
 * request didn't cover — because it isn't jev-capable, or the batch/that
 * one field failed — falls back to the existing per-dimension `llm` path
 * unchanged. With no `JudgmentService` wired or `judgeEngine:"llm"`, this
 * is byte-for-byte the original all-`llm` behavior (Task 3 Step 2's
 * regression lock).
 */
/**
 * Result of one scoring pass, WITH provenance. Code review (2026-09-22)
 * flagged that without this, a case's repeat passes could silently mix
 * calibrated `jev` samples with uncalibrated `llm` self-report samples when
 * jev flakes on only some of a case's repeats — corrupting the variance
 * this whole task exists to measure. Callers that pool repeats must group
 * by `jevDims`, never blend a dimension's jev and llm samples together.
 */
interface EngineScoredDimensions {
  readonly scores: DimensionScore[];
  /** Which requested dims this pass actually answered via `jev` (the rest, including any not requested, came from `llm`). */
  readonly jevDims: ReadonlySet<string>;
}

const scoreDimensionsWithEngine = (
  llm: LLMCompleter,
  judgment: Option.Option<JudgmentService["Type"]>,
  judgeEngine: "jev" | "llm",
  dims: readonly string[],
  params: {
    input: string;
    actualOutput: string;
    expectedOutput?: string;
    caseId: string;
    costUsd: number;
    overallQualityScore?: number;
  },
  concurrency: number,
): Effect.Effect<EngineScoredDimensions, EvalError> =>
  Effect.gen(function* () {
    const useJev = judgeEngine === "jev" && Option.isSome(judgment);
    const jevScores = useJev
      ? yield* scoreDimensionsViaJudgment(judgment.value, dims, params)
      : new Map<string, DimensionScore>();

    const scores = yield* Effect.all(
      dims.map((dim) => {
        const jevScore = jevScores.get(dim);
        return jevScore !== undefined ? Effect.succeed(jevScore) : scoreDimension(llm, dim, params);
      }),
      { concurrency },
    );

    return { scores, jevDims: new Set(jevScores.keys()) };
  });

const buildSummary = (
  results: EvalResult[],
  passThreshold: number,
  perCaseRepeatStats?: Record<string, RepeatStats[]>,
  repeats?: number,
): EvalRunSummary => {
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

  // Task 6: only present when the run actually took >1 scoring pass per
  // case — `repeats: 1` (the default) reports no variance data, and
  // `checkRegression`/`compare` fall back to the flat threshold. Pools each
  // case's OWN within-case repeat stats (never a flat concatenation across
  // cases — see `pooledStats`'s doc comment for why that would conflate
  // judge noise with real case-to-case quality spread).
  const dimensionVariance =
    perCaseRepeatStats && repeats && repeats > 1
      ? Object.fromEntries(
          Object.entries(perCaseRepeatStats).map(([dim, groups]) => {
            const stats = pooledStats(groups);
            return [dim, { mean: stats.mean, stddev: stats.stddev, n: stats.n, ci95Low: stats.ci95[0], ci95High: stats.ci95[1] }];
          }),
        )
      : undefined;

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
    ...(dimensionVariance ? { dimensionVariance } : {}),
    ...(repeats ? { repeats } : {}),
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
      // W9 FIX-21: judge resolves from JudgeLLMService Tag, not LLMService.
      // The Tags must be wired to different providers in the runtime layer.
      // The SUT's LLMService is invoked separately when running the agent;
      // the judge is invoked here when scoring. No code-path overlap.
      const llm = yield* JudgeLLMService;
      // Task 3: optional — a run with no `.withJudgment()` layer wired (no
      // TYPESAFE_API_KEY, or the caller simply didn't opt in) resolves
      // `Option.none()` here and every dimension takes the unchanged `llm`
      // path below. `Effect.serviceOption` does NOT add JudgmentService to
      // this layer's requirements (see effect-ts-patterns "Optional
      // Dependencies").
      const judgment = yield* Effect.serviceOption(JudgmentService);
      const historyRef = yield* Ref.make<EvalRun[]>([]);

      return {
        runSuite: (suite, agentConfig, agentRunner, configOverride) =>
          Effect.gen(function* () {
            const config = { ...DEFAULT_EVAL_CONFIG, ...configOverride };

            // Rule 4 (frozen judge) — when a judge model is configured, it
            // MUST differ from the SUT (`agentConfig`). Catches the most
            // common Rule-4 violation: someone wires both Tags to the same
            // provider/model thinking "it'll work for now."
            if (config.judge?.model && config.judge.model === agentConfig) {
              return yield* Effect.fail(
                new BenchmarkError({
                  message: `Rule 4 violation: judge model "${config.judge.model}" matches SUT "${agentConfig}". The judge MUST differ from the system under test (00-RESEARCH-DISCIPLINE.md §4 — frozen judge).`,
                  suiteId: suite.id,
                }),
              );
            }

            const results: EvalResult[] = [];
            /**
             * Each case's own within-case repeat stats per dimension (Task 6,
             * corrected post-code-review 2026-09-22). Kept per-case — NOT
             * flattened together — so `buildSummary` can pool the WITHIN-case
             * (judge-noise) variance via `pooledStats` without contaminating
             * it with real case-to-case quality spread (BETWEEN-case
             * variance, a different quantity).
             */
            const perCaseRepeatStats: Record<string, RepeatStats[]> = {};

            for (const evalCase of suite.cases) {
              const start = Date.now();

              // FIX-22: actually run the agent on each case. Pre-W6.5,
              // runSuite hardcoded a placeholder string here so the judge
              // scored an identical placeholder for every case — the
              // overall metric was meaningless. Now the caller supplies
              // a SuiteAgentRunner that exercises the SUT.
              const sutRun = yield* agentRunner(evalCase.input).pipe(
                Effect.mapError(
                  (err) =>
                    err instanceof BenchmarkError
                      ? err
                      : new BenchmarkError({
                          message: `Suite "${suite.id}" case "${evalCase.id}" SUT runner failed: ${String(err)}`,
                          suiteId: suite.id,
                        }),
                ),
              );

              const sutCostUsd = sutRun.metrics?.costUsd ?? 0;
              const repeatCount = Math.max(1, config.repeats ?? DEFAULT_EVAL_CONFIG.repeats);

              // Task 6: re-scores the SAME `sutRun.actualOutput` `repeatCount`
              // times when `config.repeats > 1` — this measures JUDGE
              // variance, not SUT variance (the SUT ran exactly once above,
              // unchanged). `repeats: 1` (the default) takes exactly one
              // scoring pass, byte-identical to pre-Task-6 behavior.
              const scoreOnce = () =>
                scoreDimensionsWithEngine(
                  llm,
                  judgment,
                  config.judgeEngine ?? DEFAULT_EVAL_CONFIG.judgeEngine,
                  suite.dimensions,
                  {
                    input: evalCase.input,
                    actualOutput: sutRun.actualOutput,
                    expectedOutput: evalCase.expectedOutput,
                    caseId: evalCase.id,
                    costUsd: sutCostUsd,
                  },
                  config.parallelism,
                );

              const repeatPasses = yield* Effect.all(
                Array.from({ length: repeatCount }, scoreOnce),
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

              // This case's recorded score per dimension is the mean across
              // repeats (repeats:1 -> exactly the single pass, unchanged).
              // Per-dimension, homogeneous-engine only: if ANY repeat pass
              // answered a dim via jev, use ONLY that dim's jev-sourced
              // samples for this case (drop any llm stragglers from a
              // transient jev flake) — never blend calibrated jev samples
              // with uncalibrated llm samples for the same case+dimension
              // (code review, 2026-09-22). A dim jev never answered on any
              // pass uses all its (llm) samples as before.
              const scores: DimensionScore[] = suite.dimensions.map((dim) => {
                const anyJev = repeatPasses.some((pass) => pass.jevDims.has(dim));
                const homogeneousSamples = repeatPasses
                  .filter((pass) => (anyJev ? pass.jevDims.has(dim) : true))
                  .flatMap((pass) => pass.scores.filter((s) => s.dimension === dim));

                const values = homogeneousSamples.map((s) => s.score);
                const confidences = homogeneousSamples
                  .map((s) => s.confidence)
                  .filter((c): c is number => c !== undefined);

                // This case's within-case repeat spread for this dimension —
                // pooled with every other case's at the run level below,
                // never flattened together with them here.
                (perCaseRepeatStats[dim] ??= []).push(summarizeRepeats(values));

                return {
                  dimension: dim,
                  score: values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0,
                  ...(confidences.length > 0
                    ? { confidence: confidences.reduce((a, b) => a + b, 0) / confidences.length }
                    : {}),
                };
              });

              const overallScore =
                scores.length > 0 ? scores.reduce((s, d) => s + d.score, 0) / scores.length : 0;

              results.push({
                caseId: evalCase.id,
                timestamp: new Date(),
                agentConfig,
                scores,
                overallScore,
                actualOutput: sutRun.actualOutput,
                latencyMs: sutRun.metrics?.latencyMs ?? Date.now() - start,
                costUsd: sutCostUsd,
                tokensUsed: sutRun.metrics?.tokensUsed ?? 0,
                stepsExecuted: sutRun.metrics?.stepsExecuted ?? 0,
                passed: overallScore >= config.passThreshold,
              });
            }

            const run: EvalRun = {
              id: crypto.randomUUID(),
              suiteId: suite.id,
              timestamp: new Date(),
              agentConfig,
              results,
              summary: buildSummary(results, config.passThreshold, perCaseRepeatStats, config.repeats ?? DEFAULT_EVAL_CONFIG.repeats),
            };

            yield* Ref.update(historyRef, (h) => [...h, run]);

            // Persist to store if available
            if (store) {
              yield* store.saveRun(run).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "eval/src/services/eval-service.ts:221", tag: errorTag(err) })));
            }

            return run;
          }),

      runCase: (evalCase, agentConfig, dimensions, actualOutput, metrics) =>
        Effect.gen(function* () {
          const start = Date.now();
          const costUsd = metrics?.costUsd ?? 0;

          const { scores } = yield* scoreDimensionsWithEngine(
            llm,
            judgment,
            DEFAULT_EVAL_CONFIG.judgeEngine,
            dimensions,
            {
              input: evalCase.input,
              actualOutput,
              expectedOutput: evalCase.expectedOutput,
              caseId: evalCase.id,
              costUsd,
            },
            3,
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
            const varA = runA.summary.dimensionVariance?.[dim];
            const varB = runB.summary.dimensionVariance?.[dim];
            const threshold =
              varA && varB ? minimumDetectableEffect(varA.stddev, varA.n, varB.stddev, varB.n) : 0.02;
            if (delta > threshold) improved.push(dim);
            else if (delta < -threshold) regressed.push(dim);
            else unchanged.push(dim);
          }

          const overallDelta = runB.summary.avgScore - runA.summary.avgScore;
          if (overallDelta > 0.02) improved.push("overall");
          else if (overallDelta < -0.02) regressed.push("overall");
          else unchanged.push("overall");

          return { improved, regressed, unchanged };
        }),

      checkRegression: (current, baseline, threshold) => {
        // Task 6: when BOTH runs carry repeat-scoring variance data
        // (`dimensionVariance`, from `EvalConfig.repeats > 1`), the trigger
        // for that dimension is the statistically-derived minimum
        // detectable effect at their actual sample sizes, not the flat
        // `regressionThreshold`. A run with `repeats: 1` (the default) has
        // no variance data on either side, so every dimension falls back to
        // the flat threshold below — unchanged from pre-Task-6 behavior.
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
            const currVar = current.summary.dimensionVariance?.[dim];
            const baseVar = baseline.summary.dimensionVariance?.[dim];
            const mde =
              currVar && baseVar
                ? minimumDetectableEffect(currVar.stddev, currVar.n, baseVar.stddev, baseVar.n)
                : undefined;
            const effectiveThreshold = mde ?? t;
            if (curr < base - effectiveThreshold) {
              const mdeNote = mde !== undefined ? `, MDE=${mde.toFixed(3)} at n=${Math.min(currVar!.n, baseVar!.n)}` : ` (flat threshold, repeats:1 — no variance data)`;
              details.push(
                `${dim}: ${curr.toFixed(3)} < baseline ${base.toFixed(3)} (delta ${(curr - base).toFixed(3)}${mdeNote})`,
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
