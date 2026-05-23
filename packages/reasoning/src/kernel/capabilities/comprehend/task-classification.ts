/**
 * task-classification.ts — Single canonical pre-execution task understanding.
 *
 * HS-cleanup-2 (2026-05-23): the framework had ~5 task classifiers, three of
 * which ran on the task string before execution (ToT entry, adaptive heuristic,
 * learning task-category). Each drifted independently and re-derived the same
 * signal from the same input. This module is the canonical aggregator: produce
 * the `TaskClassification` ONCE upstream, thread through strategy inputs,
 * downstream consumers READ from it instead of re-classifying.
 *
 * Composed of (today):
 *  - `TaskComplexityClassification` from task-complexity.ts (trivial/moderate/complex)
 *  - `TaskIntent` from task-intent.ts (output format + content/entity hints)
 *
 * Add new dimensions here, not in strategy code. The aggregator stays the
 * single point of pre-execution comprehension.
 */
import {
  classifyTaskComplexity,
  type TaskComplexityClassification,
} from "./task-complexity.js";
import { extractOutputFormat, type TaskIntent } from "./task-intent.js";

export interface TaskClassification {
  readonly complexity: TaskComplexityClassification;
  readonly intent: TaskIntent;
}

/**
 * Single-pass canonical classification. Pure, deterministic, no LLM calls.
 * Safe to call multiple times for the same input — returns identical results.
 *
 * Consumers should call this AT MOST ONCE per agent run (typically in the
 * execution engine / reasoning service entry) and thread the result through
 * strategy inputs as `taskClassification`.
 */
export function classifyTask(task: string): TaskClassification {
  return {
    complexity: classifyTaskComplexity(task),
    intent: extractOutputFormat(task),
  };
}
