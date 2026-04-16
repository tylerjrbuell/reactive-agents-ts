/**
 * Pure helper functions that compute RunReport enrichment fields from raw execution data.
 * Extracted from execution-engine.ts so they can be unit-tested independently.
 */

export type EntropyEntry = {
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
    readonly shape: string;
    readonly momentum: number;
  };
  readonly confidence: "high" | "medium" | "low";
};

export type AbstractToolBucket = "search" | "write" | "read" | "compute" | "communicate" | "unknown";
export type TaskComplexity = "trivial" | "moderate" | "complex" | "expert";
export type FailurePattern = "loop-detected" | "context-overflow" | "tool-cascade-failure" | "strategy-exhausted" | "guardrail-halt" | "timeout" | "unknown";

/**
 * Run-length encode the trajectory shape sequence.
 * e.g. ["flat","flat","converging","converging","converging"] → "flat-2:converging-3"
 */
export function buildTrajectoryFingerprint(entropyLog: readonly EntropyEntry[]): string | undefined {
  if (!entropyLog.length) return undefined;
  const runs: { shape: string; count: number }[] = [];
  for (const e of entropyLog) {
    const shape = e.trajectory.shape;
    if (runs.length && runs[runs.length - 1].shape === shape) {
      runs[runs.length - 1].count++;
    } else {
      runs.push({ shape, count: 1 });
    }
  }
  return runs.map(r => `${r.shape}-${r.count}`).join(":");
}

/**
 * Bucket a tool name into an abstract action category.
 * Matching is substring-based (lowercase) with priority ordering.
 */
export function abstractifyToolName(name: string): AbstractToolBucket {
  const n = name.toLowerCase();
  if (/search|query|lookup|find|tavily|bing|google/.test(n)) return "search";
  if (/write|save|create|append|insert|upsert|edit|update|patch/.test(n)) return "write";
  if (/read|fetch|get|load|download|retrieve|list|glob|grep/.test(n)) return "read";
  if (/exec|run|bash|shell|python|compute|calculate|eval/.test(n)) return "compute";
  if (/send|email|slack|notify|message|post|webhook/.test(n)) return "communicate";
  return "unknown";
}

/**
 * 1-based index of first iteration where trajectory shape is "converging".
 * Returns null if entropy never converged.
 */
export function firstConvergenceIteration(entropyLog: readonly EntropyEntry[]): number | null {
  const idx = entropyLog.findIndex(e => e.trajectory.shape === "converging");
  return idx >= 0 ? idx + 1 : null;
}

/**
 * Peak context pressure across all iterations.
 */
export function peakContextPressure(entropyLog: readonly EntropyEntry[]): number | undefined {
  if (!entropyLog.length) return undefined;
  return entropyLog.reduce((max, e) => Math.max(max, e.sources.contextPressure), 0);
}

/**
 * Classify task complexity from execution signals.
 *
 * @param realIterations - actual loop iterations completed (ctx.iteration - 1, since ctx starts at 1)
 * @param totalToolCalls - total tool calls made (not unique)
 * @param strategySwitched - whether strategy fallback occurred
 * @param ctxPressurePeak - peak context pressure (0–1), if available
 */
export function deriveTaskComplexity(
  realIterations: number,
  totalToolCalls: number,
  strategySwitched: boolean,
  ctxPressurePeak: number | undefined,
): TaskComplexity {
  // Expert signals take priority over simpler classifications
  if (strategySwitched || totalToolCalls > 5 || realIterations > 6 || (ctxPressurePeak ?? 0) > 0.8) return "expert";
  if (!strategySwitched && totalToolCalls === 0 && realIterations <= 1) return "trivial";
  if (!strategySwitched && totalToolCalls <= 2 && realIterations <= 3) return "moderate";
  return "complex";
}

/**
 * Categorize failure pattern from error signals.
 * Returns undefined when the run succeeded.
 *
 * Priority order:
 * 1. context-overflow (context pressure > 0.95)
 * 2. loop-detected (terminatedBy === "max_iterations")
 * 3. guardrail-halt / timeout / strategy-exhausted (error message patterns)
 * 4. tool-cascade-failure (any tool errors)
 * 5. unknown
 */
export function deriveFailurePattern(
  outcome: "success" | "partial" | "failure",
  terminatedBy: string,
  errorsFromLoop: readonly string[],
  ctxPressurePeak: number | undefined,
): FailurePattern | undefined {
  if (outcome === "success") return undefined;
  if ((ctxPressurePeak ?? 0) > 0.95) return "context-overflow";
  if (terminatedBy === "max_iterations") return "loop-detected";
  if (errorsFromLoop.some(e => e.toLowerCase().includes("guardrail"))) return "guardrail-halt";
  if (errorsFromLoop.some(e => e.toLowerCase().includes("timeout"))) return "timeout";
  if (errorsFromLoop.some(e => e.toLowerCase().includes("strategy"))) return "strategy-exhausted";
  if (errorsFromLoop.some(e => e.startsWith("Tool "))) return "tool-cascade-failure";
  return "unknown";
}

/**
 * Ratio of reasoning steps (thought/plan/reflection/critique) to tool call steps.
 * Returns undefined when there are no tool calls (ratio is undefined/infinite).
 *
 * Step types: "thought" | "action" | "observation" | "plan" | "reflection" | "critique"
 * Reasoning steps = all types except "action" and "observation".
 */
export function deriveThoughtToActionRatio(
  reasoningSteps: readonly { type: string }[],
  totalToolCalls: number,
): number | undefined {
  if (totalToolCalls === 0) return undefined;
  const thinkCount = reasoningSteps.filter(s => s.type !== "action" && s.type !== "observation").length;
  return thinkCount / totalToolCalls;
}

/**
 * Population variance of composite entropy across iterations.
 * Returns 0 for empty or single-point traces.
 */
export function entropyVariance(trace: readonly EntropyEntry[]): number {
  if (trace.length === 0) return 0;
  const mean = trace.reduce((sum, e) => sum + e.composite, 0) / trace.length;
  const sqDiffs = trace.map((e) => (e.composite - mean) ** 2);
  return sqDiffs.reduce((sum, v) => sum + v, 0) / trace.length;
}

/**
 * Count of derivative sign changes — a proxy for trajectory instability.
 * Zero derivatives are skipped (they don't break a run).
 * Returns 0 for traces with fewer than 2 points.
 */
export function entropyOscillationCount(trace: readonly EntropyEntry[]): number {
  if (trace.length < 2) return 0;
  let flips = 0;
  let prevSign = 0;
  for (const entry of trace) {
    const sign = entry.trajectory.derivative > 0 ? 1 : entry.trajectory.derivative < 0 ? -1 : 0;
    if (sign === 0) continue; // zero derivative doesn't break a run
    if (prevSign !== 0 && sign !== prevSign) flips++;
    prevSign = sign;
  }
  return flips;
}

/**
 * The final composite entropy value — tells us where the run ended up.
 * Returns null for empty traces.
 */
export function finalCompositeEntropy(trace: readonly EntropyEntry[]): number | null {
  if (trace.length === 0) return null;
  return trace[trace.length - 1]!.composite;
}

/**
 * Trapezoidal area under the composite entropy curve — total uncertainty-iterations.
 * Width of each trapezoid is the iteration delta (handles non-uniform spacing).
 * Returns 0 for traces with fewer than 2 points.
 */
export function entropyAreaUnderCurve(trace: readonly EntropyEntry[]): number {
  if (trace.length < 2) return 0;
  let auc = 0;
  for (let i = 1; i < trace.length; i++) {
    const h1 = trace[i - 1]!.composite;
    const h2 = trace[i]!.composite;
    const width = trace[i]!.iteration - trace[i - 1]!.iteration;
    auc += ((h1 + h2) / 2) * width;
  }
  return auc;
}
