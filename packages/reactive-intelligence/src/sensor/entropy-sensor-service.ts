import { Effect, Layer } from "effect";
import {
  EntropySensorService,
  type TokenLogprobLike,
  type EntropyScoreLike,
  type EntropyTrajectoryLike,
  type ModelCalibrationLike,
  type ContextSectionLike,
  type ContextPressureLike,
} from "@reactive-agents/core";
import { LLMService } from "@reactive-agents/llm-provider";
import type {
  EntropyScore,
  StructuralEntropy,
  BehavioralEntropy,
  ModelCalibration,
  ReactiveIntelligenceConfig,
} from "../types.js";
import { computeTokenEntropy } from "./token-entropy.js";
import { computeStructuralEntropy } from "./structural-entropy.js";
import { computeSemanticEntropy, updateCentroid } from "./semantic-entropy.js";
import { computeBehavioralEntropy } from "./behavioral-entropy.js";
import { computeContextPressure } from "./context-pressure.js";
import { computeEntropyTrajectory, iterationWeight } from "./entropy-trajectory.js";
import { computeCompositeEntropy } from "./composite.js";
import { lookupModel } from "../calibration/model-registry.js";
import { computeCalibration } from "../calibration/conformal.js";
import { CalibrationStore } from "../calibration/calibration-store.js";

// ─── Helper functions ───

/** Convert StructuralEntropy fields to a single [0,1] score (mean of all 6 fields). */
export function meanStructural(s: StructuralEntropy): number {
  return (
    s.formatCompliance +
    s.orderIntegrity +
    s.thoughtDensity +
    s.vocabularyDiversity +
    s.hedgeScore +
    s.jsonParseScore
  ) / 6;
}

/** Convert BehavioralEntropy fields to a single [0,1] disorder score.
 *  Inverts success-oriented fields so higher = more entropy. */
export function meanBehavioral(b: BehavioralEntropy): number {
  return (
    (1 - b.toolSuccessRate) +
    (1 - b.actionDiversity) +
    b.loopDetectionScore +
    (1 - b.completionApproach)
  ) / 4;
}

/** Fallback score when scoring fails entirely. */
export function fallbackScore(params: {
  iteration: number;
  maxIterations: number;
}): EntropyScoreLike {
  return {
    composite: 0.5,
    sources: { token: null, structural: 0.5, semantic: null, behavioral: 0.5, contextPressure: 0 },
    trajectory: { derivative: 0, shape: "flat", momentum: 0.5 },
    confidence: "low",
    modelTier: "unknown",
    iteration: params.iteration,
    iterationWeight: iterationWeight(params.iteration, params.maxIterations),
    timestamp: Date.now(),
  };
}

/** Default calibration for uncalibrated models. */
export function uncalibratedDefault(modelId: string): ModelCalibrationLike {
  return {
    modelId,
    calibrated: false,
    sampleCount: 0,
    highEntropyThreshold: 0.8,
    convergenceThreshold: 0.4,
  };
}

// ─── Service Layer Factory ───

export const EntropySensorServiceLive = (
  config: ReactiveIntelligenceConfig,
  externalCalStore?: CalibrationStore,
): Layer.Layer<EntropySensorService> =>
  Layer.effect(
    EntropySensorService,
    Effect.gen(function* () {
      // LLMService is optional — for semantic entropy embeddings
      const llmOpt = yield* Effect.serviceOption(LLMService).pipe(
        Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
      );
      const llm = llmOpt._tag === "Some" ? llmOpt.value : null;

      // Per-task trajectory tracking (taskId -> EntropyScore[])
      const trajectories = new Map<string, EntropyScoreLike[]>();

      // Calibration store — use external if provided, else in-memory
      const calStore = externalCalStore ?? new CalibrationStore();

      return {
        score: (params) =>
          Effect.gen(function* () {
            const {
              thought, strategy, iteration, maxIterations,
              modelId, temperature, priorThought, logprobs, kernelState,
            } = params;

            const model = lookupModel(modelId, config.models);

            // 1. Token entropy (from logprobs)
            const tokenResult = config.entropy.tokenEntropy !== false
              ? computeTokenEntropy(logprobs as any)
              : null;

            // 2. Structural entropy (always available, sync)
            const structuralResult = computeStructuralEntropy(thought, strategy);

            // 3. Semantic entropy (requires embed + prior thought)
            let semanticTaskAlignment: number | null = null;
            if (config.entropy.semanticEntropy !== false && llm && priorThought) {
              const embeddings = yield* llm.embed([thought, priorThought]).pipe(
                Effect.catchAll(() => Effect.succeed([] as readonly (readonly number[])[])),
              );
              if (embeddings.length >= 2) {
                const entropyMeta = (kernelState.meta as any)?.entropy ?? {};
                const priorEmbeddings = entropyMeta.thoughtEmbeddings?.embeddings ?? [];
                const centroid = entropyMeta.thoughtEmbeddings?.centroid ?? null;

                const semResult = computeSemanticEntropy({
                  currentEmbedding: embeddings[0] as number[],
                  taskEmbedding: null,
                  priorEmbeddings,
                  centroid,
                });
                semanticTaskAlignment = semResult.taskAlignment;

                // Update centroid in meta (mutable — matches kernel runner pattern)
                const newCentroid = updateCentroid(centroid, embeddings[0] as number[], priorEmbeddings.length);
                (kernelState.meta as any).entropy = {
                  ...entropyMeta,
                  thoughtEmbeddings: {
                    embeddings: [...priorEmbeddings, embeddings[0]],
                    centroid: newCentroid,
                  },
                };
              }
            }

            // 4. Behavioral entropy (from kernel state steps)
            const behavioralResult = computeBehavioralEntropy({
              steps: kernelState.steps as any[],
              iteration,
              maxIterations,
            });

            // 5. Trajectory from prior scores
            const tid = kernelState.taskId;
            const existing = trajectories.get(tid) ?? [];
            const historyValues = existing.map((s) => s.composite);
            const trajectory = historyValues.length > 0
              ? computeEntropyTrajectory(historyValues, maxIterations)
              : undefined;

            // 6. Composite score
            const score = computeCompositeEntropy({
              token: tokenResult?.sequenceEntropy ?? null,
              structural: meanStructural(structuralResult),
              semantic: semanticTaskAlignment,
              behavioral: meanBehavioral(behavioralResult),
              contextPressure: 0,
              logprobsAvailable: tokenResult !== null,
              iteration,
              maxIterations,
              modelTier: model.tier,
              temperature,
              trajectory,
            });

            // Store in per-task trajectory
            existing.push(score);
            trajectories.set(tid, existing);

            return score as EntropyScoreLike;
          }).pipe(Effect.catchAll(() => Effect.succeed(fallbackScore(params)))),

        scoreContext: (params) =>
          Effect.sync(() => {
            const model = lookupModel(params.modelId, config.models);
            return computeContextPressure({
              systemPrompt: "",
              toolResults: [],
              history: [],
              taskDescription: "",
              contextLimit: model.contextLimit,
            }) as ContextPressureLike;
          }),

        getCalibration: (modelId) =>
          Effect.sync(() => {
            const stored = calStore.load(modelId);
            if (!stored) return uncalibratedDefault(modelId);
            return {
              modelId: stored.modelId,
              calibrated: stored.calibrated,
              sampleCount: stored.sampleCount,
              highEntropyThreshold: stored.highEntropyThreshold,
              convergenceThreshold: stored.convergenceThreshold,
            } as ModelCalibrationLike;
          }),

        updateCalibration: (modelId, runScores) =>
          Effect.sync(() => {
            const existing = calStore.load(modelId);
            const allScores = [...(existing?.calibrationScores ?? []), ...runScores];
            const updated = computeCalibration(modelId, allScores);
            calStore.save(updated);
            return {
              modelId: updated.modelId,
              calibrated: updated.calibrated,
              sampleCount: updated.sampleCount,
              highEntropyThreshold: updated.highEntropyThreshold,
              convergenceThreshold: updated.convergenceThreshold,
            } as ModelCalibrationLike;
          }),

        getTrajectory: (taskId) =>
          Effect.sync(() => {
            const existing = trajectories.get(taskId) ?? [];
            const historyValues = existing.map((s) => s.composite);
            return computeEntropyTrajectory(historyValues, 10) as EntropyTrajectoryLike;
          }),
      };
    }),
  );
