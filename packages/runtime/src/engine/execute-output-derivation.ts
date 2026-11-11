/**
 * Final-output derivation for the TaskResult boundary.
 *
 * Owns: the `rawOutput` read off ctx, the sanitize pass, and the trimmed
 * string + substantive-output flags the success bit consumes.
 *
 * The output is only the model's own answer (owner decision 2026-11-10). It
 * is never refilled from the last tool observation when the model wrote
 * nothing: files a run landed ride `receipt.deliverables`, and an empty answer
 * with no landed deliverable is a failure with its cause on `error`
 * (execute-success-invariants.ts).
 *
 * Moved verbatim from execution-engine.ts (GH #221 W26 decomposition, former
 * "Build TaskResult — sanitize output" block lines 1010-1045). Pure: reads
 * ctx/rr, mutates nothing.
 */
import type { ExecutionContext } from "../types.js";
import { sanitizeOutput } from "./util.js";

export interface DerivedExecOutput {
  readonly sanitizedOutput: unknown;
  readonly outputForSuccess: string;
  readonly hasSubstantiveOutput: boolean;
}

/**
 * True when the harness wrote the terminal text itself, so it is not shipped.
 *
 * `harnessAuthoredOutput` has two producers. The kernel sets it only on the
 * `harness_deliverable` terminal (a normalized tool observation such as
 * "✓ Written to x.txt"); that relays `rawTerminatedBy: "harness_deliverable"`.
 * The strategy substrate also sets it when a strategy ships its joined step
 * results (`BudgetStopped`, `HarnessJoined`): that text is the model's own step
 * work, shipped as the labelled partial with its warning. A budget stop carries
 * `budgetTerminalPartial`; a joined run relays its last pass's raw reason. An
 * unknown raw reason counts as harness-authored (the kernel shape).
 */
const isHarnessAuthoredText = (md: HarnessTextMarkers | undefined): boolean =>
  md?.harnessAuthoredOutput === true &&
  md.budgetTerminalPartial !== true &&
  (md.rawTerminatedBy === undefined || md.rawTerminatedBy === "harness_deliverable");

type HarnessTextMarkers = {
  readonly harnessAuthoredOutput?: boolean;
  readonly budgetTerminalPartial?: boolean;
  readonly rawTerminatedBy?: string;
};

export function deriveExecOutput(ctx: Pick<ExecutionContext, "metadata">): DerivedExecOutput {
  // Harness-written terminal text is not the model's answer, so it is not
  // shipped as output; the landed file is on receipt.deliverables.
  const harnessAuthored = isHarnessAuthoredText(ctx.metadata.reasoningResult?.metadata);
  const rawOutput: unknown = harnessAuthored ? "" : (ctx.metadata.lastResponse ?? null);
  const sanitizedOutput = typeof rawOutput === "string" ? sanitizeOutput(rawOutput) : rawOutput;

  const outputForSuccess =
    typeof sanitizedOutput === "string"
      ? sanitizedOutput.trim()
      : sanitizedOutput != null
        ? String(sanitizedOutput).trim()
        : "";
  const hasSubstantiveOutput = outputForSuccess.length > 0;

  return { sanitizedOutput, outputForSuccess, hasSubstantiveOutput };
}
