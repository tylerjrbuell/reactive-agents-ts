import { Context, Effect } from "effect";

// ─── Loose types to avoid importing from @reactive-agents/reasoning ───

/** Structural match for KernelState — avoids circular dependency. */
export type KernelStateLike = {
  readonly taskId: string;
  readonly strategy: string;
  readonly kernelType: string;
  readonly steps: readonly { type: string; content?: string; metadata?: Record<string, unknown> }[];
  readonly toolsUsed: ReadonlySet<string>;
  readonly iteration: number;
  readonly tokens: number;
  readonly status: string;
  readonly output: string | null;
  readonly error: string | null;
  readonly meta: Readonly<Record<string, unknown>>;
};

export type TokenLogprobLike = {
  readonly token: string;
  readonly logprob: number;
  readonly topLogprobs?: readonly { token: string; logprob: number }[];
};

export type EntropyScoreLike = {
  readonly composite: number;
  readonly sources: {
    readonly token: number | null;
    readonly structural: number;
    readonly semantic: number | null;
    readonly behavioral: number;
    readonly contextPressure: number;
  };
  readonly trajectory: { readonly derivative: number; readonly shape: string; readonly momentum: number };
  readonly confidence: "high" | "medium" | "low";
  readonly modelTier: "frontier" | "local" | "unknown";
  readonly iteration: number;
  readonly iterationWeight: number;
  readonly timestamp: number;
};

export type EntropyTrajectoryLike = {
  readonly history: readonly number[];
  readonly derivative: number;
  readonly momentum: number;
  readonly shape: string;
};

export type ModelCalibrationLike = {
  readonly modelId: string;
  readonly calibrated: boolean;
  readonly sampleCount: number;
  readonly highEntropyThreshold: number;
  readonly convergenceThreshold: number;
};

export type ContextSectionLike = {
  readonly label: string;
  readonly tokenEstimate: number;
  readonly signalDensity: number;
  readonly position: "near" | "mid" | "far";
};

export type ContextPressureLike = {
  readonly utilizationPct: number;
  readonly sections: readonly ContextSectionLike[];
  readonly atRiskSections: readonly string[];
  readonly compressionHeadroom: number;
};

export class EntropySensorService extends Context.Tag("EntropySensorService")<
  EntropySensorService,
  {
    readonly score: (params: {
      thought: string;
      taskDescription: string;
      strategy: string;
      iteration: number;
      maxIterations: number;
      modelId: string;
      temperature: number;
      priorThought?: string;
      logprobs?: readonly TokenLogprobLike[];
      kernelState: KernelStateLike;
      /** Task category for per-category scoring adjustments. */
      taskCategory?: string;
    }) => Effect.Effect<EntropyScoreLike, never>;

    readonly scoreContext: (params: {
      modelId: string;
      sections: ContextSectionLike[];
    }) => Effect.Effect<ContextPressureLike, never>;

    readonly getCalibration: (modelId: string) => Effect.Effect<ModelCalibrationLike, never>;

    readonly updateCalibration: (
      modelId: string,
      runScores: readonly number[],
    ) => Effect.Effect<ModelCalibrationLike, never>;

    readonly getTrajectory: (taskId: string) => Effect.Effect<EntropyTrajectoryLike, never>;
  }
>() {}
