import type { ThinkingOptions } from "./resolve.js";

export const THINKING_MIN = 1024;
export const THINKING_MAX = 16384;

const clamp = (n: number): number => Math.min(Math.max(n, THINKING_MIN), THINKING_MAX);

/**
 * Bounded thinking allowance reserved ON TOP of the answer budget so hidden
 * reasoning can never starve the visible answer. Returns `undefined` when
 * thinking is off or the model is incapable — the caller then leaves the
 * output budget untouched.
 */
export const reserveThinkingBudget = (
  answerBudget: number,
  supportsThinkingMode: boolean,
  opts?: ThinkingOptions,
): number | undefined => {
  if (!supportsThinkingMode) return undefined;
  if (opts?.enabled !== true) return undefined;
  return clamp(opts.budgetTokens ?? answerBudget * 4);
};
