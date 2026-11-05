// File: src/strategies/planning/prior-results.ts
//
// The data from earlier plan steps that a later step's prompt carries.
//
// A tool step keeps two forms of its output: `result`, a compressed preview
// (`[file-read result — compressed preview]` + a few lines + `...N more
// lines`), and `fullResult`, the complete payload. Step prompts used the
// preview, so an analysis step that had to summarize a 46-row CSV saw 3 rows
// and wrote its report from them (H3 rw-3, 8 failures on 2026-11-04, both
// tiers, attributed `harness:evidence-truncated`).
//
// Policy, the same as the kernel projection's (`project-results.ts`): recent
// evidence stays whole within the recency budget, newest first; anything that
// no longer fits falls back to its preview, which still names how to recall it.

import { recencyBudgetCharsForWindow } from "../../assembly/capability.js";
import { resolveProfile } from "../../context/profile-resolver.js";
import type { PlanStep } from "../../types/plan.js";

/** One prior step as a step prompt renders it. */
export interface PriorResult {
  readonly stepId: string;
  readonly title: string;
  readonly result: string;
}

/** Window assumed when the model's context window is unknown (the `mid` profile's). */
const DEFAULT_WINDOW_TOKENS = 32_768;

/**
 * Chars of prior-step data a step prompt may carry in full for `modelId`.
 *
 * @param modelId The run's model id; unknown or absent resolves to the `mid` profile.
 */
export function priorResultsBudgetChars(modelId: string | undefined): number {
  const window = resolveProfile(modelId ?? "mid").maxTokens ?? DEFAULT_WINDOW_TOKENS;
  return recencyBudgetCharsForWindow(window);
}

/**
 * Prior step data for a step prompt, in step order. Walking newest first, each
 * step contributes its full result (`fullResult`, else `result`) while the
 * running total fits `budgetChars`; a step that no longer fits contributes its
 * preview (`result`). Steps without a result are omitted.
 *
 * @param steps Completed steps, oldest first.
 * @param budgetChars Total chars of full results allowed (see {@link priorResultsBudgetChars}).
 */
export function priorResultsForPrompt(
  steps: readonly Pick<PlanStep, "id" | "title" | "result" | "fullResult">[],
  budgetChars: number,
): PriorResult[] {
  const withResult = steps.filter((s): s is typeof s & { result: string } => typeof s.result === "string" && s.result.length > 0);
  let used = 0;
  const chosen = new Map<string, string>();
  for (let i = withResult.length - 1; i >= 0; i--) {
    const s = withResult[i]!;
    const full = s.fullResult ?? s.result;
    if (used + full.length <= budgetChars) {
      used += full.length;
      chosen.set(s.id, full);
    } else {
      chosen.set(s.id, s.result);
    }
  }
  return withResult.map((s) => ({ stepId: s.id, title: s.title, result: chosen.get(s.id) ?? s.result }));
}
