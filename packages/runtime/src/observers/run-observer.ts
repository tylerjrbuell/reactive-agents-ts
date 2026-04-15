import { appendObservation, type RunObservation } from "@reactive-agents/reactive-intelligence";

export interface ToolCallLogEntry {
  readonly turn: number;
  readonly toolName: string;
}

export interface BuildObservationInput {
  readonly modelId: string;
  readonly toolCallLog: readonly ToolCallLogEntry[];
  readonly totalTurns: number;
  readonly dialect: RunObservation["dialect"];
  readonly classifierRequired: readonly string[];
  readonly classifierActuallyCalled: readonly string[];
  readonly subagentInvoked: number;
  readonly subagentSucceeded: number;
  readonly argValidityRate: number;
}

export interface PersistOptions {
  readonly baseDir?: string;
}

/**
 * Count turns in which ≥2 tool calls appeared in a single model response.
 * Exported so execution-engine can emit the same count on the wire (RunReport.parallelTurnCount)
 * without re-implementing the logic.
 */
export function countParallelTurnsFromLog(toolCallLog: readonly ToolCallLogEntry[]): number {
  const turnCallCounts = new Map<number, number>();
  for (const entry of toolCallLog) {
    turnCallCounts.set(entry.turn, (turnCallCounts.get(entry.turn) ?? 0) + 1);
  }
  return [...turnCallCounts.values()].filter((count) => count >= 2).length;
}

export function buildRunObservation(input: BuildObservationInput): RunObservation {
  const parallelTurnCount = countParallelTurnsFromLog(input.toolCallLog);

  return {
    at: new Date().toISOString(),
    parallelTurnCount,
    totalTurnCount: input.totalTurns,
    dialect: input.dialect,
    classifierRequired: input.classifierRequired,
    classifierActuallyCalled: input.classifierActuallyCalled,
    subagentInvoked: input.subagentInvoked,
    subagentSucceeded: input.subagentSucceeded,
    argValidityRate: input.argValidityRate,
  };
}

/**
 * Persist an observation. Never throws — observer failure must not affect agents.
 */
export function persistRunObservation(
  modelId: string,
  observation: RunObservation,
  opts: PersistOptions = {},
): void {
  try {
    appendObservation(modelId, observation, { baseDir: opts.baseDir });
  } catch {
    // Silent — observer is best-effort only
  }
}
