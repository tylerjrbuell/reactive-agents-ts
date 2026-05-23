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
import { sanitizeAgentOutput } from "../verify/quality-utils.js";

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
  steps: ReasoningStep[];
  output: unknown;
  status: "completed" | "partial" | "failed";
  /** Date.now() captured at strategy start */
  start: number;
  totalTokens: number;
  totalCost: number;
  /** Strategy-specific metadata fields merged into result.metadata */
  extraMetadata?: Record<string, unknown>;
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
      stepsCount: params.steps.length,
      confidence,
      ...params.extraMetadata,
    },
    status: effectiveStatus,
  };
}
