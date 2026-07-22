/**
 * shared/step-utils.ts — ReasoningStep factory and ReasoningResult builder.
 *
 * Eliminates the repeated `{ id: ulid() as StepId, type, content, timestamp: new Date() }`
 * pattern and the duplicated `buildResult` function across reflexion, plan-execute,
 * and tree-of-thought strategies.
 */
import { ulid } from "ulid";
import type { ReasoningResult, ReasoningStep } from "../../../types/index.js";
import type { StepId } from "../../../types/step.js";
import type { ReasoningStrategy } from "../../../types/index.js";
import type { KernelState } from "../../state/kernel-state.js";
import { sanitizeAgentOutput } from "../verify/quality-utils.js";

/** Terminal kernel meta a strategy harvests — the pause rails live here. */
type KernelMeta = KernelState["meta"];

/**
 * A durable pause, as a strategy sees it — everything needed to report the
 * pause without holding the kernel state.
 *
 * Two producers: {@link kernelPause} (strategies holding a `KernelState`) and
 * {@link reactResultPause} (strategies holding only the `ReActKernelResult`
 * projection, i.e. plan-execute's per-step executor).
 */
export interface KernelPause {
  readonly reason: "awaiting-approval" | "awaiting-interaction";
  /** The kernel's pause sentinel text, already committed as the pass output. */
  readonly output: string;
  readonly awaitingApprovalFor?: KernelState["meta"]["awaitingApprovalFor"];
  readonly awaitingInteractionFor?: KernelState["meta"]["awaitingInteractionFor"];
}

/**
 * Project the durable pause off a terminal kernel state, or `undefined` when the
 * pass ended normally.
 *
 * A paused pass is TERMINAL for the whole run: the gated call has not executed
 * and must not, until a human decides. Multi-pass strategies (reflexion's
 * improve loop, ToT's phases, plan-execute's steps) MUST stop composing on it —
 * continuing would run the rest of the plan around a call nobody approved.
 */
export function kernelPause(state: KernelState): KernelPause | undefined {
  const reason = state.meta.terminatedBy;
  if (reason !== "awaiting-approval" && reason !== "awaiting-interaction") {
    return undefined;
  }
  return {
    reason,
    output: state.output ?? "",
    ...(state.meta.awaitingApprovalFor !== undefined
      ? { awaitingApprovalFor: state.meta.awaitingApprovalFor }
      : {}),
    ...(state.meta.awaitingInteractionFor !== undefined
      ? { awaitingInteractionFor: state.meta.awaitingInteractionFor }
      : {}),
  };
}

/** True when a kernel pass ended at a durable pause. See {@link kernelPause}. */
export function isKernelPaused(state: KernelState): boolean {
  return kernelPause(state) !== undefined;
}

/**
 * Project the durable pause off a `ReActKernelResult` — the sub-kernel
 * projection plan-execute's step executor returns.
 *
 * The projection narrows `terminatedBy` to a closed enum that has no pause
 * member, so the pause is identified by the descriptors themselves.
 */
export function reactResultPause(result: {
  readonly output: string;
  readonly awaitingApprovalFor?: KernelState["meta"]["awaitingApprovalFor"];
  readonly awaitingInteractionFor?: KernelState["meta"]["awaitingInteractionFor"];
}): KernelPause | undefined {
  if (result.awaitingApprovalFor !== undefined) {
    return {
      reason: "awaiting-approval",
      output: result.output,
      awaitingApprovalFor: result.awaitingApprovalFor,
    };
  }
  if (result.awaitingInteractionFor !== undefined) {
    return {
      reason: "awaiting-interaction",
      output: result.output,
      awaitingInteractionFor: result.awaitingInteractionFor,
    };
  }
  return undefined;
}

/**
 * Project the durable pause descriptors off a terminal kernel meta.
 *
 * Single derivation site (2026-07-22): `reactive.ts` was the ONLY strategy that
 * spread `awaitingApprovalFor` into its result metadata, so a pause under any
 * other strategy reached the runtime with the pause SENTINEL as `output` and no
 * descriptor — `AgentResult.status`/`pendingApproval` were absent and the caller
 * read a paused run as a completed one (found dogfooding FORGE). Deriving here,
 * inside `buildStrategyResult`, means no strategy can drop it.
 */
export function pauseRailMetadata(
  source: KernelMeta | KernelPause | undefined,
): Record<string, unknown> {
  if (!source) return {};
  return {
    ...(source.awaitingApprovalFor !== undefined
      ? { awaitingApprovalFor: source.awaitingApprovalFor }
      : {}),
    ...(source.awaitingInteractionFor !== undefined
      ? { awaitingInteractionFor: source.awaitingInteractionFor }
      : {}),
  };
}

/**
 * Terminal result for a strategy whose kernel pass PAUSED (approval gate or
 * `request_user_input`).
 *
 * Every multi-pass strategy needs the identical shape here — the pause sentinel
 * as output, the descriptor forwarded, `terminatedBy` naming the pause — so it
 * lives in one place rather than being re-derived (and re-forgotten) per
 * strategy. Callers pass whatever they have accumulated so far; the run stops
 * here and resumes from the durable checkpoint, not from this result.
 */
export function pausedStrategyResult(params: {
  strategy: ReasoningStrategy;
  steps: readonly ReasoningStep[];
  pause: KernelPause;
  /** Date.now() captured at strategy start */
  start: number;
  totalTokens: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCost: number;
  /** Strategy-specific metadata to keep alongside the pause rails. */
  extraMetadata?: Record<string, unknown>;
}): ReasoningResult {
  return buildStrategyResult({
    strategy: params.strategy,
    steps: params.steps,
    // The kernel's pause sentinel (`Run paused — awaiting human approval.`),
    // non-empty on every pause, so the output/status coherence guard in
    // buildStrategyResult cannot downgrade this to "failed".
    output: params.pause.output,
    // A pause is a clean terminal, exactly as the reactive path reports it
    // (kernel `status: "done"`, nothing shipped unverified).
    status: "completed",
    start: params.start,
    ...(params.totalInputTokens !== undefined
      ? { totalInputTokens: params.totalInputTokens }
      : {}),
    ...(params.totalOutputTokens !== undefined
      ? { totalOutputTokens: params.totalOutputTokens }
      : {}),
    totalTokens: params.totalTokens,
    totalCost: params.totalCost,
    pause: params.pause,
    extraMetadata: {
      ...params.extraMetadata,
      // The pause reason rides the raw open-string channel; the closed enum
      // stays `end_turn` so `goalAchieved` is honestly unknown rather than
      // claiming a final answer for a run that has not finished.
      terminatedBy: "end_turn" as const,
      rawTerminatedBy: params.pause.reason,
    },
  });
}

/**
 * Create a ReasoningStep with auto-generated ulid id and current timestamp.
 *
 * Replaces the repeated:
 *   `{ id: ulid() as StepId, type, content, timestamp: new Date() }`
 * pattern found in every strategy file.
 */
export function makeStep(
  type: ReasoningStep["type"],
  content: string,
  metadata?: ReasoningStep["metadata"],
): ReasoningStep {
  return {
    id: ulid() as StepId,
    type,
    content,
    timestamp: new Date(),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

/**
 * Build the final ReasoningResult consistently across all strategies.
 *
 * Handles:
 * - Confidence scoring: completed → 0.8, partial/failed → 0.4
 * - Duration from `start` (Date.now() captured at strategy entry)
 * - Optional `extraMetadata` spread for strategy-specific fields
 *   (e.g., adaptive: `selectedStrategy`, `fallbackOccurred`)
 */
export function buildStrategyResult(params: {
  strategy: ReasoningStrategy;
  steps: readonly ReasoningStep[];
  output: unknown;
  status: "completed" | "partial" | "failed";
  /** Date.now() captured at strategy start */
  start: number;
  totalTokens: number;
  /** Cumulative prompt tokens (optional — defaults to 0 when not split). */
  totalInputTokens?: number;
  /** Cumulative completion tokens (optional — defaults to 0 when not split). */
  totalOutputTokens?: number;
  totalCost: number;
  /** Strategy-specific metadata fields merged into result.metadata */
  extraMetadata?: Record<string, unknown>;
  /**
   * Terminal kernel meta for this run, when the strategy ran a kernel.
   *
   * Supplying it forwards the durable pause rails (`awaitingApprovalFor` /
   * `awaitingInteractionFor`) automatically — see {@link pauseRailMetadata} for
   * why this must not be left to each strategy. Omit only for strategies that
   * never touch a kernel.
   */
  kernelMeta?: KernelMeta;
  /**
   * Explicit pause descriptor, for callers that hold a {@link KernelPause}
   * instead of the kernel state (see {@link pausedStrategyResult}). Wins over
   * `kernelMeta` — they describe the same terminal.
   */
  pause?: KernelPause;
  /**
   * Failure detail from the kernel's final state (`state.error`). Carried onto
   * the ReasoningResult so the runtime can surface the real provider cause
   * instead of a generic "Reasoning failed". Ignored on successful results.
   */
  error?: string | null;
}): ReasoningResult {
  // Sanitize output to strip internal agent metadata before it reaches the user
  const sanitizedOutput =
    typeof params.output === "string"
      ? sanitizeAgentOutput(params.output)
      : params.output;

  // HS-106 / M7 invariant — output/status coherence (sweep-2026-05-23).
  //
  // If a strategy emitted no substantive output, force status to "failed"
  // regardless of what the caller claimed. Without this, ToT/plan-execute
  // returning `status:"partial"` + `output:null` triggered the runtime's
  // empty-output fallback (execution-engine.ts:1138), which substituted the
  // last tool observation as the "answer" and reported success=true beside a
  // `failed to produce output` log line — direct anti-mission #4 violation.
  const hasSubstantiveOutput =
    typeof sanitizedOutput === "string"
      ? sanitizedOutput.trim().length > 0
      : sanitizedOutput != null;
  const effectiveStatus: "completed" | "partial" | "failed" =
    hasSubstantiveOutput ? params.status : "failed";

  const confidence = effectiveStatus === "completed" ? 0.8 : 0.4;

  return {
    strategy: params.strategy,
    steps: [...params.steps],
    output: sanitizedOutput,
    metadata: {
      duration: Date.now() - params.start,
      cost: params.totalCost,
      tokensUsed: params.totalTokens,
      inputTokens: params.totalInputTokens ?? 0,
      outputTokens: params.totalOutputTokens ?? 0,
      stepsCount: params.steps.length,
      confidence,
      ...params.extraMetadata,
      // LAST so the pause descriptor always wins: a strategy's own metadata may
      // not contradict the kernel's terminal pause state.
      ...pauseRailMetadata(params.pause ?? params.kernelMeta),
    },
    status: effectiveStatus,
    // Surface failure detail only when the result actually failed and a
    // non-empty error string exists — keeps successful results clean.
    ...(effectiveStatus === "failed" && params.error && params.error.trim().length > 0
      ? { error: params.error.trim() }
      : {}),
  };
}
