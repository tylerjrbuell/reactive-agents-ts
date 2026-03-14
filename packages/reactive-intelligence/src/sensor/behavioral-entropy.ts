import type { BehavioralEntropy } from "../types.js";

type StepLike = {
  type: string;
  content?: string;
  metadata?: Record<string, unknown>;
};

const COMPLETION_MARKERS = [
  "therefore", "the answer is", "in conclusion", "final answer",
  "to summarize", "in summary",
];

export function computeBehavioralEntropy(params: {
  steps: readonly StepLike[];
  iteration: number;
  maxIterations?: number;
}): BehavioralEntropy {
  const { steps, iteration, maxIterations = 10 } = params;
  const actionSteps = steps.filter((s) => s.type === "action");

  // ── Tool success rate ──
  let successes = 0;
  let totalToolCalls = 0;
  for (const step of steps) {
    if (step.type === "action" || step.type === "observation") {
      if (step.metadata?.success !== undefined) {
        totalToolCalls++;
        if (step.metadata.success) successes++;
      }
    }
  }
  const toolSuccessRate = totalToolCalls > 0 ? successes / totalToolCalls : 1.0;

  // ── Action diversity: min(1, unique_tools / iteration) ──
  const toolNames = new Set(
    actionSteps
      .map((s) => (s.metadata?.toolUsed as string) ?? "unknown")
  );
  const actionDiversity = iteration > 0
    ? Math.min(1, toolNames.size / iteration)
    : 0;

  // ── Loop detection: identical consecutive actions ──
  let loopDetectionScore = 0;
  if (actionSteps.length >= 3) {
    const lastN = actionSteps.slice(-3);
    const contents = lastN.map((s) => s.content ?? "");
    const allSame = contents.every((c) => c === contents[0]);
    if (allSame && contents[0] !== "") loopDetectionScore = 1.0;
    else {
      // Partial: check if last 2 are same
      const last2 = actionSteps.slice(-2);
      const c2 = last2.map((s) => s.content ?? "");
      if (c2[0] === c2[1] && c2[0] !== "") loopDetectionScore = 0.5;
    }
  }

  // ── Completion approach: presence of completion markers ──
  let completionApproach = 0;
  const recentThoughts = steps
    .filter((s) => s.type === "thought")
    .slice(-2);
  for (const thought of recentThoughts) {
    const lower = (thought.content ?? "").toLowerCase();
    const markerCount = COMPLETION_MARKERS.filter((m) => lower.includes(m)).length;
    if (markerCount > 0) {
      // Weight by iteration position — later iterations should show completion
      const positionWeight = iteration / maxIterations;
      completionApproach = Math.min(1, markerCount * 0.3 * (0.5 + positionWeight));
    }
  }
  // Also check for final-answer tool usage
  const hasFinalAnswerTool = actionSteps.some(
    (s) => (s.metadata?.toolUsed as string) === "final-answer",
  );
  if (hasFinalAnswerTool) completionApproach = 1.0;

  return {
    toolSuccessRate,
    actionDiversity,
    loopDetectionScore,
    completionApproach,
  };
}
