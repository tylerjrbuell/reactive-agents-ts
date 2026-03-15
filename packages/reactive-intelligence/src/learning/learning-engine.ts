import { Context, Effect, Layer } from "effect";
import type { CalibrationStore } from "../calibration/calibration-store.js";
import { computeCalibration } from "../calibration/conformal.js";
import { shouldSynthesizeSkill } from "./skill-synthesis.js";
import { updateArm } from "./bandit.js";
import type { BanditStore } from "./bandit-store.js";
import { classifyTaskCategory } from "./task-classifier.js";

export type RunCompletedData = {
  readonly modelId: string;
  readonly taskDescription: string;
  readonly strategy: string;
  readonly outcome: "success" | "partial" | "failure";
  readonly entropyHistory: readonly {
    composite: number;
    trajectory: { shape: string };
  }[];
  readonly totalTokens: number;
  readonly durationMs: number;
  readonly temperature: number;
  readonly maxIterations: number;
  readonly toolFilteringMode?: "adaptive" | "static" | "none";
  readonly requiredToolsCount?: number;
  readonly memoryTier?: string;
  readonly semanticLines?: number;
  readonly episodicLines?: number;
  readonly consolidationEnabled?: boolean;
  readonly strategySwitchingEnabled?: boolean;
  readonly adaptiveEnabled?: boolean;
};

export type LearningResult = {
  readonly calibrationUpdated: boolean;
  readonly banditUpdated: boolean;
  readonly skillSynthesized: boolean;
  readonly taskCategory: string;
};

export class LearningEngineService extends Context.Tag(
  "LearningEngineService",
)<
  LearningEngineService,
  {
    readonly onRunCompleted: (
      data: RunCompletedData,
    ) => Effect.Effect<LearningResult, never>;
  }
>() {}

export const LearningEngineServiceLive = (
  calibrationStore: CalibrationStore,
  banditStore: BanditStore,
): Layer.Layer<LearningEngineService> =>
  Layer.succeed(LearningEngineService, {
    onRunCompleted: (data) =>
      Effect.sync(() => {
        const taskCategory = classifyTaskCategory(data.taskDescription);
        const composites = data.entropyHistory.map((e) => e.composite);
        const meanEntropy =
          composites.length > 0
            ? composites.reduce((s, v) => s + v, 0) / composites.length
            : 0.5;

        // 1. Update calibration
        let calibrationUpdated = false;
        if (composites.length > 0) {
          const existing = calibrationStore.load(data.modelId);
          const allScores = [
            ...(existing?.calibrationScores ?? []),
            meanEntropy,
          ];
          const calibration = computeCalibration(data.modelId, allScores);
          calibrationStore.save(calibration);
          calibrationUpdated = true;
        }

        // 2. Update bandit arm
        const contextBucket = `${data.modelId}:${taskCategory}`;
        const reward = 1 - meanEntropy; // lower entropy = higher reward
        updateArm(contextBucket, data.strategy, reward, banditStore);
        const banditUpdated = true;

        // 3. Check for skill synthesis
        const calibration = calibrationStore.load(data.modelId);
        const threshold = calibration?.highEntropyThreshold ?? 0.8;
        const skillSynthesized = shouldSynthesizeSkill({
          entropyHistory: data.entropyHistory,
          outcome: data.outcome,
          highEntropyThreshold: threshold,
        });

        return {
          calibrationUpdated,
          banditUpdated,
          skillSynthesized,
          taskCategory,
        };
      }),
  });
