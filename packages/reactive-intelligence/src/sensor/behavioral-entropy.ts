import type { BehavioralEntropy } from "../types.js";

type StepLike = {
  type: string;
  content?: string;
  metadata?: Record<string, unknown>;
};

/** Normalize action JSON for comparison — re-serializes to canonical form. */
function normalizeActionJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content));
  } catch {
    return content.replace(/\s+/g, " ").trim();
  }
}

const COMPLETION_MARKERS = [
  "therefore", "the answer is", "in conclusion", "final answer",
  "to summarize", "in summary",
];

/** Expected tool count range per task category — used to normalize actionDiversity. */
const EXPECTED_TOOL_RANGE: Record<string, [min: number, max: number]> = {
  "quick-lookup": [1, 2],
  "deep-research": [2, 4],
  "code-write": [2, 4],
  "code-debug": [2, 5],
  "data-analysis": [2, 4],
  "file-operation": [1, 2],
  "communication": [1, 2],
  "multi-step": [3, 6],
  "general": [1, 4],
};

export function computeBehavioralEntropy(params: {
  steps: readonly StepLike[];
  iteration: number;
  maxIterations?: number;
  taskCategory?: string;
}): BehavioralEntropy {
  const { steps, iteration, maxIterations = 10, taskCategory } = params;
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

  // ── Action diversity: normalized against expected tool count per task category ──
  const toolNames = new Set(actionSteps.map((s) => {
    const tc = s.metadata?.toolCall as { name: string } | undefined;
    return tc?.name ?? (s.metadata?.toolUsed as string) ?? "unknown";
  }));
  const [minExpected, maxExpected] = EXPECTED_TOOL_RANGE[taskCategory ?? "general"] ?? EXPECTED_TOOL_RANGE["general"]!;
  const actionDiversity = iteration > 0
    ? Math.min(1, toolNames.size / Math.max(minExpected, Math.min(maxExpected, iteration)))
    : 0;

  // ── Loop detection: identical consecutive actions ──
  // Normalize action content for comparison — handles JSON formatting differences
  // and also checks tool names from metadata for structural matching.
  let loopDetectionScore = 0;
  if (actionSteps.length >= 2) {
    const last2 = actionSteps.slice(-2);
    const isSameAction = (a: StepLike, b: StepLike): boolean => {
      // Check tool name match first (most reliable)
      // FC path: toolCall.name takes priority over legacy toolUsed
      const tcA = a.metadata?.toolCall as { name: string } | undefined;
      const tcB = b.metadata?.toolCall as { name: string } | undefined;
      const toolA = tcA?.name ?? (a.metadata?.toolUsed as string | undefined);
      const toolB = tcB?.name ?? (b.metadata?.toolUsed as string | undefined);
      if (toolA && toolB && toolA === toolB) {
        // Same tool — check if args are equivalent
        const contentA = normalizeActionJson(a.content ?? "");
        const contentB = normalizeActionJson(b.content ?? "");
        return contentA === contentB;
      }
      // Fall back to raw content comparison
      return (a.content ?? "") === (b.content ?? "") && (a.content ?? "") !== "";
    };

    if (isSameAction(last2[0]!, last2[1]!)) {
      // 2 consecutive identical actions — already a strong loop signal
      loopDetectionScore = 0.8;
      // Check for 3+
      if (actionSteps.length >= 3 && isSameAction(actionSteps[actionSteps.length - 3]!, last2[0]!)) {
        loopDetectionScore = 1.0;
      }
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
  // Also check for final-answer tool usage (FC path: toolCall.name; legacy: toolUsed)
  const hasFinalAnswerTool = actionSteps.some((s) => {
    const tc = s.metadata?.toolCall as { name: string } | undefined;
    const name = tc?.name ?? (s.metadata?.toolUsed as string);
    return name === "final-answer";
  });
  if (hasFinalAnswerTool) completionApproach = 1.0;

  return {
    toolSuccessRate,
    actionDiversity,
    loopDetectionScore,
    completionApproach,
  };
}
