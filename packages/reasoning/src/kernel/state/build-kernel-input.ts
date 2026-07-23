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

/*
 * `StrategyHitlRails` lived here until cascade Task 5.
 *
 * It was the second attempt at the same problem: declare the run-wide HITL
 * rails ONCE so eight hand-rolled strategy input interfaces could not each
 * forget them. It failed for the reason a shared optional bundle always fails —
 * a strategy still had to remember to FORWARD what it declared. The rails (and
 * the four wither-configured policy fields) now ride `RunEnvelope`, which no
 * strategy declares, forwards, or can drop. See
 * `kernel/envelope/run-envelope.ts`.
 */

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
>;

/*
 * Cascade Task 5 — the seven cross-cutting fields are GONE from this bundle:
 *   policy: taskContract, fabricationGuard, grounding
 *   rails:  stallPolicy, approvalPolicy, approvalDecision, interactionResponse
 *
 * Three of them (the HITL rails) used to be declared REQUIRED-but-nullable here
 * so a bundle could not silently omit them. That guard is now redundant and
 * strictly weaker than what replaced it: the fields do not travel through a
 * strategy at all. They are read from `RunEnvelope`, whose provision is a
 * compile-time requirement of every `StrategyFn` (`R = LLMService |
 * RunEnvelope`). A strategy cannot drop what it never carries.
 */

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
