/**
 * runner-helpers/tool-health.ts — is a tool persistently failing, and has the
 * run already routed around it?
 *
 * ONE predicate, read by every site that talks about a failing tool: the shared
 * recovery-steering text (stall / loop / repeated-failure redirects), the
 * required-tool nudge, and the fail-fast exit (`broken-tool-exit.ts`). It is
 * derived from the step record alone, so it needs no carrier field and clears
 * itself the moment the tool succeeds once.
 *
 * Campaign evidence (2026-11-13, lh-1): `web-search` failed 13 to 44 times per
 * run (the only backend was DuckDuckGo instant answers). The recovery redirect
 * kept telling the model to "retry web-search" after it had switched to
 * `http-get`, and gpt-oss ran 46 iterations before the stall guard ended the
 * run: 66% of the long-horizon tokens bought nothing.
 *
 * Thresholds (documented, executed failures only; a guard-blocked call never
 * ran, so it is no evidence about the tool):
 *   - {@link BROKEN_TOOL_STREAK} = 4 consecutive failures of one tool with no
 *     success of that tool between: guidance names the tool as unavailable and
 *     never recommends retrying it.
 *   - {@link GIVE_UP_STREAK} = 10: if the tool is a REQUIRED tool that has still
 *     not succeeded, the requirement is unsatisfiable and the run ends honestly
 *     (`broken-tool-exit.ts`). The gap between the two is the guidance window.
 */

import type { ReasoningStep } from "../../../types/index.js";
import type { KernelInput, KernelState } from "../../../kernel/state/kernel-state.js";
import {
  GUARD_OBSERVATION_TAG,
  HARNESS_PSEUDO_TOOLS,
  META_TOOLS,
} from "../../../kernel/state/kernel-constants.js";
import { canSubstitute } from "./tool-substitution.js";

/** Consecutive failures at which guidance treats a tool as unavailable. */
export const BROKEN_TOOL_STREAK = 4;
/** Consecutive failures at which an unmet REQUIRED tool is declared unsatisfiable. */
export const GIVE_UP_STREAK = 10;

/** A tool whose trailing executed calls are all failures. */
export interface BrokenTool {
  readonly toolName: string;
  /** Consecutive executed failures since this tool's last success (or the run start). */
  readonly failureStreak: number;
  /**
   * A different tool that does the same kind of work and SUCCEEDED after this
   * tool's last failure: the run has already routed around it.
   */
  readonly routedVia?: string;
}

export interface ToolOutcome {
  readonly toolName: string;
  readonly success: boolean;
}

export function executedOutcomes(steps: readonly ReasoningStep[]): readonly ToolOutcome[] {
  const out: ToolOutcome[] = [];
  for (const step of steps) {
    if (step.type !== "observation" || step.metadata?.frameworkInstrumentation === GUARD_OBSERVATION_TAG) continue;
    const result = step.metadata?.observationResult;
    const toolName = result?.toolName;
    if (typeof toolName !== "string" || toolName.length === 0) continue;
    if (META_TOOLS.has(toolName) || HARNESS_PSEUDO_TOOLS.has(toolName)) continue;
    if (result?.success === undefined) continue;
    out.push({ toolName, success: result.success === true });
  }
  return out;
}

/**
 * Tools with at least `threshold` consecutive executed failures and no success
 * since, each with the alternate (if any) that already succeeded after the
 * failure streak began. Pure over `steps`.
 */
export function brokenTools(
  steps: readonly ReasoningStep[],
  threshold: number = BROKEN_TOOL_STREAK,
): readonly BrokenTool[] {
  const outcomes = executedOutcomes(steps);
  const streak = new Map<string, number>();
  /** Index in `outcomes` of the outcome that began each tool's current failure streak. */
  const streakStart = new Map<string, number>();
  outcomes.forEach((o, i) => {
    if (o.success) {
      streak.delete(o.toolName);
      streakStart.delete(o.toolName);
      return;
    }
    streak.set(o.toolName, (streak.get(o.toolName) ?? 0) + 1);
    if (!streakStart.has(o.toolName)) streakStart.set(o.toolName, i);
  });
  const broken: BrokenTool[] = [];
  for (const [toolName, failureStreak] of streak) {
    if (failureStreak < threshold) continue;
    const from = streakStart.get(toolName) ?? 0;
    const alternate = outcomes
      .slice(from)
      .find((o) => o.success && o.toolName !== toolName && canSubstitute(toolName, o.toolName));
    broken.push({ toolName, failureStreak, ...(alternate === undefined ? {} : { routedVia: alternate.toolName }) });
  }
  return broken;
}

/** The outstanding-list line for a required tool the run declared unavailable. */
export function unavailableToolItem(b: BrokenTool): string {
  return `the \`${b.toolName}\` tool was unavailable (it failed ${b.failureStreak} times in a row), so that requirement could not be met`;
}

/**
 * Required tools that are broken past {@link GIVE_UP_STREAK} and still unmet
 * (successful calls below their quantity floor): the requirement cannot be
 * satisfied by this run. Empty while any of them has a chance (below the
 * threshold, or already satisfied).
 */
export function unavailableRequiredTools(
  state: Pick<KernelState, "steps" | "evidence">,
  input: Pick<KernelInput, "requiredTools" | "requiredToolQuantities">,
): readonly BrokenTool[] {
  const required = new Set(input.requiredTools ?? []);
  if (required.size === 0) return [];
  return brokenTools(state.steps, GIVE_UP_STREAK).filter((b) => {
    if (!required.has(b.toolName)) return false;
    const floor = input.requiredToolQuantities?.[b.toolName] ?? 1;
    return (state.evidence.successfulCounts[b.toolName] ?? 0) < floor;
  });
}
