/**
 * Task Category Classifier — keyword heuristic.
 *
 * Classifies a task description into a category using pure keyword matching.
 * Used for telemetry bucketing and bandit context vectors.
 * NO LLM call, NO Effect wrapper — pure function for speed.
 */

// ─── Category Keywords ───

const CATEGORY_KEYWORDS: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  ["communication", ["send", "message", "email", "notify", "signal", "slack", "tell", "inform", "share with", "alert"]],
  ["code-generation", ["write", "implement", "code", "function", "class", "bug", "fix", "debug", "refactor", "compile", "syntax", "typescript", "python", "javascript"]],
  ["data-analysis", ["analyze", "data", "trend", "chart", "statistics", "metric", "measure", "compare", "correlate", "dataset"]],
  ["research", ["find", "search", "look up", "information", "learn", "discover", "investigate", "explore", "what is", "who is", "explain"]],
];

/** Action verbs used for multi-tool detection (one per typical tool group). */
const ACTION_VERB_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  ["fetch", "get", "retrieve", "download"],
  ["send", "notify", "email", "message", "alert"],
  ["write", "create", "generate", "implement"],
  ["search", "find", "look up", "discover"],
  ["analyze", "measure", "compare", "correlate"],
  ["summarize", "summarise", "condense"],
  ["read", "parse", "extract"],
];

// ─── Classifier ───

/**
 * Classify a task description into a category using keyword heuristics.
 *
 * Priority: multi-tool > communication > code-generation > data-analysis > research > general
 *
 * @param taskDescription - The natural-language task description
 * @returns One of: "multi-tool" | "communication" | "code-generation" | "data-analysis" | "research" | "general"
 */
export function classifyTaskCategory(taskDescription: string): string {
  const lower = taskDescription.toLowerCase();

  // Check multi-tool first: 2+ distinct action verb groups present
  let matchedGroups = 0;
  for (const group of ACTION_VERB_GROUPS) {
    if (group.some((verb) => lower.includes(verb))) {
      matchedGroups++;
    }
  }
  if (matchedGroups >= 2) {
    return "multi-tool";
  }

  // Walk categories in priority order
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return category;
    }
  }

  return "general";
}
