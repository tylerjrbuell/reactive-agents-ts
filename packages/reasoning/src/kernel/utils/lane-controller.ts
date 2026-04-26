import type { ReasoningStep } from "../../types/index.js";
import { getEffectiveMissingRequiredTools } from "../capabilities/verify/requirement-state.js";

export type ExecutionLane = "gather" | "synthesize";

export interface LaneDecision {
  readonly lane: ExecutionLane;
  readonly canFinalize: boolean;
  readonly missingRequiredTools: readonly string[];
}

export function decideExecutionLane(input: {
  readonly requiredTools: readonly string[];
  readonly requiredToolQuantities?: Readonly<Record<string, number>>;
  readonly steps: readonly ReasoningStep[];
}): LaneDecision {
  const missingRequiredTools = getEffectiveMissingRequiredTools(
    input.steps,
    input.requiredTools,
    input.requiredToolQuantities,
  );
  const canFinalize = missingRequiredTools.length === 0;
  return {
    lane: canFinalize ? "synthesize" : "gather",
    canFinalize,
    missingRequiredTools,
  };
}

export function shouldInjectOracleNudge(input: {
  readonly lane: ExecutionLane;
  readonly oracleReady: boolean;
}): boolean {
  return input.oracleReady && input.lane === "synthesize";
}
