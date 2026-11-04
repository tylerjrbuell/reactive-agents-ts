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
  }
}

/** True when the carrier's task text names its parent's deliverables, not its own. */
export const isStepScope = (carrier: { readonly deliveryScope?: DeliveryScope } | undefined): boolean =>
  carrier?.deliveryScope === "step";

/**
 * The run-shape options both run-start derivations take from the kernel input:
 * the posture (plan writes no artifacts) and the delivery scope (a step kernel
 * owns none of the files its text names). Spread into `compileRunContract`.
 */
export function deliveryRails(input: {
  readonly posture?: RunPosture;
  readonly deliveryScope?: DeliveryScope;
}): { readonly posture?: RunPosture; readonly deliveryScope?: DeliveryScope } {
  return {
    ...(input.posture !== undefined ? { posture: input.posture } : {}),
    ...(input.deliveryScope !== undefined ? { deliveryScope: input.deliveryScope } : {}),
  };
}
