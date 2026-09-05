import type { KernelStatus } from "./kernel-status.js";
import type { RunAssessment } from "../assessment/assess.js";

/**
 * The narrow slice of `KernelState["meta"]` that the H5 completion authority
 * (`completion-status.ts`, `completion-envelope.ts`) actually reads. Any real
 * `KernelState["meta"]` satisfies this structurally — no cast needed at call
 * sites — but declaring it here (rather than importing the full `KernelState`
 * type) means the completion authority doesn't depend on the module that
 * itself references `CompletionEnvelope`, which would otherwise cycle.
 */
export interface CompletionAuthorityMeta {
  readonly abstention?: { readonly reason: string; readonly missing: readonly string[] };
  readonly assessment?: RunAssessment;
  readonly harnessAuthoredOutput?: boolean;
  readonly budgetTerminalPartial?: boolean;
  readonly verificationWarning?: string;
}

/** The narrow slice of `KernelState` the H5 completion authority reads. */
export interface CompletionAuthorityState {
  readonly status: KernelStatus;
  readonly meta: CompletionAuthorityMeta;
}
