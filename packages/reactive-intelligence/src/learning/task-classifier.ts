/**
 * Task Category Classifier — keyword heuristic.
 *
 * Classifies a task description into a category using pure keyword matching.
 * Used for telemetry bucketing, bandit context vectors, and per-category
 * entropy source weight selection.
 * NO LLM call, NO Effect wrapper — pure function for speed.
 *
 * Categories (9):
 *   multi-step, communication, file-operation, code-debug, code-write,
 *   data-analysis, deep-research, quick-lookup, general
 */

// ─── Category Keywords ───
// Priority order: earlier entries take precedence over later entries.
// Within each category, ANY keyword match triggers the classification.

const CATEGORY_KEYWORDS: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  // Communication: agent sends/notifies external recipient
  ["communication", ["send", "message", "email", "notify", "signal", "slack", "tell", "inform", "share with", "alert"]],
  // File operation: direct file system interaction
  ["file-operation", ["read file", "write file", "save to file", "parse file", "extract from file", "create file", "open file", "load file"]],
  // Code debug: fixing existing code (checked before code-write to catch "fix"/"bug" first)
  ["code-debug", ["fix", "bug", "error", "debug", "why is", "failing", "broken", "crash", "exception", "stack trace", "traceback"]],
  // Code write: creating new code
  ["code-write", ["implement", "write a function", "write a class", "create a class", "build a", "scaffold", "generate code", "refactor", "compile", "typescript", "python", "javascript"]],
  // Data analysis: statistical / analytical work
  ["data-analysis", ["analyze", "data", "trend", "chart", "statistics", "metric", "measure", "correlate", "dataset", "visualize"]],
  // Deep research: multi-source investigation
  ["deep-research", ["investigate", "compare", "report on", "research", "in-depth", "comprehensive", "analyze and", "evaluate"]],
  // Quick lookup: simple factual retrieval
  ["quick-lookup", ["what is", "who is", "define", "find", "search", "look up", "discover", "explain", "how does", "when did"]],
];

/** Action verbs used for multi-step detection (one per typical tool group). */
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
 * Priority: multi-step > communication > file-operation > code-debug > code-write
 *         > data-analysis > deep-research > quick-lookup > general
 *
 * @param taskDescription - The natural-language task description
 * @returns One of the 9 task categories
 */
export function classifyTaskCategory(taskDescription: string): string {
  const lower = taskDescription.toLowerCase();

  // Check multi-step first: 2+ distinct action verb groups present
  let matchedGroups = 0;
  for (const group of ACTION_VERB_GROUPS) {
    if (group.some((verb) => lower.includes(verb))) {
      matchedGroups++;
    }
  }
  if (matchedGroups >= 2) {
    return "multi-step";
  }

  // Walk categories in priority order
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return category;
    }
  }

  return "general";
}
