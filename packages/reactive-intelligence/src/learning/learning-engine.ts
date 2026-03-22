import { Context, Effect, Layer } from "effect";
import type { CalibrationStore } from "../calibration/calibration-store.js";
import { computeCalibration } from "../calibration/conformal.js";
import type { SkillFragment } from "../telemetry/types.js";
import {
  shouldSynthesizeSkill,
  extractSkillFragment,
  skillFragmentToProceduralEntry,
} from "./skill-synthesis.js";
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
  readonly skillFragment?: SkillFragment;
  readonly taskCategory: string;
};

export type SkillStore = {
  readonly store: (entry: unknown) => Effect.Effect<unknown, unknown>;
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
  skillStore?: SkillStore,
): Layer.Layer<LearningEngineService> =>
  Layer.succeed(LearningEngineService, {
    onRunCompleted: (data) =>
      Effect.gen(function* () {
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

        // 4. Extract and persist skill fragment when synthesis qualifies
        let skillFragment: SkillFragment | undefined;
        if (skillSynthesized) {
          skillFragment = extractSkillFragment({
            strategy: data.strategy,
            temperature: data.temperature,
            maxIterations: data.maxIterations,
            toolFilteringMode: data.toolFilteringMode ?? "none",
            requiredToolsCount: data.requiredToolsCount ?? 0,
            memoryTier: data.memoryTier ?? "basic",
            semanticLines: data.semanticLines ?? 0,
            episodicLines: data.episodicLines ?? 0,
            consolidationEnabled: data.consolidationEnabled ?? false,
            strategySwitchingEnabled: data.strategySwitchingEnabled ?? false,
            adaptiveEnabled: data.adaptiveEnabled ?? false,
            entropyHistory: data.entropyHistory,
          });

          if (skillStore) {
            const entry = skillFragmentToProceduralEntry({
              fragment: skillFragment,
              agentId: "system",
              taskCategory,
              modelId: data.modelId,
            });
            yield* Effect.catchAll(() => Effect.void)(
              skillStore.store(entry),
            );
          }
        }

        return {
          calibrationUpdated,
          banditUpdated,
          skillSynthesized,
          skillFragment,
          taskCategory,
        };
      }),
  });
