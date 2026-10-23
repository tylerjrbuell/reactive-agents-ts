/**
 * Final-output derivation for the TaskResult boundary.
 *
 * Owns: the `rawOutput` read off ctx (with the last-genuine-observation
 * fallback — skipping harness-injected observations, framework instrumentation
 * steps, and compressed-preview envelopes), the sanitize pass, and the
 * trimmed string + substantive-output flags the success bit consumes.
 *
 * Moved verbatim from execution-engine.ts (GH #221 W26 decomposition, former
 * "Build TaskResult — sanitize output" block lines 1010-1045). Pure: reads
 * ctx/rr, mutates nothing.
 */
import type { ExecutionContext } from "../types.js";
import { sanitizeOutput } from "./util.js";

/** Shape of the reasoning result stored in ctx.metadata.reasoningResult. */
type ReasoningResultLike = ExecutionContext["metadata"]["reasoningResult"];

export interface DerivedExecOutput {
  readonly sanitizedOutput: unknown;
  readonly outputForSuccess: string;
  readonly hasSubstantiveOutput: boolean;
}

export function deriveExecOutput(
  ctx: ExecutionContext,
  rr: ReasoningResultLike,
): DerivedExecOutput {
  let rawOutput: unknown = ctx.metadata.lastResponse ?? null;
  if (
    (rawOutput === null || rawOutput === "") &&
    rr?.steps &&
    rr.steps.length > 0 &&
    rr.status !== "failed"
  ) {
    // Fall back to last *genuine* tool observation. Skip:
    //  - harness-injected observations (toolName="system", success=false)
    //    — those carry harness guidance text the model parrots ("Your next step: ..."),
    //  - framework instrumentation steps (HS-cleanup-1) — `[CRITIQUE N]`,
    //    `[TOT depth=...]` and similar control markers exist for the model's
    //    reasoning loop, never as user output candidates,
    //  - tool-result observations whose content was wrapped with the
    //    `[<tool> result — compressed preview]` template (framework
    //    presentation envelope, not synthesized model answer).
    const FRAMEWORK_PREVIEW_PREFIX = /^\s*\[[^\]]+\s+result\s+[—\-]/i;
    const lastObs = [...rr.steps].reverse().find((s) => {
      if (s.type !== "observation") return false;
      const md = s.metadata as { observationResult?: { success?: boolean; toolName?: string }; frameworkInstrumentation?: string } | undefined;
      if (md?.frameworkInstrumentation) return false;
      if (md?.observationResult && (md.observationResult.success === false || md.observationResult.toolName === "system")) return false;
      if (typeof s.content === "string" && FRAMEWORK_PREVIEW_PREFIX.test(s.content)) return false;
      return true;
    });
    if (lastObs?.content) rawOutput = lastObs.content;
  }
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
