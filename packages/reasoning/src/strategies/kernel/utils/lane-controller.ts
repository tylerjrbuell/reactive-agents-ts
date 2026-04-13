import { getMissingRequiredToolsByCount } from "./requirement-state.js";

export type ExecutionLane = "gather" | "synthesize";

export interface LaneDecision {
  readonly lane: ExecutionLane;
  readonly canFinalize: boolean;
  readonly missingRequiredTools: readonly string[];
}

export function decideExecutionLane(input: {
  readonly requiredTools: readonly string[];
  readonly requiredToolQuantities?: Readonly<Record<string, number>>;
  readonly successfulToolCounts: Readonly<Record<string, number>>;
}): LaneDecision {
  const missingRequiredTools = getMissingRequiredToolsByCount(
    input.successfulToolCounts,
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
