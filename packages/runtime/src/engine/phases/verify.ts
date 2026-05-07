/**
 * VERIFY phase — semantic verification of the agent's response.
 *
 * Optional; gated by `config.enableVerification`. Acquires `VerificationService`
 * lazily (the service may or may not be in the runtime).
 *
 * Decision logic:
 *   1. If service absent → return ctx unchanged
 *   2. If service present → call `verify(response, input)` with the agent's
 *      lastResponse and a richer "input" bundle (task text + tool/observation
 *      evidence). Stores `verificationResult` + `verificationScore` in metadata
 *      and transitions agentState to "verifying".
 *   3. If service errors → fall back to synthetic high-risk result
 *      (score 0.45, recommendation "review") so downstream gates know the
 *      output is unverified.
 *
 * Used at TWO sites in the original `execution-engine.ts`: the primary verify
 * after the agent loop, and the post-retry verify when verification rejection
 * triggers a think-phase retry. Both use this single phase value.
 *
 * Extracted from `execution-engine.ts:3027-3076` and `:3334-3383`
 * (Phase 6: VERIFY).
 */
import { Effect } from "effect";
import { VerificationService } from "@reactive-agents/verification";
import type { Phase } from "../phase.js";
import type { ExecutionContext } from "../../types.js";
import { extractTaskText } from "../util.js";

const VERIFY_EVIDENCE_MAX_CHARS = 14_000;

/**
 * Build the verification input string: task text + compact tool/observation
 * evidence so NLI and overlap checks can ground on retrieved facts, not only
 * the user prompt.
 *
 * Hoisted from `execution-engine.ts:210-260` (private fn `buildVerificationInput`).
 * Phase-local helper — exported only for unit-test access.
 */
export function buildVerificationInput(taskInput: unknown, ctx: ExecutionContext): string {
  const taskText = extractTaskText(taskInput);
  const evidenceLines: string[] = [];

  for (const tr of ctx.toolResults) {
    if (typeof tr !== "object" || tr === null) continue;
    const r = tr as Record<string, unknown>;
    const name = typeof r["toolName"] === "string" ? r["toolName"] : "?";
    const raw = r["result"];
    const body = typeof raw === "string" ? raw : JSON.stringify(raw);
    evidenceLines.push(`[tool:${name}] ${body}`);
  }

  const rs = ctx.metadata["reasoningSteps"];
  if (Array.isArray(rs)) {
    for (const step of rs) {
      if (typeof step !== "object" || step === null) continue;
      const s = step as Record<string, unknown>;
      if (s["type"] === "observation" && typeof s["content"] === "string" && s["content"].length > 0) {
        evidenceLines.push(`[reasoning:observation] ${s["content"]}`);
      }
    }
  }

  const rr = ctx.metadata["reasoningResult"];
  if (typeof rr === "object" && rr !== null) {
    const steps = (rr as Record<string, unknown>)["steps"];
    if (Array.isArray(steps)) {
      for (const step of steps) {
        if (typeof step !== "object" || step === null) continue;
        const s = step as Record<string, unknown>;
        if (s["type"] === "observation" && typeof s["content"] === "string" && s["content"].length > 0) {
          evidenceLines.push(`[reasoning:kernel] ${s["content"]}`);
        }
      }
    }
  }

  if (evidenceLines.length === 0) return taskText;

  let bundle = evidenceLines.join("\n\n");
  if (bundle.length > VERIFY_EVIDENCE_MAX_CHARS) {
    bundle = bundle.slice(0, VERIFY_EVIDENCE_MAX_CHARS) + "\n\n[truncated]";
  }
  return `${taskText}\n\n--- EVIDENCE ---\n${bundle}`;
}

export const verify: Phase = {
  name: "verify",

  skip: (_ctx, deps) => !deps.config.enableVerification,

  run: (ctx, deps) =>
    Effect.gen(function* () {
      const verifyOpt = yield* Effect.serviceOption(VerificationService).pipe(
        Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
      );
      if (verifyOpt._tag !== "Some") return ctx;

      const response = String(ctx.metadata["lastResponse"] ?? "");
      const input = buildVerificationInput(deps.task.input, ctx);

      const result = yield* verifyOpt.value.verify(response, input).pipe(
        Effect.catchAll(() =>
          Effect.succeed({
            overallScore: 0.45,
            passed: false,
            riskLevel: "high" as const,
            layerResults: [
              {
                layerName: "verification_runtime",
                score: 0.45,
                passed: false,
                details: "Verification pipeline failed internally — output is unverified.",
              },
            ],
            recommendation: "review" as const,
            verifiedAt: new Date(),
          }),
        ),
      );

      return {
        ...ctx,
        agentState: "verifying" as const,
        metadata: {
          ...ctx.metadata,
          verificationResult: result,
          verificationScore: result.overallScore,
        },
      };
    }),
};
