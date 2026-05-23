/**
 * task-complexity.ts — Lightweight regex-based pre-execution complexity classifier.
 *
 * Called once at strategy entry to gate cost-expensive exploration phases
 * (notably ToT BFS) when the task is obviously trivial or factual.
 *
 * Design: Pure regex/keyword extraction — NO LLM call. Must be fast and
 * deterministic. Errs on the "moderate" side: only classifies as "trivial"
 * when high-confidence signals are present; defaults to "moderate" for
 * ambiguous prompts so the cost gate does not over-skip legitimate
 * multi-step work.
 *
 * Reference: HS-110 / M3 — sweep-2026-05-23 evidence showed ToT × t1-trivial
 * costing 3.3× reactive (frontier) and 23× reactive (local-tier qwen3:14b)
 * with identical 391-char numeric answers. Direct anti-mission #6 violation
 * ("NOT a system that spends cost without proportional return").
 */

/** Pre-execution task complexity. Used to gate expensive exploration phases. */
export type PreTaskComplexity = "trivial" | "moderate" | "complex";

export interface TaskComplexityClassification {
  readonly complexity: PreTaskComplexity;
  /** Why the classifier landed on this verdict — for telemetry + debugging. */
  readonly reason: string;
  /** Confidence in [0, 1]. Trivial verdicts are only emitted when confidence ≥ 0.7. */
  readonly confidence: number;
}

// ── Patterns ────────────────────────────────────────────────────────────────

/** Lookup / single-fact recall ("capital of …", "atomic number of …"). */
const TRIVIAL_LOOKUP_PATTERNS: readonly RegExp[] = [
  /\bwhat(?:'s| is| are)\s+(?:the\s+)?capital\s+of\b/i,
  /\bwho\s+(?:is|was)\s+(?:the\s+)?(?:president|king|queen|founder|ceo)\b/i,
  /\b(?:atomic|molecular)\s+(?:number|weight|mass)\s+of\b/i,
  /\bdefine\s+(?:the\s+)?(?:word|term)\b/i,
];

/** Single-step arithmetic / numeric calculation. */
const TRIVIAL_MATH_PATTERNS: readonly RegExp[] = [
  // "17 × 23", "what is 17 times 23", "17 * 23", "17 multiplied by 23"
  /^\s*\d+\s*[\*x×]\s*\d+\s*[=?]?\s*$/i,
  /\bwhat\s+is\s+\d+\s*(?:[\*x×+\-\/]|times|plus|minus|divided\s+by|multiplied\s+by)\s*\d+\b/i,
  /\bcalculate\s+\d+\s*[\*x×+\-\/]\s*\d+\b/i,
  /^\s*(?:compute|solve)\s+\d+\s*[\*x×+\-\/]\s*\d+/i,
];

/**
 * Multi-step indicators — when ANY appear, the task is at least "moderate".
 * Word boundary + lookahead so we don't false-positive on adjectives like
 * "first-class" or "compare-and-contrast" used in casual prose.
 */
const MULTI_STEP_INDICATORS: readonly RegExp[] = [
  /\b(?:then|after that|once you've|next|finally|subsequently)\b/i,
  /\b(?:step \d+|first(?:ly)?,? (?:then|next)|second(?:ly)?,? (?:then|next))/i,
  /\b(?:plan|design|architect|implement|refactor|debug)\s+(?:a|an|the)\b/i,
  /\bmulti(?:-|\s)step\b/i,
];

/**
 * Analysis / critique / synthesis verbs — present means "complex" candidate.
 * These verbs reliably indicate the task wants exploration of alternatives.
 */
const COMPLEX_INDICATORS: readonly RegExp[] = [
  /\b(?:critique|evaluate|assess|justify|reconcile)\b/i,
  /\b(?:strategy|strategies|architecture)\b/i,
  /\btrade[\s-]?offs?\b/i,
  /\bpros\s+and\s+cons\b/i,
  /\badvantages\s+and\s+disadvantages\b/i,
  /\b(?:compare\s+and\s+contrast|analyze\s+and|critique\s+and|outline\s+and)\b/i,
  /\b(?:why\s+(?:would|should|might)|how\s+would\s+you\s+approach)\b/i,
];

/**
 * Word-count + char-count signals.
 * `<= TRIVIAL_WORDS` is a necessary (not sufficient) trivial condition.
 */
const TRIVIAL_WORDS = 12;
const TRIVIAL_CHARS = 80;

/**
 * Classify a task description by complexity *before* the strategy runs.
 *
 * Decision order (first match wins):
 *  1. ANY complex indicator → "complex" (force exploration)
 *  2. ANY multi-step indicator → "moderate"
 *  3. ANY trivial lookup/math pattern → "trivial"
 *  4. Short prose (≤ TRIVIAL_WORDS words AND ≤ TRIVIAL_CHARS chars) → "trivial"
 *  5. Otherwise → "moderate"
 */
export function classifyTaskComplexity(
  task: string,
): TaskComplexityClassification {
  const normalized = task.trim();
  if (normalized.length === 0) {
    return { complexity: "moderate", reason: "empty-task", confidence: 0.0 };
  }

  // 1. Complex indicators force exploration.
  for (const pattern of COMPLEX_INDICATORS) {
    if (pattern.test(normalized)) {
      return {
        complexity: "complex",
        reason: `complex-indicator:${pattern.source.slice(0, 32)}`,
        confidence: 0.85,
      };
    }
  }

  // 2. Multi-step indicators → moderate (BFS may help but not "complex").
  for (const pattern of MULTI_STEP_INDICATORS) {
    if (pattern.test(normalized)) {
      return {
        complexity: "moderate",
        reason: `multi-step-indicator:${pattern.source.slice(0, 32)}`,
        confidence: 0.75,
      };
    }
  }

  // 3. Trivial lookup / arithmetic patterns.
  for (const pattern of TRIVIAL_LOOKUP_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        complexity: "trivial",
        reason: `lookup-pattern:${pattern.source.slice(0, 32)}`,
        confidence: 0.9,
      };
    }
  }
  for (const pattern of TRIVIAL_MATH_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        complexity: "trivial",
        reason: `math-pattern:${pattern.source.slice(0, 32)}`,
        confidence: 0.9,
      };
    }
  }

  // 4. Short prose with no multi-step signal — likely trivial.
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (wordCount <= TRIVIAL_WORDS && normalized.length <= TRIVIAL_CHARS) {
    return {
      complexity: "trivial",
      reason: `short-prose:${wordCount}w/${normalized.length}c`,
      confidence: 0.7,
    };
  }

  // 5. Default — moderate. BFS allowed but not forced.
  return { complexity: "moderate", reason: "default-moderate", confidence: 0.5 };
}
