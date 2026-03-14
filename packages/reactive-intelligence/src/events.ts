import type { EntropyTrajectoryShape } from "./types.js";

// Event payload types — these mirror the shapes added to AgentEvent in @reactive-agents/core

export type EntropyScored = {
  readonly _tag: "EntropyScored";
  readonly taskId: string;
  readonly iteration: number;
  readonly composite: number;
  readonly sources: {
    readonly token: number | null;
    readonly structural: number;
    readonly semantic: number | null;
    readonly behavioral: number;
    readonly contextPressure: number;
  };
  readonly trajectory: {
    readonly derivative: number;
    readonly shape: EntropyTrajectoryShape;
    readonly momentum: number;
  };
  readonly confidence: "high" | "medium" | "low";
  readonly modelTier: "frontier" | "local" | "unknown";
  readonly iterationWeight: number;
};

export type ContextWindowWarning = {
  readonly _tag: "ContextWindowWarning";
  readonly taskId: string;
  readonly modelId: string;
  readonly utilizationPct: number;
  readonly compressionHeadroom: number;
  readonly atRiskSections: readonly string[];
};

export type CalibrationDrift = {
  readonly _tag: "CalibrationDrift";
  readonly taskId: string;
  readonly modelId: string;
  readonly expectedMean: number;
  readonly observedMean: number;
  readonly deviationSigma: number;
};

export type ReactiveDecision = {
  readonly _tag: "ReactiveDecision";
  readonly taskId: string;
  readonly iteration: number;
  readonly decision:
    | "early-stop"
    | "branch"
    | "compress"
    | "switch-strategy"
    | "attribute";
  readonly reason: string;
  readonly entropyBefore: number;
  readonly entropyAfter?: number;
};
