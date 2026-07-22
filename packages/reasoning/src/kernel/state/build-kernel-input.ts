/**
 * build-kernel-input.ts — Canonical KernelInput assembly.
 *
 * FM-I (GH #195): strategies hand-build `KernelInput` literals and silently
 * drop cross-cutting fields ({harnessPipeline, budgetLimits, calibration,
 * auditRationale, …}) — so Compose hooks, killswitches, and model calibration
 * go dead on reflexion / plan-execute / tree-of-thought / adaptive. Root cause
 * is the absence of one canonical assembly point. `buildKernelInput` is that
 * point: a strategy supplies its run-wide cross-cutting bundle ONCE and a
 * per-pass bundle PER sub-kernel invocation; the builder merges them into a
 * single `KernelInput`. A dropped cross-cutting field becomes a compile error
 * (the bundle is `Pick<KernelInput, …>`), not a silent runtime gap.
 *
 * Pure assembly — no I/O, no Effect. The `KernelInput` shape is NOT changed;
 * both bundles are `Pick`-derived from it so they track it field-for-field and
 * cannot drift.
 *
 * Behaviour-preservation note (verifier): `verifier` is intentionally a
 * PER-PASS field, NOT cross-cutting. Migrating a sub-pass that previously had
 * no verifier must NOT newly introduce a terminal §9.0 gate, so the caller
 * passes the already-resolved verifier (incl. the
 * `REACTIVE_AGENTS_NOOP_VERIFIER` env branch) through `perPass.verifier`,
 * defaulting to `undefined` (absent) when not supplied.
 */
import type { KernelInput } from "./kernel-state.js";

/**
 * Durable HITL rails (Phase D) as they arrive on a STRATEGY input.
 *
 * Every strategy declares its own hand-rolled input interface, so a run-wide
 * field has to be re-declared 8× — which is exactly how the approval gate came
 * to be threaded by `reactive` alone. Strategy inputs `extends StrategyHitlRails`
 * so the rails are declared ONCE and stay type-identical to `KernelInput`'s.
 */
export interface StrategyHitlRails {
  /** Durable HITL (Phase D): resolved approval-gate policy → `KernelInput.approvalPolicy`. */
  readonly approvalPolicy?: KernelInput["approvalPolicy"];
  /** Durable HITL (Phase D): human's approve/deny decision on a resumed run. */
  readonly approvalDecision?: KernelInput["approvalDecision"];
  /** Agentic-UI interaction rail: human's response to a paused `request_user_input`. */
  readonly interactionResponse?: KernelInput["interactionResponse"];
}

/**
 * Run-wide fields — identical for every kernel pass of a single agent run.
 * A strategy builds this once and reuses it across all sub-kernel passes.
 */
export type CrossCuttingInput = Pick<
  KernelInput,
  | "resultCompression"
  | "providerName"
  | "agentId"
  | "sessionId"
  | "requiredTools"
  | "requiredToolQuantities"
  | "relevantTools"
  | "maxCallsPerTool"
  | "maxRequiredToolRetries"
  | "environmentContext"
  | "allowedTools"
  | "metaTools"
  | "toolElaboration"
  | "nextMovesPlanning"
  | "briefResolvedSkills"
  | "synthesisConfig"
  | "observationSummary"
  | "auditRationale"
  | "modelId"
  | "calibration"
  | "harnessPipeline"
  | "budgetLimits"
  | "grounding"
  | "fabricationGuard"
  | "stallPolicy"
  | "taskContract"
> & {
  /**
   * Durable HITL rails (Phase D) — REQUIRED keys whose types include
   * `undefined`, deliberately not part of the `Pick` above.
   *
   * The `Pick`-derived fields are all OPTIONAL on `KernelInput`, so omitting one
   * from a bundle is silently legal — the compile-error promise in this file's
   * header only holds for fields a caller cannot leave out. The approval rails
   * are the fields where a silent omission is a SECURITY defect, not a degraded
   * feature: with `approvalPolicy` missing, `act.ts`'s detach gate never fires
   * and a tool the caller declared `requiresApproval: true` executes with no
   * human decision (2026-07-22: reflexion / tree-of-thought / plan-execute-per-step
   * all bypassed the gate this way — reactive.ts was the only threading site).
   *
   * Declaring them REQUIRED-but-nullable forces every bundle to write
   * `approvalPolicy: input.approvalPolicy` explicitly; forgetting is a compile
   * error, passing `undefined` (no policy configured) stays free.
   */
  readonly approvalPolicy: KernelInput["approvalPolicy"];
  readonly approvalDecision: KernelInput["approvalDecision"];
  readonly interactionResponse: KernelInput["interactionResponse"];
};

/**
 * Per-pass fields — vary between sub-kernel invocations of the same run
 * (e.g. reflexion:generate vs reflexion:reflect, or plan-execute step-N).
 *
 * `verifier` is here by design (see file header): keep it explicit + optional
 * so a pass without a verifier stays gate-free.
 */
export type PerPassInput = Pick<
  KernelInput,
  | "task"
  | "systemPrompt"
  | "availableToolSchemas"
  | "allToolSchemas"
  | "priorContext"
  | "contextProfile"
  | "temperature"
  | "initialMessages"
  | "verifier"
>;

/**
 * Assemble a `KernelInput` from a run-wide cross-cutting bundle and a per-pass
 * bundle. Per-pass values win on the (currently empty) key overlap. Pure: the
 * result is a fresh object, inputs are untouched.
 */
export function buildKernelInput(
  crossCutting: CrossCuttingInput,
  perPass: PerPassInput,
): KernelInput {
  return {
    ...crossCutting,
    ...perPass,
  };
}
