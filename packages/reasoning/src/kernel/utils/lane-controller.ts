import { effectiveMissingRequired, type ToolEvidence } from "../capabilities/verify/requirement-state.js";

export type ExecutionLane = "gather" | "synthesize";

export interface LaneDecision {
  readonly lane: ExecutionLane;
  readonly canFinalize: boolean;
  readonly missingRequiredTools: readonly string[];
}

export function decideExecutionLane(input: {
  readonly requiredTools: readonly string[];
  readonly requiredToolQuantities?: Readonly<Record<string, number>>;
  /** The run's tool evidence (`state.evidence`): run-wide, seeded passes included. */
  readonly evidence: ToolEvidence;
}): LaneDecision {
  const missingRequiredTools = effectiveMissingRequired(
    input.evidence,
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
