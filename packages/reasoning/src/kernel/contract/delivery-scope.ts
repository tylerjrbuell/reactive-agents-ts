// File: src/kernel/contract/delivery-scope.ts
//
// Whose deliverables does this kernel's task text name?
//
// Both run-start derivations read the task text for the files a run must
// produce: `deriveConditions` (the stored set the terminal gates verify) and
// `compileRunContract` (the contract's task-explicit items). They use ONE
// deriver over ONE current-turn text, so they agree by construction.
//
// A sub-kernel that executes ONE step of a parent strategy's plan (plan-execute
// composite steps) gets the parent's WHOLE goal in its task text ("OVERALL
// GOAL: ... write your findings to report.md"). The files named there are the
// parent's deliverables, not the step's: refusing a research step for not
// writing the final report is wrong. The caller says so explicitly with
// `deliveryScope: "step"`, and neither derivation then holds this kernel to the
// files its text names. Absent ⇒ the run owns its task text (unchanged).
//
// Interface merging keeps kernel-state.ts (LOC-pinned) untouched.

import type { RunPosture } from "@reactive-agents/core";
import { resolveHarnessConfig, type ResolvedHarness } from "../../harness-config.js";
import { surfaceHasSubstantiveTool } from "../capabilities/verify/post-conditions.js";

/**
 * `"step"`: this kernel runs one step of a parent's plan; the files its task
 * text names belong to the parent, whose own terminal path holds the run to them.
 */
export type DeliveryScope = "step";

declare module "../state/kernel-state.js" {
  interface KernelInput {
    /**
     * Set by a parent strategy on a per-step sub-kernel (plan-execute composite
     * steps). The files named in this kernel's task text are then not compiled
     * into its contract nor its stored post-conditions. Absent ⇒ the run owns
     * every file its task text names.
     */
    readonly deliveryScope?: DeliveryScope;
    /**
     * The tools a parent's plan step declared for this sub-kernel (plan-execute
     * composite `toolHints`). A step that declares tools expects to call one:
     * act-or-answer counts "none of them called yet" as outstanding tool work.
     * Not a requirement: no gate, abstention or terminal check reads it.
     * Absent ⇒ the kernel is not a declared-tools step.
     */
    readonly stepTools?: readonly string[];
  }
}

/** True when the carrier's task text names its parent's deliverables, not its own. */
export const isStepScope = (carrier: { readonly deliveryScope?: DeliveryScope } | undefined): boolean =>
  carrier?.deliveryScope === "step";

/**
 * The run-shape options both run-start derivations take from the kernel input:
 * the posture (plan writes no artifacts) and the delivery scope (a step kernel
 * owns none of the files its text names). Spread into `compileRunContract`,
 * which also takes the `inputCoverage` harness switch from here (present only
 * when on; the harness resolves from the env when the input carries none). A
 * surface with no substantive tool cannot read anything, so it gets no input
 * requirements (an unknown surface keeps the switch, as every gate does).
 */
export function deliveryRails(input: {
  readonly posture?: RunPosture;
  readonly deliveryScope?: DeliveryScope;
  readonly harness?: Pick<ResolvedHarness, "inputCoverage">;
  readonly availableToolSchemas?: readonly { readonly name: string }[];
}): { readonly posture?: RunPosture; readonly deliveryScope?: DeliveryScope; readonly inputCoverage?: true } {
  const inputCoverage =
    (input.harness ?? resolveHarnessConfig()).inputCoverage === true && surfaceHasSubstantiveTool(input.availableToolSchemas);
  return {
    ...(input.posture !== undefined ? { posture: input.posture } : {}),
    ...(input.deliveryScope !== undefined ? { deliveryScope: input.deliveryScope } : {}),
    ...(inputCoverage ? { inputCoverage: true as const } : {}),
  };
}
